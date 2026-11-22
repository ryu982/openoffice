use unicode_general_category::{GeneralCategory, get_general_category};
use unicode_normalization::UnicodeNormalization;

use crate::protocol::TokenizedStrings;

const CJK_RANGES: &[(u32, u32)] = &[
    (0x2E80, 0x2FDF),   // CJK radicals
    (0x3005, 0x3007),   // ideographic iteration & zero marks
    (0x3040, 0x30FF),   // hiragana, katakana
    (0x3100, 0x312F),   // bopomofo
    (0x3130, 0x318F),   // hangul compatibility jamo
    (0x31A0, 0x31FF),   // bopomofo ext, katakana ext
    (0x3400, 0x4DBF),   // CJK ext A
    (0x4E00, 0x9FFF),   // CJK unified
    (0xA960, 0xA97F),   // hangul jamo ext A
    (0xAC00, 0xD7FF),   // hangul syllables, jamo ext B
    (0xF900, 0xFAFF),   // CJK compat ideographs
    (0xFF66, 0xFF9F),   // halfwidth katakana
    (0x1100, 0x11FF),   // hangul jamo
    (0x20000, 0x323AF), // CJK ext B-H
];

pub fn is_cjk(cp: u32) -> bool {
    CJK_RANGES.iter().any(|&(lo, hi)| cp >= lo && cp <= hi)
}

/// Matches JS `/^[\p{L}\p{N}\p{M}]$/u` using Unicode General Category.
fn is_word_char(ch: char) -> bool {
    matches!(
        get_general_category(ch),
        GeneralCategory::UppercaseLetter
            | GeneralCategory::LowercaseLetter
            | GeneralCategory::TitlecaseLetter
            | GeneralCategory::ModifierLetter
            | GeneralCategory::OtherLetter
            | GeneralCategory::DecimalNumber
            | GeneralCategory::LetterNumber
            | GeneralCategory::OtherNumber
            | GeneralCategory::NonspacingMark
            | GeneralCategory::SpacingMark
            | GeneralCategory::EnclosingMark
    )
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RunKind {
    Cjk,
    Word,
}

/// Pre-tokenizer matching `apps/shell/src/main/file-index/tokenize.ts`.
/// Applies NFKC normalization, Unicode lowercasing, CJK bigram/unigram splitting,
/// and whole-word emission for non-CJK Letter/Number/Mark runs.
pub fn tokenize_text(text: &str) -> TokenizedStrings {
    let folded: String = text.nfkc().collect::<String>().to_lowercase();

    let mut bi: Vec<String> = Vec::new();
    let mut uni: Vec<String> = Vec::new();

    let mut current_kind: Option<RunKind> = None;
    let mut current_chars: Vec<char> = Vec::new();

    let flush = |kind: Option<RunKind>,
                 chars: &mut Vec<char>,
                 bi: &mut Vec<String>,
                 uni: &mut Vec<String>| {
        let Some(k) = kind else {
            chars.clear();
            return;
        };
        if chars.is_empty() {
            return;
        }
        match k {
            RunKind::Word => {
                let word: String = chars.iter().collect();
                bi.push(word.clone());
                uni.push(word);
            }
            RunKind::Cjk => {
                for &c in chars.iter() {
                    uni.push(c.to_string());
                }
                if chars.len() == 1 {
                    bi.push(chars[0].to_string());
                } else {
                    for pair in chars.windows(2) {
                        let mut s = String::with_capacity(pair[0].len_utf8() + pair[1].len_utf8());
                        s.push(pair[0]);
                        s.push(pair[1]);
                        bi.push(s);
                    }
                }
            }
        }
        chars.clear();
    };

    for ch in folded.chars() {
        let kind = if is_cjk(ch as u32) {
            Some(RunKind::Cjk)
        } else if is_word_char(ch) {
            Some(RunKind::Word)
        } else {
            None
        };

        if kind != current_kind {
            flush(current_kind, &mut current_chars, &mut bi, &mut uni);
            current_kind = kind;
        }
        if kind.is_some() {
            current_chars.push(ch);
        }
    }
    flush(current_kind, &mut current_chars, &mut bi, &mut uni);

    TokenizedStrings {
        bi: bi.join(" "),
        uni: uni.join(" "),
    }
}

/// Truncates `text` to at most `max_units` UTF-16 code units without splitting
/// a surrogate pair, matching `FileIndexStore.upsert`'s `text.slice(0, MAX_BODY_CHARS)`
/// safely on UTF-8 boundaries.
pub fn truncate_utf16_units(text: &str, max_units: usize) -> &str {
    let mut units = 0usize;
    for (byte_idx, ch) in text.char_indices() {
        let next = units + ch.len_utf16();
        if next > max_units {
            return &text[..byte_idx];
        }
        units = next;
    }
    text
}
