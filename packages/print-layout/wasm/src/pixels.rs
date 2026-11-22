use crc32fast::Hasher;

const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/// Converts BGRx bitmap rows with a row stride into tightly packed 8-bit gray
/// (Rec. 601 fixed-point luma, matching JS `(r*77 + g*150 + b*29 + 128) >> 8`)
/// or RGB rows.
pub fn convert_bgrx_pixels(
    bgrx: &[u8],
    stride: usize,
    width: u32,
    height: u32,
    grayscale: bool,
) -> Result<Vec<u8>, String> {
    let w = width as usize;
    let h = height as usize;
    if w == 0 || h == 0 {
        return Err(format!("invalid bitmap size {width}x{height}"));
    }
    let min_stride = w
        .checked_mul(4)
        .ok_or_else(|| "bitmap width overflow".to_string())?;
    if stride < min_stride {
        return Err(format!("bitmap stride {stride} smaller than row width {min_stride}"));
    }
    let min_len = (h - 1)
        .checked_mul(stride)
        .and_then(|v| v.checked_add(min_stride))
        .ok_or_else(|| "bitmap size overflow".to_string())?;
    if bgrx.len() < min_len {
        return Err("bitmap buffer is too short".to_string());
    }

    let channels: usize = if grayscale { 1 } else { 3 };
    let out_len = w
        .checked_mul(h)
        .and_then(|v| v.checked_mul(channels))
        .ok_or_else(|| "output pixel buffer overflow".to_string())?;
    let mut out = vec![0u8; out_len];

    if grayscale {
        for y in 0..h {
            let src_row = &bgrx[y * stride..y * stride + min_stride];
            let dst_row = &mut out[y * w..(y + 1) * w];
            for (dst, px) in dst_row.iter_mut().zip(src_row.chunks_exact(4)) {
                let b = px[0] as u32;
                let g = px[1] as u32;
                let r = px[2] as u32;
                *dst = ((r * 77 + g * 150 + b * 29 + 128) >> 8) as u8;
            }
        }
    } else {
        let row_bytes = w * 3;
        for y in 0..h {
            let src_row = &bgrx[y * stride..y * stride + min_stride];
            let dst_row = &mut out[y * row_bytes..(y + 1) * row_bytes];
            for (dst, px) in dst_row.chunks_exact_mut(3).zip(src_row.chunks_exact(4)) {
                dst[0] = px[2];
                dst[1] = px[1];
                dst[2] = px[0];
            }
        }
    }

    Ok(out)
}

fn write_chunk(out: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(chunk_type);
    out.extend_from_slice(data);
    let mut hasher = Hasher::new();
    hasher.update(chunk_type);
    hasher.update(data);
    out.extend_from_slice(&hasher.finalize().to_be_bytes());
}

fn finish_png(width: u32, height: u32, channels: u8, filtered: &[u8]) -> Vec<u8> {
    let mut ihdr = [0u8; 13];
    ihdr[0..4].copy_from_slice(&width.to_be_bytes());
    ihdr[4..8].copy_from_slice(&height.to_be_bytes());
    ihdr[8] = 8; // bit depth
    ihdr[9] = if channels == 1 { 0 } else { 2 }; // gray or truecolor
    ihdr[10] = 0; // deflate
    ihdr[11] = 0; // adaptive filtering
    ihdr[12] = 0; // no interlace

    let idat = fdeflate::compress_to_vec(filtered);

    let mut out = Vec::with_capacity(8 + (12 + 13) + (12 + idat.len()) + 12);
    out.extend_from_slice(&PNG_SIGNATURE);
    write_chunk(&mut out, b"IHDR", &ihdr);
    write_chunk(&mut out, b"IDAT", &idat);
    write_chunk(&mut out, b"IEND", &[]);
    out
}

/// Encodes tightly packed 8-bit gray (channels=1) or RGB (channels=3) pixels
/// into a PNG image using the Up row filter and fdeflate zlib compression.
pub fn encode_png(
    pixels: &[u8],
    width: u32,
    height: u32,
    channels: u8,
) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 {
        return Err(format!("invalid PNG size {width}x{height}"));
    }
    if channels != 1 && channels != 3 {
        return Err(format!("invalid PNG channel count {channels}"));
    }
    let w = width as usize;
    let h = height as usize;
    let row_bytes = w
        .checked_mul(channels as usize)
        .ok_or_else(|| "PNG row size overflow".to_string())?;
    let expected = row_bytes
        .checked_mul(h)
        .ok_or_else(|| "PNG buffer size overflow".to_string())?;
    if pixels.len() < expected {
        return Err("PNG pixel buffer is too short".to_string());
    }

    let stride_out = row_bytes + 1;
    let filtered_len = stride_out
        .checked_mul(h)
        .ok_or_else(|| "PNG filtered buffer overflow".to_string())?;
    let mut filtered = vec![0u8; filtered_len];

    // Row 0: Up filter against implicit zero row.
    filtered[0] = 2;
    filtered[1..stride_out].copy_from_slice(&pixels[0..row_bytes]);

    for y in 1..h {
        let dst = &mut filtered[y * stride_out..(y + 1) * stride_out];
        dst[0] = 2;
        let cur = &pixels[y * row_bytes..(y + 1) * row_bytes];
        let prev = &pixels[(y - 1) * row_bytes..y * row_bytes];
        let dst_pixels = &mut dst[1..];
        for i in 0..row_bytes {
            dst_pixels[i] = cur[i].wrapping_sub(prev[i]);
        }
    }

    Ok(finish_png(width, height, channels, &filtered))
}

/// Fused BGRx-to-PNG encoder: converts each row from BGRx to gray or RGB and
/// applies the PNG Up filter directly using two small row scratch buffers,
/// avoiding a full intermediate RGB/gray pixel allocation.
pub fn encode_bgrx_to_png(
    bgrx: &[u8],
    stride: usize,
    width: u32,
    height: u32,
    grayscale: bool,
) -> Result<Vec<u8>, String> {
    let w = width as usize;
    let h = height as usize;
    if w == 0 || h == 0 {
        return Err(format!("invalid PNG size {width}x{height}"));
    }
    let min_stride = w
        .checked_mul(4)
        .ok_or_else(|| "bitmap width overflow".to_string())?;
    if stride < min_stride {
        return Err(format!("bitmap stride {stride} smaller than row width {min_stride}"));
    }
    let min_len = (h - 1)
        .checked_mul(stride)
        .and_then(|v| v.checked_add(min_stride))
        .ok_or_else(|| "bitmap size overflow".to_string())?;
    if bgrx.len() < min_len {
        return Err("bitmap buffer is too short".to_string());
    }

    let channels: u8 = if grayscale { 1 } else { 3 };
    let row_bytes = w
        .checked_mul(channels as usize)
        .ok_or_else(|| "PNG row size overflow".to_string())?;
    let stride_out = row_bytes + 1;
    let filtered_len = stride_out
        .checked_mul(h)
        .ok_or_else(|| "PNG filtered buffer overflow".to_string())?;
    let mut filtered = vec![0u8; filtered_len];
    let mut prev_row = vec![0u8; row_bytes];
    let mut cur_row = vec![0u8; row_bytes];

    for y in 0..h {
        let src_row = &bgrx[y * stride..y * stride + min_stride];
        if grayscale {
            for (dst, px) in cur_row.iter_mut().zip(src_row.chunks_exact(4)) {
                let b = px[0] as u32;
                let g = px[1] as u32;
                let r = px[2] as u32;
                *dst = ((r * 77 + g * 150 + b * 29 + 128) >> 8) as u8;
            }
        } else {
            for (dst, px) in cur_row.chunks_exact_mut(3).zip(src_row.chunks_exact(4)) {
                dst[0] = px[2];
                dst[1] = px[1];
                dst[2] = px[0];
            }
        }

        let dst = &mut filtered[y * stride_out..(y + 1) * stride_out];
        dst[0] = 2;
        if y == 0 {
            dst[1..].copy_from_slice(&cur_row);
        } else {
            let dst_pixels = &mut dst[1..];
            for i in 0..row_bytes {
                dst_pixels[i] = cur_row[i].wrapping_sub(prev_row[i]);
            }
        }
        std::mem::swap(&mut prev_row, &mut cur_row);
    }

    Ok(finish_png(width, height, channels, &filtered))
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::read::ZlibDecoder;
    use std::io::Read;

    fn decode_idat(png: &[u8]) -> (u32, u32, u8, Vec<u8>) {
        assert_eq!(&png[0..8], &PNG_SIGNATURE);
        let mut pos = 8;
        let mut w = 0u32;
        let mut h = 0u32;
        let mut ct = 0u8;
        let mut idat = Vec::new();
        while pos < png.len() {
            let len = u32::from_be_bytes(png[pos..pos + 4].try_into().unwrap()) as usize;
            let ctype = &png[pos + 4..pos + 8];
            let data = &png[pos + 8..pos + 8 + len];
            let stored_crc =
                u32::from_be_bytes(png[pos + 8 + len..pos + 12 + len].try_into().unwrap());
            let mut hasher = Hasher::new();
            hasher.update(ctype);
            hasher.update(data);
            assert_eq!(hasher.finalize(), stored_crc);
            if ctype == b"IHDR" {
                w = u32::from_be_bytes(data[0..4].try_into().unwrap());
                h = u32::from_be_bytes(data[4..8].try_into().unwrap());
                assert_eq!(data[8], 8);
                ct = data[9];
            } else if ctype == b"IDAT" {
                idat.extend_from_slice(data);
            }
            pos += 12 + len;
        }
        let mut dec = ZlibDecoder::new(idat.as_slice());
        let mut raw = Vec::new();
        dec.read_to_end(&mut raw).unwrap();
        let ch = if ct == 0 { 1 } else { 3 };
        let row_bytes = (w as usize) * ch;
        let mut pixels = vec![0u8; row_bytes * (h as usize)];
        for y in 0..(h as usize) {
            assert_eq!(raw[y * (row_bytes + 1)], 2);
            for i in 0..row_bytes {
                let x = raw[y * (row_bytes + 1) + 1 + i];
                let above = if y == 0 { 0 } else { pixels[(y - 1) * row_bytes + i] };
                pixels[y * row_bytes + i] = x.wrapping_add(above);
            }
        }
        (w, h, ch as u8, pixels)
    }

    #[test]
    fn bgrx_to_gray_and_rgb_matches_formula() {
        // 2x2 BGRx with stride=12 (4 bytes padding per row)
        let bgrx = [
            0, 0, 255, 255, // pure red
            255, 255, 255, 255, // pure white
            99, 99, 99, 99, // padding
            255, 0, 0, 255, // pure blue
            0, 255, 0, 255, // pure green
            88, 88, 88, 88, // padding
        ];
        let gray = convert_bgrx_pixels(&bgrx, 12, 2, 2, true).unwrap();
        assert_eq!(
            gray,
            vec![
                ((255u32 * 77 + 128) >> 8) as u8,
                255,
                ((255u32 * 29 + 128) >> 8) as u8,
                ((255u32 * 150 + 128) >> 8) as u8,
            ]
        );
        let rgb = convert_bgrx_pixels(&bgrx, 12, 2, 2, false).unwrap();
        assert_eq!(rgb, vec![255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 255, 0]);
    }

    #[test]
    fn encode_png_and_fused_bgrx_roundtrip_identically() {
        let bgrx = [
            10, 20, 30, 255, 40, 50, 60, 255, 0, 0, 0, 0, // row 0 + pad
            70, 80, 90, 255, 255, 255, 255, 255, 0, 0, 0, 0, // row 1 + pad
        ];
        for gray in [false, true] {
            let pixels = convert_bgrx_pixels(&bgrx, 12, 2, 2, gray).unwrap();
            let png1 = encode_png(&pixels, 2, 2, if gray { 1 } else { 3 }).unwrap();
            let png2 = encode_bgrx_to_png(&bgrx, 12, 2, 2, gray).unwrap();
            assert_eq!(png1, png2);
            let (w, h, ch, decoded) = decode_idat(&png1);
            assert_eq!((w, h, ch), (2, 2, if gray { 1 } else { 3 }));
            assert_eq!(decoded, pixels);
        }
    }
}
