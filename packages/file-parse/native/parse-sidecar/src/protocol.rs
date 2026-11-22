use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u8 = 1;
pub const DEFAULT_MAX_BODY_CHARS: usize = 1_000_000;
pub const DEFAULT_MAX_THUMBNAIL_BYTES: usize = 5 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum Command {
    ExtractFile {
        path: PathBuf,
        ext: String,
        #[serde(default, rename = "maxChars")]
        max_chars: Option<usize>,
        #[serde(default)]
        tokenize: bool,
        #[serde(default, rename = "maxBodyChars")]
        max_body_chars: Option<usize>,
        #[serde(default, rename = "redactNamespaces")]
        redact_namespaces: Vec<String>,
    },
    ExtractThumbnail {
        path: PathBuf,
        ext: String,
        #[serde(default, rename = "maxBytes")]
        max_bytes: Option<usize>,
    },
    ScanDir {
        root: PathBuf,
        #[serde(default, rename = "maxDepth")]
        max_depth: Option<usize>,
        #[serde(default, rename = "maxFiles")]
        max_files: Option<usize>,
    },
    TokenizeText {
        text: String,
    },
    Cancel {
        #[serde(rename = "targetRequestId")]
        target_request_id: String,
    },
    Shutdown {},
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub version: u8,
    pub request_id: String,
    #[serde(flatten)]
    pub command: Command,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub version: u8,
    pub request_id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorBody>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
}

impl Response {
    pub fn success(request_id: String, result: Value) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            request_id,
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(request_id: String, code: impl Into<String>, message: String) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            request_id,
            ok: false,
            result: None,
            error: Some(ErrorBody {
                code: code.into(),
                message,
            }),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TokenizedStrings {
    pub bi: String,
    pub uni: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FallbackReason {
    RedactionPresent,
    UnsupportedFormat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RejectCode {
    ZipRejected,
    ContentMismatch,
    PasswordProtected,
    Corrupt,
    UnsupportedEncoding,
    IoError,
}

/// Result payload of `extract_file`.
///
/// The `Fallback` variant intentionally holds no `text` or `tokens` fields so
/// serialization can never leak extracted content when a fallback is triggered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ExtractResult {
    Ok {
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tokens: Option<TokenizedStrings>,
    },
    Fallback {
        #[serde(rename = "fallbackReason")]
        fallback_reason: FallbackReason,
    },
    Rejected {
        #[serde(rename = "rejectCode")]
        reject_code: RejectCode,
        message: String,
    },
    Unsupported {
        message: String,
    },
}

/// Result payload of `extract_thumbnail`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ThumbnailResult {
    Ok {
        mime: String,
        #[serde(rename = "dataBase64")]
        data_base64: String,
        entry: String,
    },
    NotFound {},
    Fallback {
        #[serde(rename = "fallbackReason")]
        fallback_reason: FallbackReason,
    },
    Rejected {
        #[serde(rename = "rejectCode")]
        reject_code: RejectCode,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
    pub path: String,
    pub mtime_ms: f64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScanDirResult {
    pub files: Vec<ScannedFile>,
    pub truncated: bool,
}
