//! Structured text table (`read_board_table`) for AI / CLI / MCP
//! and deterministic Markdown export (`board_to_markdown`) for `file-parse`, Quick Look,
//! `whiteboard-to-markdown`, and `ieumoffice convert --to md`.

use crate::model::{
    BoardDocument, BoardObject, ConnectorEnd, ConnectorProps, ImageProps, LinkProps, ObjectKind,
    Page, ShapeProps, StickerProps, StickyProps, StrokeProps, TextProps,
};
use crate::rich_text::rich_text_to_plain;
use crate::table::{TableProps, table_plain_text};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectSummary {
    pub id: String,
    pub kind: ObjectKind,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageTableView {
    pub id: String,
    pub title: String,
    pub format: String,
    pub width: f64,
    pub height: f64,
    pub object_count: usize,
    pub objects: Vec<ObjectSummary>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardTableView {
    pub id: String,
    pub title: String,
    pub pages: Vec<PageTableView>,
    pub text: String,
}

pub fn resolve_page<'a>(doc: &'a BoardDocument, page_ref: &str) -> Option<&'a Page> {
    if let Some(p) = doc.pages.iter().find(|p| p.id == page_ref) {
        return Some(p);
    }
    if let Some(p) = doc
        .pages
        .iter()
        .find(|p| !p.title.is_empty() && p.title.eq_ignore_ascii_case(page_ref))
    {
        return Some(p);
    }
    if let Ok(one_based) = page_ref.parse::<usize>() {
        if one_based >= 1 && one_based <= doc.pages.len() {
            return Some(&doc.pages[one_based - 1]);
        }
    }
    None
}

fn format_str(p: &Page) -> String {
    serde_json::to_value(crate::model::PageFormatWire::from(p.format))
        .ok()
        .and_then(|v| v.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| "freeform".into())
}

fn endpoint_label(end: &ConnectorEnd) -> String {
    match end {
        ConnectorEnd::Anchor { object_id, .. } => object_id.clone(),
        ConnectorEnd::Point { x, y } => format!("({:.0},{:.0})", x, y),
    }
}

fn object_plain_text(obj: &BoardObject) -> Option<String> {
    match obj.kind {
        ObjectKind::Sticky => serde_json::from_value::<StickyProps>(obj.props.clone())
            .ok()
            .map(|p| rich_text_to_plain(&p.text)),
        ObjectKind::Text => serde_json::from_value::<TextProps>(obj.props.clone())
            .ok()
            .map(|p| rich_text_to_plain(&p.text)),
        ObjectKind::Shape => serde_json::from_value::<ShapeProps>(obj.props.clone())
            .ok()
            .map(|p| rich_text_to_plain(&p.text)),
        ObjectKind::Connector => serde_json::from_value::<ConnectorProps>(obj.props.clone())
            .ok()
            .and_then(|p| p.label.as_ref().map(rich_text_to_plain)),
        ObjectKind::Link => serde_json::from_value::<LinkProps>(obj.props.clone())
            .ok()
            .map(|p| p.title),
        ObjectKind::Image => serde_json::from_value::<ImageProps>(obj.props.clone())
            .ok()
            .and_then(|p| p.alt),
        ObjectKind::Sticker => serde_json::from_value::<StickerProps>(obj.props.clone())
            .ok()
            .map(|p| p.sticker_id),
        ObjectKind::Table => serde_json::from_value::<TableProps>(obj.props.clone())
            .ok()
            .map(|t| {
                table_plain_text(&t)
                    .into_iter()
                    .map(|row| row.join(" | "))
                    .collect::<Vec<_>>()
                    .join(" ; ")
            }),
        ObjectKind::Stroke => None,
    }
    .and_then(|s| {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn summarize_object(obj: &BoardObject, selected: &HashSet<&str>) -> ObjectSummary {
    let mut shape = None;
    let mut url = None;
    let mut from = None;
    let mut to = None;

    match obj.kind {
        ObjectKind::Shape => {
            if let Ok(p) = serde_json::from_value::<ShapeProps>(obj.props.clone()) {
                shape = serde_json::to_value(p.shape)
                    .ok()
                    .and_then(|v| v.as_str().map(ToOwned::to_owned));
            }
        }
        ObjectKind::Link => {
            if let Ok(p) = serde_json::from_value::<LinkProps>(obj.props.clone()) {
                url = Some(p.url);
            }
        }
        ObjectKind::Connector => {
            if let Ok(p) = serde_json::from_value::<ConnectorProps>(obj.props.clone()) {
                from = Some(endpoint_label(&p.start));
                to = Some(endpoint_label(&p.end));
            }
        }
        _ => {}
    }

    let is_sel = selected.contains(obj.id.as_str());
    ObjectSummary {
        id: obj.id.clone(),
        kind: obj.kind,
        x: obj.x.round(),
        y: obj.y.round(),
        width: obj.width.round(),
        height: obj.height.round(),
        rotation: (obj.rotation.abs() > 1e-6).then_some(obj.rotation),
        group_id: obj.group_id.clone(),
        text: object_plain_text(obj),
        shape,
        url,
        from,
        to,
        selected: is_sel.then_some(true),
    }
}

/// Builds a structured summary + compact text table for the whole board or one requested page.
pub fn read_board_table(
    doc: &BoardDocument,
    page_filter: Option<&str>,
    selected_ids: &[String],
) -> Option<BoardTableView> {
    let selected: HashSet<&str> = selected_ids.iter().map(String::as_str).collect();
    let pages: Vec<&Page> = match page_filter {
        Some(ref_str) => vec![resolve_page(doc, ref_str)?],
        None => doc.pages.iter().collect(),
    };

    let mut page_views = Vec::with_capacity(pages.len());
    let mut lines = Vec::new();
    if !doc.title.trim().is_empty() {
        lines.push(format!("Board: {}", doc.title.trim()));
    }
    lines.push(format!("Pages ({}):", doc.pages.len()));
    for (idx, p) in doc.pages.iter().enumerate() {
        let count = doc.objects.iter().filter(|o| o.page_id == p.id).count();
        let label = if p.title.trim().is_empty() {
            format!("Page {}", idx + 1)
        } else {
            p.title.trim().to_string()
        };
        lines.push(format!(
            "  - {} \"{}\" [{} {:.0}x{:.0}, {} objects]",
            p.id,
            label,
            format_str(p),
            p.width,
            p.height,
            count
        ));
    }

    for p in pages {
        let mut objs: Vec<&BoardObject> = doc
            .objects
            .iter()
            .filter(|o| o.page_id == p.id)
            .collect();
        objs.sort_by(|a, b| a.order_key.cmp(&b.order_key));

        let summaries: Vec<ObjectSummary> =
            objs.iter().map(|o| summarize_object(o, &selected)).collect();
        let label = if p.title.trim().is_empty() {
            p.id.as_str()
        } else {
            p.title.trim()
        };
        lines.push(String::new());
        lines.push(format!(
            "Page {} \"{}\" [{} {:.0}x{:.0}]:",
            p.id,
            label,
            format_str(p),
            p.width,
            p.height
        ));
        if summaries.is_empty() {
            lines.push("  (empty)".into());
        } else {
            lines.push("  id | kind | rect | details".into());
            for s in &summaries {
                let kind_str = serde_json::to_value(s.kind)
                    .ok()
                    .and_then(|v| v.as_str().map(ToOwned::to_owned))
                    .unwrap_or_default();
                let mut detail_parts = Vec::new();
                if let Some(ref sh) = s.shape {
                    detail_parts.push(format!("shape={sh}"));
                }
                if let (Some(f), Some(t)) = (&s.from, &s.to) {
                    detail_parts.push(format!("{f} -> {t}"));
                }
                if let Some(ref txt) = s.text {
                    let compact = txt.replace('\n', " / ");
                    detail_parts.push(format!("\"{compact}\""));
                }
                if let Some(ref u) = s.url {
                    detail_parts.push(format!("url={u}"));
                }
                if s.selected == Some(true) {
                    detail_parts.push("[SELECTED]".into());
                }
                lines.push(format!(
                    "  {} | {} | {:.0},{:.0} {:.0}x{:.0} | {}",
                    s.id,
                    kind_str,
                    s.x,
                    s.y,
                    s.width,
                    s.height,
                    detail_parts.join(" ")
                ));
            }
        }

        page_views.push(PageTableView {
            id: p.id.clone(),
            title: p.title.clone(),
            format: format_str(p),
            width: p.width,
            height: p.height,
            object_count: summaries.len(),
            objects: summaries,
        });
    }

    Some(BoardTableView {
        id: doc.id.clone(),
        title: doc.title.clone(),
        pages: page_views,
        text: lines.join("\n"),
    })
}

fn escape_md_cell(s: &str) -> String {
    s.replace('|', "\\|").replace('\n', " ")
}

/// Deterministic Markdown extraction used by `file-parse`, Quick Look,
/// `whiteboard-to-markdown`, and `ieumoffice convert --to md`.
pub fn board_to_markdown(doc: &BoardDocument, page_filter: Option<&str>) -> Option<String> {
    let pages: Vec<(usize, &Page)> = match page_filter {
        Some(ref_str) => {
            let p = resolve_page(doc, ref_str)?;
            let idx = doc.pages.iter().position(|x| x.id == p.id).unwrap_or(0);
            vec![(idx, p)]
        }
        None => doc.pages.iter().enumerate().collect(),
    };

    let mut out = Vec::new();
    if !doc.title.trim().is_empty() {
        out.push(format!("# {}", doc.title.trim()));
        out.push(String::new());
    }

    for (idx, page) in pages {
        let heading = if page.title.trim().is_empty() {
            format!("Page {}", idx + 1)
        } else {
            page.title.trim().to_string()
        };
        out.push(format!("## {heading}"));
        out.push(String::new());

        let mut objs: Vec<&BoardObject> = doc
            .objects
            .iter()
            .filter(|o| o.page_id == page.id)
            .collect();
        // Reading order: top-to-bottom bands (48px bucket), then left-to-right, then order_key.
        objs.sort_by(|a, b| {
            let band_a = (a.y / 48.0).floor() as i64;
            let band_b = (b.y / 48.0).floor() as i64;
            band_a
                .cmp(&band_b)
                .then_with(|| a.x.total_cmp(&b.x))
                .then_with(|| a.order_key.cmp(&b.order_key))
        });

        let label_by_id: HashMap<&str, String> = objs
            .iter()
            .filter_map(|o| object_plain_text(o).map(|t| (o.id.as_str(), t)))
            .collect();

        let mut stroke_count = 0usize;
        let mut connections = Vec::new();

        for obj in &objs {
            match obj.kind {
                ObjectKind::Text => {
                    if let Some(txt) = object_plain_text(obj) {
                        out.push(txt);
                        out.push(String::new());
                    }
                }
                ObjectKind::Sticky => {
                    if let Some(txt) = object_plain_text(obj) {
                        for line in txt.lines() {
                            out.push(format!("> {line}"));
                        }
                        out.push(String::new());
                    }
                }
                ObjectKind::Shape => {
                    if let Some(txt) = object_plain_text(obj) {
                        out.push(format!("- {}", txt.replace('\n', " — ")));
                    }
                }
                ObjectKind::Table => {
                    if let Ok(t) = serde_json::from_value::<TableProps>(obj.props.clone()) {
                        let grid = table_plain_text(&t);
                        if !grid.is_empty() && !grid[0].is_empty() {
                            out.push(String::new());
                            let header = grid[0]
                                .iter()
                                .map(|c| escape_md_cell(c))
                                .collect::<Vec<_>>()
                                .join(" | ");
                            out.push(format!("| {header} |"));
                            let sep = vec!["---"; grid[0].len()].join(" | ");
                            out.push(format!("| {sep} |"));
                            for row in grid.iter().skip(1) {
                                let cells = row
                                    .iter()
                                    .map(|c| escape_md_cell(c))
                                    .collect::<Vec<_>>()
                                    .join(" | ");
                                out.push(format!("| {cells} |"));
                            }
                            out.push(String::new());
                        }
                    }
                }
                ObjectKind::Link => {
                    if let Ok(l) = serde_json::from_value::<LinkProps>(obj.props.clone()) {
                        let title = if l.title.trim().is_empty() {
                            l.url.as_str()
                        } else {
                            l.title.trim()
                        };
                        match l.description.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                            Some(desc) => out.push(format!("- [{title}]({}) — {desc}", l.url)),
                            None => out.push(format!("- [{title}]({})", l.url)),
                        }
                    }
                }
                ObjectKind::Image => {
                    if let Ok(im) = serde_json::from_value::<ImageProps>(obj.props.clone()) {
                        let alt = im.alt.as_deref().unwrap_or(&im.resource_id);
                        out.push(format!("- [Image: {alt}]"));
                    }
                }
                ObjectKind::Sticker => {
                    if let Ok(st) = serde_json::from_value::<StickerProps>(obj.props.clone()) {
                        out.push(format!("- [Sticker: {}]", st.sticker_id));
                    }
                }
                ObjectKind::Connector => {
                    if let Ok(c) = serde_json::from_value::<ConnectorProps>(obj.props.clone()) {
                        let resolve_name = |end: &ConnectorEnd| -> String {
                            match end {
                                ConnectorEnd::Anchor { object_id, .. } => label_by_id
                                    .get(object_id.as_str())
                                    .cloned()
                                    .unwrap_or_else(|| object_id.clone()),
                                ConnectorEnd::Point { x, y } => format!("({:.0},{:.0})", x, y),
                            }
                        };
                        let from = resolve_name(&c.start).replace('\n', " ");
                        let to = resolve_name(&c.end).replace('\n', " ");
                        let lbl = c
                            .label
                            .as_ref()
                            .map(rich_text_to_plain)
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty());
                        match lbl {
                            Some(l) => connections.push(format!("- {from} -> {to} ({l})")),
                            None => connections.push(format!("- {from} -> {to}")),
                        }
                    }
                }
                ObjectKind::Stroke => {
                    if serde_json::from_value::<StrokeProps>(obj.props.clone()).is_ok() {
                        stroke_count += 1;
                    }
                }
            }
        }

        if !connections.is_empty() {
            out.push(String::new());
            out.push("### Connections".into());
            out.extend(connections);
            out.push(String::new());
        }
        if stroke_count > 0 {
            out.push(format!("_(Freehand strokes: {stroke_count})_"));
            out.push(String::new());
        }
    }

    let mut result = out.join("\n").trim().to_string();
    result.push('\n');
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edit_plan::{BatchMode, plan_board_edit};
    use crate::model::create_new_board;
    use serde_json::json;

    #[test]
    fn generates_structured_table_and_markdown() {
        let board = create_new_board("b1".into(), "p1".into(), "Roadmap".into());
        let ops = vec![
            json!({ "op": "rename_page", "pageId": "p1", "title": "Q1" }),
            json!({ "op": "add", "id": "s1", "kind": "sticky", "x": 100, "y": 100, "text": "Launch beta" }),
            json!({ "op": "add", "id": "l1", "kind": "link", "x": 100, "y": 320, "url": "https://example.com", "title": "Spec" }),
            json!({ "op": "add", "id": "t1", "kind": "table", "x": 100, "y": 500, "rows": 2, "cols": 2, "data": [["Item", "Owner"], ["Engine", "Core"]] }),
        ];
        let res = plan_board_edit(&board, &ops, Some("p1"), BatchMode::AllOrNothing);
        assert!(res.ok);

        let table = read_board_table(&res.doc, Some("Q1"), &["s1".into()]).unwrap();
        assert_eq!(table.pages.len(), 1);
        assert!(table.text.contains("[SELECTED]"));
        assert!(table.text.contains("Launch beta"));

        let md = board_to_markdown(&res.doc, None).unwrap();
        assert!(md.contains("# Roadmap"));
        assert!(md.contains("## Q1"));
        assert!(md.contains("> Launch beta"));
        assert!(md.contains("[Spec](https://example.com)"));
        assert!(md.contains("| Item | Owner |"));
        assert!(md.contains("| Engine | Core |"));
    }
}
