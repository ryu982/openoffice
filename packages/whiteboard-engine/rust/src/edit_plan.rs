//! Shared batch edit planner (`plan_board_edit`) for AI panel, in-app MCP, and CLI.

use crate::bounds::Rect;
use crate::error::{EditError, EditErrorCode};
use crate::model::{
    BoardDocument, BoardObject, ConnectorEnd, ConnectorHead, ConnectorProps, ConnectorRouting,
    DEFAULT_PAPER_COLOR, ImageProps, LineStyle, LinkProps, ObjectKind, Page, PageBackground,
    PageFormat, Point, ShapeKind, ShapeProps, StickerProps, StickyProps, StrokeProps, StrokeTool,
    TextProps, validate_board,
};
use crate::ordering::{initial_order_key, order_between};
use crate::placement::{DEFAULT_PLACEMENT_GAP, NearSide, page_object_rects, place_free, place_near};
use crate::rich_text::{RichText, TextAlign, plain_to_rich_text};
use crate::table::{TableCellUpdate, TablePatch, TableProps, apply_table_patch, new_table_props};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum BatchMode {
    #[default]
    AllOrNothing,
    BestEffort,
    StopOnError,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NearSpec {
    pub target_id: String,
    #[serde(default)]
    pub side: NearSide,
    #[serde(default)]
    pub gap: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpResult {
    pub index: usize,
    pub op: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<EditError>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditPlanResult {
    pub ok: bool,
    pub changed: bool,
    pub doc: BoardDocument,
    pub results: Vec<OpResult>,
    pub created: Vec<String>,
    pub updated: Vec<String>,
    pub deleted: Vec<String>,
    pub batch: BatchMode,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub failures: Vec<OpResult>,
}

fn next_unique_id(prefix: &str, used: &mut HashSet<String>) -> String {
    let mut n = 1usize;
    loop {
        let candidate = format!("{prefix}-{n}");
        if used.insert(candidate.clone()) {
            return candidate;
        }
        n += 1;
    }
}

fn collect_used_ids(doc: &BoardDocument) -> HashSet<String> {
    let mut ids = HashSet::new();
    for p in &doc.pages {
        ids.insert(p.id.clone());
    }
    for o in &doc.objects {
        ids.insert(o.id.clone());
    }
    ids
}

fn resolve_page_id(
    doc: &BoardDocument,
    explicit: Option<&str>,
    default_page_id: Option<&str>,
) -> Result<String, EditError> {
    let target = explicit.or(default_page_id);
    if let Some(ref_str) = target {
        if let Some(p) = doc.pages.iter().find(|p| p.id == ref_str) {
            return Ok(p.id.clone());
        }
        if let Some(p) = doc
            .pages
            .iter()
            .find(|p| !p.title.is_empty() && p.title.eq_ignore_ascii_case(ref_str))
        {
            return Ok(p.id.clone());
        }
        if let Ok(one_based) = ref_str.parse::<usize>() {
            if one_based >= 1 && one_based <= doc.pages.len() {
                return Ok(doc.pages[one_based - 1].id.clone());
            }
        }
        return Err(EditError::new(
            EditErrorCode::PageNotFound,
            format!("page '{ref_str}' not found"),
        ));
    }
    doc.pages
        .first()
        .map(|p| p.id.clone())
        .ok_or_else(|| EditError::new(EditErrorCode::PageNotFound, "board has no pages"))
}

fn next_object_order_key(doc: &BoardDocument, page_id: &str) -> String {
    let last = doc
        .objects
        .iter()
        .filter(|o| o.page_id == page_id)
        .map(|o| o.order_key.as_str())
        .max();
    order_between(last, None)
}

fn default_dimensions(kind: ObjectKind) -> (f64, f64) {
    match kind {
        ObjectKind::Sticky => (220.0, 180.0),
        ObjectKind::Text => (280.0, 64.0),
        ObjectKind::Shape => (240.0, 140.0),
        ObjectKind::Connector => (0.0, 0.0),
        ObjectKind::Stroke => (160.0, 80.0),
        ObjectKind::Image => (360.0, 240.0),
        ObjectKind::Table => (480.0, 220.0),
        ObjectKind::Sticker => (120.0, 120.0),
        ObjectKind::Link => (320.0, 120.0),
    }
}

fn parse_rich_text_value(v: &Value) -> Result<RichText, EditError> {
    if let Some(s) = v.as_str() {
        return Ok(plain_to_rich_text(s));
    }
    serde_json::from_value::<RichText>(v.clone()).map_err(|e| {
        EditError::new(
            EditErrorCode::InvalidArgument,
            format!("invalid rich text value: {e}"),
        )
    })
}

fn parse_connector_end(v: &Value, doc: &BoardDocument) -> Result<ConnectorEnd, EditError> {
    if let Some(obj_id) = v.as_str() {
        if !doc.objects.iter().any(|o| o.id == obj_id) {
            return Err(EditError::new(
                EditErrorCode::TargetNotFound,
                format!("connector target object '{obj_id}' not found"),
            ));
        }
        return Ok(ConnectorEnd::Anchor {
            object_id: obj_id.to_string(),
            anchor_x: None,
            anchor_y: None,
        });
    }
    let end: ConnectorEnd = serde_json::from_value(v.clone()).map_err(|e| {
        EditError::new(
            EditErrorCode::InvalidArgument,
            format!("invalid connector end: {e}"),
        )
    })?;
    if let ConnectorEnd::Anchor { object_id, .. } = &end {
        if !doc.objects.iter().any(|o| o.id == *object_id) {
            return Err(EditError::new(
                EditErrorCode::TargetNotFound,
                format!("connector target object '{object_id}' not found"),
            ));
        }
    }
    Ok(end)
}

fn build_object_props(
    kind: ObjectKind,
    raw: &Map<String, Value>,
    doc: &BoardDocument,
) -> Result<Value, EditError> {
    let props_obj = raw
        .get("props")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let field = |k: &str| props_obj.get(k).or_else(|| raw.get(k));

    match kind {
        ObjectKind::Sticky => {
            let color = field("color")
                .and_then(Value::as_str)
                .unwrap_or("#FEF08A")
                .to_string();
            let text = match field("text") {
                Some(v) => parse_rich_text_value(v)?,
                None => plain_to_rich_text(""),
            };
            let font_size = field("fontSize").and_then(Value::as_f64);
            let align = field("align")
                .map(|v| serde_json::from_value::<TextAlign>(v.clone()))
                .transpose()
                .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))?;
            let p = StickyProps {
                color,
                text,
                font_size,
                align,
            };
            serde_json::to_value(p).map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))
        }
        ObjectKind::Text => {
            let text = match field("text") {
                Some(v) => parse_rich_text_value(v)?,
                None => plain_to_rich_text(""),
            };
            let p = TextProps {
                text,
                font_size: field("fontSize").and_then(Value::as_f64),
                color: field("color").and_then(Value::as_str).map(ToOwned::to_owned),
                align: field("align")
                    .map(|v| serde_json::from_value::<TextAlign>(v.clone()))
                    .transpose()
                    .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))?,
                background: field("background")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                border_color: field("borderColor")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
            };
            serde_json::to_value(p).map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))
        }
        ObjectKind::Shape => {
            let shape = match field("shape") {
                Some(v) => serde_json::from_value::<ShapeKind>(v.clone())
                    .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, format!("invalid shape: {e}")))?,
                None => ShapeKind::RoundedRectangle,
            };
            let fill = field("fill")
                .and_then(Value::as_str)
                .unwrap_or("#EFF6FF")
                .to_string();
            let stroke = field("stroke")
                .and_then(Value::as_str)
                .unwrap_or("#2563EB")
                .to_string();
            let stroke_width = field("strokeWidth").and_then(Value::as_f64).unwrap_or(2.0);
            let line_style = field("lineStyle")
                .map(|v| serde_json::from_value::<LineStyle>(v.clone()))
                .transpose()
                .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))?;
            let text = match field("text") {
                Some(v) => parse_rich_text_value(v)?,
                None => plain_to_rich_text(""),
            };
            let p = ShapeProps {
                shape,
                fill,
                stroke,
                stroke_width,
                line_style,
                text,
                font_size: field("fontSize").and_then(Value::as_f64),
                align: field("align")
                    .map(|v| serde_json::from_value::<TextAlign>(v.clone()))
                    .transpose()
                    .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))?,
            };
            serde_json::to_value(p).map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))
        }
        ObjectKind::Connector => {
            let start_val = field("start")
                .or_else(|| field("from"))
                .ok_or_else(|| EditError::new(EditErrorCode::InvalidArgument, "connector requires start/from"))?;
            let end_val = field("end")
                .or_else(|| field("to"))
                .ok_or_else(|| EditError::new(EditErrorCode::InvalidArgument, "connector requires end/to"))?;
            let start = parse_connector_end(start_val, doc)?;
            let end = parse_connector_end(end_val, doc)?;
            let routing = field("routing")
                .map(|v| serde_json::from_value::<ConnectorRouting>(v.clone()))
                .transpose()
                .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))?
                .unwrap_or(ConnectorRouting::Straight);
            let start_head = field("startHead")
                .map(|v| serde_json::from_value::<ConnectorHead>(v.clone()))
                .transpose()
                .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))?
                .unwrap_or(ConnectorHead::None);
            let end_head = field("endHead")
                .map(|v| serde_json::from_value::<ConnectorHead>(v.clone()))
                .transpose()
                .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))?
                .unwrap_or(ConnectorHead::Arrow);
            let color = field("color")
                .and_then(Value::as_str)
                .unwrap_or("#334155")
                .to_string();
            let stroke_width = field("strokeWidth").and_then(Value::as_f64).unwrap_or(2.0);
            let line_style = field("lineStyle")
                .map(|v| serde_json::from_value::<LineStyle>(v.clone()))
                .transpose()
                .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))?
                .unwrap_or(LineStyle::Solid);
            let label = match field("label").or_else(|| field("text")) {
                Some(v) => Some(parse_rich_text_value(v)?),
                None => None,
            };
            let waypoints = field("waypoints")
                .map(|v| serde_json::from_value::<Vec<Point>>(v.clone()))
                .transpose()
                .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))?;
            let p = ConnectorProps {
                start,
                end,
                routing,
                start_head,
                end_head,
                color,
                stroke_width,
                line_style,
                label,
                waypoints,
            };
            serde_json::to_value(p).map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))
        }
        ObjectKind::Stroke => {
            let tool = field("tool")
                .map(|v| serde_json::from_value::<StrokeTool>(v.clone()))
                .transpose()
                .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))?
                .unwrap_or(StrokeTool::Pen);
            let color = field("color")
                .and_then(Value::as_str)
                .unwrap_or("#1E293B")
                .to_string();
            let width = field("strokeWidth")
                .or_else(|| props_obj.get("width"))
                .and_then(Value::as_f64)
                .unwrap_or(3.0);
            let opacity = field("opacity")
                .and_then(Value::as_f64)
                .unwrap_or(if tool == StrokeTool::Highlighter { 0.4 } else { 1.0 });
            let points: Vec<[f64; 3]> = field("points")
                .ok_or_else(|| EditError::new(EditErrorCode::InvalidArgument, "stroke requires points"))
                .and_then(|v| {
                    serde_json::from_value(v.clone())
                        .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, format!("invalid stroke points: {e}")))
                })?;
            if points.is_empty() {
                return Err(EditError::new(
                    EditErrorCode::InvalidArgument,
                    "stroke points must not be empty",
                ));
            }
            let p = StrokeProps {
                tool,
                color,
                width,
                opacity,
                points,
            };
            serde_json::to_value(p).map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))
        }
        ObjectKind::Image => {
            let resource_id = field("resourceId")
                .and_then(Value::as_str)
                .ok_or_else(|| EditError::new(EditErrorCode::InvalidArgument, "image requires resourceId"))?
                .to_string();
            if !doc.resources.contains_key(&resource_id) {
                return Err(EditError::new(
                    EditErrorCode::ResourceNotFound,
                    format!("resource '{resource_id}' not found in board"),
                ));
            }
            let alt = field("alt").and_then(Value::as_str).map(ToOwned::to_owned);
            serde_json::to_value(ImageProps { resource_id, alt })
                .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))
        }
        ObjectKind::Table => {
            if props_obj.contains_key("rowIds") && props_obj.contains_key("colIds") {
                let t: TableProps = serde_json::from_value(Value::Object(props_obj))
                    .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, format!("invalid table props: {e}")))?;
                return serde_json::to_value(t)
                    .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()));
            }
            let rows = field("rows").and_then(Value::as_u64).unwrap_or(3) as usize;
            let cols = field("cols").and_then(Value::as_u64).unwrap_or(3) as usize;
            let header_row = field("headerRow").and_then(Value::as_bool).unwrap_or(true);
            let mut table = new_table_props(rows, cols, header_row)?;
            if let Some(cells_val) = field("cells") {
                let updates: Vec<TableCellUpdate> = serde_json::from_value(cells_val.clone())
                    .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, format!("invalid table cells: {e}")))?;
                table = apply_table_patch(
                    &table,
                    &TablePatch {
                        cells: Some(updates),
                        font_size: field("fontSize").and_then(Value::as_f64),
                        ..TablePatch::default()
                    },
                )?;
            } else if let Some(data_val) = field("data").and_then(Value::as_array) {
                let mut updates = Vec::new();
                for (r_idx, row_val) in data_val.iter().enumerate() {
                    if let Some(cols_arr) = row_val.as_array() {
                        for (c_idx, cell_val) in cols_arr.iter().enumerate() {
                            if r_idx < rows && c_idx < cols {
                                if let Some(txt) = cell_val.as_str() {
                                    updates.push(TableCellUpdate {
                                        row: r_idx,
                                        col: c_idx,
                                        text: txt.to_string(),
                                    });
                                }
                            }
                        }
                    }
                }
                table = apply_table_patch(
                    &table,
                    &TablePatch {
                        cells: Some(updates),
                        font_size: field("fontSize").and_then(Value::as_f64),
                        ..TablePatch::default()
                    },
                )?;
            }
            serde_json::to_value(table)
                .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))
        }
        ObjectKind::Sticker => {
            let sticker_id = field("stickerId")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| EditError::new(EditErrorCode::InvalidArgument, "sticker requires stickerId"))?
                .to_string();
            let tint = field("tint").and_then(Value::as_str).map(ToOwned::to_owned);
            serde_json::to_value(StickerProps { sticker_id, tint })
                .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))
        }
        ObjectKind::Link => {
            let url = field("url")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| EditError::new(EditErrorCode::InvalidArgument, "link requires non-empty url"))?
                .to_string();
            let title = field("title")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| url.clone());
            let description = field("description")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            let preview_resource_id = field("previewResourceId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            if let Some(ref rid) = preview_resource_id {
                if !doc.resources.contains_key(rid) {
                    return Err(EditError::new(
                        EditErrorCode::ResourceNotFound,
                        format!("previewResourceId '{rid}' not found in board"),
                    ));
                }
            }
            serde_json::to_value(LinkProps {
                url,
                title,
                description,
                preview_resource_id,
            })
            .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))
        }
    }
}

fn apply_single_op(
    doc: &mut BoardDocument,
    op_val: &Value,
    default_page_id: Option<&str>,
    used_ids: &mut HashSet<String>,
) -> Result<(String, Option<String>, Option<String>), EditError> {
    let map = op_val.as_object().ok_or_else(|| {
        EditError::new(EditErrorCode::InvalidArgument, "operation must be a JSON object")
    })?;
    let op_name = map
        .get("op")
        .and_then(Value::as_str)
        .ok_or_else(|| EditError::new(EditErrorCode::UnknownOp, "missing 'op' field"))?;

    match op_name {
        "add" => {
            let kind_val = map
                .get("kind")
                .ok_or_else(|| EditError::new(EditErrorCode::InvalidArgument, "add requires 'kind'"))?;
            let kind: ObjectKind = serde_json::from_value(kind_val.clone()).map_err(|e| {
                EditError::new(EditErrorCode::InvalidArgument, format!("invalid object kind: {e}"))
            })?;
            let page_id = resolve_page_id(
                doc,
                map.get("pageId").and_then(Value::as_str),
                default_page_id,
            )?;
            let page = doc
                .pages
                .iter()
                .find(|p| p.id == page_id)
                .cloned()
                .ok_or_else(|| EditError::new(EditErrorCode::PageNotFound, "page not found"))?;

            let (def_w, def_h) = default_dimensions(kind);
            let width = map.get("width").and_then(Value::as_f64).unwrap_or(def_w);
            let height = map.get("height").and_then(Value::as_f64).unwrap_or(def_h);
            if kind != ObjectKind::Connector
                && (!width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0)
            {
                return Err(EditError::new(
                    EditErrorCode::InvalidArgument,
                    "width and height must be positive finite numbers",
                ));
            }

            let (x, y) = if let (Some(ax), Some(ay)) = (
                map.get("x").and_then(Value::as_f64),
                map.get("y").and_then(Value::as_f64),
            ) {
                (ax, ay)
            } else if let Some(at_obj) = map.get("at").and_then(Value::as_object) {
                let ax = at_obj
                    .get("x")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| EditError::new(EditErrorCode::InvalidArgument, "at.x required"))?;
                let ay = at_obj
                    .get("y")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| EditError::new(EditErrorCode::InvalidArgument, "at.y required"))?;
                (ax, ay)
            } else if let Some(near_val) = map.get("near") {
                let near: NearSpec = serde_json::from_value(near_val.clone()).map_err(|e| {
                    EditError::new(EditErrorCode::InvalidArgument, format!("invalid near spec: {e}"))
                })?;
                let anchor_obj = doc
                    .objects
                    .iter()
                    .find(|o| o.id == near.target_id && o.page_id == page_id)
                    .ok_or_else(|| {
                        EditError::new(
                            EditErrorCode::TargetNotFound,
                            format!("near target '{}' not found on page", near.target_id),
                        )
                    })?;
                let existing = page_object_rects(doc, &page_id);
                place_near(
                    &existing,
                    Rect {
                        x: anchor_obj.x,
                        y: anchor_obj.y,
                        width: anchor_obj.width.max(1.0),
                        height: anchor_obj.height.max(1.0),
                    },
                    near.side,
                    width.max(1.0),
                    height.max(1.0),
                    near.gap.unwrap_or(DEFAULT_PLACEMENT_GAP),
                )
            } else if kind == ObjectKind::Connector {
                (0.0, 0.0)
            } else {
                let existing = page_object_rects(doc, &page_id);
                place_free(
                    &existing,
                    width.max(1.0),
                    height.max(1.0),
                    page.format,
                    page.width,
                    page.height,
                    DEFAULT_PLACEMENT_GAP,
                )
            };

            let id = if let Some(req_id) = map.get("id").and_then(Value::as_str) {
                if req_id.is_empty() || !used_ids.insert(req_id.to_string()) {
                    return Err(EditError::new(
                        EditErrorCode::InvalidArgument,
                        format!("invalid or duplicate object id '{req_id}'"),
                    ));
                }
                req_id.to_string()
            } else {
                next_unique_id("obj", used_ids)
            };

            let props = build_object_props(kind, map, doc)?;
            let rotation = map.get("rotation").and_then(Value::as_f64).unwrap_or(0.0);
            if !rotation.is_finite() {
                return Err(EditError::new(
                    EditErrorCode::InvalidArgument,
                    "rotation must be finite",
                ));
            }
            let group_id = map
                .get("groupId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            let order_key = next_object_order_key(doc, &page_id);

            doc.objects.push(BoardObject {
                id: id.clone(),
                page_id,
                kind,
                order_key,
                x,
                y,
                width,
                height,
                rotation,
                group_id,
                props,
                extra: Map::new(),
            });
            Ok(("add".into(), Some(id), None))
        }
        "update" => {
            let id = map
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| EditError::new(EditErrorCode::InvalidArgument, "update requires 'id'"))?;
            let idx = doc
                .objects
                .iter()
                .position(|o| o.id == id)
                .ok_or_else(|| {
                    EditError::new(EditErrorCode::TargetNotFound, format!("object '{id}' not found"))
                })?;

            let mut updated = doc.objects[idx].clone();
            if let Some(x) = map.get("x").and_then(Value::as_f64) {
                updated.x = x;
            }
            if let Some(y) = map.get("y").and_then(Value::as_f64) {
                updated.y = y;
            }
            if let Some(w) = map.get("width").and_then(Value::as_f64) {
                if updated.kind != ObjectKind::Connector && (!w.is_finite() || w <= 0.0) {
                    return Err(EditError::new(EditErrorCode::InvalidArgument, "width must be > 0"));
                }
                updated.width = w;
            }
            if let Some(h) = map.get("height").and_then(Value::as_f64) {
                if updated.kind != ObjectKind::Connector && (!h.is_finite() || h <= 0.0) {
                    return Err(EditError::new(EditErrorCode::InvalidArgument, "height must be > 0"));
                }
                updated.height = h;
            }
            if let Some(r) = map.get("rotation").and_then(Value::as_f64) {
                if !r.is_finite() {
                    return Err(EditError::new(EditErrorCode::InvalidArgument, "rotation must be finite"));
                }
                updated.rotation = r;
            }
            if let Some(g) = map.get("groupId") {
                updated.group_id = g.as_str().map(ToOwned::to_owned);
            }

            if updated.kind == ObjectKind::Table {
                if let Some(patch_val) = map.get("tablePatch") {
                    let patch: TablePatch = serde_json::from_value(patch_val.clone()).map_err(|e| {
                        EditError::new(EditErrorCode::InvalidArgument, format!("invalid tablePatch: {e}"))
                    })?;
                    let current: TableProps = serde_json::from_value(updated.props.clone()).map_err(|e| {
                        EditError::new(EditErrorCode::InvalidArgument, format!("corrupt table: {e}"))
                    })?;
                    let next_table = apply_table_patch(&current, &patch)?;
                    updated.props = serde_json::to_value(next_table)
                        .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, e.to_string()))?;
                }
            }

            // Merge explicit props + shorthand fields.
            if let Some(props_map) = updated.props.as_object_mut() {
                if let Some(patch_props) = map.get("props").and_then(Value::as_object) {
                    for (k, v) in patch_props {
                        if k == "text" || k == "label" {
                            let rt = parse_rich_text_value(v)?;
                            props_map.insert(k.clone(), serde_json::to_value(rt).unwrap_or(json!({})));
                        } else {
                            props_map.insert(k.clone(), v.clone());
                        }
                    }
                }
                if let Some(txt) = map.get("text") {
                    let rt = parse_rich_text_value(txt)?;
                    let key = if updated.kind == ObjectKind::Connector {
                        "label"
                    } else {
                        "text"
                    };
                    props_map.insert(key.into(), serde_json::to_value(rt).unwrap_or(json!({})));
                }
                for key in [
                    "color",
                    "fill",
                    "stroke",
                    "strokeWidth",
                    "shape",
                    "fontSize",
                    "align",
                    "lineStyle",
                    "url",
                    "title",
                    "description",
                    "alt",
                    "tint",
                    "stickerId",
                ] {
                    if let Some(v) = map.get(key) {
                        props_map.insert(key.into(), v.clone());
                    }
                }
                if let Some(rid) = map.get("resourceId").and_then(Value::as_str) {
                    if !doc.resources.contains_key(rid) {
                        return Err(EditError::new(
                            EditErrorCode::ResourceNotFound,
                            format!("resource '{rid}' not found"),
                        ));
                    }
                    props_map.insert("resourceId".into(), Value::String(rid.to_string()));
                }
            }

            let prev = std::mem::replace(&mut doc.objects[idx], updated);
            if let Err(e) = validate_board(doc) {
                doc.objects[idx] = prev;
                return Err(EditError::new(EditErrorCode::InvalidArgument, e.message));
            }
            Ok(("update".into(), None, Some(id.to_string())))
        }
        "move" => {
            let id = map
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| EditError::new(EditErrorCode::InvalidArgument, "move requires 'id'"))?;
            let idx = doc
                .objects
                .iter()
                .position(|o| o.id == id)
                .ok_or_else(|| {
                    EditError::new(EditErrorCode::TargetNotFound, format!("object '{id}' not found"))
                })?;

            if let Some(target_page_ref) = map.get("pageId").and_then(Value::as_str) {
                let target_page_id = resolve_page_id(doc, Some(target_page_ref), None)?;
                let order_key = next_object_order_key(doc, &target_page_id);
                doc.objects[idx].page_id = target_page_id;
                doc.objects[idx].order_key = order_key;
            }
            if let Some(x) = map.get("x").and_then(Value::as_f64) {
                doc.objects[idx].x = x;
            }
            if let Some(y) = map.get("y").and_then(Value::as_f64) {
                doc.objects[idx].y = y;
            }
            if let Some(dx) = map.get("dx").and_then(Value::as_f64) {
                doc.objects[idx].x += dx;
            }
            if let Some(dy) = map.get("dy").and_then(Value::as_f64) {
                doc.objects[idx].y += dy;
            }
            let page_id = doc.objects[idx].page_id.clone();
            if map.get("toFront").and_then(Value::as_bool) == Some(true) {
                let max_k = doc
                    .objects
                    .iter()
                    .enumerate()
                    .filter(|(i, o)| *i != idx && o.page_id == page_id)
                    .map(|(_, o)| o.order_key.as_str())
                    .max();
                doc.objects[idx].order_key = order_between(max_k, None);
            } else if map.get("toBack").and_then(Value::as_bool) == Some(true) {
                let min_k = doc
                    .objects
                    .iter()
                    .enumerate()
                    .filter(|(i, o)| *i != idx && o.page_id == page_id)
                    .map(|(_, o)| o.order_key.as_str())
                    .min();
                doc.objects[idx].order_key = order_between(None, min_k);
            }
            Ok(("move".into(), None, Some(id.to_string())))
        }
        "delete" => {
            let id = map
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| EditError::new(EditErrorCode::InvalidArgument, "delete requires 'id'"))?;
            let idx = doc
                .objects
                .iter()
                .position(|o| o.id == id)
                .ok_or_else(|| {
                    EditError::new(EditErrorCode::TargetNotFound, format!("object '{id}' not found"))
                })?;
            doc.objects.remove(idx);
            Ok(("delete".into(), None, Some(id.to_string())))
        }
        "add_page" => {
            let format = match map.get("format") {
                Some(v) => serde_json::from_value::<crate::model::PageFormatWire>(v.clone())
                    .map(PageFormat::from)
                    .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, format!("invalid page format: {e}")))?,
                None => PageFormat::Freeform,
            };
            let (def_w, def_h) = format.default_size();
            let width = map.get("width").and_then(Value::as_f64).unwrap_or(def_w);
            let height = map.get("height").and_then(Value::as_f64).unwrap_or(def_h);
            if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
                return Err(EditError::new(
                    EditErrorCode::InvalidArgument,
                    "page width and height must be positive",
                ));
            }
            let background = match map.get("background") {
                Some(v) => serde_json::from_value::<PageBackground>(v.clone()).map_err(|e| {
                    EditError::new(EditErrorCode::InvalidArgument, format!("invalid page background: {e}"))
                })?,
                None => PageBackground::Solid {
                    color: DEFAULT_PAPER_COLOR.to_string(),
                },
            };
            if let PageBackground::Image { ref resource_id, .. } = background {
                if !doc.resources.contains_key(resource_id) {
                    return Err(EditError::new(
                        EditErrorCode::ResourceNotFound,
                        format!("background resource '{resource_id}' not found"),
                    ));
                }
            }
            let id = if let Some(req_id) = map.get("id").and_then(Value::as_str) {
                if req_id.is_empty() || !used_ids.insert(req_id.to_string()) {
                    return Err(EditError::new(
                        EditErrorCode::InvalidArgument,
                        format!("invalid or duplicate page id '{req_id}'"),
                    ));
                }
                req_id.to_string()
            } else {
                next_unique_id("page", used_ids)
            };
            let title = map
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();

            let (insert_idx, order_key) = if let Some(after_id) =
                map.get("afterPageId").and_then(Value::as_str)
            {
                let pos = doc
                    .pages
                    .iter()
                    .position(|p| p.id == after_id)
                    .ok_or_else(|| {
                        EditError::new(
                            EditErrorCode::PageNotFound,
                            format!("afterPageId '{after_id}' not found"),
                        )
                    })?;
                let after_k = doc.pages.get(pos + 1).map(|p| p.order_key.as_str());
                let k = order_between(Some(&doc.pages[pos].order_key), after_k);
                (pos + 1, k)
            } else {
                let last_k = doc.pages.last().map(|p| p.order_key.as_str());
                let k = if last_k.is_some() {
                    order_between(last_k, None)
                } else {
                    initial_order_key()
                };
                (doc.pages.len(), k)
            };

            doc.pages.insert(
                insert_idx,
                Page {
                    id: id.clone(),
                    title,
                    order_key,
                    format,
                    width,
                    height,
                    background,
                    extra: Map::new(),
                },
            );
            Ok(("add_page".into(), Some(id), None))
        }
        "rename_page" => {
            let page_id = resolve_page_id(
                doc,
                map.get("pageId").and_then(Value::as_str),
                default_page_id,
            )?;
            let title = map
                .get("title")
                .and_then(Value::as_str)
                .ok_or_else(|| EditError::new(EditErrorCode::InvalidArgument, "rename_page requires 'title'"))?;
            let page = doc
                .pages
                .iter_mut()
                .find(|p| p.id == page_id)
                .ok_or_else(|| EditError::new(EditErrorCode::PageNotFound, "page not found"))?;
            page.title = title.to_string();
            Ok(("rename_page".into(), None, Some(page_id)))
        }
        "delete_page" => {
            let page_id = resolve_page_id(
                doc,
                map.get("pageId").and_then(Value::as_str),
                default_page_id,
            )?;
            if doc.pages.len() <= 1 {
                return Err(EditError::new(
                    EditErrorCode::LastPageDelete,
                    "cannot delete the last remaining page",
                ));
            }
            doc.pages.retain(|p| p.id != page_id);
            doc.objects.retain(|o| o.page_id != page_id);
            Ok(("delete_page".into(), None, Some(page_id)))
        }
        "set_page_format" => {
            let page_id = resolve_page_id(
                doc,
                map.get("pageId").and_then(Value::as_str),
                default_page_id,
            )?;
            let format = map
                .get("format")
                .ok_or_else(|| EditError::new(EditErrorCode::InvalidArgument, "set_page_format requires 'format'"))
                .and_then(|v| {
                    serde_json::from_value::<crate::model::PageFormatWire>(v.clone())
                        .map(PageFormat::from)
                        .map_err(|e| EditError::new(EditErrorCode::InvalidArgument, format!("invalid format: {e}")))
                })?;
            let (def_w, def_h) = format.default_size();
            let width = map.get("width").and_then(Value::as_f64).unwrap_or(def_w);
            let height = map.get("height").and_then(Value::as_f64).unwrap_or(def_h);
            if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
                return Err(EditError::new(
                    EditErrorCode::InvalidArgument,
                    "page width and height must be positive",
                ));
            }
            let bg_opt = match map.get("background") {
                Some(v) => {
                    let bg = serde_json::from_value::<PageBackground>(v.clone()).map_err(|e| {
                        EditError::new(EditErrorCode::InvalidArgument, format!("invalid background: {e}"))
                    })?;
                    if let PageBackground::Image { ref resource_id, .. } = bg {
                        if !doc.resources.contains_key(resource_id) {
                            return Err(EditError::new(
                                EditErrorCode::ResourceNotFound,
                                format!("background resource '{resource_id}' not found"),
                            ));
                        }
                    }
                    Some(bg)
                }
                None => None,
            };
            let page = doc
                .pages
                .iter_mut()
                .find(|p| p.id == page_id)
                .ok_or_else(|| EditError::new(EditErrorCode::PageNotFound, "page not found"))?;
            page.format = format;
            page.width = width;
            page.height = height;
            if let Some(bg) = bg_opt {
                page.background = bg;
            }
            Ok(("set_page_format".into(), None, Some(page_id)))
        }
        other => Err(EditError::new(
            EditErrorCode::UnknownOp,
            format!("unknown operation '{other}'"),
        )),
    }
}

/// Validates and executes a batch of board operations under the requested batch mode.
/// In `AllOrNothing` mode (default), any error leaves the returned `doc` untouched and `changed = false`.
pub fn plan_board_edit(
    doc: &BoardDocument,
    ops: &[Value],
    default_page_id: Option<&str>,
    mode: BatchMode,
) -> EditPlanResult {
    let mut working = doc.clone();
    let mut used_ids = collect_used_ids(&working);
    let mut results = Vec::with_capacity(ops.len());
    let mut failures = Vec::new();
    let mut created = Vec::new();
    let mut updated = Vec::new();
    let mut deleted = Vec::new();
    let mut applied_any = false;

    for (index, op_val) in ops.iter().enumerate() {
        let op_name = op_val
            .get("op")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();

        match apply_single_op(&mut working, op_val, default_page_id, &mut used_ids) {
            Ok((op_str, created_id, target_id)) => {
                applied_any = true;
                if let Some(ref cid) = created_id {
                    created.push(cid.clone());
                } else if op_str == "delete" || op_str == "delete_page" {
                    if let Some(ref tid) = target_id {
                        deleted.push(tid.clone());
                    }
                } else if let Some(ref tid) = target_id {
                    updated.push(tid.clone());
                }
                results.push(OpResult {
                    index,
                    op: op_str,
                    status: "ok".into(),
                    created: created_id,
                    target: target_id,
                    error: None,
                });
            }
            Err(err) => {
                let fail = OpResult {
                    index,
                    op: op_name,
                    status: "error".into(),
                    created: None,
                    target: None,
                    error: Some(err),
                };
                failures.push(fail.clone());
                results.push(fail);
                match mode {
                    BatchMode::AllOrNothing => {
                        return EditPlanResult {
                            ok: false,
                            changed: false,
                            doc: doc.clone(),
                            results,
                            created: Vec::new(),
                            updated: Vec::new(),
                            deleted: Vec::new(),
                            batch: mode,
                            failures,
                        };
                    }
                    BatchMode::StopOnError => break,
                    BatchMode::BestEffort => continue,
                }
            }
        }
    }

    let ok = failures.is_empty();
    EditPlanResult {
        ok,
        changed: applied_any && working != *doc,
        doc: working,
        results,
        created,
        updated,
        deleted,
        batch: mode,
        failures,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::create_new_board;

    #[test]
    fn all_or_nothing_rolls_back_on_error() {
        let board = create_new_board("b1".into(), "p1".into(), "Board".into());
        let ops = vec![
            json!({ "op": "add", "kind": "sticky", "text": "Idea 1" }),
            json!({ "op": "delete", "id": "missing-obj" }),
        ];
        let res = plan_board_edit(&board, &ops, Some("p1"), BatchMode::AllOrNothing);
        assert!(!res.ok);
        assert!(!res.changed);
        assert!(res.doc.objects.is_empty());
        assert_eq!(res.failures[0].error.as_ref().unwrap().code, EditErrorCode::TargetNotFound);
    }

    #[test]
    fn rejects_last_page_delete() {
        let board = create_new_board("b1".into(), "p1".into(), "".into());
        let ops = vec![json!({ "op": "delete_page", "pageId": "p1" })];
        let res = plan_board_edit(&board, &ops, None, BatchMode::AllOrNothing);
        assert!(!res.ok);
        assert_eq!(res.failures[0].error.as_ref().unwrap().code, EditErrorCode::LastPageDelete);
    }

    #[test]
    fn executes_full_crud_and_page_ops() {
        let board = create_new_board("b1".into(), "p1".into(), "".into());
        let ops = vec![
            json!({ "op": "add", "id": "n1", "kind": "sticky", "text": "First" }),
            json!({ "op": "add", "id": "n2", "kind": "shape", "shape": "diamond", "text": "Check", "near": { "targetId": "n1", "side": "right" } }),
            json!({ "op": "add", "id": "c1", "kind": "connector", "from": "n1", "to": "n2", "label": "next" }),
            json!({ "op": "update", "id": "n1", "text": "Updated" }),
            json!({ "op": "move", "id": "n2", "dx": 40.0, "dy": 10.0 }),
            json!({ "op": "add_page", "id": "p2", "title": "Slides", "format": "wide_16_9" }),
            json!({ "op": "rename_page", "pageId": "p2", "title": "Slide Deck" }),
            json!({ "op": "set_page_format", "pageId": "p2", "format": "a4_portrait" }),
        ];
        let res = plan_board_edit(&board, &ops, Some("p1"), BatchMode::AllOrNothing);
        assert!(res.ok, "failures: {:?}", res.failures);
        assert!(res.changed);
        assert_eq!(res.doc.pages.len(), 2);
        assert_eq!(res.doc.pages[1].title, "Slide Deck");
        assert_eq!(res.doc.pages[1].format, PageFormat::A4Portrait);
        assert_eq!(res.doc.objects.len(), 3);
        assert!(validate_board(&res.doc).is_ok());
    }

    #[test]
    fn best_effort_and_stop_on_error_behave_distinctly() {
        let board = create_new_board("b1".into(), "p1".into(), "".into());
        let ops = vec![
            json!({ "op": "add", "id": "a1", "kind": "sticky", "text": "Keep" }),
            json!({ "op": "bogus_op" }),
            json!({ "op": "add", "id": "a2", "kind": "sticky", "text": "After" }),
        ];
        let stop = plan_board_edit(&board, &ops, Some("p1"), BatchMode::StopOnError);
        assert_eq!(stop.doc.objects.len(), 1);
        assert_eq!(stop.failures[0].error.as_ref().unwrap().code, EditErrorCode::UnknownOp);

        let best = plan_board_edit(&board, &ops, Some("p1"), BatchMode::BestEffort);
        assert_eq!(best.doc.objects.len(), 2);
        assert_eq!(best.failures.len(), 1);
    }
}
