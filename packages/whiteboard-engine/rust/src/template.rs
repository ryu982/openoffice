//! Declarative JSON template validator and layout engine (`apply_template`, spec §4.3).
//! Supports `stack` & `grid` containers, 12 leaf block kinds, `repeat`, `frame`, and `from`/`to` key refs.

use crate::error::{EditError, EditErrorCode};
use crate::model::{
    BoardDocument, BoardObject, ConnectorEnd, ConnectorHead, ConnectorProps, ConnectorRouting,
    DEFAULT_PAPER_COLOR, ImageProps, LineStyle, LinkProps, ObjectKind, Page, PageBackground,
    PageFormat, PageFormatWire, ShapeKind, ShapeProps, StickerProps, StickyProps, StrokeProps,
    StrokeTool, TextProps, validate_board,
};
use crate::ordering::{initial_order_key, order_between};
use crate::rich_text::{TextAlign, plain_to_rich_text};
use crate::table::{TableCellUpdate, TablePatch, apply_table_patch, new_table_props};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

pub const MAX_TEMPLATE_DEPTH: usize = 16;
pub const MAX_TEMPLATE_BLOCKS: usize = 2000;
const DEFAULT_GAP: f64 = 24.0;
const DEFAULT_PADDING: f64 = 48.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TemplateTarget {
    #[default]
    NewPages,
    CurrentPage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum StackDirection {
    #[default]
    Vertical,
    Horizontal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateFrame {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub rotation: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateRepeat {
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TemplatePageDefaults {
    pub format: Option<PageFormatWire>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub background: Option<PageBackground>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDocument {
    pub schema_version: u32,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub target: TemplateTarget,
    #[serde(default)]
    pub page_defaults: Option<TemplatePageDefaults>,
    pub pages: Vec<TemplatePage>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplatePage {
    pub key: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub format: Option<PageFormatWire>,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
    #[serde(default)]
    pub background: Option<PageBackground>,
    #[serde(default)]
    pub blocks: Vec<TemplateBlock>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TemplateConnectorEndpoint {
    Key(String),
    KeyAnchor {
        key: String,
        #[serde(rename = "anchorX")]
        anchor_x: Option<f64>,
        #[serde(rename = "anchorY")]
        anchor_y: Option<f64>,
    },
    Point {
        x: f64,
        y: f64,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateBlock {
    #[serde(rename = "type")]
    pub block_type: String,
    pub key: String,
    #[serde(default)]
    pub frame: Option<TemplateFrame>,
    #[serde(default)]
    pub repeat: Option<TemplateRepeat>,
    // Container fields
    #[serde(default)]
    pub direction: Option<StackDirection>,
    #[serde(default)]
    pub columns: Option<usize>,
    #[serde(default)]
    pub gap: Option<f64>,
    #[serde(default)]
    pub padding: Option<f64>,
    #[serde(default)]
    pub children: Vec<TemplateBlock>,
    // Leaf content & style fields
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub fill: Option<String>,
    #[serde(default)]
    pub stroke: Option<String>,
    #[serde(default)]
    pub stroke_width: Option<f64>,
    #[serde(default)]
    pub font_size: Option<f64>,
    #[serde(default)]
    pub align: Option<TextAlign>,
    #[serde(default)]
    pub shape: Option<ShapeKind>,
    #[serde(default)]
    pub from: Option<TemplateConnectorEndpoint>,
    #[serde(default)]
    pub to: Option<TemplateConnectorEndpoint>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub routing: Option<ConnectorRouting>,
    #[serde(default)]
    pub start_head: Option<ConnectorHead>,
    #[serde(default)]
    pub end_head: Option<ConnectorHead>,
    #[serde(default)]
    pub tool: Option<StrokeTool>,
    #[serde(default)]
    pub points: Option<Vec<[f64; 3]>>,
    #[serde(default)]
    pub resource_id: Option<String>,
    #[serde(default)]
    pub alt: Option<String>,
    #[serde(default)]
    pub rows: Option<usize>,
    #[serde(default)]
    pub cols: Option<usize>,
    #[serde(default)]
    pub header_row: Option<bool>,
    #[serde(default)]
    pub cells: Option<Vec<TableCellUpdate>>,
    #[serde(default)]
    pub data: Option<Vec<Vec<String>>>,
    #[serde(default)]
    pub sticker_id: Option<String>,
    #[serde(default)]
    pub tint: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateApplyResult {
    pub doc: BoardDocument,
    pub created_page_ids: Vec<String>,
    pub created_object_ids: Vec<String>,
}

const VALID_BLOCK_TYPES: &[&str] = &[
    "stack",
    "grid",
    "title",
    "card",
    "zone",
    "sticky",
    "text",
    "shape",
    "connector",
    "stroke",
    "image",
    "table",
    "sticker",
    "link",
];

fn tpl_err(msg: impl Into<String>) -> EditError {
    EditError::new(EditErrorCode::InvalidTemplate, msg)
}

fn expand_repeats(blocks: &[TemplateBlock], depth: usize, total: &mut usize) -> Result<Vec<TemplateBlock>, EditError> {
    if depth > MAX_TEMPLATE_DEPTH {
        return Err(tpl_err(format!(
            "template container nesting exceeds maximum depth {MAX_TEMPLATE_DEPTH}"
        )));
    }
    let mut out = Vec::new();
    for b in blocks {
        if !VALID_BLOCK_TYPES.contains(&b.block_type.as_str()) {
            return Err(tpl_err(format!("unknown template block type '{}'", b.block_type)));
        }
        if b.key.trim().is_empty() {
            return Err(tpl_err("template block key must be non-empty"));
        }
        if b.block_type == "grid" {
            let cols = b.columns.unwrap_or(0);
            if cols == 0 {
                return Err(tpl_err(format!("grid block '{}' requires columns >= 1", b.key)));
            }
        }
        let count = match &b.repeat {
            Some(r) => {
                if r.count == 0 {
                    return Err(tpl_err(format!("block '{}' repeat.count must be >= 1", b.key)));
                }
                r.count
            }
            None => 1,
        };
        for i in 1..=count {
            *total += 1;
            if *total > MAX_TEMPLATE_BLOCKS {
                return Err(tpl_err(format!(
                    "template exceeds maximum block count {MAX_TEMPLATE_BLOCKS}"
                )));
            }
            let mut copy = b.clone();
            copy.repeat = None;
            if count > 1 {
                copy.key = format!("{}#{i}", b.key);
            }
            if !copy.children.is_empty() {
                let expanded_children = expand_repeats(&copy.children, depth + 1, total)?;
                copy.children = if count > 1 {
                    expanded_children
                        .into_iter()
                        .map(|mut c| {
                            c.key = format!("{}#{i}", c.key);
                            c
                        })
                        .collect()
                } else {
                    expanded_children
                };
            }
            out.push(copy);
        }
    }
    Ok(out)
}

fn collect_keys(blocks: &[TemplateBlock], seen: &mut HashSet<String>) -> Result<(), EditError> {
    for b in blocks {
        if !seen.insert(b.key.clone()) {
            return Err(tpl_err(format!("duplicate template block key '{}'", b.key)));
        }
        if let Some(ref f) = b.frame {
            if !f.x.is_finite()
                || !f.y.is_finite()
                || !f.w.is_finite()
                || !f.h.is_finite()
                || f.w <= 0.0
                || f.h <= 0.0
            {
                return Err(tpl_err(format!("block '{}' has invalid frame", b.key)));
            }
        }
        collect_keys(&b.children, seen)?;
    }
    Ok(())
}

fn validate_block_refs(
    blocks: &[TemplateBlock],
    keys: &HashSet<String>,
    doc: &BoardDocument,
) -> Result<(), EditError> {
    for b in blocks {
        match b.block_type.as_str() {
            "connector" => {
                for (label, end_opt) in [("from", &b.from), ("to", &b.to)] {
                    let end = end_opt
                        .as_ref()
                        .ok_or_else(|| tpl_err(format!("connector '{}' missing '{label}'", b.key)))?;
                    match end {
                        TemplateConnectorEndpoint::Key(k)
                        | TemplateConnectorEndpoint::KeyAnchor { key: k, .. } => {
                            if !keys.contains(k) {
                                return Err(tpl_err(format!(
                                    "connector '{}' references unknown block key '{k}'",
                                    b.key
                                )));
                            }
                        }
                        TemplateConnectorEndpoint::Point { x, y } => {
                            if !x.is_finite() || !y.is_finite() {
                                return Err(tpl_err(format!(
                                    "connector '{}' has non-finite point",
                                    b.key
                                )));
                            }
                        }
                    }
                }
            }
            "image" => {
                let rid = b
                    .resource_id
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| tpl_err(format!("image block '{}' requires resourceId", b.key)))?;
                if !doc.resources.contains_key(rid) {
                    return Err(EditError::new(
                        EditErrorCode::ResourceNotFound,
                        format!("image block '{}' resource '{rid}' not found", b.key),
                    ));
                }
            }
            "link" => {
                if b.url.as_deref().map(str::trim).unwrap_or("").is_empty() {
                    return Err(tpl_err(format!("link block '{}' requires url", b.key)));
                }
            }
            "sticker" => {
                if b.sticker_id.as_deref().map(str::trim).unwrap_or("").is_empty() {
                    return Err(tpl_err(format!("sticker block '{}' requires stickerId", b.key)));
                }
            }
            "stroke" => {
                if b.points.as_ref().map_or(true, Vec::is_empty) {
                    return Err(tpl_err(format!("stroke block '{}' requires non-empty points", b.key)));
                }
            }
            _ => {}
        }
        validate_block_refs(&b.children, keys, doc)?;
    }
    Ok(())
}

fn preferred_size(b: &TemplateBlock) -> (f64, f64) {
    if let Some(ref f) = b.frame {
        return (f.w, f.h);
    }
    let (def_w, def_h) = match b.block_type.as_str() {
        "title" => (640.0, 56.0),
        "card" => (320.0, 180.0),
        "zone" => (420.0, 320.0),
        "sticky" => (220.0, 180.0),
        "text" => (320.0, 64.0),
        "shape" => (240.0, 140.0),
        "table" => (520.0, 220.0),
        "image" => (360.0, 240.0),
        "sticker" => (120.0, 120.0),
        "link" => (320.0, 120.0),
        "stroke" => (160.0, 80.0),
        "connector" => (0.0, 0.0),
        "stack" => {
            let gap = b.gap.unwrap_or(DEFAULT_GAP);
            let pad = b.padding.unwrap_or(0.0);
            let dir = b.direction.unwrap_or(StackDirection::Vertical);
            let visible: Vec<&TemplateBlock> = b
                .children
                .iter()
                .filter(|c| c.block_type != "connector" && c.frame.is_none())
                .collect();
            if visible.is_empty() {
                (240.0, 120.0)
            } else {
                let sizes: Vec<(f64, f64)> = visible.iter().map(|c| preferred_size(c)).collect();
                match dir {
                    StackDirection::Vertical => {
                        let w = sizes.iter().map(|s| s.0).fold(0.0_f64, f64::max);
                        let h = sizes.iter().map(|s| s.1).sum::<f64>()
                            + gap * (sizes.len().saturating_sub(1) as f64);
                        (w + pad * 2.0, h + pad * 2.0)
                    }
                    StackDirection::Horizontal => {
                        let w = sizes.iter().map(|s| s.0).sum::<f64>()
                            + gap * (sizes.len().saturating_sub(1) as f64);
                        let h = sizes.iter().map(|s| s.1).fold(0.0_f64, f64::max);
                        (w + pad * 2.0, h + pad * 2.0)
                    }
                }
            }
        }
        "grid" => {
            let cols = b.columns.unwrap_or(2).max(1);
            let gap = b.gap.unwrap_or(DEFAULT_GAP);
            let pad = b.padding.unwrap_or(0.0);
            let visible: Vec<&TemplateBlock> = b
                .children
                .iter()
                .filter(|c| c.block_type != "connector" && c.frame.is_none())
                .collect();
            if visible.is_empty() {
                (400.0, 200.0)
            } else {
                let rows = visible.len().div_ceil(cols);
                let cell_w = visible
                    .iter()
                    .map(|c| preferred_size(c).0)
                    .fold(200.0_f64, f64::max);
                let cell_h = visible
                    .iter()
                    .map(|c| preferred_size(c).1)
                    .fold(140.0_f64, f64::max);
                (
                    cell_w * (cols as f64) + gap * (cols.saturating_sub(1) as f64) + pad * 2.0,
                    cell_h * (rows as f64) + gap * (rows.saturating_sub(1) as f64) + pad * 2.0,
                )
            }
        }
        _ => (240.0, 140.0),
    };
    (b.width.unwrap_or(def_w), b.height.unwrap_or(def_h))
}

struct LayoutCtx<'a> {
    page_id: &'a str,
    used_ids: &'a mut HashSet<String>,
    key_to_obj_id: HashMap<String, String>,
    created_objects: Vec<BoardObject>,
    pending_connectors: Vec<TemplateBlock>,
    last_order_key: Option<String>,
}

impl<'a> LayoutCtx<'a> {
    fn next_id(&mut self, prefix: &str) -> String {
        let mut n = 1usize;
        loop {
            let c = format!("{prefix}-{n}");
            if self.used_ids.insert(c.clone()) {
                return c;
            }
            n += 1;
        }
    }

    fn next_order_key(&mut self) -> String {
        let k = order_between(self.last_order_key.as_deref(), None);
        self.last_order_key = Some(k.clone());
        k
    }

    fn emit_leaf(
        &mut self,
        b: &TemplateBlock,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    ) -> Result<(), EditError> {
        let rotation = b.frame.as_ref().and_then(|f| f.rotation).unwrap_or(0.0);
        let id = self.next_id("tpl");
        let order_key = self.next_order_key();

        let (kind, props) = match b.block_type.as_str() {
            "title" => {
                let txt = b
                    .text
                    .as_deref()
                    .or(b.title.as_deref())
                    .unwrap_or("");
                let p = TextProps {
                    text: plain_to_rich_text(txt),
                    font_size: Some(b.font_size.unwrap_or(28.0)),
                    color: Some(b.color.clone().unwrap_or_else(|| "#0F172A".into())),
                    align: b.align.or(Some(TextAlign::Left)),
                    background: None,
                    border_color: None,
                };
                (ObjectKind::Text, serde_json::to_value(p).unwrap())
            }
            "card" => {
                let combined = match (&b.title, &b.body, &b.text) {
                    (Some(t), Some(body), _) => format!("{t}\n{body}"),
                    (Some(t), None, _) => t.clone(),
                    (_, _, Some(txt)) => txt.clone(),
                    (None, Some(body), None) => body.clone(),
                    _ => String::new(),
                };
                let p = ShapeProps {
                    shape: ShapeKind::RoundedRectangle,
                    fill: b.fill.clone().unwrap_or_else(|| "#FFFFFF".into()),
                    stroke: b.stroke.clone().unwrap_or_else(|| "#CBD5E1".into()),
                    stroke_width: b.stroke_width.unwrap_or(1.5),
                    line_style: None,
                    text: plain_to_rich_text(&combined),
                    font_size: Some(b.font_size.unwrap_or(16.0)),
                    align: b.align.or(Some(TextAlign::Left)),
                };
                (ObjectKind::Shape, serde_json::to_value(p).unwrap())
            }
            "zone" => {
                let heading = b.title.as_deref().or(b.text.as_deref()).unwrap_or("");
                let p = ShapeProps {
                    shape: ShapeKind::RoundedRectangle,
                    fill: b.fill.clone().unwrap_or_else(|| "#F8FAFC".into()),
                    stroke: b.stroke.clone().unwrap_or_else(|| "#94A3B8".into()),
                    stroke_width: b.stroke_width.unwrap_or(1.5),
                    line_style: Some(LineStyle::Dashed),
                    text: plain_to_rich_text(heading),
                    font_size: Some(b.font_size.unwrap_or(18.0)),
                    align: b.align.or(Some(TextAlign::Left)),
                };
                (ObjectKind::Shape, serde_json::to_value(p).unwrap())
            }
            "sticky" => {
                let p = StickyProps {
                    color: b.color.clone().unwrap_or_else(|| "#FEF08A".into()),
                    text: plain_to_rich_text(b.text.as_deref().unwrap_or("")),
                    font_size: b.font_size,
                    align: b.align,
                };
                (ObjectKind::Sticky, serde_json::to_value(p).unwrap())
            }
            "text" => {
                let p = TextProps {
                    text: plain_to_rich_text(b.text.as_deref().unwrap_or("")),
                    font_size: b.font_size,
                    color: b.color.clone(),
                    align: b.align,
                    background: b.fill.clone(),
                    border_color: b.stroke.clone(),
                };
                (ObjectKind::Text, serde_json::to_value(p).unwrap())
            }
            "shape" => {
                let p = ShapeProps {
                    shape: b.shape.unwrap_or(ShapeKind::RoundedRectangle),
                    fill: b.fill.clone().unwrap_or_else(|| "#EFF6FF".into()),
                    stroke: b.stroke.clone().unwrap_or_else(|| "#2563EB".into()),
                    stroke_width: b.stroke_width.unwrap_or(2.0),
                    line_style: None,
                    text: plain_to_rich_text(b.text.as_deref().unwrap_or("")),
                    font_size: b.font_size,
                    align: b.align,
                };
                (ObjectKind::Shape, serde_json::to_value(p).unwrap())
            }
            "stroke" => {
                let tool = b.tool.unwrap_or(StrokeTool::Pen);
                let p = StrokeProps {
                    tool,
                    color: b.color.clone().unwrap_or_else(|| "#1E293B".into()),
                    width: b.stroke_width.unwrap_or(3.0),
                    opacity: if tool == StrokeTool::Highlighter { 0.4 } else { 1.0 },
                    points: b.points.clone().unwrap_or_default(),
                };
                (ObjectKind::Stroke, serde_json::to_value(p).unwrap())
            }
            "image" => {
                let p = ImageProps {
                    resource_id: b.resource_id.clone().unwrap_or_default(),
                    alt: b.alt.clone(),
                };
                (ObjectKind::Image, serde_json::to_value(p).unwrap())
            }
            "table" => {
                let rows = b
                    .rows
                    .or_else(|| b.data.as_ref().map(Vec::len))
                    .unwrap_or(3);
                let cols = b
                    .cols
                    .or_else(|| {
                        b.data
                            .as_ref()
                            .and_then(|d| d.iter().map(Vec::len).max())
                    })
                    .unwrap_or(3);
                let mut t = new_table_props(rows.max(1), cols.max(1), b.header_row.unwrap_or(true))
                    .map_err(|e| tpl_err(e.message))?;
                let mut updates = b.cells.clone().unwrap_or_default();
                if let Some(data) = &b.data {
                    for (ri, row) in data.iter().enumerate() {
                        for (ci, text) in row.iter().enumerate() {
                            if ri < t.row_ids.len() && ci < t.col_ids.len() {
                                updates.push(TableCellUpdate {
                                    row: ri,
                                    col: ci,
                                    text: text.clone(),
                                });
                            }
                        }
                    }
                }
                if !updates.is_empty() || b.font_size.is_some() {
                    t = apply_table_patch(
                        &t,
                        &TablePatch {
                            cells: if updates.is_empty() { None } else { Some(updates) },
                            font_size: b.font_size,
                            ..TablePatch::default()
                        },
                    )
                    .map_err(|e| tpl_err(e.message))?;
                }
                (ObjectKind::Table, serde_json::to_value(t).unwrap())
            }
            "sticker" => {
                let p = StickerProps {
                    sticker_id: b.sticker_id.clone().unwrap_or_default(),
                    tint: b.tint.clone(),
                };
                (ObjectKind::Sticker, serde_json::to_value(p).unwrap())
            }
            "link" => {
                let url = b.url.clone().unwrap_or_default();
                let title = b.title.clone().unwrap_or_else(|| url.clone());
                let p = LinkProps {
                    url,
                    title,
                    description: b.description.clone(),
                    preview_resource_id: None,
                };
                (ObjectKind::Link, serde_json::to_value(p).unwrap())
            }
            other => return Err(tpl_err(format!("unexpected leaf block '{other}'"))),
        };

        self.key_to_obj_id.insert(b.key.clone(), id.clone());
        self.created_objects.push(BoardObject {
            id,
            page_id: self.page_id.to_string(),
            kind,
            order_key,
            x,
            y,
            width: w.max(1.0),
            height: h.max(1.0),
            rotation,
            group_id: None,
            props,
            extra: Map::new(),
        });
        Ok(())
    }

    fn layout_block(&mut self, b: &TemplateBlock, x: f64, y: f64, avail_w: f64, avail_h: f64) -> Result<(f64, f64), EditError> {
        if b.block_type == "connector" {
            self.pending_connectors.push(b.clone());
            return Ok((0.0, 0.0));
        }

        let (bx, by, bw, bh) = if let Some(ref f) = b.frame {
            (f.x, f.y, f.w, f.h)
        } else {
            (x, y, avail_w, avail_h)
        };

        match b.block_type.as_str() {
            "stack" => {
                let dir = b.direction.unwrap_or(StackDirection::Vertical);
                let gap = b.gap.unwrap_or(DEFAULT_GAP);
                let pad = b.padding.unwrap_or(0.0);
                let inner_x = bx + pad;
                let inner_y = by + pad;
                let inner_w = (bw - pad * 2.0).max(80.0);
                let inner_h = (bh - pad * 2.0).max(80.0);

                let flow_children: Vec<&TemplateBlock> = b
                    .children
                    .iter()
                    .filter(|c| c.block_type != "connector" && c.frame.is_none())
                    .collect();
                for c in &b.children {
                    if c.block_type == "connector" {
                        self.pending_connectors.push(c.clone());
                    } else if c.frame.is_some() {
                        self.layout_block(c, inner_x, inner_y, inner_w, inner_h)?;
                    }
                }

                let count = flow_children.len();
                let mut cursor_x = inner_x;
                let mut cursor_y = inner_y;
                let mut max_w = 0.0_f64;
                let mut max_h = 0.0_f64;

                for c in flow_children {
                    let (pw, ph) = preferred_size(c);
                    match dir {
                        StackDirection::Vertical => {
                            let cw = if c.width.is_some() { pw } else { inner_w };
                            let ch = ph;
                            let (uw, uh) = self.layout_block(c, cursor_x, cursor_y, cw, ch)?;
                            cursor_y += uh + gap;
                            max_w = max_w.max(uw);
                            max_h = cursor_y - inner_y - gap;
                        }
                        StackDirection::Horizontal => {
                            let cw = if c.width.is_some() {
                                pw
                            } else {
                                ((inner_w - gap * (count.saturating_sub(1) as f64)) / (count.max(1) as f64))
                                    .max(120.0)
                            };
                            let ch = if c.height.is_some() { ph } else { ph.min(inner_h).max(ph) };
                            let (uw, uh) = self.layout_block(c, cursor_x, cursor_y, cw, ch)?;
                            cursor_x += uw + gap;
                            max_w = cursor_x - inner_x - gap;
                            max_h = max_h.max(uh);
                        }
                    }
                }
                Ok((max_w + pad * 2.0, max_h + pad * 2.0))
            }
            "grid" => {
                let cols = b.columns.unwrap_or(2).max(1);
                let gap = b.gap.unwrap_or(DEFAULT_GAP);
                let pad = b.padding.unwrap_or(0.0);
                let inner_x = bx + pad;
                let inner_y = by + pad;
                let inner_w = (bw - pad * 2.0).max(80.0);

                let flow_children: Vec<&TemplateBlock> = b
                    .children
                    .iter()
                    .filter(|c| c.block_type != "connector" && c.frame.is_none())
                    .collect();
                for c in &b.children {
                    if c.block_type == "connector" {
                        self.pending_connectors.push(c.clone());
                    } else if c.frame.is_some() {
                        self.layout_block(c, inner_x, inner_y, inner_w, bh)?;
                    }
                }

                let col_w = ((inner_w - gap * (cols.saturating_sub(1) as f64)) / (cols as f64))
                    .max(120.0);
                let mut row_y = inner_y;
                for row_chunk in flow_children.chunks(cols) {
                    let row_h = row_chunk
                        .iter()
                        .map(|c| preferred_size(c).1)
                        .fold(140.0_f64, f64::max);
                    for (ci, child) in row_chunk.iter().enumerate() {
                        let cx = inner_x + (ci as f64) * (col_w + gap);
                        self.layout_block(child, cx, row_y, col_w, row_h)?;
                    }
                    row_y += row_h + gap;
                }
                let total_h = (row_y - inner_y - gap).max(0.0);
                Ok((inner_w + pad * 2.0, total_h + pad * 2.0))
            }
            "zone" => {
                let (pw, ph) = preferred_size(b);
                let zw = if b.frame.is_some() { bw } else { avail_w.max(pw) };
                let pad = b.padding.unwrap_or(24.0);
                let header_h = 40.0;
                // Measure/place children inside the zone if any.
                let mut child_h = 0.0_f64;
                if !b.children.is_empty() {
                    let gap = b.gap.unwrap_or(DEFAULT_GAP);
                    // Reserve zone first so it sits behind children in z-order.
                    let zone_idx = self.created_objects.len();
                    self.emit_leaf(b, bx, by, zw, ph)?;
                    let mut cy = by + header_h + pad;
                    for c in &b.children {
                        if c.block_type == "connector" {
                            self.pending_connectors.push(c.clone());
                        } else {
                            let (_, ch) = preferred_size(c);
                            let (_, used_h) = self.layout_block(c, bx + pad, cy, (zw - pad * 2.0).max(80.0), ch)?;
                            cy += used_h + gap;
                        }
                    }
                    child_h = (cy - by - gap + pad).max(ph);
                    self.created_objects[zone_idx].height = child_h;
                    Ok((zw, child_h))
                } else {
                    let zh = if b.frame.is_some() { bh } else { ph.max(child_h) };
                    self.emit_leaf(b, bx, by, zw, zh)?;
                    Ok((zw, zh))
                }
            }
            _ => {
                let (pw, ph) = preferred_size(b);
                let w = if b.frame.is_some() { bw } else { avail_w.min(pw).max(bw.min(pw)) };
                let h = if b.frame.is_some() { bh } else { ph };
                self.emit_leaf(b, bx, by, w.max(1.0), h.max(1.0))?;
                Ok((w, h))
            }
        }
    }

    fn flush_connectors(&mut self) -> Result<(), EditError> {
        let connectors = std::mem::take(&mut self.pending_connectors);
        for c in connectors {
            let resolve = |ep: &TemplateConnectorEndpoint| -> Result<ConnectorEnd, EditError> {
                match ep {
                    TemplateConnectorEndpoint::Key(k) => {
                        let oid = self.key_to_obj_id.get(k).ok_or_else(|| {
                            tpl_err(format!("connector '{}' target '{k}' did not emit an object", c.key))
                        })?;
                        Ok(ConnectorEnd::Anchor {
                            object_id: oid.clone(),
                            anchor_x: None,
                            anchor_y: None,
                        })
                    }
                    TemplateConnectorEndpoint::KeyAnchor {
                        key,
                        anchor_x,
                        anchor_y,
                    } => {
                        let oid = self.key_to_obj_id.get(key).ok_or_else(|| {
                            tpl_err(format!("connector '{}' target '{key}' did not emit an object", c.key))
                        })?;
                        Ok(ConnectorEnd::Anchor {
                            object_id: oid.clone(),
                            anchor_x: *anchor_x,
                            anchor_y: *anchor_y,
                        })
                    }
                    TemplateConnectorEndpoint::Point { x, y } => Ok(ConnectorEnd::Point { x: *x, y: *y }),
                }
            };
            let start = resolve(c.from.as_ref().unwrap())?;
            let end = resolve(c.to.as_ref().unwrap())?;
            let props = ConnectorProps {
                start,
                end,
                routing: c.routing.unwrap_or(ConnectorRouting::Straight),
                start_head: c.start_head.unwrap_or(ConnectorHead::None),
                end_head: c.end_head.unwrap_or(ConnectorHead::Arrow),
                color: c.color.clone().unwrap_or_else(|| "#334155".into()),
                stroke_width: c.stroke_width.unwrap_or(2.0),
                line_style: LineStyle::Solid,
                label: c.label.as_deref().map(plain_to_rich_text),
                waypoints: None,
            };
            let id = self.next_id("tpl");
            let order_key = self.next_order_key();
            self.key_to_obj_id.insert(c.key.clone(), id.clone());
            self.created_objects.push(BoardObject {
                id,
                page_id: self.page_id.to_string(),
                kind: ObjectKind::Connector,
                order_key,
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 0.0,
                rotation: 0.0,
                group_id: None,
                props: serde_json::to_value(props).unwrap(),
                extra: Map::new(),
            });
        }
        Ok(())
    }
}

/// Validates and applies a declarative `TemplateDocument` to `doc` atomically.
pub fn apply_template(
    doc: &BoardDocument,
    template_val: &Value,
    active_page_id: Option<&str>,
) -> Result<TemplateApplyResult, EditError> {
    let tpl: TemplateDocument = serde_json::from_value(template_val.clone())
        .map_err(|e| tpl_err(format!("invalid template JSON: {e}")))?;

    if tpl.schema_version != 1 {
        return Err(tpl_err(format!(
            "unsupported template schemaVersion {}",
            tpl.schema_version
        )));
    }
    if tpl.pages.is_empty() {
        return Err(tpl_err("template must contain at least one page"));
    }

    let mut page_keys = HashSet::new();
    let mut expanded_pages = Vec::with_capacity(tpl.pages.len());
    let mut total_blocks = 0usize;

    for page in &tpl.pages {
        if page.key.trim().is_empty() || !page_keys.insert(page.key.clone()) {
            return Err(tpl_err(format!("invalid or duplicate template page key '{}'", page.key)));
        }
        let expanded_blocks = expand_repeats(&page.blocks, 0, &mut total_blocks)?;
        let mut keys = HashSet::new();
        collect_keys(&expanded_blocks, &mut keys)?;
        validate_block_refs(&expanded_blocks, &keys, doc)?;
        expanded_pages.push((page, expanded_blocks));
    }

    let mut working = doc.clone();
    if let Some(ref title) = tpl.title {
        if working.title.is_empty() {
            working.title = title.clone();
        }
    }

    let mut used_ids: HashSet<String> = working
        .pages
        .iter()
        .map(|p| p.id.clone())
        .chain(working.objects.iter().map(|o| o.id.clone()))
        .collect();
    let mut created_page_ids = Vec::new();
    let mut created_object_ids = Vec::new();

    for (idx, (tpage, blocks)) in expanded_pages.into_iter().enumerate() {
        let use_current = idx == 0 && tpl.target == TemplateTarget::CurrentPage;
        let (page_id, page_w, page_h, start_y) = if use_current {
            let pid = active_page_id
                .and_then(|id| working.pages.iter().find(|p| p.id == id))
                .or_else(|| working.pages.first())
                .map(|p| p.id.clone())
                .ok_or_else(|| EditError::new(EditErrorCode::PageNotFound, "no target page"))?;
            let is_empty = !working.objects.iter().any(|o| o.page_id == pid);
            if is_empty {
                let defaults = tpl.page_defaults.as_ref();
                let p = working.pages.iter_mut().find(|p| p.id == pid).unwrap();
                if let Some(ref title) = tpage.title {
                    p.title = title.clone();
                }
                if let Some(fmt_spec) = tpage.format.or_else(|| defaults.and_then(|d| d.format)) {
                    let fmt = PageFormat::from(fmt_spec);
                    let (def_w, def_h) = fmt.default_size();
                    p.format = fmt;
                    p.width = tpage
                        .width
                        .or_else(|| defaults.and_then(|d| d.width))
                        .unwrap_or(def_w);
                    p.height = tpage
                        .height
                        .or_else(|| defaults.and_then(|d| d.height))
                        .unwrap_or(def_h);
                } else {
                    if let Some(w) = tpage.width.or_else(|| defaults.and_then(|d| d.width)) {
                        p.width = w;
                    }
                    if let Some(h) = tpage.height.or_else(|| defaults.and_then(|d| d.height)) {
                        p.height = h;
                    }
                }
                if let Some(bg) = tpage
                    .background
                    .clone()
                    .or_else(|| defaults.and_then(|d| d.background.clone()))
                {
                    p.background = bg;
                }
            }
            let p = working.pages.iter().find(|p| p.id == pid).unwrap();
            let bottom = working
                .objects
                .iter()
                .filter(|o| o.page_id == pid)
                .map(|o| o.y + o.height)
                .fold(0.0_f64, f64::max);
            let sy = if bottom > 0.0 {
                bottom + DEFAULT_PADDING
            } else {
                DEFAULT_PADDING
            };
            (pid, p.width, p.height, sy)
        } else {
            let defaults = tpl.page_defaults.as_ref();
            let fmt = tpage
                .format
                .or_else(|| defaults.and_then(|d| d.format))
                .map(PageFormat::from)
                .unwrap_or(PageFormat::Freeform);
            let (def_w, def_h) = fmt.default_size();
            let w = tpage
                .width
                .or_else(|| defaults.and_then(|d| d.width))
                .unwrap_or(def_w);
            let h = tpage
                .height
                .or_else(|| defaults.and_then(|d| d.height))
                .unwrap_or(def_h);
            let bg = tpage
                .background
                .clone()
                .or_else(|| defaults.and_then(|d| d.background.clone()))
                .unwrap_or(PageBackground::Solid {
                    color: DEFAULT_PAPER_COLOR.to_string(),
                });
            let mut n = 1usize;
            let pid = loop {
                let c = format!("page-{n}");
                if used_ids.insert(c.clone()) {
                    break c;
                }
                n += 1;
            };
            let order_key = match working.pages.last() {
                Some(last) => order_between(Some(&last.order_key), None),
                None => initial_order_key(),
            };
            working.pages.push(Page {
                id: pid.clone(),
                title: tpage.title.clone().unwrap_or_default(),
                order_key,
                format: fmt,
                width: w,
                height: h,
                background: bg,
                extra: Map::new(),
            });
            created_page_ids.push(pid.clone());
            (pid, w, h, DEFAULT_PADDING)
        };

        let existing_last_order = working
            .objects
            .iter()
            .filter(|o| o.page_id == page_id)
            .map(|o| o.order_key.clone())
            .max();

        let mut ctx = LayoutCtx {
            page_id: &page_id,
            used_ids: &mut used_ids,
            key_to_obj_id: HashMap::new(),
            created_objects: Vec::new(),
            pending_connectors: Vec::new(),
            last_order_key: existing_last_order,
        };

        let content_w = (page_w - DEFAULT_PADDING * 2.0).max(320.0);
        let content_h = (page_h - DEFAULT_PADDING * 2.0).max(240.0);
        let mut cursor_y = start_y;
        for b in &blocks {
            if b.block_type == "connector" {
                ctx.pending_connectors.push(b.clone());
            } else if b.frame.is_some() {
                ctx.layout_block(b, DEFAULT_PADDING, cursor_y, content_w, content_h)?;
            } else {
                let (_, uh) = ctx.layout_block(b, DEFAULT_PADDING, cursor_y, content_w, content_h)?;
                cursor_y += uh + DEFAULT_GAP;
            }
        }
        ctx.flush_connectors()?;
        for obj in ctx.created_objects {
            created_object_ids.push(obj.id.clone());
            working.objects.push(obj);
        }
    }

    validate_board(&working).map_err(|e| tpl_err(e.message))?;

    Ok(TemplateApplyResult {
        doc: working,
        created_page_ids,
        created_object_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::create_new_board;
    use serde_json::json;

    #[test]
    fn lays_out_stack_grid_repeat_and_connector() {
        let board = create_new_board("b1".into(), "p1".into(), "".into());
        let tpl = json!({
            "schemaVersion": 1,
            "title": "Sprint Retro",
            "target": "current_page",
            "pages": [{
                "key": "retro",
                "blocks": [
                    { "type": "title", "key": "hdr", "text": "Sprint 14 Retrospective" },
                    {
                        "type": "grid",
                        "key": "cols",
                        "columns": 2,
                        "gap": 24,
                        "children": [
                            { "type": "card", "key": "went_well", "title": "Went Well", "body": "Fast reviews" },
                            { "type": "card", "key": "improve", "title": "Improve", "body": "More tests" }
                        ]
                    },
                    { "type": "sticky", "key": "action", "text": "Action item", "repeat": { "count": 2 } },
                    { "type": "connector", "key": "link1", "from": "went_well", "to": "improve", "label": "next" }
                ]
            }]
        });

        let res = apply_template(&board, &tpl, Some("p1")).unwrap();
        assert!(res.created_page_ids.is_empty());
        // hdr + 2 cards + 2 repeated stickies + 1 connector = 6 objects
        assert_eq!(res.created_object_ids.len(), 6);
        assert_eq!(res.doc.title, "Sprint Retro");
        assert!(validate_board(&res.doc).is_ok());
    }

    #[test]
    fn rejects_invalid_connector_key_or_duplicate_keys() {
        let board = create_new_board("b1".into(), "p1".into(), "".into());
        let bad_ref = json!({
            "schemaVersion": 1,
            "pages": [{
                "key": "p",
                "blocks": [
                    { "type": "sticky", "key": "a", "text": "A" },
                    { "type": "connector", "key": "c", "from": "a", "to": "nonexistent" }
                ]
            }]
        });
        let err = apply_template(&board, &bad_ref, Some("p1")).unwrap_err();
        assert_eq!(err.code, EditErrorCode::InvalidTemplate);

        let dup_key = json!({
            "schemaVersion": 1,
            "pages": [{
                "key": "p",
                "blocks": [
                    { "type": "sticky", "key": "same", "text": "1" },
                    { "type": "sticky", "key": "same", "text": "2" }
                ]
            }]
        });
        let err2 = apply_template(&board, &dup_key, Some("p1")).unwrap_err();
        assert_eq!(err2.code, EditErrorCode::InvalidTemplate);
    }

    #[test]
    fn current_page_applies_page_properties_when_empty_and_preserves_when_non_empty() {
        let board = create_new_board("b1".into(), "p1".into(), "".into());
        let tpl = json!({
            "schemaVersion": 1,
            "target": "current_page",
            "pages": [{
                "key": "cover",
                "title": "Kickoff Deck",
                "format": "wide_16_9",
                "background": { "kind": "grid", "color": "#F8FAFC", "pattern": "dot" },
                "blocks": [
                    { "type": "title", "key": "t1", "text": "Hello" }
                ]
            }]
        });

        let res = apply_template(&board, &tpl, Some("p1")).unwrap();
        assert_eq!(res.doc.pages.len(), 1);
        assert_eq!(res.doc.pages[0].title, "Kickoff Deck");
        assert_eq!(res.doc.pages[0].format, PageFormat::Wide169);
        assert_eq!(res.doc.pages[0].width, 1920.0);
        assert_eq!(res.doc.pages[0].height, 1080.0);

        // Applying another current_page template onto a non-empty page preserves existing page properties.
        let tpl2 = json!({
            "schemaVersion": 1,
            "target": "current_page",
            "pages": [{
                "key": "append",
                "title": "Should Not Overwrite",
                "format": "a4_portrait",
                "blocks": [
                    { "type": "sticky", "key": "s2", "text": "More" }
                ]
            }]
        });
        let res2 = apply_template(&res.doc, &tpl2, Some("p1")).unwrap();
        assert_eq!(res2.doc.pages[0].title, "Kickoff Deck");
        assert_eq!(res2.doc.pages[0].format, PageFormat::Wide169);
    }
}
