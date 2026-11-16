// The sheets main side of the advanced print layout: the `sheets:print-layout-*`
// handlers build the job PDF from the very request the plain print gets, the way
// the PDF export renders it (same HTML in the page, same printToPDF options), and
// hand it to the shared arranged print with the in-app printer choice. Electron
// is mocked; the shared module runs with a stand-in raster runner.
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeWindow {
  options: { webPreferences?: { javascript?: boolean } }
  loaded: string[]
  printToPdf: unknown[]
  printed: unknown[]
}

const windows: FakeWindow[] = []
const SAVE_PATH = join(tmpdir(), `sheets-print-layout-${process.pid}.pdf`)

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => resolve(import.meta.dirname, '..'),
    getPath: () => tmpdir(),
  },
  BrowserWindow: class {
    static fromWebContents() {
      return null
    }
    record: FakeWindow
    webContents: Record<string, unknown>
    constructor(options: FakeWindow['options']) {
      this.record = { options, loaded: [], printToPdf: [], printed: [] }
      windows.push(this.record)
      const record = this.record
      this.webContents = {
        printToPDF: async (opts: unknown) => {
          record.printToPdf.push(opts)
          return Buffer.from('%PDF-job')
        },
        executeJavaScript: async () => undefined,
        print: (opts: unknown, done: (ok: boolean, reason: string) => void) => {
          record.printed.push(opts)
          done(true, '')
        },
      }
    }
    async loadFile(path: string) {
      this.record.loaded.push(readFileSync(path, 'utf8'))
    }
    show() {}
    focus() {}
    isDestroyed() {
      return false
    }
    destroy() {}
  },
  dialog: {
    showSaveDialog: async () => ({ canceled: false, filePath: SAVE_PATH }),
  },
}))

import { createDefaultOptions } from '@genoffice/print-layout/plan'
import type { PrintLayoutRunner } from '@genoffice/electron-utils/print-arranged'

import { exportPdf } from '../src/main/pdf-export'
import { registerSheetsPrintLayoutIpc } from '../src/main/print-layout'

import type { IpcMainInvokeEvent } from 'electron'
import type { WorkbookExportPdfRequest } from '../src/shared/desktop-api'

const REQUEST: WorkbookExportPdfRequest = {
  fileName: 'Book1.pdf',
  html: '<!doctype html><html><head><meta charset="utf-8"></head><body><div class="page">R2C1</div></body></html>',
  landscape: true,
  pageSize: 'A4',
  margins: { top: 0, bottom: 0, left: 0, right: 0 },
  scale: 1,
}
const SHEETS_TAB = 7

type Handler = (event: unknown, raw?: unknown) => Promise<unknown>

function setup() {
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: (channel: string, listener: Handler) => {
      handlers.set(channel, listener)
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel)
    },
  }
  const runs: { kind: string; jobPdf: Uint8Array }[] = []
  const runner: PrintLayoutRunner = {
    async run(request) {
      runs.push({ kind: request.kind, jobPdf: request.jobPdf })
      if (request.kind === 'print-images') {
        return {
          kind: 'print-images',
          faces: [{ file: 'face-00001.png', widthPt: 595, heightPt: 842, rotated: true }],
        }
      }
      if (request.kind === 'preview') {
        return {
          kind: 'preview',
          faces: [{ png: new Uint8Array([9]), widthPt: 842, heightPt: 595 }],
        }
      }
      return { kind: 'pdf', pdf: new Uint8Array([37, 80, 68, 70]) }
    },
  }
  const unregister = registerSheetsPrintLayoutIpc({
    ipcMain,
    assertSender: (event) => {
      if (event.sender.id !== SHEETS_TAB) throw new Error('Untrusted IPC sender.')
    },
    runner,
    platform: 'win32',
  })
  const invoke = (channel: string, raw: unknown, senderId = SHEETS_TAB) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`no handler for ${channel}`)
    return handler({ sender: { id: senderId, send: vi.fn(), isDestroyed: () => false } }, raw)
  }
  return { handlers, invoke, runs, unregister }
}

const twoUp = () => ({ ...createDefaultOptions(), mode: 'nup' as const })

describe('sheets print layout IPC', () => {
  beforeEach(() => {
    windows.length = 0
  })
  afterAll(() => {
    rmSync(SAVE_PATH, { force: true })
  })

  it('registers the sheets channels and the shared label grid channels', () => {
    const { handlers, unregister } = setup()
    for (const name of ['preview', 'print', 'save', 'cancel']) {
      expect(handlers.has(`sheets:print-layout-${name}`)).toBe(true)
    }
    unregister()
  })

  it('print: the job PDF is the plain request rendered like the PDF export, then arranged and printed', async () => {
    // what the PDF export does with the same request
    await exportPdf({ sender: {} } as IpcMainInvokeEvent, REQUEST, SAVE_PATH)
    const exported = windows[0]!
    windows.length = 0

    const { invoke, runs, unregister } = setup()
    const result = await invoke('sheets:print-layout-print', {
      options: twoUp(),
      editor: REQUEST,
      job: { deviceName: 'Office printer', copies: 2, collate: false },
    })
    unregister()
    expect(result).toEqual({ ok: true })

    const [jobWindow, printWindow] = windows
    expect(windows).toHaveLength(2)
    // job: scripting off like the export, same page, same printToPDF options
    expect(jobWindow!.options.webPreferences).toEqual({ sandbox: true, javascript: false })
    expect(jobWindow!.loaded).toEqual(exported.loaded)
    expect(jobWindow!.loaded[0]).toContain('<div class="page">R2C1</div>')
    expect(jobWindow!.printToPdf).toEqual(exported.printToPdf)
    // the shared module got those bytes
    expect(runs).toHaveLength(1)
    expect(runs[0]!.kind).toBe('print-images')
    expect(Buffer.from(runs[0]!.jobPdf).toString()).toBe('%PDF-job')
    // the face images print on the chosen printer, whole sets
    expect(printWindow!.options.webPreferences).toEqual({ sandbox: true, javascript: true })
    expect(printWindow!.printed).toHaveLength(1)
    expect(printWindow!.printed[0]).toMatchObject({
      silent: true,
      deviceName: 'Office printer',
      copies: 2,
      collate: true,
    })
  })

  it('print without an in-app printer opens the system dialog', async () => {
    const { invoke, unregister } = setup()
    await invoke('sheets:print-layout-print', {
      options: twoUp(),
      editor: REQUEST,
      job: { deviceName: null, copies: 1, collate: true },
    })
    unregister()
    expect(windows[1]!.printed[0]).toMatchObject({ silent: false, collate: true })
    expect(windows[1]!.printed[0]).not.toHaveProperty('deviceName')
  })

  it('preview and save build the same job PDF', async () => {
    const { invoke, runs, unregister } = setup()
    const preview = await invoke('sheets:print-layout-preview', {
      options: twoUp(),
      editor: REQUEST,
    })
    expect(preview).toEqual({
      ok: true,
      faces: [{ png: new Uint8Array([9]), widthPt: 842, heightPt: 595 }],
    })
    const saved = await invoke('sheets:print-layout-save', { options: twoUp(), editor: REQUEST })
    unregister()
    expect(saved).toEqual({ ok: true, path: SAVE_PATH })
    expect(runs.map((run) => run.kind)).toEqual(['preview', 'pdf'])
    for (const run of runs) expect(Buffer.from(run.jobPdf).toString()).toBe('%PDF-job')
  })

  it('a sender that is not a sheets tab gets a failure and nothing is built', async () => {
    const { invoke, runs, unregister } = setup()
    const result = await invoke(
      'sheets:print-layout-print',
      { options: twoUp(), editor: REQUEST, job: { deviceName: 'Office printer' } },
      99,
    )
    unregister()
    expect(result).toMatchObject({ ok: false, error: 'Untrusted IPC sender.' })
    expect(windows).toHaveLength(0)
    expect(runs).toHaveLength(0)
  })

  it('a malformed job request is refused before any window opens', async () => {
    const { invoke, runs, unregister } = setup()
    const result = await invoke('sheets:print-layout-print', {
      options: twoUp(),
      editor: { ...REQUEST, html: '' },
    })
    unregister()
    expect(result).toMatchObject({ ok: false })
    expect(windows).toHaveLength(0)
    expect(runs).toHaveLength(0)
  })
})
