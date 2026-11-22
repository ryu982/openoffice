use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek};

use quick_xml::Reader;
use quick_xml::events::Event;

use crate::extract::rels::resolve_target;
use crate::extract::xml_util::{attr_map, get_attr, parse_relationships, resolve_xml_entity};
use crate::zip_gate::{ZipArchive, ZipGateError};

#[derive(Debug, Clone, Copy, Default)]
struct StyleFacts {
    heading: usize,
    list: bool,
}

struct TextSink {
    lines: Vec<String>,
    chars: usize,
    max_chars: Option<usize>,
    full: bool,
    pictures: usize,
}

impl TextSink {
    fn new(max_chars: Option<usize>) -> Self {
        Self {
            lines: Vec::new(),
            chars: 0,
            max_chars,
            full: false,
            pictures: 0,
        }
    }

    fn push(&mut self, line: String) {
        if self.full {
            return;
        }
        let line_len = line.encode_utf16().count();
        self.lines.push(line);
        self.chars = self.chars.saturating_add(line_len + 1);
        if let Some(limit) = self.max_chars {
            if self.chars >= limit {
                self.full = true;
            }
        }
    }
}

struct Para {
    text: String,
    heading: usize,
    list: bool,
}

struct Cell {
    paras: Vec<String>,
}

struct Table {
    rows: Vec<Vec<String>>,
    cell: Option<Cell>,
    row: Option<Vec<String>>,
}

fn is_skipped_subtree(name: &str) -> bool {
    matches!(
        name,
        "mc:Fallback"
            | "w:del"
            | "w:moveFrom"
            | "w:instrText"
            | "w:delInstrText"
            | "w:delText"
            | "w:rt"
            | "w:rPrChange"
            | "w:pPrChange"
            | "w:tabs"
            | "w:tblPr"
            | "w:tblGrid"
            | "w:trPr"
            | "w:tcPr"
            | "w:sectPr"
    )
}

fn parse_heading_name(name: &str) -> Option<usize> {
    let trimmed = name.trim();
    if trimmed.eq_ignore_ascii_case("title") {
        return Some(1);
    }
    let lower = trimmed.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("heading") {
        let rest = rest.trim_start();
        if rest.len() == 1 && rest.as_bytes()[0].is_ascii_digit() {
            return Some((rest.as_bytes()[0] - b'0') as usize);
        }
    }
    None
}

fn parse_heading_style_id_fallback(val: &str) -> usize {
    if let Some(rest) = val.strip_prefix("Heading") {
        if rest.len() == 1 && rest.as_bytes()[0].is_ascii_digit() {
            return (rest.as_bytes()[0] - b'0') as usize;
        }
    }
    0
}

fn paragraph_style_facts(styles_xml: Option<&str>) -> HashMap<String, StyleFacts> {
    let mut facts = HashMap::new();
    let Some(xml) = styles_xml else {
        return facts;
    };

    #[derive(Default)]
    struct RawStyle {
        heading: Option<usize>,
        list: Option<bool>,
        based_on: Option<String>,
    }

    let mut raw: HashMap<String, RawStyle> = HashMap::new();
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    reader.config_mut().check_end_names = false;

    let mut cur_id: Option<String> = None;
    let mut cur_name: Option<String> = None;
    let mut cur_outline: Option<usize> = None;
    let mut cur_num_id: Option<String> = None;
    let mut cur_based_on: Option<String> = None;

    let finish_style = |raw: &mut HashMap<String, RawStyle>,
                        id: String,
                        name: Option<String>,
                        outline: Option<usize>,
                        num_id: Option<String>,
                        based_on: Option<String>| {
        let heading = if let Some(lvl) = outline {
            Some(if lvl == 9 { 0 } else { lvl + 1 })
        } else if let Some(ref n) = name {
            parse_heading_name(n)
        } else {
            None
        };
        let list = num_id.map(|v| v != "0");
        raw.insert(
            id,
            RawStyle {
                heading,
                list,
                based_on,
            },
        );
    };

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let tag_name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                let attrs = attr_map(&e);
                match tag_name.as_str() {
                    "w:style" => {
                        let is_para = get_attr(&attrs, "w:type") == Some("paragraph");
                        let style_id = get_attr(&attrs, "w:styleId").map(str::to_owned);
                        if is_para && style_id.is_some() {
                            cur_id = style_id;
                            cur_name = None;
                            cur_outline = None;
                            cur_num_id = None;
                            cur_based_on = None;
                        }
                    }
                    "w:name" if cur_id.is_some() => {
                        if cur_name.is_none() {
                            cur_name = get_attr(&attrs, "w:val").map(str::to_owned);
                        }
                    }
                    "w:outlineLvl" if cur_id.is_some() => {
                        if cur_outline.is_none() {
                            if let Some(v) = get_attr(&attrs, "w:val") {
                                if v.len() == 1 && v.as_bytes()[0].is_ascii_digit() {
                                    cur_outline = Some((v.as_bytes()[0] - b'0') as usize);
                                }
                            }
                        }
                    }
                    "w:numId" if cur_id.is_some() => {
                        if cur_num_id.is_none() {
                            cur_num_id = get_attr(&attrs, "w:val").map(str::to_owned);
                        }
                    }
                    "w:basedOn" if cur_id.is_some() => {
                        if cur_based_on.is_none() {
                            cur_based_on = get_attr(&attrs, "w:val").map(str::to_owned);
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) => {
                if cur_id.is_some() {
                    let tag_name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                    let attrs = attr_map(&e);
                    match tag_name.as_str() {
                        "w:name" if cur_name.is_none() => {
                            cur_name = get_attr(&attrs, "w:val").map(str::to_owned);
                        }
                        "w:outlineLvl" if cur_outline.is_none() => {
                            if let Some(v) = get_attr(&attrs, "w:val") {
                                if v.len() == 1 && v.as_bytes()[0].is_ascii_digit() {
                                    cur_outline = Some((v.as_bytes()[0] - b'0') as usize);
                                }
                            }
                        }
                        "w:numId" if cur_num_id.is_none() => {
                            cur_num_id = get_attr(&attrs, "w:val").map(str::to_owned);
                        }
                        "w:basedOn" if cur_based_on.is_none() => {
                            cur_based_on = get_attr(&attrs, "w:val").map(str::to_owned);
                        }
                        _ => {}
                    }
                }
            }
            Ok(Event::End(e)) => {
                if e.name().as_ref() == b"w:style" {
                    if let Some(id) = cur_id.take() {
                        finish_style(
                            &mut raw,
                            id,
                            cur_name.take(),
                            cur_outline.take(),
                            cur_num_id.take(),
                            cur_based_on.take(),
                        );
                    }
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => break,
        }
    }

    for id in raw.keys() {
        let mut heading: Option<usize> = None;
        let mut list: Option<bool> = None;
        let mut seen = HashSet::new();
        let mut cur = Some(id.as_str());
        while let Some(c) = cur {
            if !seen.insert(c) {
                break;
            }
            let Some(r) = raw.get(c) else {
                break;
            };
            if heading.is_none() {
                heading = r.heading;
            }
            if list.is_none() {
                list = r.list;
            }
            cur = r.based_on.as_deref();
        }
        facts.insert(
            id.clone(),
            StyleFacts {
                heading: heading.unwrap_or(0),
                list: list.unwrap_or(false),
            },
        );
    }
    facts
}

fn collapse_cell_newlines(input: &str) -> String {
    if !input.contains('\n') {
        return input.to_owned();
    }
    let mut out = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        // Match /\s*\n\s*/g -> " "
        let start = i;
        let mut j = i;
        while j < chars.len() && chars[j].is_whitespace() && chars[j] != '\n' {
            j += 1;
        }
        if j < chars.len() && chars[j] == '\n' {
            j += 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            out.push(' ');
            i = j;
        } else {
            out.push(chars[start]);
            i += 1;
        }
    }
    out
}

fn scan_body(
    xml: &str,
    style_facts: &HashMap<String, StyleFacts>,
    out: &mut TextSink,
    notes: bool,
) {
    let mut paras: Vec<Para> = Vec::new();
    let mut tables: Vec<Table> = Vec::new();
    let mut skip_depth: Option<usize> = None;
    let mut depth: usize = 0;
    let mut in_text = false;
    let mut run_hidden = false;
    let mut note_separator = false;
    let mut note_lines: Vec<String> = Vec::new();

    let emit_para = |p: Para,
                     tables: &mut Vec<Table>,
                     note_lines: &mut Vec<String>,
                     out: &mut TextSink| {
        if let Some(table) = tables.last_mut() {
            if let Some(cell) = table.cell.as_mut() {
                cell.paras.push(p.text);
                return;
            }
        }
        if notes {
            note_lines.push(p.text);
            return;
        }
        let line = if p.heading > 0 {
            format!("{} {}", "#".repeat(p.heading.min(6)), p.text)
        } else if p.list {
            format!("- {}", p.text)
        } else {
            p.text
        };
        out.push(line);
    };

    let emit_rows = |table: Table,
                     tables: &mut Vec<Table>,
                     note_lines: &mut Vec<String>,
                     out: &mut TextSink| {
        let lines: Vec<String> = table.rows.into_iter().map(|row| row.join(" | ")).collect();
        let has_parent_cell = tables
            .last()
            .and_then(|t| t.cell.as_ref())
            .is_some();
        for line in lines {
            if has_parent_cell {
                tables
                    .last_mut()
                    .unwrap()
                    .cell
                    .as_mut()
                    .unwrap()
                    .paras
                    .push(line);
            } else if notes {
                note_lines.push(line);
            } else {
                out.push(line);
            }
        }
    };

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    reader.config_mut().check_end_names = false;

    loop {
        if out.full {
            return;
        }
        let ev = match reader.read_event() {
            Ok(ev) => ev,
            Err(_) => break,
        };
        match ev {
            Event::Eof => break,
            Event::Text(e) => {
                if in_text && skip_depth.is_none() && !run_hidden {
                    if let Some(p) = paras.last_mut() {
                        p.text.push_str(&String::from_utf8_lossy(e.as_ref()));
                    }
                }
            }
            Event::GeneralRef(e) => {
                if in_text && skip_depth.is_none() && !run_hidden {
                    let name = String::from_utf8_lossy(e.as_ref());
                    let decoded = resolve_xml_entity(&name).unwrap_or_else(|| format!("&{name};"));
                    if let Some(p) = paras.last_mut() {
                        p.text.push_str(&decoded);
                    }
                }
            }
            Event::CData(e) => {
                if in_text && skip_depth.is_none() && !run_hidden {
                    if let Some(p) = paras.last_mut() {
                        p.text.push_str(&String::from_utf8_lossy(e.as_ref()));
                    }
                }
            }
            Event::Start(e) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                depth += 1;
                if skip_depth.is_some() {
                    continue;
                }
                if is_skipped_subtree(&name) {
                    skip_depth = Some(depth);
                    continue;
                }
                let attrs = attr_map(&e);
                handle_open(
                    &name,
                    &attrs,
                    false,
                    style_facts,
                    &mut paras,
                    &mut tables,
                    &mut in_text,
                    &mut run_hidden,
                    &mut note_separator,
                    &mut note_lines,
                    out,
                );
            }
            Event::Empty(e) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                if skip_depth.is_some() {
                    continue;
                }
                if is_skipped_subtree(&name) {
                    continue;
                }
                let attrs = attr_map(&e);
                handle_open(
                    &name,
                    &attrs,
                    true,
                    style_facts,
                    &mut paras,
                    &mut tables,
                    &mut in_text,
                    &mut run_hidden,
                    &mut note_separator,
                    &mut note_lines,
                    out,
                );
                handle_close(
                    &name,
                    &mut paras,
                    &mut tables,
                    &mut in_text,
                    &mut note_separator,
                    &mut note_lines,
                    out,
                    &emit_para,
                    &emit_rows,
                );
            }
            Event::End(e) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                if let Some(sd) = skip_depth {
                    depth = depth.saturating_sub(1);
                    if depth < sd {
                        skip_depth = None;
                    }
                    continue;
                }
                handle_close(
                    &name,
                    &mut paras,
                    &mut tables,
                    &mut in_text,
                    &mut note_separator,
                    &mut note_lines,
                    out,
                    &emit_para,
                    &emit_rows,
                );
                depth = depth.saturating_sub(1);
            }
            _ => {}
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_open(
    name: &str,
    attrs: &[(String, String)],
    self_close: bool,
    style_facts: &HashMap<String, StyleFacts>,
    paras: &mut Vec<Para>,
    tables: &mut Vec<Table>,
    in_text: &mut bool,
    run_hidden: &mut bool,
    note_separator: &mut bool,
    note_lines: &mut Vec<String>,
    out: &mut TextSink,
) {
    match name {
        "w:p" => {
            paras.push(Para {
                text: String::new(),
                heading: 0,
                list: false,
            });
        }
        "w:pStyle" => {
            if let (Some(p), Some(val)) = (paras.last_mut(), get_attr(attrs, "w:val")) {
                if !val.is_empty() {
                    if let Some(facts) = style_facts.get(val) {
                        if facts.heading > 0 {
                            p.heading = facts.heading;
                        }
                        if facts.list {
                            p.list = true;
                        }
                    } else {
                        let lvl = parse_heading_style_id_fallback(val);
                        if lvl > 0 {
                            p.heading = lvl;
                        }
                    }
                }
            }
        }
        "w:numPr" => {
            if let Some(p) = paras.last_mut() {
                p.list = true;
            }
        }
        "w:numId" => {
            if let Some(p) = paras.last_mut() {
                p.list = get_attr(attrs, "w:val") != Some("0");
            }
        }
        "w:outlineLvl" => {
            if let (Some(p), Some(val)) = (paras.last_mut(), get_attr(attrs, "w:val")) {
                if val.len() == 1 && val.as_bytes()[0].is_ascii_digit() {
                    let n = (val.as_bytes()[0] - b'0') as usize;
                    p.heading = if n == 9 { 0 } else { n + 1 };
                }
            }
        }
        "w:r" => {
            *run_hidden = false;
        }
        "w:vanish" => {
            let val = get_attr(attrs, "w:val");
            if !matches!(val, Some("0" | "false" | "off")) {
                *run_hidden = true;
            }
        }
        "w:t" => {
            *in_text = !self_close;
        }
        "w:tab" | "w:ptab" => {
            if !*run_hidden {
                if let Some(p) = paras.last_mut() {
                    p.text.push('\t');
                }
            }
        }
        "w:br" | "w:cr" => {
            let br_type = get_attr(attrs, "w:type");
            if !*run_hidden && !matches!(br_type, Some("page" | "column")) {
                if let Some(p) = paras.last_mut() {
                    p.text.push('\n');
                }
            }
        }
        "w:noBreakHyphen" => {
            if !*run_hidden {
                if let Some(p) = paras.last_mut() {
                    p.text.push('-');
                }
            }
        }
        "w:sym" => {
            if !*run_hidden {
                if let Some(code) = get_attr(attrs, "w:char") {
                    if code.len() == 4 {
                        if let Ok(cp) = u32::from_str_radix(code, 16) {
                            if let Some(ch) = char::from_u32(cp) {
                                if let Some(p) = paras.last_mut() {
                                    p.text.push(ch);
                                }
                            }
                        }
                    }
                }
            }
        }
        "wp:docPr" => {
            let hidden = matches!(get_attr(attrs, "hidden"), Some("1" | "true"));
            if !*run_hidden && !hidden {
                let descr = get_attr(attrs, "descr").unwrap_or("");
                let title = get_attr(attrs, "title").unwrap_or("");
                let alt = if !descr.is_empty() { descr } else { title };
                if !alt.is_empty() {
                    if let Some(p) = paras.last_mut() {
                        p.text.push_str(&format!("[image: {alt}]"));
                    }
                }
            }
        }
        "w:drawing" | "w:pict" => {
            out.pictures += 1;
        }
        "w:tbl" => {
            tables.push(Table {
                rows: Vec::new(),
                cell: None,
                row: None,
            });
        }
        "w:tr" => {
            if let Some(table) = tables.last_mut() {
                table.row = Some(Vec::new());
            }
        }
        "w:tc" => {
            if let Some(table) = tables.last_mut() {
                table.cell = Some(Cell { paras: Vec::new() });
            }
        }
        "w:footnote" | "w:endnote" => {
            let ty = get_attr(attrs, "w:type");
            *note_separator = matches!(
                ty,
                Some("separator" | "continuationSeparator" | "continuationNotice")
            );
            note_lines.clear();
        }
        _ => {}
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_close<FP, FR>(
    name: &str,
    paras: &mut Vec<Para>,
    tables: &mut Vec<Table>,
    in_text: &mut bool,
    note_separator: &mut bool,
    note_lines: &mut Vec<String>,
    out: &mut TextSink,
    emit_para: &FP,
    emit_rows: &FR,
) where
    FP: Fn(Para, &mut Vec<Table>, &mut Vec<String>, &mut TextSink),
    FR: Fn(Table, &mut Vec<Table>, &mut Vec<String>, &mut TextSink),
{
    match name {
        "w:p" => {
            if let Some(p) = paras.pop() {
                if !*note_separator {
                    emit_para(p, tables, note_lines, out);
                }
            }
        }
        "w:t" => {
            *in_text = false;
        }
        "w:tbl" => {
            if let Some(table) = tables.pop() {
                emit_rows(table, tables, note_lines, out);
            }
        }
        "w:tr" => {
            if let Some(table) = tables.last_mut() {
                if let Some(row) = table.row.take() {
                    table.rows.push(row);
                }
            }
        }
        "w:tc" => {
            if let Some(table) = tables.last_mut() {
                if let Some(cell) = table.cell.take() {
                    let joined = collapse_cell_newlines(&cell.paras.join(" "));
                    if let Some(row) = table.row.as_mut() {
                        row.push(joined);
                    }
                }
            }
        }
        "w:footnote" | "w:endnote" => {
            if !*note_separator && !note_lines.is_empty() {
                out.push(note_lines.join(" "));
            }
            *note_separator = false;
        }
        _ => {}
    }
}

fn append_story(
    out: &mut TextSink,
    title: &str,
    xml: &str,
    style_facts: &HashMap<String, StyleFacts>,
    notes: bool,
) {
    let mut sink = TextSink::new(None);
    scan_body(xml, style_facts, &mut sink, notes);
    if sink.lines.is_empty() {
        return;
    }
    out.push(format!("## {title}"));
    for line in sink.lines {
        out.push(line);
    }
}

fn main_document_path<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
) -> Result<Option<String>, ZipGateError> {
    if zip.has_file("word/document.xml") {
        return Ok(Some("word/document.xml".to_owned()));
    }
    let Some(rels_xml) = zip.read_entry_string("_rels/.rels")? else {
        return Ok(None);
    };
    for rel in parse_relationships(&rels_xml) {
        if !rel.rel_type.ends_with("/officeDocument") || rel.external || rel.target.is_empty() {
            continue;
        }
        let resolved = resolve_target("", &rel.target);
        if !resolved.is_empty() && zip.has_file(&resolved) {
            return Ok(Some(resolved));
        }
        let raw = rel.target.trim_start_matches('/').to_owned();
        if zip.has_file(&raw) {
            return Ok(Some(raw));
        }
    }
    Ok(None)
}

/// Extracts readable text from a verified DOCX archive.
/// Matches `packages/file-parse/src/docx.ts`.
pub fn extract_docx<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
    max_chars: Option<usize>,
) -> Result<String, ZipGateError> {
    if max_chars == Some(0) {
        return Ok(String::new());
    }
    let Some(doc_path) = main_document_path(zip)? else {
        return Err(ZipGateError::Corrupt(
            "docx: main document part not found".to_owned(),
        ));
    };
    let Some(document_xml) = zip.read_entry_string(&doc_path)? else {
        return Err(ZipGateError::Corrupt(
            "docx: main document part not found".to_owned(),
        ));
    };

    let slash = doc_path.rfind('/').map(|i| i + 1).unwrap_or(0);
    let dir = &doc_path[..slash];
    let file_name = &doc_path[slash..];
    let mut parts: HashMap<&str, String> = HashMap::from([
        ("styles", format!("{dir}styles.xml")),
        ("footnotes", format!("{dir}footnotes.xml")),
        ("endnotes", format!("{dir}endnotes.xml")),
    ]);

    let rels_path = format!("{dir}_rels/{file_name}.rels");
    let mut related_targets: Vec<(&'static str, String)> = Vec::new();
    let mut seen_related: HashSet<String> = HashSet::new();

    if let Some(rels_xml) = zip.read_entry_string(&rels_path)? {
        for rel in parse_relationships(&rels_xml) {
            if rel.external || rel.target.is_empty() {
                continue;
            }
            let resolved = resolve_target(&doc_path, &rel.target);
            if resolved.is_empty() {
                continue;
            }
            let kind = rel.rel_type.rsplit('/').next().unwrap_or("");
            if let Some(slot) = parts.get_mut(kind) {
                *slot = resolved.clone();
            }
            let title = if rel.rel_type.ends_with("/header") {
                Some("Header")
            } else if rel.rel_type.ends_with("/footer") {
                Some("Footer")
            } else if rel.rel_type.ends_with("/comments") {
                Some("Comments")
            } else {
                None
            };
            if let Some(title) = title {
                if seen_related.insert(resolved.clone()) {
                    related_targets.push((title, resolved));
                }
            }
        }
    }

    let styles_xml = zip.read_entry_string(&parts["styles"])?;
    let style_facts = paragraph_style_facts(styles_xml.as_deref());

    let mut out = TextSink::new(max_chars);
    scan_body(&document_xml, &style_facts, &mut out, false);

    if !out.lines.iter().any(|l| !l.trim().is_empty()) && out.pictures > 0 {
        let n = out.pictures;
        out.lines.clear();
        out.push(format!(
            "[image-only document: {n} image{}, no extractable text]",
            if n == 1 { "" } else { "s" }
        ));
    }

    for (part_key, title) in [("footnotes", "Footnotes"), ("endnotes", "Endnotes")] {
        if out.full {
            break;
        }
        if let Some(xml) = zip.read_entry_string(&parts[part_key])? {
            append_story(&mut out, title, &xml, &style_facts, true);
        }
    }

    for (title, path) in related_targets {
        if out.full {
            break;
        }
        if let Some(xml) = zip.read_entry_string(&path)? {
            append_story(&mut out, title, &xml, &style_facts, false);
        }
    }

    Ok(out.lines.join("\n"))
}
