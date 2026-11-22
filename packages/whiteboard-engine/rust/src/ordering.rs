//! Base-62 fractional order keys for deterministic page and object stacking order.

const ALPHABET: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const MIN_CHAR: u8 = ALPHABET[0];
const MID_CHAR: u8 = ALPHABET[31]; // 'V'
const MAX_CHAR: u8 = ALPHABET[61];

fn digit_index(ch: u8) -> Option<usize> {
    match ch {
        b'0'..=b'9' => Some((ch - b'0') as usize),
        b'A'..=b'Z' => Some(10 + (ch - b'A') as usize),
        b'a'..=b'z' => Some(36 + (ch - b'a') as usize),
        _ => None,
    }
}

pub fn is_valid_order_key(key: &str) -> bool {
    !key.is_empty() && key.bytes().all(|b| digit_index(b).is_some())
}

pub fn initial_order_key() -> String {
    (MID_CHAR as char).to_string()
}

/// Computes a base-62 key strictly between `before` and `after` in lexicographic order.
pub fn order_between(before: Option<&str>, after: Option<&str>) -> String {
    let a = before.unwrap_or("").as_bytes();
    let b = after.unwrap_or("").as_bytes();

    // If both are empty, return midpoint.
    if a.is_empty() && b.is_empty() {
        return initial_order_key();
    }

    // If inputs are inverted or equal, fall back to appending after `before`.
    if !a.is_empty() && !b.is_empty() && a >= b {
        let mut s = String::from_utf8_lossy(a).into_owned();
        s.push(MID_CHAR as char);
        return s;
    }

    let mut out = Vec::new();
    let max_len = a.len().max(b.len());
    for i in 0..=max_len {
        let lo = if i < a.len() {
            digit_index(a[i]).unwrap_or(0)
        } else {
            0
        };
        let hi = if i < b.len() {
            digit_index(b[i]).unwrap_or(61)
        } else {
            62
        };

        if lo + 1 < hi {
            let mid = (lo + hi) / 2;
            out.push(ALPHABET[mid]);
            return String::from_utf8(out).unwrap_or_else(|_| initial_order_key());
        }

        // Equal or adjacent digits: copy `lo` and continue to a finer digit.
        if i < a.len() {
            out.push(ALPHABET[lo]);
        } else if !b.is_empty() {
            out.push(MIN_CHAR);
        } else {
            // `after` is None and `before` ended with MAX_CHAR: append midpoint.
            out.push(MID_CHAR);
            return String::from_utf8(out).unwrap_or_else(|_| initial_order_key());
        }
    }

    // Guarantee strictly greater than `a` when `b` is longer prefix-equal.
    if let Some(&last) = out.last() {
        if last == MAX_CHAR {
            out.push(MID_CHAR);
        } else {
            out.push(MID_CHAR);
        }
    } else {
        out.push(MID_CHAR);
    }
    String::from_utf8(out).unwrap_or_else(|_| initial_order_key())
}

/// Generates `count` strictly ascending order keys between `before` and `after`.
pub fn order_keys_between(before: Option<&str>, after: Option<&str>, count: usize) -> Vec<String> {
    let mut keys = Vec::with_capacity(count);
    let mut prev = before.map(ToOwned::to_owned);
    for _ in 0..count {
        let next = order_between(prev.as_deref(), after);
        prev = Some(next.clone());
        keys.push(next);
    }
    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_strictly_ordered_keys() {
        let k1 = initial_order_key();
        let k2 = order_between(Some(&k1), None);
        let k0 = order_between(None, Some(&k1));
        let k_mid = order_between(Some(&k0), Some(&k1));
        assert!(k0 < k_mid);
        assert!(k_mid < k1);
        assert!(k1 < k2);
        assert!(is_valid_order_key(&k_mid));
    }

    #[test]
    fn generates_many_sequential_keys_without_collision() {
        let keys = order_keys_between(None, None, 200);
        for pair in keys.windows(2) {
            assert!(pair[0] < pair[1], "expected {} < {}", pair[0], pair[1]);
        }
        // Bisect repeatedly between adjacent keys.
        let mut lo = "0".to_string();
        let hi = "1".to_string();
        for _ in 0..40 {
            let mid = order_between(Some(&lo), Some(&hi));
            assert!(lo < mid && mid < hi, "failed: {lo} < {mid} < {hi}");
            lo = mid;
        }
    }
}
