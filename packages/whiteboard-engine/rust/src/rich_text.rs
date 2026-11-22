use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TextAlign {
    #[default]
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TextRun {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub underline: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strike: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TextParagraph {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align: Option<TextAlign>,
    #[serde(default)]
    pub runs: Vec<TextRun>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RichText {
    pub paragraphs: Vec<TextParagraph>,
}

impl Default for RichText {
    fn default() -> Self {
        empty_rich_text()
    }
}

pub fn empty_rich_text() -> RichText {
    RichText {
        paragraphs: vec![TextParagraph {
            align: None,
            runs: Vec::new(),
        }],
    }
}

pub fn plain_to_rich_text(text: &str) -> RichText {
    if text.is_empty() {
        return empty_rich_text();
    }
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let paragraphs = normalized
        .split('\n')
        .map(|line| TextParagraph {
            align: None,
            runs: if line.is_empty() {
                Vec::new()
            } else {
                vec![TextRun {
                    text: line.to_string(),
                    ..TextRun::default()
                }]
            },
        })
        .collect();
    RichText { paragraphs }
}

pub fn rich_text_to_plain(rt: &RichText) -> String {
    rt.paragraphs
        .iter()
        .map(|p| {
            p.runs
                .iter()
                .map(|r| r.text.as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn is_rich_text_empty(rt: &RichText) -> bool {
    rt.paragraphs
        .iter()
        .all(|p| p.runs.iter().all(|r| r.text.trim().is_empty()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_plain_text_and_detects_empty() {
        assert!(is_rich_text_empty(&empty_rich_text()));
        let rt = plain_to_rich_text("Hello\r\nWorld");
        assert!(!is_rich_text_empty(&rt));
        assert_eq!(rt.paragraphs.len(), 2);
        assert_eq!(rich_text_to_plain(&rt), "Hello\nWorld");
    }
}
