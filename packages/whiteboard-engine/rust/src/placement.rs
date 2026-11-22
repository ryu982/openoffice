//! Spatial placement helpers for AI / MCP / CLI board edits (`place_at`, `place_near`, `place_free`).

use crate::bounds::Rect;
use crate::model::{BoardDocument, DEFAULT_FREEFORM_HEIGHT, DEFAULT_FREEFORM_WIDTH, PageFormat};
use serde::{Deserialize, Serialize};

pub const DEFAULT_PLACEMENT_GAP: f64 = 24.0;
pub const DEFAULT_ORIGIN_MARGIN: f64 = 80.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum NearSide {
    #[default]
    Right,
    Below,
    Left,
    Above,
}

pub fn rects_overlap(a: Rect, b: Rect, gap: f64) -> bool {
    let g = gap.max(0.0);
    a.x < b.x + b.width + g
        && a.x + a.width + g > b.x
        && a.y < b.y + b.height + g
        && a.y + a.height + g > b.y
}

pub fn page_object_rects(doc: &BoardDocument, page_id: &str) -> Vec<Rect> {
    doc.objects
        .iter()
        .filter(|o| o.page_id == page_id)
        .map(|o| Rect {
            x: o.x,
            y: o.y,
            width: o.width.max(1.0),
            height: o.height.max(1.0),
        })
        .collect()
}

pub fn place_at(x: f64, y: f64) -> (f64, f64) {
    (x, y)
}

/// Places a `(width, height)` box adjacent to `anchor` on the requested side,
/// nudging outward if another object already occupies that spot.
pub fn place_near(
    existing: &[Rect],
    anchor: Rect,
    side: NearSide,
    width: f64,
    height: f64,
    gap: f64,
) -> (f64, f64) {
    let g = if gap > 0.0 { gap } else { DEFAULT_PLACEMENT_GAP };
    let (mut x, mut y, step_x, step_y) = match side {
        NearSide::Right => (anchor.x + anchor.width + g, anchor.y, 0.0, height + g),
        NearSide::Below => (anchor.x, anchor.y + anchor.height + g, width + g, 0.0),
        NearSide::Left => (anchor.x - width - g, anchor.y, 0.0, height + g),
        NearSide::Above => (anchor.x, anchor.y - height - g, width + g, 0.0),
    };

    for _ in 0..40 {
        let candidate = Rect {
            x,
            y,
            width,
            height,
        };
        if !existing.iter().any(|r| rects_overlap(candidate, *r, g * 0.5)) {
            return (x, y);
        }
        x += step_x;
        y += step_y;
    }
    (x, y)
}

/// Finds the first non-overlapping position on the page for a `(width, height)` object.
pub fn place_free(
    existing: &[Rect],
    width: f64,
    height: f64,
    page_format: PageFormat,
    page_width: f64,
    page_height: f64,
    gap: f64,
) -> (f64, f64) {
    let g = if gap > 0.0 { gap } else { DEFAULT_PLACEMENT_GAP };
    let bound_w = if page_format == PageFormat::Freeform {
        if page_width > 0.0 {
            page_width
        } else {
            DEFAULT_FREEFORM_WIDTH
        }
    } else {
        page_width.max(width + DEFAULT_ORIGIN_MARGIN * 2.0)
    };
    let bound_h = if page_format == PageFormat::Freeform {
        if page_height > 0.0 {
            page_height
        } else {
            DEFAULT_FREEFORM_HEIGHT
        }
    } else {
        page_height.max(height + DEFAULT_ORIGIN_MARGIN * 2.0)
    };

    let start_x = DEFAULT_ORIGIN_MARGIN;
    let start_y = DEFAULT_ORIGIN_MARGIN;
    let step_x = (width + g).max(40.0);
    let step_y = (height + g).max(40.0);
    let max_x = (bound_w - DEFAULT_ORIGIN_MARGIN - width).max(start_x);
    let max_y = (bound_h - DEFAULT_ORIGIN_MARGIN - height).max(start_y);

    // Scan rows inside the home/page area first.
    let mut y = start_y;
    while y <= max_y + 1e-6 {
        let mut x = start_x;
        while x <= max_x + 1e-6 {
            let candidate = Rect {
                x,
                y,
                width,
                height,
            };
            if !existing.iter().any(|r| rects_overlap(candidate, *r, g * 0.5)) {
                return (x, y);
            }
            x += step_x;
        }
        y += step_y;
    }

    // Overflow below the lowest existing object so freeform/busy pages never overlap.
    let bottom = existing
        .iter()
        .map(|r| r.y + r.height)
        .fold(start_y, f64::max);
    (start_x, bottom + g)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn place_free_skips_occupied_slots() {
        let occupied = vec![Rect {
            x: 80.0,
            y: 80.0,
            width: 240.0,
            height: 180.0,
        }];
        let (x, y) = place_free(
            &occupied,
            240.0,
            180.0,
            PageFormat::Freeform,
            1920.0,
            1080.0,
            24.0,
        );
        let placed = Rect {
            x,
            y,
            width: 240.0,
            height: 180.0,
        };
        assert!(!rects_overlap(placed, occupied[0], 10.0));
        assert_eq!(y, 80.0);
        assert!(x >= 344.0);
    }

    #[test]
    fn place_near_nudges_when_blocked() {
        let anchor = Rect {
            x: 100.0,
            y: 100.0,
            width: 200.0,
            height: 120.0,
        };
        let blocker = Rect {
            x: 324.0,
            y: 100.0,
            width: 200.0,
            height: 120.0,
        };
        let (x, y) = place_near(&[anchor, blocker], anchor, NearSide::Right, 200.0, 120.0, 24.0);
        let placed = Rect {
            x,
            y,
            width: 200.0,
            height: 120.0,
        };
        assert!(!rects_overlap(placed, blocker, 10.0));
        assert!(y > blocker.y + blocker.height);
    }
}
