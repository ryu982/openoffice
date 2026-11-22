fn has_uri_scheme(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.is_empty() || !bytes[0].is_ascii_alphabetic() {
        return false;
    }
    for &b in &bytes[1..] {
        if b == b':' {
            return true;
        }
        if !(b.is_ascii_alphanumeric() || b == b'+' || b == b'.' || b == b'-') {
            return false;
        }
    }
    false
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Strict UTF-8 percent-decoding matching JavaScript `decodeURIComponent`.
/// Returns `None` on malformed `%` escapes or invalid UTF-8 sequences.
pub fn percent_decode_strict(input: &str) -> Option<String> {
    if !input.as_bytes().contains(&b'%') {
        return Some(input.to_owned());
    }
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return None;
            }
            let hi = hex_val(bytes[i + 1])?;
            let lo = hex_val(bytes[i + 2])?;
            out.push((hi << 4) | lo);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Resolves an OPC relationship target against the part that owns the `.rels`.
/// Matches `packages/file-parse/src/opc.ts` `resolveTarget`.
pub fn resolve_target(base_part: &str, target: &str) -> String {
    if has_uri_scheme(target) {
        return String::new();
    }
    let Some(decoded) = percent_decode_strict(target) else {
        return String::new();
    };
    let normalized = decoded.replace('\\', "/");
    let mut parts: Vec<&str> = if normalized.starts_with('/') {
        Vec::new()
    } else {
        match base_part.rfind('/') {
            Some(slash) => base_part[..slash]
                .split('/')
                .filter(|s| !s.is_empty())
                .collect(),
            None => Vec::new(),
        }
    };

    for seg in normalized.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            parts.pop();
        } else {
            parts.push(seg);
        }
    }
    parts.join("/")
}

/// Collapses `.`, `..`, and empty segments; `..` clamps at the ZIP root.
/// Matches `packages/epub-engine/src/paths.ts` `normalizeZipPath`.
pub fn normalize_zip_path(path: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            out.pop();
        } else {
            out.push(seg);
        }
    }
    out.join("/")
}

/// Resolves an EPUB href against `base_path`, returning `None` if it has a URL
/// scheme or is protocol-relative (`//` or `\\`).
/// Matches `packages/epub-engine/src/paths.ts` `resolveHref`.
pub fn resolve_epub_href(base_path: &str, href: &str) -> Option<String> {
    let trimmed = href.trim();
    if has_uri_scheme(trimmed)
        || trimmed.starts_with("//")
        || trimmed.starts_with("\\\\")
        || trimmed.starts_with("/\\")
        || trimmed.starts_with("\\/")
    {
        return None;
    }
    let before_hash = match trimmed.find('#') {
        Some(idx) => &trimmed[..idx],
        None => trimmed,
    };
    let raw_path = match before_hash.find('?') {
        Some(idx) => &before_hash[..idx],
        None => before_hash,
    };
    if raw_path.is_empty() {
        return Some(normalize_zip_path(base_path));
    }
    let decoded = percent_decode_strict(raw_path).unwrap_or_else(|| raw_path.to_owned());
    let joined = if decoded.starts_with('/') {
        decoded
    } else {
        let dir = match base_path.rfind('/') {
            Some(slash) => &base_path[..=slash],
            None => "",
        };
        format!("{dir}{decoded}")
    };
    Some(normalize_zip_path(&joined))
}
