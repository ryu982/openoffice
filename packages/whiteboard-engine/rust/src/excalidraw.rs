//! Excalidraw importer (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`) -> `.whiteboard`.
//! Pure memory-only conversion (zero network requests, zero temp files).

use crate::error::{OpenError, OpenErrorCode};
use crate::excalidraw_extract::extract_excalidraw_json;
use crate::model::{
    BoardObject, ConnectorEnd, ConnectorHead, ConnectorProps, ConnectorRouting,
    DEFAULT_PAPER_COLOR, ImageProps, LineStyle, ObjectKind, PageBackground, ShapeKind, ShapeProps,
    StrokeProps, StrokeTool, TextProps, create_new_board,
};
use crate::ordering::order_keys_between;
use crate::rich_text::{TextAlign, plain_to_rich_text};
use crate::zip_io::WhiteboardArchive;
use base64::Engine;
use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone)]
pub struct ExcalidrawImportResult {
    pub archive: WhiteboardArchive,
    pub skipped_count: usize,
    pub skipped_by_kind: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcalidrawImportSummary {
    pub imported_count: usize,
    pub skipped_count: usize,
    pub skipped_by_kind: BTreeMap<String, usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExcalidrawScene {
    #[serde(rename = "type")]
    scene_type: Option<String>,
    elements: Option<Vec<Value>>,
    #[serde(default)]
    files: HashMap<String, ExcalidrawFile>,
    #[serde(default)]
    app_state: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExcalidrawFile {
    #[serde(rename = "dataURL")]
    data_url: Option<String>,
}

fn str_field<'a>(m: &'a Map<String, Value>, k: &str) -> Option<&'a str> {
    m.get(k).and_then(Value::as_str)
}

fn f64_field(m: &Map<String, Value>, k: &str, default: f64) -> f64 {
    m.get(k)
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
        .unwrap_or(default)
}

fn map_line_style(stroke_style: Option<&str>) -> LineStyle {
    match stroke_style {
        Some("dashed") => LineStyle::Dashed,
        Some("dotted") => LineStyle::Dotted,
        _ => LineStyle::Solid,
    }
}

fn map_arrowhead(head: Option<&str>) -> ConnectorHead {
    match head {
        None | Some("none") => ConnectorHead::None,
        Some("triangle") | Some("triangle_outline") => ConnectorHead::Triangle,
        Some("dot") | Some("circle") | Some("circle_outline") => ConnectorHead::Circle,
        _ => ConnectorHead::Arrow,
    }
}

fn map_align(align: Option<&str>) -> Option<TextAlign> {
    match align {
        Some("center") => Some(TextAlign::Center),
        Some("right") => Some(TextAlign::Right),
        Some("left") => Some(TextAlign::Left),
        _ => None,
    }
}

fn decode_data_url_bytes(data_url: &str) -> Option<Vec<u8>> {
    let rest = data_url.strip_prefix("data:")?;
    let (meta, payload) = rest.split_once(',')?;
    if !meta.to_ascii_lowercase().contains(";base64") {
        return None;
    }
    let clean: String = payload.chars().filter(|c| !c.is_whitespace()).collect();
    STANDARD
        .decode(&clean)
        .or_else(|_| STANDARD_NO_PAD.decode(&clean))
        .ok()
}

fn map_binding_end(
    binding: Option<&Value>,
    fallback_x: f64,
    fallback_y: f64,
    id_map: &HashMap<String, String>,
) -> ConnectorEnd {
    if let Some(b) = binding.and_then(Value::as_object) {
        if let Some(target_raw) = b.get("elementId").and_then(Value::as_str) {
            if let Some(mapped_id) = id_map.get(target_raw) {
                return ConnectorEnd::Anchor {
                    object_id: mapped_id.clone(),
                    anchor_x: None,
                    anchor_y: None,
                };
            }
        }
    }
    ConnectorEnd::Point {
        x: fallback_x,
        y: fallback_y,
    }
}

/// Imports an Excalidraw file (`.excalidraw`, `.excalidraw.png`, or `.excalidraw.svg`)
/// into a single-page `freeform` `.whiteboard` archive.
pub fn import_excalidraw(
    bytes: &[u8],
    filename_hint: Option<&str>,
    board_id: String,
    page_id: String,
    title: String,
) -> Result<ExcalidrawImportResult, OpenError> {
    let scene_json = extract_excalidraw_json(bytes, filename_hint)?;
    let scene: ExcalidrawScene = serde_json::from_str(&scene_json).map_err(|e| {
        OpenError::new(
            OpenErrorCode::InvalidExcalidraw,
            format!("invalid Excalidraw JSON: {e}"),
        )
    })?;

    if let Some(ref st) = scene.scene_type {
        if st != "excalidraw" {
            return Err(OpenError::new(
                OpenErrorCode::InvalidExcalidraw,
                format!("unexpected Excalidraw scene type '{st}'"),
            ));
        }
    }
    let elements = scene.elements.ok_or_else(|| {
        OpenError::new(
            OpenErrorCode::InvalidExcalidraw,
            "Excalidraw scene missing 'elements' array",
        )
    })?;

    let mut doc = create_new_board(board_id, page_id.clone(), title);
    if let Some(bg) = scene
        .app_state
        .as_ref()
        .and_then(|s| s.get("viewBackgroundColor"))
        .and_then(Value::as_str)
    {
        if !bg.trim().is_empty() && bg != "transparent" {
            doc.pages[0].background = PageBackground::Solid {
                color: bg.to_string(),
            };
        }
    } else {
        doc.pages[0].background = PageBackground::Solid {
            color: DEFAULT_PAPER_COLOR.to_string(),
        };
    }

    let mut archive = WhiteboardArchive::from_new(doc)?;
    let mut skipped_by_kind: BTreeMap<String, usize> = BTreeMap::new();
    let mut skipped_count = 0usize;

    // Collect non-deleted elements and index container-bound texts first.
    let mut live_elements: Vec<&Map<String, Value>> = Vec::new();
    let mut bound_text: HashMap<String, (String, Option<f64>, Option<TextAlign>)> = HashMap::new();
    let mut live_ids: HashMap<String, String> = HashMap::new();

    for el_val in &elements {
        let Some(m) = el_val.as_object() else {
            continue;
        };
        if m.get("isDeleted").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let el_type = str_field(m, "type").unwrap_or("unknown");
        let raw_id = str_field(m, "id")
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("ex-{}", live_elements.len() + 1));

        if el_type == "text" {
            if let Some(cid) = str_field(m, "containerId").filter(|s| !s.is_empty()) {
                let txt = str_field(m, "text").unwrap_or("").to_string();
                let fs = m.get("fontSize").and_then(Value::as_f64);
                let al = map_align(str_field(m, "textAlign"));
                bound_text.insert(cid.to_string(), (txt, fs, al));
                continue;
            }
        }
        live_ids.insert(raw_id.clone(), format!("ex-{raw_id}"));
        live_elements.push(m);
    }

    let mut created: Vec<BoardObject> = Vec::new();
    let mut pending_connectors: Vec<&Map<String, Value>> = Vec::new();
    let mut res_counter = 0usize;
    let mut emitted_id_map: HashMap<String, String> = HashMap::new();

    for (idx, m) in live_elements.iter().enumerate() {
        let el_type = str_field(m, "type").unwrap_or("unknown");
        let raw_id = str_field(m, "id")
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("anon-{idx}"));
        let mapped_id = live_ids
            .get(&raw_id)
            .cloned()
            .unwrap_or_else(|| format!("ex-{idx}"));
        let x = f64_field(m, "x", 0.0);
        let y = f64_field(m, "y", 0.0);
        let w = f64_field(m, "width", 120.0).abs().max(1.0);
        let h = f64_field(m, "height", 80.0).abs().max(1.0);
        let rotation = f64_field(m, "angle", 0.0).to_degrees();
        let group_id = m
            .get("groupIds")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .and_then(Value::as_str)
            .map(|g| format!("ex-grp-{g}"));

        match el_type {
            "rectangle" | "diamond" | "ellipse" => {
                let shape = match el_type {
                    "diamond" => ShapeKind::Diamond,
                    "ellipse" => ShapeKind::Ellipse,
                    _ => {
                        if m.get("roundness").is_some_and(|v| !v.is_null()) {
                            ShapeKind::RoundedRectangle
                        } else {
                            ShapeKind::Rectangle
                        }
                    }
                };
                let (txt, fs, al) = bound_text
                    .get(&raw_id)
                    .cloned()
                    .unwrap_or_else(|| (String::new(), None, None));
                let fill = str_field(m, "backgroundColor")
                    .unwrap_or("transparent")
                    .to_string();
                let stroke = str_field(m, "strokeColor")
                    .unwrap_or("#1E293B")
                    .to_string();
                let stroke_width = f64_field(m, "strokeWidth", 2.0).max(0.5);
                let props = ShapeProps {
                    shape,
                    fill,
                    stroke,
                    stroke_width,
                    line_style: Some(map_line_style(str_field(m, "strokeStyle"))),
                    text: plain_to_rich_text(&txt),
                    font_size: fs,
                    align: al,
                };
                emitted_id_map.insert(raw_id, mapped_id.clone());
                created.push(BoardObject {
                    id: mapped_id,
                    page_id: page_id.clone(),
                    kind: ObjectKind::Shape,
                    order_key: String::new(),
                    x,
                    y,
                    width: w,
                    height: h,
                    rotation,
                    group_id,
                    props: serde_json::to_value(props).unwrap(),
                    extra: Map::new(),
                });
            }
            "text" => {
                let txt = str_field(m, "text").unwrap_or("");
                let props = TextProps {
                    text: plain_to_rich_text(txt),
                    font_size: m.get("fontSize").and_then(Value::as_f64),
                    color: str_field(m, "strokeColor").map(ToOwned::to_owned),
                    align: map_align(str_field(m, "textAlign")),
                    background: None,
                    border_color: None,
                };
                emitted_id_map.insert(raw_id, mapped_id.clone());
                created.push(BoardObject {
                    id: mapped_id,
                    page_id: page_id.clone(),
                    kind: ObjectKind::Text,
                    order_key: String::new(),
                    x,
                    y,
                    width: w,
                    height: h,
                    rotation,
                    group_id,
                    props: serde_json::to_value(props).unwrap(),
                    extra: Map::new(),
                });
            }
            "arrow" | "line" => {
                pending_connectors.push(*m);
            }
            "freedraw" => {
                let pts_arr = m
                    .get("points")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let pressures = m.get("pressures").and_then(Value::as_array);
                let mut points = Vec::with_capacity(pts_arr.len());
                for (pi, pt) in pts_arr.iter().enumerate() {
                    if let Some(pair) = pt.as_array() {
                        if pair.len() >= 2 {
                            let px = pair[0].as_f64().unwrap_or(0.0);
                            let py = pair[1].as_f64().unwrap_or(0.0);
                            let pr = pressures
                                .and_then(|arr| arr.get(pi))
                                .and_then(Value::as_f64)
                                .unwrap_or(0.5);
                            points.push([px, py, pr]);
                        }
                    }
                }
                if points.is_empty() {
                    skipped_count += 1;
                    *skipped_by_kind.entry("freedraw".into()).or_insert(0) += 1;
                    continue;
                }
                let props = StrokeProps {
                    tool: StrokeTool::Pen,
                    color: str_field(m, "strokeColor")
                        .unwrap_or("#1E293B")
                        .to_string(),
                    width: f64_field(m, "strokeWidth", 2.0).max(1.0),
                    opacity: (f64_field(m, "opacity", 100.0) / 100.0).clamp(0.05, 1.0),
                    points,
                };
                emitted_id_map.insert(raw_id, mapped_id.clone());
                created.push(BoardObject {
                    id: mapped_id,
                    page_id: page_id.clone(),
                    kind: ObjectKind::Stroke,
                    order_key: String::new(),
                    x,
                    y,
                    width: w,
                    height: h,
                    rotation,
                    group_id,
                    props: serde_json::to_value(props).unwrap(),
                    extra: Map::new(),
                });
            }
            "image" => {
                let file_id = str_field(m, "fileId");
                let decoded = file_id
                    .and_then(|fid| scene.files.get(fid))
                    .and_then(|f| f.data_url.as_deref())
                    .and_then(decode_data_url_bytes);
                let Some(img_bytes) = decoded else {
                    skipped_count += 1;
                    *skipped_by_kind.entry("image".into()).or_insert(0) += 1;
                    continue;
                };
                res_counter += 1;
                let res_id = format!("ex-img-{res_counter}");
                if archive.add_image_resource(res_id.clone(), img_bytes).is_err() {
                    skipped_count += 1;
                    *skipped_by_kind.entry("image".into()).or_insert(0) += 1;
                    continue;
                }
                let props = ImageProps {
                    resource_id: res_id,
                    alt: None,
                };
                emitted_id_map.insert(raw_id, mapped_id.clone());
                created.push(BoardObject {
                    id: mapped_id,
                    page_id: page_id.clone(),
                    kind: ObjectKind::Image,
                    order_key: String::new(),
                    x,
                    y,
                    width: w,
                    height: h,
                    rotation,
                    group_id,
                    props: serde_json::to_value(props).unwrap(),
                    extra: Map::new(),
                });
            }
            "frame" => {
                let frame_props = ShapeProps {
                    shape: ShapeKind::Rectangle,
                    fill: "transparent".into(),
                    stroke: "#94A3B8".into(),
                    stroke_width: 1.5,
                    line_style: Some(LineStyle::Dashed),
                    text: plain_to_rich_text(""),
                    font_size: None,
                    align: None,
                };
                emitted_id_map.insert(raw_id.clone(), mapped_id.clone());
                created.push(BoardObject {
                    id: mapped_id.clone(),
                    page_id: page_id.clone(),
                    kind: ObjectKind::Shape,
                    order_key: String::new(),
                    x,
                    y,
                    width: w,
                    height: h,
                    rotation: 0.0,
                    group_id: group_id.clone(),
                    props: serde_json::to_value(frame_props).unwrap(),
                    extra: Map::new(),
                });
                if let Some(name) = str_field(m, "name").filter(|s| !s.trim().is_empty()) {
                    let lbl_props = TextProps {
                        text: plain_to_rich_text(name),
                        font_size: Some(14.0),
                        color: Some("#475569".into()),
                        align: Some(TextAlign::Left),
                        background: None,
                        border_color: None,
                    };
                    created.push(BoardObject {
                        id: format!("{mapped_id}-title"),
                        page_id: page_id.clone(),
                        kind: ObjectKind::Text,
                        order_key: String::new(),
                        x,
                        y: (y - 26.0),
                        width: w.min(320.0).max(120.0),
                        height: 24.0,
                        rotation: 0.0,
                        group_id,
                        props: serde_json::to_value(lbl_props).unwrap(),
                        extra: Map::new(),
                    });
                }
            }
            other => {
                skipped_count += 1;
                *skipped_by_kind.entry(other.to_string()).or_insert(0) += 1;
            }
        }
    }

    // Second pass: connectors (arrows & lines), resolving bindings to emitted shape IDs.
    for (ci, m) in pending_connectors.iter().enumerate() {
        let el_type = str_field(m, "type").unwrap_or("arrow");
        let raw_id = str_field(m, "id")
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("conn-{ci}"));
        let mapped_id = live_ids
            .get(&raw_id)
            .cloned()
            .unwrap_or_else(|| format!("ex-conn-{ci}"));
        let x = f64_field(m, "x", 0.0);
        let y = f64_field(m, "y", 0.0);
        let pts_arr = m
            .get("points")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let abs_pts: Vec<(f64, f64)> = pts_arr
            .iter()
            .filter_map(|p| {
                let arr = p.as_array()?;
                if arr.len() >= 2 {
                    Some((x + arr[0].as_f64()?, y + arr[1].as_f64()?))
                } else {
                    None
                }
            })
            .collect();
        let (sx, sy) = abs_pts.first().copied().unwrap_or((x, y));
        let (ex, ey) = abs_pts
            .last()
            .copied()
            .unwrap_or((x + f64_field(m, "width", 100.0), y + f64_field(m, "height", 0.0)));

        let start = map_binding_end(m.get("startBinding"), sx, sy, &emitted_id_map);
        let end = map_binding_end(m.get("endBinding"), ex, ey, &emitted_id_map);
        let waypoints = if abs_pts.len() > 2 {
            Some(
                abs_pts[1..abs_pts.len() - 1]
                    .iter()
                    .map(|(px, py)| crate::model::Point { x: *px, y: *py })
                    .collect(),
            )
        } else {
            None
        };
        let default_end_head = if el_type == "arrow" {
            ConnectorHead::Arrow
        } else {
            ConnectorHead::None
        };
        let end_head = if m.contains_key("endArrowhead") {
            map_arrowhead(str_field(m, "endArrowhead"))
        } else {
            default_end_head
        };
        let start_head = map_arrowhead(str_field(m, "startArrowhead"));
        let label = bound_text.get(&raw_id).map(|(t, _, _)| plain_to_rich_text(t));
        let props = ConnectorProps {
            start,
            end,
            routing: if m.get("elbowed").and_then(Value::as_bool) == Some(true) {
                ConnectorRouting::Elbow
            } else if m.get("roundness").is_some_and(|v| !v.is_null()) && abs_pts.len() > 2 {
                ConnectorRouting::Curved
            } else {
                ConnectorRouting::Straight
            },
            start_head,
            end_head,
            color: str_field(m, "strokeColor")
                .unwrap_or("#1E293B")
                .to_string(),
            stroke_width: f64_field(m, "strokeWidth", 2.0).max(0.5),
            line_style: map_line_style(str_field(m, "strokeStyle")),
            label,
            waypoints,
        };
        created.push(BoardObject {
            id: mapped_id,
            page_id: page_id.clone(),
            kind: ObjectKind::Connector,
            order_key: String::new(),
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
            rotation: 0.0,
            group_id: m
                .get("groupIds")
                .and_then(Value::as_array)
                .and_then(|arr| arr.first())
                .and_then(Value::as_str)
                .map(|g| format!("ex-grp-{g}")),
            props: serde_json::to_value(props).unwrap(),
            extra: Map::new(),
        });
    }

    let order_keys = order_keys_between(None, None, created.len());
    for (obj, key) in created.iter_mut().zip(order_keys) {
        obj.order_key = key;
    }
    archive.doc.objects = created;

    Ok(ExcalidrawImportResult {
        archive,
        skipped_count,
        skipped_by_kind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::Compression;
    use flate2::write::ZlibEncoder;
    use serde_json::json;
    use std::io::Write;

    const TINY_PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    fn make_png_with_chunk(chunk_type: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = TINY_PNG[..33].to_vec(); // sig + IHDR
        out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        out.extend_from_slice(chunk_type);
        out.extend_from_slice(payload);
        out.extend_from_slice(&0u32.to_be_bytes()); // dummy CRC (extractor doesn't require CRC)
        out.extend_from_slice(&TINY_PNG[33..]); // IEND
        out
    }

    fn sample_scene() -> Value {
        let img_b64 = STANDARD.encode(TINY_PNG);
        json!({
            "type": "excalidraw",
            "version": 2,
            "elements": [
                { "id": "r1", "type": "rectangle", "x": 10, "y": 20, "width": 200, "height": 100, "roundness": { "type": 3 }, "backgroundColor": "#DBEAFE", "strokeColor": "#1D4ED8", "groupIds": ["g1"] },
                { "id": "t1", "type": "text", "containerId": "r1", "x": 20, "y": 40, "width": 160, "height": 30, "text": "Box Label" },
                { "id": "e1", "type": "ellipse", "x": 300, "y": 20, "width": 140, "height": 100 },
                { "id": "a1", "type": "arrow", "x": 210, "y": 70, "points": [[0, 0], [90, 0]], "startBinding": { "elementId": "r1" }, "endBinding": { "elementId": "e1" }, "endArrowhead": "arrow" },
                { "id": "f1", "type": "freedraw", "x": 10, "y": 200, "width": 50, "height": 20, "points": [[0, 0], [20, 10], [50, 20]] },
                { "id": "i1", "type": "image", "x": 10, "y": 250, "width": 40, "height": 40, "fileId": "file-1" },
                { "id": "fr1", "type": "frame", "x": 0, "y": 0, "width": 500, "height": 350, "name": "Group Frame" },
                { "id": "u1", "type": "embeddable", "x": 0, "y": 0, "width": 100, "height": 100 },
                { "id": "u2", "type": "iframe", "x": 0, "y": 0, "width": 100, "height": 100 },
                { "id": "del1", "type": "rectangle", "isDeleted": true, "x": 0, "y": 0, "width": 50, "height": 50 }
            ],
            "files": {
                "file-1": { "dataURL": format!("data:image/png;base64,{img_b64}") }
            },
            "appState": { "viewBackgroundColor": "#FFFBEB" }
        })
    }

    #[test]
    fn imports_raw_excalidraw_and_counts_skipped() {
        let raw = serde_json::to_vec(&sample_scene()).unwrap();
        let res = import_excalidraw(&raw, Some("demo.excalidraw"), "b1".into(), "p1".into(), "Demo".into()).unwrap();
        assert_eq!(res.skipped_count, 2);
        assert_eq!(res.skipped_by_kind.get("embeddable"), Some(&1));
        assert_eq!(res.skipped_by_kind.get("iframe"), Some(&1));
        assert_eq!(res.archive.doc.resources.len(), 1);
        // r1 + e1 + f1 + i1 + frame + frame-title + a1 = 7 objects (t1 merged into r1, del1 ignored)
        assert_eq!(res.archive.doc.objects.len(), 7);
        let saved = res.archive.save().unwrap();
        assert!(WhiteboardArchive::open(&saved).is_ok());
    }

    #[test]
    fn imports_excalidraw_png_v2_compressed_and_rejects_plain_png() {
        let plain_err = import_excalidraw(TINY_PNG, Some("plain.excalidraw.png"), "b1".into(), "p1".into(), "".into()).unwrap_err();
        assert_eq!(plain_err.code, OpenErrorCode::NoExcalidrawScene);

        // Build Excalidraw v2 compressed bstring JSON inside PNG tEXt chunk.
        let scene_str = serde_json::to_string(&sample_scene()).unwrap();
        let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
        enc.write_all(scene_str.as_bytes()).unwrap();
        let compressed = enc.finish().unwrap();
        let bstring: String = compressed.iter().map(|&b| char::from(b)).collect();
        let wrapper = serde_json::to_string(&json!({
            "version": "2",
            "encoding": "bstring",
            "compressed": true,
            "encoded": bstring
        }))
        .unwrap();
        let mut chunk = b"application/vnd.excalidraw+json\0".to_vec();
        chunk.extend_from_slice(wrapper.as_bytes());
        let png = make_png_with_chunk(b"tEXt", &chunk);

        let res = import_excalidraw(&png, Some("scene.excalidraw.png"), "b1".into(), "p1".into(), "".into()).unwrap();
        assert_eq!(res.skipped_count, 2);
        assert_eq!(res.archive.doc.objects.len(), 7);
    }

    #[test]
    fn imports_excalidraw_svg_and_rejects_plain_svg() {
        let plain_svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
        let err = import_excalidraw(plain_svg, Some("plain.excalidraw.svg"), "b1".into(), "p1".into(), "".into()).unwrap_err();
        assert_eq!(err.code, OpenErrorCode::NoExcalidrawScene);

        let scene_b64 = STANDARD.encode(serde_json::to_vec(&sample_scene()).unwrap());
        let svg = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\"><!-- payload-start -->{scene_b64}<!-- payload-end --></svg>"
        );
        let res = import_excalidraw(svg.as_bytes(), Some("scene.excalidraw.svg"), "b1".into(), "p1".into(), "".into()).unwrap();
        assert_eq!(res.skipped_count, 2);
        assert_eq!(res.archive.doc.objects.len(), 7);
    }
}
