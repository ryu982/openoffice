// @vitest-environment node
/**
 * The HTML print job PDF (decision 0141): the page loaded the way the print
 * loads it (temp file, scripting-on window, readiness probe), printed with the
 * PDF export's paper, only a typed range's pages. The arranged print gets that
 * PDF. Windows are fakes; nothing opens or prints.
 */
import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readJobPageSizes } from '@genoffice/print-layout'
import { createDefaultOptions } from '@genoffice/print-layout/plan'
import type { PrintLayoutRunner } from '@genoffice/electron-utils/print-arranged'
import { PRINT_READY_SCRIPT } from '@genoffice/electron-utils/print-window'
import {
  HTML_JOB_PDF_OPTIONS,
  readHtmlPrintJob,
  registerHtmlPrintLayout,
  renderHtmlJobPdf,
  type HtmlJobPdfOptions,
  type HtmlJobWindow,
} from '../src/main/print-layout'
import { HTML_CHANNELS } from '../src/shared/ipc'
import { pickPrintPages, printPagesText, readPrintPageRanges } from '../src/shared/print-range'
import { minimalPdf, pdfPageRanges } from './helpers/minimal-pdf'

/** Pages the fake prints: A4 portrait, A4 landscape, Letter. */
const SIZES: Array<[number, number]> = [
  [595, 842],
  [842, 595],
  [612, 792],
]

interface FakeWindow extends HtmlJobWindow {
  loadedPath: string
  loadedHtml: string
  scripts: string[]
  pdfCalls: HtmlJobPdfOptions[]
  destroyed: boolean
}

function fakeWindow(probe: () => Promise<unknown> = async () => undefined): FakeWindow {
  const win: FakeWindow = {
    loadedPath: '',
    loadedHtml: '',
    scripts: [],
    pdfCalls: [],
    destroyed: false,
    async loadFile(path) {
      const { readFile } = await import('node:fs/promises')
      win.loadedPath = path
      win.loadedHtml = await readFile(path, 'utf8')
    },
    webContents: {
      executeJavaScript: async (script) => {
        win.scripts.push(script)
        return probe()
      },
      printToPDF: async (options) => {
        win.pdfCalls.push(options)
        const pages =
          options.pageRanges === undefined ? SIZES : pdfPageRanges(SIZES, options.pageRanges)
        return minimalPdf(pages)
      },
    },
    isDestroyed: () => win.destroyed,
    destroy: () => {
      win.destroyed = true
    },
  }
  return win
}

const DOC = '<!doctype html><html><body><script>document.body.append("x")</script></body></html>'
const sizesOf = (pairs: Array<[number, number]>) =>
  pairs.map(([widthPt, heightPt]) => ({ widthPt, heightPt }))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the HTML print job PDF', () => {
  it('loads the page from a temp file, waits for it, and prints every page', async () => {
    const win = fakeWindow()
    const job = await renderHtmlJobPdf({ document: DOC, createWindow: () => win })
    expect(win.loadedHtml).toBe(DOC)
    expect(win.loadedPath).toMatch(/print\.html$/)
    expect(win.scripts).toEqual([PRINT_READY_SCRIPT])
    expect(win.pdfCalls).toEqual([{ ...HTML_JOB_PDF_OPTIONS }])
    expect(job.pages).toEqual(sizesOf(SIZES))
    expect(await readJobPageSizes(job.pdf)).toEqual(sizesOf(SIZES))
    expect(win.destroyed).toBe(true)
    expect(existsSync(win.loadedPath)).toBe(false)
  })

  it('prints the export paper and margins', () => {
    expect(HTML_JOB_PDF_OPTIONS).toEqual({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
    })
  })

  it('still prints when the readiness probe fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const win = fakeWindow(async () => {
      throw new Error('script error')
    })
    const job = await renderHtmlJobPdf({ document: DOC, createWindow: () => win })
    expect(job.pages).toHaveLength(3)
  })

  it('prints only a typed range, past-the-end pages left out', async () => {
    const win = fakeWindow()
    const job = await renderHtmlJobPdf({
      document: DOC,
      ranges: [
        { from: 3, to: 9 },
        { from: 2, to: 2 },
      ],
      createWindow: () => win,
    })
    expect(win.pdfCalls.map((c) => c.pageRanges)).toEqual([undefined, '2-3'])
    expect(job.pages).toEqual(sizesOf([SIZES[1]!, SIZES[2]!]))
    expect(await readJobPageSizes(job.pdf)).toEqual(sizesOf([SIZES[1]!, SIZES[2]!]))
    expect(win.destroyed).toBe(true)
  })

  it('does not print twice when the range covers every page', async () => {
    const win = fakeWindow()
    const job = await renderHtmlJobPdf({
      document: DOC,
      ranges: [{ from: 1, to: 5 }],
      createWindow: () => win,
    })
    expect(win.pdfCalls).toHaveLength(1)
    expect(job.pages).toHaveLength(3)
  })

  it('refuses a range with none of the pages and still closes the window', async () => {
    const win = fakeWindow()
    await expect(
      renderHtmlJobPdf({ document: DOC, ranges: [{ from: 4, to: 6 }], createWindow: () => win }),
    ).rejects.toThrow(/none of the document's 3 pages/)
    expect(win.pdfCalls).toHaveLength(1)
    expect(win.destroyed).toBe(true)
    expect(existsSync(win.loadedPath)).toBe(false)
  })
})

describe('page ranges', () => {
  it('picks pages in document order, each once, within the document', () => {
    expect(
      pickPrintPages(
        [
          { from: 5, to: 6 },
          { from: 1, to: 2 },
          { from: 2, to: 3 },
        ],
        5,
      ),
    ).toEqual([1, 2, 3, 5])
    expect(pickPrintPages([{ from: 7, to: 9 }], 5)).toEqual([])
  })

  it('writes Chromium page range text', () => {
    expect(printPagesText([1, 2, 3, 5, 7, 8])).toBe('1-3, 5, 7-8')
    expect(printPagesText([4])).toBe('4')
  })

  it('checks a request range list', () => {
    expect(readPrintPageRanges([{ from: 1, to: 3 }])).toEqual([{ from: 1, to: 3 }])
    expect(readPrintPageRanges([])).toBeNull()
    expect(readPrintPageRanges([{ from: 3, to: 1 }])).toBeNull()
    expect(readPrintPageRanges([{ from: 0, to: 1 }])).toBeNull()
    expect(readPrintPageRanges([{ from: 1.5, to: 2 }])).toBeNull()
    expect(readPrintPageRanges('1-3')).toBeNull()
  })

  it('reads a print job and refuses a malformed one', () => {
    expect(
      readHtmlPrintJob({ html: 'x', suggestedName: 'a', ranges: [{ from: 1, to: 1 }] }),
    ).toEqual({ html: 'x', suggestedName: 'a', ranges: [{ from: 1, to: 1 }] })
    expect(() => readHtmlPrintJob({})).toThrow('html: bad print job')
    expect(() => readHtmlPrintJob({ html: 'x', ranges: [{ from: 2, to: 1 }] })).toThrow(
      'html: bad print range',
    )
  })
})

describe('the html print layout channels', () => {
  type Handler = (event: unknown, ...args: unknown[]) => unknown

  function setup() {
    const handlers = new Map<string, Handler>()
    const ipcMain = {
      handle: (channel: string, listener: Handler) => {
        if (handlers.has(channel)) throw new Error(`second handler for ${channel}`)
        handlers.set(channel, listener)
      },
      removeHandler: (channel: string) => handlers.delete(channel),
    }
    const jobs: Uint8Array[] = []
    const runner: PrintLayoutRunner = {
      run: vi.fn(async (request) => {
        jobs.push(request.jobPdf)
        return { kind: 'preview', faces: [] } as never
      }),
    }
    const windows: FakeWindow[] = []
    const documentOf = vi.fn((_event: unknown, html: string) => `<base>${html}`)
    const createPrintWindow = vi.fn()
    const pickSavePath = vi.fn(async () => null as string | null)
    const remove = registerHtmlPrintLayout({
      ipcMain,
      documentOf,
      createJobWindow: () => {
        const win = fakeWindow()
        windows.push(win)
        return win
      },
      createPrintWindow,
      pickSavePath,
      runner,
    })
    const event = { sender: { id: 4, send: vi.fn(), isDestroyed: () => false } }
    return { handlers, jobs, windows, documentOf, pickSavePath, createPrintWindow, remove, event }
  }

  it('previews from the job PDF of the typed pages of the asking view', async () => {
    const s = setup()
    const result = await s.handlers.get('html:print-layout-preview')!(s.event, {
      options: { ...createDefaultOptions(), reverse: true },
      editor: { html: '<p>a</p>', ranges: [{ from: 2, to: 2 }] },
    })
    expect(result).toEqual({ ok: true, faces: [] })
    expect(s.documentOf).toHaveBeenCalledWith(s.event, '<p>a</p>')
    expect(s.windows).toHaveLength(1)
    expect(s.windows[0]!.loadedHtml).toBe('<base><p>a</p>')
    expect(s.windows[0]!.scripts).toEqual([PRINT_READY_SCRIPT])
    expect(s.jobs).toHaveLength(1)
    expect(await readJobPageSizes(s.jobs[0]!)).toEqual(sizesOf([SIZES[1]!]))
    s.remove()
  })

  it('builds nothing for a malformed job', async () => {
    const s = setup()
    const result = await s.handlers.get('html:print-layout-print')!(s.event, {
      options: { ...createDefaultOptions(), reverse: true },
      editor: { html: 42 },
    })
    expect(result).toEqual({ ok: false, error: 'html: bad print job' })
    expect(s.windows).toHaveLength(0)
    expect(s.createPrintWindow).not.toHaveBeenCalled()
    s.remove()
  })

  it('asks for a save path with the suggested name before building', async () => {
    const s = setup()
    const result = await s.handlers.get('html:print-layout-save')!(s.event, {
      options: { ...createDefaultOptions(), reverse: true },
      editor: { html: '<p>a</p>', suggestedName: 'report' },
    })
    expect(result).toEqual({ ok: true, canceled: true })
    expect(s.pickSavePath).toHaveBeenCalledWith(s.event, 'report')
    expect(s.windows).toHaveLength(0)
    s.remove()
  })

  it('answers the page count of every page and removes its channel', async () => {
    const s = setup()
    const result = await s.handlers.get(HTML_CHANNELS.printJobPages)!(s.event, {
      html: '<p>a</p>',
    })
    expect(result).toEqual({ ok: true, pages: sizesOf(SIZES) })
    expect(await s.handlers.get(HTML_CHANNELS.printJobPages)!(s.event, {})).toEqual({
      ok: false,
      error: 'html: bad print request',
    })
    s.remove()
    expect(s.handlers.size).toBe(0)
  })
})
