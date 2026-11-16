import { inflateSync } from 'node:zlib'
import {
  decodePDFRawStream,
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  type PDFPage,
} from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { grayscalePdf, rotateLandscapeFaces } from '../src/index'
import { makeBoxJob } from './helpers/boxes'
import { A4, A5, makeJob, readFaces } from './helpers/pdf'

function contentText(page: PDFPage): string {
  const contents = page.node.Contents()
  const streams: PDFRawStream[] = []
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const s = contents.lookup(i)
      if (s instanceof PDFRawStream) streams.push(s)
    }
  } else {
    const s = page.node.lookup(PDFName.of('Contents'))
    if (s instanceof PDFRawStream) streams.push(s)
  }
  return streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n')
}

interface FaceImage {
  dict: PDFDict
  stream: PDFRawStream
}

function imagesOf(page: PDFPage): FaceImage[] {
  const resources = page.node.Resources()
  // pdf-lib gives every new page an empty font dictionary; no font may be in it
  const fonts = resources?.lookup(PDFName.of('Font'))
  expect(fonts === undefined || (fonts instanceof PDFDict && fonts.keys().length === 0)).toBe(true)
  const xobjects = resources?.lookup(PDFName.of('XObject'), PDFDict)
  if (!xobjects) return []
  return xobjects.keys().map((key) => {
    const stream = xobjects.lookup(key) as PDFRawStream
    return { dict: stream.dict, stream }
  })
}

const num = (d: PDFDict, key: string) => (d.lookup(PDFName.of(key)) as PDFNumber).asNumber()
const name = (d: PDFDict, key: string) => (d.lookup(PDFName.of(key)) as PDFName).asString()

describe('grayscale PDF', () => {
  it('makes every face one DeviceGray image with no text, same page size', async () => {
    const job = await makeJob([
      { ...A4, label: 'P1' },
      { w: A5.h, h: A5.w, label: 'P2' },
    ])
    const gray = await grayscalePdf(job, { dpi: 150 })
    const src = await PDFDocument.load(job)
    const out = await PDFDocument.load(gray)
    expect(out.getPageCount()).toBe(2)
    out.getPages().forEach((page, i) => {
      const box = page.getMediaBox()
      const srcBox = src.getPage(i).getMediaBox()
      expect(box.x).toBe(0)
      expect(box.y).toBe(0)
      expect(box.width).toBeCloseTo(srcBox.width, 3)
      expect(box.height).toBeCloseTo(srcBox.height, 3)
      const images = imagesOf(page)
      expect(images).toHaveLength(1)
      const { dict, stream } = images[0]!
      expect(name(dict, 'Subtype')).toBe('/Image')
      expect(name(dict, 'ColorSpace')).toBe('/DeviceGray')
      expect(num(dict, 'BitsPerComponent')).toBe(8)
      expect(num(dict, 'Width')).toBe(Math.round((srcBox.width * 150) / 72))
      expect(num(dict, 'Height')).toBe(Math.round((srcBox.height * 150) / 72))
      const pixels = inflateSync(stream.getContents())
      expect(pixels.length).toBe(num(dict, 'Width') * num(dict, 'Height'))
      const text = contentText(page)
      expect(text).not.toMatch(/\bBT\b|\bTj\b|\bTJ\b|\bTf\b/)
      expect(text).toMatch(/\bDo\b/)
    })
    // a reader finds no text at all
    const faces = await readFaces(gray)
    expect(faces.flatMap((f) => f.texts)).toEqual([])
    // the source text did render into the image (some dark pixels)
    const first = imagesOf(out.getPage(0))[0]!
    expect(inflateSync(first.stream.getContents()).some((v) => v < 128)).toBe(true)
  })

  it('uses the automatic density rule (200 dpi for a small job)', async () => {
    const job = await makeBoxJob([{ w: A4.w, h: A4.h }])
    const out = await PDFDocument.load(await grayscalePdf(job, { dpi: 'auto' }))
    const [img] = imagesOf(out.getPage(0))
    expect(num(img!.dict, 'Width')).toBe(Math.round((A4.w * 200) / 72))
  })

  it('reports progress and can be canceled', async () => {
    const job = await makeBoxJob([
      { w: A4.w, h: A4.h },
      { w: A4.w, h: A4.h },
    ])
    const progress: string[] = []
    await grayscalePdf(job, { dpi: 150, onProgress: (p) => progress.push(`${p.done}/${p.total}`) })
    expect(progress).toEqual(['0/2', '1/2', '2/2'])
    const controller = new AbortController()
    controller.abort()
    await expect(grayscalePdf(job, { dpi: 150, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})

describe('rotated copy for a printer queue', () => {
  it('turns landscape faces a quarter clockwise and leaves portrait ones', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([A4.w, A4.h])
    doc.addPage([A4.h, A4.w])
    // portrait media shown landscape by /Rotate 90
    doc.addPage([A4.w, A4.h]).setRotation(degrees(90))
    // landscape media shown portrait by /Rotate 270
    doc.addPage([A4.h, A4.w]).setRotation(degrees(270))
    const { pdf, rotated } = await rotateLandscapeFaces(await doc.save())
    expect(rotated).toBe(2)
    const out = await PDFDocument.load(pdf)
    expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 180, 270])
    expect(out.getPages().map((p) => p.getMediaBox().width)).toEqual(
      doc.getPages().map((p) => p.getMediaBox().width),
    )
  })

  it('returns the input when no face is landscape', async () => {
    const job = await makeBoxJob([{ w: A4.w, h: A4.h }])
    const result = await rotateLandscapeFaces(job)
    expect(result.rotated).toBe(0)
    expect(result.pdf).toBe(job)
  })
})
