use serde::{Deserialize, Serialize};
use std::fmt;

/// Structured error codes returned when opening `.whiteboard` or importing Excalidraw files.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenErrorCode {
    NotZip,
    ZipRejected,
    MissingBoardJson,
    InvalidUtf8,
    InvalidJson,
    UnsupportedSchemaVersion,
    InvalidSchema,
    NoExcalidrawScene,
    InvalidExcalidraw,
}

impl OpenErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotZip => "not_zip",
            Self::ZipRejected => "zip_rejected",
            Self::MissingBoardJson => "missing_board_json",
            Self::InvalidUtf8 => "invalid_utf8",
            Self::InvalidJson => "invalid_json",
            Self::UnsupportedSchemaVersion => "unsupported_schema_version",
            Self::InvalidSchema => "invalid_schema",
            Self::NoExcalidrawScene => "no_excalidraw_scene",
            Self::InvalidExcalidraw => "invalid_excalidraw",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenError {
    pub code: OpenErrorCode,
    pub message: String,
}

impl OpenError {
    pub fn new(code: OpenErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for OpenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for OpenError {}

/// Structured error codes returned when planning AI / MCP / CLI board edits or templates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EditErrorCode {
    UnknownOp,
    TargetNotFound,
    PageNotFound,
    LastPageDelete,
    InvalidArgument,
    ResourceNotFound,
    InvalidTemplate,
}

impl EditErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UnknownOp => "unknown_op",
            Self::TargetNotFound => "target_not_found",
            Self::PageNotFound => "page_not_found",
            Self::LastPageDelete => "last_page_delete",
            Self::InvalidArgument => "invalid_argument",
            Self::ResourceNotFound => "resource_not_found",
            Self::InvalidTemplate => "invalid_template",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditError {
    pub code: EditErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

impl EditError {
    pub fn new(code: EditErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            path: None,
        }
    }

    pub fn at_path(
        code: EditErrorCode,
        path: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            path: Some(path.into()),
        }
    }
}

impl fmt::Display for EditError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.path {
            Some(p) => write!(f, "{} ({p}): {}", self.code.as_str(), self.message),
            None => write!(f, "{}: {}", self.code.as_str(), self.message),
        }
    }
}

impl std::error::Error for EditError {}
