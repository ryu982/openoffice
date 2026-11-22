pub mod doc;
pub mod docx;
pub mod epub;
pub mod odt;
pub mod ole;
pub mod ppt;
pub mod pptx;
pub mod rels;
pub mod text;
pub mod thumbnail;
pub mod xlsx;
pub mod xml_util;
pub mod xmind;

use std::fs::{self, File};
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::extract::pptx::PptxExtractOutcome;
use crate::protocol::{
    DEFAULT_MAX_BODY_CHARS, ExtractResult, FallbackReason, RejectCode,
};
use crate::tokenize::{tokenize_text, truncate_utf16_units};
use crate::zip_gate::{DEFAULT_ZIP_LIMITS, ZipArchive, ZipGateError};

pub(crate) const PDF_HEADER_WINDOW: usize = 1024;
const HWP3_SIGNATURE: &[u8] = b"HWP Document File";
// UTF-16LE encoding of "EncryptedPackage" (OLE2 directory stream name for encrypted OOXML).
pub(crate) const ENCRYPTED_PACKAGE_UTF16LE: &[u8] = &[
    b'E', 0, b'n', 0, b'c', 0, b'r', 0, b'y', 0, b'p', 0, b't', 0, b'e', 0, b'd', 0, b'P', 0, b'a',
    0, b'c', 0, b'k', 0, b'a', 0, b'g', 0, b'e', 0,
];

#[derive(Debug, Clone)]
pub struct ExtractOptions {
    pub max_chars: Option<usize>,
    pub tokenize: bool,
    pub max_body_chars: Option<usize>,
    pub redact_namespaces: Vec<String>,
}

impl Default for ExtractOptions {
    fn default() -> Self {
        Self {
            max_chars: None,
            tokenize: false,
            max_body_chars: None,
            redact_namespaces: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BinaryKind {
    Zip,
    Pdf,
    Ole2,
    Hwp3,
    Unknown,
}

impl BinaryKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            BinaryKind::Zip => "zip",
            BinaryKind::Pdf => "pdf",
            BinaryKind::Ole2 => "ole2",
            BinaryKind::Hwp3 => "hwp3",
            BinaryKind::Unknown => "unknown",
        }
    }
}

pub(crate) fn sniff_binary(header: &[u8]) -> BinaryKind {
    if header.len() >= 2 && header[0] == 0x50 && header[1] == 0x4B {
        return BinaryKind::Zip;
    }
    let pdf_window = &header[..header.len().min(PDF_HEADER_WINDOW)];
    if pdf_window.windows(5).any(|w| w == b"%PDF-") {
        return BinaryKind::Pdf;
    }
    if header.len() >= 4
        && header[0] == 0xD0
        && header[1] == 0xCF
        && header[2] == 0x11
        && header[3] == 0xE0
    {
        return BinaryKind::Ole2;
    }
    if header.starts_with(HWP3_SIGNATURE) {
        return BinaryKind::Hwp3;
    }
    BinaryKind::Unknown
}

pub(crate) fn file_contains_needle(
    file: &mut File,
    needle: &[u8],
    cancelled: &AtomicBool,
) -> Result<bool, ()> {
    if file.seek(SeekFrom::Start(0)).is_err() {
        return Ok(false);
    }
    let mut buf = vec![0u8; 64 * 1024];
    let overlap = needle.len().saturating_sub(1);
    let mut carry: Vec<u8> = Vec::with_capacity(overlap);

    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err(());
        }
        let n = match file.read(&mut buf) {
            Ok(0) => return Ok(false),
            Ok(n) => n,
            Err(_) => return Ok(false),
        };
        let mut combined = Vec::with_capacity(carry.len() + n);
        combined.extend_from_slice(&carry);
        combined.extend_from_slice(&buf[..n]);
        if combined.windows(needle.len()).any(|w| w == needle) {
            return Ok(true);
        }
        carry.clear();
        if combined.len() >= overlap {
            carry.extend_from_slice(&combined[combined.len() - overlap..]);
        } else {
            carry.extend_from_slice(&combined);
        }
    }
}

fn finalize_ok(mut extracted: String, opts: &ExtractOptions) -> ExtractResult {
    if opts.tokenize {
        let limit = opts.max_body_chars.unwrap_or(DEFAULT_MAX_BODY_CHARS);
        let body = truncate_utf16_units(&extracted, limit).to_owned();
        let tokens = tokenize_text(&body);
        ExtractResult::Ok {
            text: body,
            tokens: Some(tokens),
        }
    } else {
        if let Some(limit) = opts.max_body_chars {
            extracted = truncate_utf16_units(&extracted, limit).to_owned();
        }
        ExtractResult::Ok {
            text: extracted,
            tokens: None,
        }
    }
}

pub(crate) fn normalize_ext(ext: &str) -> String {
    ext.trim().trim_start_matches('.').to_ascii_lowercase()
}

/// Extracts text (and optionally FTS5 tokens) from `path` according to `ext`.
/// Returns `Err(())` when cancelled via `cancelled`.
pub fn extract_file(
    path: &Path,
    ext: &str,
    opts: &ExtractOptions,
    cancelled: &AtomicBool,
) -> Result<ExtractResult, ()> {
    if cancelled.load(Ordering::Acquire) {
        return Err(());
    }
    let ext = normalize_ext(ext);

    // Non-redacted plain / tabular formats handled natively in Rust.
    if matches!(ext.as_str(), "csv" | "tsv" | "xml" | "log" | "py") {
        let bytes = match fs::read(path) {
            Ok(b) => b,
            Err(e) => {
                return Ok(ExtractResult::Rejected {
                    reject_code: RejectCode::IoError,
                    message: e.to_string(),
                });
            }
        };
        let decoded = if ext == "csv" || ext == "tsv" {
            text::decode_csv_bytes(&bytes)
        } else {
            text::decode_text_bytes(&bytes)
        };
        let Some(text) = decoded else {
            return Ok(ExtractResult::Rejected {
                reject_code: RejectCode::UnsupportedEncoding,
                message: "Unsupported text encoding: BOM-declared UTF-32 cannot be decoded (UTF-8 and UTF-16 are supported)".to_owned(),
            });
        };
        return Ok(finalize_ok(text, opts));
    }

    // ZIP-based and legacy OLE2 document formats handled natively in Rust.
    if !matches!(
        ext.as_str(),
        "docx" | "xlsx" | "xlsm" | "pptx" | "odt" | "epub" | "xmind" | "doc" | "ppt"
    ) {
        return Ok(ExtractResult::Fallback {
            fallback_reason: FallbackReason::UnsupportedFormat,
        });
    }

    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            return Ok(ExtractResult::Rejected {
                reject_code: RejectCode::IoError,
                message: e.to_string(),
            });
        }
    };

    let mut header = [0u8; PDF_HEADER_WINDOW];
    let head_len = match file.read(&mut header) {
        Ok(n) => n,
        Err(e) => {
            return Ok(ExtractResult::Rejected {
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
                return Ok(ExtractResult::Rejected {
                    reject_code: RejectCode::PasswordProtected,
                    message: format!(
                        "Password-protected .{ext}: open it in its editor with the password, or remove the password and attach it again"
                    ),
                });
            }
            return Ok(ExtractResult::Rejected {
                reject_code: RejectCode::ContentMismatch,
                message: format!(
                    "Content mismatch: .{ext} file has {} magic bytes",
                    sniffed.as_str()
                ),
            });
        }
        "xmind" | "epub" if sniffed != BinaryKind::Zip => {
            return Ok(ExtractResult::Rejected {
                reject_code: RejectCode::ContentMismatch,
                message: format!(
                    "Content mismatch: .{ext} file has {} magic bytes",
                    sniffed.as_str()
                ),
            });
        }
        "doc" => {
            if sniffed == BinaryKind::Ole2 {
                return match doc::extract_doc(BufReader::new(file), opts.max_chars, cancelled) {
                    Ok(text) => Ok(finalize_ok(text, opts)),
                    Err(ole::OleError::Cancelled) => Err(()),
                    Err(err) => Ok(ExtractResult::Rejected {
                        reject_code: err.reject_code(),
                        message: err.message(),
                    }),
                };
            }
            if sniffed != BinaryKind::Zip {
                return Ok(ExtractResult::Rejected {
                    reject_code: RejectCode::ContentMismatch,
                    message: format!(
                        "Content mismatch: .doc file has {} magic bytes",
                        sniffed.as_str()
                    ),
                });
            }
        }
        "ppt" => {
            if sniffed != BinaryKind::Ole2 {
                return Ok(ExtractResult::Rejected {
                    reject_code: RejectCode::ContentMismatch,
                    message: format!(
                        "Content mismatch: .ppt file has {} magic bytes",
                        sniffed.as_str()
                    ),
                });
            }
            return match ppt::extract_ppt(BufReader::new(file), opts.max_chars, cancelled) {
                Ok(text) => Ok(finalize_ok(text, opts)),
                Err(ole::OleError::Cancelled) => Err(()),
                Err(err) => Ok(ExtractResult::Rejected {
                    reject_code: err.reject_code(),
                    message: err.message(),
                }),
            };
        }
        _ => {}
    }

    let mut zip = match ZipArchive::open_and_verify(file, DEFAULT_ZIP_LIMITS, cancelled) {
        Ok(z) => z,
        Err(ZipGateError::Cancelled) => return Err(()),
        Err(err) => {
            let reject_code = err.reject_code();
            let message = if ext == "epub" {
                epub::EpubError::Zip(err).message()
            } else {
                err.message()
            };
            return Ok(ExtractResult::Rejected {
                reject_code,
                message,
            });
        }
    };

    match ext.as_str() {
        "docx" | "doc" => match docx::extract_docx(&mut zip, opts.max_chars) {
            Ok(text) => Ok(finalize_ok(text, opts)),
            Err(ZipGateError::Cancelled) => Err(()),
            Err(err) => Ok(ExtractResult::Rejected {
                reject_code: err.reject_code(),
                message: err.message(),
            }),
        },
        "xlsx" | "xlsm" => match xlsx::extract_xlsx(&mut zip, opts.max_chars, cancelled) {
            Ok(text) => Ok(finalize_ok(text, opts)),
            Err(ZipGateError::Cancelled) => Err(()),
            Err(err) => Ok(ExtractResult::Rejected {
                reject_code: err.reject_code(),
                message: err.message(),
            }),
        },
        "pptx" => match pptx::extract_pptx(&mut zip, &opts.redact_namespaces, cancelled) {
            Ok(PptxExtractOutcome::Ok(text)) => Ok(finalize_ok(text, opts)),
            Ok(PptxExtractOutcome::RedactionPresent) => Ok(ExtractResult::Fallback {
                fallback_reason: FallbackReason::RedactionPresent,
            }),
            Err(ZipGateError::Cancelled) => Err(()),
            Err(err) => Ok(ExtractResult::Rejected {
                reject_code: err.reject_code(),
                message: err.message(),
            }),
        },
        "odt" => match odt::extract_odt(&mut zip) {
            Ok(text) => Ok(finalize_ok(text, opts)),
            Err(odt::OdtError::Zip(ZipGateError::Cancelled)) => Err(()),
            Err(err) => Ok(ExtractResult::Rejected {
                reject_code: err.reject_code(),
                message: err.message(),
            }),
        },
        "epub" => match epub::extract_epub(&mut zip, cancelled) {
            Ok(text) => Ok(finalize_ok(text, opts)),
            Err(epub::EpubError::Zip(ZipGateError::Cancelled)) => Err(()),
            Err(err) => Ok(ExtractResult::Rejected {
                reject_code: err.reject_code(),
                message: err.message(),
            }),
        },
        "xmind" => match xmind::extract_xmind(&mut zip) {
            Ok(text) => Ok(finalize_ok(text, opts)),
            Err(xmind::XmindError::Zip(ZipGateError::Cancelled)) => Err(()),
            Err(err) => Ok(ExtractResult::Rejected {
                reject_code: err.reject_code(),
                message: err.message(),
            }),
        },
        _ => Ok(ExtractResult::Fallback {
            fallback_reason: FallbackReason::UnsupportedFormat,
        }),
    }
}
