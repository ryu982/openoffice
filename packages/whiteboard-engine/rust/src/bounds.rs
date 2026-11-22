//! Page bounding-box calculation for export, printing, and AI page snapshots.

use crate::model::{
    BoardDocument, BoardObject, ConnectorEnd, ConnectorProps, DEFAULT_FREEFORM_HEIGHT,
    DEFAULT_FREEFORM_WIDTH, ObjectKind, PageFormat, StrokeProps,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const DEFAULT_FREEFORM_MARGIN: f64 = 48.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn rotated_rect_bounds(x: f64, y: f64, w: f64, h: f64, rotation_deg: f64) -> (f64, f64, f64, f64) {
    if rotation_deg.abs() < 1e-9 {
        return (x, y, x + w, y + h);
    }
    let cx = x + w * 0.5;
    let cy = y + h * 0.5;
    let rad = rotation_deg.to_radians();
    let cos = rad.cos();
    let sin = rad.sin();
    let corners = [
        (-w * 0.5, -h * 0.5),
        (w * 0.5, -h * 0.5),
        (w * 0.5, h * 0.5),
        (-w * 0.5, h * 0.5),
    ];
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for (dx, dy) in corners {
        let rx = cx + dx * cos - dy * sin;
        let ry = cy + dx * sin + dy * cos;
        min_x = min_x.min(rx);
        min_y = min_y.min(ry);
        max_x = max_x.max(rx);
        max_y = max_y.max(ry);
    }
    (min_x, min_y, max_x, max_y)
}

fn resolve_end(end: &ConnectorEnd, by_id: &HashMap<&str, &BoardObject>) -> Option<(f64, f64)> {
    match end {
        ConnectorEnd::Point { x, y } => Some((*x, *y)),
        ConnectorEnd::Anchor {
            object_id,
            anchor_x,
            anchor_y,
        } => {
            let target = by_id.get(object_id.as_str())?;
            let ax = anchor_x.unwrap_or(0.5);
            let ay = anchor_y.unwrap_or(0.5);
            Some((target.x + target.width * ax, target.y + target.height * ay))
        }
    }
}

fn object_extents(obj: &BoardObject, by_id: &HashMap<&str, &BoardObject>) -> (f64, f64, f64, f64) {
    match obj.kind {
        ObjectKind::Stroke => {
            if let Ok(p) = serde_json::from_value::<StrokeProps>(obj.props.clone()) {
                let pad = p.width.max(1.0) * 0.5;
                let mut min_x = f64::INFINITY;
                let mut min_y = f64::INFINITY;
                let mut max_x = f64::NEG_INFINITY;
                let mut max_y = f64::NEG_INFINITY;
                for pt in &p.points {
                    let px = obj.x + pt[0];
                    let py = obj.y + pt[1];
                    min_x = min_x.min(px - pad);
                    min_y = min_y.min(py - pad);
                    max_x = max_x.max(px + pad);
                    max_y = max_y.max(py + pad);
                }
                if min_x.is_finite() {
                    return (min_x, min_y, max_x, max_y);
                }
            }
            rotated_rect_bounds(obj.x, obj.y, obj.width, obj.height, obj.rotation)
        }
        ObjectKind::Connector => {
            if let Ok(p) = serde_json::from_value::<ConnectorProps>(obj.props.clone()) {
                let pad = (p.stroke_width.max(2.0) * 2.0).max(8.0);
                let mut pts = Vec::new();
                if let Some(a) = resolve_end(&p.start, by_id) {
                    pts.push(a);
                }
                if let Some(b) = resolve_end(&p.end, by_id) {
                    pts.push(b);
                }
                if let Some(wps) = &p.waypoints {
                    for wp in wps {
                        pts.push((wp.x, wp.y));
                    }
                }
                if !pts.is_empty() {
                    let mut min_x = f64::INFINITY;
                    let mut min_y = f64::INFINITY;
                    let mut max_x = f64::NEG_INFINITY;
                    let mut max_y = f64::NEG_INFINITY;
                    for (px, py) in pts {
                        min_x = min_x.min(px - pad);
                        min_y = min_y.min(py - pad);
                        max_x = max_x.max(px + pad);
                        max_y = max_y.max(py + pad);
                    }
                    return (min_x, min_y, max_x, max_y);
                }
            }
            rotated_rect_bounds(obj.x, obj.y, obj.width, obj.height, obj.rotation)
        }
        _ => rotated_rect_bounds(obj.x, obj.y, obj.width, obj.height, obj.rotation),
    }
}

/// Computes the export / print / AI-snapshot rectangle for a page.
/// - Fixed pages (`wide_16_9`, `a4_*`, `custom`): `{ 0, 0, page.width, page.height }`.
/// - Freeform pages: union bounding box of all page objects + `margin`, or default 1920x1080 home area when empty.
pub fn compute_page_bounds(doc: &BoardDocument, page_id: &str, margin: f64) -> Option<Rect> {
    let page = doc.pages.iter().find(|p| p.id == page_id)?;
    if page.format != PageFormat::Freeform {
        return Some(Rect {
            x: 0.0,
            y: 0.0,
            width: page.width,
            height: page.height,
        });
    }

    let page_objs: Vec<&BoardObject> = doc.objects.iter().filter(|o| o.page_id == page_id).collect();
    if page_objs.is_empty() {
        return Some(Rect {
            x: 0.0,
            y: 0.0,
            width: if page.width > 0.0 {
                page.width
            } else {
                DEFAULT_FREEFORM_WIDTH
            },
            height: if page.height > 0.0 {
                page.height
            } else {
                DEFAULT_FREEFORM_HEIGHT
            },
        });
    }

    let by_id: HashMap<&str, &BoardObject> = page_objs.iter().map(|o| (o.id.as_str(), *o)).collect();
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for obj in &page_objs {
        let (x0, y0, x1, y1) = object_extents(obj, &by_id);
        min_x = min_x.min(x0);
        min_y = min_y.min(y0);
        max_x = max_x.max(x1);
        max_y = max_y.max(y1);
    }
    let m = margin.max(0.0);
    Some(Rect {
        x: min_x - m,
        y: min_y - m,
        width: (max_x - min_x + 2.0 * m).max(1.0),
        height: (max_y - min_y + 2.0 * m).max(1.0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::create_new_board;
    use serde_json::{Map, json};

    #[test]
    fn empty_freeform_returns_home_area() {
        let board = create_new_board("b1".into(), "p1".into(), "".into());
        let rect = compute_page_bounds(&board, "p1", DEFAULT_FREEFORM_MARGIN).unwrap();
        assert_eq!(rect.x, 0.0);
        assert_eq!(rect.y, 0.0);
        assert_eq!(rect.width, 1920.0);
        assert_eq!(rect.height, 1080.0);
    }

    #[test]
    fn rotated_object_expands_freeform_bounds_with_margin() {
        let mut board = create_new_board("b1".into(), "p1".into(), "".into());
        board.objects.push(BoardObject {
            id: "o1".into(),
            page_id: "p1".into(),
            kind: ObjectKind::Sticky,
            order_key: "V".into(),
            x: 100.0,
            y: 100.0,
            width: 200.0,
            height: 100.0,
            rotation: 90.0,
            group_id: None,
            props: json!({ "color": "#FEF08A", "text": { "paragraphs": [] } }),
            extra: Map::new(),
        });
        // Center is (200, 150); rotated 90 deg -> x in [150, 250], y in [50, 250].
        let rect = compute_page_bounds(&board, "p1", 48.0).unwrap();
        assert!((rect.x - 102.0).abs() < 1e-6);
        assert!((rect.y - 2.0).abs() < 1e-6);
        assert!((rect.width - 196.0).abs() < 1e-6);
        assert!((rect.height - 296.0).abs() < 1e-6);
    }
}
