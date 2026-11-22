use std::collections::HashMap;
use std::io::{Read, Seek};

use quick_xml::Reader;
use quick_xml::events::Event;

use crate::extract::xml_util::{attr_map, decode_xml_entities, resolve_xml_entity};
use crate::protocol::RejectCode;
use crate::zip_gate::{ZipArchive, ZipGateError};

pub const ODT_TEXT_MEDIA_TYPE: &str = "application/vnd.oasis.opendocument.text";

#[derive(Debug)]
pub enum OdtError {
    NotOdtText(Option<String>),
    Encrypted,
    Corrupt(String),
    Zip(ZipGateError),
}

impl OdtError {
    pub fn reject_code(&self) -> RejectCode {
        match self {
            OdtError::NotOdtText(_) => RejectCode::ContentMismatch,
            OdtError::Encrypted => RejectCode::PasswordProtected,
            OdtError::Corrupt(_) => RejectCode::Corrupt,
            OdtError::Zip(z) => z.reject_code(),
        }
    }

    pub fn message(&self) -> String {
        match self {
            OdtError::NotOdtText(mt) => format!(
                "Content mismatch: .odt file is not an OpenDocument text document (media type {})",
                mt.as_deref().unwrap_or("missing")
            ),
            OdtError::Encrypted => {
                "Password-protected ODT: remove the password and attach it again".to_owned()
            }
            OdtError::Corrupt(m) => m.clone(),
            OdtError::Zip(z) => z.message(),
        }
    }
}

impl From<ZipGateError> for OdtError {
    fn from(value: ZipGateError) -> Self {
        OdtError::Zip(value)
    }
}

fn canonical_odf_prefix(uri: &str) -> Option<&'static str> {
    match uri {
        "urn:oasis:names:tc:opendocument:xmlns:office:1.0" => Some("office"),
        "urn:oasis:names:tc:opendocument:xmlns:style:1.0" => Some("style"),
        "urn:oasis:names:tc:opendocument:xmlns:text:1.0" => Some("text"),
        "urn:oasis:names:tc:opendocument:xmlns:table:1.0" => Some("table"),
        "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" => Some("draw"),
        "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" => Some("fo"),
        "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" => Some("svg"),
        "urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" => Some("number"),
        "urn:oasis:names:tc:opendocument:xmlns:meta:1.0" => Some("meta"),
        "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" => Some("manifest"),
        "urn:oasis:names:tc:opendocument:xmlns:config:1.0" => Some("config"),
        "urn:oasis:names:tc:opendocument:xmlns:chart:1.0" => Some("chart"),
        "urn:oasis:names:tc:opendocument:xmlns:dr3d:1.0" => Some("dr3d"),
        "urn:oasis:names:tc:opendocument:xmlns:form:1.0" => Some("form"),
        "urn:oasis:names:tc:opendocument:xmlns:script:1.0" => Some("script"),
        "urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" => Some("presentation"),
        "urn:oasis:names:tc:opendocument:xmlns:animation:1.0" => Some("anim"),
        "urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0" => Some("smil"),
        "http://www.w3.org/1999/xlink" => Some("xlink"),
        "http://purl.org/dc/elements/1.1/" => Some("dc"),
        "http://www.w3.org/1998/Math/MathML" => Some("math"),
        "http://www.w3.org/2002/xforms" => Some("xforms"),
        "http://www.w3.org/1999/xhtml" => Some("xhtml"),
        _ => None,
    }
}

struct PrefixMap {
    rename: HashMap<String, &'static str>,
}

impl PrefixMap {
    fn from_root_attrs(attrs: &[(String, String)]) -> Self {
        let mut rename = HashMap::new();
        for (k, v) in attrs {
            if let Some(prefix) = k.strip_prefix("xmlns:") {
                if let Some(canonical) = canonical_odf_prefix(v) {
                    if canonical != prefix {
                        rename.insert(prefix.to_owned(), canonical);
                    }
                }
            }
        }
        Self { rename }
    }

    fn canonical(&self, qname: &str) -> String {
        if self.rename.is_empty() {
            return qname.to_owned();
        }
        if let Some(colon) = qname.find(':') {
            if let Some(&mapped) = self.rename.get(&qname[..colon]) {
                return format!("{mapped}{}", &qname[colon..]);
            }
        }
        qname.to_owned()
    }
}

pub(crate) fn manifest_is_encrypted(manifest_xml: Option<&str>) -> bool {
    manifest_info(manifest_xml).1
}

fn manifest_info(manifest_xml: Option<&str>) -> (Option<String>, bool) {
    let Some(xml) = manifest_xml else {
        return (None, false);
    };
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    reader.config_mut().check_end_names = false;

    let mut prefixes: Option<PrefixMap> = None;
    let mut root_media_type: Option<String> = None;
    let mut in_file_entry = false;
    let mut encrypted = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let attrs = attr_map(&e);
                if prefixes.is_none() {
                    prefixes = Some(PrefixMap::from_root_attrs(&attrs));
                }
                let pm = prefixes.as_ref().unwrap();
                let name = pm.canonical(&String::from_utf8_lossy(e.name().as_ref()));
                if name == "manifest:file-entry" {
                    let mut full_path = None;
                    let mut media_type = None;
                    for (k, v) in &attrs {
                        let ck = pm.canonical(k);
                        if ck == "manifest:full-path" || ck == "full-path" {
                            full_path = Some(v.as_str());
                        } else if ck == "manifest:media-type" || ck == "media-type" {
                            media_type = Some(v.trim().to_owned());
                        }
                    }
                    if full_path == Some("/") && root_media_type.is_none() {
                        root_media_type = media_type;
                    }
                    in_file_entry = true;
                } else if name == "manifest:encryption-data" && in_file_entry {
                    encrypted = true;
                }
            }
            Ok(Event::Empty(e)) => {
                let attrs = attr_map(&e);
                if prefixes.is_none() {
                    prefixes = Some(PrefixMap::from_root_attrs(&attrs));
                }
                let pm = prefixes.as_ref().unwrap();
                let name = pm.canonical(&String::from_utf8_lossy(e.name().as_ref()));
                if name == "manifest:file-entry" {
                    let mut full_path = None;
                    let mut media_type = None;
                    for (k, v) in &attrs {
                        let ck = pm.canonical(k);
                        if ck == "manifest:full-path" || ck == "full-path" {
                            full_path = Some(v.as_str());
                        } else if ck == "manifest:media-type" || ck == "media-type" {
                            media_type = Some(v.trim().to_owned());
                        }
                    }
                    if full_path == Some("/") && root_media_type.is_none() {
                        root_media_type = media_type;
                    }
                } else if name == "manifest:encryption-data" && in_file_entry {
                    encrypted = true;
                }
            }
            Ok(Event::End(e)) => {
                if let Some(ref pm) = prefixes {
                    let name = pm.canonical(&String::from_utf8_lossy(e.name().as_ref()));
                    if name == "manifest:file-entry" {
                        in_file_entry = false;
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            Ok(_) => {}
        }
    }

    (root_media_type, encrypted)
}

fn is_skipped_odt(name: &str) -> bool {
    if matches!(
        name,
        "text:tracked-changes"
            | "office:annotation"
            | "office:annotation-end"
            | "text:sequence-decls"
            | "office:forms"
            | "text:soft-page-break"
            | "svg:title"
            | "svg:desc"
            | "office:binary-data"
            | "draw:object-ole"
            | "office:event-listeners"
    ) {
        return true;
    }
    if let Some(rest) = name.strip_prefix("text:") {
        if let Some(mid) = rest.strip_suffix("-source") {
            return !mid.is_empty()
                && mid
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
        }
    }
    false
}

enum Ctx {
    Para {
        text: String,
        ws: bool,
        after: Vec<String>,
    },
    Cell {
        parts: Vec<String>,
        is_covered: bool,
    },
    Table {
        rows: Vec<Vec<String>>,
    },
    Note {
        host_para_idx: Option<usize>,
        at_byte: usize,
        citation: String,
        parts: Vec<String>,
    },
}

fn collapse_tabs_newlines(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_sep = false;
    for ch in s.chars() {
        if ch == '\t' || ch == '\n' {
            if !in_sep {
                out.push(' ');
                in_sep = true;
            }
        } else {
            out.push(ch);
            in_sep = false;
        }
    }
    out
}

/// Extracts plain text from a verified ODT archive.
/// Matches `packages/odt-engine/src/assemble/text.ts` and `core/open.ts`.
pub fn extract_odt<R: Read + Seek>(zip: &mut ZipArchive<R>) -> Result<String, OdtError> {
    let manifest_xml = zip.read_entry_string("META-INF/manifest.xml")?;
    let (manifest_root_mt, encrypted) = manifest_info(manifest_xml.as_deref());

    let mimetype = match zip.read_entry_string("mimetype")? {
        Some(mt) => Some(mt.trim().to_owned()),
        None => manifest_root_mt,
    };
    if mimetype.as_deref() != Some(ODT_TEXT_MEDIA_TYPE) {
        return Err(OdtError::NotOdtText(mimetype));
    }
    if encrypted {
        return Err(OdtError::Encrypted);
    }

    let Some(content_xml) = zip.read_entry_string("content.xml")? else {
        return Err(OdtError::Corrupt("odt: content.xml is missing".to_owned()));
    };

    let mut reader = Reader::from_str(&content_xml);
    reader.config_mut().trim_text(false);
    reader.config_mut().check_end_names = false;

    let mut prefixes: Option<PrefixMap> = None;
    let mut in_office_text = false;
    let mut found_office_text = false;
    let mut office_text_depth: usize = 0;
    let mut depth: usize = 0;
    let mut skip_depth: Option<usize> = None;
    let mut citation_depth: Option<usize> = None;

    let mut out: Vec<String> = Vec::new();
    let mut notes: Vec<String> = Vec::new();
    let mut stack: Vec<Ctx> = Vec::new();
    let mut tag_pushed_ctx: Vec<bool> = Vec::new();

    let emit = |line: String, stack: &mut [Ctx], out: &mut Vec<String>| {
        for c in stack.iter_mut().rev() {
            match c {
                Ctx::Cell { parts, .. } | Ctx::Note { parts, .. } => {
                    parts.push(line);
                    return;
                }
                Ctx::Para { after, .. } => {
                    after.push(line);
                    return;
                }
                Ctx::Table { .. } => {}
            }
        }
        out.push(line);
    };

    let add_text = |s: &str, stack: &mut [Ctx], in_citation: bool| {
        if in_citation {
            if let Some(Ctx::Note { citation, .. }) = stack.last_mut() {
                citation.push_str(s);
            }
            return;
        }
        if let Some(Ctx::Para { text, ws, .. }) = stack.last_mut() {
            for ch in s.chars() {
                if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
                    if !*ws {
                        text.push(' ');
                    }
                    *ws = true;
                } else {
                    text.push(ch);
                    *ws = false;
                }
            }
        }
    };

    let literal = |s: &str, stack: &mut [Ctx]| {
        if let Some(Ctx::Para { text, ws, .. }) = stack.last_mut() {
            text.push_str(s);
            *ws = false;
        }
    };

    let close_ctx = |stack: &mut Vec<Ctx>, out: &mut Vec<String>, notes: &mut Vec<String>| {
        let Some(c) = stack.pop() else {
            return;
        };
        match c {
            Ctx::Para { text, after, .. } => {
                let line = text.trim_end_matches(' ').to_owned();
                if !line.is_empty() || after.is_empty() {
                    emit(line, stack, out);
                }
                for a in after {
                    emit(a, stack, out);
                }
            }
            Ctx::Cell { parts, is_covered } => {
                if !is_covered {
                    let joined = parts
                        .into_iter()
                        .filter(|p| !p.trim().is_empty())
                        .collect::<Vec<_>>()
                        .join(" ");
                    let value = collapse_tabs_newlines(&joined);
                    for item in stack.iter_mut().rev() {
                        if let Ctx::Table { rows } = item {
                            if let Some(row) = rows.last_mut() {
                                row.push(value);
                            }
                            break;
                        }
                    }
                }
            }
            Ctx::Table { rows } => {
                let lines: Vec<String> = rows
                    .into_iter()
                    .map(|r| r.join("\t"))
                    .filter(|l| !l.trim().is_empty())
                    .collect();
                if !lines.is_empty() {
                    emit(lines.join("\n"), stack, out);
                }
            }
            Ctx::Note {
                host_para_idx,
                at_byte,
                citation,
                parts,
            } => {
                let cit = decode_xml_entities(&citation).trim().to_owned();
                if let Some(idx) = host_para_idx {
                    if !cit.is_empty() {
                        if let Some(Ctx::Para { text, ws, .. }) = stack.get_mut(idx) {
                            let pos = at_byte.min(text.len());
                            text.insert_str(pos, &cit);
                            *ws = false;
                        }
                    }
                }
                let body = parts
                    .into_iter()
                    .filter(|p| !p.trim().is_empty())
                    .collect::<Vec<_>>()
                    .join(" ");
                if !cit.is_empty() {
                    notes.push(format!("{cit} {body}"));
                } else {
                    notes.push(body);
                }
            }
        }
    };

    loop {
        let ev = match reader.read_event() {
            Ok(ev) => ev,
            Err(_) => break,
        };
        match ev {
            Event::Eof => break,
            Event::Start(e) => {
                let attrs = attr_map(&e);
                if prefixes.is_none() {
                    prefixes = Some(PrefixMap::from_root_attrs(&attrs));
                }
                let pm = prefixes.as_ref().unwrap();
                let name = pm.canonical(&String::from_utf8_lossy(e.name().as_ref()));
                depth += 1;

                if !in_office_text {
                    if name == "office:text" {
                        in_office_text = true;
                        found_office_text = true;
                        office_text_depth = depth;
                    }
                    continue;
                }
                if skip_depth.is_some() {
                    continue;
                }
                if citation_depth.is_some() {
                    tag_pushed_ctx.push(false);
                    continue;
                }
                if name == "text:note-citation" {
                    citation_depth = Some(depth);
                    tag_pushed_ctx.push(false);
                    continue;
                }
                if is_skipped_odt(&name) {
                    skip_depth = Some(depth);
                    continue;
                }

                let mut pushed = false;
                match name.as_str() {
                    "text:p" | "text:h" => {
                        stack.push(Ctx::Para {
                            text: String::new(),
                            ws: true,
                            after: Vec::new(),
                        });
                        pushed = true;
                    }
                    "text:s" => {
                        let count = attrs
                            .iter()
                            .find(|(k, _)| pm.canonical(k) == "text:c")
                            .and_then(|(_, v)| v.parse::<usize>().ok())
                            .unwrap_or(1)
                            .clamp(1, 1000);
                        literal(&" ".repeat(count), &mut stack);
                        skip_depth = Some(depth);
                        continue;
                    }
                    "text:tab" => {
                        literal("\t", &mut stack);
                        skip_depth = Some(depth);
                        continue;
                    }
                    "text:line-break" => {
                        literal("\n", &mut stack);
                        skip_depth = Some(depth);
                        continue;
                    }
                    "table:table" => {
                        stack.push(Ctx::Table { rows: Vec::new() });
                        pushed = true;
                    }
                    "table:table-row" => {
                        for item in stack.iter_mut().rev() {
                            if let Ctx::Table { rows } = item {
                                rows.push(Vec::new());
                                break;
                            }
                        }
                    }
                    "table:table-cell" => {
                        stack.push(Ctx::Cell {
                            parts: Vec::new(),
                            is_covered: false,
                        });
                        pushed = true;
                    }
                    "table:covered-table-cell" => {
                        stack.push(Ctx::Cell {
                            parts: Vec::new(),
                            is_covered: true,
                        });
                        pushed = true;
                    }
                    "text:note" => {
                        let host_para_idx = match stack.last() {
                            Some(Ctx::Para { .. }) => Some(stack.len() - 1),
                            _ => None,
                        };
                        let at_byte = match host_para_idx.and_then(|i| stack.get(i)) {
                            Some(Ctx::Para { text, .. }) => text.len(),
                            _ => 0,
                        };
                        stack.push(Ctx::Note {
                            host_para_idx,
                            at_byte,
                            citation: String::new(),
                            parts: Vec::new(),
                        });
                        pushed = true;
                    }
                    _ => {}
                }
                tag_pushed_ctx.push(pushed);
            }
            Event::Empty(e) => {
                let attrs = attr_map(&e);
                if prefixes.is_none() {
                    prefixes = Some(PrefixMap::from_root_attrs(&attrs));
                }
                let pm = prefixes.as_ref().unwrap();
                let name = pm.canonical(&String::from_utf8_lossy(e.name().as_ref()));
                if !in_office_text {
                    if name == "office:text" {
                        found_office_text = true;
                        break;
                    }
                    continue;
                }
                if skip_depth.is_some() || citation_depth.is_some() || is_skipped_odt(&name) {
                    continue;
                }
                match name.as_str() {
                    "text:p" | "text:h" => {
                        emit(String::new(), &mut stack, &mut out);
                    }
                    "text:s" => {
                        let count = attrs
                            .iter()
                            .find(|(k, _)| pm.canonical(k) == "text:c")
                            .and_then(|(_, v)| v.parse::<usize>().ok())
                            .unwrap_or(1)
                            .clamp(1, 1000);
                        literal(&" ".repeat(count), &mut stack);
                    }
                    "text:tab" => literal("\t", &mut stack),
                    "text:line-break" => literal("\n", &mut stack),
                    "table:table-cell" => {
                        for item in stack.iter_mut().rev() {
                            if let Ctx::Table { rows } = item {
                                if let Some(row) = rows.last_mut() {
                                    row.push(String::new());
                                }
                                break;
                            }
                        }
                    }
                    _ => {}
                }
            }
            Event::End(_) => {
                if !in_office_text {
                    depth = depth.saturating_sub(1);
                    continue;
                }
                if let Some(sd) = skip_depth {
                    if depth == sd {
                        skip_depth = None;
                    }
                    depth = depth.saturating_sub(1);
                    continue;
                }
                if depth == office_text_depth {
                    break;
                }
                if let Some(cd) = citation_depth {
                    if depth == cd {
                        citation_depth = None;
                    }
                }
                if tag_pushed_ctx.pop().unwrap_or(false) {
                    close_ctx(&mut stack, &mut out, &mut notes);
                }
                depth = depth.saturating_sub(1);
            }
            Event::Text(e) => {
                if in_office_text && skip_depth.is_none() {
                    let s = String::from_utf8_lossy(e.as_ref());
                    add_text(&s, &mut stack, citation_depth.is_some());
                }
            }
            Event::GeneralRef(e) => {
                if in_office_text && skip_depth.is_none() {
                    let name = String::from_utf8_lossy(e.as_ref());
                    let decoded = resolve_xml_entity(&name).unwrap_or_else(|| format!("&{name};"));
                    add_text(&decoded, &mut stack, citation_depth.is_some());
                }
            }
            Event::CData(e) => {
                if in_office_text && skip_depth.is_none() {
                    let s = String::from_utf8_lossy(e.as_ref());
                    add_text(&s, &mut stack, citation_depth.is_some());
                }
            }
            _ => {}
        }
    }

    if !found_office_text {
        return Err(OdtError::Corrupt(
            "odt: content.xml has no office:text".to_owned(),
        ));
    }

    while !stack.is_empty() {
        close_ctx(&mut stack, &mut out, &mut notes);
    }

    let body = out.join("\n");
    if notes.is_empty() {
        Ok(body)
    } else {
        Ok(format!("{body}\n\n{}", notes.join("\n")))
    }
}
