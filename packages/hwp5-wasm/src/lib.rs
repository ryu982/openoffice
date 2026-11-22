use flate2::Compression;
use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Read, Write};
use wasm_bindgen::prelude::*;

pub const SIGNATURE: &[u8] = b"HWP Document File";
pub const FILE_HEADER_MIN_LEN: usize = 40;
pub const FILE_HEADER_FLAGS_OFFSET: usize = 36;
pub const FLAG_COMPRESSED: u32 = 0x0001;
pub const FLAG_ENCRYPTED: u32 = 0x0002;
pub const FLAG_DISTRIBUTION: u32 = 0x0004;
pub const FLAG_TRACKED: u32 = 0x4000;
pub const MAX_SECTIONS: usize = 4096;

const LIBRARY_MARKER_NAME: &str = " Sh33tJ5";
const OLE2_MAGIC: &[u8; 8] = &[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const HEADER_FAT_SLOTS: usize = 109;
const FREE_SECT: u32 = 0xffff_ffff;
const END_OF_CHAIN: u32 = 0xffff_fffe;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hwp5Info {
    pub valid: bool,
    pub compressed: bool,
    pub encrypted: bool,
    pub distribution: bool,
    pub tracked: bool,
    pub has_view_text: bool,
    pub sections: usize,
    pub paths: Vec<String>,
    pub stream_paths: Vec<String>,
}

impl Hwp5Info {
    pub fn invalid() -> Self {
        Self {
            valid: false,
            compressed: false,
            encrypted: false,
            distribution: false,
            tracked: false,
            has_view_text: false,
            sections: 0,
            paths: Vec::new(),
            stream_paths: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HwpRecord {
    pub tag: u16,
    pub level: u16,
    pub start: usize,
    pub body: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReplacementMeta {
    pub path: String,
    pub offset: usize,
    pub length: usize,
    #[serde(default)]
    pub plain: bool,
}

fn normalize_path(raw: &str) -> String {
    let slash = raw.replace('\\', "/");
    let trimmed = slash.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_string()
    } else if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    }
}

fn entry_base_path(entry: &cfb::Entry) -> Option<String> {
    let raw = entry.path().to_str()?;
    Some(normalize_path(raw))
}

fn is_view_text_display_path(display_path: &str) -> bool {
    display_path.to_ascii_lowercase().contains("/viewtext/")
}

fn is_library_marker_path(base_path: &str) -> bool {
    base_path
        .split('/')
        .any(|segment| segment == LIBRARY_MARKER_NAME)
}

fn resolve_stream_path<F: Read + std::io::Seek>(
    comp: &cfb::CompoundFile<F>,
    requested: &str,
) -> Option<String> {
    let norm = normalize_path(requested);
    if comp.is_stream(&norm) {
        return Some(norm);
    }
    let needle = norm.to_lowercase();
    for entry in comp.walk() {
        if !entry.is_stream() {
            continue;
        }
        if let Some(base) = entry_base_path(&entry)
            && base.to_lowercase() == needle
        {
            return Some(base);
        }
    }
    None
}

fn read_raw_stream<F: Read + std::io::Seek>(
    comp: &mut cfb::CompoundFile<F>,
    canonical_path: &str,
) -> Option<Vec<u8>> {
    let mut stream = comp.open_stream(canonical_path).ok()?;
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).ok()?;
    Some(buf)
}

fn inflate_raw(raw: &[u8]) -> Option<Vec<u8>> {
    let mut decoder = DeflateDecoder::new(raw);
    let mut out = Vec::new();
    decoder.read_to_end(&mut out).ok()?;
    Some(out)
}

fn deflate_raw(data: &[u8]) -> Option<Vec<u8>> {
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(data).ok()?;
    encoder.finish().ok()
}

fn inspect_compound<F: Read + std::io::Seek>(comp: &mut cfb::CompoundFile<F>) -> Hwp5Info {
    let Some(header_path) = resolve_stream_path(comp, "/FileHeader") else {
        return Hwp5Info::invalid();
    };
    let Some(header) = read_raw_stream(comp, &header_path) else {
        return Hwp5Info::invalid();
    };
    if header.len() < FILE_HEADER_MIN_LEN || !header.starts_with(SIGNATURE) {
        return Hwp5Info::invalid();
    }
    let flags = u32::from_le_bytes([
        header[FILE_HEADER_FLAGS_OFFSET],
        header[FILE_HEADER_FLAGS_OFFSET + 1],
        header[FILE_HEADER_FLAGS_OFFSET + 2],
        header[FILE_HEADER_FLAGS_OFFSET + 3],
    ]);

    let mut paths = Vec::new();
    let mut stream_paths = Vec::new();
    let mut has_view_text = false;

    for entry in comp.walk() {
        if entry.is_root() {
            continue;
        }
        let Some(base) = entry_base_path(&entry) else {
            continue;
        };
        if entry.is_storage() {
            let display = format!("{base}/");
            if is_view_text_display_path(&display) {
                has_view_text = true;
            }
            paths.push(display);
        } else if entry.is_stream() {
            if is_view_text_display_path(&base) {
                has_view_text = true;
            }
            paths.push(base.clone());
            stream_paths.push(base);
        }
    }

    let mut sections = 0;
    while sections < MAX_SECTIONS {
        let sec_path = format!("/BodyText/Section{sections}");
        if resolve_stream_path(comp, &sec_path).is_none() {
            break;
        }
        sections += 1;
    }

    Hwp5Info {
        valid: true,
        compressed: (flags & FLAG_COMPRESSED) != 0,
        encrypted: (flags & FLAG_ENCRYPTED) != 0,
        distribution: (flags & FLAG_DISTRIBUTION) != 0,
        tracked: (flags & FLAG_TRACKED) != 0,
        has_view_text,
        sections,
        paths,
        stream_paths,
    }
}

/// Validates that an OLE2 binary buffer has FREESECT (0xffffffff) in every unused
/// FAT and MiniFAT slot rather than END_OF_CHAIN (0xfffffffe).
pub(crate) fn ole2_unused_slots_are_free(file: &[u8]) -> bool {
    if file.len() < 512 || &file[..8] != OLE2_MAGIC {
        return false;
    }
    let sector_shift = u16::from_le_bytes([file[30], file[31]]);
    let mini_shift = u16::from_le_bytes([file[32], file[33]]);
    if (sector_shift != 9 && sector_shift != 12) || mini_shift > sector_shift {
        return false;
    }
    let sector_size = 1usize << sector_shift;
    let mini_sector_size = 1usize << mini_shift;
    let fat_per_sector = sector_size / 4;
    if file.len() < sector_size || !(file.len() - sector_size).is_multiple_of(sector_size) {
        return false;
    }
    let total_sectors = (file.len() - sector_size) / sector_size;

    let read_u32 = |offset: usize| -> Option<u32> {
        let end = offset.checked_add(4)?;
        let slice = file.get(offset..end)?;
        Some(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
    };
    let sector_at = |index: usize| -> Option<usize> {
        index
            .checked_mul(sector_size)
            .and_then(|off| off.checked_add(sector_size))
    };

    let mut fat_sectors = Vec::new();
    for slot in 0..HEADER_FAT_SLOTS {
        let Some(s) = read_u32(76 + slot * 4) else {
            return false;
        };
        if (s as usize) < total_sectors {
            fat_sectors.push(s as usize);
        }
    }
    let Some(mut difat) = read_u32(68) else {
        return false;
    };
    let mut guard = 0usize;
    while (difat as usize) < total_sectors && guard < total_sectors {
        let Some(base) = sector_at(difat as usize) else {
            return false;
        };
        for slot in 0..(fat_per_sector - 1) {
            let Some(s) = read_u32(base + slot * 4) else {
                return false;
            };
            if (s as usize) < total_sectors {
                fat_sectors.push(s as usize);
            }
        }
        let Some(next_difat) = read_u32(base + (fat_per_sector - 1) * 4) else {
            return false;
        };
        difat = next_difat;
        guard += 1;
    }

    for (nth, &sector) in fat_sectors.iter().enumerate() {
        let Some(base) = sector_at(sector) else {
            return false;
        };
        for slot in 0..fat_per_sector {
            let entry_idx = nth * fat_per_sector + slot;
            if entry_idx >= total_sectors {
                let Some(val) = read_u32(base + slot * 4) else {
                    return false;
                };
                if val != FREE_SECT {
                    return false;
                }
            }
        }
    }

    let next_in_fat = |sector: usize| -> u32 {
        let table_idx = sector / fat_per_sector;
        let Some(&table) = fat_sectors.get(table_idx) else {
            return END_OF_CHAIN;
        };
        let Some(base) = sector_at(table) else {
            return END_OF_CHAIN;
        };
        read_u32(base + (sector % fat_per_sector) * 4).unwrap_or(END_OF_CHAIN)
    };

    let mut mini_sectors = Vec::new();
    let Some(mut mini) = read_u32(60) else {
        return false;
    };
    let mut mini_guard = 0usize;
    while (mini as usize) < total_sectors && mini_guard < total_sectors {
        mini_sectors.push(mini as usize);
        mini = next_in_fat(mini as usize);
        mini_guard += 1;
    }

    let Some(dir_first_sector) = read_u32(48) else {
        return false;
    };
    let Some(dir_base) = sector_at(dir_first_sector as usize) else {
        return false;
    };
    let root_size = if sector_shift == 9 {
        let Some(sz) = read_u32(dir_base + 120) else {
            return false;
        };
        sz as u64
    } else {
        let Some(slice) = file.get(dir_base + 120..dir_base + 128) else {
            return false;
        };
        u64::from_le_bytes([
            slice[0], slice[1], slice[2], slice[3], slice[4], slice[5], slice[6], slice[7],
        ])
    };
    let used_mini_sectors = root_size.div_ceil(mini_sector_size as u64);

    for (nth, &sector) in mini_sectors.iter().enumerate() {
        let Some(base) = sector_at(sector) else {
            return false;
        };
        for slot in 0..fat_per_sector {
            let entry_idx = (nth * fat_per_sector + slot) as u64;
            if entry_idx >= used_mini_sectors {
                let Some(val) = read_u32(base + slot * 4) else {
                    return false;
                };
                if val != FREE_SECT {
                    return false;
                }
            }
        }
    }

    true
}

pub fn inspect_hwp5_inner(bytes: &[u8]) -> Hwp5Info {
    let Ok(mut comp) = cfb::CompoundFile::open(Cursor::new(bytes)) else {
        return Hwp5Info::invalid();
    };
    inspect_compound(&mut comp)
}

pub fn read_stream_inner(bytes: &[u8], path: &str, decompress: bool) -> Option<Vec<u8>> {
    let mut comp = cfb::CompoundFile::open(Cursor::new(bytes)).ok()?;
    let canonical = resolve_stream_path(&comp, path)?;
    let raw = read_raw_stream(&mut comp, &canonical)?;
    if decompress {
        inflate_raw(&raw)
    } else {
        Some(raw)
    }
}

pub fn parse_records_inner(data: &[u8]) -> Option<Vec<HwpRecord>> {
    let mut out = Vec::new();
    let mut at: usize = 0;
    while at < data.len() {
        let header_end = at.checked_add(4)?;
        if header_end > data.len() {
            return None;
        }
        let start = at;
        let word = u32::from_le_bytes([data[at], data[at + 1], data[at + 2], data[at + 3]]);
        let mut size = (word >> 20) as usize;
        at = header_end;
        if size == 0xfff {
            let ext_end = at.checked_add(4)?;
            if ext_end > data.len() {
                return None;
            }
            let ext_size =
                u32::from_le_bytes([data[at], data[at + 1], data[at + 2], data[at + 3]]);
            size = usize::try_from(ext_size).ok()?;
            at = ext_end;
        }
        let body = at;
        let end = at.checked_add(size)?;
        if end > data.len() {
            return None;
        }
        out.push(HwpRecord {
            tag: (word & 0x3ff) as u16,
            level: ((word >> 10) & 0x3ff) as u16,
            start,
            body,
            end,
        });
        at = end;
    }
    Some(out)
}

struct CapturedStorage {
    path: String,
    clsid: uuid::Uuid,
    state_bits: u32,
}

struct CapturedStream {
    path: String,
    data: Vec<u8>,
    state_bits: u32,
}

fn capture_entries<F: Read + std::io::Seek>(
    comp: &mut cfb::CompoundFile<F>,
    skip_view_text: bool,
) -> Option<(uuid::Uuid, u32, Vec<CapturedStorage>, Vec<CapturedStream>)> {
    let root = comp.root_entry();
    let root_clsid = *root.clsid();
    let root_state_bits = root.state_bits();

    let mut storages = Vec::new();
    let mut stream_meta: Vec<(String, u32)> = Vec::new();

    for entry in comp.walk() {
        if entry.is_root() {
            continue;
        }
        let base = entry_base_path(&entry)?;
        if is_library_marker_path(&base) {
            continue;
        }
        if entry.is_storage() {
            let display = format!("{base}/");
            if skip_view_text && is_view_text_display_path(&display) {
                continue;
            }
            storages.push(CapturedStorage {
                path: base,
                clsid: *entry.clsid(),
                state_bits: entry.state_bits(),
            });
        } else if entry.is_stream() {
            if skip_view_text && is_view_text_display_path(&base) {
                continue;
            }
            stream_meta.push((base, entry.state_bits()));
        }
    }

    let mut streams = Vec::with_capacity(stream_meta.len());
    for (path, state_bits) in stream_meta {
        let data = read_raw_stream(comp, &path)?;
        streams.push(CapturedStream {
            path,
            data,
            state_bits,
        });
    }

    Some((root_clsid, root_state_bits, storages, streams))
}

fn write_clean_container(
    version: cfb::Version,
    root_clsid: uuid::Uuid,
    root_state_bits: u32,
    storages: &[CapturedStorage],
    streams: &[(String, Vec<u8>, u32)],
) -> Option<Vec<u8>> {
    let mut out = cfb::CompoundFile::create_with_version(version, Cursor::new(Vec::new())).ok()?;
    if !root_clsid.is_nil() {
        out.set_storage_clsid("/", root_clsid).ok()?;
    }
    if root_state_bits != 0 {
        out.set_state_bits("/", root_state_bits).ok()?;
    }

    for storage in storages {
        out.create_storage_all(&storage.path).ok()?;
        if !storage.clsid.is_nil() {
            out.set_storage_clsid(&storage.path, storage.clsid).ok()?;
        }
        if storage.state_bits != 0 {
            out.set_state_bits(&storage.path, storage.state_bits).ok()?;
        }
    }

    for (path, data, state_bits) in streams {
        if let Some(idx) = path.rfind('/')
            && idx > 0
            && !out.is_storage(&path[..idx])
        {
            out.create_storage_all(&path[..idx]).ok()?;
        }
        {
            let mut stream = out.create_stream(path).ok()?;
            stream.write_all(data).ok()?;
        }
        if *state_bits != 0 {
            out.set_state_bits(path, *state_bits).ok()?;
        }
    }

    out.flush().ok()?;
    Some(out.into_inner().into_inner())
}

pub fn rewrite_streams_inner(
    bytes: &[u8],
    manifest_json: &str,
    payloads: &[u8],
) -> Option<Vec<u8>> {
    let meta_list: Vec<ReplacementMeta> = serde_json::from_str(manifest_json).ok()?;

    let mut src = cfb::CompoundFile::open(Cursor::new(bytes)).ok()?;
    let info = inspect_compound(&mut src);
    if !info.valid || info.encrypted || info.distribution || info.has_view_text {
        return None;
    }

    let mut replacements: BTreeMap<String, (&[u8], bool)> = BTreeMap::new();
    for item in &meta_list {
        let end = item.offset.checked_add(item.length)?;
        let slice = payloads.get(item.offset..end)?;
        let canonical = resolve_stream_path(&src, &item.path)?;
        if is_library_marker_path(&canonical) {
            return None;
        }
        replacements.insert(canonical, (slice, item.plain));
    }

    let version = src.version();
    let (root_clsid, root_state_bits, storages, streams) = capture_entries(&mut src, false)?;

    let mut expected_paths: BTreeSet<String> = BTreeSet::new();
    for s in &storages {
        expected_paths.insert(format!("{}/", s.path));
    }
    let mut out_streams: Vec<(String, Vec<u8>, u32)> = Vec::with_capacity(streams.len());
    for stream in &streams {
        expected_paths.insert(stream.path.clone());
        let written_bytes = if let Some(&(wanted, plain)) = replacements.get(&stream.path) {
            if info.compressed && !plain {
                deflate_raw(wanted)?
            } else {
                wanted.to_vec()
            }
        } else {
            stream.data.clone()
        };
        out_streams.push((stream.path.clone(), written_bytes, stream.state_bits));
    }

    let out = write_clean_container(
        version,
        root_clsid,
        root_state_bits,
        &storages,
        &out_streams,
    )?;

    // Self-readback verification (Guarantees 1, 2, and 3)
    if !ole2_unused_slots_are_free(&out) {
        return None;
    }
    let mut check = cfb::CompoundFile::open(Cursor::new(&out[..])).ok()?;
    let check_info = inspect_compound(&mut check);
    if !check_info.valid
        || check_info.encrypted
        || check_info.distribution
        || check_info.has_view_text
        || check_info.compressed != info.compressed
    {
        return None;
    }
    if check_info
        .paths
        .iter()
        .any(|p| p.contains(LIBRARY_MARKER_NAME))
    {
        return None;
    }
    let actual_paths: BTreeSet<String> = check_info.paths.into_iter().collect();
    if actual_paths != expected_paths {
        return None;
    }
    for stream in &streams {
        let after_raw = read_raw_stream(&mut check, &stream.path)?;
        if let Some(&(wanted, plain)) = replacements.get(&stream.path) {
            if info.compressed && !plain {
                let inflated = inflate_raw(&after_raw)?;
                if inflated != wanted {
                    return None;
                }
            } else if after_raw != wanted {
                return None;
            }
        } else if after_raw != stream.data {
            return None;
        }
    }

    Some(out)
}

pub fn strip_tracked_changes_inner(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut src = cfb::CompoundFile::open(Cursor::new(bytes)).ok()?;
    let info = inspect_compound(&mut src);
    if !info.valid
        || !info.tracked
        || !info.has_view_text
        || info.encrypted
        || info.distribution
        || info.sections == 0
    {
        return None;
    }

    let header_path = resolve_stream_path(&src, "/FileHeader")?;
    let mut expected_bodies: Vec<(String, Vec<u8>)> = Vec::with_capacity(info.sections);
    for idx in 0..info.sections {
        let path = resolve_stream_path(&src, &format!("/BodyText/Section{idx}"))?;
        let raw = read_raw_stream(&mut src, &path)?;
        expected_bodies.push((path, raw));
    }

    let version = src.version();
    let (root_clsid, root_state_bits, storages, streams) = capture_entries(&mut src, true)?;

    let mut expected_paths: BTreeSet<String> = BTreeSet::new();
    for s in &storages {
        expected_paths.insert(format!("{}/", s.path));
    }

    let mut expected_header: Option<Vec<u8>> = None;
    let mut out_streams: Vec<(String, Vec<u8>, u32)> = Vec::with_capacity(streams.len());
    for stream in &streams {
        expected_paths.insert(stream.path.clone());
        if stream.path.eq_ignore_ascii_case(&header_path) {
            if stream.data.len() < FILE_HEADER_MIN_LEN {
                return None;
            }
            let mut next_header = stream.data.clone();
            let flags = u32::from_le_bytes([
                next_header[FILE_HEADER_FLAGS_OFFSET],
                next_header[FILE_HEADER_FLAGS_OFFSET + 1],
                next_header[FILE_HEADER_FLAGS_OFFSET + 2],
                next_header[FILE_HEADER_FLAGS_OFFSET + 3],
            ]);
            let cleared = flags & !FLAG_TRACKED;
            next_header[FILE_HEADER_FLAGS_OFFSET..FILE_HEADER_FLAGS_OFFSET + 4]
                .copy_from_slice(&cleared.to_le_bytes());
            expected_header = Some(next_header.clone());
            out_streams.push((stream.path.clone(), next_header, stream.state_bits));
        } else {
            out_streams.push((stream.path.clone(), stream.data.clone(), stream.state_bits));
        }
    }
    let expected_header = expected_header?;

    let out = write_clean_container(
        version,
        root_clsid,
        root_state_bits,
        &storages,
        &out_streams,
    )?;

    // Self-readback verification
    if !ole2_unused_slots_are_free(&out) {
        return None;
    }
    let mut check = cfb::CompoundFile::open(Cursor::new(&out[..])).ok()?;
    let check_info = inspect_compound(&mut check);
    if !check_info.valid
        || check_info.encrypted
        || check_info.distribution
        || check_info.tracked
        || check_info.has_view_text
        || check_info.compressed != info.compressed
        || check_info.sections != expected_bodies.len()
    {
        return None;
    }
    if check_info
        .paths
        .iter()
        .any(|p| p.contains(LIBRARY_MARKER_NAME))
    {
        return None;
    }
    let actual_paths: BTreeSet<String> = check_info.paths.into_iter().collect();
    if actual_paths != expected_paths {
        return None;
    }
    for (sec_path, expected_raw) in &expected_bodies {
        let after_raw = read_raw_stream(&mut check, sec_path)?;
        if &after_raw != expected_raw {
            return None;
        }
    }
    for stream in &streams {
        let after_raw = read_raw_stream(&mut check, &stream.path)?;
        if stream.path.eq_ignore_ascii_case(&header_path) {
            if after_raw != expected_header {
                return None;
            }
        } else if after_raw != stream.data {
            return None;
        }
    }

    Some(out)
}

#[wasm_bindgen]
pub fn inspect_hwp5(bytes: &[u8]) -> String {
    serde_json::to_string(&inspect_hwp5_inner(bytes)).unwrap_or_else(|_| {
        r#"{"valid":false,"compressed":false,"encrypted":false,"distribution":false,"tracked":false,"hasViewText":false,"sections":0,"paths":[],"streamPaths":[]}"#.to_string()
    })
}

#[wasm_bindgen]
pub fn read_stream(bytes: &[u8], path: &str, decompress: bool) -> Option<Vec<u8>> {
    read_stream_inner(bytes, path, decompress)
}

#[wasm_bindgen]
pub fn parse_records(stream_bytes: &[u8]) -> Option<String> {
    let records = parse_records_inner(stream_bytes)?;
    serde_json::to_string(&records).ok()
}

#[wasm_bindgen]
pub fn rewrite_streams(bytes: &[u8], manifest_json: &str, payloads: &[u8]) -> Option<Vec<u8>> {
    rewrite_streams_inner(bytes, manifest_json, payloads)
}

#[wasm_bindgen]
pub fn strip_tracked_changes(bytes: &[u8]) -> Option<Vec<u8>> {
    strip_tracked_changes_inner(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_file_header(flags: u32) -> Vec<u8> {
        let mut header = vec![0u8; 256];
        header[..SIGNATURE.len()].copy_from_slice(SIGNATURE);
        header[32..36].copy_from_slice(&0x0501_0000u32.to_le_bytes());
        header[36..40].copy_from_slice(&flags.to_le_bytes());
        header
    }

    fn make_record(tag: u16, level: u16, payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        if payload.len() < 0xfff {
            let word = (u32::from(tag) & 0x3ff)
                | ((u32::from(level) & 0x3ff) << 10)
                | ((payload.len() as u32) << 20);
            out.extend_from_slice(&word.to_le_bytes());
        } else {
            let word =
                (u32::from(tag) & 0x3ff) | ((u32::from(level) & 0x3ff) << 10) | (0xfffu32 << 20);
            out.extend_from_slice(&word.to_le_bytes());
            out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        }
        out.extend_from_slice(payload);
        out
    }

    fn build_hwp5(
        flags: u32,
        sections: &[&[u8]],
        extra_streams: &[(&str, &[u8])],
        extra_storages: &[&str],
    ) -> Vec<u8> {
        let compressed = (flags & FLAG_COMPRESSED) != 0;
        let mut comp =
            cfb::CompoundFile::create_with_version(cfb::Version::V3, Cursor::new(Vec::new()))
                .unwrap();

        {
            let mut s = comp.create_stream("/FileHeader").unwrap();
            s.write_all(&make_file_header(flags)).unwrap();
        }
        {
            let doc_info = make_record(17, 0, &[0u8; 32]);
            let data = if compressed {
                deflate_raw(&doc_info).unwrap()
            } else {
                doc_info
            };
            let mut s = comp.create_stream("/DocInfo").unwrap();
            s.write_all(&data).unwrap();
        }
        if !sections.is_empty() {
            comp.create_storage("/BodyText").unwrap();
            for (i, sec) in sections.iter().enumerate() {
                let data = if compressed {
                    deflate_raw(sec).unwrap()
                } else {
                    sec.to_vec()
                };
                let mut s = comp.create_stream(format!("/BodyText/Section{i}")).unwrap();
                s.write_all(&data).unwrap();
            }
        }
        for storage in extra_storages {
            comp.create_storage_all(storage).unwrap();
        }
        for (path, data) in extra_streams {
            if let Some(idx) = path.rfind('/')
                && idx > 0
            {
                comp.create_storage_all(&path[..idx]).unwrap();
            }
            let mut s = comp.create_stream(path).unwrap();
            s.write_all(data).unwrap();
        }
        comp.flush().unwrap();
        comp.into_inner().into_inner()
    }

    #[test]
    fn inspect_valid_compressed_hwp5() {
        let sec0 = make_record(66, 0, &[1, 2, 3, 4]);
        let sec1 = make_record(66, 0, &[5, 6, 7, 8]);
        let bytes = build_hwp5(
            FLAG_COMPRESSED,
            &[&sec0, &sec1],
            &[
                ("/PrvText", b"h\x00i\x00"),
                ("/PrvImage", &[0x89, 0x50, 0x4e, 0x47]),
                ("/BinData/BIN0001.png", &[1, 2, 3]),
                ("/DocOptions/_LinkDoc", &[9, 9]),
                ("/Scripts/DefaultJScript", &[7, 8]),
                ("/\x05HwpSummaryInformation", &[0xfe, 0xff, 0x00, 0x00]),
            ],
            &[],
        );

        let info = inspect_hwp5_inner(&bytes);
        assert!(info.valid);
        assert!(info.compressed);
        assert!(!info.encrypted);
        assert!(!info.distribution);
        assert!(!info.tracked);
        assert!(!info.has_view_text);
        assert_eq!(info.sections, 2);
        assert!(info.paths.contains(&"/BodyText/".to_string()));
        assert!(info.paths.contains(&"/BinData/".to_string()));
        assert!(info.stream_paths.contains(&"/FileHeader".to_string()));
        assert!(info.stream_paths.contains(&"/BodyText/Section0".to_string()));
        assert!(info.stream_paths.contains(&"/BodyText/Section1".to_string()));
        assert!(
            info.stream_paths
                .contains(&"/\x05HwpSummaryInformation".to_string())
        );
    }

    #[test]
    fn inspect_valid_uncompressed_hwp5() {
        let sec0 = make_record(66, 0, &[10, 20]);
        let bytes = build_hwp5(0, &[&sec0], &[], &[]);
        let info = inspect_hwp5_inner(&bytes);
        assert!(info.valid);
        assert!(!info.compressed);
        assert_eq!(info.sections, 1);
    }

    #[test]
    fn inspect_flags_and_viewtext() {
        let sec0 = make_record(66, 0, &[1, 2]);
        let bytes = build_hwp5(
            FLAG_COMPRESSED | FLAG_ENCRYPTED | FLAG_DISTRIBUTION | FLAG_TRACKED,
            &[&sec0],
            &[("/ViewText/Section0", &[0u8; 8])],
            &[],
        );
        let info = inspect_hwp5_inner(&bytes);
        assert!(info.valid);
        assert!(info.compressed);
        assert!(info.encrypted);
        assert!(info.distribution);
        assert!(info.tracked);
        assert!(info.has_view_text);

        let bytes_empty_vt = build_hwp5(FLAG_COMPRESSED, &[&sec0], &[], &["/viewtext"]);
        let info_vt = inspect_hwp5_inner(&bytes_empty_vt);
        assert!(info_vt.valid);
        assert!(info_vt.has_view_text);
    }

    #[test]
    fn inspect_invalid_and_corrupt_inputs_never_panic() {
        assert!(!inspect_hwp5_inner(&[]).valid);
        assert!(!inspect_hwp5_inner(&[0x50, 0x4b, 0x03, 0x04, 0x00]).valid);
        assert!(!inspect_hwp5_inner(&[0xff; 1024]).valid);

        let mut comp =
            cfb::CompoundFile::create_with_version(cfb::Version::V3, Cursor::new(Vec::new()))
                .unwrap();
        {
            let mut s = comp.create_stream("/FileHeader").unwrap();
            s.write_all(&[0u8; 64]).unwrap();
        }
        comp.flush().unwrap();
        assert!(!inspect_hwp5_inner(&comp.into_inner().into_inner()).valid);

        let mut comp2 =
            cfb::CompoundFile::create_with_version(cfb::Version::V3, Cursor::new(Vec::new()))
                .unwrap();
        {
            let mut s = comp2.create_stream("/FileHeader").unwrap();
            s.write_all(SIGNATURE).unwrap();
        }
        comp2.flush().unwrap();
        assert!(!inspect_hwp5_inner(&comp2.into_inner().into_inner()).valid);
    }

    #[test]
    fn read_stream_compressed_raw_and_summary() {
        let sec0 = make_record(66, 0, &[42, 43, 44, 45]);
        let summary = b"\xfe\xff\x00\x00summary-bytes";
        let bytes = build_hwp5(
            FLAG_COMPRESSED,
            &[&sec0],
            &[
                ("/PrvText", b"a\x00b\x00"),
                ("/\x05HwpSummaryInformation", summary),
            ],
            &[],
        );

        assert_eq!(
            read_stream_inner(&bytes, "/BodyText/Section0", true),
            Some(sec0.clone())
        );
        assert_eq!(
            read_stream_inner(&bytes, "bodytext/section0", true),
            Some(sec0)
        );
        assert_eq!(
            read_stream_inner(&bytes, "/PrvText", false),
            Some(b"a\x00b\x00".to_vec())
        );
        assert_eq!(
            read_stream_inner(&bytes, "/\x05HwpSummaryInformation", false),
            Some(summary.to_vec())
        );
        assert_eq!(read_stream_inner(&bytes, "/Missing", false), None);
        assert_eq!(read_stream_inner(b"not ole2", "/FileHeader", false), None);
        // Corrupt deflate returns None
        assert_eq!(read_stream_inner(&bytes, "/PrvText", true), None);
    }

    #[test]
    fn parse_records_normal_extended_and_malformed() {
        assert_eq!(parse_records_inner(&[]), Some(vec![]));

        let mut stream = Vec::new();
        stream.extend_from_slice(&make_record(66, 0, &[1, 2, 3, 4]));
        let big_payload = vec![0xab; 5000];
        stream.extend_from_slice(&make_record(67, 1, &big_payload));

        let recs = parse_records_inner(&stream).expect("valid records");
        assert_eq!(recs.len(), 2);
        assert_eq!(
            recs[0],
            HwpRecord {
                tag: 66,
                level: 0,
                start: 0,
                body: 4,
                end: 8,
            }
        );
        assert_eq!(
            recs[1],
            HwpRecord {
                tag: 67,
                level: 1,
                start: 8,
                body: 16,
                end: 5016,
            }
        );

        assert_eq!(parse_records_inner(&[1, 2, 3]), None);
        assert_eq!(parse_records_inner(&stream[..stream.len() - 1]), None);
        let ext_only = (66u32 | (0xfffu32 << 20)).to_le_bytes();
        assert_eq!(parse_records_inner(&ext_only), None);
        let mut overflow = Vec::new();
        overflow.extend_from_slice(&ext_only);
        overflow.extend_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(parse_records_inner(&overflow), None);
    }

    #[test]
    fn rewrite_streams_preserves_all_and_maintains_ole2_guarantees() {
        let orig_sec0 = make_record(66, 0, &[1, 2, 3, 4]);
        let orig_prv_text = b"o\x00l\x00d\x00";
        let orig_prv_image = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        let summary = b"\xfe\xff\x00\x00keep-me-intact";
        let bin_data = vec![0x5a; 8192];
        let orig = build_hwp5(
            FLAG_COMPRESSED,
            &[&orig_sec0],
            &[
                ("/PrvText", orig_prv_text),
                ("/PrvImage", orig_prv_image),
                ("/BinData/BIN0001.png", &bin_data),
                ("/DocOptions/_LinkDoc", &[1, 2, 3]),
                ("/Scripts/DefaultJScript", &[4, 5, 6]),
                ("/\x05HwpSummaryInformation", summary),
            ],
            &[],
        );

        let new_sec0 = make_record(66, 0, &vec![0x77; 6000]);
        let new_prv_text = b"n\x00e\x00w\x00";
        let mut payloads = Vec::new();
        let off0 = 0;
        payloads.extend_from_slice(&new_sec0);
        let off1 = payloads.len();
        payloads.extend_from_slice(new_prv_text);

        let manifest = serde_json::json!([
            { "path": "/BodyText/Section0", "offset": off0, "length": new_sec0.len(), "plain": false },
            { "path": "/PrvText", "offset": off1, "length": new_prv_text.len(), "plain": true }
        ])
        .to_string();

        let rewritten =
            rewrite_streams_inner(&orig, &manifest, &payloads).expect("rewrite succeeds");

        let info = inspect_hwp5_inner(&rewritten);
        assert!(info.valid);
        assert!(!info.paths.iter().any(|p| p.contains(LIBRARY_MARKER_NAME)));
        assert!(ole2_unused_slots_are_free(&rewritten));

        assert_eq!(
            read_stream_inner(&rewritten, "/BodyText/Section0", true),
            Some(new_sec0)
        );
        assert_eq!(
            read_stream_inner(&rewritten, "/PrvText", false),
            Some(new_prv_text.to_vec())
        );
        assert_eq!(
            read_stream_inner(&rewritten, "/PrvImage", false),
            Some(orig_prv_image.to_vec())
        );
        assert_eq!(
            read_stream_inner(&rewritten, "/BinData/BIN0001.png", false),
            Some(bin_data)
        );
        assert_eq!(
            read_stream_inner(&rewritten, "/\x05HwpSummaryInformation", false),
            Some(summary.to_vec())
        );
        assert_eq!(
            read_stream_inner(&rewritten, "/DocOptions/_LinkDoc", false),
            Some(vec![1, 2, 3])
        );
        assert_eq!(
            read_stream_inner(&rewritten, "/Scripts/DefaultJScript", false),
            Some(vec![4, 5, 6])
        );
    }

    #[test]
    fn rewrite_streams_large_multi_fat_and_strips_legacy_marker() {
        let sec0 = make_record(66, 0, &[1, 2, 3]);
        // > 64 KiB forces multiple FAT sectors plus MiniFAT for small streams
        let large_bin = vec![0x3c; 80_000];
        let orig = build_hwp5(
            FLAG_COMPRESSED,
            &[&sec0],
            &[
                ("/BinData/BIG.bin", &large_bin),
                ("/ Sh33tJ5", b"legacy-marker"),
            ],
            &[],
        );

        let next_sec0 = make_record(66, 0, &[9, 9, 9]);
        let manifest = serde_json::json!([
            { "path": "/BodyText/Section0", "offset": 0, "length": next_sec0.len(), "plain": false }
        ])
        .to_string();

        let rewritten =
            rewrite_streams_inner(&orig, &manifest, &next_sec0).expect("rewrite succeeds");
        let info = inspect_hwp5_inner(&rewritten);
        assert!(info.valid);
        assert!(!info.paths.iter().any(|p| p.contains(LIBRARY_MARKER_NAME)));
        assert!(ole2_unused_slots_are_free(&rewritten));
        assert_eq!(
            read_stream_inner(&rewritten, "/BinData/BIG.bin", false),
            Some(large_bin)
        );
    }

    #[test]
    fn rewrite_streams_uncompressed_and_rejections() {
        let sec0 = make_record(66, 0, &[1, 2]);
        let orig = build_hwp5(0, &[&sec0], &[], &[]);
        let new_sec0 = make_record(66, 0, &[9, 8, 7, 6]);
        let manifest = serde_json::json!([
            { "path": "/BodyText/Section0", "offset": 0, "length": new_sec0.len(), "plain": false }
        ])
        .to_string();
        let rewritten = rewrite_streams_inner(&orig, &manifest, &new_sec0).expect("rewrite ok");
        assert_eq!(
            read_stream_inner(&rewritten, "/BodyText/Section0", false),
            Some(new_sec0.clone())
        );
        assert!(ole2_unused_slots_are_free(&rewritten));

        let bad_path = serde_json::json!([
            { "path": "/BodyText/Section99", "offset": 0, "length": new_sec0.len(), "plain": false }
        ])
        .to_string();
        assert_eq!(rewrite_streams_inner(&orig, &bad_path, &new_sec0), None);

        let bad_bounds = serde_json::json!([
            { "path": "/BodyText/Section0", "offset": 0, "length": new_sec0.len() + 1, "plain": false }
        ])
        .to_string();
        assert_eq!(rewrite_streams_inner(&orig, &bad_bounds, &new_sec0), None);

        let enc = build_hwp5(FLAG_COMPRESSED | FLAG_ENCRYPTED, &[&sec0], &[], &[]);
        assert_eq!(rewrite_streams_inner(&enc, &manifest, &new_sec0), None);

        let dist = build_hwp5(FLAG_COMPRESSED | FLAG_DISTRIBUTION, &[&sec0], &[], &[]);
        assert_eq!(rewrite_streams_inner(&dist, &manifest, &new_sec0), None);

        let vt = build_hwp5(
            FLAG_COMPRESSED,
            &[&sec0],
            &[("/ViewText/Section0", &[1, 2, 3])],
            &[],
        );
        assert_eq!(rewrite_streams_inner(&vt, &manifest, &new_sec0), None);
    }

    #[test]
    fn ole2_checker_detects_end_of_chain_in_unused_fat_slot() {
        let sec0 = make_record(66, 0, &[1, 2, 3, 4]);
        let mut bytes = build_hwp5(FLAG_COMPRESSED, &[&sec0], &[], &[]);
        assert!(ole2_unused_slots_are_free(&bytes));

        // Corrupt the last slot of the first FAT sector to END_OF_CHAIN (the SheetJS bug)
        let fat0 = u32::from_le_bytes([bytes[76], bytes[77], bytes[78], bytes[79]]) as usize;
        let last_slot_offset = 512 + fat0 * 512 + 127 * 4;
        bytes[last_slot_offset..last_slot_offset + 4].copy_from_slice(&END_OF_CHAIN.to_le_bytes());
        assert!(!ole2_unused_slots_are_free(&bytes));
    }

    #[test]
    fn strip_tracked_changes_works_and_rejects_invalid() {
        let sec0 = make_record(66, 0, &[11, 22, 33, 44]);
        let sec1 = make_record(66, 0, &[55, 66]);
        let summary = b"\xfe\xff\x00\x00meta";
        let tracked = build_hwp5(
            FLAG_COMPRESSED | FLAG_TRACKED,
            &[&sec0, &sec1],
            &[
                ("/ViewText/Section0", b"view-copy-0"),
                ("/ViewText/Section1", b"view-copy-1"),
                ("/\x05HwpSummaryInformation", summary),
            ],
            &[],
        );

        let stripped = strip_tracked_changes_inner(&tracked).expect("strip succeeds");
        let info = inspect_hwp5_inner(&stripped);
        assert!(info.valid);
        assert!(info.compressed);
        assert!(!info.tracked);
        assert!(!info.has_view_text);
        assert_eq!(info.sections, 2);
        assert!(
            !info
                .paths
                .iter()
                .any(|p| p.to_ascii_lowercase().contains("viewtext"))
        );
        assert!(!info.paths.iter().any(|p| p.contains(LIBRARY_MARKER_NAME)));
        assert!(ole2_unused_slots_are_free(&stripped));

        assert_eq!(
            read_stream_inner(&stripped, "/BodyText/Section0", true),
            Some(sec0.clone())
        );
        assert_eq!(
            read_stream_inner(&stripped, "/BodyText/Section1", true),
            Some(sec1.clone())
        );
        assert_eq!(
            read_stream_inner(&stripped, "/\x05HwpSummaryInformation", false),
            Some(summary.to_vec())
        );

        let header = read_stream_inner(&stripped, "/FileHeader", false).unwrap();
        let flags = u32::from_le_bytes([header[36], header[37], header[38], header[39]]);
        assert_eq!(flags & FLAG_COMPRESSED, FLAG_COMPRESSED);
        assert_eq!(flags & FLAG_TRACKED, 0);

        let plain = build_hwp5(FLAG_COMPRESSED, &[&sec0], &[], &[]);
        assert_eq!(strip_tracked_changes_inner(&plain), None);

        let flag_only = build_hwp5(FLAG_COMPRESSED | FLAG_TRACKED, &[&sec0], &[], &[]);
        assert_eq!(strip_tracked_changes_inner(&flag_only), None);

        let vt_only = build_hwp5(
            FLAG_COMPRESSED,
            &[&sec0],
            &[("/ViewText/Section0", b"v")],
            &[],
        );
        assert_eq!(strip_tracked_changes_inner(&vt_only), None);

        let enc = build_hwp5(
            FLAG_COMPRESSED | FLAG_TRACKED | FLAG_ENCRYPTED,
            &[&sec0],
            &[("/ViewText/Section0", b"v")],
            &[],
        );
        assert_eq!(strip_tracked_changes_inner(&enc), None);

        let dist = build_hwp5(
            FLAG_COMPRESSED | FLAG_TRACKED | FLAG_DISTRIBUTION,
            &[&sec0],
            &[("/ViewText/Section0", b"v")],
            &[],
        );
        assert_eq!(strip_tracked_changes_inner(&dist), None);

        let no_body = build_hwp5(
            FLAG_COMPRESSED | FLAG_TRACKED,
            &[],
            &[("/ViewText/Section0", b"v")],
            &[],
        );
        assert_eq!(strip_tracked_changes_inner(&no_body), None);

        assert_eq!(strip_tracked_changes_inner(b"garbage"), None);
    }
}
