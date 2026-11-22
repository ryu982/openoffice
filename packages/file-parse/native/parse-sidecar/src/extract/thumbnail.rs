use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::extract::{
    BinaryKind, ENCRYPTED_PACKAGE_UTF16LE, PDF_HEADER_WINDOW, file_contains_needle, normalize_ext,
    odt, sniff_binary,
};
use crate::protocol::{
    DEFAULT_MAX_THUMBNAIL_BYTES, FallbackReason, RejectCode, ThumbnailResult,
};
use crate::zip_gate::{DEFAULT_ZIP_LIMITS, ReadCappedBytes, ZipArchive, ZipGateError};

/// Embedded thumbnail entry paths checked in priority order (case-insensitive),
/// matching `ZIP_THUMBNAIL_CANDIDATES` in `apps/shell/src/main/quick-look/extract.ts`.
pub const ZIP_THUMBNAIL_CANDIDATES: &[&str] = &[
    "Preview/PrvImage.png",
    "Preview/PrvImage.bmp",
    "Preview/PrvImage.gif",
    "Preview/PrvImage.jpg",
    "Preview/PrvImage.jpeg",
    "Thumbnails/thumbnail.png",
    "Thumbnails/thumbnail.jpg",
    "Thumbnails/thumbnail.jpeg",
    "docProps/thumbnail.png",
    "docProps/thumbnail.jpeg",
    "docProps/thumbnail.jpg",
    "docProps/thumbnail.gif",
];

const BASE64_TABLE: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard RFC 4648 base64 encoder with `=` padding (zero external crate deps).
pub fn encode_base64(input: &[u8]) -> String {
    if input.is_empty() {
        return String::new();
    }
    let out_len = input.len().div_ceil(3) * 4;
    let mut out = Vec::with_capacity(out_len);
    let mut chunks = input.chunks_exact(3);
    for chunk in &mut chunks {
        let n = ((chunk[0] as u32) << 16) | ((chunk[1] as u32) << 8) | (chunk[2] as u32);
        out.push(BASE64_TABLE[((n >> 18) & 0x3f) as usize]);
        out.push(BASE64_TABLE[((n >> 12) & 0x3f) as usize]);
        out.push(BASE64_TABLE[((n >> 6) & 0x3f) as usize]);
        out.push(BASE64_TABLE[(n & 0x3f) as usize]);
    }
    let rem = chunks.remainder();
    match rem.len() {
        1 => {
            let n = (rem[0] as u32) << 16;
            out.push(BASE64_TABLE[((n >> 18) & 0x3f) as usize]);
            out.push(BASE64_TABLE[((n >> 12) & 0x3f) as usize]);
            out.push(b'=');
            out.push(b'=');
        }
        2 => {
            let n = ((rem[0] as u32) << 16) | ((rem[1] as u32) << 8);
            out.push(BASE64_TABLE[((n >> 18) & 0x3f) as usize]);
            out.push(BASE64_TABLE[((n >> 12) & 0x3f) as usize]);
            out.push(BASE64_TABLE[((n >> 6) & 0x3f) as usize]);
            out.push(b'=');
        }
        _ => {}
    }
    // Safety: every pushed byte is ASCII from BASE64_TABLE or b'='.
    unsafe { String::from_utf8_unchecked(out) }
}

/// Sniffs image MIME type from magic bytes. Mirrors `sniffImageMime` in Quick Look.
pub fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() < 4 {
        return None;
    }
    if bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47 {
        return Some("image/png");
    }
    if bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return Some("image/jpeg");
    }
    if bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x38 {
        return Some("image/gif");
    }
    if bytes[0] == 0x42 && bytes[1] == 0x4D {
        return Some("image/bmp");
    }
    if bytes.len() >= 12
        && &bytes[0..4] == b"RIFF"
        && &bytes[8..12] == b"WEBP"
    {
        return Some("image/webp");
    }
    None
}

/// Streams a ZIP-based document directly from disk, enforces `DEFAULT_ZIP_LIMITS`
/// and path-traversal / encryption gates, and extracts the first valid embedded
/// thumbnail image without loading the full archive into memory.
///
/// Returns `Err(())` when cancelled via `cancelled`.
pub fn extract_thumbnail(
    path: &Path,
    ext: &str,
    max_bytes: Option<usize>,
    cancelled: &AtomicBool,
) -> Result<ThumbnailResult, ()> {
    if cancelled.load(Ordering::Acquire) {
        return Err(());
    }
    let ext = normalize_ext(ext);
    if !matches!(
        ext.as_str(),
        "hwpx" | "hwp" | "docx" | "doc" | "pptx" | "xlsx" | "xlsm" | "odt" | "xmind"
    ) {
        return Ok(ThumbnailResult::Fallback {
            fallback_reason: FallbackReason::UnsupportedFormat,
        });
    }

    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            return Ok(ThumbnailResult::Rejected {
                reject_code: RejectCode::IoError,
                message: e.to_string(),
            });
        }
    };

    let mut header = [0u8; PDF_HEADER_WINDOW];
    let head_len = match file.read(&mut header) {
        Ok(n) => n,
        Err(e) => {
            return Ok(ThumbnailResult::Rejected {
                reject_code: RejectCode::IoError,
                message: e.to_string(),
            });
        }
    };
    let sniffed = sniff_binary(&header[..head_len]);

    match ext.as_str() {
        "docx" | "odt" | "pptx" | "xlsx" | "xlsm" if sniffed != BinaryKind::Zip => {
            if sniffed == BinaryKind::Ole2
                && file_contains_needle(&mut file, ENCRYPTED_PACKAGE_UTF16LE, cancelled)?
            {
                return Ok(ThumbnailResult::Rejected {
                    reject_code: RejectCode::PasswordProtected,
                    message: format!(
                        "Password-protected .{ext}: open it in its editor with the password, or remove the password and attach it again"
                    ),
                });
            }
            return Ok(ThumbnailResult::Rejected {
                reject_code: RejectCode::ContentMismatch,
                message: format!(
                    "Content mismatch: .{ext} file has {} magic bytes",
                    sniffed.as_str()
                ),
            });
        }
        "hwpx" | "xmind" if sniffed != BinaryKind::Zip => {
            return Ok(ThumbnailResult::Rejected {
                reject_code: RejectCode::ContentMismatch,
                message: format!(
                    "Content mismatch: .{ext} file has {} magic bytes",
                    sniffed.as_str()
                ),
            });
        }
        "doc" | "hwp" => {
            if sniffed == BinaryKind::Ole2 || (ext == "hwp" && sniffed == BinaryKind::Hwp3) {
                return Ok(ThumbnailResult::Fallback {
                    fallback_reason: FallbackReason::UnsupportedFormat,
                });
            }
            if sniffed != BinaryKind::Zip {
                return Ok(ThumbnailResult::Rejected {
                    reject_code: RejectCode::ContentMismatch,
                    message: format!(
                        "Content mismatch: .{ext} file has {} magic bytes",
                        sniffed.as_str()
                    ),
                });
            }
        }
        _ => {}
    }

    let mut zip = match ZipArchive::open_and_verify(file, DEFAULT_ZIP_LIMITS, cancelled) {
        Ok(z) => z,
        Err(ZipGateError::Cancelled) => return Err(()),
        Err(err) => {
            return Ok(ThumbnailResult::Rejected {
                reject_code: err.reject_code(),
                message: err.message(),
            });
        }
    };

    if zip.has_unsafe_entry_paths() {
        return Ok(ThumbnailResult::Rejected {
            reject_code: RejectCode::ZipRejected,
            message: "zip rejected: unsafe entry path".to_owned(),
        });
    }

    if ext == "odt" {
        if let Some(manifest_name) = zip
            .find_case_insensitive("META-INF/manifest.xml")
            .map(str::to_owned)
        {
            match zip.read_entry_string(&manifest_name) {
                Ok(manifest) if odt::manifest_is_encrypted(manifest.as_deref()) => {
                    return Ok(ThumbnailResult::Rejected {
                        reject_code: RejectCode::PasswordProtected,
                        message: "Password-protected ODT: remove the password and attach it again"
                            .to_owned(),
                    });
                }
                Ok(_) => {}
                Err(ZipGateError::Cancelled) => return Err(()),
                Err(err) => {
                    return Ok(ThumbnailResult::Rejected {
                        reject_code: err.reject_code(),
                        message: err.message(),
                    });
                }
            }
        }
    }

    let cap = max_bytes
        .unwrap_or(DEFAULT_MAX_THUMBNAIL_BYTES)
        .min(DEFAULT_MAX_THUMBNAIL_BYTES);
    if cap == 0 {
        return Ok(ThumbnailResult::NotFound {});
    }

    for candidate in ZIP_THUMBNAIL_CANDIDATES {
        if cancelled.load(Ordering::Acquire) {
            return Err(());
        }
        let Some(actual_name) = zip.find_case_insensitive(candidate).map(str::to_owned) else {
            continue;
        };
        match zip.read_entry_bytes_capped(&actual_name, cap, cancelled) {
            Ok(ReadCappedBytes::Bytes(bytes)) => {
                if bytes.is_empty() {
                    continue;
                }
                if let Some(mime) = sniff_image_mime(&bytes) {
                    return Ok(ThumbnailResult::Ok {
                        mime: mime.to_owned(),
                        data_base64: encode_base64(&bytes),
                        entry: actual_name,
                    });
                }
            }
            Ok(ReadCappedBytes::TooLarge | ReadCappedBytes::Missing) => continue,
            Err(ZipGateError::Cancelled) => return Err(()),
            Err(err) => {
                return Ok(ThumbnailResult::Rejected {
                    reject_code: err.reject_code(),
                    message: err.message(),
                });
            }
        }
    }

    Ok(ThumbnailResult::NotFound {})
}
