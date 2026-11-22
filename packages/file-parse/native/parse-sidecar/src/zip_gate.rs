use std::collections::{HashMap, HashSet};
use std::io::{self, Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};

use flate2::read::DeflateDecoder;

use crate::protocol::RejectCode;

#[derive(Debug, Clone, Copy)]
pub struct ZipLimits {
    pub max_parts: usize,
    pub max_part_bytes: u64,
    pub max_total_bytes: u64,
}

pub const DEFAULT_ZIP_LIMITS: ZipLimits = ZipLimits {
    max_parts: 10_000,
    max_part_bytes: 512 * 1024 * 1024,
    max_total_bytes: 1_610_612_736, // 1.5 GiB
};

const EOCD_SIG: u32 = 0x0605_4b50;
const CENTRAL_SIG: u32 = 0x0201_4b50;
const LOCAL_SIG: u32 = 0x0403_4b50;
const ZIP64_LOCATOR_SIG: u32 = 0x0706_4b50;
const FLAG_ENCRYPTED: u16 = 0x0001;
const EOCD_MIN: u64 = 22;
const EOCD_SEARCH: u64 = EOCD_MIN + 0xffff;
const SCRATCH_BUF_LEN: usize = 16 * 1024;

#[derive(Debug)]
pub enum ZipGateError {
    Rejected(String),
    Corrupt(String),
    Io(io::Error),
    Cancelled,
}

impl ZipGateError {
    pub fn reject_code(&self) -> RejectCode {
        match self {
            ZipGateError::Rejected(_) => RejectCode::ZipRejected,
            ZipGateError::Corrupt(_) => RejectCode::Corrupt,
            ZipGateError::Io(_) => RejectCode::IoError,
            ZipGateError::Cancelled => RejectCode::IoError,
        }
    }

    pub fn message(&self) -> String {
        match self {
            ZipGateError::Rejected(m) | ZipGateError::Corrupt(m) => m.clone(),
            ZipGateError::Io(e) => e.to_string(),
            ZipGateError::Cancelled => "Request was cancelled by the client.".to_owned(),
        }
    }
}

impl From<io::Error> for ZipGateError {
    fn from(value: io::Error) -> Self {
        ZipGateError::Io(value)
    }
}

/// Returns true when a ZIP entry's extension indicates text or structured XML/JSON
/// rather than binary media (images, video, audio, fonts, embedded binaries).
/// Matches `packages/file-parse/src/zip-text-parts.ts`.
pub fn is_text_part(name: &str) -> bool {
    let last = match name.rfind('/') {
        Some(idx) => &name[idx + 1..],
        None => name,
    };
    let Some(dot) = last.rfind('.') else {
        return true;
    };
    if dot == 0 {
        return true;
    }
    matches!(
        last[dot + 1..].to_ascii_lowercase().as_str(),
        "xml" | "rels" | "json" | "txt" | "html" | "htm" | "xhtml" | "xht" | "opf" | "ncx" | "hpf"
    )
}

#[derive(Debug, Clone)]
pub struct ZipEntryInfo {
    pub name: String,
    pub name_valid_utf8: bool,
    pub is_dir: bool,
    pub method: u16,
    pub csize: u64,
    pub usize_declared: u64,
    pub local_offset: u64,
    pub data_start: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadCappedBytes {
    Missing,
    TooLarge,
    Bytes(Vec<u8>),
}

pub struct ZipArchive<R: Read + Seek> {
    reader: R,
    limits: ZipLimits,
    declared_entry_count: usize,
    entries: Vec<ZipEntryInfo>,
    by_name: HashMap<String, usize>,
    by_lower: HashMap<String, usize>,
}

fn read_u16_le(buf: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([buf[offset], buf[offset + 1]])
}

fn read_u32_le(buf: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        buf[offset],
        buf[offset + 1],
        buf[offset + 2],
        buf[offset + 3],
    ])
}

fn decode_latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| b as char).collect()
}

fn under_declared(name: &str, declared: u64) -> ZipGateError {
    ZipGateError::Rejected(format!(
        "zip rejected: part {name} declares {declared} uncompressed bytes but inflates past that"
    ))
}

impl<R: Read + Seek> ZipArchive<R> {
    /// Opens a ZIP archive directly from a seekable reader, parses its EOCD,
    /// central directory, and local headers, and performs stream-metered
    /// inflation verification against `limits`.
    ///
    /// Never loads the full archive into memory; non-text media parts are either
    /// length-checked (stored) or stream-inflated into a small scratch buffer
    /// that discards bytes while metering.
    pub fn open_and_verify(
        mut reader: R,
        limits: ZipLimits,
        cancelled: &AtomicBool,
    ) -> Result<Self, ZipGateError> {
        if cancelled.load(Ordering::Acquire) {
            return Err(ZipGateError::Cancelled);
        }

        let file_len = reader.seek(SeekFrom::End(0))?;
        if file_len < EOCD_MIN {
            return Err(ZipGateError::Corrupt(
                "zip: end of central directory not found".to_owned(),
            ));
        }

        let tail_len = file_len.min(EOCD_SEARCH) as usize;
        let tail_start = file_len - tail_len as u64;
        reader.seek(SeekFrom::Start(tail_start))?;
        let mut tail = vec![0u8; tail_len];
        reader.read_exact(&mut tail)?;

        let mut eocd_rel: Option<usize> = None;
        let mut i = tail_len - EOCD_MIN as usize;
        loop {
            if read_u32_le(&tail, i) == EOCD_SIG {
                eocd_rel = Some(i);
                break;
            }
            if i == 0 {
                break;
            }
            i -= 1;
        }
        let Some(eocd_rel) = eocd_rel else {
            return Err(ZipGateError::Corrupt(
                "zip: end of central directory not found".to_owned(),
            ));
        };

        let eocd_abs = tail_start + eocd_rel as u64;
        if eocd_abs >= 20 {
            let loc_sig = if eocd_rel >= 20 {
                read_u32_le(&tail, eocd_rel - 20)
            } else {
                let mut sig_buf = [0u8; 4];
                reader.seek(SeekFrom::Start(eocd_abs - 20))?;
                reader.read_exact(&mut sig_buf)?;
                u32::from_le_bytes(sig_buf)
            };
            if loc_sig == ZIP64_LOCATOR_SIG {
                return Err(ZipGateError::Rejected(
                    "zip rejected: zip64 archives are not supported".to_owned(),
                ));
            }
        }

        let count = read_u16_le(&tail, eocd_rel + 10);
        let cd_size = read_u32_le(&tail, eocd_rel + 12);
        let cd_offset = read_u32_le(&tail, eocd_rel + 16);
        if count == 0xffff || cd_size == 0xffff_ffff || cd_offset == 0xffff_ffff {
            return Err(ZipGateError::Rejected(
                "zip rejected: zip64 archives are not supported".to_owned(),
            ));
        }

        let cd_offset_u64 = cd_offset as u64;
        let cd_size_u64 = cd_size as u64;
        if cd_offset_u64 > file_len || cd_size_u64 > file_len - cd_offset_u64 {
            return Err(ZipGateError::Corrupt(
                "zip: corrupt central directory".to_owned(),
            ));
        }

        reader.seek(SeekFrom::Start(cd_offset_u64))?;
        let mut cd = vec![0u8; cd_size as usize];
        reader.read_exact(&mut cd)?;

        let mut entries = Vec::with_capacity(count as usize);
        let mut pos: usize = 0;
        let mut non_dir_count: usize = 0;

        for _ in 0..count {
            if cancelled.load(Ordering::Acquire) {
                return Err(ZipGateError::Cancelled);
            }
            if pos + 46 > cd.len() || read_u32_le(&cd, pos) != CENTRAL_SIG {
                return Err(ZipGateError::Corrupt(
                    "zip: corrupt central directory".to_owned(),
                ));
            }
            let flags = read_u16_le(&cd, pos + 8);
            if (flags & FLAG_ENCRYPTED) != 0 {
                return Err(ZipGateError::Rejected(
                    "zip rejected: encrypted entries are not supported".to_owned(),
                ));
            }
            let method = read_u16_le(&cd, pos + 10);
            let csize_u32 = read_u32_le(&cd, pos + 20);
            let usize_u32 = read_u32_le(&cd, pos + 24);
            let local_offset_u32 = read_u32_le(&cd, pos + 42);
            if csize_u32 == 0xffff_ffff
                || usize_u32 == 0xffff_ffff
                || local_offset_u32 == 0xffff_ffff
            {
                return Err(ZipGateError::Rejected(
                    "zip rejected: zip64 archives are not supported".to_owned(),
                ));
            }

            let name_len = read_u16_le(&cd, pos + 28) as usize;
            let extra_len = read_u16_le(&cd, pos + 30) as usize;
            let comment_len = read_u16_le(&cd, pos + 32) as usize;
            let name_start = pos + 46;
            if name_start + name_len > cd.len()
                || name_start + name_len + extra_len + comment_len > cd.len()
            {
                return Err(ZipGateError::Corrupt(
                    "zip: corrupt central directory".to_owned(),
                ));
            }

            let raw_name = &cd[name_start..name_start + name_len];
            let (name, name_valid_utf8) = match std::str::from_utf8(raw_name) {
                Ok(s) => (s.to_owned(), true),
                Err(_) => (decode_latin1(raw_name), false),
            };
            let is_dir = name.ends_with('/');
            if !is_dir {
                non_dir_count += 1;
                if non_dir_count > limits.max_parts {
                    return Err(ZipGateError::Rejected(format!(
                        "zip rejected: {non_dir_count} parts exceeds the {} limit",
                        limits.max_parts
                    )));
                }
            }

            entries.push(ZipEntryInfo {
                name,
                name_valid_utf8,
                is_dir,
                method,
                csize: csize_u32 as u64,
                usize_declared: usize_u32 as u64,
                local_offset: local_offset_u32 as u64,
                data_start: 0,
            });

            pos = name_start + name_len + extra_len + comment_len;
        }

        // Validate every local header and compute exact data_start offsets.
        let mut local_hdr = [0u8; 30];
        for entry in &mut entries {
            if cancelled.load(Ordering::Acquire) {
                return Err(ZipGateError::Cancelled);
            }
            if entry.local_offset + 30 > file_len {
                return Err(ZipGateError::Corrupt(format!(
                    "zip: corrupt local header for {}",
                    entry.name
                )));
            }
            reader.seek(SeekFrom::Start(entry.local_offset))?;
            reader.read_exact(&mut local_hdr)?;
            if read_u32_le(&local_hdr, 0) != LOCAL_SIG {
                return Err(ZipGateError::Corrupt(format!(
                    "zip: corrupt local header for {}",
                    entry.name
                )));
            }
            let local_name_len = read_u16_le(&local_hdr, 26) as u64;
            let local_extra_len = read_u16_le(&local_hdr, 28) as u64;
            let start = entry.local_offset + 30 + local_name_len + local_extra_len;
            if start > file_len || entry.csize > file_len - start {
                return Err(ZipGateError::Corrupt(format!(
                    "zip: entry {} declares {} bytes at {}, outside the {}-byte archive",
                    entry.name, entry.csize, start, file_len
                )));
            }
            entry.data_start = start;
        }

        // Advisory declared-size pass (rejects honest bombs in ~0 ms before inflating).
        let mut declared_total: u64 = 0;
        for entry in entries.iter().filter(|e| !e.is_dir) {
            if entry.usize_declared > limits.max_part_bytes {
                return Err(ZipGateError::Rejected(format!(
                    "zip rejected: part {} declares {} uncompressed bytes (limit {})",
                    entry.name, entry.usize_declared, limits.max_part_bytes
                )));
            }
            if entry.method != 0 && entry.method != 8 {
                return Err(ZipGateError::Rejected(format!(
                    "zip rejected: unsupported compression method {} for {}",
                    entry.method, entry.name
                )));
            }
            declared_total = declared_total.saturating_add(entry.usize_declared);
            if declared_total > limits.max_total_bytes {
                return Err(ZipGateError::Rejected(format!(
                    "zip rejected: total uncompressed size {declared_total} exceeds the {} limit",
                    limits.max_total_bytes
                )));
            }
        }

        // Metered verification pass: stored parts are checked by length without reading;
        // deflated parts are stream-inflated into a small scratch buffer that aborts
        // one byte past min(declared_usize, max_part_bytes).
        let mut verified_total: u64 = 0;
        let mut scratch = vec![0u8; SCRATCH_BUF_LEN];
        for entry in entries.iter().filter(|e| !e.is_dir) {
            if cancelled.load(Ordering::Acquire) {
                return Err(ZipGateError::Cancelled);
            }
            let verified = if entry.method == 0 {
                if entry.csize > entry.usize_declared {
                    return Err(under_declared(&entry.name, entry.usize_declared));
                }
                entry.csize
            } else {
                let cap = entry.usize_declared.min(limits.max_part_bytes);
                reader.seek(SeekFrom::Start(entry.data_start))?;
                let bounded = (&mut reader).take(entry.csize);
                let mut decoder = DeflateDecoder::new(bounded);
                let mut seen: u64 = 0;
                loop {
                    if cancelled.load(Ordering::Acquire) {
                        return Err(ZipGateError::Cancelled);
                    }
                    match decoder.read(&mut scratch) {
                        Ok(0) => break,
                        Ok(n) => {
                            seen = seen.saturating_add(n as u64);
                            if seen > cap {
                                return Err(under_declared(&entry.name, entry.usize_declared));
                            }
                        }
                        Err(e) => {
                            return Err(ZipGateError::Rejected(format!(
                                "zip rejected: part {} cannot be inflated: {e}",
                                entry.name
                            )));
                        }
                    }
                }
                seen
            };

            verified_total = verified_total.saturating_add(verified);
            if verified_total > limits.max_total_bytes {
                return Err(ZipGateError::Rejected(format!(
                    "zip rejected: total uncompressed size {verified_total} exceeds the {} limit",
                    limits.max_total_bytes
                )));
            }
        }

        let mut by_name = HashMap::with_capacity(entries.len());
        let mut by_lower = HashMap::with_capacity(entries.len());
        for (idx, entry) in entries.iter().enumerate() {
            if !entry.is_dir {
                by_name.entry(entry.name.clone()).or_insert(idx);
                by_lower
                    .entry(entry.name.to_lowercase())
                    .or_insert(idx);
            }
        }

        Ok(Self {
            reader,
            limits,
            declared_entry_count: count as usize,
            entries,
            by_name,
            by_lower,
        })
    }

    pub fn entry_names(&self) -> Vec<&str> {
        self.entries
            .iter()
            .filter(|e| !e.is_dir)
            .map(|e| e.name.as_str())
            .collect()
    }

    pub fn has_file(&self, name: &str) -> bool {
        self.by_name.contains_key(name)
    }

    pub fn find_case_insensitive(&self, normalized_name: &str) -> Option<&str> {
        if let Some(&idx) = self.by_name.get(normalized_name) {
            return Some(&self.entries[idx].name);
        }
        self.by_lower
            .get(&normalized_name.to_lowercase())
            .map(|&idx| self.entries[idx].name.as_str())
    }

    /// Mirrors `packages/xmind-engine/src/archive.ts` `carriesEveryEntry`:
    /// rejects duplicate entry names, path-climbing / normalized names (`../`,
    /// leading `/`, backslashes), or non-UTF-8 entry names.
    pub fn carries_every_entry(&self) -> bool {
        if self.entries.len() != self.declared_entry_count {
            return false;
        }
        let mut seen = HashSet::with_capacity(self.entries.len());
        for entry in &self.entries {
            if !entry.name_valid_utf8 {
                return false;
            }
            if entry.name.starts_with('/')
                || entry.name.contains('\\')
                || entry.name.split('/').any(|seg| seg == "..")
            {
                return false;
            }
            if !seen.insert(entry.name.as_str()) {
                return false;
            }
        }
        true
    }

    /// Returns true if any entry path attempts traversal (`..`), starts with
    /// `/`, or contains a Windows backslash separator.
    pub fn has_unsafe_entry_paths(&self) -> bool {
        self.entries.iter().any(|entry| {
            entry.name.starts_with('/')
                || entry.name.contains('\\')
                || entry.name.split('/').any(|seg| seg == "..")
        })
    }

    /// Reads an entry only if its uncompressed size does not exceed `max_bytes`.
    /// Checks `cancelled` periodically during reading/inflation.
    pub fn read_entry_bytes_capped(
        &mut self,
        name: &str,
        max_bytes: usize,
        cancelled: &AtomicBool,
    ) -> Result<ReadCappedBytes, ZipGateError> {
        if cancelled.load(Ordering::Acquire) {
            return Err(ZipGateError::Cancelled);
        }
        let Some(&idx) = self.by_name.get(name) else {
            return Ok(ReadCappedBytes::Missing);
        };
        let entry = self.entries[idx].clone();
        let cap = entry.usize_declared.min(self.limits.max_part_bytes);
        let max_u64 = max_bytes as u64;
        if entry.usize_declared > max_u64 {
            return Ok(ReadCappedBytes::TooLarge);
        }
        self.reader.seek(SeekFrom::Start(entry.data_start))?;

        if entry.method == 0 {
            if entry.csize > cap {
                return Err(under_declared(&entry.name, entry.usize_declared));
            }
            if entry.csize > max_u64 {
                return Ok(ReadCappedBytes::TooLarge);
            }
            let total = entry.csize as usize;
            let mut out = Vec::with_capacity(total.min(64 * 1024));
            let mut remaining = total;
            let mut buf = [0u8; SCRATCH_BUF_LEN];
            while remaining > 0 {
                if cancelled.load(Ordering::Acquire) {
                    return Err(ZipGateError::Cancelled);
                }
                let want = remaining.min(buf.len());
                self.reader.read_exact(&mut buf[..want])?;
                out.extend_from_slice(&buf[..want]);
                remaining -= want;
            }
            return Ok(ReadCappedBytes::Bytes(out));
        }

        let bounded = (&mut self.reader).take(entry.csize);
        let mut decoder = DeflateDecoder::new(bounded);
        let mut out = Vec::with_capacity((entry.usize_declared as usize).min(64 * 1024));
        let mut buf = [0u8; SCRATCH_BUF_LEN];
        loop {
            if cancelled.load(Ordering::Acquire) {
                return Err(ZipGateError::Cancelled);
            }
            match decoder.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let next_len = (out.len() as u64).saturating_add(n as u64);
                    if next_len > cap {
                        return Err(under_declared(&entry.name, entry.usize_declared));
                    }
                    if next_len > max_u64 {
                        return Ok(ReadCappedBytes::TooLarge);
                    }
                    out.extend_from_slice(&buf[..n]);
                }
                Err(e) => {
                    return Err(ZipGateError::Rejected(format!(
                        "zip rejected: part {} cannot be inflated: {e}",
                        entry.name
                    )));
                }
            }
        }
        Ok(ReadCappedBytes::Bytes(out))
    }

    pub fn read_entry_bytes(&mut self, name: &str) -> Result<Option<Vec<u8>>, ZipGateError> {
        let Some(&idx) = self.by_name.get(name) else {
            return Ok(None);
        };
        let entry = self.entries[idx].clone();
        let cap = entry.usize_declared.min(self.limits.max_part_bytes);
        self.reader.seek(SeekFrom::Start(entry.data_start))?;

        if entry.method == 0 {
            if entry.csize > cap {
                return Err(under_declared(&entry.name, entry.usize_declared));
            }
            let mut out = vec![0u8; entry.csize as usize];
            self.reader.read_exact(&mut out)?;
            return Ok(Some(out));
        }

        let bounded = (&mut self.reader).take(entry.csize);
        let mut decoder = DeflateDecoder::new(bounded);
        let mut out = Vec::with_capacity(cap.min(64 * 1024) as usize);
        let mut buf = [0u8; SCRATCH_BUF_LEN];
        loop {
            match decoder.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if (out.len() as u64).saturating_add(n as u64) > cap {
                        return Err(under_declared(&entry.name, entry.usize_declared));
                    }
                    out.extend_from_slice(&buf[..n]);
                }
                Err(e) => {
                    return Err(ZipGateError::Rejected(format!(
                        "zip rejected: part {} cannot be inflated: {e}",
                        entry.name
                    )));
                }
            }
        }
        Ok(Some(out))
    }

    pub fn read_entry_string(&mut self, name: &str) -> Result<Option<String>, ZipGateError> {
        let Some(bytes) = self.read_entry_bytes(name)? else {
            return Ok(None);
        };
        Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
    }

    /// Inflates at most `max_bytes` bytes of an entry. Returns `(text, truncated)`.
    pub fn read_entry_prefix(
        &mut self,
        name: &str,
        max_bytes: usize,
    ) -> Result<Option<(String, bool)>, ZipGateError> {
        let Some(&idx) = self.by_name.get(name) else {
            return Ok(None);
        };
        let entry = self.entries[idx].clone();
        let cap = entry.usize_declared.min(self.limits.max_part_bytes);
        self.reader.seek(SeekFrom::Start(entry.data_start))?;

        if entry.method == 0 {
            let total = entry.csize as usize;
            let to_read = total.min(max_bytes);
            let mut out = vec![0u8; to_read];
            self.reader.read_exact(&mut out)?;
            let truncated = total > max_bytes;
            return Ok(Some((
                String::from_utf8_lossy(&out).into_owned(),
                truncated,
            )));
        }

        let bounded = (&mut self.reader).take(entry.csize);
        let mut decoder = DeflateDecoder::new(bounded);
        let mut out = Vec::with_capacity(max_bytes.min(64 * 1024));
        let mut buf = [0u8; SCRATCH_BUF_LEN];
        let mut truncated = false;
        loop {
            match decoder.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if (out.len() as u64).saturating_add(n as u64) > cap {
                        return Err(under_declared(&entry.name, entry.usize_declared));
                    }
                    if out.len() + n >= max_bytes {
                        let remaining = max_bytes.saturating_sub(out.len());
                        out.extend_from_slice(&buf[..remaining]);
                        truncated = true;
                        break;
                    }
                    out.extend_from_slice(&buf[..n]);
                }
                Err(e) => {
                    return Err(ZipGateError::Rejected(format!(
                        "zip rejected: part {} cannot be inflated: {e}",
                        entry.name
                    )));
                }
            }
        }
        Ok(Some((
            String::from_utf8_lossy(&out).into_owned(),
            truncated,
        )))
    }
}
