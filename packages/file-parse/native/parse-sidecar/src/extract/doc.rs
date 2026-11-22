use std::io::{Read, Seek};
use std::sync::atomic::{AtomicBool, Ordering};

use encoding_rs::WINDOWS_1252;

use crate::extract::ole::{MAX_OLE_STREAM_BYTES, OleError, open_ole};
use crate::tokenize::truncate_utf16_units;

/// FibBase.wIdent for Word 97-2003 binary documents.
const FIB_IDENT: u16 = 0xA5EC;
/// Oldest supported format version (Word 97).
const MIN_SUPPORTED_NFIB: u16 = 0x00C1;
/// Newest Word 97-2003 binary format version.
const MAX_SUPPORTED_NFIB: u16 = 0x0112;
const FIB_BASE_BYTES: usize = 32;

const FLAG_ENCRYPTED: u16 = 0x0100;
const FLAG_WHICH_TABLE_STREAM: u16 = 0x0200;

/// FibRgLw97 dword indices.
const LW_CCP_TEXT: usize = 3;
const LW_CCP_FTN: usize = 4;
const LW_CCP_HDD: usize = 5;
const LW_CCP_ATN: usize = 7;
const LW_CCP_EDN: usize = 8;
const LW_CCP_TXBX: usize = 9;

/// FibRgFcLcb97 pair indices.
const PAIR_PLCFBTE_CHPX: usize = 12;
const PAIR_PLCFBTE_PAPX: usize = 13;
const PAIR_CLX: usize = 33;
const MIN_PAIR_COUNT: usize = 34;

/// CLX record tags.
const CLX_PRC: u8 = 0x01;
const CLX_PCDT: u8 = 0x02;

const CP_BYTES: usize = 4;
const PCD_BYTES: usize = 8;
const FC_COMPRESSED: u32 = 0x4000_0000;
const FC_OFFSET_MASK: u32 = 0x3FFF_FFFF;
const FC_RESERVED: u32 = 0x8000_0000;

/// SPRM opcodes mirrored from word-extractor / MS-DOC.
const SPRM_CF_RMARK_DEL: u16 = 0x0800;
const SPRM_PF_TTP: u16 = 0x2417;
const SPRM_T_DEF_TABLE: u16 = 0xD608;
const SPRM_P_CHG_TABS: u16 = 0xC615;

/// Defensive bounds against pathological piece tables.
const MAX_PRC_RECORDS: usize = 65_536;
const MAX_PIECES: usize = 1_000_000;
const MAX_DECODED_UTF16_UNITS: usize = 64 * 1024 * 1024;
const FKP_PAGE_BYTES: usize = 512;

#[derive(Debug, Clone, Copy)]
struct FibPair {
    fc: usize,
    lcb: usize,
}

#[derive(Debug)]
struct FibInfo {
    table_stream: &'static str,
    ccp_text: u32,
    ccp_ftn: u32,
    ccp_hdd: u32,
    ccp_atn: u32,
    ccp_edn: u32,
    ccp_txbx: u32,
    clx: FibPair,
    plcfbte_chpx: FibPair,
    plcfbte_papx: FibPair,
}

#[derive(Debug, Clone)]
struct Piece {
    cp_start: u32,
    cp_end: u32,
    file_pos_start: usize,
    file_pos_end: usize,
    compressed: bool,
    units: Vec<u16>,
}

fn read_u16_le(buf: &[u8], offset: usize, what: &str) -> Result<u16, OleError> {
    let end = offset
        .checked_add(2)
        .ok_or_else(|| OleError::Corrupt(format!("corrupt .doc: offset overflow at {what}")))?;
    let slice = buf
        .get(offset..end)
        .ok_or_else(|| OleError::Corrupt(format!("corrupt .doc: truncated before {what}")))?;
    Ok(u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_u32_le(buf: &[u8], offset: usize, what: &str) -> Result<u32, OleError> {
    let end = offset
        .checked_add(4)
        .ok_or_else(|| OleError::Corrupt(format!("corrupt .doc: offset overflow at {what}")))?;
    let slice = buf
        .get(offset..end)
        .ok_or_else(|| OleError::Corrupt(format!("corrupt .doc: truncated before {what}")))?;
    Ok(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn check_slice(buf: &[u8], offset: usize, len: usize, what: &str) -> Result<(), OleError> {
    let end = offset
        .checked_add(len)
        .ok_or_else(|| OleError::Corrupt(format!("corrupt .doc: length overflow at {what}")))?;
    if end > buf.len() {
        return Err(OleError::Corrupt(format!(
            "corrupt .doc: {what} range ({offset}+{len}) exceeds stream length ({})",
            buf.len()
        )));
    }
    Ok(())
}

fn parse_fib(word_doc: &[u8]) -> Result<FibInfo, OleError> {
    if word_doc.len() < FIB_BASE_BYTES {
        return Err(OleError::Corrupt(format!(
            "corrupt .doc: WordDocument stream ({} bytes) is shorter than 32-byte FibBase",
            word_doc.len()
        )));
    }

    let w_ident = read_u16_le(word_doc, 0, "FibBase.wIdent")?;
    if w_ident != FIB_IDENT {
        return Err(OleError::Corrupt(format!(
            "corrupt .doc: invalid Word magic 0x{w_ident:04x} (expected 0x{FIB_IDENT:04x})"
        )));
    }

    let n_fib = read_u16_le(word_doc, 2, "FibBase.nFib")?;
    if n_fib < MIN_SUPPORTED_NFIB {
        return Err(OleError::Corrupt(format!(
            "unsupported legacy .doc format: nFib 0x{n_fib:04x} is older than Word 97"
        )));
    }
    if n_fib > MAX_SUPPORTED_NFIB {
        return Err(OleError::Corrupt(format!(
            "unsupported .doc binary version: nFib 0x{n_fib:04x}"
        )));
    }

    let flags = read_u16_le(word_doc, 10, "FibBase.flags")?;
    if (flags & FLAG_ENCRYPTED) != 0 {
        return Err(OleError::PasswordProtected(
            "Password-protected .doc: open it in its editor with the password, or remove the password and attach it again".to_owned(),
        ));
    }

    let table_stream = if (flags & FLAG_WHICH_TABLE_STREAM) != 0 {
        "/1Table"
    } else {
        "/0Table"
    };

    // FibRgW97
    let mut offset = FIB_BASE_BYTES;
    let csw = read_u16_le(word_doc, offset, "Fib.csw")? as usize;
    offset += 2;
    let w_bytes = csw
        .checked_mul(2)
        .ok_or_else(|| OleError::Corrupt("corrupt .doc: FibRgW97 size overflow".to_owned()))?;
    check_slice(word_doc, offset, w_bytes, "FibRgW97")?;
    offset += w_bytes;

    // FibRgLw97
    let cslw = read_u16_le(word_doc, offset, "Fib.cslw")? as usize;
    offset += 2;
    if cslw <= LW_CCP_TEXT {
        return Err(OleError::Corrupt(format!(
            "corrupt .doc: FibRgLw97 has {cslw} dwords, missing ccpText"
        )));
    }
    let lw_bytes = cslw
        .checked_mul(4)
        .ok_or_else(|| OleError::Corrupt("corrupt .doc: FibRgLw97 size overflow".to_owned()))?;
    check_slice(word_doc, offset, lw_bytes, "FibRgLw97")?;
    let lw_start = offset;
    let lw = |idx: usize| -> u32 {
        if idx < cslw {
            read_u32_le(word_doc, lw_start + idx * 4, "FibRgLw97").unwrap_or(0)
        } else {
            0
        }
    };
    let ccp_text = lw(LW_CCP_TEXT);
    let ccp_ftn = lw(LW_CCP_FTN);
    let ccp_hdd = lw(LW_CCP_HDD);
    let ccp_atn = lw(LW_CCP_ATN);
    let ccp_edn = lw(LW_CCP_EDN);
    let ccp_txbx = lw(LW_CCP_TXBX);
    offset += lw_bytes;

    // FibRgFcLcb97
    let pair_count = read_u16_le(word_doc, offset, "Fib.cbRgFcLcb")? as usize;
    offset += 2;
    if pair_count < MIN_PAIR_COUNT {
        return Err(OleError::Corrupt(format!(
            "corrupt .doc: FibRgFcLcb has {pair_count} pairs (minimum {MIN_PAIR_COUNT})"
        )));
    }
    let pairs_bytes = pair_count
        .checked_mul(8)
        .ok_or_else(|| OleError::Corrupt("corrupt .doc: FibRgFcLcb size overflow".to_owned()))?;
    check_slice(word_doc, offset, pairs_bytes, "FibRgFcLcb")?;
    let pairs_start = offset;

    let read_pair = |idx: usize| -> Result<FibPair, OleError> {
        let base = pairs_start + idx * 8;
        let fc = read_u32_le(word_doc, base, "FibPair.fc")? as usize;
        let lcb = read_u32_le(word_doc, base + 4, "FibPair.lcb")? as usize;
        Ok(FibPair { fc, lcb })
    };

    let clx = read_pair(PAIR_CLX)?;
    if clx.lcb == 0 {
        return Err(OleError::Corrupt(
            "corrupt .doc: missing CLX piece table (lcbClx is 0)".to_owned(),
        ));
    }
    let plcfbte_chpx = read_pair(PAIR_PLCFBTE_CHPX)?;
    let plcfbte_papx = read_pair(PAIR_PLCFBTE_PAPX)?;

    Ok(FibInfo {
        table_stream,
        ccp_text,
        ccp_ftn,
        ccp_hdd,
        ccp_atn,
        ccp_edn,
        ccp_txbx,
        clx,
        plcfbte_chpx,
        plcfbte_papx,
    })
}

fn decode_cp1252_to_utf16(bytes: &[u8]) -> Vec<u16> {
    let (decoded, _) = WINDOWS_1252.decode_without_bom_handling(bytes);
    decoded.encode_utf16().collect()
}

fn decode_utf16le_units(bytes: &[u8]) -> Vec<u16> {
    let mut units = Vec::with_capacity(bytes.len() / 2);
    for pair in bytes.chunks_exact(2) {
        units.push(u16::from_le_bytes([pair[0], pair[1]]));
    }
    units
}

fn parse_clx_pieces(
    table: &[u8],
    word_doc: &[u8],
    fib: &FibInfo,
    cancelled: &AtomicBool,
) -> Result<(Vec<Piece>, u32), OleError> {
    if fib.clx.lcb < CP_BYTES + 1 {
        return Err(OleError::Corrupt(format!(
            "corrupt .doc: CLX length {} is too small",
            fib.clx.lcb
        )));
    }
    check_slice(table, fib.clx.fc, fib.clx.lcb, "CLX")?;

    let end = fib.clx.fc + fib.clx.lcb;
    let mut offset = fib.clx.fc;
    let mut plc_start: Option<usize> = None;
    let mut plc_len: usize = 0;
    let mut prc_count: usize = 0;

    while offset < end {
        if cancelled.load(Ordering::Acquire) {
            return Err(OleError::Cancelled);
        }
        let kind = table[offset];
        match kind {
            CLX_PRC => {
                prc_count += 1;
                if prc_count > MAX_PRC_RECORDS {
                    return Err(OleError::Corrupt(
                        "corrupt .doc: excessive Prc records in CLX".to_owned(),
                    ));
                }
                if offset + 3 > end {
                    return Err(OleError::Corrupt(
                        "corrupt .doc: truncated Prc record header in CLX".to_owned(),
                    ));
                }
                let cb = read_u16_le(table, offset + 1, "Prc.cbGrpprl")? as usize;
                let next = offset
                    .checked_add(3)
                    .and_then(|v| v.checked_add(cb))
                    .ok_or_else(|| {
                        OleError::Corrupt("corrupt .doc: Prc record overflow".to_owned())
                    })?;
                if next > end {
                    return Err(OleError::Corrupt(
                        "corrupt .doc: Prc record extends past CLX".to_owned(),
                    ));
                }
                offset = next;
            }
            CLX_PCDT => {
                if offset + 5 > end {
                    return Err(OleError::Corrupt(
                        "corrupt .doc: truncated Pcdt header in CLX".to_owned(),
                    ));
                }
                let lcb = read_u32_le(table, offset + 1, "Pcdt.lcb")? as usize;
                let payload_start = offset + 5;
                if lcb > end - payload_start {
                    return Err(OleError::Corrupt(
                        "corrupt .doc: Pcdt payload extends past CLX".to_owned(),
                    ));
                }
                plc_start = Some(payload_start);
                plc_len = lcb;
                break;
            }
            other => {
                return Err(OleError::Corrupt(format!(
                    "corrupt .doc: unknown CLX record type 0x{other:02x}"
                )));
            }
        }
    }

    let Some(plc_start) = plc_start else {
        return Err(OleError::Corrupt(
            "corrupt .doc: CLX contains no Pcdt piece table".to_owned(),
        ));
    };

    if plc_len < CP_BYTES || (plc_len - CP_BYTES) % (CP_BYTES + PCD_BYTES) != 0 {
        return Err(OleError::Corrupt(format!(
            "corrupt .doc: invalid PlcPcd length {plc_len}"
        )));
    }

    let piece_count = (plc_len - CP_BYTES) / (CP_BYTES + PCD_BYTES);
    if piece_count > MAX_PIECES {
        return Err(OleError::Corrupt(format!(
            "corrupt .doc: piece table count {piece_count} exceeds limit"
        )));
    }
    if piece_count == 0 {
        if fib.ccp_text > 0 {
            return Err(OleError::Corrupt(
                "corrupt .doc: empty piece table with non-zero ccpText".to_owned(),
            ));
        }
        return Ok((Vec::new(), 0));
    }

    let mut cps = Vec::with_capacity(piece_count + 1);
    for i in 0..=piece_count {
        cps.push(read_u32_le(table, plc_start + i * CP_BYTES, "PlcPcd.cp")?);
    }
    if cps[0] != 0 {
        return Err(OleError::Corrupt(format!(
            "corrupt .doc: piece table first CP is {}, expected 0",
            cps[0]
        )));
    }
    for i in 1..=piece_count {
        if cps[i] <= cps[i - 1] {
            return Err(OleError::Corrupt(format!(
                "corrupt .doc: piece table CPs are not strictly increasing ({} -> {})",
                cps[i - 1],
                cps[i]
            )));
        }
    }

    let total_cp = cps[piece_count];
    if total_cp < fib.ccp_text {
        return Err(OleError::Corrupt(format!(
            "corrupt .doc: piece table ends at CP {total_cp}, before ccpText {}",
            fib.ccp_text
        )));
    }

    // Validate textbox story bounds when ccpTxbx is non-zero.
    let txbx_range = textbox_cp_range(fib)?;
    if let Some((_, txbx_end_incl_marker)) = txbx_range {
        if txbx_end_incl_marker > total_cp {
            return Err(OleError::Corrupt(format!(
                "corrupt .doc: textbox story end CP {txbx_end_incl_marker} exceeds piece table end {total_cp}"
            )));
        }
    }

    let needed_cp_end = match txbx_range {
        Some((_, end)) => end.max(fib.ccp_text),
        None => fib.ccp_text,
    };

    let pcds_start = plc_start + (piece_count + 1) * CP_BYTES;
    let mut pieces = Vec::with_capacity(piece_count);
    let mut total_units: usize = 0;

    for i in 0..piece_count {
        if (i & 0xFF) == 0 && cancelled.load(Ordering::Acquire) {
            return Err(OleError::Cancelled);
        }
        let pcd_start = pcds_start + i * PCD_BYTES;
        let fc_raw = read_u32_le(table, pcd_start + 2, "Pcd.fc")?;
        if (fc_raw & FC_RESERVED) != 0 {
            return Err(OleError::Corrupt(format!(
                "corrupt .doc: piece {i} has reserved fc bit 31 set"
            )));
        }
        let compressed = (fc_raw & FC_COMPRESSED) != 0;
        let masked = fc_raw & FC_OFFSET_MASK;
        if compressed && (masked & 1) != 0 {
            return Err(OleError::Corrupt(format!(
                "corrupt .doc: compressed piece {i} has odd byte offset"
            )));
        }
        let file_pos_start = if compressed {
            (masked / 2) as usize
        } else {
            masked as usize
        };
        let cp_start = cps[i];
        let cp_end = cps[i + 1];
        let chars = (cp_end - cp_start) as usize;
        let bpc = if compressed { 1usize } else { 2usize };
        let byte_len = chars
            .checked_mul(bpc)
            .ok_or_else(|| OleError::Corrupt(format!("corrupt .doc: piece {i} byte length overflow")))?;
        let file_pos_end = file_pos_start
            .checked_add(byte_len)
            .ok_or_else(|| OleError::Corrupt(format!("corrupt .doc: piece {i} offset overflow")))?;
        if file_pos_end > word_doc.len() {
            return Err(OleError::Corrupt(format!(
                "corrupt .doc: piece {i} range ({file_pos_start}+{byte_len}) exceeds WordDocument stream ({})",
                word_doc.len()
            )));
        }

        // Only materialize UTF-16 units for pieces needed by body/textbox stories,
        // while still validating every piece's range above.
        let units = if cp_start < needed_cp_end {
            total_units = total_units
                .checked_add(chars)
                .ok_or_else(|| OleError::Corrupt("corrupt .doc: decoded character count overflow".to_owned()))?;
            if total_units > MAX_DECODED_UTF16_UNITS {
                return Err(OleError::Corrupt(
                    "corrupt .doc: decoded character count exceeds safety limit".to_owned(),
                ));
            }
            let slice = &word_doc[file_pos_start..file_pos_end];
            if compressed {
                decode_cp1252_to_utf16(slice)
            } else {
                decode_utf16le_units(slice)
            }
        } else {
            Vec::new()
        };

        pieces.push(Piece {
            cp_start,
            cp_end,
            file_pos_start,
            file_pos_end,
            compressed,
            units,
        });
    }

    Ok((pieces, total_cp))
}

/// Returns `Some((txbx_start, txbx_end_with_marker))` when `ccpTxbx > 0`.
fn textbox_cp_range(fib: &FibInfo) -> Result<Option<(u32, u32)>, OleError> {
    if fib.ccp_txbx == 0 {
        return Ok(None);
    }
    let start = fib
        .ccp_text
        .checked_add(fib.ccp_ftn)
        .and_then(|v| v.checked_add(fib.ccp_hdd))
        .and_then(|v| v.checked_add(fib.ccp_atn))
        .and_then(|v| v.checked_add(fib.ccp_edn))
        .ok_or_else(|| OleError::Corrupt("corrupt .doc: story CP count overflow".to_owned()))?;
    let end = start
        .checked_add(fib.ccp_txbx)
        .ok_or_else(|| OleError::Corrupt("corrupt .doc: textbox CP range overflow".to_owned()))?;
    Ok(Some((start, end)))
}

fn walk_sprms<F: FnMut(u16, &[u8])>(grpprl: &[u8], mut on_sprm: F) {
    let mut offset = 0usize;
    while offset + 2 <= grpprl.len() {
        let sprm = u16::from_le_bytes([grpprl[offset], grpprl[offset + 1]]);
        offset += 2;
        let spra = (sprm >> 13) & 0x07;
        let operand_len = match spra {
            0 | 1 => 1usize,
            2 | 4 | 5 => 2usize,
            3 => 4usize,
            7 => 3usize,
            6 => {
                if sprm == SPRM_T_DEF_TABLE {
                    if offset + 2 > grpprl.len() {
                        break;
                    }
                    let cb = u16::from_le_bytes([grpprl[offset], grpprl[offset + 1]]) as usize;
                    let total = cb.saturating_add(1);
                    if offset + total > grpprl.len() {
                        break;
                    }
                    on_sprm(sprm, &grpprl[offset..offset + total]);
                    offset += total;
                    continue;
                }
                if offset >= grpprl.len() {
                    break;
                }
                let cb = grpprl[offset] as usize;
                if sprm == SPRM_P_CHG_TABS && cb == 255 {
                    // Variable-length tab change array (MS-DOC 2.6.2); bail safely if malformed.
                    if offset + 2 > grpprl.len() {
                        break;
                    }
                    let itbd_del = grpprl[offset + 1] as usize;
                    let add_off = offset + 2 + itbd_del.saturating_mul(4);
                    if add_off >= grpprl.len() {
                        break;
                    }
                    let itbd_add = grpprl[add_off] as usize;
                    let end = add_off + 1 + itbd_add.saturating_mul(3);
                    if end > grpprl.len() {
                        break;
                    }
                    on_sprm(sprm, &grpprl[offset..end]);
                    offset = end;
                    continue;
                }
                let total = cb + 1;
                if offset + total > grpprl.len() {
                    break;
                }
                on_sprm(sprm, &grpprl[offset..offset + total]);
                offset += total;
                continue;
            }
            _ => break,
        };
        if offset + operand_len > grpprl.len() {
            break;
        }
        on_sprm(sprm, &grpprl[offset..offset + operand_len]);
        offset += operand_len;
    }
}

fn fill_pieces_by_file_pos(pieces: &mut [Piece], start_fp: usize, end_fp: usize, replacement: u16) {
    if end_fp <= start_fp {
        return;
    }
    for piece in pieces.iter_mut() {
        if piece.units.is_empty() {
            continue;
        }
        let lo = start_fp.max(piece.file_pos_start);
        let hi = end_fp.min(piece.file_pos_end);
        if hi <= lo {
            continue;
        }
        let bpc = if piece.compressed { 1usize } else { 2usize };
        let idx_start = (lo - piece.file_pos_start) / bpc;
        let idx_end = ((hi - piece.file_pos_start) / bpc).min(piece.units.len());
        if idx_start < idx_end {
            for unit in &mut piece.units[idx_start..idx_end] {
                *unit = replacement;
            }
        }
    }
}

/// Applies tracked-change deletions (`sprmCFRMarkDel`, 0x0800) from `PlcfbteChpx`.
fn apply_chpx_deletions(
    word_doc: &[u8],
    table: &[u8],
    pair: FibPair,
    pieces: &mut [Piece],
    cancelled: &AtomicBool,
) -> Result<(), OleError> {
    if pair.lcb < 12 || (pair.lcb - 4) % 8 != 0 {
        return Ok(());
    }
    let Some(end) = pair.fc.checked_add(pair.lcb) else {
        return Ok(());
    };
    if end > table.len() {
        return Ok(());
    }
    let count = (pair.lcb - 4) / 8;
    let data_offset = pair.fc + (count + 1) * 4;

    for i in 0..count {
        if (i & 0x3F) == 0 && cancelled.load(Ordering::Acquire) {
            return Err(OleError::Cancelled);
        }
        let Ok(pn) = read_u32_le(table, data_offset + i * 4, "PlcfbteChpx.pn") else {
            break;
        };
        let Some(page_start) = (pn as usize).checked_mul(FKP_PAGE_BYTES) else {
            continue;
        };
        let Some(page_end) = page_start.checked_add(FKP_PAGE_BYTES) else {
            continue;
        };
        let Some(page) = word_doc.get(page_start..page_end) else {
            continue;
        };
        let crun = page[511] as usize;
        if (crun + 1) * 4 + crun > 511 {
            continue;
        }
        for j in 0..crun {
            let rgfc = u32::from_le_bytes([
                page[j * 4],
                page[j * 4 + 1],
                page[j * 4 + 2],
                page[j * 4 + 3],
            ]) as usize;
            let rgfc_next = u32::from_le_bytes([
                page[(j + 1) * 4],
                page[(j + 1) * 4 + 1],
                page[(j + 1) * 4 + 2],
                page[(j + 1) * 4 + 3],
            ]) as usize;
            let rgb = page[(crun + 1) * 4 + j] as usize;
            if rgb == 0 {
                continue;
            }
            let chpx_off = rgb * 2;
            if chpx_off >= 511 {
                continue;
            }
            let cb = page[chpx_off] as usize;
            let Some(grpprl_end) = chpx_off.checked_add(1).and_then(|v| v.checked_add(cb)) else {
                continue;
            };
            if grpprl_end > 511 {
                continue;
            }
            let grpprl = &page[chpx_off + 1..grpprl_end];
            let mut is_deleted = false;
            walk_sprms(grpprl, |sprm, operand| {
                if sprm == SPRM_CF_RMARK_DEL && !operand.is_empty() && (operand[0] & 1) == 1 {
                    is_deleted = true;
                }
            });
            if is_deleted {
                fill_pieces_by_file_pos(pieces, rgfc, rgfc_next, 0x0000);
            }
        }
    }
    Ok(())
}

/// Applies table-row end markers (`sprmPFTtp`, 0x2417) from `PlcfbtePapx` as `\n`,
/// matching `word-extractor`'s `writeParagraphProperties`.
fn apply_papx_table_row_breaks(
    word_doc: &[u8],
    table: &[u8],
    pair: FibPair,
    pieces: &mut [Piece],
    cancelled: &AtomicBool,
) -> Result<(), OleError> {
    if pair.lcb < 12 || (pair.lcb - 4) % 8 != 0 {
        return Ok(());
    }
    let Some(end) = pair.fc.checked_add(pair.lcb) else {
        return Ok(());
    };
    if end > table.len() {
        return Ok(());
    }
    let count = (pair.lcb - 4) / 8;
    let data_offset = pair.fc + (count + 1) * 4;

    for i in 0..count {
        if (i & 0x3F) == 0 && cancelled.load(Ordering::Acquire) {
            return Err(OleError::Cancelled);
        }
        let Ok(pn) = read_u32_le(table, data_offset + i * 4, "PlcfbtePapx.pn") else {
            break;
        };
        let Some(page_start) = (pn as usize).checked_mul(FKP_PAGE_BYTES) else {
            continue;
        };
        let Some(page_end) = page_start.checked_add(FKP_PAGE_BYTES) else {
            continue;
        };
        let Some(page) = word_doc.get(page_start..page_end) else {
            continue;
        };
        let crun = page[511] as usize;
        if (crun + 1) * 4 + crun * 13 > 511 {
            continue;
        }
        for j in 0..crun {
            let rgfc = u32::from_le_bytes([
                page[j * 4],
                page[j * 4 + 1],
                page[j * 4 + 2],
                page[j * 4 + 3],
            ]) as usize;
            let rgfc_next = u32::from_le_bytes([
                page[(j + 1) * 4],
                page[(j + 1) * 4 + 1],
                page[(j + 1) * 4 + 2],
                page[(j + 1) * 4 + 3],
            ]) as usize;
            let bx_off = (crun + 1) * 4 + j * 13;
            let b_offset = (page[bx_off] as usize) * 2;
            if b_offset == 0 || b_offset >= 511 {
                continue;
            }
            let cb = page[b_offset] as usize;
            let grpprl_and_istd = if cb != 0 {
                let len = cb * 2 - 1;
                let Some(slice_end) = b_offset.checked_add(1).and_then(|v| v.checked_add(len)) else {
                    continue;
                };
                if slice_end > 511 {
                    continue;
                }
                &page[b_offset + 1..slice_end]
            } else {
                if b_offset + 2 > 511 {
                    continue;
                }
                let cb2 = page[b_offset + 1] as usize;
                let len = cb2 * 2;
                let Some(slice_end) = b_offset.checked_add(2).and_then(|v| v.checked_add(len)) else {
                    continue;
                };
                if slice_end > 511 {
                    continue;
                }
                &page[b_offset + 2..slice_end]
            };
            if grpprl_and_istd.len() < 2 {
                continue;
            }
            let mut is_ttp = false;
            walk_sprms(&grpprl_and_istd[2..], |sprm, _| {
                if sprm == SPRM_PF_TTP {
                    is_ttp = true;
                }
            });
            if is_ttp {
                fill_pieces_by_file_pos(pieces, rgfc, rgfc_next, b'\n' as u16);
            }
        }
    }
    Ok(())
}

fn extract_cp_range(pieces: &[Piece], start_cp: u32, end_cp: u32) -> String {
    if end_cp <= start_cp {
        return String::new();
    }
    let mut units = Vec::new();
    for piece in pieces {
        if piece.cp_end <= start_cp {
            continue;
        }
        if piece.cp_start >= end_cp {
            break;
        }
        if piece.units.is_empty() {
            continue;
        }
        let lo = (start_cp.max(piece.cp_start) - piece.cp_start) as usize;
        let hi = ((end_cp.min(piece.cp_end) - piece.cp_start) as usize).min(piece.units.len());
        if lo < hi {
            units.extend_from_slice(&piece.units[lo..hi]);
        }
    }
    String::from_utf16_lossy(&units)
}

/// Cleans raw Word control characters and unwraps nested field codes
/// (`\x13 instruction \x14 result \x15` -> `result`) in O(n) time,
/// matching `word-extractor/lib/filters.js` with `filterUnicode: false`.
fn clean_word_text(raw: &str) -> String {
    // 1. Replace Word control characters.
    let mut mapped = String::with_capacity(raw.len());
    for ch in raw.chars() {
        match ch {
            '\u{0002}' | '\u{0005}' | '\u{0008}' | '\u{001F}' => mapped.push('\0'),
            '\u{0007}' => mapped.push('\t'),
            '\u{000A}' | '\u{000B}' | '\u{000C}' | '\u{000D}' => mapped.push('\n'),
            '\u{001E}' => mapped.push('\u{2011}'),
            other => mapped.push(other),
        }
    }

    // 2. Unwrap nested Word fields (\x13 ... (\x14 result)? \x15).
    struct FieldFrame {
        out_start: usize,
        result_start: Option<usize>,
    }
    let mut unwrapped = String::with_capacity(mapped.len());
    let mut stack: Vec<FieldFrame> = Vec::new();
    for ch in mapped.chars() {
        match ch {
            '\u{0013}' => {
                stack.push(FieldFrame {
                    out_start: unwrapped.len(),
                    result_start: None,
                });
                unwrapped.push('\u{0013}');
            }
            '\u{0014}' => {
                if let Some(top) = stack.last_mut() {
                    if top.result_start.is_none() {
                        top.result_start = Some(unwrapped.len() + 1);
                    }
                }
                unwrapped.push('\u{0014}');
            }
            '\u{0015}' => {
                if let Some(frame) = stack.pop() {
                    let result = match frame.result_start {
                        Some(rs) if rs <= unwrapped.len() => unwrapped[rs..].to_owned(),
                        _ => String::new(),
                    };
                    unwrapped.truncate(frame.out_start);
                    unwrapped.push_str(&result);
                } else {
                    unwrapped.push('\u{0015}');
                }
            }
            other => unwrapped.push(other),
        }
    }

    // 3. Drop residual C0 control characters \x00-\x07.
    let mut out = String::with_capacity(unwrapped.len());
    for ch in unwrapped.chars() {
        if (ch as u32) <= 0x07 {
            continue;
        }
        out.push(ch);
    }
    out
}

fn normalize_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
            out.push('\n');
        } else {
            out.push(ch);
        }
    }
    out.trim().to_owned()
}

/// Extracts body and body-textbox text (excluding headers/footers) from a Word
/// 97-2003 OLE2 `.doc` file, matching `packages/file-parse/src/doc.ts`.
pub fn extract_doc<R: Read + Seek>(
    reader: R,
    max_chars: Option<usize>,
    cancelled: &AtomicBool,
) -> Result<String, OleError> {
    if cancelled.load(Ordering::Acquire) {
        return Err(OleError::Cancelled);
    }
    let mut comp = open_ole(reader, cancelled)?;

    let Some(word_doc_path) = comp.resolve_stream_path("/WordDocument") else {
        if comp.has_stream_ci("/EncryptedPackage") {
            return Err(OleError::PasswordProtected(
                "Password-protected .doc: open it in its editor with the password, or remove the password and attach it again".to_owned(),
            ));
        }
        return Err(OleError::Corrupt(
            "corrupt .doc: missing WordDocument stream".to_owned(),
        ));
    };

    let word_doc = comp.read_stream_capped(&word_doc_path, MAX_OLE_STREAM_BYTES, cancelled)?;
    let fib = parse_fib(&word_doc)?;

    let Some(table_path) = comp.resolve_stream_path(fib.table_stream) else {
        return Err(OleError::Corrupt(format!(
            "corrupt .doc: missing {} stream",
            fib.table_stream.trim_start_matches('/')
        )));
    };
    let table = comp.read_stream_capped(&table_path, MAX_OLE_STREAM_BYTES, cancelled)?;

    let (mut pieces, _total_cp) = parse_clx_pieces(&table, &word_doc, &fib, cancelled)?;

    if max_chars == Some(0) {
        return Ok(String::new());
    }

    apply_chpx_deletions(&word_doc, &table, fib.plcfbte_chpx, &mut pieces, cancelled)?;
    apply_papx_table_row_breaks(&word_doc, &table, fib.plcfbte_papx, &mut pieces, cancelled)?;

    let body = clean_word_text(&extract_cp_range(&pieces, 0, fib.ccp_text));
    let textboxes = match textbox_cp_range(&fib)? {
        Some((start, end_incl)) if end_incl > start + 1 => {
            clean_word_text(&extract_cp_range(&pieces, start, end_incl - 1))
        }
        _ => String::new(),
    };

    let mut parts = Vec::new();
    if !body.trim().is_empty() {
        parts.push(body);
    }
    if !textboxes.trim().is_empty() {
        parts.push(textboxes);
    }
    let joined = normalize_text(&parts.join("\n"));

    if let Some(limit) = max_chars {
        Ok(truncate_utf16_units(&joined, limit).to_owned())
    } else {
        Ok(joined)
    }
}
