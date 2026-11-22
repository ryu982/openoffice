/**
 * Local-only PDF page background importer using `pdfjs-dist` (zero external network requests).
 * Renders selected PDF pages to raster PNG bytes and returns page dimensions so the session
 * can insert locked `background: { kind: 'image' }` custom pages in 1 undo step.
 */

export const MAX_PDF_IMPORT_PAGES = 50
const DEFAULT_RENDER_SCALE = 1.5

export interface PdfInspection {
  pageCount: number
}

export interface RenderedPdfPage {
  pageNumber: number
  width: number
  height: number
  pngBytes: Uint8Array
}

export async function inspectPdfBytes(bytes: Uint8Array): Promise<PdfInspection> {
  const pdfjsLib = await import('pdfjs-dist')
  const task = pdfjsLib.getDocument({ data: bytes.slice(), useWorkerFetch: false })
  const pdf = await task.promise
  try {
    return { pageCount: pdf.numPages }
  } finally {
    await task.destroy()
  }
}

export async function renderPdfPagesToPng(
  bytes: Uint8Array,
  pageNumbers: readonly number[],
  scale = DEFAULT_RENDER_SCALE,
): Promise<RenderedPdfPage[]> {
  const pdfjsLib = await import('pdfjs-dist')
  const clamped = pageNumbers.slice(0, MAX_PDF_IMPORT_PAGES)
  const task = pdfjsLib.getDocument({ data: bytes.slice(), useWorkerFetch: false })
  const pdf = await task.promise
  try {
    const out: RenderedPdfPage[] = []
    for (const num of clamped) {
      if (num < 1 || num > pdf.numPages) continue
      const page = await pdf.getPage(num)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(viewport.width))
      canvas.height = Math.max(1, Math.round(viewport.height))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas 2d context unavailable')
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport, canvas }).promise
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png'),
      )
      if (!blob) throw new Error(`failed to encode PDF page ${num} as PNG`)
      const pngBytes = new Uint8Array(await blob.arrayBuffer())
      out.push({
        pageNumber: num,
        width: canvas.width,
        height: canvas.height,
        pngBytes,
      })
    }
    return out
  } finally {
    await task.destroy()
  }
}

/** Parses a page-range string like "1-3, 5, 8-10" into sorted unique 1-based page numbers. */
export function parsePdfPageRange(
  input: string,
  maxPages: number,
  cap = MAX_PDF_IMPORT_PAGES,
): number[] {
  const cleaned = input.trim()
  if (!cleaned) {
    return Array.from({ length: Math.min(maxPages, cap) }, (_, i) => i + 1)
  }
  const set = new Set<number>()
  for (const part of cleaned.split(',')) {
    const seg = part.trim()
    if (!seg) continue
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(seg)
    if (range) {
      const a = Math.max(1, Number(range[1]))
      const b = Math.min(maxPages, Number(range[2]))
      for (let p = Math.min(a, b); p <= Math.max(a, b) && set.size < cap; p++) {
        if (p >= 1 && p <= maxPages) set.add(p)
      }
    } else if (/^\d+$/.test(seg)) {
      const n = Number(seg)
      if (n >= 1 && n <= maxPages && set.size < cap) set.add(n)
    }
  }
  return [...set].sort((a, b) => a - b)
}
