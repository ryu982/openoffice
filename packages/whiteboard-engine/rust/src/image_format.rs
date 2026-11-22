//! Magic-byte image format detection and header dimension parsing.
//! Strictly allows PNG, JPEG, GIF, and WebP (1..=100_000 px). Never trusts extensions or MIME hints.

use serde::{Deserialize, Serialize};

pub const MAX_IMAGE_DIMENSION: u32 = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImageMime {
    #[serde(rename = "image/png")]
    Png,
    #[serde(rename = "image/jpeg")]
    Jpeg,
    #[serde(rename = "image/gif")]
    Gif,
    #[serde(rename = "image/webp")]
    Webp,
}

impl ImageMime {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::Gif => "gif",
            Self::Webp => "webp",
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Gif => "image/gif",
            Self::Webp => "image/webp",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageHeader {
    pub mime: ImageMime,
    pub width: u32,
    pub height: u32,
}

fn valid_dims(w: u32, h: u32) -> bool {
    (1..=MAX_IMAGE_DIMENSION).contains(&w) && (1..=MAX_IMAGE_DIMENSION).contains(&h)
}

fn u16_be(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*b.get(o)?, *b.get(o + 1)?]))
}

fn u16_le(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_le_bytes([*b.get(o)?, *b.get(o + 1)?]))
}

fn u32_be(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_be_bytes([
        *b.get(o)?,
        *b.get(o + 1)?,
        *b.get(o + 2)?,
        *b.get(o + 3)?,
    ]))
}

fn u32_le(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes([
        *b.get(o)?,
        *b.get(o + 1)?,
        *b.get(o + 2)?,
        *b.get(o + 3)?,
    ]))
}

fn parse_png(bytes: &[u8]) -> Option<ImageHeader> {
    if bytes.len() < 24 || &bytes[0..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let width = u32_be(bytes, 16)?;
    let height = u32_be(bytes, 20)?;
    valid_dims(width, height).then_some(ImageHeader {
        mime: ImageMime::Png,
        width,
        height,
    })
}

fn parse_gif(bytes: &[u8]) -> Option<ImageHeader> {
    if bytes.len() < 10 || (&bytes[0..6] != b"GIF87a" && &bytes[0..6] != b"GIF89a") {
        return None;
    }
    let width = u32::from(u16_le(bytes, 6)?);
    let height = u32::from(u16_le(bytes, 8)?);
    valid_dims(width, height).then_some(ImageHeader {
        mime: ImageMime::Gif,
        width,
        height,
    })
}

fn parse_exif_orientation(exif: &[u8]) -> Option<u16> {
    if exif.len() < 14 || &exif[0..6] != b"Exif\0\0" {
        return None;
    }
    let tiff = &exif[6..];
    let little = match &tiff[0..2] {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let read_u16 = |o: usize| -> Option<u16> {
        if little {
            u16_le(tiff, o)
        } else {
            u16_be(tiff, o)
        }
    };
    let read_u32 = |o: usize| -> Option<u32> {
        if little {
            u32_le(tiff, o)
        } else {
            u32_be(tiff, o)
        }
    };
    if read_u16(2)? != 42 {
        return None;
    }
    let ifd_offset = read_u32(4)? as usize;
    let count = read_u16(ifd_offset)? as usize;
    for i in 0..count {
        let entry = ifd_offset + 2 + i * 12;
        if entry + 12 > tiff.len() {
            break;
        }
        if read_u16(entry)? == 0x0112 {
            return read_u16(entry + 8);
        }
    }
    None
}

fn parse_jpeg(bytes: &[u8]) -> Option<ImageHeader> {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return None;
    }
    let mut pos = 2usize;
    let mut orientation: u16 = 1;
    while pos + 4 <= bytes.len() {
        while pos < bytes.len() && bytes[pos] != 0xFF {
            pos += 1;
        }
        while pos < bytes.len() && bytes[pos] == 0xFF {
            pos += 1;
        }
        if pos >= bytes.len() {
            break;
        }
        let marker = bytes[pos];
        pos += 1;
        if marker == 0xD9 || marker == 0xDA {
            break;
        }
        if (0xD0..=0xD8).contains(&marker) || marker == 0x01 {
            continue;
        }
        let seg_len = u16_be(bytes, pos)? as usize;
        if seg_len < 2 || pos + seg_len > bytes.len() {
            return None;
        }
        if marker == 0xE1 {
            if let Some(o) = parse_exif_orientation(&bytes[pos + 2..pos + seg_len]) {
                orientation = o;
            }
        } else if matches!(
            marker,
            0xC0 | 0xC1 | 0xC2 | 0xC3 | 0xC5 | 0xC6 | 0xC7 | 0xC9 | 0xCA | 0xCB | 0xCD | 0xCE | 0xCF
        ) {
            if seg_len < 7 {
                return None;
            }
            let h = u32::from(u16_be(bytes, pos + 3)?);
            let w = u32::from(u16_be(bytes, pos + 5)?);
            let (width, height) = if (5..=8).contains(&orientation) {
                (h, w)
            } else {
                (w, h)
            };
            return valid_dims(width, height).then_some(ImageHeader {
                mime: ImageMime::Jpeg,
                width,
                height,
            });
        }
        pos += seg_len;
    }
    None
}

fn parse_webp(bytes: &[u8]) -> Option<ImageHeader> {
    if bytes.len() < 30 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    let chunk = &bytes[12..16];
    let (width, height) = match chunk {
        b"VP8X" => {
            let w = 1 + (u32::from(bytes[24])
                | (u32::from(bytes[25]) << 8)
                | (u32::from(bytes[26]) << 16));
            let h = 1 + (u32::from(bytes[27])
                | (u32::from(bytes[28]) << 8)
                | (u32::from(bytes[29]) << 16));
            (w, h)
        }
        b"VP8 " => {
            if bytes[23] != 0x9D || bytes[24] != 0x01 || bytes[25] != 0x2A {
                return None;
            }
            let w = u32::from(u16_le(bytes, 26)? & 0x3FFF);
            let h = u32::from(u16_le(bytes, 28)? & 0x3FFF);
            (w, h)
        }
        b"VP8L" => {
            if bytes[20] != 0x2F {
                return None;
            }
            let bits = u32_le(bytes, 21)?;
            let w = (bits & 0x3FFF) + 1;
            let h = ((bits >> 14) & 0x3FFF) + 1;
            (w, h)
        }
        _ => return None,
    };
    valid_dims(width, height).then_some(ImageHeader {
        mime: ImageMime::Webp,
        width,
        height,
    })
}

/// Reads an image header strictly from magic bytes. Returns `None` for SVG or corrupt inputs.
pub fn read_image_header(bytes: &[u8]) -> Option<ImageHeader> {
    parse_png(bytes)
        .or_else(|| parse_jpeg(bytes))
        .or_else(|| parse_gif(bytes))
        .or_else(|| parse_webp(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniffs_png_gif_and_rejects_svg() {
        let mut png = Vec::new();
        png.extend_from_slice(b"\x89PNG\r\n\x1a\n");
        png.extend_from_slice(&13u32.to_be_bytes());
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&320u32.to_be_bytes());
        png.extend_from_slice(&240u32.to_be_bytes());
        png.extend_from_slice(&[8, 6, 0, 0, 0]);
        let h = read_image_header(&png).unwrap();
        assert_eq!(
            h,
            ImageHeader {
                mime: ImageMime::Png,
                width: 320,
                height: 240
            }
        );

        let gif = b"GIF89a\x40\x00\x20\x00";
        let gh = read_image_header(gif).unwrap();
        assert_eq!(gh.mime, ImageMime::Gif);
        assert_eq!((gh.width, gh.height), (64, 32));

        assert!(read_image_header(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>").is_none());
    }

    #[test]
    fn sniffs_jpeg_with_exif_rotation_swap() {
        let mut jpg = vec![0xFF, 0xD8];
        // APP1 Exif with Orientation = 6 (90 deg CW -> swap w/h)
        let mut exif = Vec::new();
        exif.extend_from_slice(b"Exif\0\0");
        exif.extend_from_slice(b"MM");
        exif.extend_from_slice(&42u16.to_be_bytes());
        exif.extend_from_slice(&8u32.to_be_bytes());
        exif.extend_from_slice(&1u16.to_be_bytes()); // 1 IFD entry
        exif.extend_from_slice(&0x0112u16.to_be_bytes()); // Orientation
        exif.extend_from_slice(&3u16.to_be_bytes()); // SHORT
        exif.extend_from_slice(&1u32.to_be_bytes()); // count
        exif.extend_from_slice(&6u16.to_be_bytes()); // value = 6
        exif.extend_from_slice(&0u16.to_be_bytes());
        jpg.push(0xFF);
        jpg.push(0xE1);
        jpg.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        jpg.extend_from_slice(&exif);
        // SOF0: height=400, width=800
        jpg.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x0B, 0x08]);
        jpg.extend_from_slice(&400u16.to_be_bytes());
        jpg.extend_from_slice(&800u16.to_be_bytes());
        jpg.extend_from_slice(&[0x01, 0x01, 0x11, 0x00]);
        jpg.extend_from_slice(&[0xFF, 0xD9]);
        let h = read_image_header(&jpg).unwrap();
        assert_eq!(h.mime, ImageMime::Jpeg);
        assert_eq!((h.width, h.height), (400, 800));
    }
}
