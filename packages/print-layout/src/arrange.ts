// Main-process side: re-places a print job PDF's pages per the sheet plan. Pages
// are embedded as form XObjects, so text stays text (nothing is rasterized).
import {
  clip,
  degrees,
  endPath,
  PDFDocument,
  type PDFEmbeddedPage,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
} from 'pdf-lib'
import { at } from './at'
import { issue, PrintLayoutError } from './errors'
import type { PageSize, Rect } from './geometry'
import { changesSheetArrangement, validateOptions, type PrintLayoutOptions } from './options'
import { planSheets } from './sheet-plan'

/** Cut marks are hairlines; 0.5pt still shows on every printer. */
const CUT_MARK_WIDTH_PT = 0.5

interface SourceInfo {
  page: PDFPage
  /** visible box (CropBox within MediaBox), unrotated PDF coordinates */
  box: { left: number; bottom: number; right: number; top: number }
  /** /Rotate normalized to 0, 90, 180 or 270 */
  rotate: number
  /** displayed size, rotation applied */
  size: PageSize
  /** a page without content streams has nothing to draw (and cannot be embedded) */
  empty: boolean
}

function normalizeRotation(angle: number): number {
  const quarter = Math.round(angle / 90)
  return (((quarter % 4) + 4) % 4) * 90
}

function sourceInfo(page: PDFPage): SourceInfo {
  const media = page.getMediaBox()
  const crop = page.getCropBox()
  const left = Math.max(media.x, crop.x)
  const bottom = Math.max(media.y, crop.y)
  const right = Math.min(media.x + media.width, crop.x + crop.width)
  const top = Math.min(media.y + media.height, crop.y + crop.height)
  // A crop box outside the media box is broken; fall back to the media box.
  const box =
    right > left && top > bottom
      ? { left, bottom, right, top }
      : {
          left: media.x,
          bottom: media.y,
          right: media.x + media.width,
          top: media.y + media.height,
        }
  const rotate = normalizeRotation(page.getRotation().angle)
  const w = box.right - box.left
  const h = box.top - box.bottom
  const size = rotate % 180 === 0 ? { widthPt: w, heightPt: h } : { widthPt: h, heightPt: w }
  return { page, box, rotate, size, empty: page.node.Contents() === undefined }
}

/** Page sizes of a job PDF in points, /Rotate applied, as `planSheets` expects. */
export async function readJobPageSizes(jobPdfBytes: Uint8Array): Promise<PageSize[]> {
  const doc = await PDFDocument.load(jobPdfBytes, { updateMetadata: false })
  return doc.getPages().map((p) => sourceInfo(p).size)
}

/**
 * Draws an embedded page so that its displayed (rotated) form fills `target`,
 * given in PDF coordinates (lower-left origin).
 */
function drawRotated(
  out: PDFPage,
  embedded: PDFEmbeddedPage,
  src: SourceInfo,
  target: { x: number; y: number; width: number; height: number },
): void {
  const s = target.width / src.size.widthPt
  const w = src.box.right - src.box.left
  const h = src.box.top - src.box.bottom
  // drawPage translates, then rotates counter-clockwise, then scales. /Rotate
  // turns the page clockwise, so rotate by the negative angle and move the
  // origin to the corner where the page's lower-left ends up.
  let x = target.x
  let y = target.y
  if (src.rotate === 90) y += s * w
  else if (src.rotate === 180) {
    x += s * w
    y += s * h
  } else if (src.rotate === 270) x += s * h
  out.drawPage(embedded, { x, y, xScale: s, yScale: s, rotate: degrees(-src.rotate) })
}

function toPdf(r: Rect, sheetHeight: number) {
  return { x: r.x, y: sheetHeight - r.y - r.height, width: r.width, height: r.height }
}

/**
 * Builds the arranged PDF for a print job. When the options leave the faces as
 * the job's pages (all defaults, or only grayscale/dpi differ) the input bytes
 * are returned as they are. Throws `PrintLayoutError` for invalid options or
 * when the sides filter leaves no face.
 */
export async function arrangePrintJob(
  jobPdfBytes: Uint8Array,
  options: PrintLayoutOptions,
): Promise<Uint8Array> {
  // Shape check before parsing anything; the page-count check follows below.
  const shape = validateOptions(options, Number.MAX_SAFE_INTEGER)
  if (!shape.ok) throw new PrintLayoutError(shape.error)
  if (!changesSheetArrangement(shape.options)) return jobPdfBytes

  const src = await PDFDocument.load(jobPdfBytes, { updateMetadata: false })
  const infos = src.getPages().map(sourceInfo)
  const plan = planSheets(
    infos.map((i) => i.size),
    options,
  )
  if (plan.output.length === 0) {
    throw new PrintLayoutError(issue('no-faces', 'the sides filter leaves no face to print'))
  }

  const out = await PDFDocument.create({ updateMetadata: false })
  const embedded = new Map<number, PDFEmbeddedPage>()
  const embed = async (index: number): Promise<PDFEmbeddedPage> => {
    let e = embedded.get(index)
    if (!e) {
      const info = at(infos, index)
      e = at(await out.embedPages([info.page], [info.box]), 0)
      embedded.set(index, e)
    }
    return e
  }

  for (const face of plan.output) {
    const page = out.addPage([face.width, face.height])
    for (const cell of face.cells) {
      if (cell.pageIndex === null || cell.content === null) continue
      const info = at(infos, cell.pageIndex)
      if (info.empty) continue
      const e = await embed(cell.pageIndex)
      const clipBox = toPdf(cell.box, face.height)
      page.pushOperators(
        pushGraphicsState(),
        rectangle(clipBox.x, clipBox.y, clipBox.width, clipBox.height),
        clip(),
        endPath(),
      )
      drawRotated(page, e, info, toPdf(cell.content, face.height))
      page.pushOperators(popGraphicsState())
    }
    for (const m of face.cutMarks) {
      page.drawLine({
        start: { x: m.x1, y: face.height - m.y1 },
        end: { x: m.x2, y: face.height - m.y2 },
        thickness: CUT_MARK_WIDTH_PT,
        color: rgb(0, 0, 0),
      })
    }
  }
  return out.save()
}
