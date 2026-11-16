/**
 * The PDF editor's print job for the advanced print route: the chosen pages of
 * the saved file, annotations baked into the page ("include annotations" on)
 * or left out entirely, form fields included, as the current print does
 * (pdf.js annotationMode DISABLE). The original bytes are never changed.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { degrees, PDFArray, PDFDocument, PDFName, PDFRawStream, PDFStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { buildPrintJobPdf } from '../src/main/print-layout'

const WIDTHS = [110, 220, 330, 440]

/**
 * Four pages told apart by width. Page 2 has a highlight and a filled text
 * field (a widget); page 3 a square annotation; pages 1 and 4 none.
 */
async function source(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false })
  const pages = WIDTHS.map((w) => doc.addPage([w, 500]))
  const ctx = doc.context
  const ap = (w: number, h: number, ops: string) =>
    ctx.register(ctx.flateStream(ops, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h] }))
  const highlight = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: [20, 300, 120, 320],
      F: 4,
      C: [1, 1, 0],
      QuadPoints: [20, 320, 120, 320, 20, 300, 120, 300],
      AP: { N: ap(100, 20, '1 1 0 rg 0 0 100 20 re f') },
    }),
  )
  pages[1]!.node.set(PDFName.of('Annots'), ctx.obj([highlight]))
  const field = doc.getForm().createTextField('name')
  field.setText('Hello')
  field.addToPage(pages[1]!, { x: 20, y: 100, width: 150, height: 30 })
  const square = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Square',
      Rect: [10, 10, 60, 60],
      F: 4,
      C: [1, 0, 0],
      AP: { N: ap(50, 50, '1 0 0 RG 2 w 1 1 48 48 re S') },
    }),
  )
  pages[2]!.node.set(PDFName.of('Annots'), ctx.obj([square]))
  return doc.save({ useObjectStreams: false })
}

const annotCount = (doc: PDFDocument, i: number): number =>
  doc.getPage(i).node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size() ?? 0

const widths = (doc: PDFDocument) => doc.getPages().map((p) => Math.round(p.getWidth()))

/** Total decoded-or-raw length of a page's content streams. */
function contentLength(doc: PDFDocument, i: number): number {
  const contents = doc.getPage(i).node.Contents()
  if (!contents) return 0
  const streams =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, k) => contents.lookup(k))
      : [contents]
  return streams.reduce<number>(
    (sum, s) =>
      sum + (s instanceof PDFRawStream || s instanceof PDFStream ? s.getContentsSize() : 0),
    0,
  )
}

describe('buildPrintJobPdf: pages', () => {
  it('takes the whole document when no pages are given', async () => {
    const job = await PDFDocument.load(
      await buildPrintJobPdf(await source(), { pages: null, includeAnnotations: false }),
    )
    expect(widths(job)).toEqual(WIDTHS)
  })

  it('takes only the chosen 1-based pages, in document order, each once', async () => {
    const job = await PDFDocument.load(
      await buildPrintJobPdf(await source(), { pages: [4, 2, 4], includeAnnotations: false }),
    )
    expect(widths(job)).toEqual([220, 440])
  })

  it('drops pages that do not exist and refuses when none is left', async () => {
    const job = await PDFDocument.load(
      await buildPrintJobPdf(await source(), { pages: [0, 3, 9, 1.5], includeAnnotations: false }),
    )
    expect(widths(job)).toEqual([330])
    await expect(
      buildPrintJobPdf(await source(), { pages: [0, 9], includeAnnotations: false }),
    ).rejects.toThrow('none of the requested pages')
  })

  it('keeps each page rotation', async () => {
    const doc = await PDFDocument.load(await source())
    doc.getPage(1).setRotation(degrees(90))
    const rotated = await doc.save({ useObjectStreams: false })
    const job = await PDFDocument.load(
      await buildPrintJobPdf(rotated, { pages: [2], includeAnnotations: false }),
    )
    expect(job.getPage(0).getRotation().angle).toBe(90)
  })

  it('opens a file protected only by an owner password, as the current print does', async () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'enc-r5-owneronly.pdf')))
    const pageCount = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount()
    const job = await PDFDocument.load(
      await buildPrintJobPdf(bytes, { pages: null, includeAnnotations: false }),
    )
    expect(job.getPageCount()).toBe(pageCount)
    expect(job.isEncrypted).toBe(false)
  })
})

describe('buildPrintJobPdf: annotations', () => {
  it('"include annotations" off leaves every annotation out, form fields included', async () => {
    const job = await PDFDocument.load(
      await buildPrintJobPdf(await source(), { pages: null, includeAnnotations: false }),
    )
    for (let i = 0; i < WIDTHS.length; i++) expect(annotCount(job, i)).toBe(0)
  })

  it('"include annotations" on bakes them into the page, the widget included', async () => {
    const src = await source()
    const before = await PDFDocument.load(src)
    expect(annotCount(before, 1)).toBe(2)
    const job = await PDFDocument.load(
      await buildPrintJobPdf(src, { pages: [2, 3], includeAnnotations: true }),
    )
    expect(widths(job)).toEqual([220, 330])
    expect(annotCount(job, 0)).toBe(0)
    expect(annotCount(job, 1)).toBe(0)
    // the baked appearances are page content now
    expect(contentLength(job, 0)).toBeGreaterThan(contentLength(before, 1))
    expect(contentLength(job, 1)).toBeGreaterThan(contentLength(before, 2))
  })

  it('never changes the bytes it was given', async () => {
    const src = await source()
    const copy = src.slice()
    await buildPrintJobPdf(src, { pages: [2], includeAnnotations: false })
    await buildPrintJobPdf(src, { pages: [2, 3], includeAnnotations: true })
    expect(Buffer.from(src).equals(Buffer.from(copy))).toBe(true)
  })
})
