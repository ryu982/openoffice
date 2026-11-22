use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};

pub fn local_name(name: &str) -> &str {
    match name.rfind(':') {
        Some(idx) => &name[idx + 1..],
        None => name,
    }
}

pub fn decode_xml_entities(raw: &str) -> String {
    if !raw.contains('&') {
        return raw.to_owned();
    }
    let bytes = raw.as_bytes();
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'&' {
            if let Some(rel_semi) = raw[i + 1..].find(';') {
                let entity = &raw[i + 1..i + 1 + rel_semi];
                if let Some(decoded) = resolve_xml_entity(entity) {
                    out.push_str(&decoded);
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

pub fn resolve_xml_entity(entity: &str) -> Option<String> {
    if let Some(rest) = entity.strip_prefix('#') {
        let code = if let Some(hex) = rest.strip_prefix('x').or_else(|| rest.strip_prefix('X')) {
            u32::from_str_radix(hex, 16).ok()?
        } else {
            rest.parse::<u32>().ok()?
        };
        let ch = char::from_u32(code)?;
        return Some(ch.to_string());
    }
    match entity {
        "amp" => Some("&".to_owned()),
        "lt" => Some("<".to_owned()),
        "gt" => Some(">".to_owned()),
        "quot" => Some("\"".to_owned()),
        "apos" => Some("'".to_owned()),
        _ => None,
    }
}

pub fn attr_map(start: &BytesStart<'_>) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for attr in start.attributes().flatten() {
        let key = String::from_utf8_lossy(attr.key.as_ref()).into_owned();
        let val = match attr.unescape_value() {
            Ok(v) => v.into_owned(),
            Err(_) => decode_xml_entities(&String::from_utf8_lossy(attr.value.as_ref())),
        };
        out.push((key, val));
    }
    out
}

pub fn get_attr<'a>(attrs: &'a [(String, String)], name: &str) -> Option<&'a str> {
    attrs
        .iter()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.as_str())
}

pub fn get_attr_local<'a>(attrs: &'a [(String, String)], local: &str) -> Option<&'a str> {
    attrs
        .iter()
        .find(|(k, _)| local_name(k) == local)
        .map(|(_, v)| v.as_str())
}

/// Relationship id lookup matching `relationshipId` in `pptx.ts` and `xlsx.ts`:
/// prefers a namespace-qualified `*:id` attribute, then bare `id`.
pub fn get_rel_id<'a>(attrs: &'a [(String, String)]) -> Option<&'a str> {
    if let Some((_, v)) = attrs.iter().find(|(k, _)| {
        if let Some(colon) = k.find(':') {
            colon > 0 && &k[colon + 1..] == "id"
        } else {
            false
        }
    }) {
        return Some(v.as_str());
    }
    get_attr(attrs, "id")
}

#[derive(Debug, Clone)]
pub enum XmlNode {
    Element(XmlElement),
    Text(String),
}

#[derive(Debug, Clone)]
pub struct XmlElement {
    pub name: String,
    pub local: String,
    pub attrs: Vec<(String, String)>,
    pub children: Vec<XmlNode>,
}

impl XmlElement {
    pub fn attr(&self, name: &str) -> Option<&str> {
        get_attr(&self.attrs, name)
    }

    pub fn attr_local(&self, local: &str) -> Option<&str> {
        get_attr_local(&self.attrs, local)
    }

    pub fn child_elements(&self) -> impl Iterator<Item = &XmlElement> {
        self.children.iter().filter_map(|n| match n {
            XmlNode::Element(el) => Some(el),
            XmlNode::Text(_) => None,
        })
    }

    pub fn first_child_local(&self, local: &str) -> Option<&XmlElement> {
        self.child_elements().find(|el| el.local == local)
    }

    pub fn children_local<'a>(&'a self, local: &'a str) -> impl Iterator<Item = &'a XmlElement> {
        self.child_elements().filter(move |el| el.local == local)
    }

    pub fn text_content(&self) -> String {
        let mut out = String::new();
        for node in &self.children {
            match node {
                XmlNode::Text(t) => out.push_str(t),
                XmlNode::Element(el) => out.push_str(&el.text_content()),
            }
        }
        out
    }

    pub fn direct_text(&self) -> String {
        let mut out = String::new();
        for node in &self.children {
            if let XmlNode::Text(t) = node {
                out.push_str(t);
            }
        }
        out
    }
}

/// Parses XML into an order-preserving `XmlElement` tree without trimming text
/// or coercing numeric values. When `strict` is true, returns `Err` on malformed XML.
pub fn parse_xml_tree(xml: &str, strict: bool) -> Result<Vec<XmlElement>, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    reader.config_mut().check_end_names = strict;

    let mut roots: Vec<XmlElement> = Vec::new();
    let mut stack: Vec<XmlElement> = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                let local = local_name(&name).to_owned();
                let attrs = attr_map(&e);
                stack.push(XmlElement {
                    name,
                    local,
                    attrs,
                    children: Vec::new(),
                });
            }
            Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                let local = local_name(&name).to_owned();
                let attrs = attr_map(&e);
                let el = XmlElement {
                    name,
                    local,
                    attrs,
                    children: Vec::new(),
                };
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(XmlNode::Element(el));
                } else {
                    roots.push(el);
                }
            }
            Ok(Event::End(e)) => {
                let end_name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                if strict {
                    let Some(el) = stack.pop() else {
                        return Err(format!("unexpected closing tag </{end_name}>"));
                    };
                    if el.name != end_name {
                        return Err(format!("mismatched closing tag </{end_name}>"));
                    }
                    if let Some(parent) = stack.last_mut() {
                        parent.children.push(XmlNode::Element(el));
                    } else {
                        roots.push(el);
                    }
                } else if let Some(el) = stack.pop() {
                    if let Some(parent) = stack.last_mut() {
                        parent.children.push(XmlNode::Element(el));
                    } else {
                        roots.push(el);
                    }
                }
            }
            Ok(Event::Text(e)) => {
                let txt = String::from_utf8_lossy(e.as_ref()).into_owned();
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(XmlNode::Text(txt));
                }
            }
            Ok(Event::GeneralRef(e)) => {
                let name = String::from_utf8_lossy(e.as_ref());
                let decoded = resolve_xml_entity(&name).unwrap_or_else(|| format!("&{name};"));
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(XmlNode::Text(decoded));
                }
            }
            Ok(Event::CData(e)) => {
                let txt = String::from_utf8_lossy(e.as_ref()).into_owned();
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(XmlNode::Text(txt));
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(err) => {
                if strict {
                    return Err(err.to_string());
                }
                break;
            }
        }
    }

    if strict && !stack.is_empty() {
        return Err("unclosed XML element".to_owned());
    }
    while let Some(el) = stack.pop() {
        if let Some(parent) = stack.last_mut() {
            parent.children.push(XmlNode::Element(el));
        } else {
            roots.push(el);
        }
    }
    Ok(roots)
}

#[derive(Debug, Clone)]
pub struct Relationship {
    pub id: String,
    pub rel_type: String,
    pub target: String,
    pub external: bool,
}

pub fn parse_relationships(rels_xml: &str) -> Vec<Relationship> {
    let Ok(roots) = parse_xml_tree(rels_xml, false) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for root in roots {
        if root.local != "Relationships" {
            continue;
        }
        for el in root.children_local("Relationship") {
            let id = el.attr("Id").unwrap_or("").trim().to_owned();
            let rel_type = el.attr("Type").unwrap_or("").trim().to_owned();
            let target = el.attr("Target").unwrap_or("").trim().to_owned();
            let external = el
                .attr("TargetMode")
                .map(|m| m.trim().eq_ignore_ascii_case("external"))
                .unwrap_or(false);
            out.push(Relationship {
                id,
                rel_type,
                target,
                external,
            });
        }
    }
    out
}
