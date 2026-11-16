// @vitest-environment node
/**
 * Advanced print layout in the main process: the job PDF is the print
 * document of the pages the renderer sent (the plain print's and the PDF
 * export's own HTML) made by printToPDF in a hidden window of the diagram's
 * session; the arranged result prints, previews and saves through the shared
 * module. Electron is faked: no window opens and nothing is printed.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOptions, type PrintLayoutOptions } from '@genoffice/print-layout/plan'
import type {
  PrintLayoutInvokeEvent,
  PrintLayoutIpcHandlers,
  PrintLayoutPrintOptions,
  PrintLayoutRunner,
  PrintLayoutWindow,
} from '@genoffice/electron-utils/print-arranged'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const electronHandlers = new Map<string, Handler>()
const userData = { dir: '' }

interface FakeWindow {
  options: { webPreferences?: Record<string, unknown> }
  url: string | null
  html: string | null
  pdfOptions: unknown
  destroyed: boolean
}
const windows: FakeWindow[] = []
/** the protocol's part: the one-time print document behind a loaded address */
const served = { take: (_token: string): string | null => null }

vi.mock('electron', () => {
  class BrowserWindow {
    static fromWebContents = () => null
    static getFocusedWindow = () => null
    url: string | null = null
    html: string | null = null
    pdfOptions: unknown = null
    destroyed = false
    webContents = {
      setWindowOpenHandler: () => {},
      on: () => {},
      getURL: () => this.url ?? '',
      executeJavaScript: async () => true,
      print: () => {
        throw new Error('the job window never prints')
      },
      printToPDF: async (options: unknown) => {
        this.pdfOptions = options
        return Buffer.from('%PDF-1.4 the job')
      },
    }
    constructor(public options: FakeWindow['options']) {
      windows.push(this as unknown as FakeWindow)
    }
    isDestroyed() {
      return this.destroyed
    }
    destroy() {
      this.destroyed = true
    }
    async loadURL(url: string) {
      this.url = url
      this.html = served.take(url.slice(url.lastIndexOf('/') + 1))
    }
    show() {}
    focus() {}
  }
  return {
    BrowserWindow,
    app: { getPath: () => userData.dir, on: vi.fn() },
    dialog: { showMessageBox: vi.fn(), showSaveDialog: vi.fn() },
    ipcMain: {
      handle: (channel: string, fn: Handler) => electronHandlers.set(channel, fn),
      removeHandler: (channel: string) => electronHandlers.delete(channel),
    },
  }
})
const saveDialog = vi.hoisted(() => vi.fn())
vi.mock('@genoffice/electron-utils', () => ({
  configuredDefaultSaveDir: () => 'C:/Documents',
  showSaveDialogWithMemory: saveDialog,
}))
vi.mock('@genoffice/electron-utils/print-window', () => ({ PRINT_READY_SCRIPT: '' }))
vi.mock('@genoffice/electron-utils/atomic-write', () => ({ atomicWriteFile: vi.fn() }))
/** the handlers the diagram registers for its print layout channels */
const registered = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@genoffice/electron-utils/print-arranged', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@genoffice/electron-utils/print-arranged')>()
  return {
    ...actual,
    registerPrintLayoutIpc: (prefix: string, handlers: PrintLayoutIpcHandlers<unknown>) => {
      registered.set(prefix, handlers)
      return actual.registerPrintLayoutIpc(prefix, handlers)
    },
  }
})

import { atomicWriteFile } from '@genoffice/electron-utils/atomic-write'
import { registerDiagramExportIpc } from '../src/main/export-main'
import { DIAGRAM_PARTITION } from '../src/main/network-guard'
import { buildPrintHtml, takePrintDocument } from '../src/main/print-document'
import { diagramJobPdf, registerDiagramPrintLayout } from '../src/main/print-layout'
import { DIAGRAM_CHANNELS, type DiagramPrintJob, type PrintPage } from '../src/shared/ipc'

served.take = takePrintDocument

const svg = (id: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" id="${id}" width="10" height="10"></svg>`
/** A4 portrait, then A4 landscape: each page keeps its own sheet. */
const PAGES: PrintPage[] = [
  { svg: svg('p1'), width: 400, height: 300, pageWidth: 827, pageHeight: 1169 },
  { svg: svg('p2'), width: 300, height: 200, pageWidth: 1169, pageHeight: 827 },
]
const JOB: DiagramPrintJob = { pages: PAGES, title: 'Flow' }

const event: PrintLayoutInvokeEvent = {
  sender: { id: 7, send: () => {}, isDestroyed: () => false },
}

function options(patch: (o: PrintLayoutOptions) => void): PrintLayoutOptions {
  const o = createDefaultOptions()
  patch(o)
  return o
}

class FakeIpcMain {
  handlers = new Map<string, (event: any, ...args: any[]) => unknown>()
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown) {
    this.handlers.set(channel, listener)
  }
  removeHandler(channel: string) {
    this.handlers.delete(channel)
  }
  invoke(channel: string, ...args: unknown[]) {
    return this.handlers.get(channel)!(event, ...args)
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
          faces: [{ file: 'face-1.png', widthPt: 595.44, heightPt: 841.68, rotated: false }],
        }
      }
      if (request.kind === 'pdf') return { kind: 'pdf', pdf: new Uint8Array([1, 2, 3]) }
      return { kind: 'preview', faces: [] }
    },
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'genoffice-diagram-print-layout-'))
  userData.dir = dir
  windows.length = 0
  saveDialog.mockReset()
  if (!electronHandlers.has(DIAGRAM_CHANNELS.print)) {
    registerDiagramExportIpc({ filePathOf: () => undefined })
  }
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const diagramHandlers = () => registered.get('diagram') as PrintLayoutIpcHandlers<DiagramPrintJob>

describe('the diagram main process', () => {
  it('registers the print layout channels and the shared label store next to Print', () => {
    for (const channel of [
      'diagram:print-layout-preview',
      'diagram:print-layout-print',
      'diagram:print-layout-save',
      'diagram:print-layout-cancel',
      'print-layout:label-spec-get',
      'print-layout:label-spec-set',
      // the plain print and the PDF export keep their own channels
      DIAGRAM_CHANNELS.print,
      DIAGRAM_CHANNELS.exportPdf,
    ]) {
      expect(electronHandlers.has(channel), channel).toBe(true)
    }
  })

  it('makes the job PDF from the print HTML in a hidden window of the diagram session', async () => {
    const pdf = await diagramHandlers().buildJobPdf(event, JOB)
    expect(new TextDecoder().decode(pdf)).toBe('%PDF-1.4 the job')
    expect(windows).toHaveLength(1)
    const win = windows[0]!
    expect(win.options.webPreferences).toMatchObject({
      partition: DIAGRAM_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    })
    expect(win.url).toMatch(/^drawio-app:\/\/editor\/__ieum\/print\/[0-9a-f]{32}$/)
    // the same document the plain print and the PDF export show: light, one sheet per page size
    expect(win.html).toBe(buildPrintHtml(PAGES, 'Flow'))
    expect(win.html).toContain('@page p1 { size: 8.27in 11.69in; margin: 0; }')
    expect(win.html).toContain('@page p2 { size: 11.69in 8.27in; margin: 0; }')
    expect(win.html).toContain('color-scheme: light')
    expect(win.pdfOptions).toEqual({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })
    expect(win.destroyed).toBe(true)
  })

  it('refuses what is not a print job before any window opens', async () => {
    await expect(diagramHandlers().buildJobPdf(event, undefined)).rejects.toThrow(/bad print/)
    await expect(
      diagramHandlers().buildJobPdf(event, { pages: [{ svg: 'x' }] } as never),
    ).rejects.toThrow(/bad print/)
    await expect(diagramHandlers().buildJobPdf(event, { pages: [] })).rejects.toThrow(/bad print/)
    expect(windows).toHaveLength(0)
  })

  it('prints the arranged faces from a hidden window that can load their files', () => {
    diagramHandlers().createPrintWindow(event)
    expect(windows).toHaveLength(1)
    const prefs = windows[0]!.options.webPreferences ?? {}
    // the diagram session lets only the app's own schemes through, not the face files
    expect(prefs.partition).toBeUndefined()
    expect(prefs).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false })
  })

  it('saves where the PDF export would, under the diagram name', async () => {
    saveDialog.mockResolvedValueOnce({ canceled: false, filePath: 'C:/Out/flow' })
    expect(await diagramHandlers().pickSavePath(event, JOB)).toBe('C:/Out/flow.pdf')
    expect(saveDialog.mock.calls[0]![2]).toMatchObject({
      defaultPath: join('C:/Documents', 'Flow.pdf'),
      filters: [{ extensions: ['pdf'] }],
    })
    saveDialog.mockResolvedValueOnce({ canceled: true })
    expect(await diagramHandlers().pickSavePath(event, JOB)).toBeNull()
  })
})

describe('the diagram print layout channels', () => {
  it('print the arranged job PDF through the system dialog', async () => {
    const ipc = new FakeIpcMain()
    const render = vi.fn(async () => new Uint8Array([9, 9]))
    const faces = new FacesWindow()
    const runner = fakeRunner()
    registerDiagramPrintLayout({
      ipcMain: ipc,
      renderJobPdf: render,
      createPrintWindow: () => faces,
      pickSavePath: async () => null,
      runner,
      platform: 'linux',
    })
    const answer = await ipc.invoke('diagram:print-layout-print', {
      options: options((o) => (o.reverse = true)),
      editor: JOB,
    })
    expect(answer).toEqual({ ok: true })
    expect(render).toHaveBeenCalledWith(PAGES, 'Flow')
    expect(runner.requests.map((r) => [r.kind, [...r.jobPdf]])).toEqual([['print-images', [9, 9]]])
    expect(faces.printOptions).toMatchObject({ silent: false, collate: true })
  })

  it('save the arranged PDF under the diagram name, and make nothing when the dialog is canceled', async () => {
    const ipc = new FakeIpcMain()
    const target = join(dir, 'arranged.pdf')
    const pick = vi.fn(async (): Promise<string | null> => null)
    const render = vi.fn(async () => new Uint8Array([9, 9]))
    const runner = fakeRunner()
    registerDiagramPrintLayout({
      ipcMain: ipc,
      renderJobPdf: render,
      createPrintWindow: () => new FacesWindow(),
      pickSavePath: pick,
      runner,
    })
    const request = { options: options((o) => (o.grayscale = true)), editor: JOB }
    expect(await ipc.invoke('diagram:print-layout-save', request)).toEqual({
      ok: true,
      canceled: true,
    })
    expect(render).not.toHaveBeenCalled()
    pick.mockResolvedValueOnce(target)
    expect(await ipc.invoke('diagram:print-layout-save', request)).toEqual({
      ok: true,
      path: target,
    })
    expect(pick).toHaveBeenLastCalledWith(event, 'Flow')
    expect(runner.requests.map((r) => r.kind)).toEqual(['pdf'])
    // the arranged PDF is written once, at the chosen path
    expect(atomicWriteFile).toHaveBeenCalledTimes(1)
    const [path, bytes] = vi.mocked(atomicWriteFile).mock.calls[0]!
    expect(path).toBe(target)
    expect([...(bytes as Uint8Array)]).toEqual([1, 2, 3])
  })

  it('refuse a request whose pages are not a print job', async () => {
    const render = vi.fn(async () => new Uint8Array([9]))
    await expect(diagramJobPdf({ pages: 'all' }, render)).rejects.toThrow(/bad print pages/)
    const ipc = new FakeIpcMain()
    const runner = fakeRunner()
    registerDiagramPrintLayout({
      ipcMain: ipc,
      renderJobPdf: render,
      createPrintWindow: () => new FacesWindow(),
      pickSavePath: async () => null,
      runner,
    })
    const answer = await ipc.invoke('diagram:print-layout-print', {
      options: options((o) => (o.reverse = true)),
      editor: { pages: [] },
    })
    expect(answer).toMatchObject({ ok: false, error: expect.stringMatching(/bad print pages/) })
    expect(render).not.toHaveBeenCalled()
    expect(runner.requests).toEqual([])
  })
})
