// Main-process / worker side: renders PDF faces to pixels with PDFium, one face
// at a time, so a long job never holds every face's bitmap at once.
import type { DpiChoice } from './options'
import { loadRasterPdfium, type RasterPdfium } from './pdfium'

/** Density the automatic choice aims for (the PDF editor's print rule). */
export const AUTO_TARGET_DPI = 200
/** The automatic choice never goes below this. */
export const AUTO_FLOOR_DPI = 150
/**
 * Pixel budget across all faces for the automatic choice: a job past it is
 * rendered at a lower density, down to the floor. A single face past it is
 * lowered on its own so one huge drawing cannot exhaust memory.
 */
export const AUTO_PIXEL_BUDGET = 150_000_000

/** FPDF_ANNOT | FPDF_PRINTING: draw annotation appearances as a print would. */
const RENDER_FLAGS = 0x01 | 0x800
/** FPDFBitmap_FillRect colour: opaque white */
const WHITE = 0xffffffff

export interface RasterProgress {
  done: number
  total: number
}

/**
 * Dots per inch for a job whose faces have these areas (pt²). `auto` follows
 * the PDF editor's print rule: 200 dpi while the job fits the pixel budget,
 * else the largest density that fits, never below 150. A chosen number is used
 * as it is: never lowered, never capped.
 */
export function rasterDpiFor(choice: DpiChoice, areasPt2: readonly number[]): number {
  if (choice !== 'auto') return choice
  const total = areasPt2.reduce((sum, a) => sum + (Number.isFinite(a) && a > 0 ? a : 0), 0)
  const scale = AUTO_TARGET_DPI / 72
  const atTarget = total * scale * scale
  if (!(atTarget > 0) || atTarget <= AUTO_PIXEL_BUDGET) return AUTO_TARGET_DPI
  return Math.max(AUTO_FLOOR_DPI, AUTO_TARGET_DPI * Math.sqrt(AUTO_PIXEL_BUDGET / atTarget))
}

export interface RasterizeOptions {
  /** density of the rendered faces; ignored when `longSidePx` is set */
  dpi: DpiChoice
  /** small renders (preview): each face's long side gets this many pixels */
  longSidePx?: number | undefined
  grayscale: boolean
  /** turn faces wider than tall 90° clockwise, so they print on upright paper */
  rotateLandscape: boolean
  signal?: AbortSignal | undefined
  onProgress?: ((progress: RasterProgress) => void) | undefined
  /** pdfium.wasm; default `pdfiumWasmPath()` */
  wasmPath?: string | undefined
  /** an already loaded module (tests); default loads `wasmPath` */
  pdfium?: RasterPdfium | undefined
}

export interface RasterFace {
  /** 0-based face index */
  index: number
  /** the face as the PDF shows it, in points (before any print rotation) */
  widthPt: number
  heightPt: number
  /** true when the image is the face turned 90° clockwise */
  rotated: boolean
  /** image size in pixels (after rotation) */
  widthPx: number
  heightPx: number
  /** 1 = gray, 3 = RGB */
  channels: 1 | 3
  /** rows of `widthPx * channels` bytes; valid only during the callback */
  pixels: Uint8Array
}

function abortIfAsked(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('The print job was canceled', 'AbortError')
  }
}

/** BGRx rows with a stride to tight gray or RGB rows. */
function convertPixels(
  heap: Uint8Array,
  ptr: number,
  stride: number,
  width: number,
  height: number,
  gray: boolean,
): Uint8Array {
  const out = new Uint8Array(width * height * (gray ? 1 : 3))
  let o = 0
  for (let y = 0; y < height; y++) {
    let at = ptr + y * stride
    for (let x = 0; x < width; x++, at += 4) {
      const b = heap[at]!
      const g = heap[at + 1]!
      const r = heap[at + 2]!
      if (gray) {
        // Rec. 601 luma in fixed point; white stays 255
        out[o++] = (r * 77 + g * 150 + b * 29 + 128) >> 8
      } else {
        out[o++] = r
        out[o++] = g
        out[o++] = b
      }
    }
  }
  return out
}

/**
 * Renders every face of `pdf` and hands each to `onFace` before rendering the
 * next. Returns the number of faces. Checks `signal` between faces.
 */
export async function rasterizePdf(
  pdf: Uint8Array,
  options: RasterizeOptions,
  onFace: (face: RasterFace) => void | Promise<void>,
): Promise<number> {
  abortIfAsked(options.signal)
  const m = options.pdfium ?? (await loadRasterPdfium(options.wasmPath))
  abortIfAsked(options.signal)
  const docPtr = m._malloc(pdf.length)
  if (!docPtr) throw new Error('not enough memory to open the print job')
  try {
    m.HEAPU8.set(pdf, docPtr)
    const doc = m._FPDF_LoadMemDocument(docPtr, pdf.length, 0)
    if (!doc) throw new Error('the print job PDF could not be read')
    try {
      const total = m._FPDF_GetPageCount(doc)
      const sizes: { w: number; h: number }[] = []
      for (let i = 0; i < total; i++) {
        const page = m._FPDF_LoadPage(doc, i)
        if (!page) throw new Error(`face ${i + 1} of the print job could not be read`)
        try {
          sizes.push({ w: m._FPDF_GetPageWidthF(page), h: m._FPDF_GetPageHeightF(page) })
        } finally {
          m._FPDF_ClosePage(page)
        }
      }
      const longSide = options.longSidePx
      const dpi = longSide
        ? 0
        : rasterDpiFor(
            options.dpi,
            sizes.map((s) => s.w * s.h),
          )
      options.onProgress?.({ done: 0, total })
      for (let i = 0; i < total; i++) {
        abortIfAsked(options.signal)
        const { w, h } = sizes[i]!
        let scale = longSide ? longSide / Math.max(w, h, 1) : dpi / 72
        // the automatic choice also bounds one face (the PDF editor's rule)
        if (!longSide && options.dpi === 'auto' && w * h * scale * scale > AUTO_PIXEL_BUDGET) {
          scale *= Math.sqrt(AUTO_PIXEL_BUDGET / (w * h * scale * scale))
        }
        const pw = Math.max(1, Math.round(w * scale))
        const ph = Math.max(1, Math.round(h * scale))
        const rotated = options.rotateLandscape && w > h
        const bw = rotated ? ph : pw
        const bh = rotated ? pw : ph
        const page = m._FPDF_LoadPage(doc, i)
        if (!page) throw new Error(`face ${i + 1} of the print job could not be read`)
        let pixels: Uint8Array
        try {
          const bitmap = m._FPDFBitmap_Create(bw, bh, 0)
          if (!bitmap) throw new Error(`not enough memory to render face ${i + 1}`)
          try {
            m._FPDFBitmap_FillRect(bitmap, 0, 0, bw, bh, WHITE)
            m._FPDF_RenderPageBitmap(bitmap, page, 0, 0, bw, bh, rotated ? 1 : 0, RENDER_FLAGS)
            const stride = m._FPDFBitmap_GetStride(bitmap)
            const ptr = m._FPDFBitmap_GetBuffer(bitmap)
            pixels = convertPixels(m.HEAPU8, ptr, stride, bw, bh, options.grayscale)
          } finally {
            m._FPDFBitmap_Destroy(bitmap)
          }
        } finally {
          m._FPDF_ClosePage(page)
        }
        await onFace({
          index: i,
          widthPt: w,
          heightPt: h,
          rotated,
          widthPx: bw,
          heightPx: bh,
          channels: options.grayscale ? 1 : 3,
          pixels,
        })
        options.onProgress?.({ done: i + 1, total })
      }
      return total
    } finally {
      m._FPDF_CloseDocument(doc)
    }
  } finally {
    m._free(docPtr)
  }
}
