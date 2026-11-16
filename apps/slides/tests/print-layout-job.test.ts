/**
 * Advanced print (decision 0141), main side: the print job PDF is printToPDF of
 * the very print document `slides:print` hands to the system dialog, and the
 * schematic's page sizes come from that document's @page box.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isPrintSlidesOp,
  slidesPrintHtml,
  slidesPrintJobPdf,
  type PrintJobPdfWindow,
} from '../src/main/print-window'
import {
  buildPrintDocumentHtml,
  printJobPageSizes,
  printPageSizeIn,
} from '../src/shared/print-html'
import type { PrintSlidesOp } from '../src/shared/ipc'

const op = (extra: Partial<PrintSlidesOp> = {}): PrintSlidesOp => ({
  pngsBase64: ['AAAA', 'BBBB', 'CCCC'],
  widthPx: 1600,
  heightPx: 900,
  layout: 'full',
  ...extra,
})

class FakePdfWindow implements PrintJobPdfWindow {
  loadedPath: string | null = null
  loadedHtml = ''
  probed: string[] = []
  pdfOptions: unknown = null
  destroyed = false
  dirExistedAtDestroy = false
  failLoad = false

  async loadFile(path: string): Promise<void> {
    this.loadedPath = path
    this.loadedHtml = await readFile(path, 'utf8')
    if (this.failLoad) throw new Error('load failed')
  }

  webContents = {
    executeJavaScript: async (script: string): Promise<unknown> => {
      this.probed.push(script)
      return undefined
    },
    printToPDF: async (options: Electron.PrintToPDFOptions): Promise<Buffer> => {
      this.pdfOptions = options
      return Buffer.from('%PDF-1.7 job')
    },
  }

  destroy(): void {
    this.dirExistedAtDestroy = !!this.loadedPath && existsSync(dirname(this.loadedPath))
    this.destroyed = true
  }
}

describe('slidesPrintHtml (the document slides:print prints)', () => {
  it('is the shared print document built from the op, as before', () => {
    const full = op({ frame: true })
    expect(slidesPrintHtml(full)).toBe(
      buildPrintDocumentHtml({
        srcs: full.pngsBase64.map((b) => `data:image/png;base64,${b}`),
        ratio: 1600 / 900,
        layout: 'full',
        frame: true,
      }),
    )
    const notes = op({ layout: 'notes', notes: ['a', 'b', 'c'], orientation: 'landscape' })
    expect(slidesPrintHtml(notes)).toBe(
      buildPrintDocumentHtml({
        srcs: notes.pngsBase64.map((b) => `data:image/png;base64,${b}`),
        ratio: 1600 / 900,
        layout: 'notes',
        notes: ['a', 'b', 'c'],
        orientation: 'landscape',
      }),
    )
    // no layout given: full pages
    const bare: PrintSlidesOp = { pngsBase64: ['AAAA'], widthPx: 4, heightPx: 3 }
    expect(slidesPrintHtml(bare)).toBe(
      buildPrintDocumentHtml({
        srcs: ['data:image/png;base64,AAAA'],
        ratio: 4 / 3,
        layout: 'full',
      }),
    )
  })
})

describe('slidesPrintJobPdf', () => {
  it('prints the same document to PDF at its own page size and cleans up', async () => {
    const win = new FakePdfWindow()
    const handout = op({ layout: 'handout6', orientation: 'landscape' })
    const pdf = await slidesPrintJobPdf(handout, () => win)
    expect(Buffer.from(pdf).toString()).toBe('%PDF-1.7 job')
    expect(win.loadedHtml).toBe(slidesPrintHtml(handout))
    expect(win.probed).toHaveLength(1)
    expect(win.pdfOptions).toMatchObject({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })
    expect(win.destroyed).toBe(true)
    expect(win.dirExistedAtDestroy).toBe(true)
    expect(existsSync(dirname(win.loadedPath!))).toBe(false)
  })

  it('removes the window and the temp folder when loading fails', async () => {
    const win = new FakePdfWindow()
    win.failLoad = true
    await expect(slidesPrintJobPdf(op(), () => win)).rejects.toThrow('load failed')
    expect(win.destroyed).toBe(true)
    expect(existsSync(dirname(win.loadedPath!))).toBe(false)
  })

  it('refuses a malformed request without opening a window', async () => {
    let opened = false
    const create = () => {
      opened = true
      return new FakePdfWindow()
    }
    await expect(slidesPrintJobPdf(undefined, create)).rejects.toThrow()
    await expect(slidesPrintJobPdf({ ...op(), pngsBase64: [] }, create)).rejects.toThrow()
    await expect(slidesPrintJobPdf({ ...op(), layout: 'poster' }, create)).rejects.toThrow()
    expect(opened).toBe(false)
  })
})

describe('isPrintSlidesOp', () => {
  it('accepts what the print dialog sends and nothing else', () => {
    expect(isPrintSlidesOp(op())).toBe(true)
    expect(isPrintSlidesOp(op({ layout: 'notes', notes: ['x', 'y', 'z'] }))).toBe(true)
    expect(isPrintSlidesOp(op({ orientation: 'portrait', frame: true }))).toBe(true)
    expect(isPrintSlidesOp(null)).toBe(false)
    expect(isPrintSlidesOp({ ...op(), pngsBase64: [1] })).toBe(false)
    expect(isPrintSlidesOp({ ...op(), widthPx: Number.NaN })).toBe(false)
    expect(isPrintSlidesOp({ ...op(), notes: 'x' })).toBe(false)
    expect(isPrintSlidesOp({ ...op(), orientation: 'sideways' })).toBe(false)
  })
})

describe('print job page sizes', () => {
  it('full pages follow the slide ratio at 7.5in high', () => {
    expect(printPageSizeIn(16 / 9, 'full')).toEqual({ widthIn: 13.333, heightIn: 7.5 })
    expect(printPageSizeIn(4 / 3, 'full', 'landscape')).toEqual({ widthIn: 10, heightIn: 7.5 })
  })

  it('handouts and notes are A4, turned in landscape', () => {
    expect(printPageSizeIn(16 / 9, 'handout3')).toEqual({ widthIn: 8.27, heightIn: 11.69 })
    expect(printPageSizeIn(16 / 9, 'notes', 'landscape')).toEqual({
      widthIn: 11.69,
      heightIn: 8.27,
    })
  })

  it('one size per printed page, in points', () => {
    const full = printJobPageSizes(3, 16 / 9, 'full')
    expect(full).toHaveLength(3)
    expect(full[0]!.widthPt).toBeCloseTo(13.333 * 72, 6)
    expect(full[0]!.heightPt).toBeCloseTo(540, 6)
    const h6 = printJobPageSizes(7, 16 / 9, 'handout6', 'portrait')
    expect(h6).toHaveLength(2)
    expect(h6[1]!.widthPt).toBeCloseTo(8.27 * 72, 6)
    expect(h6[1]!.heightPt).toBeCloseTo(11.69 * 72, 6)
    expect(printJobPageSizes(0, 16 / 9, 'full')).toEqual([])
  })

  it('the @page box of the print document matches', () => {
    const { widthIn, heightIn } = printPageSizeIn(16 / 9, 'handout2', 'landscape')
    const html = buildPrintDocumentHtml({
      srcs: ['a'],
      ratio: 16 / 9,
      layout: 'handout2',
      orientation: 'landscape',
    })
    expect(html).toContain(`@page { size: ${widthIn}in ${heightIn}in; margin: 0; }`)
  })
})
