use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::extract::ole::{MAX_OLE_STREAM_BYTES, OleError, decode_cp1252, decode_utf16le, open_ole};
use crate::tokenize::truncate_utf16_units;

const RECORD_HEADER_LEN: usize = 8;

/// MS-PPT 2.3.2 CurrentUserAtom header tokens.
const CURRENT_USER_TOKEN: u32 = 0xE391_C05F;
const ENCRYPTED_CURRENT_USER_TOKEN: u32 = 0xF3D1_C4DF;

/// MS-PPT & MS-ODRAW record types.
const RT_DOCUMENT: u16 = 0x03E8;
const RT_SLIDE: u16 = 0x03EE;
const RT_SLIDE_ATOM: u16 = 0x03EF;
const RT_NOTES: u16 = 0x03F0;
const RT_SLIDE_PERSIST_ATOM: u16 = 0x03F3;
const RT_DRAWING: u16 = 0x040C;
const RT_PLACEHOLDER_ATOM: u16 = 0x0BC3;
const RT_OUTLINE_TEXT_REF_ATOM: u16 = 0x0F9E;
const RT_TEXT_CHARS_ATOM: u16 = 0x0FA0;
const RT_TEXT_BYTES_ATOM: u16 = 0x0FA8;
const RT_SLIDE_NUMBER_MC_ATOM: u16 = 0x0FD8;
const RT_SLIDE_LIST_WITH_TEXT: u16 = 0x0FF0;
const RT_USER_EDIT_ATOM: u16 = 0x0FF5;
const RT_CURRENT_USER_ATOM: u16 = 0x0FF6;
const RT_PERSIST_DIRECTORY_ATOM: u16 = 0x1772;
const RT_CRYPT_SESSION10_CONTAINER: u16 = 0x2F14;

const OFFICEART_DG_CONTAINER: u16 = 0xF002;
const OFFICEART_SPGR_CONTAINER: u16 = 0xF003;
const OFFICEART_SP_CONTAINER: u16 = 0xF004;
const OFFICEART_CLIENT_TEXTBOX: u16 = 0xF00D;
const OFFICEART_CLIENT_DATA: u16 = 0xF011;

/// Placeholder IDs in NotesContainer that carry metadata rather than speaker notes.
const PH_NOTES_SLIDE_IMAGE: u8 = 11;
const PH_NOTES_BODY: u8 = 12;
const PH_SLIDE_NUMBER: u8 = 15;
const PH_HEADER: u8 = 14;
const PH_FOOTER: u8 = 16;
const PH_DATE: u8 = 13;

/// Defensive traversal caps.
const MAX_EDIT_CHAIN: usize = 1024;
const MAX_RECORD_DEPTH: usize = 64;
const MAX_SLIDES: usize = 4096;
const MAX_RECORDS_PER_CONTAINER: usize = 200_000;

#[derive(Debug, Clone, Copy)]
struct PptRecord {
    version: u8,
    instance: u16,
    rec_type: u16,
    payload_start: usize,
    payload_end: usize,
}

fn read_u32_le(buf: &[u8], off: usize) -> Option<u32> {
    let slice = buf.get(off..off.checked_add(4)?)?;
    Some(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn parse_record_at(stream: &[u8], at: usize, limit: usize) -> Result<PptRecord, OleError> {
    let header_end = at
        .checked_add(RECORD_HEADER_LEN)
        .ok_or_else(|| OleError::Corrupt("corrupt .ppt: record header offset overflow".to_owned()))?;
    if header_end > limit || header_end > stream.len() {
        return Err(OleError::Corrupt(format!(
            "corrupt .ppt: truncated record header at offset {at}"
        )));
    }
    let ver_inst = u16::from_le_bytes([stream[at], stream[at + 1]]);
    let rec_type = u16::from_le_bytes([stream[at + 2], stream[at + 3]]);
    let length = u32::from_le_bytes([stream[at + 4], stream[at + 5], stream[at + 6], stream[at + 7]])
        as usize;
    let payload_end = header_end
        .checked_add(length)
        .ok_or_else(|| OleError::Corrupt("corrupt .ppt: record payload length overflow".to_owned()))?;
    if payload_end > limit || payload_end > stream.len() {
        return Err(OleError::Corrupt(format!(
            "corrupt .ppt: record 0x{rec_type:04x} claims {length} bytes past container end"
        )));
    }
    Ok(PptRecord {
        version: (ver_inst & 0x000F) as u8,
        instance: ver_inst >> 4,
        rec_type,
        payload_start: header_end,
        payload_end,
    })
}

fn walk_records_strict(
    stream: &[u8],
    from: usize,
    to: usize,
    cancelled: &AtomicBool,
) -> Result<Vec<PptRecord>, OleError> {
    let mut out = Vec::new();
    let mut at = from;
    while at < to {
        if (out.len() & 0xFF) == 0 && cancelled.load(Ordering::Acquire) {
            return Err(OleError::Cancelled);
        }
        if out.len() >= MAX_RECORDS_PER_CONTAINER {
            return Err(OleError::Corrupt(
                "corrupt .ppt: record count exceeds safety limit".to_owned(),
            ));
        }
        let rec = parse_record_at(stream, at, to)?;
        at = rec.payload_end;
        out.push(rec);
    }
    Ok(out)
}

fn password_protected_ppt() -> OleError {
    OleError::PasswordProtected(
        "Password-protected .ppt: open it in its editor with the password, or remove the password and attach it again".to_owned(),
    )
}

/// Parses `Current User` stream and returns `offsetToCurrentEdit`.
fn parse_current_user(current_user: &[u8], cancelled: &AtomicBool) -> Result<usize, OleError> {
    if current_user.len() < RECORD_HEADER_LEN {
        return Err(OleError::Corrupt(
            "corrupt .ppt: Current User stream is truncated".to_owned(),
        ));
    }
    let records = walk_records_strict(current_user, 0, current_user.len(), cancelled)?;
    let mut found: Option<usize> = None;
    for rec in records {
        if rec.rec_type != RT_CURRENT_USER_ATOM {
            continue;
        }
        let payload = &current_user[rec.payload_start..rec.payload_end];
        if payload.len() < 12 {
            return Err(OleError::Corrupt(
                "corrupt .ppt: CurrentUserAtom payload shorter than 12 bytes".to_owned(),
            ));
        }
        let header_token = read_u32_le(payload, 4).unwrap_or(0);
        if header_token == ENCRYPTED_CURRENT_USER_TOKEN {
            return Err(password_protected_ppt());
        }
        if header_token != CURRENT_USER_TOKEN {
            return Err(OleError::Corrupt(format!(
                "corrupt .ppt: invalid CurrentUserAtom headerToken 0x{header_token:08x}"
            )));
        }
        if payload.len() >= 17 {
            let major_ver = payload[16];
            if major_ver < 3 {
                return Err(OleError::Corrupt(format!(
                    "unsupported legacy .ppt format: major version {major_ver} is older than PowerPoint 97"
                )));
            }
        }
        let offset = read_u32_le(payload, 8).unwrap_or(0) as usize;
        found = Some(offset);
        break;
    }
    found.ok_or_else(|| {
        OleError::Corrupt("corrupt .ppt: Current User stream has no CurrentUserAtom".to_owned())
    })
}

struct PersistChain {
    directory: HashMap<u32, usize>,
    doc_persist_id: Option<u32>,
}

fn read_persist_directory(
    ppt_doc: &[u8],
    start_offset: usize,
    directory: &mut HashMap<u32, usize>,
    cancelled: &AtomicBool,
) -> Result<(), OleError> {
    let mut at = start_offset;
    for block_idx in 0..MAX_EDIT_CHAIN {
        if cancelled.load(Ordering::Acquire) {
            return Err(OleError::Cancelled);
        }
        if at >= ppt_doc.len() {
            if block_idx == 0 {
                return Err(OleError::Corrupt(format!(
                    "corrupt .ppt: PersistDirectoryAtom offset {at} out of bounds"
                )));
            }
            break;
        }
        let rec = match parse_record_at(ppt_doc, at, ppt_doc.len()) {
            Ok(r) => r,
            Err(e) => {
                if block_idx == 0 {
                    return Err(e);
                }
                break;
            }
        };
        if rec.rec_type != RT_PERSIST_DIRECTORY_ATOM {
            if block_idx == 0 {
                return Err(OleError::Corrupt(format!(
                    "corrupt .ppt: expected PersistDirectoryAtom at {at}, found 0x{:04x}",
                    rec.rec_type
                )));
            }
            break;
        }
        let payload = &ppt_doc[rec.payload_start..rec.payload_end];
        let mut cursor = 0usize;
        while cursor < payload.len() {
            let Some(entry_header) = read_u32_le(payload, cursor) else {
                return Err(OleError::Corrupt(
                    "corrupt .ppt: truncated PersistDirectoryEntry header".to_owned(),
                ));
            };
            cursor += 4;
            let persist_id = entry_header & 0x000F_FFFF;
            let count = (entry_header >> 20) as usize;
            let offsets_bytes = count
                .checked_mul(4)
                .ok_or_else(|| OleError::Corrupt("corrupt .ppt: persist entry count overflow".to_owned()))?;
            if count == 0
                || cursor
                    .checked_add(offsets_bytes)
                    .map_or(true, |end| end > payload.len())
            {
                return Err(OleError::Corrupt(
                    "corrupt .ppt: PersistDirectoryEntry runs past block end".to_owned(),
                ));
            }
            for i in 0..count {
                let stream_off = read_u32_le(payload, cursor).unwrap_or(u32::MAX) as usize;
                cursor += 4;
                if stream_off >= ppt_doc.len() {
                    return Err(OleError::Corrupt(format!(
                        "corrupt .ppt: persist offset {stream_off} exceeds PowerPoint Document stream ({})",
                        ppt_doc.len()
                    )));
                }
                let id = persist_id.saturating_add(i as u32);
                directory.entry(id).or_insert(stream_off);
            }
        }
        at = rec.payload_end;
    }
    Ok(())
}

fn build_persist_chain(
    ppt_doc: &[u8],
    initial_edit_offset: usize,
    cancelled: &AtomicBool,
) -> Result<PersistChain, OleError> {
    let mut directory = HashMap::new();
    let mut doc_persist_id = None;
    let mut visited = HashSet::new();
    let mut edit_offset = initial_edit_offset;

    for edit_idx in 0..=MAX_EDIT_CHAIN {
        if cancelled.load(Ordering::Acquire) {
            return Err(OleError::Cancelled);
        }
        if edit_idx == MAX_EDIT_CHAIN {
            return Err(OleError::Corrupt(
                "corrupt .ppt: UserEditAtom chain exceeds safety limit".to_owned(),
            ));
        }
        if !visited.insert(edit_offset) {
            return Err(OleError::Corrupt(format!(
                "corrupt .ppt: cycle detected in UserEditAtom chain at offset {edit_offset}"
            )));
        }
        let rec = parse_record_at(ppt_doc, edit_offset, ppt_doc.len())?;
        if rec.rec_type != RT_USER_EDIT_ATOM {
            return Err(OleError::Corrupt(format!(
                "corrupt .ppt: expected UserEditAtom at {edit_offset}, found 0x{:04x}",
                rec.rec_type
            )));
        }
        let payload = &ppt_doc[rec.payload_start..rec.payload_end];
        if payload.len() < 28 {
            return Err(OleError::Corrupt(
                "corrupt .ppt: UserEditAtom payload shorter than 28 bytes".to_owned(),
            ));
        }
        // Optional encryptSessionPersistIdRef at payload offset 28..32 (PowerPoint 2002+).
        if payload.len() >= 32 {
            let encrypt_persist_id = read_u32_le(payload, 28).unwrap_or(0);
            if encrypt_persist_id != 0 {
                return Err(password_protected_ppt());
            }
        }

        let offset_last_edit = read_u32_le(payload, 8).unwrap_or(0) as usize;
        let offset_persist_dir = read_u32_le(payload, 12).unwrap_or(0) as usize;
        let doc_ref = read_u32_le(payload, 16).unwrap_or(0);
        if edit_idx == 0 && doc_ref > 0 {
            doc_persist_id = Some(doc_ref);
        }

        read_persist_directory(ppt_doc, offset_persist_dir, &mut directory, cancelled)?;

        if offset_last_edit == 0 {
            break;
        }
        edit_offset = offset_last_edit;
    }

    Ok(PersistChain {
        directory,
        doc_persist_id,
    })
}

/// Scans top-level records in `PowerPoint Document` to reject any
/// `RT_CryptSession10Container` (0x2F14) and verify record framing.
fn verify_top_level_and_check_encryption(
    ppt_doc: &[u8],
    cancelled: &AtomicBool,
) -> Result<Vec<PptRecord>, OleError> {
    let records = walk_records_strict(ppt_doc, 0, ppt_doc.len(), cancelled)?;
    for rec in &records {
        if rec.rec_type == RT_CRYPT_SESSION10_CONTAINER {
            return Err(password_protected_ppt());
        }
    }
    Ok(records)
}

#[derive(Debug, Default)]
struct SlideListEntry {
    persist_id_ref: u32,
    slide_id: u32,
    outline_texts: Vec<String>,
}

struct DocumentLists {
    slides: Vec<SlideListEntry>,
    notes_by_slide_id: HashMap<u32, SlideListEntry>,
}

fn parse_slide_list_with_text(
    ppt_doc: &[u8],
    rec: PptRecord,
    cancelled: &AtomicBool,
) -> Result<Vec<SlideListEntry>, OleError> {
    let children = walk_records_strict(ppt_doc, rec.payload_start, rec.payload_end, cancelled)?;
    let mut entries: Vec<SlideListEntry> = Vec::new();
    for child in children {
        match child.rec_type {
            RT_SLIDE_PERSIST_ATOM => {
                if entries.len() >= MAX_SLIDES {
                    return Err(OleError::Corrupt(
                        "corrupt .ppt: slide count exceeds safety limit".to_owned(),
                    ));
                }
                let payload = &ppt_doc[child.payload_start..child.payload_end];
                if payload.len() < 16 {
                    return Err(OleError::Corrupt(
                        "corrupt .ppt: SlidePersistAtom shorter than 16 bytes".to_owned(),
                    ));
                }
                let persist_id_ref = read_u32_le(payload, 0).unwrap_or(0);
                let slide_id = read_u32_le(payload, 12).unwrap_or(0);
                entries.push(SlideListEntry {
                    persist_id_ref,
                    slide_id,
                    outline_texts: Vec::new(),
                });
            }
            RT_TEXT_CHARS_ATOM => {
                if let Some(entry) = entries.last_mut() {
                    let payload = &ppt_doc[child.payload_start..child.payload_end];
                    entry.outline_texts.push(decode_ppt_chars(payload));
                }
            }
            RT_TEXT_BYTES_ATOM => {
                if let Some(entry) = entries.last_mut() {
                    let payload = &ppt_doc[child.payload_start..child.payload_end];
                    entry.outline_texts.push(decode_ppt_bytes(payload));
                }
            }
            _ => {}
        }
    }
    Ok(entries)
}

fn parse_document_lists(
    ppt_doc: &[u8],
    doc_rec: PptRecord,
    cancelled: &AtomicBool,
) -> Result<DocumentLists, OleError> {
    let children = walk_records_strict(ppt_doc, doc_rec.payload_start, doc_rec.payload_end, cancelled)?;
    let mut slides = Vec::new();
    let mut notes_by_slide_id = HashMap::new();

    for child in children {
        if child.rec_type != RT_SLIDE_LIST_WITH_TEXT {
            continue;
        }
        match child.instance {
            // Instance 0 = presentation slides (1 = masters, 2 = notes).
            0 => {
                slides.extend(parse_slide_list_with_text(ppt_doc, child, cancelled)?);
            }
            2 => {
                for entry in parse_slide_list_with_text(ppt_doc, child, cancelled)? {
                    if entry.slide_id != 0 {
                        notes_by_slide_id.insert(entry.slide_id, entry);
                    }
                }
            }
            _ => {}
        }
    }

    Ok(DocumentLists {
        slides,
        notes_by_slide_id,
    })
}

fn decode_ppt_chars(payload: &[u8]) -> String {
    normalize_ppt_runes(&decode_utf16le(payload))
}

fn decode_ppt_bytes(payload: &[u8]) -> String {
    normalize_ppt_runes(&decode_cp1252(payload))
}

fn normalize_ppt_runes(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                out.push('\n');
            }
            '\u{000B}' => out.push('\n'),
            '\u{001E}' | '\u{001F}' => out.push(' '),
            other => out.push(other),
        }
    }
    out
}

fn extract_textbox_text(
    ppt_doc: &[u8],
    textbox: PptRecord,
    outline_texts: &[String],
    used_outline: &mut HashSet<usize>,
    is_notes: bool,
    cancelled: &AtomicBool,
) -> Result<Option<String>, OleError> {
    let children = walk_records_strict(ppt_doc, textbox.payload_start, textbox.payload_end, cancelled)?;
    let mut text: Option<String> = None;
    let mut has_slide_num_meta = false;

    for child in children {
        match child.rec_type {
            RT_TEXT_CHARS_ATOM => {
                let payload = &ppt_doc[child.payload_start..child.payload_end];
                text = Some(decode_ppt_chars(payload));
            }
            RT_TEXT_BYTES_ATOM => {
                let payload = &ppt_doc[child.payload_start..child.payload_end];
                text = Some(decode_ppt_bytes(payload));
            }
            RT_OUTLINE_TEXT_REF_ATOM => {
                let payload = &ppt_doc[child.payload_start..child.payload_end];
                if let Some(idx) = read_u32_le(payload, 0) {
                    let idx = idx as usize;
                    if let Some(outline) = outline_texts.get(idx) {
                        used_outline.insert(idx);
                        text = Some(outline.clone());
                    }
                }
            }
            RT_SLIDE_NUMBER_MC_ATOM => {
                has_slide_num_meta = true;
            }
            _ => {}
        }
    }

    if is_notes && has_slide_num_meta {
        if let Some(ref t) = text {
            if t.trim().chars().all(|c| c == '*' || c.is_ascii_digit()) {
                return Ok(None);
            }
        }
    }
    Ok(text)
}

fn shape_placeholder_id(
    ppt_doc: &[u8],
    client_data: PptRecord,
    cancelled: &AtomicBool,
) -> Result<Option<u8>, OleError> {
    let children = walk_records_strict(ppt_doc, client_data.payload_start, client_data.payload_end, cancelled)?;
    for child in children {
        if child.rec_type == RT_PLACEHOLDER_ATOM {
            let payload = &ppt_doc[child.payload_start..child.payload_end];
            // OEPlaceHolderAtom: placementId (4 bytes), placeholderId (1 byte), size (1 byte), unused (2 bytes).
            if payload.len() >= 5 {
                return Ok(Some(payload[4]));
            }
        }
    }
    Ok(None)
}

fn collect_drawing_texts(
    ppt_doc: &[u8],
    container: PptRecord,
    outline_texts: &[String],
    used_outline: &mut HashSet<usize>,
    is_notes: bool,
    depth: usize,
    out: &mut Vec<String>,
    cancelled: &AtomicBool,
) -> Result<(), OleError> {
    if depth > MAX_RECORD_DEPTH {
        return Err(OleError::Corrupt(
            "corrupt .ppt: drawing container nesting exceeds depth limit".to_owned(),
        ));
    }
    let children = walk_records_strict(ppt_doc, container.payload_start, container.payload_end, cancelled)?;
    if container.rec_type == OFFICEART_SP_CONTAINER {
        let mut placeholder_id: Option<u8> = None;
        let mut textbox: Option<PptRecord> = None;
        for child in children {
            match child.rec_type {
                OFFICEART_CLIENT_DATA if child.version == 0xF => {
                    placeholder_id = shape_placeholder_id(ppt_doc, child, cancelled)?;
                }
                OFFICEART_CLIENT_TEXTBOX => {
                    textbox = Some(child);
                }
                _ => {}
            }
        }
        if is_notes {
            // Skip non-body placeholders on notes slides (slide image, slide number, header, footer, date).
            if let Some(ph) = placeholder_id {
                if matches!(
                    ph,
                    PH_NOTES_SLIDE_IMAGE | PH_SLIDE_NUMBER | PH_HEADER | PH_FOOTER | PH_DATE
                ) && ph != PH_NOTES_BODY
                {
                    return Ok(());
                }
            }
        }
        if let Some(tb) = textbox {
            if let Some(t) = extract_textbox_text(
                ppt_doc,
                tb,
                outline_texts,
                used_outline,
                is_notes,
                cancelled,
            )? {
                out.push(t);
            }
        }
        return Ok(());
    }

    for child in children {
        match child.rec_type {
            OFFICEART_DG_CONTAINER | OFFICEART_SPGR_CONTAINER | OFFICEART_SP_CONTAINER => {
                collect_drawing_texts(
                    ppt_doc,
                    child,
                    outline_texts,
                    used_outline,
                    is_notes,
                    depth + 1,
                    out,
                    cancelled,
                )?;
            }
            _ => {}
        }
    }
    Ok(())
}

struct ExtractedSlide {
    texts: Vec<String>,
    notes_id_ref: u32,
}

fn extract_slide_container(
    ppt_doc: &[u8],
    slide_rec: PptRecord,
    outline_texts: &[String],
    cancelled: &AtomicBool,
) -> Result<ExtractedSlide, OleError> {
    let children = walk_records_strict(ppt_doc, slide_rec.payload_start, slide_rec.payload_end, cancelled)?;
    let mut notes_id_ref = 0u32;
    let mut texts = Vec::new();
    let mut used_outline = HashSet::new();

    for child in children {
        match child.rec_type {
            RT_SLIDE_ATOM => {
                let payload = &ppt_doc[child.payload_start..child.payload_end];
                if payload.len() >= 20 {
                    notes_id_ref = read_u32_le(payload, 16).unwrap_or(0);
                }
            }
            RT_DRAWING => {
                collect_drawing_texts(
                    ppt_doc,
                    child,
                    outline_texts,
                    &mut used_outline,
                    false,
                    0,
                    &mut texts,
                    cancelled,
                )?;
            }
            _ => {}
        }
    }

    // If a slide stores placeholder text only in SlideListWithText without
    // referencing it via OutlineTextRefAtom, keep it so text is never lost.
    if texts.is_empty() && !outline_texts.is_empty() {
        for (idx, t) in outline_texts.iter().enumerate() {
            if !used_outline.contains(&idx) && !t.trim().is_empty() {
                texts.push(t.clone());
            }
        }
    }

    Ok(ExtractedSlide {
        texts,
        notes_id_ref,
    })
}

fn extract_notes_container(
    ppt_doc: &[u8],
    notes_rec: PptRecord,
    outline_texts: &[String],
    cancelled: &AtomicBool,
) -> Result<String, OleError> {
    let children = walk_records_strict(ppt_doc, notes_rec.payload_start, notes_rec.payload_end, cancelled)?;
    let mut texts = Vec::new();
    let mut used_outline = HashSet::new();

    for child in children {
        if child.rec_type == RT_DRAWING {
            collect_drawing_texts(
                ppt_doc,
                child,
                outline_texts,
                &mut used_outline,
                true,
                0,
                &mut texts,
                cancelled,
            )?;
        }
    }

    if texts.is_empty() && !outline_texts.is_empty() {
        for (idx, t) in outline_texts.iter().enumerate() {
            if !used_outline.contains(&idx) && !t.trim().is_empty() {
                texts.push(t.clone());
            }
        }
    }

    let joined = texts
        .into_iter()
        .map(|t| t.trim().to_owned())
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Ok(joined)
}

fn format_slide_section(index_one_based: usize, body: &str, notes: &str) -> String {
    let body = body.trim();
    let notes = notes.trim();
    match (body.is_empty(), notes.is_empty()) {
        (true, true) => format!("## Slide {index_one_based}"),
        (false, true) => format!("## Slide {index_one_based}\n{body}"),
        (true, false) => format!("## Slide {index_one_based}\n### Notes\n{notes}"),
        (false, false) => format!("## Slide {index_one_based}\n{body}\n### Notes\n{notes}"),
    }
}

fn push_slide_section(
    sections: &mut Vec<String>,
    total_utf16: &mut usize,
    section: String,
    max_chars: Option<usize>,
) -> bool {
    let len = section.encode_utf16().count();
    sections.push(section);
    *total_utf16 = total_utf16.saturating_add(len + 2);
    if let Some(limit) = max_chars {
        *total_utf16 >= limit
    } else {
        false
    }
}

/// Extracts slide sections (`## Slide N`) and speaker notes (`### Notes`) from
/// a PowerPoint 97-2003 OLE2 `.ppt` file, matching `packages/file-parse/src/ppt.ts`.
pub fn extract_ppt<R: Read + Seek>(
    reader: R,
    max_chars: Option<usize>,
    cancelled: &AtomicBool,
) -> Result<String, OleError> {
    if cancelled.load(Ordering::Acquire) {
        return Err(OleError::Cancelled);
    }
    let mut comp = open_ole(reader, cancelled)?;

    if comp.has_stream_ci("/EncryptedPackage") || comp.has_stream_ci("/EncryptedSummary") {
        return Err(password_protected_ppt());
    }

    let Some(ppt_doc_path) = comp.resolve_stream_path("/PowerPoint Document") else {
        return Err(OleError::Corrupt(
            "corrupt .ppt: missing PowerPoint Document stream".to_owned(),
        ));
    };
    let Some(current_user_path) = comp.resolve_stream_path("/Current User") else {
        return Err(OleError::Corrupt(
            "corrupt .ppt: missing Current User stream".to_owned(),
        ));
    };

    let current_user = comp.read_stream_capped(&current_user_path, MAX_OLE_STREAM_BYTES, cancelled)?;
    let edit_offset = parse_current_user(&current_user, cancelled)?;

    let ppt_doc = comp.read_stream_capped(&ppt_doc_path, MAX_OLE_STREAM_BYTES, cancelled)?;
    let top_records = verify_top_level_and_check_encryption(&ppt_doc, cancelled)?;
    let chain = build_persist_chain(&ppt_doc, edit_offset, cancelled)?;

    if max_chars == Some(0) {
        return Ok(String::new());
    }

    // Locate the active DocumentContainer from the persist chain (or fall back
    // to the last top-level RT_Document record).
    let doc_record = chain
        .doc_persist_id
        .and_then(|id| chain.directory.get(&id).copied())
        .and_then(|off| parse_record_at(&ppt_doc, off, ppt_doc.len()).ok())
        .filter(|r| r.rec_type == RT_DOCUMENT)
        .or_else(|| {
            top_records
                .iter()
                .rev()
                .find(|r| r.rec_type == RT_DOCUMENT)
                .copied()
        });

    let mut sections: Vec<String> = Vec::new();
    let mut total_utf16 = 0usize;

    if let Some(doc_rec) = doc_record {
        let lists = parse_document_lists(&ppt_doc, doc_rec, cancelled)?;
        if !lists.slides.is_empty() {
            for (idx, slide_entry) in lists.slides.iter().enumerate() {
                if cancelled.load(Ordering::Acquire) {
                    return Err(OleError::Cancelled);
                }
                let mut body = String::new();
                let mut notes = String::new();

                if let Some(&slide_off) = chain.directory.get(&slide_entry.persist_id_ref) {
                    let slide_rec = parse_record_at(&ppt_doc, slide_off, ppt_doc.len())?;
                    if slide_rec.rec_type == RT_SLIDE {
                        let extracted = extract_slide_container(
                            &ppt_doc,
                            slide_rec,
                            &slide_entry.outline_texts,
                            cancelled,
                        )?;
                        body = extracted.texts.join("\n");

                        if extracted.notes_id_ref != 0 {
                            if let Some(notes_entry) =
                                lists.notes_by_slide_id.get(&extracted.notes_id_ref)
                            {
                                if let Some(&notes_off) =
                                    chain.directory.get(&notes_entry.persist_id_ref)
                                {
                                    let notes_rec =
                                        parse_record_at(&ppt_doc, notes_off, ppt_doc.len())?;
                                    if notes_rec.rec_type == RT_NOTES {
                                        notes = extract_notes_container(
                                            &ppt_doc,
                                            notes_rec,
                                            &notes_entry.outline_texts,
                                            cancelled,
                                        )?;
                                    }
                                }
                            }
                        }
                    }
                } else if !slide_entry.outline_texts.is_empty() {
                    body = slide_entry.outline_texts.join("\n");
                }

                let section = format_slide_section(idx + 1, &body, &notes);
                if push_slide_section(&mut sections, &mut total_utf16, section, max_chars) {
                    break;
                }
            }
        }
    }

    // Fallback for minimal files that lack SlideListWithText entries: walk
    // top-level RT_Slide records directly (matching ppt-to-text behavior).
    if sections.is_empty() {
        let mut slide_num = 0usize;
        for rec in &top_records {
            if rec.rec_type != RT_SLIDE {
                continue;
            }
            if cancelled.load(Ordering::Acquire) {
                return Err(OleError::Cancelled);
            }
            slide_num += 1;
            if slide_num > MAX_SLIDES {
                return Err(OleError::Corrupt(
                    "corrupt .ppt: slide count exceeds safety limit".to_owned(),
                ));
            }
            let extracted = extract_slide_container(&ppt_doc, *rec, &[], cancelled)?;
            let body = extracted.texts.join("\n");
            let section = format_slide_section(slide_num, &body, "");
            if push_slide_section(&mut sections, &mut total_utf16, section, max_chars) {
                break;
            }
        }
    }

    let joined = sections.join("\n\n");
    if let Some(limit) = max_chars {
        Ok(truncate_utf16_units(&joined, limit).to_owned())
    } else {
        Ok(joined)
    }
}
