// @vitest-environment node
/**
 * Advanced print layout in the Markdown main process: the print job PDF is the
 * print preview's own PDF (`printMarkdownPdf` with the same HTML and paper), cut
 * to the dialog's page range by the printer's own page ranges, and an option-on
 * print or save hands it to the shared arranged print. Electron is faked: no
 * window opens and nothing is printed.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOptions, type PrintLayoutOptions } from '@genoffice/print-layout/plan'
import type {
  PrintLayoutInvokeEvent,
  PrintLayoutPrintOptions,
  PrintLayoutRunner,
  PrintLayoutWindow,
} from '@genoffice/electron-utils/print-arranged'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const electronHandlers = new Map<string, Handler>()
const userData = { dir: '' }
const PDF_BYTES = Buffer.from('%PDF-1.7 the preview')

/** The hidden windows printMarkdownPdf opens: what each loaded and how it was asked. */
const pdfWindows = vi.hoisted(
  () => [] as { options: unknown; html: string; pdfOptions: unknown; destroyed: boolean }[],
)

vi.mock('electron', () => {
  class BrowserWindow {
    record = { options: null as unknown, html: '', pdfOptions: null as unknown, destroyed: false }
    constructor(options: unknown) {
      this.record.options = options
      pdfWindows.push(this.record)
    }
    static fromWebContents() {
      return null
    }
    static getFocusedWindow() {
      return null
    }
    async loadFile(path: string) {
      const { readFileSync: read } = await import('node:fs')
      this.record.html = read(path, 'utf8')
    }
    webContents = {
      printToPDF: async (options: unknown) => {
        this.record.pdfOptions = options
        return Buffer.from('%PDF-1.7 the preview')
      },
    }
    destroy() {
      this.record.destroyed = true
    }
  }
  return {
    app: {
      on: vi.fn(),
      quit: vi.fn(),
      whenReady: () => new Promise(() => {}),
      getPath: (name: string) =>
        name === 'userData' ? userData.dir : join(tmpdir(), `markdown-test-${name}`),
      getLocale: () => 'en-US',
    },
    BrowserWindow,
    dialog: { showMessageBox: vi.fn(), showSaveDialog: vi.fn() },
    ipcMain: {
      handle: (channel: string, fn: Handler) => electronHandlers.set(channel, fn),
      on: (channel: string, fn: Handler) => electronHandlers.set(channel, fn),
      removeHandler: vi.fn(),
    },
    net: { fetch: vi.fn() },
    protocol: { handle: vi.fn() },
    shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
    WebContentsView: class {
      webContents = {
        id: 1,
        isDestroyed: () => false,
        loadFile: vi.fn(),
        loadURL: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        send: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      }
    },
  }
})

import { createMarkdownView } from '../src/main/markdown-main'
import { printMarkdownPdf } from '../src/main/print-pdf'
import { markdownJobPdf, registerMarkdownPrintLayout } from '../src/main/print-layout'
import { MARKDOWN_PRINT_OPTIONS, normalizeMarkdownPrintOptions } from '../src/shared/print-options'
import type { MarkdownPrintLayoutJob } from '../src/shared/ipc'

const HTML = '<!doctype html><html><body><p>note</p></body></html>'
const LETTER = { ...MARKDOWN_PRINT_OPTIONS, pageSize: 'Letter' as const, landscape: true }
const JOB: MarkdownPrintLayoutJob = { html: HTML, pages: null, options: LETTER, name: 'Notes' }

class FacesWindow implements PrintLayoutWindow {
  printOptions: PrintLayoutPrintOptions | null = null
  async loadFile() {}
  webContents = {
    executeJavaScript: async () => true,
    print: (options: PrintLayoutPrintOptions, done: (ok: boolean, reason: string) => void) => {
      this.printOptions = options
      done(true, '')
    },
  }
  show() {}
  focus() {}
  isDestroyed() {
    return false
  }
  destroy() {}
}

class FakeIpcMain {
  handlers = new Map<string, (event: any, ...args: any[]) => unknown>()
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown) {
    this.handlers.set(channel, listener)
  }
  removeHandler(channel: string) {
    this.handlers.delete(channel)
  }
  invoke(channel: string, event: PrintLayoutInvokeEvent, ...args: unknown[]) {
    return this.handlers.get(channel)!(event, ...args)
  }
}

const event: PrintLayoutInvokeEvent = {
  sender: { id: 7, send: () => {}, isDestroyed: () => false },
}

function options(patch: (o: PrintLayoutOptions) => void): PrintLayoutOptions {
  const o = createDefaultOptions()
  patch(o)
  return o
}

/** A runner that answers without rendering, keeping what it was asked. */
function fakeRunner(): PrintLayoutRunner & { requests: { kind: string; jobPdf: Uint8Array }[] } {
  const requests: { kind: string; jobPdf: Uint8Array }[] = []
  return {
    requests,
    run: async (request) => {
      requests.push({ kind: request.kind, jobPdf: request.jobPdf })
      if (request.kind === 'print-images') {
        return {
          kind: 'print-images',
          faces: [{ file: 'face-1.png', widthPt: 595.28, heightPt: 841.89, rotated: false }],
        }
      }
      if (request.kind === 'pdf') return { kind: 'pdf', pdf: new Uint8Array([1, 2, 3]) }
      return { kind: 'preview', faces: [] }
    },
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'genoffice-md-print-layout-'))
  userData.dir = dir
  pdfWindows.length = 0
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('printMarkdownPdf', () => {
  it('asks printToPDF exactly as before when no page range is given', async () => {
    const pdf = await printMarkdownPdf(HTML)
    expect(Buffer.from(pdf).equals(PDF_BYTES)).toBe(true)
    expect(pdfWindows).toHaveLength(1)
    expect(pdfWindows[0]!.options).toEqual({
      show: false,
      webPreferences: { sandbox: true, javascript: false },
    })
    expect(pdfWindows[0]!.html).toBe(HTML)
    expect(pdfWindows[0]!.pdfOptions).toEqual({
      pageSize: 'A4',
      printBackground: true,
      landscape: false,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
    })
    expect(pdfWindows[0]!.destroyed).toBe(true)
  })

  it('keeps only a page range of the same pagination when one is given', async () => {
    await printMarkdownPdf(HTML, LETTER, { from: 2, to: 3 })
    expect(pdfWindows[0]!.pdfOptions).toEqual({
      pageSize: 'Letter',
      printBackground: true,
      landscape: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
      pageRanges: '2-3',
    })
  })
})

describe('the Markdown print job PDF', () => {
  it('is the print preview PDF: the same HTML and paper', async () => {
    const make = vi.fn(async () => PDF_BYTES)
    const pdf = await markdownJobPdf(JOB, make)
    expect(Buffer.from(pdf).equals(PDF_BYTES)).toBe(true)
    // the preview channel's call: printMarkdownPdf(html, normalizeMarkdownPrintOptions(options))
    expect(make).toHaveBeenCalledWith(HTML, normalizeMarkdownPrintOptions(LETTER))
  })

  it('carries the dialog page range to the printer', async () => {
    const make = vi.fn(async () => PDF_BYTES)
    await markdownJobPdf({ ...JOB, pages: { from: 2, to: 2 } }, make)
    expect(make).toHaveBeenCalledWith(HTML, normalizeMarkdownPrintOptions(LETTER), {
      from: 2,
      to: 2,
    })
  })

  it('keeps the margins of the print options whatever the renderer sends', async () => {
    const make = vi.fn(async () => PDF_BYTES)
    await markdownJobPdf({ ...JOB, options: { ...LETTER, marginIn: 0 } }, make)
    expect(make).toHaveBeenCalledWith(HTML, normalizeMarkdownPrintOptions(LETTER))
  })

  it('refuses what is not a print job, before any window', async () => {
    const make = vi.fn(async () => PDF_BYTES)
    for (const bad of [
      null,
      { ...JOB, html: '' },
      { ...JOB, html: 42 },
      { ...JOB, pages: { from: 0, to: 2 } },
      { ...JOB, pages: { from: 3, to: 2 } },
      { ...JOB, pages: 'all' },
    ]) {
      await expect(markdownJobPdf(bad, make), JSON.stringify(bad)).rejects.toThrow(/markdown/)
    }
    expect(make).not.toHaveBeenCalled()
  })
})

describe('the Markdown print layout channels', () => {
  it('print the arranged preview PDF through the system dialog', async () => {
    const ipc = new FakeIpcMain()
    const facesWin = new FacesWindow()
    const runner = fakeRunner()
    const make = vi.fn(async () => PDF_BYTES)
    registerMarkdownPrintLayout({
      ipcMain: ipc,
      createPrintWindow: () => facesWin,
      pickSavePath: async () => null,
      makePdf: make,
      runner,
      platform: 'linux',
    })
    const answer = await ipc.invoke('markdown:print-layout-print', event, {
      options: options((o) => (o.reverse = true)),
      editor: JOB,
    })
    expect(answer).toEqual({ ok: true })
    expect(make).toHaveBeenCalledWith(HTML, normalizeMarkdownPrintOptions(LETTER))
    expect(runner.requests.map((r) => r.kind)).toEqual(['print-images'])
    expect(Buffer.from(runner.requests[0]!.jobPdf).equals(PDF_BYTES)).toBe(true)
    expect(facesWin.printOptions).toMatchObject({ silent: false, collate: true })
  })

  it('save the arranged PDF where the PDF dialog points, and build nothing when it is canceled', async () => {
    const ipc = new FakeIpcMain()
    const target = join(dir, 'arranged.pdf')
    const pick = vi.fn(async (): Promise<string | null> => null)
    const make = vi.fn(async () => PDF_BYTES)
    const runner = fakeRunner()
    registerMarkdownPrintLayout({
      ipcMain: ipc,
      createPrintWindow: () => new FacesWindow(),
      pickSavePath: pick,
      makePdf: make,
      runner,
    })
    const request = { options: options((o) => (o.grayscale = true)), editor: JOB }
    expect(await ipc.invoke('markdown:print-layout-save', event, request)).toEqual({
      ok: true,
      canceled: true,
    })
    expect(make).not.toHaveBeenCalled()

    pick.mockResolvedValueOnce(target)
    expect(await ipc.invoke('markdown:print-layout-save', event, request)).toEqual({
      ok: true,
      path: target,
    })
    expect(pick).toHaveBeenLastCalledWith(event, JOB)
    expect(runner.requests.map((r) => r.kind)).toEqual(['pdf'])
    expect([...readFileSync(target)]).toEqual([1, 2, 3])
  })

  it('refuse a request that is not a print job', async () => {
    const ipc = new FakeIpcMain()
    const runner = fakeRunner()
    const make = vi.fn(async () => PDF_BYTES)
    registerMarkdownPrintLayout({
      ipcMain: ipc,
      createPrintWindow: () => new FacesWindow(),
      pickSavePath: async () => null,
      makePdf: make,
      runner,
    })
    const answer = await ipc.invoke('markdown:print-layout-print', event, {
      options: options((o) => (o.reverse = true)),
      editor: { ...JOB, html: '' },
    })
    expect(answer).toMatchObject({ ok: false, error: expect.stringMatching(/markdown/) })
    expect(make).not.toHaveBeenCalled()
    expect(runner.requests).toEqual([])
  })
})

describe('the Markdown main process', () => {
  it('registers the print layout channels and the shared label store with its IPC', () => {
    createMarkdownView(join(dir, 'note.md'))
    for (const channel of [
      'markdown:print-layout-preview',
      'markdown:print-layout-print',
      'markdown:print-layout-save',
      'markdown:print-layout-cancel',
      'print-layout:label-spec-get',
      'print-layout:label-spec-set',
    ]) {
      expect(electronHandlers.has(channel), channel).toBe(true)
    }
    // the plain print and its preview keep their own channels
    expect(electronHandlers.has('markdown:print-document')).toBe(true)
    expect(electronHandlers.has('markdown:print-preview')).toBe(true)
  })
})
