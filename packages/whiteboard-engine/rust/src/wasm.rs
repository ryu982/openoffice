//! `wasm-bindgen` exports bridging the pure Rust whiteboard core to JS/TS (browser and Node).

use crate::bounds::{DEFAULT_FREEFORM_MARGIN, compute_page_bounds};
use crate::edit_plan::{BatchMode, plan_board_edit};
use crate::error::{EditError, EditErrorCode, OpenError, OpenErrorCode};
use crate::excalidraw::{ExcalidrawImportSummary, import_excalidraw};
use crate::image_format::read_image_header;
use crate::model::{BoardDocument, StrokeTool, create_new_board, validate_board};
use crate::ordering::order_between;
use crate::outline::{board_to_markdown, read_board_table};
use crate::stroke::stroke_outline_svg_path;
use crate::template::apply_template;
use crate::zip_io::WhiteboardArchive;
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

fn js_open_err(err: OpenError) -> JsValue {
    JsValue::from_str(&serde_json::to_string(&err).unwrap_or_else(|_| err.to_string()))
}

#[wasm_bindgen]
pub struct WasmArchive {
    inner: WhiteboardArchive,
}

#[wasm_bindgen]
impl WasmArchive {
    #[wasm_bindgen(constructor)]
    pub fn from_doc_json(doc_json: &str) -> Result<WasmArchive, JsValue> {
        let doc: BoardDocument = serde_json::from_str(doc_json).map_err(|e| {
            js_open_err(OpenError::new(
                OpenErrorCode::InvalidJson,
                format!("board JSON parse error: {e}"),
            ))
        })?;
        let inner = WhiteboardArchive::from_new(doc).map_err(js_open_err)?;
        Ok(WasmArchive { inner })
    }

    pub fn open(bytes: &[u8]) -> Result<WasmArchive, JsValue> {
        let inner = WhiteboardArchive::open(bytes).map_err(js_open_err)?;
        Ok(WasmArchive { inner })
    }

    pub fn get_doc_json(&self) -> String {
        serde_json::to_string(&self.inner.doc).unwrap_or_default()
    }

    pub fn set_doc_json(&mut self, doc_json: &str) -> Result<(), JsValue> {
        let doc: BoardDocument = serde_json::from_str(doc_json).map_err(|e| {
            js_open_err(OpenError::new(
                OpenErrorCode::InvalidJson,
                format!("board JSON parse error: {e}"),
            ))
        })?;
        validate_board(&doc).map_err(js_open_err)?;
        self.inner.doc = doc;
        Ok(())
    }

    pub fn get_resource(&self, resource_id: &str) -> Option<Vec<u8>> {
        self.inner.resources.get(resource_id).cloned()
    }

    pub fn add_image_resource(&mut self, resource_id: &str, bytes: &[u8]) -> Result<String, JsValue> {
        let meta = self
            .inner
            .add_image_resource(resource_id.to_string(), bytes.to_vec())
            .map_err(js_open_err)?;
        Ok(serde_json::to_string(&meta).unwrap_or_default())
    }

    pub fn get_thumbnail(&self) -> Option<Vec<u8>> {
        self.inner.thumbnail.clone()
    }

    pub fn set_thumbnail(&mut self, png_bytes: Option<Vec<u8>>) -> Result<(), JsValue> {
        self.inner.set_thumbnail(png_bytes).map_err(js_open_err)
    }

    pub fn is_changed(&self) -> bool {
        self.inner.is_changed()
    }

    pub fn save(&self) -> Result<Vec<u8>, JsValue> {
        self.inner.save().map_err(js_open_err)
    }
}

#[wasm_bindgen]
pub struct WasmExcalidrawImport {
    archive: Option<WasmArchive>,
    summary_json: String,
}

#[wasm_bindgen]
impl WasmExcalidrawImport {
    pub fn summary_json(&self) -> String {
        self.summary_json.clone()
    }

    pub fn take_archive(&mut self) -> Option<WasmArchive> {
        self.archive.take()
    }
}

#[wasm_bindgen]
pub fn wasm_create_new_board(id: &str, page_id: &str, title: &str) -> String {
    let doc = create_new_board(id.to_string(), page_id.to_string(), title.to_string());
    serde_json::to_string(&doc).unwrap_or_default()
}

#[wasm_bindgen]
pub fn wasm_validate_board(doc_json: &str) -> String {
    match serde_json::from_str::<BoardDocument>(doc_json) {
        Ok(doc) => match validate_board(&doc) {
            Ok(()) => json!({ "ok": true }).to_string(),
            Err(err) => json!({ "ok": false, "error": err }).to_string(),
        },
        Err(e) => {
            let err = OpenError::new(OpenErrorCode::InvalidJson, format!("board JSON error: {e}"));
            json!({ "ok": false, "error": err }).to_string()
        }
    }
}

#[wasm_bindgen]
pub fn wasm_check_whiteboard(bytes: &[u8]) -> String {
    match WhiteboardArchive::open(bytes) {
        Ok(arch) => json!({
            "ok": true,
            "title": arch.doc.title,
            "pageCount": arch.doc.pages.len(),
            "objectCount": arch.doc.objects.len(),
        })
        .to_string(),
        Err(err) => json!({ "ok": false, "error": err }).to_string(),
    }
}

#[wasm_bindgen]
pub fn wasm_check_excalidraw(bytes: &[u8], filename_hint: Option<String>) -> String {
    match import_excalidraw(
        bytes,
        filename_hint.as_deref(),
        "check-board".into(),
        "check-page".into(),
        String::new(),
    ) {
        Ok(res) => {
            let summary = ExcalidrawImportSummary {
                imported_count: res.archive.doc.objects.len(),
                skipped_count: res.skipped_count,
                skipped_by_kind: res.skipped_by_kind,
            };
            json!({ "ok": true, "summary": summary }).to_string()
        }
        Err(err) => json!({ "ok": false, "error": err }).to_string(),
    }
}

#[wasm_bindgen]
pub fn wasm_import_excalidraw(
    bytes: &[u8],
    filename_hint: Option<String>,
    board_id: &str,
    page_id: &str,
    title: &str,
) -> Result<WasmExcalidrawImport, JsValue> {
    let res = import_excalidraw(
        bytes,
        filename_hint.as_deref(),
        board_id.to_string(),
        page_id.to_string(),
        title.to_string(),
    )
    .map_err(js_open_err)?;
    let summary = ExcalidrawImportSummary {
        imported_count: res.archive.doc.objects.len(),
        skipped_count: res.skipped_count,
        skipped_by_kind: res.skipped_by_kind,
    };
    Ok(WasmExcalidrawImport {
        archive: Some(WasmArchive { inner: res.archive }),
        summary_json: serde_json::to_string(&summary).unwrap_or_default(),
    })
}

#[wasm_bindgen]
pub fn wasm_extract_markdown(bytes: &[u8], page_filter: Option<String>) -> String {
    match WhiteboardArchive::open(bytes) {
        Ok(arch) => match board_to_markdown(&arch.doc, page_filter.as_deref()) {
            Some(markdown) => json!({
                "ok": true,
                "markdown": markdown,
                "title": arch.doc.title,
                "pageCount": arch.doc.pages.len(),
            })
            .to_string(),
            None => json!({
                "ok": false,
                "error": EditError::new(EditErrorCode::PageNotFound, "requested page not found"),
            })
            .to_string(),
        },
        Err(err) => json!({ "ok": false, "error": err }).to_string(),
    }
}

#[wasm_bindgen]
pub fn wasm_extract_thumbnail(bytes: &[u8]) -> Option<Vec<u8>> {
    WhiteboardArchive::open(bytes).ok().and_then(|a| a.thumbnail)
}

#[wasm_bindgen]
pub fn wasm_board_to_markdown(doc_json: &str, page_filter: Option<String>) -> Option<String> {
    let doc: BoardDocument = serde_json::from_str(doc_json).ok()?;
    board_to_markdown(&doc, page_filter.as_deref())
}

#[wasm_bindgen]
pub fn wasm_read_board_table(
    doc_json: &str,
    page_filter: Option<String>,
    selected_ids_json: &str,
) -> Option<String> {
    let doc: BoardDocument = serde_json::from_str(doc_json).ok()?;
    let selected: Vec<String> = serde_json::from_str(selected_ids_json).unwrap_or_default();
    let table = read_board_table(&doc, page_filter.as_deref(), &selected)?;
    serde_json::to_string(&table).ok()
}

#[wasm_bindgen]
pub fn wasm_plan_board_edit(
    doc_json: &str,
    ops_json: &str,
    default_page_id: Option<String>,
    mode: &str,
) -> String {
    let doc: BoardDocument = match serde_json::from_str(doc_json) {
        Ok(d) => d,
        Err(e) => {
            return json!({
                "ok": false,
                "error": EditError::new(EditErrorCode::InvalidArgument, format!("invalid board JSON: {e}")),
            })
            .to_string();
        }
    };
    let ops: Vec<Value> = match serde_json::from_str(ops_json) {
        Ok(o) => o,
        Err(e) => {
            return json!({
                "ok": false,
                "error": EditError::new(EditErrorCode::InvalidArgument, format!("invalid ops JSON: {e}")),
            })
            .to_string();
        }
    };
    let batch = match mode {
        "best_effort" => BatchMode::BestEffort,
        "stop_on_error" => BatchMode::StopOnError,
        _ => BatchMode::AllOrNothing,
    };
    let result = plan_board_edit(&doc, &ops, default_page_id.as_deref(), batch);
    serde_json::to_string(&result).unwrap_or_default()
}

#[wasm_bindgen]
pub fn wasm_apply_template(
    doc_json: &str,
    template_json: &str,
    active_page_id: Option<String>,
) -> String {
    let doc: BoardDocument = match serde_json::from_str(doc_json) {
        Ok(d) => d,
        Err(e) => {
            return json!({
                "ok": false,
                "error": EditError::new(EditErrorCode::InvalidArgument, format!("invalid board JSON: {e}")),
            })
            .to_string();
        }
    };
    let tpl_val: Value = match serde_json::from_str(template_json) {
        Ok(v) => v,
        Err(e) => {
            return json!({
                "ok": false,
                "error": EditError::new(EditErrorCode::InvalidTemplate, format!("invalid template JSON: {e}")),
            })
            .to_string();
        }
    };
    match apply_template(&doc, &tpl_val, active_page_id.as_deref()) {
        Ok(res) => json!({ "ok": true, "result": res }).to_string(),
        Err(err) => json!({ "ok": false, "error": err }).to_string(),
    }
}

#[wasm_bindgen]
pub fn wasm_compute_page_bounds(doc_json: &str, page_id: &str, margin: f64) -> Option<String> {
    let doc: BoardDocument = serde_json::from_str(doc_json).ok()?;
    let m = if margin.is_finite() && margin >= 0.0 {
        margin
    } else {
        DEFAULT_FREEFORM_MARGIN
    };
    let rect = compute_page_bounds(&doc, page_id, m)?;
    serde_json::to_string(&rect).ok()
}

#[wasm_bindgen]
pub fn wasm_compute_stroke_outline(
    points_json: &str,
    width: f64,
    tool: Option<String>,
) -> String {
    let points: Vec<[f64; 3]> = serde_json::from_str(points_json).unwrap_or_default();
    let stroke_tool = match tool.as_deref() {
        Some("highlighter") => StrokeTool::Highlighter,
        _ => StrokeTool::Pen,
    };
    stroke_outline_svg_path(&points, width, stroke_tool)
}

#[wasm_bindgen]
pub fn wasm_order_between(before: Option<String>, after: Option<String>) -> String {
    order_between(before.as_deref(), after.as_deref())
}

#[wasm_bindgen]
pub fn wasm_sniff_image(bytes: &[u8]) -> Option<String> {
    let header = read_image_header(bytes)?;
    serde_json::to_string(&header).ok()
}
