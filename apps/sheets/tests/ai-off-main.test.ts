/**
 * AI turned off in Settings (the shell's 'ai-off' check): the sheets main
 * refuses the AI work a tab asks for, and counts the work it lets run so that
 * turning AI off stops it. The tool, the stream, and the sidecar are mocked —
 * nothing here starts a real program.
 */
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'

type Handler = (event: { sender: FakeContents }, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
let lastContents: FakeContents
let nextId = 900
class FakeContents extends EventEmitter {
  id = ++nextId
  destroyed = false
  isDestroyed = () => this.destroyed
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
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
    on: () => {},
    removeHandler: () => {},
  },
  BrowserWindow: class {},
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  WebContentsView: class {
    webContents = (lastContents = new FakeContents())
  },
  desktopCapturer: {},
  dialog: {},
  net: {},
  screen: {},
  session: {},
  shell: {},
  systemPreferences: {},
  webContents: { getAllWebContents: () => [], fromId: () => null },
}))

// no spreadsheet engine process: a tab only needs a client object to exist
vi.mock('../src/main/xlsx-sidecar-client', () => ({
  XlsxSidecarClient: class {
    start(): void {}
    onProcessExit(): void {}
  },
}))

const generateImageTool = vi.fn()
vi.mock('@genoffice/ai-search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-search')>()),
  generateImageTool: (...args: unknown[]) => generateImageTool(...args),
}))

/** the provider stream: stays in flight until its signal aborts */
const streamForProvider = vi.fn(
  (...args: unknown[]) =>
    new Promise<void>((resolve) => {
      const { signal } = args[6] as { signal: AbortSignal }
      signal.addEventListener('abort', () => resolve())
    }),
)
vi.mock('@genoffice/ai-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-provider')>()),
  streamForProvider: (...args: unknown[]) => streamForProvider(...args),
}))

// a selection that can run, without looking for any program
vi.mock('../src/main/ai-run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/ai-run')>()
  return {
    ...actual,
    resolveAiRunTarget: (settings: unknown) => ({
      ok: true,
      provider: 'anthropic',
      config: { model: '' },
      settings,
    }),
  }
})

vi.mock('@genoffice/ai-provider/subscription', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-provider/subscription')>()),
  ensureSubscriptionIpc: () => ({}),
  sharedSubscriptionStatuses: () => ({}),
}))

import { defaultAiSettings } from '@genoffice/ai-provider'
import { runningAiJobCount, stopAllAiJobs } from '@genoffice/electron-utils/ai-activity'
import { setAiRunGuard } from '@genoffice/electron-utils/ai-run-guard'
import { createSheetsView } from '../src/main/sheets-main'

const AI_OFF = 'AI is turned off.'
const turnAiOff = () => setAiRunGuard('ai-off', () => AI_OFF)

/** a new tab of the standalone app (this main answers ai:stream itself) */
function newTab(): FakeContents {
  createSheetsView({ includeAiHandlers: true })
  return lastContents
}

beforeEach(() => {
  generateImageTool.mockReset()
  streamForProvider.mockClear()
})

afterEach(async () => {
  setAiRunGuard('ai-off', null)
  await stopAllAiJobs()
})

describe('sheets:ai-generate-image and AI turned off', () => {
  it('is refused without running the tool', async () => {
    turnAiOff()
    const sender = newTab()
    const result = await handlers.get(IPC_CHANNELS.aiGenerateImage)!(
      { sender },
      { prompt: 'a red kite' },
    )
    expect(result).toEqual({ error: AI_OFF, errorCode: 'unavailable' })
    expect(generateImageTool).not.toHaveBeenCalled()
    expect(runningAiJobCount()).toBe(0)
  })

  it('runs while AI is on, counted as one AI job that turning AI off stops', async () => {
    let answer!: (value: unknown) => void
    generateImageTool.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    const sender = newTab()
    const result = handlers.get(IPC_CHANNELS.aiGenerateImage)!({ sender }, { prompt: 'a red kite' })
    const { signal } = generateImageTool.mock.calls.at(-1)![2] as { signal: AbortSignal }
    expect(runningAiJobCount()).toBe(1)

    const stopping = stopAllAiJobs()
    expect(signal.aborted).toBe(true)
    answer({ error: 'cancelled' })
    expect(await stopping).toBe(1)
    await result
    expect(runningAiJobCount()).toBe(0)
  })
})

describe('ai:stream (the standalone app) and AI turned off', () => {
  const request = (requestId: string) => ({
    requestId,
    settings: defaultAiSettings(),
    system: 'sys',
    messages: [{ role: 'user', text: 'hello' }],
  })

  it('refuses the turn with the shell refusal and starts no stream', async () => {
    turnAiOff()
    const sender = newTab()
    await handlers.get(IPC_CHANNELS.aiStream)!({ sender }, request('r-off'))
    expect(streamForProvider).not.toHaveBeenCalled()
    expect(sender.send).toHaveBeenCalledWith(IPC_CHANNELS.aiStreamChunk, {
      requestId: 'r-off',
      type: 'error',
      error: AI_OFF,
    })
    expect(runningAiJobCount()).toBe(0)
  })

  it('counts a running turn as one AI job, which "stop all" ends', async () => {
    const sender = newTab()
    const turn = handlers.get(IPC_CHANNELS.aiStream)!({ sender }, request('r-on'))
    await vi.waitFor(() => expect(streamForProvider).toHaveBeenCalledTimes(1))
    const { signal } = streamForProvider.mock.calls[0]![6] as { signal: AbortSignal }
    expect(runningAiJobCount()).toBe(1)

    expect(await stopAllAiJobs()).toBe(1)
    expect(signal.aborted).toBe(true)
    await turn
    expect(runningAiJobCount()).toBe(0)
  })
})
