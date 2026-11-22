//! Safe ZIP archive reader/writer for `.whiteboard` files.
//! Enforces bounded inflation & path-traversal checks, preserves unknown entries,
//! and returns byte-identical original archives on unchanged saves.

use crate::error::{OpenError, OpenErrorCode};
use crate::image_format::{ImageMime, read_image_header};
use crate::model::{BoardDocument, ResourceMeta, validate_board};
use std::collections::{BTreeMap, HashSet};
use std::io::{Cursor, Read, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub const BOARD_JSON_ENTRY: &str = "board.json";
pub const THUMBNAIL_ENTRY: &str = "thumbnail.png";
pub const MAX_ENTRY_COUNT: usize = 10_000;
pub const MAX_ENTRY_BYTES: u64 = 25 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct WhiteboardArchive {
    pub doc: BoardDocument,
    pub resources: BTreeMap<String, Vec<u8>>,
    pub thumbnail: Option<Vec<u8>>,
    /// Unknown entries preserved verbatim across saves (entry name -> raw bytes).
    pub preserved_entries: BTreeMap<String, Vec<u8>>,
    original_bytes: Option<Vec<u8>>,
    initial_canonical_json: String,
    resources_dirty: bool,
    thumbnail_dirty: bool,
}

fn validate_entry_path(name: &str) -> Result<(), OpenError> {
    if name.is_empty()
        || name.contains('\0')
        || name.starts_with('/')
        || name.starts_with('\\')
        || name.contains('\\')
    {
        return Err(OpenError::new(
            OpenErrorCode::ZipRejected,
            format!("unsafe zip entry path: '{name}'"),
        ));
    }
    for segment in name.split('/') {
        if segment == ".." {
            return Err(OpenError::new(
                OpenErrorCode::ZipRejected,
                format!("zip path traversal rejected: '{name}'"),
            ));
        }
    }
    Ok(())
}

fn read_bounded(reader: &mut impl Read, limit: u64, declared: u64) -> Result<Vec<u8>, OpenError> {
    let cap = limit.min(declared);
    let mut limited = reader.take(cap.saturating_add(1));
    let mut buf = Vec::new();
    limited
        .read_to_end(&mut buf)
        .map_err(|e| OpenError::new(OpenErrorCode::ZipRejected, format!("zip read failed: {e}")))?;
    if (buf.len() as u64) > limit {
        return Err(OpenError::new(
            OpenErrorCode::ZipRejected,
            "zip entry exceeds maximum allowed uncompressed size",
        ));
    }
    if (buf.len() as u64) > declared {
        return Err(OpenError::new(
            OpenErrorCode::ZipRejected,
            "zip entry inflated past its declared uncompressed size",
        ));
    }
    Ok(buf)
}

fn canonical_json(doc: &BoardDocument) -> String {
    serde_json::to_string(doc).unwrap_or_default()
}

impl WhiteboardArchive {
    pub fn from_new(doc: BoardDocument) -> Result<Self, OpenError> {
        validate_board(&doc)?;
        let initial_canonical_json = canonical_json(&doc);
        Ok(Self {
            doc,
            resources: BTreeMap::new(),
            thumbnail: None,
            preserved_entries: BTreeMap::new(),
            original_bytes: None,
            initial_canonical_json,
            resources_dirty: false,
            thumbnail_dirty: false,
        })
    }

    /// Opens and validates a `.whiteboard` ZIP container from raw bytes.
    pub fn open(bytes: &[u8]) -> Result<Self, OpenError> {
        if bytes.len() < 4 || &bytes[0..2] != b"PK" {
            return Err(OpenError::new(
                OpenErrorCode::NotZip,
                "file does not start with a ZIP signature",
            ));
        }

        let mut archive = ZipArchive::new(Cursor::new(bytes))
            .map_err(|e| OpenError::new(OpenErrorCode::NotZip, format!("invalid zip archive: {e}")))?;

        if archive.len() > MAX_ENTRY_COUNT {
            return Err(OpenError::new(
                OpenErrorCode::ZipRejected,
                format!("zip entry count {} exceeds limit {MAX_ENTRY_COUNT}", archive.len()),
            ));
        }

        let mut total_bytes: u64 = 0;
        let mut seen = HashSet::new();
        let mut raw_entries: BTreeMap<String, Vec<u8>> = BTreeMap::new();

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| {
                let msg = e.to_string();
                if msg.to_lowercase().contains("password") || msg.to_lowercase().contains("encrypt") {
                    OpenError::new(OpenErrorCode::ZipRejected, "encrypted zip entries are not allowed")
                } else {
                    OpenError::new(OpenErrorCode::ZipRejected, format!("cannot read zip entry {i}: {msg}"))
                }
            })?;

            if file.encrypted() {
                return Err(OpenError::new(
                    OpenErrorCode::ZipRejected,
                    "encrypted zip entries are not allowed",
                ));
            }
            if file.is_dir() {
                continue;
            }

            let name = file
                .name()
                .map_err(|e| OpenError::new(OpenErrorCode::ZipRejected, format!("invalid zip entry name: {e}")))?
                .into_owned();
            validate_entry_path(&name)?;
            if !seen.insert(name.clone()) {
                return Err(OpenError::new(
                    OpenErrorCode::ZipRejected,
                    format!("duplicate zip entry '{name}'"),
                ));
            }

            let declared = file.size();
            let remaining = MAX_TOTAL_BYTES.saturating_sub(total_bytes);
            let entry_limit = MAX_ENTRY_BYTES.min(remaining);
            let data = read_bounded(&mut file, entry_limit, declared)?;
            total_bytes = total_bytes.saturating_add(data.len() as u64);
            if total_bytes > MAX_TOTAL_BYTES {
                return Err(OpenError::new(
                    OpenErrorCode::ZipRejected,
                    "zip archive total uncompressed size exceeds limit",
                ));
            }
            raw_entries.insert(name, data);
        }

        let board_raw = raw_entries.remove(BOARD_JSON_ENTRY).ok_or_else(|| {
            OpenError::new(
                OpenErrorCode::MissingBoardJson,
                "archive is missing board.json",
            )
        })?;

        let board_str = std::str::from_utf8(&board_raw).map_err(|_| {
            OpenError::new(
                OpenErrorCode::InvalidUtf8,
                "board.json is not valid UTF-8",
            )
        })?;

        let doc: BoardDocument = serde_json::from_str(board_str).map_err(|e| {
            OpenError::new(
                OpenErrorCode::InvalidJson,
                format!("board.json parse error: {e}"),
            )
        })?;

        validate_board(&doc)?;

        let mut resources = BTreeMap::new();
        for (res_id, meta) in &doc.resources {
            validate_entry_path(&meta.path)?;
            let data = raw_entries.remove(&meta.path).ok_or_else(|| {
                OpenError::new(
                    OpenErrorCode::InvalidSchema,
                    format!("resource '{res_id}' file '{}' missing from archive", meta.path),
                )
            })?;
            let header = read_image_header(&data).ok_or_else(|| {
                OpenError::new(
                    OpenErrorCode::InvalidSchema,
                    format!(
                        "resource '{res_id}' file '{}' is not a valid PNG, JPEG, GIF, or WebP raster image",
                        meta.path
                    ),
                )
            })?;
            if header.mime != meta.mime {
                return Err(OpenError::new(
                    OpenErrorCode::InvalidSchema,
                    format!(
                        "resource '{res_id}' MIME mismatch: declared {:?}, actual {:?}",
                        meta.mime, header.mime
                    ),
                ));
            }
            resources.insert(res_id.clone(), data);
        }

        let thumbnail = raw_entries.remove(THUMBNAIL_ENTRY);
        if let Some(ref thumb_bytes) = thumbnail {
            let header = read_image_header(thumb_bytes).ok_or_else(|| {
                OpenError::new(
                    OpenErrorCode::InvalidSchema,
                    "thumbnail.png is not a valid raster image",
                )
            })?;
            if header.mime != ImageMime::Png {
                return Err(OpenError::new(
                    OpenErrorCode::InvalidSchema,
                    "thumbnail.png must be a PNG image",
                ));
            }
        }
        let initial_canonical_json = canonical_json(&doc);

        Ok(Self {
            doc,
            resources,
            thumbnail,
            preserved_entries: raw_entries,
            original_bytes: Some(bytes.to_vec()),
            initial_canonical_json,
            resources_dirty: false,
            thumbnail_dirty: false,
        })
    }

    /// Registers a validated raster image resource (PNG/JPEG/GIF/WebP) into the archive.
    pub fn add_image_resource(
        &mut self,
        resource_id: String,
        bytes: Vec<u8>,
    ) -> Result<ResourceMeta, OpenError> {
        let header = read_image_header(&bytes).ok_or_else(|| {
            OpenError::new(
                OpenErrorCode::InvalidSchema,
                "image bytes are not a valid PNG, JPEG, GIF, or WebP raster image",
            )
        })?;
        let path = format!("resources/{resource_id}.{}", header.mime.extension());
        validate_entry_path(&path)?;
        let meta = ResourceMeta {
            path,
            mime: header.mime,
            width: header.width,
            height: header.height,
            byte_length: bytes.len() as u64,
        };
        self.doc.resources.insert(resource_id.clone(), meta.clone());
        self.resources.insert(resource_id, bytes);
        self.resources_dirty = true;
        Ok(meta)
    }

    pub fn set_thumbnail(&mut self, png_bytes: Option<Vec<u8>>) -> Result<(), OpenError> {
        if let Some(ref bytes) = png_bytes {
            let header = read_image_header(bytes).ok_or_else(|| {
                OpenError::new(OpenErrorCode::InvalidSchema, "thumbnail is not a valid image")
            })?;
            if header.mime != ImageMime::Png {
                return Err(OpenError::new(
                    OpenErrorCode::InvalidSchema,
                    "thumbnail must be PNG",
                ));
            }
        }
        if self.thumbnail != png_bytes {
            self.thumbnail = png_bytes;
            self.thumbnail_dirty = true;
        }
        Ok(())
    }

    pub fn is_changed(&self) -> bool {
        self.original_bytes.is_none()
            || self.resources_dirty
            || self.thumbnail_dirty
            || canonical_json(&self.doc) != self.initial_canonical_json
    }

    /// Serializes the archive to ZIP bytes.
    /// If unchanged since open, returns the exact original ZIP bytes verbatim.
    pub fn save(&self) -> Result<Vec<u8>, OpenError> {
        validate_board(&self.doc)?;
        if !self.is_changed() {
            if let Some(orig) = &self.original_bytes {
                return Ok(orig.clone());
            }
        }

        let mut cursor = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut cursor);
            let deflate = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
            let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);

            let board_bytes = serde_json::to_vec_pretty(&self.doc).map_err(|e| {
                OpenError::new(OpenErrorCode::InvalidJson, format!("serialize board.json: {e}"))
            })?;
            zip.start_file(BOARD_JSON_ENTRY, deflate)
                .map_err(|e| OpenError::new(OpenErrorCode::ZipRejected, e.to_string()))?;
            zip.write_all(&board_bytes)
                .map_err(|e| OpenError::new(OpenErrorCode::ZipRejected, e.to_string()))?;

            for (res_id, meta) in &self.doc.resources {
                let data = self.resources.get(res_id).ok_or_else(|| {
                    OpenError::new(
                        OpenErrorCode::InvalidSchema,
                        format!("resource '{res_id}' bytes missing on save"),
                    )
                })?;
                zip.start_file(&meta.path, stored)
                    .map_err(|e| OpenError::new(OpenErrorCode::ZipRejected, e.to_string()))?;
                zip.write_all(data)
                    .map_err(|e| OpenError::new(OpenErrorCode::ZipRejected, e.to_string()))?;
            }

            if let Some(thumb) = &self.thumbnail {
                zip.start_file(THUMBNAIL_ENTRY, stored)
                    .map_err(|e| OpenError::new(OpenErrorCode::ZipRejected, e.to_string()))?;
                zip.write_all(thumb)
                    .map_err(|e| OpenError::new(OpenErrorCode::ZipRejected, e.to_string()))?;
            }

            for (name, data) in &self.preserved_entries {
                zip.start_file(name, deflate)
                    .map_err(|e| OpenError::new(OpenErrorCode::ZipRejected, e.to_string()))?;
                zip.write_all(data)
                    .map_err(|e| OpenError::new(OpenErrorCode::ZipRejected, e.to_string()))?;
            }

            zip.finish()
                .map_err(|e| OpenError::new(OpenErrorCode::ZipRejected, e.to_string()))?;
        }
        Ok(cursor.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::create_new_board;
    use serde_json::json;

    fn sample_png() -> Vec<u8> {
        let mut png = Vec::new();
        png.extend_from_slice(b"\x89PNG\r\n\x1a\n");
        png.extend_from_slice(&13u32.to_be_bytes());
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&16u32.to_be_bytes());
        png.extend_from_slice(&16u32.to_be_bytes());
        png.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
        png
    }

    fn make_raw_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut cursor);
            let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
            for (name, data) in entries {
                zip.start_file(*name, opts).unwrap();
                zip.write_all(data).unwrap();
            }
            zip.finish().unwrap();
        }
        cursor.into_inner()
    }

    #[test]
    fn unchanged_save_returns_exact_original_bytes() {
        let board = create_new_board("b1".into(), "p1".into(), "Origin".into());
        let extra_payload = b"keep-me-verbatim";
        let raw = make_raw_zip(&[
            (BOARD_JSON_ENTRY, serde_json::to_string(&board).unwrap().as_bytes()),
            ("custom/extra.txt", extra_payload),
        ]);
        let mut opened = WhiteboardArchive::open(&raw).unwrap();
        assert!(!opened.is_changed());
        assert_eq!(opened.save().unwrap(), raw);

        // Edit and revert back -> still returns exact original bytes!
        opened.doc.title = "Temp".into();
        assert!(opened.is_changed());
        opened.doc.title = "Origin".into();
        assert!(!opened.is_changed());
        assert_eq!(opened.save().unwrap(), raw);
    }

    #[test]
    fn preserves_unknown_json_fields_and_unknown_zip_entries_on_save() {
        let mut board = create_new_board("b1".into(), "p1".into(), "One".into());
        board.extra.insert("futureFlag".into(), json!(true));
        board.pages[0].extra.insert("customTag".into(), json!("abc"));
        let raw = make_raw_zip(&[
            (BOARD_JSON_ENTRY, serde_json::to_string(&board).unwrap().as_bytes()),
            ("meta/vendor.bin", b"\x01\x02\x03"),
        ]);
        let mut opened = WhiteboardArchive::open(&raw).unwrap();
        opened.doc.title = "Two".into();
        let saved = opened.save().unwrap();
        let reopened = WhiteboardArchive::open(&saved).unwrap();
        assert_eq!(reopened.doc.title, "Two");
        assert_eq!(reopened.doc.extra.get("futureFlag"), Some(&json!(true)));
        assert_eq!(reopened.doc.pages[0].extra.get("customTag"), Some(&json!("abc")));
        assert_eq!(
            reopened.preserved_entries.get("meta/vendor.bin").map(Vec::as_slice),
            Some(&b"\x01\x02\x03"[..])
        );
    }

    #[test]
    fn rejects_invalid_zip_missing_board_bad_utf8_and_traversal() {
        assert_eq!(
            WhiteboardArchive::open(b"not a zip").unwrap_err().code,
            OpenErrorCode::NotZip
        );
        let empty = make_raw_zip(&[("other.txt", b"hi")]);
        assert_eq!(
            WhiteboardArchive::open(&empty).unwrap_err().code,
            OpenErrorCode::MissingBoardJson
        );
        let bad_utf8 = make_raw_zip(&[(BOARD_JSON_ENTRY, &[0xFF, 0xFE, 0xFD])]);
        assert_eq!(
            WhiteboardArchive::open(&bad_utf8).unwrap_err().code,
            OpenErrorCode::InvalidUtf8
        );
        let bad_json = make_raw_zip(&[(BOARD_JSON_ENTRY, b"{not json")]);
        assert_eq!(
            WhiteboardArchive::open(&bad_json).unwrap_err().code,
            OpenErrorCode::InvalidJson
        );
        let traversal = make_raw_zip(&[("../evil.txt", b"x")]);
        assert_eq!(
            WhiteboardArchive::open(&traversal).unwrap_err().code,
            OpenErrorCode::ZipRejected
        );
    }

    #[test]
    fn adds_valid_image_resource_and_roundtrips() {
        let board = create_new_board("b1".into(), "p1".into(), "Img".into());
        let mut arch = WhiteboardArchive::from_new(board).unwrap();
        let meta = arch.add_image_resource("img1".into(), sample_png()).unwrap();
        assert_eq!(meta.path, "resources/img1.png");
        assert_eq!((meta.width, meta.height), (16, 16));
        arch.set_thumbnail(Some(sample_png())).unwrap();
        let saved = arch.save().unwrap();
        let reopened = WhiteboardArchive::open(&saved).unwrap();
        assert_eq!(reopened.resources.get("img1").unwrap(), &sample_png());
        assert_eq!(reopened.thumbnail.as_ref().unwrap(), &sample_png());
    }

    #[test]
    fn rejects_non_image_or_mismatched_resource_and_thumbnail_bytes_on_open() {
        let mut board = create_new_board("b1".into(), "p1".into(), "BadImg".into());
        board.resources.insert(
            "r1".into(),
            ResourceMeta {
                path: "resources/r1.png".into(),
                mime: ImageMime::Png,
                width: 10,
                height: 10,
                byte_length: 19,
            },
        );
        let forged = make_raw_zip(&[
            (BOARD_JSON_ENTRY, serde_json::to_string(&board).unwrap().as_bytes()),
            ("resources/r1.png", b"<svg>not a png</svg>"),
        ]);
        assert_eq!(
            WhiteboardArchive::open(&forged).unwrap_err().code,
            OpenErrorCode::InvalidSchema
        );

        let clean_board = create_new_board("b1".into(), "p1".into(), "BadThumb".into());
        let bad_thumb = make_raw_zip(&[
            (BOARD_JSON_ENTRY, serde_json::to_string(&clean_board).unwrap().as_bytes()),
            (THUMBNAIL_ENTRY, b"not-a-png-at-all"),
        ]);
        assert_eq!(
            WhiteboardArchive::open(&bad_thumb).unwrap_err().code,
            OpenErrorCode::InvalidSchema
        );
    }
}
