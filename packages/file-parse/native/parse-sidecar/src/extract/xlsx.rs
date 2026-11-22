use std::collections::HashMap;
use std::io::{Read, Seek};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::extract::rels::resolve_target;
use crate::extract::xml_util::{
    XmlElement, XmlNode, get_rel_id, parse_relationships, parse_xml_tree,
};
use crate::zip_gate::{ZipArchive, ZipGateError};

pub const MAX_XLSX_COLS: usize = 16_384;
const MAX_XLSX_ROWS: i64 = 1_048_576;
const MAX_EMPTY_RUN: usize = 8;
const XML_BYTES_PER_TEXT_CHAR: usize = 8;
const XML_CLIP_SLACK: usize = 256 * 1024;
const EMPTY_SHEET_XML: &str = "<worksheet><sheetData/></worksheet>";

/// Decodes ECMA-376 `_xHHHH_` escapes, skipping surrogate range `0xD800..=0xDFFF`.
/// Matches `packages/xlsx-gateway/src/gateway/xlsx-escapes.ts`.
pub fn decode_xlsx_escapes(text: &str) -> String {
    if !text.contains("_x") {
        return text.to_owned();
    }
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < bytes.len() {
        if i + 7 <= bytes.len()
            && bytes[i] == b'_'
            && bytes[i + 1] == b'x'
            && bytes[i + 6] == b'_'
            && bytes[i + 2..i + 6].iter().all(|b| b.is_ascii_hexdigit())
        {
            if let Ok(code) = u32::from_str_radix(&text[i + 2..i + 6], 16) {
                if !(0xD800..=0xDFFF).contains(&code) {
                    if let Some(ch) = char::from_u32(code) {
                        out.push(ch);
                        i += 7;
                        continue;
                    }
                }
            }
        }
        let ch = text[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ElapsedUnit {
    H,
    M,
    S,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DateFormatParts {
    date: bool,
    time: bool,
    seconds: bool,
    elapsed: bool,
    elapsed_unit: Option<ElapsedUnit>,
    elapsed_minutes: Option<bool>,
}

const DATE_ONLY: DateFormatParts = DateFormatParts {
    date: true,
    time: false,
    seconds: false,
    elapsed: false,
    elapsed_unit: None,
    elapsed_minutes: None,
};
const DATE_TIME: DateFormatParts = DateFormatParts {
    date: true,
    time: true,
    seconds: false,
    elapsed: false,
    elapsed_unit: None,
    elapsed_minutes: None,
};
const TIME_ONLY: DateFormatParts = DateFormatParts {
    date: false,
    time: true,
    seconds: false,
    elapsed: false,
    elapsed_unit: None,
    elapsed_minutes: None,
};
const TIME_SECONDS: DateFormatParts = DateFormatParts {
    date: false,
    time: true,
    seconds: true,
    elapsed: false,
    elapsed_unit: None,
    elapsed_minutes: None,
};
const ELAPSED_BUILTIN: DateFormatParts = DateFormatParts {
    date: false,
    time: true,
    seconds: true,
    elapsed: true,
    elapsed_unit: Some(ElapsedUnit::H),
    elapsed_minutes: None,
};

fn builtin_date_format(id: i64) -> Option<DateFormatParts> {
    match id {
        14..=17 | 27..=31 | 34..=36 | 50..=58 => Some(DATE_ONLY),
        18 | 20 | 32 => Some(TIME_ONLY),
        19 | 21 | 33 | 45 | 47 => Some(TIME_SECONDS),
        22 => Some(DATE_TIME),
        46 => Some(ELAPSED_BUILTIN),
        _ => None,
    }
}

fn first_format_section_tokens(code: &str) -> String {
    let chars: Vec<char> = code.chars().collect();
    let mut quoted = false;
    let mut tokens = String::new();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '\\' || (!quoted && (ch == '_' || ch == '*')) {
            i += 2;
            continue;
        } else if ch == '"' {
            quoted = !quoted;
        } else if ch == ';' && !quoted {
            return tokens;
        } else if !quoted {
            tokens.push(ch);
        }
        i += 1;
    }
    tokens
}

fn has_sep_between(s: &str, left: char, right: char) -> bool {
    let bytes = s.as_bytes();
    let lb = left as u8;
    let rb = right as u8;
    for i in 0..bytes.len() {
        if bytes[i] == lb {
            let mut j = i + 1;
            while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            if j < bytes.len() && matches!(bytes[j], b':' | b'.' | b'-' | b'/') {
                j += 1;
            }
            while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == rb {
                return true;
            }
        }
    }
    false
}

/// Strips minute `m`/`mm` adjacent to `h+` or `s+` to detect whether any month `m` remains.
fn strip_minute_ms(body: &str) -> String {
    let b = body.as_bytes();
    let mut skip = vec![false; b.len()];
    let mut i = 0;
    while i < b.len() {
        // h+ \s* [:.-/]? \s* m{1,2} (?!m)
        if b[i] == b'h' {
            let start = i;
            let mut j = i;
            while j < b.len() && b[j] == b'h' {
                j += 1;
            }
            while j < b.len() && b[j].is_ascii_whitespace() {
                j += 1;
            }
            if j < b.len() && matches!(b[j], b':' | b'.' | b'-' | b'/') {
                j += 1;
            }
            while j < b.len() && b[j].is_ascii_whitespace() {
                j += 1;
            }
            let m_start = j;
            while j < b.len() && b[j] == b'm' {
                j += 1;
            }
            let m_len = j - m_start;
            if m_len == 1 || m_len == 2 {
                for slot in &mut skip[start..j] {
                    *slot = true;
                }
                i = j;
                continue;
            }
        }
        // (?<!m) m{1,2} \s* [:.-/]? \s* s+
        if b[i] == b'm' && (i == 0 || b[i - 1] != b'm') {
            let start = i;
            let mut j = i;
            while j < b.len() && b[j] == b'm' {
                j += 1;
            }
            let m_len = j - start;
            if m_len == 1 || m_len == 2 {
                while j < b.len() && b[j].is_ascii_whitespace() {
                    j += 1;
                }
                if j < b.len() && matches!(b[j], b':' | b'.' | b'-' | b'/') {
                    j += 1;
                }
                while j < b.len() && b[j].is_ascii_whitespace() {
                    j += 1;
                }
                let s_start = j;
                while j < b.len() && b[j] == b's' {
                    j += 1;
                }
                if j > s_start {
                    for slot in &mut skip[start..j] {
                        *slot = true;
                    }
                    i = j;
                    continue;
                }
            }
        }
        i += 1;
    }
    body.bytes()
        .enumerate()
        .filter(|(idx, _)| !skip[*idx])
        .map(|(_, ch)| ch as char)
        .collect()
}

fn classify_format_code(code: &str) -> Option<DateFormatParts> {
    let section = first_format_section_tokens(code);
    let lower_section = section.to_ascii_lowercase();
    if lower_section.contains("general") {
        let without_general = lower_section.replace("general", "");
        if !without_general
            .bytes()
            .any(|b| matches!(b, b'y' | b'd' | b'h' | b's'))
        {
            return None;
        }
    }

    let mut elapsed = false;
    let mut elapsed_minutes = false;
    let mut elapsed_unit: Option<ElapsedUnit> = None;

    let mut stripped = String::with_capacity(lower_section.len());
    let bytes = lower_section.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'[' {
            if let Some(close_rel) = lower_section[i + 1..].find(']') {
                let inner = &lower_section[i + 1..i + 1 + close_rel];
                if !inner.is_empty()
                    && (inner.bytes().all(|b| b == b'h')
                        || inner.bytes().all(|b| b == b'm')
                        || inner.bytes().all(|b| b == b's'))
                {
                    elapsed = true;
                    let first = inner.as_bytes()[0];
                    if elapsed_unit.is_none() {
                        elapsed_unit = Some(match first {
                            b'h' => ElapsedUnit::H,
                            b'm' => ElapsedUnit::M,
                            _ => ElapsedUnit::S,
                        });
                    }
                    if first == b'm' {
                        elapsed_minutes = true;
                    }
                    stripped.push_str(inner);
                }
                i += close_rel + 2;
                continue;
            }
        }
        stripped.push(bytes[i] as char);
        i += 1;
    }

    let has_am_pm = stripped.contains("am/pm") || stripped.contains("a/p");
    let body = stripped.replace("am/pm", "").replace("a/p", "");
    let has_y = body.contains('y');
    let has_d = body.contains('d');
    let has_h = body.contains('h') || has_am_pm;
    let has_s = body.contains('s');
    let has_m = body.contains('m');
    if !has_y && !has_d && !has_h && !has_s && !has_m {
        return None;
    }

    let minute_m =
        has_m && (elapsed_minutes || has_sep_between(&body, 'h', 'm') || has_sep_between(&body, 'm', 's'));
    let months = strip_minute_ms(&body);
    let date = has_y || has_d || (has_m && (!minute_m || (!elapsed_minutes && months.contains('m'))));
    let time = has_h || has_s || minute_m || elapsed;
    if !date && !time {
        return None;
    }
    Some(DateFormatParts {
        date,
        time,
        seconds: has_s,
        elapsed: elapsed && !date,
        elapsed_unit: if elapsed && !date { elapsed_unit } else { None },
        elapsed_minutes: if elapsed && !date && elapsed_unit == Some(ElapsedUnit::H) {
            Some(minute_m)
        } else {
            None
        },
    })
}

/// Howard Hinnant's civil-from-days algorithm (days since 1970-01-01 -> (Y, M, D)).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = y + if m <= 2 { 1 } else { 0 };
    (y, m as u32, d as u32)
}

/// Days from 1970-01-01 to 1899-12-30 is -25569; to 1904-01-01 is -24107.
const EPOCH_1900_DAYS: i64 = -25_569;
const EPOCH_1904_DAYS: i64 = -24_107;

fn format_serial(serial: f64, parts: DateFormatParts, date1904: bool) -> Option<String> {
    if !serial.is_finite() || serial < 0.0 {
        return None;
    }
    if parts.elapsed {
        let total = (serial * 86_400.0).round() as i64;
        if parts.elapsed_unit == Some(ElapsedUnit::M) {
            let mm = total / 60;
            return Some(if parts.seconds {
                format!("{mm}:{:02}", total % 60)
            } else {
                mm.to_string()
            });
        }
        if parts.elapsed_unit == Some(ElapsedUnit::S) {
            return Some(total.to_string());
        }
        let h = total / 3600;
        if parts.elapsed_minutes == Some(false) {
            return Some(h.to_string());
        }
        let m = (total % 3600) / 60;
        return Some(if !parts.seconds {
            format!("{h}:{m:02}")
        } else {
            format!("{h}:{m:02}:{:02}", total % 60)
        });
    }

    let mut days = serial.floor() as i64;
    let mut secs = if parts.time {
        ((serial - (days as f64)) * 86_400.0).round() as i64
    } else {
        0
    };
    if secs >= 86_400 {
        days += 1;
        secs = 0;
    }
    let time_text = if parts.time {
        if parts.seconds {
            format!(
                "{:02}:{:02}:{:02}",
                secs / 3600,
                (secs % 3600) / 60,
                secs % 60
            )
        } else {
            format!("{:02}:{:02}", secs / 3600, (secs % 3600) / 60)
        }
    } else {
        String::new()
    };
    if !parts.date {
        return Some(time_text);
    }

    let date_text = if !date1904 && days == 60 {
        "1900-02-29".to_owned()
    } else {
        if !date1904 && days == 0 {
            return None;
        }
        if days > if date1904 { 2_957_003 } else { 2_958_465 } {
            return None;
        }
        let epoch = if date1904 {
            EPOCH_1904_DAYS
        } else {
            EPOCH_1900_DAYS
        };
        let shift = if !date1904 && days < 60 { 1 } else { 0 };
        let (y, m, d) = civil_from_days(epoch + days + shift);
        format!("{y:04}-{m:02}-{d:02}")
    };

    if time_text.is_empty() {
        Some(date_text)
    } else {
        Some(format!("{date_text} {time_text}"))
    }
}

fn column_index_from_ref(cell_ref: &str) -> Option<usize> {
    let mut idx: usize = 0;
    let mut letters = 0usize;
    for b in cell_ref.bytes() {
        let up = b.to_ascii_uppercase();
        if !up.is_ascii_uppercase() {
            break;
        }
        letters += 1;
        idx = idx.checked_mul(26)?.checked_add((up - b'A' + 1) as usize)?;
    }
    if letters == 0 {
        None
    } else {
        Some(idx - 1)
    }
}

fn column_label(col: usize) -> String {
    let mut remaining = col + 1;
    let mut chars = Vec::new();
    while remaining > 0 {
        remaining -= 1;
        chars.push((b'A' + (remaining % 26) as u8) as char);
        remaining /= 26;
    }
    chars.into_iter().rev().collect()
}

fn parse_a1_address(addr: &str) -> Option<(i64, i64)> {
    let b = addr.as_bytes();
    let mut i = 0;
    if i < b.len() && b[i] == b'$' {
        i += 1;
    }
    let col_start = i;
    while i < b.len() && b[i].is_ascii_alphabetic() {
        i += 1;
    }
    if i == col_start {
        return None;
    }
    let col = column_index_from_ref(&addr[col_start..i])? as i64;
    if i < b.len() && b[i] == b'$' {
        i += 1;
    }
    let row_start = i;
    if row_start >= b.len() || !(b'1'..=b'9').contains(&b[row_start]) {
        return None;
    }
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    if i != b.len() {
        return None;
    }
    let row = addr[row_start..].parse::<i64>().ok()? - 1;
    Some((row, col))
}

/// Shifts A1 references in a shared formula for copy/fill semantics.
/// Skips double-quoted string literals and structured table references (`Table1[...]`).
/// Matches `offsetFormulaRefs` in `packages/xlsx-gateway/src/domain/formula-shift.ts`.
fn offset_formula_refs(formula: &str, row_delta: i64, col_delta: i64) -> String {
    if row_delta == 0 && col_delta == 0 {
        return formula.to_owned();
    }
    let bytes = formula.as_bytes();
    let mut out = String::with_capacity(formula.len() + 8);
    let mut i = 0;

    while i < bytes.len() {
        // String literal "..." (with "" escape)
        if bytes[i] == b'"' {
            let start = i;
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'"' {
                    if i + 1 < bytes.len() && bytes[i + 1] == b'"' {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            out.push_str(&formula[start..i]);
            continue;
        }
        // Structured reference Table1[...] following [A-Za-z0-9_.]
        if bytes[i] == b'['
            && i > 0
            && (bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_' || bytes[i - 1] == b'.')
        {
            let start = i;
            let mut depth = 0usize;
            while i < bytes.len() {
                if bytes[i] == b'[' {
                    depth += 1;
                } else if bytes[i] == b']' {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        i += 1;
                        break;
                    }
                }
                i += 1;
            }
            out.push_str(&formula[start..i]);
            continue;
        }

        // Check boundary before attempting to parse a cell ref or span.
        let prev_ok = i == 0
            || !matches!(
                bytes[i - 1],
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b'.' | b'$' | b'!' | b':'
            );
        if prev_ok {
            if let Some((replacement, consumed)) =
                try_offset_ref_at(&formula[i..], row_delta, col_delta)
            {
                out.push_str(&replacement);
                i += consumed;
                continue;
            }
        }
        let ch = formula[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn parse_sheet_prefix(s: &str) -> Option<(&str, usize)> {
    let b = s.as_bytes();
    if b.is_empty() {
        return None;
    }
    if b[0] == b'\'' {
        let mut i = 1;
        while i < b.len() {
            if b[i] == b'\'' {
                if i + 1 < b.len() && b[i + 1] == b'\'' {
                    i += 2;
                    continue;
                }
                if i + 1 < b.len() && b[i + 1] == b'!' {
                    return Some((&s[..i + 2], i + 2));
                }
                return None;
            }
            i += 1;
        }
        None
    } else {
        let mut i = 0;
        while i < b.len()
            && (b[i].is_ascii_alphanumeric() || b[i] == b'_' || b[i] == b'.')
        {
            i += 1;
        }
        if i > 0 && i < b.len() && b[i] == b'!' {
            Some((&s[..i + 1], i + 1))
        } else {
            None
        }
    }
}

fn parse_single_ref(s: &str) -> Option<(bool, usize, bool, i64, usize)> {
    let b = s.as_bytes();
    let mut i = 0;
    let col_abs = if i < b.len() && b[i] == b'$' {
        i += 1;
        true
    } else {
        false
    };
    let c_start = i;
    while i < b.len() && b[i].is_ascii_alphabetic() && i - c_start < 3 {
        i += 1;
    }
    if i == c_start || (i < b.len() && b[i].is_ascii_alphabetic()) {
        return None;
    }
    let col = column_index_from_ref(&s[c_start..i])?;
    let row_abs = if i < b.len() && b[i] == b'$' {
        i += 1;
        true
    } else {
        false
    };
    let r_start = i;
    while i < b.len() && b[i].is_ascii_digit() && i - r_start < 7 {
        i += 1;
    }
    if i == r_start || (i < b.len() && b[i].is_ascii_digit()) {
        return None;
    }
    let row = s[r_start..i].parse::<i64>().ok()? - 1;
    Some((col_abs, col, row_abs, row, i))
}

fn format_shifted_ref(
    col_abs: bool,
    col: usize,
    row_abs: bool,
    row: i64,
    row_delta: i64,
    col_delta: i64,
) -> Option<String> {
    let new_row = if row_abs { row } else { row + row_delta };
    let new_col = if col_abs {
        col as i64
    } else {
        (col as i64) + col_delta
    };
    if new_row < 0
        || new_row >= MAX_XLSX_ROWS
        || new_col < 0
        || new_col >= MAX_XLSX_COLS as i64
    {
        return None;
    }
    Some(format!(
        "{}{}{}{}",
        if col_abs { "$" } else { "" },
        column_label(new_col as usize),
        if row_abs { "$" } else { "" },
        new_row + 1
    ))
}

fn try_offset_ref_at(s: &str, row_delta: i64, col_delta: i64) -> Option<(String, usize)> {
    let (prefix, rest_start) = match parse_sheet_prefix(s) {
        Some((p, n)) => (p, n),
        None => ("", 0),
    };
    let rest = &s[rest_start..];
    if let Some((a_ca, a_c, a_ra, a_r, a_len)) = parse_single_ref(rest) {
        let mut total_len = rest_start + a_len;
        let second = if rest[a_len..].starts_with(':') {
            if let Some((b_ca, b_c, b_ra, b_r, b_len)) = parse_single_ref(&rest[a_len + 1..]) {
                total_len = rest_start + a_len + 1 + b_len;
                Some((b_ca, b_c, b_ra, b_r))
            } else {
                None
            }
        } else {
            None
        };
        let next_b = s.as_bytes().get(total_len).copied();
        if let Some(nb) = next_b {
            if nb.is_ascii_alphanumeric() || nb == b'(' {
                return None;
            }
        }
        let f1 = format_shifted_ref(a_ca, a_c, a_ra, a_r, row_delta, col_delta);
        if let Some((b_ca, b_c, b_ra, b_r)) = second {
            let f2 = format_shifted_ref(b_ca, b_c, b_ra, b_r, row_delta, col_delta);
            return match (f1, f2) {
                (Some(s1), Some(s2)) => Some((format!("{prefix}{s1}:{s2}"), total_len)),
                _ => Some((format!("{prefix}#REF!"), total_len)),
            };
        }
        return match f1 {
            Some(s1) => Some((format!("{prefix}{s1}"), total_len)),
            None => Some((format!("{prefix}#REF!"), total_len)),
        };
    }

    // Whole-column spans (B:D) when col_delta != 0
    if col_delta != 0 {
        if let Some((res, len)) = try_offset_col_span(rest, prefix, col_delta) {
            let total_len = rest_start + len;
            let next_b = s.as_bytes().get(total_len).copied();
            if !matches!(next_b, Some(b) if b.is_ascii_alphanumeric() || matches!(b, b'(' | b'$' | b'!' | b':')) {
                return Some((res, total_len));
            }
        }
    }

    // Whole-row spans (2:4) when row_delta != 0
    if row_delta != 0 {
        if let Some((res, len)) = try_offset_row_span(rest, prefix, row_delta) {
            let total_len = rest_start + len;
            let next_b = s.as_bytes().get(total_len).copied();
            if !matches!(next_b, Some(b) if b.is_ascii_alphanumeric() || matches!(b, b'(' | b'$' | b'!' | b':')) {
                return Some((res, total_len));
            }
        }
    }
    None
}

fn try_offset_col_span(rest: &str, prefix: &str, col_delta: i64) -> Option<(String, usize)> {
    let b = rest.as_bytes();
    let mut i = 0;
    let a_abs = if i < b.len() && b[i] == b'$' { i += 1; true } else { false };
    let a_start = i;
    while i < b.len() && b[i].is_ascii_alphabetic() && i - a_start < 3 { i += 1; }
    if i == a_start || i >= b.len() || b[i] != b':' { return None; }
    let a_col_str = &rest[a_start..i];
    i += 1;
    let b_abs = if i < b.len() && b[i] == b'$' { i += 1; true } else { false };
    let b_start = i;
    while i < b.len() && b[i].is_ascii_alphabetic() && i - b_start < 3 { i += 1; }
    if i == b_start || (i < b.len() && b[i].is_ascii_alphabetic()) { return None; }
    let b_col_str = &rest[b_start..i];

    let shift = |abs: bool, letters: &str| -> Option<String> {
        if abs {
            return Some(format!("${}", letters.to_ascii_uppercase()));
        }
        let shifted = (column_index_from_ref(letters)? as i64) + col_delta;
        if shifted < 0 || shifted >= MAX_XLSX_COLS as i64 {
            None
        } else {
            Some(column_label(shifted as usize))
        }
    };
    let s1 = shift(a_abs, a_col_str);
    let s2 = shift(b_abs, b_col_str);
    match (s1, s2) {
        (Some(c1), Some(c2)) => Some((format!("{prefix}{c1}:{c2}"), i)),
        _ => Some((format!("{prefix}#REF!"), i)),
    }
}

fn try_offset_row_span(rest: &str, prefix: &str, row_delta: i64) -> Option<(String, usize)> {
    let b = rest.as_bytes();
    let mut i = 0;
    let a_abs = if i < b.len() && b[i] == b'$' { i += 1; true } else { false };
    let a_start = i;
    while i < b.len() && b[i].is_ascii_digit() && i - a_start < 7 { i += 1; }
    if i == a_start || i >= b.len() || b[i] != b':' { return None; }
    let a_row_str = &rest[a_start..i];
    i += 1;
    let b_abs = if i < b.len() && b[i] == b'$' { i += 1; true } else { false };
    let b_start = i;
    while i < b.len() && b[i].is_ascii_digit() && i - b_start < 7 { i += 1; }
    if i == b_start || (i < b.len() && b[i].is_ascii_digit()) { return None; }
    let b_row_str = &rest[b_start..i];

    let shift = |abs: bool, digits: &str| -> Option<String> {
        if abs {
            return Some(format!("${digits}"));
        }
        let shifted = digits.parse::<i64>().ok()? - 1 + row_delta;
        if shifted < 0 || shifted >= MAX_XLSX_ROWS {
            None
        } else {
            Some((shifted + 1).to_string())
        }
    };
    let s1 = shift(a_abs, a_row_str);
    let s2 = shift(b_abs, b_row_str);
    match (s1, s2) {
        (Some(r1), Some(r2)) => Some((format!("{prefix}{r1}:{r2}"), i)),
        _ => Some((format!("{prefix}#REF!"), i)),
    }
}

fn shared_string_text(si: &XmlElement) -> String {
    let mut out = String::new();
    for child in si.child_elements() {
        if child.local == "t" {
            out.push_str(&decode_xlsx_escapes(&child.text_content()));
        } else if child.local == "r" {
            for t in child.children_local("t") {
                out.push_str(&decode_xlsx_escapes(&t.text_content()));
            }
        }
    }
    out
}

fn join_row_cells(cells: &[String]) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut run = 0usize;
    for cell in cells {
        if cell.is_empty() {
            run += 1;
            continue;
        }
        if run > MAX_EMPTY_RUN {
            out.push(format!("({run} empty)"));
        } else {
            for _ in 0..run {
                out.push(String::new());
            }
        }
        run = 0;
        out.push(cell.clone());
    }
    out.join(" | ")
}

fn sheet_xml_byte_limit(budget_chars: usize) -> usize {
    budget_chars
        .saturating_mul(XML_BYTES_PER_TEXT_CHAR)
        .saturating_add(XML_CLIP_SLACK)
}

fn clip_sheet_xml(xml: &str, budget_chars: usize, truncated: bool) -> String {
    let limit = sheet_xml_byte_limit(budget_chars);
    if !truncated && xml.len() <= limit {
        return xml.to_owned();
    }
    let mut cut = xml.len().min(limit);
    while cut > 0 && !xml.is_char_boundary(cut) {
        cut -= 1;
    }
    let head = &xml[..cut];
    // Find last `</...row>`
    let mut last_row_end: Option<(usize, usize, String)> = None;
    let mut search_from = 0;
    while let Some(pos) = head[search_from..].find("</") {
        let abs = search_from + pos;
        if let Some(gt_rel) = head[abs + 2..].find('>') {
            let tag = &head[abs + 2..abs + 2 + gt_rel];
            if tag == "row" {
                last_row_end = Some((abs, abs + 2 + gt_rel + 1, String::new()));
            } else if let Some(prefix) = tag.strip_suffix(":row") {
                last_row_end = Some((abs, abs + 2 + gt_rel + 1, format!("{prefix}:")));
            }
            search_from = abs + 2 + gt_rel + 1;
        } else {
            break;
        }
    }
    let data_at = head
        .find("<sheetData")
        .or_else(|| {
            head.find(":sheetData").and_then(|p| head[..p].rfind('<'))
        });
    let Some((row_start, row_end, ns)) = last_row_end else {
        return if truncated {
            EMPTY_SHEET_XML.to_owned()
        } else {
            xml.to_owned()
        };
    };
    let Some(data_idx) = data_at else {
        return if truncated {
            EMPTY_SHEET_XML.to_owned()
        } else {
            xml.to_owned()
        };
    };
    if row_start < data_idx {
        return if truncated {
            EMPTY_SHEET_XML.to_owned()
        } else {
            xml.to_owned()
        };
    }
    format!("{}</{ns}sheetData></{ns}worksheet>", &head[..row_end])
}

fn load_date_styles<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
    styles_path: &str,
) -> Result<HashMap<usize, DateFormatParts>, ZipGateError> {
    let mut styles = HashMap::new();
    let Some(xml) = zip.read_entry_string(styles_path)? else {
        return Ok(styles);
    };
    let Ok(roots) = parse_xml_tree(&xml, false) else {
        return Ok(styles);
    };
    let Some(sheet) = roots.iter().find(|r| r.local == "styleSheet") else {
        return Ok(styles);
    };
    let mut custom: HashMap<i64, Option<DateFormatParts>> = HashMap::new();
    if let Some(num_fmts) = sheet.first_child_local("numFmts") {
        for fmt in num_fmts.children_local("numFmt") {
            if let Some(id_str) = fmt.attr("numFmtId") {
                if let Ok(id) = id_str.trim().parse::<i64>() {
                    let code = fmt.attr("formatCode").unwrap_or("");
                    custom.insert(id, classify_format_code(code));
                }
            }
        }
    }
    if let Some(cell_xfs) = sheet.first_child_local("cellXfs") {
        for (index, xf) in cell_xfs.children_local("xf").enumerate() {
            let id = xf
                .attr("numFmtId")
                .and_then(|s| s.trim().parse::<i64>().ok())
                .unwrap_or(0);
            let parts = match custom.get(&id) {
                Some(&p) => p,
                None => builtin_date_format(id),
            };
            if let Some(p) = parts {
                styles.insert(index, p);
            }
        }
    }
    Ok(styles)
}

fn count_elements_named(nodes: &[XmlNode], local: &str) -> usize {
    let mut total = 0;
    for node in nodes {
        if let XmlNode::Element(el) = node {
            if el.local == local {
                total += 1;
            }
            total += count_elements_named(&el.children, local);
        }
    }
    total
}

fn count_drawing_pictures<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
    sheet_path: &str,
    drawing_el: &XmlElement,
) -> Result<usize, ZipGateError> {
    let rels_path = match sheet_path.rfind('/') {
        Some(slash) => format!(
            "{}/_rels/{}.rels",
            &sheet_path[..slash],
            &sheet_path[slash + 1..]
        ),
        None => format!("_rels/{sheet_path}.rels"),
    };
    let Some(rels_xml) = zip.read_entry_string(&rels_path)? else {
        return Ok(0);
    };
    let wanted = get_rel_id(&drawing_el.attrs).unwrap_or("").trim();
    for rel in parse_relationships(&rels_xml) {
        if rel.id != wanted {
            continue;
        }
        let target = resolve_target(sheet_path, &rel.target);
        if let Some(dxml) = zip.read_entry_string(&target)? {
            if let Ok(roots) = parse_xml_tree(&dxml, false) {
                let nodes: Vec<XmlNode> = roots.into_iter().map(XmlNode::Element).collect();
                return Ok(count_elements_named(&nodes, "pic"));
            }
        }
    }
    Ok(0)
}

/// Extracts readable sheet text from a verified XLSX/XLSM archive.
/// Matches `packages/file-parse/src/xlsx.ts`.
pub fn extract_xlsx<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
    max_chars: Option<usize>,
    cancelled: &AtomicBool,
) -> Result<String, ZipGateError> {
    if max_chars == Some(0) {
        return Ok(String::new());
    }

    let mut workbook_path = "xl/workbook.xml".to_owned();
    if let Some(pkg_rels) = zip.read_entry_string("_rels/.rels")? {
        for rel in parse_relationships(&pkg_rels) {
            if !rel.rel_type.ends_with("/officeDocument") || rel.external || rel.target.is_empty() {
                continue;
            }
            let resolved = resolve_target("", &rel.target);
            if !resolved.is_empty() {
                workbook_path = resolved;
                break;
            }
        }
    }
    let Some(workbook_xml) = zip.read_entry_string(&workbook_path)? else {
        return Err(ZipGateError::Corrupt(format!(
            "Invalid xlsx: missing {workbook_path}"
        )));
    };
    let wb_roots = parse_xml_tree(&workbook_xml, false).unwrap_or_default();
    let wb_el = wb_roots.iter().find(|r| r.local == "workbook");
    let date1904 = wb_el
        .and_then(|w| w.first_child_local("workbookPr"))
        .and_then(|pr| pr.attr("date1904"))
        .map(|v| {
            let t = v.trim();
            t == "1" || t.eq_ignore_ascii_case("true")
        })
        .unwrap_or(false);

    let mut sheets: Vec<(String, String)> = Vec::new();
    if let Some(sheets_el) = wb_el.and_then(|w| w.first_child_local("sheets")) {
        for sh in sheets_el.children_local("sheet") {
            let name = sh.attr("name").unwrap_or("").to_owned();
            let rid = get_rel_id(&sh.attrs).unwrap_or("").trim().to_owned();
            sheets.push((name, rid));
        }
    }

    let wb_rels_path = match workbook_path.rfind('/') {
        Some(slash) => format!(
            "{}/_rels/{}.rels",
            &workbook_path[..slash],
            &workbook_path[slash + 1..]
        ),
        None => format!("_rels/{workbook_path}.rels"),
    };
    let rels_xml = zip.read_entry_string(&wb_rels_path)?;
    let mut rel_targets: HashMap<String, String> = HashMap::new();
    let mut styles_path = resolve_target(&workbook_path, "styles.xml");
    let mut shared_strings_path = resolve_target(&workbook_path, "sharedStrings.xml");
    if let Some(ref rxml) = rels_xml {
        for rel in parse_relationships(rxml) {
            if rel.external {
                continue;
            }
            let resolved = if rel.target.is_empty() {
                String::new()
            } else {
                resolve_target(&workbook_path, &rel.target)
            };
            if !rel.id.is_empty() && !resolved.is_empty() {
                rel_targets.insert(rel.id, resolved.clone());
            }
            if !resolved.is_empty() {
                if rel.rel_type.ends_with("/styles") {
                    styles_path = resolved.clone();
                }
                if rel.rel_type.ends_with("/sharedStrings") {
                    shared_strings_path = resolved;
                }
            }
        }
    }

    let date_styles = load_date_styles(zip, &styles_path)?;
    let mut shared: Vec<String> = Vec::new();
    if let Some(sst_xml) = zip.read_entry_string(&shared_strings_path)? {
        if let Ok(roots) = parse_xml_tree(&sst_xml, false) {
            if let Some(sst) = roots.iter().find(|r| r.local == "sst") {
                for si in sst.children_local("si") {
                    shared.push(shared_string_text(si));
                }
            }
        }
    }

    let mut sections: Vec<String> = Vec::new();
    let mut sheets_with_data = 0usize;
    let mut image_only_sheets = 0usize;
    let mut used = 0usize;

    for (sheet_name, rid) in &sheets {
        if cancelled.load(Ordering::Acquire) {
            return Err(ZipGateError::Cancelled);
        }
        if let Some(limit) = max_chars {
            if used >= limit {
                break;
            }
        }
        let Some(path) = rel_targets.get(rid).cloned() else {
            continue;
        };
        let raw = if let Some(limit) = max_chars {
            let budget = limit.saturating_sub(used);
            zip.read_entry_prefix(&path, sheet_xml_byte_limit(budget))?
        } else {
            zip.read_entry_string(&path)?.map(|t| (t, false))
        };
        let Some((raw_text, truncated)) = raw else {
            continue;
        };
        if raw_text.is_empty() {
            continue;
        }
        let sheet_xml = if let Some(limit) = max_chars {
            clip_sheet_xml(&raw_text, limit.saturating_sub(used), truncated)
        } else {
            raw_text
        };

        let ws_roots = parse_xml_tree(&sheet_xml, false).unwrap_or_default();
        let ws_el = ws_roots.iter().find(|r| r.local == "worksheet");
        let header = format!("# {}", decode_xlsx_escapes(sheet_name));
        let mut sheet_chars = header.encode_utf16().count();
        let mut lines = vec![header];
        let mut has_data = false;

        let rows: Vec<&XmlElement> = ws_el
            .and_then(|w| w.first_child_local("sheetData"))
            .map(|sd| sd.children_local("row").collect())
            .unwrap_or_default();

        // Pass 1: record shared formula masters.
        let mut shared_formulas: HashMap<String, (String, Option<String>)> = HashMap::new();
        for row in &rows {
            for cell in row.children_local("c") {
                if let Some(f_el) = cell.first_child_local("f") {
                    if let Some(si) = f_el.attr("si").map(str::trim).filter(|s| !s.is_empty()) {
                        let own = f_el.text_content().trim().to_owned();
                        if !own.is_empty() {
                            shared_formulas.insert(
                                si.to_owned(),
                                (own, cell.attr("r").map(|s| s.trim().to_owned())),
                            );
                        }
                    }
                }
            }
        }

        // Pass 2: extract rows.
        for row in &rows {
            let mut slots: Vec<Option<Vec<String>>> = Vec::new();
            for cell in row.children_local("c") {
                let text = extract_cell_text(
                    cell,
                    &shared,
                    &date_styles,
                    date1904,
                    &shared_formulas,
                );
                let cell_ref = cell.attr("r").map(str::trim).unwrap_or("");
                let target = if !cell_ref.is_empty() {
                    match column_index_from_ref(cell_ref) {
                        Some(col) if col < MAX_XLSX_COLS => col,
                        _ => slots.len(),
                    }
                } else {
                    slots.len()
                };
                if target >= slots.len() {
                    slots.resize_with(target + 1, || None);
                }
                match slots[target].as_mut() {
                    None => slots[target] = Some(vec![text.clone()]),
                    Some(slot) => {
                        if slot.last().map(|s| s.is_empty()).unwrap_or(false) {
                            *slot.last_mut().unwrap() = text.clone();
                        } else {
                            slot.push(text.clone());
                        }
                    }
                }
                if !text.trim().is_empty() {
                    has_data = true;
                }
            }
            let mut cells: Vec<String> = Vec::new();
            for slot in slots {
                match slot {
                    None => cells.push(String::new()),
                    Some(vals) => {
                        for v in vals.into_iter().rev() {
                            cells.push(v);
                        }
                    }
                }
            }
            let line = join_row_cells(&cells);
            sheet_chars = sheet_chars.saturating_add(line.encode_utf16().count() + 1);
            lines.push(line);
            if let Some(limit) = max_chars {
                if used.saturating_add(sheet_chars) >= limit {
                    break;
                }
            }
        }

        used = used.saturating_add(sheet_chars);
        if has_data {
            sheets_with_data += 1;
        } else if let Some(drawing_el) = ws_el.and_then(|w| w.first_child_local("drawing")) {
            image_only_sheets += 1;
            let pictures = count_drawing_pictures(zip, &path, drawing_el)?;
            lines.push(if pictures > 0 {
                format!(
                    "[image-only sheet: {pictures} image{}, no cell data]",
                    if pictures == 1 { "" } else { "s" }
                )
            } else {
                "[image-only sheet: a drawing but no cell data]".to_owned()
            });
        }
        sections.push(lines.join("\n"));
    }

    if !sheets.is_empty() && sections.is_empty() {
        let n = sheets.len();
        let plural = if n == 1 { "" } else { "s" };
        let msg = if rels_xml.is_none() {
            format!(
                "Invalid xlsx: {wb_rels_path} is missing, so none of the {n} declared sheet{plural} can be resolved"
            )
        } else {
            format!(
                "Invalid xlsx: no sheet relationship in {wb_rels_path} resolves to a readable worksheet part ({n} declared)"
            )
        };
        return Err(ZipGateError::Corrupt(msg));
    }

    let body = sections.join("\n\n");
    if sheets_with_data > 0 || image_only_sheets == 0 {
        return Ok(body);
    }
    let n = sections.len();
    Ok(format!(
        "[No extractable text: none of the {n} sheet{} holds cell data; the content is in embedded images, which this extraction does not read.]\n\n{body}",
        if n == 1 { "" } else { "s" }
    ))
}

fn extract_cell_text(
    cell: &XmlElement,
    shared: &[String],
    dates: &HashMap<usize, DateFormatParts>,
    date1904: bool,
    shared_formulas: &HashMap<String, (String, Option<String>)>,
) -> String {
    let cell_type = cell.attr("t").map(str::trim).unwrap_or("");
    if cell_type == "inlineStr" {
        return cell
            .first_child_local("is")
            .map(shared_string_text)
            .unwrap_or_default();
    }
    let v_text = cell
        .first_child_local("v")
        .map(XmlElement::text_content)
        .unwrap_or_default();
    if let Some(f_el) = cell.first_child_local("f") {
        if v_text.trim().is_empty() {
            let own = f_el.text_content().trim().to_owned();
            let si = f_el.attr("si").map(str::trim);
            let master = si.and_then(|id| shared_formulas.get(id));
            let mut text = if !own.is_empty() {
                own
            } else if let Some((formula, _)) = master {
                formula.clone()
            } else {
                String::new()
            };
            if f_el.text_content().trim().is_empty() {
                if let (Some((master_formula, Some(master_ref))), Some(cell_ref)) =
                    (master, cell.attr("r").map(str::trim))
                {
                    if let (Some((sr, sc)), Some((tr, tc))) =
                        (parse_a1_address(master_ref), parse_a1_address(cell_ref))
                    {
                        text = offset_formula_refs(master_formula, tr - sr, tc - sc);
                    }
                }
            }
            return if text.is_empty() {
                String::new()
            } else {
                format!("={text}")
            };
        }
    }

    if cell_type.is_empty() || cell_type == "n" {
        let style_idx = cell
            .attr("s")
            .and_then(|s| s.trim().parse::<usize>().ok())
            .unwrap_or(0);
        if let Some(&parts) = dates.get(&style_idx) {
            let trimmed = v_text.trim();
            if !trimmed.is_empty() {
                if let Ok(serial) = trimmed.parse::<f64>() {
                    if let Some(rendered) = format_serial(serial, parts, date1904) {
                        return rendered;
                    }
                }
            }
        }
    }

    if cell_type == "s" {
        let trimmed = v_text.trim();
        if trimmed.is_empty() {
            return String::new();
        }
        return match trimmed.parse::<usize>() {
            Ok(idx) => shared.get(idx).cloned().unwrap_or_default(),
            Err(_) => String::new(),
        };
    }

    if cell_type == "b" {
        let token = v_text.trim();
        return if token == "1" || token.eq_ignore_ascii_case("true") {
            "TRUE".to_owned()
        } else {
            "FALSE".to_owned()
        };
    }

    if cell_type == "str" {
        return decode_xlsx_escapes(&v_text);
    }

    v_text
}
