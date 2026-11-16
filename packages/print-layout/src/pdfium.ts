// Main-process / worker side: loads PDFium (WebAssembly) for rendering faces.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/** The PDFium calls the rasterizer uses. */
export interface RasterPdfium {
  HEAPU8: Uint8Array
  _malloc(size: number): number
  _free(ptr: number): void
  _FPDF_LoadMemDocument(ptr: number, size: number, password: number): number
  _FPDF_CloseDocument(doc: number): void
  _FPDF_GetPageCount(doc: number): number
  _FPDF_LoadPage(doc: number, index: number): number
  _FPDF_ClosePage(page: number): void
  _FPDF_GetPageWidthF(page: number): number
  _FPDF_GetPageHeightF(page: number): number
  _FPDFBitmap_Create(width: number, height: number, alpha: number): number
  _FPDFBitmap_Destroy(bitmap: number): void
  _FPDFBitmap_FillRect(
    bitmap: number,
    left: number,
    top: number,
    width: number,
    height: number,
    color: number,
  ): number
  _FPDFBitmap_GetBuffer(bitmap: number): number
  _FPDFBitmap_GetStride(bitmap: number): number
  _FPDF_RenderPageBitmap(
    bitmap: number,
    page: number,
    startX: number,
    startY: number,
    sizeX: number,
    sizeY: number,
    rotate: number,
    flags: number,
  ): void
}

/**
 * Where pdfium.wasm is: next to the package in node_modules during development
 * and tests; the packaged app ships no node_modules, so electron-builder copies
 * it to `resources/wasm/pdfium.wasm` (apps/shell/electron-builder.cjs).
 */
export function pdfiumWasmPath(): string {
  try {
    return createRequire(import.meta.url).resolve('@embedpdf/pdfium/pdfium.wasm')
  } catch {
    const resources = (process as { resourcesPath?: string }).resourcesPath ?? ''
    return join(resources, 'wasm', 'pdfium.wasm')
  }
}

const loaded = new Map<string, Promise<RasterPdfium>>()

/**
 * One PDFium module per wasm path and thread. The wasm bytes are read here, so
 * the bundled code does not depend on the loader finding them on its own.
 */
export function loadRasterPdfium(wasmPath: string = pdfiumWasmPath()): Promise<RasterPdfium> {
  let pending = loaded.get(wasmPath)
  if (!pending) {
    pending = (async () => {
      const { init } = (await import('@embedpdf/pdfium')) as unknown as {
        init(overrides: object): Promise<object>
      }
      const raw = readFileSync(wasmPath)
      // exact slice: a Buffer may view a shared pool larger than the file
      const wasmBinary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
      // thisProgram: the runtime writes argv[1] through an ASCII-only path, so a
      // non-ASCII program path would abort the first call
      const wrapped = (await init({ wasmBinary, thisProgram: 'genoffice-pdf' })) as {
        pdfium?: unknown
      }
      const m = (wrapped.pdfium ?? wrapped) as RasterPdfium & { _PDFiumExt_Init(): void }
      m._PDFiumExt_Init()
      return m
    })()
    pending.catch(() => loaded.delete(wasmPath))
    loaded.set(wasmPath, pending)
  }
  return pending
}
