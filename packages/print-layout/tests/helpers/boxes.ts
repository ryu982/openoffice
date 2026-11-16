import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

export interface BoxPage {
  w: number
  h: number
  /** fill of the top-left quarter box; default black */
  color?: [number, number, number]
  /** text drawn in the middle of the page */
  text?: string
}

/**
 * Builds a PDF whose pages each fill their top-left quarter (as shown) with a
 * box, so a render shows which way it was turned.
 */
export async function makeBoxJob(pages: BoxPage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const p of pages) {
    const page = doc.addPage([p.w, p.h])
    const [r, g, b] = p.color ?? [0, 0, 0]
    page.drawRectangle({
      x: 0,
      y: p.h * 0.75,
      width: p.w / 4,
      height: p.h / 4,
      color: rgb(r, g, b),
    })
    if (p.text) page.drawText(p.text, { x: p.w / 2, y: p.h / 2, size: 24, font })
  }
  return doc.save()
}
