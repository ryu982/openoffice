// @vitest-environment node
/**
 * Save As and the export menu write a Hangul copy (.hwp / .hwpx) of a rendered
 * Markdown document: the renderer hands over the Word bytes of its docx export
 * and the converter the shell lends turns them into a Hangul document. The
 * formats are offered only while a converter is lent; the open document keeps
 * its path, its unsaved state and its recovery identity.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const handlers = new Map<string, IpcHandler>()
const showSaveDialog = vi.fn()
const showOpenDialog = vi.fn()
const showMessageBox = vi.fn()
const showItemInFolder = vi.fn()
const webContents: FakeWebContents[] = []
let nextWebContentsId = 1

const { printMarkdownPdf, docxToOdt } = vi.hoisted(() => ({
  printMarkdownPdf: vi.fn(),
  docxToOdt: vi.fn(),
}))
vi.mock('../src/main/print-pdf', () => ({ printMarkdownPdf }))
vi.mock('@genoffice/odt-engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/odt-engine')>()),
  docxToOdt,
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

vi.mock('electron', () => ({
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
  },
  dialog: {
    showMessageBox: (...args: unknown[]) => showMessageBox(...args),
    showOpenDialog: (...args: unknown[]) => showOpenDialog(...args),
    showSaveDialog: (...args: unknown[]) => showSaveDialog(...args),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    on: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    removeHandler: vi.fn(),
  },
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn() },
  shell: {
    openExternal: vi.fn(),
    showItemInFolder: (...args: unknown[]) => showItemInFolder(...args),
  },
  WebContentsView: class {
    webContents = makeWebContents()
  },
}))

import {
  createMarkdownView,
  markdownFilePath,
  markdownIsDirty,
  markdownRecoveryIdentity,
  setMarkdownHwpExport,
  type HwpCopyLoss,
} from '../src/main/markdown-main'
import { MARKDOWN_CHANNELS } from '../src/shared/ipc'
import type { ExportResult, SaveMarkdownResult } from '../src/shared/ipc'

const temporaryDirectories: string[] = []

afterEach(() => {
  vi.clearAllMocks()
  for (const contents of webContents.splice(0)) contents.listeners.get('destroyed')?.()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const invoke = <T>(channel: string, contents: FakeWebContents, ...args: unknown[]) =>
  handlers.get(channel)!({ sender: contents }, ...args) as Promise<T>

const save = (contents: FakeWebContents, request: unknown) =>
  invoke<SaveMarkdownResult>(MARKDOWN_CHANNELS.save, contents, request)

const DOCX = Buffer.from('PK docx bytes').toString('base64')

async function openDocument(text = '# Note\n\nbody'): Promise<{
  directory: string
  mdPath: string
  contents: FakeWebContents
}> {
  const directory = mkdtempSync(join(tmpdir(), 'markdown-save-as-hwp-'))
  temporaryDirectories.push(directory)
  const mdPath = join(directory, 'note.md')
  writeFileSync(mdPath, text)
  const contents = createMarkdownView(mdPath).webContents as unknown as FakeWebContents
  expect(await invoke(MARKDOWN_CHANNELS.readFile, contents, mdPath)).toBe(text)
  // the open document has unsaved edits
  handlers.get(MARKDOWN_CHANNELS.dirtyChanged)!({ sender: contents }, true)
  return { directory, mdPath, contents }
}

const saveAsRendered = (contents: FakeWebContents) =>
  save(contents, {
    text: '# Note\n\nedited',
    imageSources: [],
    mode: 'saveAs',
    pdfHtml: '<html><body>Note</body></html>',
  })

function expectUnchanged(contents: FakeWebContents, mdPath: string, identity: unknown): void {
  expect(markdownFilePath(contents.id)).toBe(mdPath)
  expect(markdownIsDirty(contents.id)).toBe(true)
  expect(markdownRecoveryIdentity(contents.id)).toEqual(identity)
  expect(readFileSync(mdPath, 'utf8')).toBe('# Note\n\nbody')
}

const convert =
  vi.fn<
    (
      docx: Uint8Array,
      format: 'hwp' | 'hwpx',
    ) => Promise<{ bytes: Uint8Array; losses: HwpCopyLoss[] }>
  >()
const confirm = vi.fn<(parent: unknown, losses: readonly HwpCopyLoss[]) => Promise<boolean>>()

beforeEach(() => {
  convert.mockImplementation(async (_docx, format) => ({
    bytes: new TextEncoder().encode(`${format} bytes`),
    losses: [],
  }))
  confirm.mockResolvedValue(true)
  setMarkdownHwpExport({ convert, confirm })
})

const exportHwp = (contents: FakeWebContents, request: Record<string, unknown>) =>
  invoke<ExportResult>(MARKDOWN_CHANNELS.exportHwp, contents, {
    base64: DOCX,
    suggestedName: 'note',
    ...request,
  })

describe('Save As with a Hangul converter lent', () => {
  it('offers HWP and HWPX after ODT, before the page images', async () => {
    const { contents } = await openDocument()
    showSaveDialog.mockResolvedValue({ canceled: true })
    await saveAsRendered(contents)
    const options = showSaveDialog.mock.calls[0]![0] as {
      filters: Array<{ name: string; extensions: string[] }>
    }
    expect(options.filters.map((filter) => filter.extensions)).toEqual([
      ['md', 'markdown', 'txt', 'json'],
      ['pdf'],
      ['docx'],
      ['odt'],
      ['hwp'],
      ['hwpx'],
      ['png'],
    ])
    expect(options.filters.every((filter) => filter.name.length > 0)).toBe(true)
  })

  it.each(['hwp', 'hwpx'] as const)(
    '%s: approves the path without writing, then converts the Word bytes to it',
    async (format) => {
      const { directory, mdPath, contents } = await openDocument()
      const identity = markdownRecoveryIdentity(contents.id)
      const target = join(directory, `note.${format}`)
      showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })

      expect(await saveAsRendered(contents)).toEqual({ ok: true, path: target, exportAs: format })
      expect(existsSync(target)).toBe(false)
      expectUnchanged(contents, mdPath, identity)

      expect(await exportHwp(contents, { saveAsTarget: target })).toEqual({
        ok: true,
        path: target,
      })
      // no second dialog, and nothing to confirm when nothing is lost
      expect(showSaveDialog).toHaveBeenCalledTimes(1)
      expect(confirm).not.toHaveBeenCalled()
      expect(convert).toHaveBeenCalledTimes(1)
      expect(Buffer.from(convert.mock.calls[0]![0]).toString()).toBe('PK docx bytes')
      expect(convert.mock.calls[0]![1]).toBe(format)
      expect(readFileSync(target, 'utf8')).toBe(`${format} bytes`)
      // no shell to open a tab in this test: the copy is shown in its folder
      expect(showItemInFolder).toHaveBeenCalledWith(target)
      expectUnchanged(contents, mdPath, identity)

      // the approval is used once
      expect(await exportHwp(contents, { saveAsTarget: target })).toMatchObject({ ok: false })
      expect(convert).toHaveBeenCalledTimes(1)
    },
  )

  it('refuses a Save As target the dialog did not approve', async () => {
    const { directory, contents } = await openDocument()
    const elsewhere = join(directory, 'other.hwp')
    expect(await exportHwp(contents, { saveAsTarget: elsewhere })).toMatchObject({ ok: false })
    expect(convert).not.toHaveBeenCalled()
    expect(existsSync(elsewhere)).toBe(false)
  })

  it('asks before writing a copy that loses something; cancel writes nothing', async () => {
    const { directory, mdPath, contents } = await openDocument()
    const identity = markdownRecoveryIdentity(contents.id)
    const losses: HwpCopyLoss[] = [{ feature: 'hyperlink', kind: 'changed', count: 2 }]
    convert.mockResolvedValue({ bytes: new TextEncoder().encode('hwp bytes'), losses })
    const target = join(directory, 'note.hwp')

    confirm.mockResolvedValueOnce(false)
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    await saveAsRendered(contents)
    expect(await exportHwp(contents, { saveAsTarget: target })).toEqual({
      ok: true,
      canceled: true,
    })
    expect(confirm).toHaveBeenCalledWith(undefined, losses)
    expect(existsSync(target)).toBe(false)

    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    await saveAsRendered(contents)
    expect(await exportHwp(contents, { saveAsTarget: target })).toEqual({ ok: true, path: target })
    expect(readFileSync(target, 'utf8')).toBe('hwp bytes')
    expectUnchanged(contents, mdPath, identity)
  })

  it('reports a conversion that failed and writes nothing', async () => {
    const { directory, contents } = await openDocument()
    const target = join(directory, 'note.hwp')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    await saveAsRendered(contents)
    convert.mockRejectedValueOnce(new Error('the .hwp reads back with 4 pages instead of 3'))
    expect(await exportHwp(contents, { saveAsTarget: target })).toEqual({
      ok: false,
      error: 'the .hwp reads back with 4 pages instead of 3',
    })
    expect(existsSync(target)).toBe(false)
  })
})

describe('the export menu item', () => {
  it('asks where to write, the default Hangul format first, and adds it to a bare name', async () => {
    const { directory, contents } = await openDocument()
    const bare = join(directory, 'handout')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: bare })
    expect(await exportHwp(contents, {})).toEqual({ ok: true, path: `${bare}.hwp` })
    const options = showSaveDialog.mock.calls[0]![0] as {
      title: string
      defaultPath: string
      filters: Array<{ extensions: string[] }>
    }
    expect(options.title.length).toBeGreaterThan(0)
    expect(options.defaultPath.endsWith('note.hwp')).toBe(true)
    expect(options.filters.map((filter) => filter.extensions)).toEqual([['hwp'], ['hwpx']])
    expect(convert.mock.calls[0]![1]).toBe('hwp')
    expect(readFileSync(`${bare}.hwp`, 'utf8')).toBe('hwp bytes')
  })

  it('writes .hwpx when that name is picked, and nothing when the dialog is canceled', async () => {
    const { directory, contents } = await openDocument()
    const target = join(directory, 'handout.hwpx')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    expect(await exportHwp(contents, {})).toEqual({ ok: true, path: target })
    expect(convert.mock.calls[0]![1]).toBe('hwpx')

    showSaveDialog.mockResolvedValueOnce({ canceled: true })
    expect(await exportHwp(contents, {})).toEqual({ ok: true, canceled: true })
    expect(convert).toHaveBeenCalledTimes(1)
  })
})
