// @vitest-environment node
/**
 * The EPUB editor's main side while AI is turned off (Settings): a book
 * translation a screen begins is refused with the shell's refusal; while AI
 * is on it is one 'document-job' on the shell's list of running AI work,
 * "stop all" asks the tab to stop it and waits for its end, and a closed tab
 * takes it off the list. Electron is replaced; no model is reached.
 */
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

let nextId = 1
class FakeContents extends EventEmitter {
  readonly id = nextId++
  destroyed = false
  readonly send = vi.fn()
  isDestroyed = () => this.destroyed
  setWindowOpenHandler = () => {}
  loadURL = async () => {}
  getURL = () => ''
  destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    whenReady: () => new Promise(() => {}),
    getPath: (name: string) => join(tmpdir(), name),
    getLocale: () => 'en-US',
  },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn() },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  net: {},
  BrowserWindow: { fromWebContents: () => null, getFocusedWindow: () => null },
  WebContentsView: class {
    webContents = new FakeContents()
  },
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
    on: (channel: string, fn: Handler) => handlers.set(channel, fn),
    removeHandler: vi.fn(),
  },
}))

import { runningAiJobCount, stopAllAiJobs } from '@genoffice/electron-utils/ai-activity'
import { setAiRunGuard } from '@genoffice/electron-utils/ai-run-guard'
import { setAppChoiceSource } from '@genoffice/electron-utils/app-choice'
import { configureEpubRuntime, createEpubView } from '../src/main/epub-main'
import { EPUB_CHANNELS } from '../src/shared/ipc'

const REFUSAL = 'AI features are turned off in Settings.'
const userData = mkdtempSync(join(tmpdir(), 'genoffice-epub-ai-off-'))
afterAll(() => rmSync(userData, { recursive: true, force: true }))
let aiOn = true

beforeEach(() => {
  aiOn = true
  configureEpubRuntime({
    preloadPath: '',
    userDataDir: () => userData,
    migrateJobRecords: vi.fn(async () => 0),
  })
  // what the shell sets: the choice to read, and the "ai-off" check of every AI run
  setAppChoiceSource(() => ({ off: [], aiFeatures: aiOn, locked: false }))
  setAiRunGuard('ai-off', () => (aiOn ? null : REFUSAL))
})

afterEach(async () => {
  await stopAllAiJobs()
  setAppChoiceSource(null)
  setAiRunGuard('ai-off', null)
})

const view = () =>
  createEpubView(join(userData, 'book.epub')).webContents as unknown as FakeContents
const call = (channel: string, sender: FakeContents, ...args: unknown[]) =>
  handlers.get(channel)!({ sender }, ...args)

describe('EPUB main: book translation and the AI switch', () => {
  it('refuses a translation while AI is off and lists nothing', async () => {
    const sender = view()
    aiOn = false
    expect(await call(EPUB_CHANNELS.aiJobBegin, sender, 'job-1')).toEqual({
      ok: false,
      error: REFUSAL,
    })
    expect(runningAiJobCount()).toBe(0)
  })

  it('lists a translation from its begin to its end', async () => {
    const sender = view()
    expect(await call(EPUB_CHANNELS.aiJobBegin, sender, 'job-1')).toEqual({ ok: true })
    expect(runningAiJobCount()).toBe(1)
    await call(EPUB_CHANNELS.aiJobEnd, sender, 'job-1')
    expect(runningAiJobCount()).toBe(0)
  })

  it('stop all asks the tab to stop its translation and waits for its end', async () => {
    const sender = view()
    await call(EPUB_CHANNELS.aiJobBegin, sender, 'job-1')
    const stopping = stopAllAiJobs()
    await Promise.resolve()
    expect(sender.send).toHaveBeenCalledWith(EPUB_CHANNELS.aiJobStop, 'job-1')
    await call(EPUB_CHANNELS.aiJobEnd, sender, 'job-1')
    expect(await stopping).toBe(1)
    expect(runningAiJobCount()).toBe(0)
  })

  it('a closed tab takes its translation off the list', async () => {
    const sender = view()
    await call(EPUB_CHANNELS.aiJobBegin, sender, 'job-1')
    sender.destroy()
    expect(runningAiJobCount()).toBe(0)
  })
})
