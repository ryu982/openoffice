/**
 * The spreadsheet AI's create_document while editors are turned off
 * (Settings → Editors and AI, AI on): a type whose editor is off is refused
 * before anything is written or handed to the host's creator, with a reason
 * the AI can pass on; a type whose editor is on is made as before. Electron
 * and the spreadsheet engine are mocked.
 */
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { setAppChoiceSource, type EditorItemId } from '@genoffice/electron-utils/app-choice'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'

type Handler = (event: { sender: unknown }, ...args: unknown[]) => unknown

const state = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  lastContents: null as unknown,
}))

class FakeContents extends EventEmitter {
  id = 952
  isDestroyed = () => false
  setWindowOpenHandler = vi.fn()
  loadURL = vi.fn()
  send = vi.fn()
}

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getName: () => 'sheets-test',
    getVersion: () => '0',
    getAppPath: () => tmpdir(),
    isPackaged: false,
    on: () => {},
    once: () => {},
    whenReady: () => new Promise(() => {}),
  },
  ipcMain: {
    handle: (channel: string, fn: Handler) => state.handlers.set(channel, fn),
    on: () => {},
    removeHandler: () => {},
  },
  BrowserWindow: class {},
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  WebContentsView: class {
    webContents = (state.lastContents = new FakeContents())
  },
  desktopCapturer: {},
  dialog: {},
  net: {},
  screen: {},
  session: {},
  shell: { showItemInFolder: () => {} },
  systemPreferences: {},
  webContents: { getAllWebContents: () => [], fromId: () => null },
}))
vi.mock('../src/main/xlsx-sidecar-client', () => ({
  XlsxSidecarClient: class {
    start(): void {}
    onProcessExit(): void {}
  },
}))
vi.mock('@genoffice/ai-provider/subscription', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-provider/subscription')>()),
  ensureSubscriptionIpc: () => ({}),
  sharedSubscriptionStatuses: () => ({}),
}))

import { configureSheetsRuntime, createSheetsView } from '../src/main/sheets-main'

const createDocument = vi.fn(async () => ({ ok: true as const, path: '/project/T.docx' }))
const writeNewDocument = vi.fn(async (_id: number, fileName: string) => `/project/${fileName}`)
const openGeneratedPath = vi.fn(() => true)

const off = (...items: EditorItemId[]) =>
  setAppChoiceSource(() => ({ off: items, aiFeatures: true, locked: false }))
const create = (request: Record<string, unknown>) =>
  state.handlers.get(IPC_CHANNELS.createDocument)!(
    { sender: state.lastContents },
    request,
  ) as Promise<{
    ok: boolean
    error?: string
    path?: string
  }>

beforeAll(() => {
  configureSheetsRuntime({
    preloadPath: '',
    rendererFile: '',
    openGeneratedPath,
    createDocument,
    writeNewDocument,
  })
  createSheetsView({ includeAiHandlers: false })
})
afterEach(() => {
  setAppChoiceSource(null)
  vi.clearAllMocks()
})

describe('sheets create_document with editors turned off', () => {
  it('refuses a worksheet export while the spreadsheet editor is off, writing nothing', async () => {
    off('sheets')
    for (const type of ['xlsx', 'csv']) {
      const result = await create({ type, title: 'T', content: 'a,b' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('turned off')
      expect(result.error).toContain('Settings → Editors and AI')
    }
    expect(writeNewDocument).not.toHaveBeenCalled()
    expect(openGeneratedPath).not.toHaveBeenCalled()
  })

  it('refuses a Word document without handing it to the host creator', async () => {
    off('docs')
    const result = await create({ type: 'docx', title: 'T', content: '<p>x</p>' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('turned off')
    expect(createDocument).not.toHaveBeenCalled()
  })

  it('makes the document as before when its editor is on', async () => {
    off('docs')
    const csv = await create({ type: 'csv', title: 'T', content: 'a,b' })
    expect(csv).toEqual({ ok: true, path: '/project/T.csv' })
    expect(openGeneratedPath).toHaveBeenCalledWith('/project/T.csv')
    const md = await create({ type: 'md', title: 'T', content: '# x' })
    expect(md.ok).toBe(true)
    expect(createDocument).toHaveBeenCalledWith(
      { type: 'md', title: 'T', content: '# x' },
      expect.any(Number),
    )
  })
})
