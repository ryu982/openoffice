import type { PDFDocumentProxy } from 'pdfjs-dist'

/** pdf.js `AnnotationMode` values, kept local so this module does not import the
    browser build (which needs DOMMatrix) just for an enum. */
const ANNOTATION_MODE_DISABLE = 0
const ANNOTATION_MODE_ENABLE = 1

/** Baseline raster density (previous behavior — quality never drops below this). */
const BASE_DPI = 150
/** Target raster density for sharper glyph edges on high-DPI printers. */
const TARGET_DPI = 200
/**
 * Upper bound on total raster pixels across all pages. A 200 DPI US-Letter
 * page is ~3.7 MP, so ~40 such pages print at full target quality; larger
 * documents scale down toward (never below) the 150 DPI baseline. This keeps
 * the JPEG images held alive until the dialog closes within ~tens of MB
 * instead of pushing the renderer out of memory on long scanned PDFs.
 */
const MAX_PRINT_PIXELS = 150_000_000
/** Per-canvas pixel bound, so one huge drawing cannot OOM the renderer. */
const MAX_PAGE_PIXELS = MAX_PRINT_PIXELS
/** JPEG quality of the printed page images. */
const PRINT_JPEG_QUALITY = 0.92

/** How long to wait for the dialog to report back before giving up. Chromium
    and Electron both fire `afterprint`, but a suppressed print (blocked popup,
    kiosk policy, stubbed `window.print`) never does: unbounded, the promise
    never settles, the print root keeps every rasterized data URL alive, and
    the caller's busy flag stays set so no later print is accepted. Sized to
    outlast a real dialog the user is still reading. */
export const PRINT_DIALOG_TIMEOUT_MS = 300_000

/**
 * Render scale for a document given each page's area at scale 1 (PDF points²):
 * full 200 DPI while the whole document fits the pixel budget, otherwise the
 * largest scale that fits, floored at the 150 DPI baseline.
 */
export function printScaleForAreas(areas: number[]): number {
  const target = TARGET_DPI / 72
  const total = areas.reduce((sum, area) => sum + area, 0)
  if (!(total > 0) || !Number.isFinite(total)) return target
  const atTarget = total * target * target
  if (!Number.isFinite(atTarget) || atTarget <= 0) return target
  if (atTarget <= MAX_PRINT_PIXELS) return target
  return Math.max(BASE_DPI / 72, target * Math.sqrt(MAX_PRINT_PIXELS / atTarget))
}

/**
 * Render pages in order as JPEG images into a print-only container, then hand
 * off to the system print dialog; clean up after it closes (including cancel).
 * Page n+1 renders while page n is encoded with the async `toBlob` into an
 * object URL and starts decoding, on two alternating canvases emptied as soon
 * as their image is out. This replaced a synchronous `toDataURL` per page that
 * held the renderer and kept base64 strings alive, which made large documents
 * slow to reach the dialog; pages, scale and JPEG quality are unchanged.
 * Caller flushes unsaved changes and re-getDocument first — rotations/deleted pages are
 * already in the file.
 * @param pages 1-based file pages to render; defaults to the whole document.
 * The 200 DPI pixel budget is computed over the selected pages only, so a
 * small range out of a huge document still prints at full target quality.
 */
/** Settles when the print dialog reports back, when `window.print` fails
    outright, or when the wait exceeds the bound. Always detaches the listener
    and the timer, so a wedged dialog cannot leak either. */
function waitForPrintDialog(timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const detach = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      window.removeEventListener('afterprint', onAfterPrint)
    }
    function onAfterPrint(): void {
      detach()
      resolve()
    }
    timer = setTimeout(() => {
      detach()
      reject(new Error('the print dialog never reported completion; released the rendered pages'))
    }, timeoutMs)
    window.addEventListener('afterprint', onAfterPrint)
    try {
      window.print()
    } catch (err) {
      detach()
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

export interface PrintOptions {
  /**
   * Draw annotations (highlights, notes, form fields) into the printed page.
   * True is also PDF.js's default; the print dialog lets the reader turn it off.
   */
  includeAnnotations?: boolean
  /** Pages prepared so far: (0, total) first, (total, total) before the dialog opens. */
  onProgress?: (done: number, total: number) => void
  /**
   * Cancels the preparation: the job rejects with an `AbortError`, nothing is
   * printed and every page image is released. Ignored once the dialog is open.
   */
  signal?: AbortSignal
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const reason: unknown = signal.reason
  if (reason instanceof Error && reason.name === 'AbortError') throw reason
  throw new DOMException('printing was cancelled', 'AbortError')
}

/** Async JPEG encode: unlike `toDataURL`, the caller is not blocked and no base64 copy is made. */
function encodeJpeg(canvas: HTMLCanvasElement, page: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error(`page ${page} could not be prepared for printing`))
      },
      'image/jpeg',
      PRINT_JPEG_QUALITY,
    )
  })
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}

export async function printPdf(
  doc: PDFDocumentProxy,
  pages?: number[],
  options: PrintOptions = {},
): Promise<void> {
  const { signal, onProgress } = options
  throwIfAborted(signal)
  const root = document.createElement('div')
  root.className = 'pdf-print-root'
  // Integer-only: a float (1.5) passes the range check but pdf.js getPage
  // throws on it, aborting the whole job in the measure pass below.
  const targets =
    pages && pages.length > 0
      ? [...new Set(pages)]
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= doc.numPages)
          .sort((a, b) => a - b)
      : Array.from({ length: doc.numPages }, (_x, i) => i + 1)
  // A caller-supplied range that filters to nothing used to print an empty document:
  // both loops no-op and window.print() runs against an empty root. Refuse instead.
  if (pages && pages.length > 0 && targets.length === 0) {
    throw new Error(
      `none of the requested pages (${pages.join(', ')}) exist in this ${doc.numPages}-page document`,
    )
  }
  const total = targets.length
  let done = 0
  onProgress?.(0, total)
  // First pass: measure each page at unit scale to budget the shared scale.
  // Stream one page at a time so no PDFPageProxy outlives its render — the
  // previous two-pass held all pages alive plus 2× viewports.
  const areas: number[] = []
  for (const n of targets) {
    throwIfAborted(signal)
    const page = await doc.getPage(n)
    try {
      const unit = page.getViewport({ scale: 1 })
      const area = unit.width * unit.height
      areas.push(Number.isFinite(area) && area > 0 ? area : 0)
    } finally {
      try {
        page.cleanup()
      } catch {
        /* older pdf.js without cleanup */
      }
    }
  }
  const scale = printScaleForAreas(areas)
  // Two canvases take turns: page n+1 draws on one while page n's JPEG is
  // encoded from the other.
  const canvases = [document.createElement('canvas'), document.createElement('canvas')]
  let turn = 0
  const urls: string[] = []
  const decodes: Promise<void>[] = []
  // The previous page's encode step and the canvas pixels it still holds.
  let pending: Promise<void> | null = null
  let pendingPixels = 0
  const settlePending = async () => {
    const step = pending
    pending = null
    pendingPixels = 0
    if (step) await step
  }
  const finishPage = async (canvas: HTMLCanvasElement, n: number) => {
    try {
      const blob = await encodeJpeg(canvas, n)
      const url = URL.createObjectURL(blob)
      urls.push(url)
      const img = document.createElement('img')
      img.src = url
      root.appendChild(img)
      // Decode now, overlapping the next pages, instead of all at the end.
      const decoded = img.decode()
      decoded.catch(() => {
        /* reported by the Promise.all below */
      })
      decodes.push(decoded)
    } finally {
      releaseCanvas(canvas)
    }
    done += 1
    onProgress?.(done, total)
  }
  try {
    // Second pass: render at the budgeted scale, bounding each canvas to the
    // pixel budget so a single huge drawing (e.g. 200in² at 150 DPI → >1Bpx)
    // cannot OOM the renderer even at the floor scale.
    for (const n of targets) {
      throwIfAborted(signal)
      const page = await doc.getPage(n)
      try {
        let viewport = page.getViewport({ scale })
        let w = Math.floor(viewport.width)
        let h = Math.floor(viewport.height)
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
          // Skip a single corrupt page rather than aborting the whole print.
          done += 1
          onProgress?.(done, total)
          continue
        }
        if (w * h > MAX_PAGE_PIXELS) {
          // A missing page is worse than a softer one: render this page at its
          // own reduced scale instead of dropping it.
          const pageScale = scale * Math.sqrt(MAX_PAGE_PIXELS / (w * h))
          viewport = page.getViewport({ scale: pageScale })
          w = Math.floor(viewport.width)
          h = Math.floor(viewport.height)
          if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
            done += 1
            onProgress?.(done, total)
            continue
          }
        }
        // The two canvases together never hold more than one page may: past
        // that, finish the previous page before drawing this one.
        if (pendingPixels + w * h > MAX_PAGE_PIXELS) await settlePending()
        throwIfAborted(signal)
        const canvas = canvases[turn]!
        canvas.width = w
        canvas.height = h
        await page.render({
          canvas,
          viewport,
          annotationMode:
            options.includeAnnotations === false ? ANNOTATION_MODE_DISABLE : ANNOTATION_MODE_ENABLE,
        }).promise
        await settlePending()
        throwIfAborted(signal)
        pending = finishPage(canvas, n)
        // Settled at the next page or below; a rejection is never left unobserved.
        pending.catch(() => {})
        pendingPixels = w * h
        turn = 1 - turn
      } finally {
        try {
          page.cleanup()
        } catch {
          /* older pdf.js without cleanup */
        }
      }
    }
    await settlePending()
    throwIfAborted(signal)
    document.body.appendChild(root)
    await Promise.all(decodes)
    throwIfAborted(signal)
    await waitForPrintDialog(PRINT_DIALOG_TIMEOUT_MS)
  } finally {
    // An encode still in flight would otherwise add a URL after the release.
    await pending?.catch(() => {})
    for (const canvas of canvases) releaseCanvas(canvas)
    root.remove()
    for (const url of urls) URL.revokeObjectURL(url)
  }
}
