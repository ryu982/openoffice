// @vitest-environment node
/**
 * The advanced print layout, the main-process side (decision 0141): the print
 * job PDF is the one page Print prints, made into a PDF the way the PDF export
 * makes it (landscape A4, no margin), and the shared print layout arranges,
 * prints and saves it. The arranging and the face pictures are real here (the
 * shared layout runs on the calling thread under the test runner); only the
 * Electron windows and the save dialog are stood in for.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readJobPageSizes } from '@genoffice/print-layout'
import { createDefaultOptions, type PrintLayoutOptions } from '@genoffice/print-layout/plan'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const showSaveDialog = vi.fn()
  const windows: FakeWindowShape[] = []
  interface FakeWindowShape {
    options: { show?: boolean; webPreferences?: Record<string, unknown> }
    html: string | null
    loadedPath: string | null
    /** the files beside the loaded page, and whether the export session would load each */
    beside: { file: string; allowed: boolean }[]
    pdfOptions: unknown
    printOptions: unknown
    destroyed: boolean
  }
  return {
    handlers,
    showSaveDialog,
    windows,
    jobPdf: new Uint8Array(),
    allowed: null as null | ((url: string) => boolean),
  }
})

vi.mock('electron', () => {
  class BrowserWindow {
    static fromWebContents = () => null
    static getFocusedWindow = () => null
    options: { show?: boolean; webPreferences?: Record<string, unknown> }
    html: string | null = null
    loadedPath: string | null = null
    beside: { file: string; allowed: boolean }[] = []
    pdfOptions: unknown = null
    printOptions: unknown = null
    destroyed = false
    constructor(options: BrowserWindow['options']) {
      this.options = options
      mocks.windows.push(this)
    }
    loadFile = async (path: string): Promise<void> => {
      this.loadedPath = path
      this.html = readFileSync(path, 'utf8')
      // what the export session would let this page load right now
      const allowed = mocks.allowed!
      this.beside = readdirSync(dirname(path)).map((file) => ({
        file,
        allowed: allowed(pathToFileURL(join(dirname(path), file)).href),
      }))
    }
    webContents = {
      printToPDF: async (options: unknown) => {
        this.pdfOptions = options
        return Buffer.from(mocks.jobPdf)
      },
      executeJavaScript: async () => true,
      print: (options: unknown, callback: (success: boolean, reason: string) => void) => {
        this.printOptions = options
        callback(true, '')
      },
    }
    show(): void {}
    focus(): void {}
    isDestroyed(): boolean {
      return this.destroyed
    }
    destroy(): void {
      this.destroyed = true
    }
  }
  return {
    app: { getPath: (name: string) => join(tmpdir(), `mindmap-print-layout-test-${name}`) },
    dialog: { showSaveDialog: (...args: unknown[]) => mocks.showSaveDialog(...args) },
    BrowserWindow,
    ipcMain: { handle: (channel: string, fn: Handler) => mocks.handlers.set(channel, fn) },
    session: { fromPartition: () => ({ webRequest: { onBeforeRequest: vi.fn() } }) },
  }
})

vi.mock('../src/main/print-layout', async (original) => {
  const real = await original<typeof import('../src/main/print-layout')>()
  return { ...real, registerMindmapPrintLayout: vi.fn(real.registerMindmapPrintLayout) }
})

import { setUiLang } from '@genoffice/i18n'
import {
  PRINT_LAYOUT_SHARED_CHANNELS,
  printLayoutChannels,
  type PrintLayoutRunner,
} from '@genoffice/electron-utils/print-arranged'
import {
  EXPORT_PARTITION,
  allowPageFolder,
  exportRequestAllowed,
  pageToPdf,
  registerMindmapExportIpc,
} from '../src/main/export-main'
import {
  mindmapJobPdf,
  printJobOf,
  registerMindmapPrintLayout,
  type MindmapPrintLayoutSetup,
} from '../src/main/print-layout'
import type { MindmapPrintJob } from '../src/shared/ipc'

mocks.allowed = exportRequestAllowed
setUiLang('en')
registerMindmapExportIpc({ filePathOf: () => undefined })
const wired = vi.mocked(registerMindmapPrintLayout).mock.calls[0]![0]

const MM = 72 / 25.4
/** The page Chromium makes of the map page: landscape A4. */
const LANDSCAPE_A4 = { w: 297 * MM, h: 210 * MM }
const JOB: MindmapPrintJob = {
  html: '<!DOCTYPE html>\n<html><body><div class="mm-page">지도</div></body></html>',
  suggestedName: 'Plan',
}

async function landscapeA4Pdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([LANDSCAPE_A4.w, LANDSCAPE_A4.h])
  page.drawRectangle({ x: 20, y: 20, width: LANDSCAPE_A4.w - 40, height: LANDSCAPE_A4.h - 40 })
  return doc.save()
}

function options(patch: (o: PrintLayoutOptions) => void): PrintLayoutOptions {
  const o = createDefaultOptions()
  patch(o)
  return o
}

const poster2x2 = () =>
  options((o) => {
    o.mode = 'poster'
    o.poster = { cols: 2, rows: 2, overlapMm: 10, cutMarks: true }
  })

const progress: unknown[] = []
const event = {
  sender: { id: 11, send: (_c: string, p: unknown) => progress.push(p), isDestroyed: () => false },
}
const channels = printLayoutChannels('mindmap')
const invoke = (channel: string, request: unknown) => mocks.handlers.get(channel)!(event, request)

let dir: string
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'genoffice-mindmap-print-layout-'))
  mocks.jobPdf = await landscapeA4Pdf()
  mocks.windows.length = 0
  mocks.showSaveDialog.mockReset()
  progress.length = 0
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('the print job PDF', () => {
  it('is the page Print prints, made the way the PDF export makes it: landscape A4, no margin', async () => {
    expect(wired.pageToPdf).toBe(pageToPdf)
    const pdf = await mindmapJobPdf(JOB, pageToPdf)
    expect(Buffer.from(pdf).equals(Buffer.from(mocks.jobPdf))).toBe(true)
    expect(mocks.windows).toHaveLength(1)
    const win = mocks.windows[0]!
    expect(win.html).toBe(JOB.html)
    expect(win.pdfOptions).toEqual({
      landscape: true,
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })
    // the export window: hidden, sandboxed, no scripts, its own session
    expect(win.options.show).toBe(false)
    expect(win.options.webPreferences).toMatchObject({ sandbox: true, javascript: false })
    expect(win.destroyed).toBe(true)
  })

  it('refuses what is not a print page before any window', async () => {
    const make = vi.fn(async () => new Uint8Array())
    for (const editor of [null, 'x', {}, { html: '' }, { html: 42 }]) {
      expect(typeof printJobOf(editor)).toBe('string')
      await expect(mindmapJobPdf(editor, make)).rejects.toThrow(/mindmap:/)
    }
    expect(make).not.toHaveBeenCalled()
    expect(printJobOf({ html: '<p>x</p>' })).toEqual({ html: '<p>x</p>', suggestedName: '' })
  })
})

describe('the mind map print layout channels', () => {
  it('are registered with the label grid store the editors share', () => {
    for (const channel of [
      channels.preview,
      channels.print,
      channels.save,
      channels.cancel,
      PRINT_LAYOUT_SHARED_CHANNELS.labelSpecGet,
      PRINT_LAYOUT_SHARED_CHANNELS.labelSpecSet,
    ]) {
      expect(mocks.handlers.has(channel), channel).toBe(true)
    }
  })

  it('print a 2 x 2 poster of the one page as four tiles, from the page Print was handed', async () => {
    const answer = await invoke(channels.print, { options: poster2x2(), editor: JOB })
    expect(answer).toEqual({ ok: true })
    const [jobWindow, facesWindow] = mocks.windows
    // the job PDF came from the very page the plain print would have printed
    expect(jobWindow!.html).toBe(JOB.html)
    // four face pictures, each a landscape A4 tile turned upright for the paper
    expect(facesWindow!.html!.match(/<img /g)).toHaveLength(4)
    const pictures = facesWindow!.beside.filter((each) => each.file.endsWith('.png'))
    expect(pictures).toHaveLength(4)
    // the export session lets the print page load its own pictures, and nothing else
    expect(facesWindow!.beside.every((each) => each.allowed)).toBe(true)
    expect(exportRequestAllowed(pathToFileURL(facesWindow!.loadedPath!).href)).toBe(false)
    expect(facesWindow!.options.webPreferences).toMatchObject({ sandbox: true, javascript: true })
    expect(facesWindow!.printOptions).toMatchObject({
      silent: false,
      collate: true,
      margins: { marginType: 'none' },
    })
    expect(facesWindow!.destroyed).toBe(true)
    expect(progress.length).toBeGreaterThan(0)
  })

  it('save the arranged PDF under the name the PDF export offers: four landscape A4 tiles', async () => {
    const target = join(dir, 'poster.pdf')
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    const answer = await invoke(channels.save, { options: poster2x2(), editor: JOB })
    expect(answer).toEqual({ ok: true, path: target })
    const dialogOptions = mocks.showSaveDialog.mock.calls[0]!.find(
      (arg: unknown) => typeof arg === 'object' && arg !== null && 'filters' in arg,
    ) as { defaultPath: string; filters: unknown }
    expect(dialogOptions.defaultPath.endsWith('Plan.pdf')).toBe(true)
    expect(dialogOptions.filters).toEqual([{ name: 'PDF', extensions: ['pdf'] }])
    const sizes = await readJobPageSizes(readFileSync(target))
    expect(sizes).toHaveLength(4)
    for (const size of sizes) {
      expect(size.widthPt).toBeCloseTo(LANDSCAPE_A4.w, 1)
      expect(size.heightPt).toBeCloseTo(LANDSCAPE_A4.h, 1)
    }
  })

  it('a canceled save dialog makes no job PDF', async () => {
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' })
    const answer = await invoke(channels.save, { options: poster2x2(), editor: JOB })
    expect(answer).toEqual({ ok: true, canceled: true })
    expect(mocks.windows).toEqual([])
  })

  it('a request without a page is refused before any dialog or window', async () => {
    for (const channel of [channels.print, channels.save, channels.preview]) {
      const answer = (await invoke(channel, { options: poster2x2(), editor: { html: '' } })) as {
        ok: boolean
      }
      expect(answer.ok, channel).toBe(false)
    }
    expect(mocks.showSaveDialog).not.toHaveBeenCalled()
    expect(mocks.windows).toEqual([])
  })
})

describe('the arranged print, with a stand-in for the layout', () => {
  it('hands the layout exactly the job PDF the page made', async () => {
    const seen: { kind: string; jobPdf: Uint8Array }[] = []
    const runner: PrintLayoutRunner = {
      run: async (request) => {
        seen.push({ kind: request.kind, jobPdf: request.jobPdf })
        return { kind: 'pdf', pdf: new Uint8Array([1]) }
      },
    }
    const handlers = new Map<string, Handler>()
    const pageToPdfSpy = vi.fn(async () => mocks.jobPdf)
    const setup: MindmapPrintLayoutSetup = {
      ipcMain: { handle: (channel, fn) => void handlers.set(channel, fn) },
      pageToPdf: pageToPdfSpy,
      createPrintWindow: () => {
        throw new Error('no window for a save')
      },
      pickSavePath: async (_event, suggestedName) => join(dir, `${suggestedName}.pdf`),
      runner,
    }
    registerMindmapPrintLayout(setup)
    const answer = await handlers.get(channels.save)!(event, {
      options: options((o) => (o.reverse = true)),
      editor: JOB,
    })
    expect(answer).toEqual({ ok: true, path: join(dir, 'Plan.pdf') })
    expect(pageToPdfSpy).toHaveBeenCalledWith(JOB.html)
    expect(seen.map((each) => each.kind)).toEqual(['pdf'])
    expect(Buffer.from(seen[0]!.jobPdf).equals(Buffer.from(mocks.jobPdf))).toBe(true)
  })
})

describe('the export session and an arranged print folder', () => {
  it('loads the files directly inside that folder while it prints, and nothing deeper or beside', () => {
    const page = join(dir, 'print.html')
    const url = (path: string) => pathToFileURL(path).href
    expect(exportRequestAllowed(url(join(dir, 'face-00001.png')))).toBe(false)
    const release = allowPageFolder(page)
    expect(exportRequestAllowed(url(page))).toBe(true)
    expect(exportRequestAllowed(url(join(dir, 'face-00001.png')))).toBe(true)
    expect(exportRequestAllowed(url(join(dir, 'deeper', 'x.png')))).toBe(false)
    expect(exportRequestAllowed(url(join(dirname(dir), 'other.png')))).toBe(false)
    expect(exportRequestAllowed('https://example.com/x.png')).toBe(false)
    release()
    expect(exportRequestAllowed(url(join(dir, 'face-00001.png')))).toBe(false)
    expect(EXPORT_PARTITION).toBe('mindmap-export')
  })
})
