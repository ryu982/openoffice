//! Extracts raw Excalidraw scene JSON from `.excalidraw`, `.excalidraw.png`, and `.excalidraw.svg` bytes.

use crate::error::{OpenError, OpenErrorCode};
use base64::Engine;
use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
use flate2::read::ZlibDecoder;
use serde::Deserialize;
use std::io::Read;

const PNG_SIG: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
const EXCALIDRAW_KEYWORD: &str = "application/vnd.excalidraw+json";
const MAX_SCENE_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Debug, Deserialize)]
struct EncodedPayload {
    encoded: String,
    #[serde(default)]
    encoding: String,
    #[serde(default)]
    compressed: bool,
    #[serde(default)]
    version: Option<String>,
}

fn inflate_zlib_bounded(data: &[u8]) -> Result<Vec<u8>, OpenError> {
    let decoder = ZlibDecoder::new(data);
    let mut limited = decoder.take(MAX_SCENE_BYTES + 1);
    let mut out = Vec::new();
    limited.read_to_end(&mut out).map_err(|e| {
        OpenError::new(
            OpenErrorCode::InvalidExcalidraw,
            format!("failed to inflate compressed Excalidraw payload: {e}"),
        )
    })?;
    if (out.len() as u64) > MAX_SCENE_BYTES {
        return Err(OpenError::new(
            OpenErrorCode::InvalidExcalidraw,
            "Excalidraw payload exceeds size limit",
        ));
    }
    Ok(out)
}

fn decode_excalidraw_wrapper(raw_json: &str) -> Result<String, OpenError> {
    let trimmed = raw_json.trim();
    if trimmed.is_empty() {
        return Err(OpenError::new(
            OpenErrorCode::InvalidExcalidraw,
            "empty Excalidraw payload",
        ));
    }

    // Check if this is an Excalidraw v2 encoded wrapper `{ encoded, encoding, compressed, version }`.
    if let Ok(wrapper) = serde_json::from_str::<EncodedPayload>(trimmed) {
        if wrapper.version.as_deref() == Some("2") || !wrapper.encoding.is_empty() {
            let raw_bytes: Vec<u8> = match wrapper.encoding.as_str() {
                "bstring" => {
                    // Excalidraw encodes each byte (0..=255) as a Unicode code point in the JSON string.
                    let mut out = Vec::with_capacity(wrapper.encoded.len());
                    for ch in wrapper.encoded.chars() {
                        let code = ch as u32;
                        if code > 255 {
                            return Err(OpenError::new(
                                OpenErrorCode::InvalidExcalidraw,
                                "invalid byte-string code point in Excalidraw payload",
                            ));
                        }
                        out.push(code as u8);
                    }
                    out
                }
                "base64" => STANDARD
                    .decode(wrapper.encoded.trim())
                    .or_else(|_| STANDARD_NO_PAD.decode(wrapper.encoded.trim()))
                    .map_err(|e| {
                        OpenError::new(
                            OpenErrorCode::InvalidExcalidraw,
                            format!("invalid base64 in Excalidraw wrapper: {e}"),
                        )
                    })?,
                _ => wrapper.encoded.into_bytes(),
            };

            let decoded = if wrapper.compressed {
                inflate_zlib_bounded(&raw_bytes)?
            } else {
                raw_bytes
            };

            return String::from_utf8(decoded).map_err(|_| {
                OpenError::new(
                    OpenErrorCode::InvalidExcalidraw,
                    "decoded Excalidraw payload is not valid UTF-8",
                )
            });
        }
    }

    Ok(trimmed.to_string())
}

/// Extracts Excalidraw JSON from PNG `tEXt` / `iTXt` chunks.
pub fn extract_from_png(bytes: &[u8]) -> Result<String, OpenError> {
    if bytes.len() < 8 || &bytes[0..8] != PNG_SIG {
        return Err(OpenError::new(
            OpenErrorCode::InvalidExcalidraw,
            "not a valid PNG file",
        ));
    }
    let mut pos = 8usize;
    while pos + 12 <= bytes.len() {
        let len = u32::from_be_bytes([bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]])
            as usize;
        let chunk_type = &bytes[pos + 4..pos + 8];
        let data_start = pos + 8;
        let data_end = data_start.saturating_add(len);
        if data_end + 4 > bytes.len() {
            break;
        }
        let data = &bytes[data_start..data_end];

        if chunk_type == b"tEXt" {
            if let Some(nul) = data.iter().position(|&b| b == 0) {
                let keyword = std::str::from_utf8(&data[..nul]).unwrap_or("");
                if keyword == EXCALIDRAW_KEYWORD {
                    let payload = std::str::from_utf8(&data[nul + 1..]).map_err(|_| {
                        OpenError::new(
                            OpenErrorCode::InvalidExcalidraw,
                            "invalid UTF-8 in PNG tEXt Excalidraw chunk",
                        )
                    })?;
                    return decode_excalidraw_wrapper(payload);
                }
            }
        } else if chunk_type == b"iTXt" {
            if let Some(nul) = data.iter().position(|&b| b == 0) {
                let keyword = std::str::from_utf8(&data[..nul]).unwrap_or("");
                if keyword == EXCALIDRAW_KEYWORD {
                    let rest = &data[nul + 1..];
                    if rest.len() < 2 {
                        return Err(OpenError::new(
                            OpenErrorCode::InvalidExcalidraw,
                            "truncated PNG iTXt Excalidraw chunk",
                        ));
                    }
                    let comp_flag = rest[0];
                    let _comp_method = rest[1];
                    let after_flags = &rest[2..];
                    // Skip language tag\0 and translated keyword\0.
                    let Some(lang_nul) = after_flags.iter().position(|&b| b == 0) else {
                        return Err(OpenError::new(
                            OpenErrorCode::InvalidExcalidraw,
                            "malformed PNG iTXt header",
                        ));
                    };
                    let after_lang = &after_flags[lang_nul + 1..];
                    let Some(trans_nul) = after_lang.iter().position(|&b| b == 0) else {
                        return Err(OpenError::new(
                            OpenErrorCode::InvalidExcalidraw,
                            "malformed PNG iTXt header",
                        ));
                    };
                    let text_bytes = &after_lang[trans_nul + 1..];
                    let raw = if comp_flag == 1 {
                        inflate_zlib_bounded(text_bytes)?
                    } else {
                        text_bytes.to_vec()
                    };
                    let payload = String::from_utf8(raw).map_err(|_| {
                        OpenError::new(
                            OpenErrorCode::InvalidExcalidraw,
                            "invalid UTF-8 in PNG iTXt Excalidraw chunk",
                        )
                    })?;
                    return decode_excalidraw_wrapper(&payload);
                }
            }
        } else if chunk_type == b"IEND" {
            break;
        }

        pos = data_end + 4;
    }

    Err(OpenError::new(
        OpenErrorCode::NoExcalidrawScene,
        "PNG file does not contain an embedded Excalidraw scene",
    ))
}

/// Extracts Excalidraw JSON from SVG `<!-- payload-start -->...<!-- payload-end -->`.
pub fn extract_from_svg(bytes: &[u8]) -> Result<String, OpenError> {
    let text = std::str::from_utf8(bytes).map_err(|_| {
        OpenError::new(
            OpenErrorCode::InvalidExcalidraw,
            "SVG file is not valid UTF-8",
        )
    })?;

    let start_marker = "<!-- payload-start -->";
    let end_marker = "<!-- payload-end -->";
    let Some(start_idx) = text.find(start_marker) else {
        return Err(OpenError::new(
            OpenErrorCode::NoExcalidrawScene,
            "SVG file does not contain an embedded Excalidraw scene",
        ));
    };
    let after_start = &text[start_idx + start_marker.len()..];
    let Some(end_idx) = after_start.find(end_marker) else {
        return Err(OpenError::new(
            OpenErrorCode::InvalidExcalidraw,
            "unterminated Excalidraw payload marker in SVG",
        ));
    };
    let payload_b64: String = after_start[..end_idx]
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    if payload_b64.is_empty() {
        return Err(OpenError::new(
            OpenErrorCode::NoExcalidrawScene,
            "empty Excalidraw payload in SVG",
        ));
    }

    let decoded_bytes = STANDARD
        .decode(&payload_b64)
        .or_else(|_| STANDARD_NO_PAD.decode(&payload_b64))
        .map_err(|e| {
            OpenError::new(
                OpenErrorCode::InvalidExcalidraw,
                format!("invalid base64 Excalidraw payload in SVG: {e}"),
            )
        })?;
    let decoded_str = String::from_utf8(decoded_bytes).map_err(|_| {
        OpenError::new(
            OpenErrorCode::InvalidExcalidraw,
            "decoded SVG Excalidraw payload is not valid UTF-8",
        )
    })?;
    decode_excalidraw_wrapper(&decoded_str)
}

/// Auto-detects container format (PNG, SVG, or raw `.excalidraw` JSON) and extracts scene JSON.
pub fn extract_excalidraw_json(bytes: &[u8], filename_hint: Option<&str>) -> Result<String, OpenError> {
    if bytes.len() >= 8 && &bytes[0..8] == PNG_SIG {
        return extract_from_png(bytes);
    }
    let hint_lower = filename_hint.unwrap_or("").to_ascii_lowercase();
    let trimmed_start = bytes
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .map(|i| &bytes[i..])
        .unwrap_or(&[]);

    if hint_lower.ends_with(".svg") || trimmed_start.starts_with(b"<") {
        return extract_from_svg(bytes);
    }

    let text = std::str::from_utf8(bytes).map_err(|_| {
        OpenError::new(
            OpenErrorCode::InvalidExcalidraw,
            "Excalidraw file is not valid UTF-8",
        )
    })?;
    decode_excalidraw_wrapper(text)
}
