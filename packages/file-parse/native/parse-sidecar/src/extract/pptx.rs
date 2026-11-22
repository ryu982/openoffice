use std::collections::HashMap;
use std::io::{Read, Seek};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::extract::rels::resolve_target;
use crate::extract::xml_util::{
    XmlElement, XmlNode, get_rel_id, parse_relationships, parse_xml_tree,
};
use crate::zip_gate::{ZipArchive, ZipGateError};

const PPTX_REDACT_EXT_URI: &str = "{9F1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D}";
const NOTES_SLIDE_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
const NOTES_SLIDE_REL_STRICT: &str =
    "http://purl.oclc.org/ooxml/officeDocument/relationships/notesSlide";
const COMMENT_AUTHOR_PATHS: [&str; 2] = ["ppt/commentAuthors.xml", "ppt/authors.xml"];

#[derive(Debug)]
pub enum PptxExtractOutcome {
    Ok(String),
    RedactionPresent,
}

/// Fail-closed redaction boundary check.
/// Returns true if any trace of the redaction extension URI, any runtime
/// `redactNamespaces` entry, or any `:redact` tag/prefix appears in the XML part.
pub fn has_redaction_trace(xml: &str, redact_namespaces: &[String]) -> bool {
    if xml.contains(PPTX_REDACT_EXT_URI) || xml.contains(":redact") {
        return true;
    }
    for ns in redact_namespaces {
        if !ns.is_empty() && xml.contains(ns.as_str()) {
            return true;
        }
    }
    false
}

fn rels_path_for(part_path: &str) -> String {
    match part_path.rfind('/') {
        Some(slash) => format!(
            "{}/_rels/{}.rels",
            &part_path[..slash],
            &part_path[slash + 1..]
        ),
        None => format!("_rels/{part_path}.rels"),
    }
}

fn slide_number(path: &str) -> usize {
    let Some(rest) = path.strip_prefix("ppt/slides/slide") else {
        return 0;
    };
    let Some(digits) = rest.strip_suffix(".xml") else {
        return 0;
    };
    digits.parse::<usize>().unwrap_or(0)
}

fn is_legacy_slide_path(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("ppt/slides/slide") else {
        return false;
    };
    let Some(digits) = rest.strip_suffix(".xml") else {
        return false;
    };
    !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
}

fn presentation_slide_entries<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
) -> Result<Option<Vec<Option<String>>>, ZipGateError> {
    let mut presentation_path = "ppt/presentation.xml".to_owned();
    if let Some(pkg_rels) = zip.read_entry_string("_rels/.rels")? {
        for rel in parse_relationships(&pkg_rels) {
            if !rel.rel_type.ends_with("/officeDocument") || rel.external || rel.target.is_empty() {
                continue;
            }
            let resolved = resolve_target("", &rel.target);
            if !resolved.is_empty() {
                presentation_path = resolved;
                break;
            }
        }
    }
    let Some(pres_xml) = zip.read_entry_string(&presentation_path)? else {
        return Ok(None);
    };
    let Ok(roots) = parse_xml_tree(&pres_xml, false) else {
        return Ok(Some(Vec::new()));
    };

    let mut rel_map: HashMap<String, (String, String, bool)> = HashMap::new();
    if let Some(rels_xml) = zip.read_entry_string(&rels_path_for(&presentation_path))? {
        for rel in parse_relationships(&rels_xml) {
            if !rel.id.is_empty() {
                rel_map.insert(rel.id, (rel.target, rel.rel_type, rel.external));
            }
        }
    }

    let mut entries = Vec::new();
    if let Some(pres) = roots.iter().find(|r| r.local == "presentation") {
        if let Some(sld_id_lst) = pres.first_child_local("sldIdLst") {
            for sld_id in sld_id_lst.children_local("sldId") {
                let rid = get_rel_id(&sld_id.attrs).unwrap_or("").trim();
                let entry = rel_map.get(rid).and_then(|(target, rel_type, external)| {
                    if !*external && !target.is_empty() && rel_type.ends_with("/slide") {
                        Some(resolve_target(&presentation_path, target))
                    } else {
                        None
                    }
                });
                entries.push(entry);
            }
        }
    }
    Ok(Some(entries))
}

fn legacy_slide_paths<R: Read + Seek>(zip: &ZipArchive<R>) -> Vec<String> {
    let mut paths: Vec<String> = zip
        .entry_names()
        .into_iter()
        .filter(|p| is_legacy_slide_path(p))
        .map(str::to_owned)
        .collect();
    paths.sort_by_key(|p| slide_number(p));
    paths
}

fn mc_branch(alt: &XmlElement) -> &[XmlNode] {
    let mut first_choice: Option<&[XmlNode]> = None;
    for child in alt.child_elements() {
        if child.local == "Fallback" {
            return &child.children;
        }
        if child.local == "Choice" && first_choice.is_none() {
            first_choice = Some(&child.children);
        }
    }
    first_choice.unwrap_or(&[])
}

fn collect_text(nodes: &[XmlNode], out: &mut String, is_text: bool) {
    for node in nodes {
        match node {
            XmlNode::Text(t) => {
                if is_text {
                    out.push_str(t);
                }
            }
            XmlNode::Element(el) => match el.local.as_str() {
                "br" => out.push('\n'),
                "tab" => out.push('\t'),
                "AlternateContent" => collect_text(mc_branch(el), out, false),
                "t" => collect_text(&el.children, out, true),
                _ => collect_text(&el.children, out, false),
            },
        }
    }
}

fn collect_paragraphs(nodes: &[XmlNode], out: &mut Vec<String>) {
    for node in nodes {
        let XmlNode::Element(el) = node else {
            continue;
        };
        if el.local == "p" {
            let mut line = String::new();
            collect_text(&el.children, &mut line, false);
            if !line.trim().is_empty() {
                out.push(line);
            }
        } else if el.local == "AlternateContent" {
            collect_paragraphs(mc_branch(el), out);
        } else {
            collect_paragraphs(&el.children, out);
        }
    }
}

fn count_pictures(nodes: &[XmlNode]) -> usize {
    let mut count = 0;
    for node in nodes {
        let XmlNode::Element(el) = node else {
            continue;
        };
        if el.local == "pic" {
            count += 1;
        } else if el.local == "AlternateContent" {
            count += count_pictures(mc_branch(el));
        } else {
            count += count_pictures(&el.children);
        }
    }
    count
}

fn notes_paragraphs(notes_xml: &str) -> Vec<String> {
    let Ok(roots) = parse_xml_tree(notes_xml, false) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let Some(notes) = roots.iter().find(|r| r.local == "notes") else {
        return out;
    };
    let Some(c_sld) = notes.first_child_local("cSld") else {
        return out;
    };
    let Some(sp_tree) = c_sld.first_child_local("spTree") else {
        return out;
    };

    fn walk_shapes(nodes: &[XmlNode], out: &mut Vec<String>) {
        for node in nodes {
            let XmlNode::Element(el) = node else {
                continue;
            };
            match el.local.as_str() {
                "grpSp" => walk_shapes(&el.children, out),
                "AlternateContent" => walk_shapes(mc_branch(el), out),
                "sp" => {
                    let is_body = el
                        .first_child_local("nvSpPr")
                        .and_then(|nv| nv.first_child_local("nvPr"))
                        .and_then(|nvpr| nvpr.first_child_local("ph"))
                        .and_then(|ph| ph.attr("type"))
                        == Some("body");
                    if is_body {
                        if let Some(tx_body) = el.first_child_local("txBody") {
                            collect_paragraphs(&tx_body.children, out);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    walk_shapes(&sp_tree.children, &mut out);
    out
}

struct SlideCommentLine {
    author: String,
    dt: String,
    text: String,
}

fn load_comment_authors<R: Read + Seek>(zip: &mut ZipArchive<R>) -> HashMap<String, String> {
    let mut authors = HashMap::new();
    for path in COMMENT_AUTHOR_PATHS {
        let Ok(Some(xml)) = zip.read_entry_string(path) else {
            continue;
        };
        let Ok(roots) = parse_xml_tree(&xml, true) else {
            continue;
        };
        for root in roots {
            if root.local != "cmAuthorLst" && root.local != "authorLst" {
                continue;
            }
            for entry in root.child_elements() {
                if entry.local != "cmAuthor" && entry.local != "author" {
                    continue;
                }
                let Some(id) = entry.attr("id") else {
                    continue;
                };
                let Some(name) = entry.attr("name") else {
                    continue;
                };
                if !id.is_empty() && !name.trim().is_empty() {
                    authors.insert(id.to_owned(), name.to_owned());
                }
            }
        }
    }
    authors
}

fn is_comments_relationship(rel_type: &str) -> bool {
    rel_type.to_ascii_lowercase().ends_with("/comments")
}

fn slide_related_xml<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
    slide_path: &str,
) -> Result<(Option<String>, Option<String>), ZipGateError> {
    let Some(rels_xml) = zip.read_entry_string(&rels_path_for(slide_path))? else {
        return Ok((None, None));
    };
    let mut notes_target: Option<String> = None;
    let mut comments_target: Option<String> = None;
    for rel in parse_relationships(&rels_xml) {
        if rel.external || rel.target.is_empty() {
            continue;
        }
        if notes_target.is_none()
            && (rel.rel_type == NOTES_SLIDE_REL || rel.rel_type == NOTES_SLIDE_REL_STRICT)
        {
            notes_target = Some(resolve_target(slide_path, &rel.target));
        } else if comments_target.is_none() && is_comments_relationship(&rel.rel_type) {
            comments_target = Some(resolve_target(slide_path, &rel.target));
        }
    }
    let notes_xml = match notes_target {
        Some(p) if !p.is_empty() => zip.read_entry_string(&p)?,
        _ => None,
    };
    let comments_xml = match comments_target {
        Some(p) if !p.is_empty() => match zip.read_entry_string(&p) {
            Ok(v) => v,
            Err(ZipGateError::Cancelled) => return Err(ZipGateError::Cancelled),
            Err(_) => None,
        },
        _ => None,
    };
    Ok((notes_xml, comments_xml))
}

fn push_comment(
    out: &mut Vec<SlideCommentLine>,
    el: &XmlElement,
    authors: &HashMap<String, String>,
) {
    let author_id = el.attr("authorId").unwrap_or("");
    let author = authors
        .get(author_id)
        .filter(|n| !n.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| "Unknown author".to_owned());
    let dt = el
        .attr("dt")
        .filter(|s| !s.is_empty())
        .or_else(|| el.attr("created"))
        .unwrap_or("")
        .to_owned();
    let text = if let Some(text_el) = el.first_child_local("text") {
        text_el.direct_text()
    } else if let Some(tx_body) = el.first_child_local("txBody") {
        let mut paras = Vec::new();
        collect_paragraphs(&tx_body.children, &mut paras);
        paras.join("\n")
    } else {
        String::new()
    };
    out.push(SlideCommentLine { author, dt, text });
}

fn parse_slide_comments(
    xml: Option<&str>,
    authors: &HashMap<String, String>,
) -> Vec<SlideCommentLine> {
    let Some(xml) = xml else {
        return Vec::new();
    };
    let Ok(roots) = parse_xml_tree(xml, true) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for root in roots {
        if root.local != "cmLst" {
            continue;
        }
        for cm in root.children_local("cm") {
            push_comment(&mut out, cm, authors);
            if let Some(reply_lst) = cm.first_child_local("replyLst") {
                for reply in reply_lst.children_local("reply") {
                    push_comment(&mut out, reply, authors);
                }
            }
        }
    }
    out
}

struct SlideSection {
    section: String,
    has_text: bool,
    pictures: usize,
}

fn build_slide_section(
    heading: String,
    slide_xml: &str,
    notes_xml: Option<&str>,
    comments: Vec<SlideCommentLine>,
) -> SlideSection {
    let tree = parse_xml_tree(slide_xml, false).unwrap_or_default();
    let root_nodes: Vec<XmlNode> = tree.into_iter().map(XmlNode::Element).collect();
    let mut paras = Vec::new();
    collect_paragraphs(&root_nodes, &mut paras);
    let notes = notes_xml.map(notes_paragraphs).unwrap_or_default();

    let mut extras: Vec<String> = Vec::new();
    if !notes.is_empty() {
        extras.push("### Notes".to_owned());
        extras.extend(notes.iter().cloned());
    }
    if !comments.is_empty() {
        extras.push("### Comments".to_owned());
        for c in &comments {
            if !c.dt.is_empty() {
                extras.push(format!("- {} ({}): {}", c.author, c.dt, c.text));
            } else {
                extras.push(format!("- {}: {}", c.author, c.text));
            }
        }
    }

    if !paras.is_empty() {
        let mut lines = Vec::with_capacity(1 + paras.len() + extras.len());
        lines.push(heading);
        lines.extend(paras);
        lines.extend(extras);
        return SlideSection {
            section: lines.join("\n"),
            has_text: true,
            pictures: 0,
        };
    }

    let pictures = count_pictures(&root_nodes);
    let mut lines = vec![heading];
    if pictures > 0 {
        lines.push(format!(
            "[picture-only slide: {pictures} image{}, no extractable text]",
            if pictures == 1 { "" } else { "s" }
        ));
    }
    lines.extend(extras);
    SlideSection {
        section: lines.join("\n"),
        has_text: !notes.is_empty() || !comments.is_empty(),
        pictures,
    }
}

fn join_sections(sections: Vec<SlideSection>) -> String {
    let any_text = sections.iter().any(|s| s.has_text);
    let any_pics = sections.iter().any(|s| s.pictures > 0);
    let n = sections.len();
    let body = sections
        .into_iter()
        .map(|s| s.section)
        .collect::<Vec<_>>()
        .join("\n\n");
    if any_text || !any_pics {
        return body;
    }
    format!(
        "[No extractable text: none of the {n} slide{} carries text; the content is in embedded images, which this extraction does not read.]\n\n{body}",
        if n == 1 { "" } else { "s" }
    )
}

/// Extracts PPTX slides, notes, and comments with fail-closed redaction detection.
/// Matches `packages/file-parse/src/pptx.ts`.
pub fn extract_pptx<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
    redact_namespaces: &[String],
    cancelled: &AtomicBool,
) -> Result<PptxExtractOutcome, ZipGateError> {
    let slide_entries = presentation_slide_entries(zip)?;
    let authors = load_comment_authors(zip);
    let mut sections = Vec::new();

    let ordered: Vec<(String, String)> = if let Some(entries) = slide_entries {
        let mut list = Vec::new();
        for (index, entry) in entries.into_iter().enumerate() {
            if let Some(path) = entry {
                list.push((format!("## Slide {}", index + 1), path));
            }
        }
        list
    } else {
        legacy_slide_paths(zip)
            .into_iter()
            .map(|path| {
                let num = slide_number(&path);
                (format!("## Slide {num}"), path)
            })
            .collect()
    };

    for (heading, path) in ordered {
        if cancelled.load(Ordering::Acquire) {
            return Err(ZipGateError::Cancelled);
        }
        let Some(slide_xml) = zip.read_entry_string(&path)? else {
            continue;
        };
        if has_redaction_trace(&slide_xml, redact_namespaces) {
            return Ok(PptxExtractOutcome::RedactionPresent);
        }
        let (notes_xml, comments_xml) = slide_related_xml(zip, &path)?;
        if let Some(ref nxml) = notes_xml {
            if has_redaction_trace(nxml, redact_namespaces) {
                return Ok(PptxExtractOutcome::RedactionPresent);
            }
        }
        if let Some(ref cxml) = comments_xml {
            if has_redaction_trace(cxml, redact_namespaces) {
                return Ok(PptxExtractOutcome::RedactionPresent);
            }
        }
        let comments = parse_slide_comments(comments_xml.as_deref(), &authors);
        sections.push(build_slide_section(
            heading,
            &slide_xml,
            notes_xml.as_deref(),
            comments,
        ));
    }

    Ok(PptxExtractOutcome::Ok(join_sections(sections)))
}
