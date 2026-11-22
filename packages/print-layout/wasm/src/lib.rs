mod gray_pdf;
mod pixels;
mod pdf_ops;

use wasm_bindgen::prelude::*;

use gray_pdf::GrayPdfBuilderImpl;
use pdf_ops::PlannedFaceDto;

fn semantic_err(msg: String) -> JsValue {
    JsValue::from_str(&format!("SEMANTIC:{msg}"))
}

/// Converts BGRx rows with stride into tightly packed 8-bit gray or RGB rows.
#[wasm_bindgen]
pub fn convert_bgrx_pixels(
    bgrx: &[u8],
    stride: u32,
    width: u32,
    height: u32,
    grayscale: bool,
) -> Result<Vec<u8>, JsValue> {
    pixels::convert_bgrx_pixels(bgrx, stride as usize, width, height, grayscale)
        .map_err(semantic_err)
}

/// Encodes tightly packed 8-bit gray (`channels = 1`) or RGB (`channels = 3`)
/// pixel rows to PNG using the Up row filter and fdeflate compression.
#[wasm_bindgen]
pub fn encode_png(
    pixels: &[u8],
    width: u32,
    height: u32,
    channels: u8,
) -> Result<Vec<u8>, JsValue> {
    pixels::encode_png(pixels, width, height, channels).map_err(semantic_err)
}

/// Fused BGRx-to-PNG encoder without an intermediate full-frame pixel copy.
#[wasm_bindgen]
pub fn encode_bgrx_to_png(
    bgrx: &[u8],
    stride: u32,
    width: u32,
    height: u32,
    grayscale: bool,
) -> Result<Vec<u8>, JsValue> {
    pixels::encode_bgrx_to_png(bgrx, stride as usize, width, height, grayscale)
        .map_err(semantic_err)
}

/// Reads each page's displayed size in points as JSON `[{widthPt, heightPt}, ...]`.
#[wasm_bindgen]
pub fn read_job_page_sizes(pdf_bytes: &[u8]) -> Result<String, JsValue> {
    let sizes = pdf_ops::read_job_page_sizes(pdf_bytes).map_err(semantic_err)?;
    serde_json::to_string(&sizes).map_err(|e| semantic_err(format!("JSON encode failed: {e}")))
}

/// Arranges a job PDF according to a precomputed `PlannedFace[]` JSON array.
#[wasm_bindgen]
pub fn arrange_pdf(pdf_bytes: &[u8], faces_json: &str) -> Result<Vec<u8>, JsValue> {
    let faces: Vec<PlannedFaceDto> = serde_json::from_str(faces_json)
        .map_err(|e| semantic_err(format!("invalid sheet plan JSON: {e}")))?;
    pdf_ops::arrange_pdf(pdf_bytes, &faces).map_err(semantic_err)
}

/// Result of `rotate_landscape_faces`: when `rotated == 0`, `pdf` is `None`.
#[wasm_bindgen]
pub struct RotateResult {
    rotated: u32,
    pdf: Option<Vec<u8>>,
}

#[wasm_bindgen]
impl RotateResult {
    #[wasm_bindgen(getter)]
    pub fn rotated(&self) -> u32 {
        self.rotated
    }

    pub fn take_pdf(&mut self) -> Option<Vec<u8>> {
        self.pdf.take()
    }
}

/// Rotates landscape pages 90 degrees clockwise (`/Rotate` + 90 mod 360).
#[wasm_bindgen]
pub fn rotate_landscape_faces(pdf_bytes: &[u8]) -> Result<RotateResult, JsValue> {
    let (pdf, rotated) = pdf_ops::rotate_landscape_faces(pdf_bytes).map_err(semantic_err)?;
    Ok(RotateResult { rotated, pdf })
}

/// Streaming DeviceGray PDF builder that appends one face at a time.
#[wasm_bindgen]
pub struct GrayPdfBuilder {
    inner: Option<GrayPdfBuilderImpl>,
}

#[wasm_bindgen]
impl GrayPdfBuilder {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: Some(GrayPdfBuilderImpl::new()),
        }
    }

    pub fn add_gray_face(
        &mut self,
        pixels: &[u8],
        width_px: u32,
        height_px: u32,
        width_pt: f64,
        height_pt: f64,
    ) -> Result<(), JsValue> {
        let inner = self
            .inner
            .as_mut()
            .ok_or_else(|| semantic_err("GrayPdfBuilder already finished".to_string()))?;
        inner
            .add_gray_face(pixels, width_px, height_px, width_pt, height_pt)
            .map_err(semantic_err)
    }

    pub fn add_bgrx_face(
        &mut self,
        bgrx: &[u8],
        stride: u32,
        width_px: u32,
        height_px: u32,
        width_pt: f64,
        height_pt: f64,
    ) -> Result<(), JsValue> {
        let inner = self
            .inner
            .as_mut()
            .ok_or_else(|| semantic_err("GrayPdfBuilder already finished".to_string()))?;
        inner
            .add_bgrx_face(bgrx, stride as usize, width_px, height_px, width_pt, height_pt)
            .map_err(semantic_err)
    }

    pub fn finish(&mut self) -> Result<Vec<u8>, JsValue> {
        let inner = self
            .inner
            .take()
            .ok_or_else(|| semantic_err("GrayPdfBuilder already finished".to_string()))?;
        Ok(inner.finish())
    }
}
