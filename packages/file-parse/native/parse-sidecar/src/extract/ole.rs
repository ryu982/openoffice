use std::io::{Cursor, Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};

use encoding_rs::WINDOWS_1252;

use crate::protocol::RejectCode;

/// Hard cap per OLE2 stream (and normalized container) read into memory (128 MiB),
/// matching the legacy importers' compound-file safety cap.
pub const MAX_OLE_STREAM_BYTES: usize = 128 * 1024 * 1024;

const OLE2_MAGIC: &[u8; 8] = &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
const HEADER_FAT_SLOTS: usize = 109;
const FREE_SECT: u32 = 0xFFFF_FFFF;
const END_OF_CHAIN: u32 = 0xFFFF_FFFE;

#[derive(Debug)]
pub enum OleError {
    Cancelled,
    PasswordProtected(String),
    Corrupt(String),
    Io(String),
}

impl OleError {
    pub fn reject_code(&self) -> RejectCode {
        match self {
            OleError::Cancelled => RejectCode::Corrupt,
            OleError::PasswordProtected(_) => RejectCode::PasswordProtected,
            OleError::Corrupt(_) => RejectCode::Corrupt,
            OleError::Io(_) => RejectCode::IoError,
        }
    }

    pub fn message(&self) -> String {
        match self {
            OleError::Cancelled => "cancelled".to_owned(),
            OleError::PasswordProtected(msg)
            | OleError::Corrupt(msg)
            | OleError::Io(msg) => msg.clone(),
        }
    }
}

/// Wrapper over `cfb::CompoundFile` that streams directly from the underlying
/// `Read + Seek` handle on standard containers and falls back to an in-memory
/// FAT/MiniFAT unused-slot normalization only when a container uses lenient
/// `0xFFFFFFFE` padding (such as files produced by SheetJS `cfb`).
pub enum OleContainer<R: Read + Seek> {
    Direct(cfb::CompoundFile<R>),
    Normalized(cfb::CompoundFile<Cursor<Vec<u8>>>),
}

impl<R: Read + Seek> OleContainer<R> {
    pub fn resolve_stream_path(&self, requested: &str) -> Option<String> {
        match self {
            OleContainer::Direct(comp) => resolve_stream_path_inner(comp, requested),
            OleContainer::Normalized(comp) => resolve_stream_path_inner(comp, requested),
        }
    }

    pub fn has_stream_ci(&self, requested: &str) -> bool {
        self.resolve_stream_path(requested).is_some()
    }

    pub fn read_stream_capped(
        &mut self,
        canonical_path: &str,
        max_bytes: usize,
        cancelled: &AtomicBool,
    ) -> Result<Vec<u8>, OleError> {
        match self {
            OleContainer::Direct(comp) => {
                read_stream_capped_inner(comp, canonical_path, max_bytes, cancelled)
            }
            OleContainer::Normalized(comp) => {
                read_stream_capped_inner(comp, canonical_path, max_bytes, cancelled)
            }
        }
    }
}

/// Rewrites unused FAT and MiniFAT slots from `END_OF_CHAIN` (`0xFFFFFFFE`) to
/// `FREE_SECT` (`0xFFFFFFFF`) in place. Returns `true` if at least one slot changed.
fn normalize_ole2_free_slots_in_place(file: &mut [u8]) -> bool {
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

    let read_u32 = |buf: &[u8], offset: usize| -> Option<u32> {
        let slice = buf.get(offset..offset.checked_add(4)?)?;
        Some(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
    };
    let sector_at = |index: usize| -> Option<usize> {
        index
            .checked_mul(sector_size)
            .and_then(|off| off.checked_add(sector_size))
    };

    let mut fat_sectors = Vec::new();
    for slot in 0..HEADER_FAT_SLOTS {
        let Some(s) = read_u32(file, 76 + slot * 4) else {
            return false;
        };
        if (s as usize) < total_sectors {
            fat_sectors.push(s as usize);
        }
    }

    let Some(mut difat) = read_u32(file, 68) else {
        return false;
    };
    let mut guard = 0usize;
    while (difat as usize) < total_sectors && guard < total_sectors {
        let Some(base) = sector_at(difat as usize) else {
            return false;
        };
        if base.checked_add(sector_size).is_none_or(|end| end > file.len()) {
            return false;
        }
        for slot in 0..(fat_per_sector - 1) {
            let Some(s) = read_u32(file, base + slot * 4) else {
                return false;
            };
            if (s as usize) < total_sectors {
                fat_sectors.push(s as usize);
            }
        }
        let Some(next_difat) = read_u32(file, base + (fat_per_sector - 1) * 4) else {
            return false;
        };
        difat = next_difat;
        guard += 1;
    }

    let next_in_fat = |buf: &[u8], sector: usize| -> u32 {
        let table_idx = sector / fat_per_sector;
        let Some(&table) = fat_sectors.get(table_idx) else {
            return END_OF_CHAIN;
        };
        let Some(base) = sector_at(table) else {
            return END_OF_CHAIN;
        };
        read_u32(buf, base + (sector % fat_per_sector) * 4).unwrap_or(END_OF_CHAIN)
    };

    let mut mini_sectors = Vec::new();
    let Some(mut mini) = read_u32(file, 60) else {
        return false;
    };
    let mut mini_guard = 0usize;
    while (mini as usize) < total_sectors && mini_guard < total_sectors {
        mini_sectors.push(mini as usize);
        mini = next_in_fat(file, mini as usize);
        mini_guard += 1;
    }

    let used_mini_sectors: Option<u64> = (|| {
        let dir_first = read_u32(file, 48)? as usize;
        if dir_first >= total_sectors {
            return None;
        }
        let dir_base = sector_at(dir_first)?;
        let root_size = if sector_shift == 9 {
            u64::from(read_u32(file, dir_base + 120)?)
        } else {
            let slice = file.get(dir_base + 120..dir_base + 128)?;
            u64::from_le_bytes([
                slice[0], slice[1], slice[2], slice[3], slice[4], slice[5], slice[6], slice[7],
            ])
        };
        Some(root_size.div_ceil(mini_sector_size as u64))
    })();

    let mut changed = false;

    if let Some(used_mini) = used_mini_sectors {
        for (nth, &sector) in mini_sectors.iter().enumerate() {
            let Some(base) = sector_at(sector) else {
                continue;
            };
            if base.checked_add(sector_size).is_none_or(|end| end > file.len()) {
                continue;
            }
            for slot in 0..fat_per_sector {
                let entry_idx = (nth * fat_per_sector + slot) as u64;
                if entry_idx >= used_mini {
                    let at = base + slot * 4;
                    if read_u32(file, at) == Some(END_OF_CHAIN) {
                        file[at..at + 4].copy_from_slice(&FREE_SECT.to_le_bytes());
                        changed = true;
                    }
                }
            }
        }
    }

    for (nth, &sector) in fat_sectors.iter().enumerate() {
        let Some(base) = sector_at(sector) else {
            continue;
        };
        if base.checked_add(sector_size).is_none_or(|end| end > file.len()) {
            continue;
        }
        for slot in 0..fat_per_sector {
            let entry_idx = nth * fat_per_sector + slot;
            if entry_idx >= total_sectors {
                let at = base + slot * 4;
                if read_u32(file, at) == Some(END_OF_CHAIN) {
                    file[at..at + 4].copy_from_slice(&FREE_SECT.to_le_bytes());
                    changed = true;
                }
            }
        }
    }

    changed
}

fn read_all_capped<R: Read + Seek>(
    reader: &mut R,
    max_bytes: usize,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, OleError> {
    let total_len = reader
        .seek(SeekFrom::End(0))
        .map_err(|e| OleError::Io(e.to_string()))?;
    if total_len > max_bytes as u64 {
        return Err(OleError::Corrupt(format!(
            "OLE2 container size ({total_len} bytes) exceeds limit ({max_bytes} bytes)"
        )));
    }
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|e| OleError::Io(e.to_string()))?;
    let mut out = Vec::with_capacity((total_len as usize).min(64 * 1024));
    let mut chunk = [0u8; 64 * 1024];
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err(OleError::Cancelled);
        }
        let n = reader
            .read(&mut chunk)
            .map_err(|e| OleError::Io(e.to_string()))?;
        if n == 0 {
            break;
        }
        let next_len = out
            .len()
            .checked_add(n)
            .ok_or_else(|| OleError::Corrupt("OLE2 container length overflow".to_owned()))?;
        if next_len > max_bytes {
            return Err(OleError::Corrupt(format!(
                "OLE2 container exceeds limit ({max_bytes} bytes)"
            )));
        }
        out.extend_from_slice(&chunk[..n]);
    }
    Ok(out)
}

pub fn open_ole<R: Read + Seek>(
    mut reader: R,
    cancelled: &AtomicBool,
) -> Result<OleContainer<R>, OleError> {
    if cancelled.load(Ordering::Acquire) {
        return Err(OleError::Cancelled);
    }
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|e| OleError::Io(e.to_string()))?;

    // Check file length first so we can safely retry with normalized unused FAT
    // slots without losing ownership of `reader` on the common streaming path.
    let file_len = reader
        .seek(SeekFrom::End(0))
        .map_err(|e| OleError::Io(e.to_string()))?;
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|e| OleError::Io(e.to_string()))?;

    // When the container is small enough to normalize if needed, try opening
    // directly via a thin `&mut` borrow? `CompoundFile::open` takes `R` by value,
    // so only fall back if `open` fails. Because `open` consumes `reader` on error,
    // check the 512-byte header and FAT slots in-stream ONLY on small files or wrap
    // with `BufReader`? Better: `CompoundFile::open` on `R` directly fails only if
    // FAT has `0xFFFFFFFE` padding. Let's detect whether unused FAT slots contain
    // `0xFFFFFFFE` via a tiny header/FAT peek before handing `reader` to `open`!
    if file_len >= 512 && file_len <= MAX_OLE_STREAM_BYTES as u64 {
        if let Ok(true) = needs_fat_free_slot_normalization(&mut reader, file_len as usize) {
            let mut bytes = read_all_capped(&mut reader, MAX_OLE_STREAM_BYTES, cancelled)?;
            if normalize_ole2_free_slots_in_place(&mut bytes) {
                return cfb::CompoundFile::open(Cursor::new(bytes))
                    .map(OleContainer::Normalized)
                    .map_err(|e| OleError::Corrupt(format!("corrupt OLE2 container: {e}")));
            }
        }
    }

    reader
        .seek(SeekFrom::Start(0))
        .map_err(|e| OleError::Io(e.to_string()))?;
    cfb::CompoundFile::open(reader)
        .map(OleContainer::Direct)
        .map_err(|e| OleError::Corrupt(format!("corrupt OLE2 container: {e}")))
}

/// Peeks only the 512-byte OLE2 header and the last FAT sector to see whether
/// trailing unused FAT slots are padded with `END_OF_CHAIN` (`0xFFFFFFFE`).
/// Leaves zero extra memory allocated on standard containers.
fn needs_fat_free_slot_normalization<R: Read + Seek>(
    reader: &mut R,
    file_len: usize,
) -> std::io::Result<bool> {
    reader.seek(SeekFrom::Start(0))?;
    let mut hdr = [0u8; 512];
    reader.read_exact(&mut hdr)?;
    if &hdr[..8] != OLE2_MAGIC {
        return Ok(false);
    }
    let sector_shift = u16::from_le_bytes([hdr[30], hdr[31]]);
    let mini_shift = u16::from_le_bytes([hdr[32], hdr[33]]);
    if (sector_shift != 9 && sector_shift != 12) || mini_shift > sector_shift {
        return Ok(false);
    }
    let sector_size = 1usize << sector_shift;
    let fat_per_sector = sector_size / 4;
    if file_len < sector_size || !(file_len - sector_size).is_multiple_of(sector_size) {
        return Ok(false);
    }
    let total_sectors = (file_len - sector_size) / sector_size;
    let mut last_fat: Option<(usize, usize)> = None;
    for slot in 0..HEADER_FAT_SLOTS {
        let s = u32::from_le_bytes([
            hdr[76 + slot * 4],
            hdr[76 + slot * 4 + 1],
            hdr[76 + slot * 4 + 2],
            hdr[76 + slot * 4 + 3],
        ]) as usize;
        if s < total_sectors {
            last_fat = Some((slot, s));
        }
    }
    let Some((nth, sector)) = last_fat else {
        return Ok(false);
    };
    let Some(base) = sector
        .checked_mul(sector_size)
        .and_then(|off| off.checked_add(sector_size))
    else {
        return Ok(false);
    };
    if base.checked_add(sector_size).is_none_or(|end| end > file_len) {
        return Ok(false);
    }
    reader.seek(SeekFrom::Start(base as u64))?;
    let mut fat_buf = vec![0u8; sector_size];
    reader.read_exact(&mut fat_buf)?;
    for slot in 0..fat_per_sector {
        let entry_idx = nth * fat_per_sector + slot;
        if entry_idx >= total_sectors {
            let val = u32::from_le_bytes([
                fat_buf[slot * 4],
                fat_buf[slot * 4 + 1],
                fat_buf[slot * 4 + 2],
                fat_buf[slot * 4 + 3],
            ]);
            if val == END_OF_CHAIN {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn normalize_ole_path(raw: &str) -> String {
    let slash = raw.replace('\\', "/");
    let trimmed = slash.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_owned()
    } else if trimmed.starts_with('/') {
        trimmed.to_owned()
    } else {
        format!("/{trimmed}")
    }
}

/// Resolves a stream path inside an OLE2 container with case-insensitive fallback.
fn resolve_stream_path_inner<R: Read + Seek>(
    comp: &cfb::CompoundFile<R>,
    requested: &str,
) -> Option<String> {
    let norm = normalize_ole_path(requested);
    if comp.is_stream(&norm) {
        return Some(norm);
    }
    let needle = norm.to_ascii_lowercase();
    for entry in comp.walk() {
        if !entry.is_stream() {
            continue;
        }
        let Some(raw) = entry.path().to_str() else {
            continue;
        };
        let candidate = normalize_ole_path(raw);
        if candidate.to_ascii_lowercase() == needle {
            return Some(candidate);
        }
    }
    None
}

/// Reads a single OLE2 stream with an explicit byte cap and cooperative cancellation.
fn read_stream_capped_inner<R: Read + Seek>(
    comp: &mut cfb::CompoundFile<R>,
    canonical_path: &str,
    max_bytes: usize,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, OleError> {
    if cancelled.load(Ordering::Acquire) {
        return Err(OleError::Cancelled);
    }
    let mut stream = comp
        .open_stream(canonical_path)
        .map_err(|e| OleError::Corrupt(format!("corrupt OLE2 stream {canonical_path}: {e}")))?;

    let declared_len = stream.len();
    if declared_len > max_bytes as u64 {
        return Err(OleError::Corrupt(format!(
            "OLE2 stream {canonical_path} size ({declared_len} bytes) exceeds limit ({max_bytes} bytes)"
        )));
    }

    let mut out = Vec::with_capacity((declared_len as usize).min(64 * 1024));
    let mut chunk = [0u8; 64 * 1024];
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err(OleError::Cancelled);
        }
        let n = stream
            .read(&mut chunk)
            .map_err(|e| OleError::Corrupt(format!("corrupt OLE2 stream {canonical_path}: {e}")))?;
        if n == 0 {
            break;
        }
        let next_len = out
            .len()
            .checked_add(n)
            .ok_or_else(|| OleError::Corrupt("OLE2 stream length overflow".to_owned()))?;
        if next_len > max_bytes {
            return Err(OleError::Corrupt(format!(
                "OLE2 stream {canonical_path} exceeds limit ({max_bytes} bytes)"
            )));
        }
        out.extend_from_slice(&chunk[..n]);
    }
    Ok(out)
}

/// Decodes Windows-1252 single-byte text (used by compressed Word pieces and PPT TextBytesAtom).
pub fn decode_cp1252(bytes: &[u8]) -> String {
    let (decoded, _) = WINDOWS_1252.decode_without_bom_handling(bytes);
    decoded.into_owned()
}

/// Decodes UTF-16LE bytes (codepage 1200) into a Rust String.
pub fn decode_utf16le(bytes: &[u8]) -> String {
    let mut units = Vec::with_capacity(bytes.len() / 2);
    for pair in bytes.chunks_exact(2) {
        units.push(u16::from_le_bytes([pair[0], pair[1]]));
    }
    String::from_utf16_lossy(&units)
}
