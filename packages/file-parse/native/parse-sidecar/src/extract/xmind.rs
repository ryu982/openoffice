use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek};

use serde_json::{Map, Value};

use crate::protocol::RejectCode;
use crate::zip_gate::{ZipArchive, ZipGateError};

const CONTENT_ENTRY: &str = "content.json";
const LEGACY_CONTENT_ENTRY: &str = "content.xml";
const MANIFEST_ENTRY: &str = "manifest.json";
const MAX_TOPIC_DEPTH: usize = 256;

const KIND_MARKS: [&str; 6] = [
    "(summary)",
    "(callout)",
    "(floating)",
    "(other)",
    "(boundary)",
    "(relationship)",
];

#[derive(Debug)]
pub enum XmindError {
    Encrypted(String),
    Corrupt(String),
    Zip(ZipGateError),
}

impl XmindError {
    pub fn reject_code(&self) -> RejectCode {
        match self {
            XmindError::Encrypted(_) => RejectCode::PasswordProtected,
            XmindError::Corrupt(_) => RejectCode::Corrupt,
            XmindError::Zip(z) => z.reject_code(),
        }
    }

    pub fn message(&self) -> String {
        match self {
            XmindError::Encrypted(m) | XmindError::Corrupt(m) => m.clone(),
            XmindError::Zip(z) => z.message(),
        }
    }
}

impl From<ZipGateError> for XmindError {
    fn from(value: ZipGateError) -> Self {
        XmindError::Zip(value)
    }
}

fn manifest_marks_encryption<R: Read + Seek>(zip: &mut ZipArchive<R>) -> bool {
    let Ok(Some(bytes)) = zip.read_entry_bytes(MANIFEST_ENTRY) else {
        return false;
    };
    let Ok(Value::Object(manifest)) = serde_json::from_slice::<Value>(&bytes) else {
        return false;
    };
    let Some(Value::Object(entries)) = manifest.get("file-entries") else {
        return false;
    };
    entries
        .values()
        .any(|v| v.as_object().is_some_and(|m| m.contains_key("encryption-data")))
}

fn looks_like_topic(value: &Value) -> bool {
    value
        .as_object()
        .and_then(|o| o.get("id"))
        .and_then(Value::as_str)
        .is_some_and(|s| !s.is_empty())
}

fn is_known_child_kind(kind: &str) -> bool {
    matches!(kind, "attached" | "detached" | "summary" | "callout")
}

fn check_sheet_topics(root_topic: Option<&Value>) -> Result<(), String> {
    let Some(root) = root_topic else {
        return Err("no central topic".to_owned());
    };
    let mut seen: HashSet<&str> = HashSet::new();
    let mut pending: Vec<(&Value, usize)> = vec![(root, 0)];
    while let Some((topic, depth)) = pending.pop() {
        let Some(obj) = topic.as_object() else {
            return Err("a topic is not an object".to_owned());
        };
        let Some(id) = obj.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()) else {
            return Err("a topic has no id".to_owned());
        };
        if !seen.insert(id) {
            return Err(format!("topic id {id} is used more than once"));
        }
        let Some(children_val) = obj.get("children") else {
            continue;
        };
        if children_val.is_null() {
            return Err(format!("the children of topic {id} are not an object"));
        }
        let Some(children) = children_val.as_object() else {
            return Err(format!("the children of topic {id} are not an object"));
        };
        for (kind, list_val) in children {
            let known = is_known_child_kind(kind);
            let Some(list) = list_val.as_array() else {
                if known {
                    return Err(format!("children.{kind} of topic {id} is not a list"));
                }
                continue;
            };
            let topics: Vec<&Value> = if known {
                list.iter().collect()
            } else {
                list.iter().filter(|v| looks_like_topic(v)).collect()
            };
            if !topics.is_empty() && depth + 1 > MAX_TOPIC_DEPTH {
                return Err(format!(
                    "topics are nested deeper than {MAX_TOPIC_DEPTH} levels"
                ));
            }
            for child in topics {
                pending.push((child, depth + 1));
            }
        }
    }
    Ok(())
}

fn check_content_structure(content: &Value) -> Result<&Vec<Value>, String> {
    let Some(sheets) = content.as_array() else {
        return Err("the top level is not a list of sheets".to_owned());
    };
    if sheets.is_empty() {
        return Err("the file has no sheet".to_owned());
    }
    for (index, sheet) in sheets.iter().enumerate() {
        let Some(obj) = sheet.as_object() else {
            return Err(format!("sheet {index} is not an object"));
        };
        if let Err(problem) = check_sheet_topics(obj.get("rootTopic")) {
            return Err(format!("sheet {index}: {problem}"));
        }
    }
    Ok(sheets)
}

fn one_line(value: Option<&Value>) -> String {
    let Some(s) = value.and_then(Value::as_str) else {
        return String::new();
    };
    let mut parts: Vec<&str> = Vec::new();
    for line in s.split(|c: char| {
        matches!(
            c,
            '\n' | '\r' | '\x0B' | '\x0C' | '\u{0085}' | '\u{2028}' | '\u{2029}'
        )
    }) {
        let t = line.trim();
        if !t.is_empty() {
            parts.push(t);
        }
    }
    parts.join(" ")
}

fn escape_inline_impl(text: &str, escape_comma: bool) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    for (i, &ch) in chars.iter().enumerate() {
        let needs_escape = match ch {
            '\\' | '[' | ']' => true,
            ',' if escape_comma => true,
            '<' => chars
                .get(i + 1)
                .is_some_and(|&n| n.is_ascii_alphabetic() || matches!(n, '/' | '!' | '?')),
            _ => false,
        };
        if needs_escape {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

fn escape_inline(text: &str) -> String {
    escape_inline_impl(text, false)
}

fn escape_label(text: &str) -> String {
    escape_inline_impl(text, true)
}

fn kind_mark_length(text: &str) -> usize {
    if !text.starts_with('(') {
        return 0;
    }
    let Some(mark) = KIND_MARKS.iter().find(|&&m| text.starts_with(m)) else {
        return 0;
    };
    let bytes = text.as_bytes();
    let mut end = mark.len();
    while end < bytes.len() && (bytes[end] == b' ' || bytes[end] == b'\t') {
        end += 1;
    }
    if end == mark.len() && end < bytes.len() {
        0
    } else {
        end
    }
}

fn is_rule_line(s: &str) -> bool {
    for marker in ['*', '-', '_'] {
        let mut count = 0usize;
        let mut ok = true;
        for ch in s.chars() {
            if ch == marker {
                count += 1;
            } else if ch == ' ' || ch == '\t' {
                continue;
            } else {
                ok = false;
                break;
            }
        }
        if ok && count >= 3 {
            return true;
        }
    }
    false
}

fn escape_title(title: &str) -> String {
    let text = escape_inline(title);
    let b = text.as_bytes();
    // Ordered list marker: ^(\d{1,9})(?=[.)](?:[ \t]|$))
    let mut digits = 0;
    while digits < b.len() && digits < 9 && b[digits].is_ascii_digit() {
        digits += 1;
    }
    if digits > 0 && digits < b.len() && (b[digits] == b'.' || b[digits] == b')') {
        let after = b.get(digits + 1).copied();
        if after.is_none() || matches!(after, Some(b' ' | b'\t')) {
            return format!("{}\\{}", &text[..digits], &text[digits..]);
        }
    }

    let bullet_start = !b.is_empty()
        && matches!(b[0], b'-' | b'+' | b'*')
        && (b.len() == 1 || matches!(b[1], b' ' | b'\t'));

    let heading_start = {
        let mut h = 0;
        while h < b.len() && h < 6 && b[h] == b'#' {
            h += 1;
        }
        h > 0 && (h == b.len() || matches!(b[h], b' ' | b'\t'))
    };
    let block_start = heading_start
        || text.starts_with('>')
        || text.starts_with("```")
        || text.starts_with("~~~");

    let starts_something = bullet_start
        || block_start
        || is_rule_line(&format!("- {text}"))
        || is_rule_line(&text)
        || kind_mark_length(&text) > 0;

    if starts_something {
        format!("\\{text}")
    } else {
        text
    }
}

fn escape_heading(title: &str) -> String {
    let text = escape_inline(title);
    let b = text.as_bytes();
    let mut start = b.len();
    while start > 0 && b[start - 1] == b'#' {
        start -= 1;
    }
    if start == b.len() {
        return text;
    }
    let closes = start == 0 || b[start - 1] == b' ' || b[start - 1] == b'\t';
    if closes {
        format!("{}\\{}", &text[..start], &text[start..])
    } else {
        text
    }
}

fn is_web_link(value: Option<&Value>) -> Option<&str> {
    let s = value.and_then(Value::as_str)?;
    let lower = s.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")
    {
        Some(s)
    } else {
        None
    }
}

fn encode_link(href: &str) -> String {
    let mut out = String::with_capacity(href.len());
    for ch in href.chars() {
        if ch.is_whitespace() || ch == '<' || ch == '>' {
            let mut buf = [0u8; 4];
            for &byte in ch.encode_utf8(&mut buf).as_bytes() {
                out.push_str(&format!("%{byte:02X}"));
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn html_note_to_plain_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let bytes = html.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            let end = html[i..].find('>').map(|p| i + p).unwrap_or(bytes.len());
            let tag = html[i + 1..end].trim();
            let lower = tag.to_ascii_lowercase();
            let is_br = lower == "br"
                || lower == "br/"
                || (lower.starts_with("br")
                    && lower[2..]
                        .trim_end_matches('/')
                        .chars()
                        .all(|c| c.is_ascii_whitespace()));
            let is_closing_block = matches!(
                lower.trim_start_matches('/').trim(),
                "div" | "p" | "li" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "tr"
            ) && lower.starts_with('/');

            if is_br {
                // Skip <br> immediately before </div|p|li>
                let after_gt = (end + 1).min(bytes.len());
                let rest_trimmed = html[after_gt..].trim_start();
                let lower_rest = rest_trimmed.to_ascii_lowercase();
                let before_close = lower_rest.starts_with("</div")
                    || lower_rest.starts_with("</p")
                    || lower_rest.starts_with("</li");
                if !before_close {
                    out.push('\n');
                }
            } else if is_closing_block {
                out.push('\n');
            }
            i = (end + 1).min(bytes.len());
        } else {
            let next_lt = html[i..].find('<').map(|p| i + p).unwrap_or(bytes.len());
            out.push_str(&decode_note_entities(&html[i..next_lt]));
            i = next_lt;
        }
    }
    out
}

fn decode_note_entities(raw: &str) -> String {
    if !raw.contains('&') {
        return raw.to_owned();
    }
    let bytes = raw.as_bytes();
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'&' {
            if let Some(rel_semi) = raw[i + 1..].find(';') {
                let name = &raw[i + 1..i + 1 + rel_semi];
                let decoded = if let Some(rest) = name.strip_prefix('#') {
                    let code = if let Some(hex) =
                        rest.strip_prefix('x').or_else(|| rest.strip_prefix('X'))
                    {
                        u32::from_str_radix(hex, 16).ok()
                    } else {
                        rest.parse::<u32>().ok()
                    };
                    code.filter(|&c| c > 0 && c <= 0x10FFFF)
                        .and_then(char::from_u32)
                        .map(|c| c.to_string())
                } else {
                    match name.to_ascii_lowercase().as_str() {
                        "nbsp" => Some(" ".to_owned()),
                        "lt" => Some("<".to_owned()),
                        "gt" => Some(">".to_owned()),
                        "amp" => Some("&".to_owned()),
                        "quot" => Some("\"".to_owned()),
                        "apos" => Some("'".to_owned()),
                        _ => None,
                    }
                };
                if let Some(val) = decoded {
                    out.push_str(&val);
                    i += rel_semi + 2;
                    continue;
                }
            }
        }
        let ch = raw[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn spans_text(spans: Option<&Value>) -> String {
    let Some(arr) = spans.and_then(Value::as_array) else {
        return String::new();
    };
    let mut text = String::new();
    for span in arr {
        let Some(obj) = span.as_object() else {
            continue;
        };
        if let Some(t) = obj.get("text").and_then(Value::as_str) {
            text.push_str(t);
        } else if let Some(nested) = obj.get("spans") {
            text.push_str(&spans_text(Some(nested)));
        }
    }
    text
}

fn note_text(notes: Option<&Value>) -> Option<String> {
    let obj = notes?.as_object()?;
    if let Some(plain) = obj
        .get("plain")
        .and_then(Value::as_object)
        .and_then(|p| p.get("content"))
        .and_then(Value::as_str)
    {
        return Some(plain.to_owned());
    }
    if let Some(rich) = obj
        .get("realHTML")
        .and_then(Value::as_object)
        .and_then(|p| p.get("content"))
        .and_then(Value::as_str)
    {
        return Some(html_note_to_plain_text(rich));
    }
    let paragraphs = obj
        .get("html")
        .and_then(Value::as_object)
        .and_then(|h| h.get("content"))
        .and_then(Value::as_object)
        .and_then(|c| c.get("paragraphs"))
        .and_then(Value::as_array)?;
    let mut text = String::new();
    let mut saw_para = false;
    for p in paragraphs {
        let Some(pobj) = p.as_object() else {
            continue;
        };
        saw_para = true;
        text.push_str(&spans_text(pobj.get("spans")));
        text.push('\n');
    }
    if saw_para { Some(text) } else { None }
}

fn note_lines(notes: Option<&Value>) -> Vec<String> {
    let Some(text) = note_text(notes) else {
        return Vec::new();
    };
    let mut lines: Vec<String> = Vec::new();
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    for l in normalized.split('\n') {
        lines.push(l.to_owned());
    }
    while lines.last().is_some_and(|l| l.trim().is_empty()) {
        lines.pop();
    }
    lines
}

fn topics_below<'a>(topic: &'a Map<String, Value>) -> Vec<(Option<&'static str>, &'a Map<String, Value>)> {
    let Some(children) = topic.get("children").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let ordered: [(&str, Option<&'static str>); 4] = [
        ("attached", None),
        ("summary", Some("(summary)")),
        ("callout", Some("(callout)")),
        ("detached", Some("(floating)")),
    ];
    for (name, kind) in ordered {
        if let Some(arr) = children.get(name).and_then(Value::as_array) {
            for item in arr {
                if looks_like_topic(item) {
                    out.push((kind, item.as_object().unwrap()));
                }
            }
        }
    }
    for (name, val) in children {
        if is_known_child_kind(name) {
            continue;
        }
        if let Some(arr) = val.as_array() {
            for item in arr {
                if looks_like_topic(item) {
                    out.push((Some("(other)"), item.as_object().unwrap()));
                }
            }
        }
    }
    out
}

fn relationship_texts(sheet: &Map<String, Value>) -> HashMap<String, Vec<String>> {
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    let Some(rels) = sheet.get("relationships").and_then(Value::as_array) else {
        return out;
    };
    let titled: Vec<&Map<String, Value>> = rels
        .iter()
        .filter_map(Value::as_object)
        .filter(|r| !one_line(r.get("title")).is_empty())
        .collect();
    if titled.is_empty() {
        return out;
    }
    let Some(root) = sheet.get("rootTopic").and_then(Value::as_object) else {
        return out;
    };
    let root_id = root
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();

    let mut titles: HashMap<String, String> = HashMap::new();
    let mut pending = vec![root];
    while let Some(topic) = pending.pop() {
        if let Some(id) = topic.get("id").and_then(Value::as_str) {
            titles.insert(id.to_owned(), one_line(topic.get("title")));
        }
        for (_, child) in topics_below(topic) {
            pending.push(child);
        }
    }

    for line in titled {
        let end1 = line.get("end1Id").and_then(Value::as_str);
        let end2 = line.get("end2Id").and_then(Value::as_str);
        let from = match end1 {
            Some(id) if titles.contains_key(id) => id.to_owned(),
            _ => root_id.clone(),
        };
        let target = end2.and_then(|id| titles.get(id)).map(String::as_str).unwrap_or("");
        let title_str = one_line(line.get("title"));
        let text = if target.is_empty() {
            title_str
        } else {
            format!("{title_str} -> {target}")
        };
        out.entry(from).or_default().push(escape_title(&text));
    }
    out
}

fn spaced(text: &str) -> String {
    if text.is_empty() {
        String::new()
    } else {
        format!(" {text}")
    }
}

fn write_topic(
    topic: &Map<String, Value>,
    level: usize,
    kind_mark: Option<&'static str>,
    relationships: &HashMap<String, Vec<String>>,
    lines: &mut Vec<String>,
) {
    let indent = "  ".repeat(level);
    let below = format!("{indent}  ");

    let mut parts: Vec<String> = Vec::new();
    if let Some(km) = kind_mark {
        parts.push(km.to_owned());
    }
    let title = escape_title(&one_line(topic.get("title")));
    if !title.is_empty() {
        parts.push(title);
    }
    if let Some(labels_arr) = topic.get("labels").and_then(Value::as_array) {
        let labels: Vec<String> = labels_arr
            .iter()
            .filter_map(Value::as_str)
            .map(|l| escape_label(&one_line(Some(&Value::String(l.to_owned())))))
            .filter(|l| !l.is_empty())
            .collect();
        if !labels.is_empty() {
            parts.push(format!("[{}]", labels.join(", ")));
        }
    }
    if let Some(href) = is_web_link(topic.get("href")) {
        parts.push(format!("<{}>", encode_link(href)));
    }
    let joined = parts.join(" ");
    lines.push(format!("{indent}-{}", spaced(&joined)));

    for note_line in note_lines(topic.get("notes")) {
        lines.push(format!("{below}>{}", spaced(&note_line)));
    }

    for (child_kind, child) in topics_below(topic) {
        write_topic(child, level + 1, child_kind, relationships, lines);
    }

    if let Some(boundaries) = topic.get("boundaries").and_then(Value::as_array) {
        for b in boundaries.iter().filter_map(Value::as_object) {
            let btitle = escape_title(&one_line(b.get("title")));
            if !btitle.is_empty() {
                lines.push(format!("{below}- (boundary) {btitle}"));
            }
        }
    }
    if let Some(id) = topic.get("id").and_then(Value::as_str) {
        if let Some(rels) = relationships.get(id) {
            for text in rels {
                lines.push(format!("{below}- (relationship) {text}"));
            }
        }
    }
}

fn sheet_to_outline(sheet: &Map<String, Value>) -> String {
    let title = escape_heading(&one_line(sheet.get("title")));
    let mut lines = vec![
        if title.is_empty() {
            "#".to_owned()
        } else {
            format!("# {title}")
        },
        String::new(),
    ];
    let Some(root) = sheet.get("rootTopic").and_then(Value::as_object) else {
        return format!("{}\n", lines.join("\n"));
    };
    let rels = relationship_texts(sheet);
    write_topic(root, 0, None, &rels, &mut lines);
    format!("{}\n", lines.join("\n"))
}

/// Extracts outline text from a verified XMind archive.
/// Matches `packages/file-parse/src/xmind.ts` and `packages/xmind-engine/src/{open,outline}.ts`.
pub fn extract_xmind<R: Read + Seek>(zip: &mut ZipArchive<R>) -> Result<String, XmindError> {
    if !zip.has_file(CONTENT_ENTRY) {
        if zip.has_file(LEGACY_CONTENT_ENTRY) {
            return Err(XmindError::Corrupt(format!(
                "Cannot read mind map (legacy-format): the file has {LEGACY_CONTENT_ENTRY} but no {CONTENT_ENTRY}"
            )));
        }
        return Err(XmindError::Corrupt(format!(
            "Cannot read mind map (unreadable): the archive has no {CONTENT_ENTRY}"
        )));
    }

    if manifest_marks_encryption(zip) {
        return Err(XmindError::Encrypted(format!(
            "Cannot read mind map (encrypted): {MANIFEST_ENTRY} marks the content as encrypted"
        )));
    }

    let content_bytes = zip
        .read_entry_bytes(CONTENT_ENTRY)?
        .ok_or_else(|| XmindError::Corrupt(format!("Cannot read mind map (unreadable): the archive has no {CONTENT_ENTRY}")))?;
    let content_str = std::str::from_utf8(&content_bytes).map_err(|e| {
        XmindError::Corrupt(format!(
            "Cannot read mind map (unreadable): {CONTENT_ENTRY} cannot be parsed: {e}"
        ))
    })?;
    let content_val: Value = serde_json::from_str(content_str.trim_start_matches('\u{FEFF}'))
        .map_err(|e| {
            XmindError::Corrupt(format!(
                "Cannot read mind map (unreadable): {CONTENT_ENTRY} cannot be parsed: {e}"
            ))
        })?;

    let sheets = check_content_structure(&content_val).map_err(|problem| {
        XmindError::Corrupt(format!(
            "Cannot read mind map (unreadable): {CONTENT_ENTRY}: {problem}"
        ))
    })?;

    if !zip.carries_every_entry() {
        return Err(XmindError::Corrupt(
            "Cannot read mind map (unreadable): the archive has entries a save could not carry over by name".to_owned(),
        ));
    }

    let rendered: Vec<String> = sheets
        .iter()
        .filter_map(Value::as_object)
        .map(sheet_to_outline)
        .collect();
    Ok(rendered.join("\n"))
}
