use std::collections::HashMap;
use std::io::{Read, Seek};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::extract::rels::{normalize_zip_path, resolve_epub_href};
use crate::extract::xml_util::{XmlElement, XmlNode, parse_xml_tree, resolve_xml_entity};
use crate::protocol::RejectCode;
use crate::zip_gate::{ZipArchive, ZipGateError};

const CONTAINER_PATH: &str = "META-INF/container.xml";
const RIGHTS_PATH: &str = "META-INF/rights.xml";
const ENCRYPTION_PATH: &str = "META-INF/encryption.xml";
const OPF_MEDIA_TYPE: &str = "application/oebps-package+xml";
const IDPF_FONT_OBFUSCATION: &str = "http://www.idpf.org/2008/embedding";
const ADOBE_FONT_OBFUSCATION: &str = "http://ns.adobe.com/pdf/enc#RC";

#[derive(Debug)]
pub enum EpubError {
    Drm(String),
    Corrupt(String),
    Zip(ZipGateError),
}

impl EpubError {
    pub fn reject_code(&self) -> RejectCode {
        match self {
            EpubError::Drm(_) => RejectCode::PasswordProtected,
            EpubError::Corrupt(_) => RejectCode::Corrupt,
            EpubError::Zip(z) => z.reject_code(),
        }
    }

    pub fn message(&self) -> String {
        match self {
            EpubError::Drm(detail) => format!(
                "Copy-protected EPUB: the book is protected by DRM and cannot be read; open it in the app of the store it was bought from ({detail})"
            ),
            EpubError::Corrupt(m) => m.clone(),
            EpubError::Zip(z) => match z {
                ZipGateError::Rejected(detail) => {
                    format!("Cannot read EPUB: the file is too large to unpack safely ({detail})")
                }
                ZipGateError::Corrupt(detail) => {
                    format!("Cannot read EPUB: the file is damaged ({detail})")
                }
                ZipGateError::Io(err) => {
                    format!("Cannot read EPUB: the file is damaged ({err})")
                }
                ZipGateError::Cancelled => z.message(),
            },
        }
    }
}

impl From<ZipGateError> for EpubError {
    fn from(value: ZipGateError) -> Self {
        EpubError::Zip(value)
    }
}

fn is_font_obfuscation_algorithm(alg: &str) -> bool {
    alg == IDPF_FONT_OBFUSCATION || alg == ADOBE_FONT_OBFUSCATION
}

struct DecodedEntry {
    text: String,
    encoding: &'static str,
    valid: bool,
}

fn decode_entry_text(bytes: &[u8]) -> DecodedEntry {
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let valid = bytes.len() % 2 == 0 && {
            let units = bytes
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]));
            char::decode_utf16(units).all(|r| r.is_ok())
        };
        let (decoded, _) = encoding_rs::UTF_16LE.decode_without_bom_handling(bytes);
        return DecodedEntry {
            text: decoded.into_owned(),
            encoding: "utf-16le",
            valid,
        };
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let valid = bytes.len() % 2 == 0 && {
            let units = bytes
                .chunks_exact(2)
                .map(|c| u16::from_be_bytes([c[0], c[1]]));
            char::decode_utf16(units).all(|r| r.is_ok())
        };
        let (decoded, _) = encoding_rs::UTF_16BE.decode_without_bom_handling(bytes);
        return DecodedEntry {
            text: decoded.into_owned(),
            encoding: "utf-16be",
            valid,
        };
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => DecodedEntry {
            text: s.to_owned(),
            encoding: "utf-8",
            valid: true,
        },
        Err(_) => DecodedEntry {
            text: String::from_utf8_lossy(bytes).into_owned(),
            encoding: "utf-8",
            valid: false,
        },
    }
}

fn read_entry_ci<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
    path: &str,
) -> Result<Option<(String, DecodedEntry)>, ZipGateError> {
    let norm = normalize_zip_path(path);
    let Some(actual) = zip.find_case_insensitive(&norm).map(str::to_owned) else {
        return Ok(None);
    };
    let Some(bytes) = zip.read_entry_bytes(&actual)? else {
        return Ok(None);
    };
    Ok(Some((actual, decode_entry_text(&bytes))))
}

fn walk_elements<'a>(el: &'a XmlElement, out: &mut Vec<&'a XmlElement>) {
    out.push(el);
    for child in el.child_elements() {
        walk_elements(child, out);
    }
}

fn package_path_from_container(root: &XmlElement) -> Result<String, EpubError> {
    let mut all = Vec::new();
    walk_elements(root, &mut all);
    let rootfiles: Vec<&XmlElement> = all
        .into_iter()
        .filter(|el| el.local == "rootfile" && el.attr("full-path").is_some())
        .collect();
    let chosen = rootfiles
        .iter()
        .copied()
        .find(|el| el.attr("media-type").map(str::trim) == Some(OPF_MEDIA_TYPE))
        .or_else(|| rootfiles.first().copied());
    let resolved = chosen
        .and_then(|el| el.attr("full-path"))
        .and_then(|fp| resolve_epub_href("", fp))
        .filter(|p| !p.is_empty());
    resolved.ok_or_else(|| {
        EpubError::Corrupt(format!(
            "Cannot read EPUB: not an EPUB file, or a damaged one ({CONTAINER_PATH} names no package document)"
        ))
    })
}

fn scan_encryption(root: &XmlElement) -> Result<(), EpubError> {
    let mut all = Vec::new();
    walk_elements(root, &mut all);
    for el in all {
        if el.local == "EncryptionMethod" {
            let alg = el.attr("Algorithm").map(str::trim).unwrap_or("");
            if !is_font_obfuscation_algorithm(alg) {
                let shown = if alg.is_empty() { "(none)" } else { alg };
                return Err(EpubError::Drm(format!(
                    "{ENCRYPTION_PATH}: encryption algorithm {shown}"
                )));
            }
        }
        if el.local == "EncryptedData" {
            let alg = el
                .first_child_local("EncryptionMethod")
                .and_then(|m| m.attr("Algorithm"))
                .map(str::trim);
            match alg {
                Some(a) if is_font_obfuscation_algorithm(a) => {}
                other => {
                    return Err(EpubError::Drm(format!(
                        "{ENCRYPTION_PATH}: encrypted data with algorithm {}",
                        other.unwrap_or("(none)")
                    )));
                }
            }
        }
    }
    Ok(())
}

#[derive(Debug)]
enum TextNode {
    Element { name: String, children: Vec<TextNode> },
    Text(String),
}

fn from_xml_element(el: &XmlElement) -> TextNode {
    let children = el
        .children
        .iter()
        .map(|c| match c {
            XmlNode::Element(e) => from_xml_element(e),
            XmlNode::Text(t) => TextNode::Text(t.clone()),
        })
        .collect();
    TextNode::Element {
        name: el.local.clone(),
        children,
    }
}

fn is_html_void(tag: &str) -> bool {
    matches!(
        tag,
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
}

fn decode_html_entities(raw: &str) -> String {
    if !raw.contains('&') {
        return raw.to_owned();
    }
    let bytes = raw.as_bytes();
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'&' {
            if let Some(rel_semi) = raw[i + 1..].find(';') {
                let ent = &raw[i + 1..i + 1 + rel_semi];
                let resolved = resolve_xml_entity(ent).or_else(|| match ent {
                    "nbsp" => Some("\u{00A0}".to_owned()),
                    "mdash" => Some("\u{2014}".to_owned()),
                    "ndash" => Some("\u{2013}".to_owned()),
                    "hellip" => Some("\u{2026}".to_owned()),
                    "copy" => Some("\u{00A9}".to_owned()),
                    "lsquo" => Some("\u{2018}".to_owned()),
                    "rsquo" => Some("\u{2019}".to_owned()),
                    "ldquo" => Some("\u{201C}".to_owned()),
                    "rdquo" => Some("\u{201D}".to_owned()),
                    _ => None,
                });
                if let Some(val) = resolved {
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

/// Lenient HTML fallback parser for EPUB chapters that are not well-formed XML.
fn parse_lenient_html(source: &str) -> Vec<TextNode> {
    let bytes = source.as_bytes();
    let mut roots: Vec<TextNode> = Vec::new();
    let mut stack: Vec<(String, Vec<TextNode>)> = Vec::new();
    let mut i = 0;

    let push_node = |node: TextNode,
                     stack: &mut Vec<(String, Vec<TextNode>)>,
                     roots: &mut Vec<TextNode>| {
        if let Some((_, children)) = stack.last_mut() {
            children.push(node);
        } else {
            roots.push(node);
        }
    };

    while i < bytes.len() {
        if bytes[i] != b'<' {
            let next_lt = source[i..].find('<').map(|p| i + p).unwrap_or(bytes.len());
            let txt = decode_html_entities(&source[i..next_lt]);
            push_node(TextNode::Text(txt), &mut stack, &mut roots);
            i = next_lt;
            continue;
        }
        if source[i..].starts_with("<!--") {
            i = source[i + 4..]
                .find("-->")
                .map(|p| i + 4 + p + 3)
                .unwrap_or(bytes.len());
            continue;
        }
        if source[i..].starts_with("<![CDATA[") {
            let end = source[i + 9..]
                .find("]]>")
                .map(|p| i + 9 + p)
                .unwrap_or(bytes.len());
            push_node(
                TextNode::Text(source[i + 9..end].to_owned()),
                &mut stack,
                &mut roots,
            );
            i = (end + 3).min(bytes.len());
            continue;
        }
        if source[i..].starts_with("<?") || source[i..].starts_with("<!") {
            i = source[i + 2..]
                .find('>')
                .map(|p| i + 2 + p + 1)
                .unwrap_or(bytes.len());
            continue;
        }
        // Closing tag
        if i + 1 < bytes.len() && bytes[i + 1] == b'/' {
            let gt = source[i + 2..]
                .find('>')
                .map(|p| i + 2 + p)
                .unwrap_or(bytes.len());
            let name = source[i + 2..gt].trim().to_ascii_lowercase();
            if let Some(pos) = stack.iter().rposition(|(n, _)| *n == name) {
                while stack.len() > pos {
                    let (n, children) = stack.pop().unwrap();
                    push_node(
                        TextNode::Element { name: n, children },
                        &mut stack,
                        &mut roots,
                    );
                }
            }
            i = (gt + 1).min(bytes.len());
            continue;
        }
        // Start tag
        let mut j = i + 1;
        while j < bytes.len()
            && !matches!(bytes[j], b' ' | b'\t' | b'\n' | b'\r' | b'/' | b'>')
        {
            j += 1;
        }
        if j == i + 1 {
            push_node(TextNode::Text("<".to_owned()), &mut stack, &mut roots);
            i += 1;
            continue;
        }
        let raw_name = &source[i + 1..j];
        let local = match raw_name.rfind(':') {
            Some(c) => &raw_name[c + 1..],
            None => raw_name,
        }
        .to_ascii_lowercase();

        // Find end of start tag honoring quotes.
        let mut quote: Option<u8> = None;
        let mut k = j;
        while k < bytes.len() {
            let b = bytes[k];
            if let Some(q) = quote {
                if b == q {
                    quote = None;
                }
            } else if b == b'"' || b == b'\'' {
                quote = Some(b);
            } else if b == b'>' {
                break;
            }
            k += 1;
        }
        let self_closing = k > i + 1 && k < bytes.len() && bytes[k - 1] == b'/';
        i = (k + 1).min(bytes.len());

        // Skip raw text content of <script> and <style>.
        if (local == "script" || local == "style") && !self_closing {
            let needle = format!("</{local}");
            let lower_rest = source[i..].to_ascii_lowercase();
            if let Some(pos) = lower_rest.find(&needle) {
                let after = i + pos + needle.len();
                i = source[after..]
                    .find('>')
                    .map(|p| after + p + 1)
                    .unwrap_or(bytes.len());
            } else {
                i = bytes.len();
            }
            continue;
        }

        if self_closing || is_html_void(&local) {
            push_node(
                TextNode::Element {
                    name: local,
                    children: Vec::new(),
                },
                &mut stack,
                &mut roots,
            );
        } else {
            // HTML5 implicit end-tag rules for common malformed EPUB markup.
            let should_auto_close = |top: &str, incoming: &str| -> bool {
                if top == "p" && (is_block_tag(incoming) || heading_level(incoming).is_some()) {
                    return true;
                }
                if top == "li" && incoming == "li" {
                    return true;
                }
                if (top == "td" || top == "th") && (incoming == "td" || incoming == "th" || incoming == "tr") {
                    return true;
                }
                if top == "tr" && incoming == "tr" {
                    return true;
                }
                if heading_level(top).is_some() && heading_level(incoming).is_some() {
                    return true;
                }
                false
            };
            while let Some((top_name, _)) = stack.last() {
                if should_auto_close(top_name, &local) {
                    let (n, children) = stack.pop().unwrap();
                    push_node(
                        TextNode::Element { name: n, children },
                        &mut stack,
                        &mut roots,
                    );
                } else {
                    break;
                }
            }
            stack.push((local, Vec::new()));
        }
    }

    while let Some((n, children)) = stack.pop() {
        push_node(
            TextNode::Element { name: n, children },
            &mut stack,
            &mut roots,
        );
    }
    roots
}

fn find_body<'a>(nodes: &'a [TextNode]) -> Option<&'a [TextNode]> {
    for node in nodes {
        if let TextNode::Element { name, children } = node {
            if name == "body" {
                return Some(children);
            }
            if let Some(inner) = find_body(children) {
                return Some(inner);
            }
        }
    }
    None
}

fn is_skip_tag(name: &str) -> bool {
    matches!(
        name,
        "head" | "script" | "style" | "template" | "rt" | "rp" | "svg" | "math" | "noscript"
    )
}

fn is_block_tag(name: &str) -> bool {
    matches!(
        name,
        "address"
            | "article"
            | "aside"
            | "blockquote"
            | "caption"
            | "dd"
            | "details"
            | "dialog"
            | "div"
            | "dl"
            | "dt"
            | "fieldset"
            | "figcaption"
            | "figure"
            | "footer"
            | "form"
            | "header"
            | "hgroup"
            | "hr"
            | "legend"
            | "li"
            | "main"
            | "nav"
            | "ol"
            | "p"
            | "pre"
            | "section"
            | "summary"
            | "table"
            | "tbody"
            | "tfoot"
            | "thead"
            | "tr"
            | "ul"
    )
}

fn heading_level(name: &str) -> Option<usize> {
    let b = name.as_bytes();
    if b.len() == 2 && b[0] == b'h' && (b'1'..=b'6').contains(&b[1]) {
        Some((b[1] - b'0') as usize)
    } else {
        None
    }
}

fn collapse_html_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_ws = false;
    for ch in s.chars() {
        if matches!(ch, ' ' | '\t' | '\n' | '\r' | '\x0C') {
            if !in_ws {
                out.push(' ');
                in_ws = true;
            }
        } else {
            out.push(ch);
            in_ws = false;
        }
    }
    out
}

struct TextCollector {
    blocks: Vec<String>,
    current: String,
    pre: usize,
}

impl TextCollector {
    fn new() -> Self {
        Self {
            blocks: Vec::new(),
            current: String::new(),
            pre: 0,
        }
    }

    fn flush(&mut self, prefix: &str) {
        let joined = if self.pre > 0 {
            self.current.clone()
        } else {
            self.current
                .split('\n')
                .map(|line| line.trim_matches(' '))
                .collect::<Vec<_>>()
                .join("\n")
        };
        let text = joined.trim_matches('\n');
        self.current.clear();
        if !text.trim().is_empty() {
            if prefix.is_empty() {
                self.blocks.push(text.to_owned());
            } else {
                self.blocks.push(format!("{prefix}{text}"));
            }
        }
    }

    fn walk(&mut self, nodes: &[TextNode]) {
        for node in nodes {
            match node {
                TextNode::Text(val) => {
                    if self.pre > 0 {
                        self.current.push_str(val);
                    } else {
                        self.current.push_str(&collapse_html_ws(val));
                    }
                }
                TextNode::Element { name, children } => {
                    if is_skip_tag(name) {
                        continue;
                    }
                    if name == "br" {
                        self.current.push('\n');
                        continue;
                    }
                    if name == "td" || name == "th" {
                        if !self.current.trim().is_empty() {
                            self.current.push('\t');
                        }
                        self.walk(children);
                        continue;
                    }
                    if let Some(lvl) = heading_level(name) {
                        self.flush("");
                        self.walk(children);
                        self.flush(&format!("{} ", "#".repeat(lvl)));
                        continue;
                    }
                    if !is_block_tag(name) {
                        self.walk(children);
                        continue;
                    }
                    self.flush("");
                    if name == "pre" {
                        self.pre += 1;
                    }
                    self.walk(children);
                    self.flush("");
                    if name == "pre" {
                        self.pre -= 1;
                    }
                }
            }
        }
    }
}

pub fn extract_chapter_text(source: &str) -> String {
    let trimmed = source.trim_start_matches('\u{FEFF}');
    let roots = match parse_xml_tree(trimmed, true) {
        Ok(els) if !els.is_empty() => els.iter().map(from_xml_element).collect(),
        _ => parse_lenient_html(trimmed),
    };
    let mut collector = TextCollector::new();
    let target = find_body(&roots).unwrap_or(&roots);
    collector.walk(target);
    collector.flush("");
    collector.blocks.join("\n\n")
}

/// Extracts readable book text from a verified EPUB archive.
/// Matches `packages/file-parse/src/epub.ts` and `packages/epub-engine/src/open.ts`.
pub fn extract_epub<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
    cancelled: &AtomicBool,
) -> Result<String, EpubError> {
    // 1. Container
    let Some((_, container)) = read_entry_ci(zip, CONTAINER_PATH)? else {
        return Err(EpubError::Corrupt(format!(
            "Cannot read EPUB: not an EPUB file, or a damaged one (the archive has no {CONTAINER_PATH})"
        )));
    };
    let container_roots = parse_xml_tree(container.text.trim_start_matches('\u{FEFF}'), true)
        .map_err(|e| {
            EpubError::Corrupt(format!(
                "Cannot read EPUB: not an EPUB file, or a damaged one ({CONTAINER_PATH} is not well-formed XML: {e})"
            ))
        })?;
    let Some(container_root) = container_roots.first() else {
        return Err(EpubError::Corrupt(format!(
            "Cannot read EPUB: not an EPUB file, or a damaged one ({CONTAINER_PATH} has no root element)"
        )));
    };
    let opf_raw = package_path_from_container(container_root)?;
    let Some(opf_path) = zip.find_case_insensitive(&opf_raw).map(str::to_owned) else {
        return Err(EpubError::Corrupt(format!(
            "Cannot read EPUB: not an EPUB file, or a damaged one (the package document named in {CONTAINER_PATH} is missing)"
        )));
    };

    // 2. DRM
    if zip.find_case_insensitive(RIGHTS_PATH).is_some() {
        return Err(EpubError::Drm(format!("the archive has {RIGHTS_PATH}")));
    }
    if let Some((_, enc)) = read_entry_ci(zip, ENCRYPTION_PATH)? {
        let enc_roots = parse_xml_tree(enc.text.trim_start_matches('\u{FEFF}'), true).map_err(|e| {
            EpubError::Corrupt(format!(
                "Cannot read EPUB: not an EPUB file, or a damaged one ({ENCRYPTION_PATH} is not well-formed XML: {e})"
            ))
        })?;
        if let Some(enc_root) = enc_roots.first() {
            scan_encryption(enc_root)?;
        }
    }

    // 3. Package document (OPF)
    let Some((_, opf_decoded)) = read_entry_ci(zip, &opf_path)? else {
        return Err(EpubError::Corrupt(format!(
            "Cannot read EPUB: not an EPUB file, or a damaged one ({opf_path} is missing)"
        )));
    };
    let opf_roots = parse_xml_tree(opf_decoded.text.trim_start_matches('\u{FEFF}'), true)
        .map_err(|e| {
            EpubError::Corrupt(format!(
                "Cannot read EPUB: not an EPUB file, or a damaged one ({opf_path} is not well-formed XML: {e})"
            ))
        })?;
    let Some(pkg) = opf_roots.first().filter(|el| el.local == "package") else {
        return Err(EpubError::Corrupt(format!(
            "Cannot read EPUB: not an EPUB file, or a damaged one ({opf_path} is not a package document)"
        )));
    };
    let Some(manifest_el) = pkg.first_child_local("manifest") else {
        return Err(EpubError::Corrupt(format!(
            "Cannot read EPUB: not an EPUB file, or a damaged one ({opf_path} has no manifest)"
        )));
    };
    let Some(spine_el) = pkg.first_child_local("spine") else {
        return Err(EpubError::Corrupt(format!(
            "Cannot read EPUB: not an EPUB file, or a damaged one ({opf_path} has no spine)"
        )));
    };

    let mut manifest_by_id: HashMap<String, String> = HashMap::new();
    for item in manifest_el.children_local("item") {
        let Some(href) = item.attr("href") else {
            continue;
        };
        let id = item.attr("id").unwrap_or("").to_owned();
        if let Some(resolved) = resolve_epub_href(&opf_path, href) {
            let actual = zip
                .find_case_insensitive(&resolved)
                .map(str::to_owned)
                .unwrap_or(resolved);
            manifest_by_id.insert(id, actual);
        }
    }

    let mut spine_paths: Vec<String> = Vec::new();
    for itemref in spine_el.children_local("itemref") {
        let idref = itemref.attr("idref").map(str::trim).unwrap_or("");
        if let Some(path) = manifest_by_id.get(idref) {
            if let Some(actual) = zip.find_case_insensitive(path) {
                spine_paths.push(actual.to_owned());
            }
        }
    }
    if spine_paths.is_empty() {
        return Err(EpubError::Corrupt(format!(
            "Cannot read EPUB: not an EPUB file, or a damaged one ({opf_path} has no chapter in the archive)"
        )));
    }

    // 4. Chapters in spine order
    let mut parts = Vec::new();
    let mut decoded = 0usize;
    for (index, path) in spine_paths.iter().enumerate() {
        if cancelled.load(Ordering::Acquire) {
            return Err(EpubError::Zip(ZipGateError::Cancelled));
        }
        let Some((_, entry)) = read_entry_ci(zip, path)? else {
            continue;
        };
        if !entry.valid {
            parts.push(format!(
                "[Chapter {} ({path}) left out: its bytes are not valid {} text]",
                index + 1,
                entry.encoding
            ));
            continue;
        }
        decoded += 1;
        let text = extract_chapter_text(&entry.text);
        if !text.is_empty() {
            parts.push(text);
        }
    }

    if decoded == 0 {
        return Err(EpubError::Corrupt(
            "Cannot read EPUB: no chapter decodes as text (the book may be copy-protected)"
                .to_owned(),
        ));
    }

    Ok(parts.join("\n\n"))
}
