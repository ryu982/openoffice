use std::fmt::Write as _;
use std::io::Write as _;

use flate2::Compression;
use flate2::write::ZlibEncoder;

use crate::pixels::convert_bgrx_pixels;

/// Formats a PDF real number cleanly without scientific notation.
pub(crate) fn format_pdf_num(v: f64) -> String {
    if !v.is_finite() || v.abs() < 1e-9 {
        return "0".to_string();
    }
    let rounded = v.round();
    if (v - rounded).abs() < 1e-9 && rounded.abs() < 1e15 {
        return format!("{}", rounded as i64);
    }
    let mut s = format!("{v:.6}");
    while s.ends_with('0') {
        s.pop();
    }
    if s.ends_with('.') {
        s.pop();
    }
    if s == "-0" {
        return "0".to_string();
    }
    s
}

/// Streaming builder for a DeviceGray image-only PDF. Each face's compressed
/// image XObject, content stream, and page dictionary are appended immediately
/// to the output buffer so uncompressed face bitmaps are never accumulated.
pub struct GrayPdfBuilderImpl {
    buf: Vec<u8>,
    /// 1-based object offsets; object 1 is Catalog, object 2 is Pages root.
    offsets: Vec<usize>,
    page_ids: Vec<u32>,
    next_id: u32,
}

impl GrayPdfBuilderImpl {
    pub fn new() -> Self {
        let mut buf = Vec::with_capacity(64 * 1024);
        buf.extend_from_slice(b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");
        // Reserve object IDs 1 (Catalog) and 2 (Pages).
        Self {
            buf,
            offsets: vec![0, 0, 0],
            page_ids: Vec::new(),
            next_id: 3,
        }
    }

    fn alloc_id(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        self.offsets.push(0);
        id
    }

    fn write_object(&mut self, id: u32, body: &[u8]) {
        self.offsets[id as usize] = self.buf.len();
        let _ = write!(&mut self.buf, "{id} 0 obj\n");
        self.buf.extend_from_slice(body);
        self.buf.extend_from_slice(b"\nendobj\n");
    }

    /// Compresses an 8-bit grayscale face and appends one page holding only
    /// that DeviceGray image XObject at `width_pt x height_pt`.
    pub fn add_gray_face(
        &mut self,
        pixels: &[u8],
        width_px: u32,
        height_px: u32,
        width_pt: f64,
        height_pt: f64,
    ) -> Result<(), String> {
        if width_px == 0 || height_px == 0 {
            return Err(format!("invalid gray face size {width_px}x{height_px}"));
        }
        let expected = (width_px as usize)
            .checked_mul(height_px as usize)
            .ok_or_else(|| "gray face size overflow".to_string())?;
        if pixels.len() < expected {
            return Err("gray face pixel buffer is too short".to_string());
        }
        if !width_pt.is_finite() || !height_pt.is_finite() || width_pt <= 0.0 || height_pt <= 0.0 {
            return Err("invalid page point dimensions".to_string());
        }

        let mut encoder = ZlibEncoder::new(Vec::with_capacity(expected / 8), Compression::fast());
        encoder
            .write_all(&pixels[..expected])
            .map_err(|e| format!("gray face compression failed: {e}"))?;
        let compressed = encoder
            .finish()
            .map_err(|e| format!("gray face compression finish failed: {e}"))?;

        let img_id = self.alloc_id();
        self.offsets[img_id as usize] = self.buf.len();
        let _ = write!(
            &mut self.buf,
            "{img_id} 0 obj\n<</Type /XObject /Subtype /Image /Width {width_px} /Height {height_px} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length {}>>\nstream\n",
            compressed.len()
        );
        self.buf.extend_from_slice(&compressed);
        self.buf.extend_from_slice(b"\nendstream\nendobj\n");

        let w_s = format_pdf_num(width_pt);
        let h_s = format_pdf_num(height_pt);
        let content = format!("q\n{w_s} 0 0 {h_s} 0 0 cm\n/Face Do\nQ\n");
        let content_id = self.alloc_id();
        self.offsets[content_id as usize] = self.buf.len();
        let _ = write!(
            &mut self.buf,
            "{content_id} 0 obj\n<</Length {}>>\nstream\n{content}\nendstream\nendobj\n",
            content.len()
        );

        let page_id = self.alloc_id();
        let page_dict = format!(
            "<</Type /Page /Parent 2 0 R /MediaBox [0 0 {w_s} {h_s}] /Resources <</XObject <</Face {img_id} 0 R>>>> /Contents {content_id} 0 R>>"
        );
        self.write_object(page_id, page_dict.as_bytes());
        self.page_ids.push(page_id);
        Ok(())
    }

    /// Converts a BGRx bitmap to 8-bit grayscale and appends it as a face.
    pub fn add_bgrx_face(
        &mut self,
        bgrx: &[u8],
        stride: usize,
        width_px: u32,
        height_px: u32,
        width_pt: f64,
        height_pt: f64,
    ) -> Result<(), String> {
        let gray = convert_bgrx_pixels(bgrx, stride, width_px, height_px, true)?;
        self.add_gray_face(&gray, width_px, height_px, width_pt, height_pt)
    }

    pub fn finish(mut self) -> Vec<u8> {
        let mut kids = String::with_capacity(self.page_ids.len() * 8);
        for (i, pid) in self.page_ids.iter().enumerate() {
            if i > 0 {
                kids.push(' ');
            }
            let _ = write!(&mut kids, "{pid} 0 R");
        }
        let pages_dict = format!(
            "<</Type /Pages /Kids [{kids}] /Count {}>>",
            self.page_ids.len()
        );
        self.write_object(2, pages_dict.as_bytes());
        self.write_object(1, b"<</Type /Catalog /Pages 2 0 R>>");

        let xref_offset = self.buf.len();
        let total = self.next_id as usize;
        let _ = writeln!(&mut self.buf, "xref\n0 {total}");
        self.buf.extend_from_slice(b"0000000000 65535 f \n");
        for id in 1..total {
            let off = self.offsets[id];
            let _ = writeln!(&mut self.buf, "{off:010} 00000 n ");
        }
        let _ = write!(
            &mut self.buf,
            "trailer\n<</Size {total} /Root 1 0 R>>\nstartxref\n{xref_offset}\n%%EOF\n"
        );
        self.buf
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::Document;

    #[test]
    fn builds_valid_device_gray_pdf() {
        let mut b = GrayPdfBuilderImpl::new();
        b.add_gray_face(&[10, 20, 30, 40], 2, 2, 595.28, 841.89)
            .unwrap();
        let pdf = b.finish();
        let doc = Document::load_mem(&pdf).unwrap();
        assert_eq!(doc.get_pages().len(), 1);
    }
}
