// @vitest-environment node
/**
 * Advanced print layout in the main process: the print job PDF is the PDF export's own
 * (the pages' printable HTML through printToPDF, each page on its own paper), and an
 * option-on print or save hands that PDF to the shared arranged print. Electron is
 * faked: no window opens and nothing is printed.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    whenReady: () => new Promise(() => {}),
    getPath: (name: string) =>
      name === 'userData' ? userData.dir : join(tmpdir(), `hwp-test-${name}`),
    getLocale: () => 'en-US',
  },
  dialog: { showMessageBox: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  net: {},
  ipcRenderer: {},
  webUtils: {},
  BrowserWindow: { fromWebContents: () => null, getFocusedWindow: () => null },
  WebContentsView: class {
    webContents = {
      id: 1,
      isDestroyed: () => false,
      setWindowOpenHandler: () => {},
      loadURL: async () => {},
      send: () => {},
      on: () => {},
      once: () => {},
    }
  },
  ipcMain: {
    handle: (channel: string, fn: Handler) => electronHandlers.set(channel, fn),
    on: (channel: string, fn: Handler) => electronHandlers.set(channel, fn),
    removeHandler: vi.fn(),
  },
}))

vi.mock('@genoffice/file-parse', () => ({
  hwpToText: vi.fn(async () => ''),
  parseFileToText: vi.fn(async () => ({ kind: 'text', text: '' })),
  ATTACHABLE_EXTS: new Set<string>(),
  ATTACHABLE_IMAGE_EXTS: new Set<string>(),
  ATTACHABLE_MAX_BYTES: 25 * 1024 * 1024,
  attachableMaxBytes: () => 25 * 1024 * 1024,
  ATTACHABLE_IMAGE_MAX_BYTES: 5 * 1024 * 1024,
}))

import { createHwpView } from '../src/main/hwp-main'
import { printableHtml } from '../src/main/print-document'
import type { PrintWindow } from '../src/main/print-document'
import { hwpJobPdf, registerHwpPrintLayout } from '../src/main/print-layout'
import type { PrintJob } from '../src/shared/ipc'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
/** A4 portrait, then A4 landscape: each page keeps its own paper. */
const JOB: PrintJob = {
  mode: 'pdf',
  pages: [
    {
      svg: '<svg id="a"><image href="ieum-image:0"/></svg>',
      width: 793.7,
      height: 1122.5,
    },
    { svg: '<svg id="a"></svg>', width: 1122.5, height: 793.7 },
  ],
  images: [PNG],
}
const JOB_PDF = Buffer.from('%PDF-1.7 the job')

/** The PDF export's hidden window: what it loaded, and how printToPDF was asked. */
class JobWindow {
  html: string | null = null
  pdfOptions: unknown = null
  destroyed = false
  async loadFile(path: string) {
    this.html = readFileSync(path, 'utf8')
  }
  webContents = {
    printToPDF: async (options: unknown) => {
      this.pdfOptions = options
      return JOB_PDF
    },
    print: () => {
      throw new Error('the job window never prints')
    },
  }
  destroy() {
    this.destroyed = true
  }
}

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
  dir = mkdtempSync(join(tmpdir(), 'genoffice-hwp-print-layout-'))
  userData.dir = dir
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the Hangul print job PDF', () => {
  it('is the PDF export: the printable HTML through printToPDF, each page on its paper', async () => {
    const win = new JobWindow()
    const pdf = await hwpJobPdf(JOB, () => win as unknown as PrintWindow)
    expect(Buffer.from(pdf).equals(JOB_PDF)).toBe(true)
    expect(win.html).toBe(printableHtml(JOB.pages, (index) => `image-${index}.png`))
    expect(win.html).toContain('@page p0 { size: 210mm 297mm; margin: 0; }')
    expect(win.html).toContain('@page p1 { size: 297mm 210mm; margin: 0; }')
    expect(win.pdfOptions).toEqual({
      preferCSSPageSize: true,
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })
    expect(win.destroyed).toBe(true)
  })

  it('carries only the pages: no preview marks reach it', async () => {
    const win = new JobWindow()
    await hwpJobPdf({ ...JOB, mode: 'print' }, () => win as unknown as PrintWindow)
    expect(win.html).not.toContain('hwp-preview')
    expect(win.html).not.toMatch(/<script/)
  })

  it('refuses what is not a print job, before any window', async () => {
    const make = vi.fn(() => new JobWindow() as unknown as PrintWindow)
    await expect(hwpJobPdf({ mode: 'pdf', pages: [], images: [] }, make)).rejects.toThrow(
      /no pages/,
    )
    await expect(hwpJobPdf(null, make)).rejects.toThrow(/not a print job/)
    expect(make).not.toHaveBeenCalled()
  })
})

describe('the Hangul print layout channels', () => {
  it('print the arranged job PDF through the system dialog', async () => {
    const ipc = new FakeIpcMain()
    const jobWin = new JobWindow()
    const facesWin = new FacesWindow()
    const runner = fakeRunner()
    registerHwpPrintLayout({
      ipcMain: ipc,
      createJobWindow: () => jobWin as unknown as PrintWindow,
      createPrintWindow: () => facesWin,
      pickSavePath: async () => null,
      runner,
      platform: 'linux',
    })
    const answer = await ipc.invoke('hwp:print-layout-print', event, {
      options: options((o) => (o.reverse = true)),
      editor: JOB,
    })
    expect(answer).toEqual({ ok: true })
    expect(jobWin.html).toBe(printableHtml(JOB.pages, (index) => `image-${index}.png`))
    expect(runner.requests.map((r) => r.kind)).toEqual(['print-images'])
    expect(Buffer.from(runner.requests[0]!.jobPdf).equals(JOB_PDF)).toBe(true)
    expect(facesWin.printOptions).toMatchObject({ silent: false, collate: true })
  })

  it('save the arranged PDF where the PDF dialog points, and make nothing when it is canceled', async () => {
    const ipc = new FakeIpcMain()
    const target = join(dir, 'arranged.pdf')
    const pick = vi.fn(async (): Promise<string | null> => null)
    const makeJobWindow = vi.fn(() => new JobWindow() as unknown as PrintWindow)
    const runner = fakeRunner()
    registerHwpPrintLayout({
      ipcMain: ipc,
      createJobWindow: makeJobWindow,
      createPrintWindow: () => new FacesWindow(),
      pickSavePath: pick,
      runner,
    })
    const request = { options: options((o) => (o.grayscale = true)), editor: JOB }
    expect(await ipc.invoke('hwp:print-layout-save', event, request)).toEqual({
      ok: true,
      canceled: true,
    })
    expect(makeJobWindow).not.toHaveBeenCalled()

    pick.mockResolvedValueOnce(target)
    expect(await ipc.invoke('hwp:print-layout-save', event, request)).toEqual({
      ok: true,
      path: target,
    })
    expect(pick).toHaveBeenLastCalledWith(event)
    expect(runner.requests.map((r) => r.kind)).toEqual(['pdf'])
    expect([...readFileSync(target)]).toEqual([1, 2, 3])
  })

  it('refuse a request whose pages are not a print job', async () => {
    const ipc = new FakeIpcMain()
    const runner = fakeRunner()
    registerHwpPrintLayout({
      ipcMain: ipc,
      createJobWindow: () => new JobWindow() as unknown as PrintWindow,
      createPrintWindow: () => new FacesWindow(),
      pickSavePath: async () => null,
      runner,
    })
    const answer = await ipc.invoke('hwp:print-layout-print', event, {
      options: options((o) => (o.reverse = true)),
      editor: { mode: 'pdf', pages: 'all', images: [] },
    })
    expect(answer).toMatchObject({ ok: false, error: expect.stringMatching(/no pages/) })
    expect(runner.requests).toEqual([])
  })
})

describe('the Hangul main process', () => {
  it('registers the print layout channels and the shared label store with its IPC', () => {
    createHwpView(join(dir, 'report.hwpx'))
    for (const channel of [
      'hwp:print-layout-preview',
      'hwp:print-layout-print',
      'hwp:print-layout-save',
      'hwp:print-layout-cancel',
      'print-layout:label-spec-get',
      'print-layout:label-spec-set',
    ]) {
      expect(electronHandlers.has(channel), channel).toBe(true)
    }
    // the plain print and PDF export keep their own channel
    expect(electronHandlers.has('hwp:print-pages')).toBe(true)
    expect(existsSync(join(dir, 'print-label-spec.json'))).toBe(false)
  })
})
