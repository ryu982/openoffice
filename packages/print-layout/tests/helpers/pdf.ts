import { degrees, PDFDocument, StandardFonts } from 'pdf-lib'
import { decodePDFRawStream, PDFArray, PDFName, PDFRawStream } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export const MM = 72 / 25.4
export const A4 = { w: 210 * MM, h: 297 * MM }
export const A3 = { w: 297 * MM, h: 420 * MM }
export const A5 = { w: 148 * MM, h: 210 * MM }

export interface SourcePage {
  w: number
  h: number
  /** /Rotate value written on the page */
  rotate?: number
  /** marker drawn with its origin at the page centre; default `P<n>` */
  label?: string
  /** MediaBox lower-left corner; default (0, 0) */
  origin?: { x: number; y: number }
}

/**
 * Builds a job PDF. Every page draws its marker (`P1`, `P2`, ...) with the text
 * origin exactly on the page centre, and a corner marker (`Q1`, ...) with its
 * origin 2pt in from the unrotated lower-left corner.
 */
export async function makeJob(pages: SourcePage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  pages.forEach((p, i) => {
    const page = doc.addPage([p.w, p.h])
    const ox = p.origin?.x ?? 0
    const oy = p.origin?.y ?? 0
    if (ox !== 0 || oy !== 0) page.setMediaBox(ox, oy, p.w, p.h)
    const label = p.label ?? `P${i + 1}`
    page.drawText(label, { x: ox + p.w / 2, y: oy + p.h / 2, size: 8, font })
    page.drawText(label.replace(/^P/, 'Q'), { x: ox + 2, y: oy + 2, size: 4, font })
    if (p.rotate) page.setRotation(degrees(p.rotate))
  })
  return doc.save()
}

export interface FaceText {
  str: string
  /** text origin, top-left page coordinates (y grows downwards) */
  x: number
  y: number
}

export interface Face {
  width: number
  height: number
  texts: FaceText[]
}

export async function readFaces(bytes: Uint8Array): Promise<Face[]> {
  const task = getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  })
  const doc = await task.promise
  const faces: Face[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const [x0, y0, x1, y1] = page.view
    const width = x1 - x0
    const height = y1 - y0
    const content = await page.getTextContent()
    const texts: FaceText[] = []
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue
      const [, , , , e, f] = item.transform as number[]
      texts.push({ str: item.str, x: e - x0, y: height - (f - y0) })
    }
    faces.push({ width, height, texts })
  }
  await task.destroy()
  return faces
}

/** All origins of one marker on a face. */
export function markers(face: Face, str: string): FaceText[] {
  return face.texts.filter((t) => t.str === str)
}

/** Marker strings whose origin lies on the face (inside its box). */
export function visibleMarkers(face: Face, prefix = 'P'): string[] {
  return face.texts
    .filter(
      (t) =>
        t.str.startsWith(prefix) &&
        t.x >= -0.01 &&
        t.y >= -0.01 &&
        t.x <= face.width + 0.01 &&
        t.y <= face.height + 0.01,
    )
    .map((t) => t.str)
}

/** Line segments (`x y m x y l`) in each output page's content, PDF coordinates. */
export async function readLines(
  bytes: Uint8Array,
): Promise<Array<Array<{ x1: number; y1: number; x2: number; y2: number }>>> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((page) => {
    const contents = page.node.Contents()
    const streams: PDFRawStream[] = []
    if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        const s = contents.lookup(i)
        if (s instanceof PDFRawStream) streams.push(s)
      }
    } else if (contents) {
      const s = page.node.lookup(PDFName.of('Contents'))
      if (s instanceof PDFRawStream) streams.push(s)
    }
    const text = streams
      .map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode()))
      .join('\n')
    const out: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
    const re = /(-?[\d.]+) (-?[\d.]+) m\s+(-?[\d.]+) (-?[\d.]+) l/g
    for (const m of text.matchAll(re)) {
      out.push({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] })
    }
    return out
  })
}
