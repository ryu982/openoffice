// @vitest-environment node
/**
 * The print paths of the HTML main process. With nothing changed in the print
 * dialog the print goes to `printHtmlDocument` exactly as before; the advanced
 * route builds its job PDF in a window loaded the same way (scripting on, the
 * readiness probe), not in the script-free PDF export window. Electron is faked:
 * no window opens and nothing prints.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRINT_READY_SCRIPT } from '@genoffice/electron-utils/print-window'

type IpcHandler = (event: { sender: FakeWebContents }, ...args: unknown[]) => unknown

interface FakeWebContents {
  id: number
  listeners: Map<string, () => void>
  isDestroyed: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  setWindowOpenHandler: ReturnType<typeof vi.fn>
}

const { printHtmlDocument, windows } = vi.hoisted(() => ({
  printHtmlDocument: vi.fn(),
  windows: [] as Array<{
    options: unknown
    loaded: string
    scripts: string[]
    pdfOptions: Array<Record<string, unknown>>
    destroyed: boolean
  }>,
}))

const handlers = new Map<string, IpcHandler>()
const webContents: FakeWebContents[] = []
let nextWebContentsId = 1

vi.mock('../../../packages/html2docx/src', () => ({ convertHtmlToDocx: vi.fn() }))
vi.mock('../../../packages/html2docx/src/drivers/electron', () => ({
  ElectronBrowserDriver: { create: vi.fn() },
}))
vi.mock('@genoffice/electron-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/electron-utils')>()),
  printHtmlDocument,
}))

function makeWebContents(): FakeWebContents {
  const listeners = new Map<string, () => void>()
  const contents: FakeWebContents = {
    id: nextWebContentsId++,
    listeners,
    isDestroyed: vi.fn(() => false),
    loadFile: vi.fn(),
    loadURL: vi.fn(),
    once: vi.fn((event: string, listener: () => void) => listeners.set(event, listener)),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  }
  webContents.push(contents)
  return contents
}

vi.mock('electron', async () => {
  const { readFile } = await import('node:fs/promises')
  const { minimalPdf: pdfOf, pdfPageRanges: pick } = await import('./helpers/minimal-pdf')
  return {
    app: {
      getPath: vi.fn(() => tmpdir()),
      on: vi.fn(),
      quit: vi.fn(),
      whenReady: vi.fn(() => new Promise(() => {})),
    },
    BrowserWindow: class {
      static fromWebContents() {
        return null
      }
      static getFocusedWindow() {
        return null
      }
      private record = {
        options: undefined as unknown,
        loaded: '',
        scripts: [] as string[],
        pdfOptions: [] as Array<Record<string, unknown>>,
        destroyed: false,
      }
      constructor(options: unknown) {
        this.record.options = options
        windows.push(this.record)
      }
      loadFile = vi.fn(async (path: string) => {
        this.record.loaded = await readFile(path, 'utf8')
      })
      webContents = {
        executeJavaScript: vi.fn(async (script: string) => {
          this.record.scripts.push(script)
        }),
        // three A4 pages; a page range prints only those
        printToPDF: vi.fn(async (options: Record<string, unknown>) => {
          this.record.pdfOptions.push(options)
          const all = [1, 2, 3].map(() => [595, 842] as [number, number])
          const ranges = options.pageRanges
          return Buffer.from(pdfOf(typeof ranges === 'string' ? pick(all, ranges) : all))
        }),
      }
      isDestroyed = () => this.record.destroyed
      destroy = vi.fn(() => {
        this.record.destroyed = true
      })
    },
    dialog: { showMessageBox: vi.fn(), showSaveDialog: vi.fn() },
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
      on: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
      removeHandler: vi.fn(),
    },
    net: { fetch: vi.fn() },
    protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
    shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
    WebContentsView: class {
      webContents = makeWebContents()
    },
  }
})

import { createHtmlView } from '../src/main/html-main'
import { buildPreviewDocument } from '../src/main/preview-document'
import { assetBaseHref } from '../src/main/preview-protocol'
import { HTML_CHANNELS } from '../src/shared/ipc'

const temporaryDirectories: string[] = []

afterEach(() => {
  vi.clearAllMocks()
  windows.length = 0
  for (const contents of webContents.splice(0)) contents.listeners.get('destroyed')?.()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

async function openPage(): Promise<{ path: string; contents: FakeWebContents }> {
  const directory = mkdtempSync(join(tmpdir(), 'html-print-main-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'page.html')
  writeFileSync(path, '<p>saved</p>')
  const contents = createHtmlView(path).webContents as unknown as FakeWebContents
  await handlers.get(HTML_CHANNELS.readFile)!({ sender: contents }, path)
  return { path, contents }
}

const PAGE =
  '<!doctype html><html><body><script>document.body.append("built")</script></body></html>'

describe('the print with nothing changed', () => {
  it('hands printHtmlDocument the same call as before', async () => {
    const { path, contents } = await openPage()
    printHtmlDocument.mockResolvedValue({ ok: true, canceled: true })

    const result = await handlers.get(HTML_CHANNELS.printHtml)!(
      { sender: contents },
      { html: PAGE },
    )

    expect(result).toEqual({ ok: true, canceled: true })
    expect(printHtmlDocument).toHaveBeenCalledTimes(1)
    const call = printHtmlDocument.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(call).sort()).toEqual(['dirPrefix', 'fileName', 'html', 'window'])
    expect(call.html).toBe(buildPreviewDocument(PAGE, assetBaseHref(dirname(path))))
    expect(call.fileName).toBe('print.html')
    expect(call.dirPrefix).toBe('genoffice-html-print-')
    // one hidden window, scripting on (the readiness probe needs it)
    expect(windows).toHaveLength(1)
    expect(windows[0]!.options).toEqual({ show: false, webPreferences: { sandbox: true } })
  })

  it('refuses a malformed request without opening a window', async () => {
    const { contents } = await openPage()
    const result = await handlers.get(HTML_CHANNELS.printHtml)!({ sender: contents }, {})
    expect(result).toEqual({ ok: false, error: 'html: bad print request' })
    expect(printHtmlDocument).not.toHaveBeenCalled()
    expect(windows).toHaveLength(0)
  })
})

describe('the print job of the advanced route', () => {
  it('registers the html print layout channels and the shared label grid channels', async () => {
    await openPage()
    for (const channel of [
      'html:print-layout-preview',
      'html:print-layout-print',
      'html:print-layout-save',
      'html:print-layout-cancel',
      'print-layout:label-spec-get',
      'print-layout:label-spec-set',
      HTML_CHANNELS.printJobPages,
    ]) {
      expect(handlers.has(channel), channel).toBe(true)
    }
  })

  it('counts the pages in a window loaded the way the print loads the document', async () => {
    const { path, contents } = await openPage()

    const result = await handlers.get(HTML_CHANNELS.printJobPages)!(
      { sender: contents },
      { html: PAGE },
    )

    expect(result).toEqual({
      ok: true,
      pages: [1, 2, 3].map(() => ({ widthPt: 595, heightPt: 842 })),
    })
    expect(windows).toHaveLength(1)
    const win = windows[0]!
    // the print's window, not the export's `javascript: false` one
    expect(win.options).toEqual({ show: false, webPreferences: { sandbox: true } })
    expect(win.loaded).toBe(buildPreviewDocument(PAGE, assetBaseHref(dirname(path))))
    expect(win.scripts).toEqual([PRINT_READY_SCRIPT])
    expect(win.pdfOptions).toHaveLength(1)
    expect(win.pdfOptions[0]).not.toHaveProperty('pageRanges')
    expect(win.destroyed).toBe(true)
    expect(printHtmlDocument).not.toHaveBeenCalled()
  })

  it('refuses a page count request without a document', async () => {
    const { contents } = await openPage()
    const result = await handlers.get(HTML_CHANNELS.printJobPages)!({ sender: contents }, {})
    expect(result).toMatchObject({ ok: false })
    expect(windows).toHaveLength(0)
  })
})
