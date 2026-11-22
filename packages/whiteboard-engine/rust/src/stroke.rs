//! Pure-Rust pressure-sensitive freehand stroke outline generator.
//! Produces deterministic SVG path `d` strings without JS library dependencies.

use crate::model::StrokeTool;
use std::fmt::Write;

/// Generates a filled SVG outline path `d` for a freehand stroke (`[x, y, pressure]`).
pub fn stroke_outline_svg_path(points: &[[f64; 3]], width: f64, tool: StrokeTool) -> String {
    if points.is_empty() || !width.is_finite() || width <= 0.0 {
        return String::new();
    }

    // Filter out consecutive duplicate points.
    let mut cleaned: Vec<[f64; 3]> = Vec::with_capacity(points.len());
    for &p in points {
        if !p[0].is_finite() || !p[1].is_finite() {
            continue;
        }
        let pressure = if p[2].is_finite() {
            p[2].clamp(0.05, 1.0)
        } else {
            0.5
        };
        if let Some(last) = cleaned.last() {
            let dx = p[0] - last[0];
            let dy = p[1] - last[1];
            if dx * dx + dy * dy < 1e-4 {
                continue;
            }
        }
        cleaned.push([p[0], p[1], pressure]);
    }
    if cleaned.is_empty() {
        return String::new();
    }

    let radius_at = |pressure: f64| -> f64 {
        match tool {
            StrokeTool::Highlighter => (width * 0.5).max(1.0),
            StrokeTool::Pen => {
                // Smooth thinning curve similar to perfect-freehand.
                let scale = 0.4 + 0.6 * pressure;
                (width * 0.5 * scale).max(0.5)
            }
        }
    };

    // Single dot: emit a circle path.
    if cleaned.len() == 1 {
        let [x, y, pr] = cleaned[0];
        let r = radius_at(pr);
        return format!(
            "M {:.2} {:.2} a {:.2} {:.2} 0 1 0 {:.2} 0 a {:.2} {:.2} 0 1 0 {:.2} 0 Z",
            x - r,
            y,
            r,
            r,
            r * 2.0,
            r,
            r,
            -r * 2.0
        );
    }

    // Smooth positions lightly with exponential streamline for natural hand feel.
    let mut smooth = Vec::with_capacity(cleaned.len());
    smooth.push(cleaned[0]);
    let streamline = 0.35;
    for &p in &cleaned[1..] {
        let prev = *smooth.last().unwrap();
        smooth.push([
            prev[0] + (p[0] - prev[0]) * (1.0 - streamline),
            prev[1] + (p[1] - prev[1]) * (1.0 - streamline),
            prev[2] + (p[2] - prev[2]) * 0.5,
        ]);
    }
    // Preserve exact endpoint.
    if let Some(last_raw) = cleaned.last() {
        if let Some(last_s) = smooth.last_mut() {
            last_s[0] = last_raw[0];
            last_s[1] = last_raw[1];
        }
    }

    let n = smooth.len();
    let mut left: Vec<(f64, f64)> = Vec::with_capacity(n);
    let mut right: Vec<(f64, f64)> = Vec::with_capacity(n);

    for i in 0..n {
        let (dx, dy) = if i == 0 {
            (smooth[1][0] - smooth[0][0], smooth[1][1] - smooth[0][1])
        } else if i == n - 1 {
            (
                smooth[n - 1][0] - smooth[n - 2][0],
                smooth[n - 1][1] - smooth[n - 2][1],
            )
        } else {
            (
                smooth[i + 1][0] - smooth[i - 1][0],
                smooth[i + 1][1] - smooth[i - 1][1],
            )
        };
        let len = (dx * dx + dy * dy).sqrt();
        let (nx, ny) = if len > 1e-6 {
            (-dy / len, dx / len)
        } else {
            (0.0, 1.0)
        };
        let r = radius_at(smooth[i][2]);
        left.push((smooth[i][0] + nx * r, smooth[i][1] + ny * r));
        right.push((smooth[i][0] - nx * r, smooth[i][1] - ny * r));
    }

    let mut poly = Vec::with_capacity(n * 2 + 4);
    poly.extend_from_slice(&left);
    for pt in right.into_iter().rev() {
        poly.push(pt);
    }

    if poly.len() < 3 {
        return String::new();
    }

    // Build closed quadratic-Bezier smoothed outline path.
    let mut d = String::with_capacity(poly.len() * 18);
    let mid = |a: (f64, f64), b: (f64, f64)| ((a.0 + b.0) * 0.5, (a.1 + b.1) * 0.5);
    let start = mid(poly[poly.len() - 1], poly[0]);
    let _ = write!(d, "M {:.2} {:.2}", start.0, start.1);
    for i in 0..poly.len() {
        let curr = poly[i];
        let next = poly[(i + 1) % poly.len()];
        let m = mid(curr, next);
        let _ = write!(d, " Q {:.2} {:.2} {:.2} {:.2}", curr.0, curr.1, m.0, m.1);
    }
    d.push_str(" Z");
    d
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_dot_and_multi_point_paths() {
        let dot = stroke_outline_svg_path(&[[10.0, 20.0, 0.5]], 4.0, StrokeTool::Pen);
        assert!(dot.starts_with("M ") && dot.ends_with(" Z"));

        let line = stroke_outline_svg_path(
            &[[0.0, 0.0, 0.3], [20.0, 10.0, 0.8], [50.0, 5.0, 0.5]],
            6.0,
            StrokeTool::Pen,
        );
        assert!(line.contains(" Q ") && line.ends_with(" Z"));
        assert!(stroke_outline_svg_path(&[], 4.0, StrokeTool::Pen).is_empty());
    }
}
