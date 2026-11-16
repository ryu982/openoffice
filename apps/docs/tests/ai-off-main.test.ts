// @vitest-environment node
/**
 * The shared AI backend (docs main) behind the AI-off switch (Settings ›
 * Editors and AI). Every editor's chat stream, and the docs tab's picture and
 * media calls, is one running AI job while it runs, and turning AI off stops
 * it through the same path as the screen's Stop. While AI is off the calls a
 * screen can still send are refused before any provider or program is
 * reached. Providers and tools are fakes: nothing here starts a real CLI.
 */
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: { sender: FakeContents }, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getName: () => 'docs-test',
    getVersion: () => '0',
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
  WebContentsView: class {},
  clipboard: {},
  dialog: {},
  nativeImage: {},
  net: {},
  session: {},
  shell: {},
  webContents: { getAllWebContents: () => [], fromId: () => null },
}))

const generateImageTool = vi.fn()
const analyzeMediaTool = vi.fn()
vi.mock('@genoffice/ai-search', async () => ({
  ...(await import('../../../packages/ai-search/src/media-call-abort')),
  generateImageTool: (...args: unknown[]) => generateImageTool(...args),
  analyzeMediaTool: (...args: unknown[]) => analyzeMediaTool(...args),
  documentMediaRoots: () => [],
  createCodexImageGenerator: () => ({ generate: async () => null, models: async () => null }),
  registerCodexImageGenerator: () => {},
}))

const streamForProvider = vi.fn()
const chatForProvider = vi.fn()
vi.mock('@genoffice/ai-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-provider')>()),
  streamForProvider: (...args: unknown[]) => streamForProvider(...args),
  chatForProvider: (...args: unknown[]) => chatForProvider(...args),
}))
// every request resolves to a ready key provider: the switch, not the selection, is under test
vi.mock('../src/main/ai-run', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/ai-run')>()),
  resolveAiRun: (settings: unknown) => ({
    ok: true,
    settings,
    provider: 'anthropic',
    config: { model: 'test-model' },
  }),
}))

const listCodexModels = vi.fn(async () => ({ models: [] }))
// the status-check program, the model lister and a login's cancel path, as fakes that count
const detectSubscriptionLogin = vi.fn(async (provider: string) => ({
  provider,
  state: 'signed-out',
}))
const listSubscriptionModels = vi.fn(async () => undefined)
const cancelLogin = vi.fn(async () => ({ ok: true }))
interface CapturedSetup {
  detect: (provider: string) => Promise<{ state: string }>
  listModels: (provider: string) => Promise<unknown>
}
let subscriptionSetup: CapturedSetup | null = null
vi.mock('@genoffice/ai-provider/subscription', () => ({
  ensureSubscriptionIpc: (_ipc: unknown, setup: CapturedSetup) => {
    subscriptionSetup = setup
    return { cancelLogin }
  },
  sharedSubscriptionStatuses: () => ({}),
  detectSubscriptionLogin: (provider: string) => detectSubscriptionLogin(provider),
  listSubscriptionModels: () => listSubscriptionModels(),
  subscriptionStatusErrorText: (kind: string, detail: string) => `${kind}: ${detail}`,
}))
vi.mock('@genoffice/ai-provider/codex-app-server', () => ({
  shutdownCodexAppServers: () => {},
  listCodexModels: () => listCodexModels(),
}))
vi.mock('@genoffice/ai-provider/custom-models', () => ({}))
vi.mock('../src/main/lazy-media', () => ({ readLazyMedia: async () => null }))
vi.mock('../src/main/lazy-media-inline', () => ({}))

import { runningAiJobCount, stopAllAiJobs } from '@genoffice/electron-utils/ai-activity'
import { setAiRunGuard } from '@genoffice/electron-utils/ai-run-guard'
import { setAppChoiceSource } from '@genoffice/electron-utils/app-choice'
import { registerAiIpc } from '../src/main/docs-main'
import { stopAiBackgroundWork } from '../src/main/ai-background'
import { AI_SUBSCRIPTION_PROVIDERS } from '@genoffice/ai-provider'

let nextId = 500
class FakeContents extends EventEmitter {
  id = ++nextId
  destroyed = false
  isDestroyed = () => this.destroyed
  send = vi.fn()
}

let aiOn = true
const OFF_TEXT = 'AI is off (shell check)'

beforeAll(() => {
  registerAiIpc()
})

beforeEach(() => {
  aiOn = true
  setAppChoiceSource(() => ({ off: [], aiFeatures: aiOn, locked: false }))
  // the shell's own check, as editor-choice-main sets it
  setAiRunGuard('ai-off', () => (aiOn ? null : OFF_TEXT))
  generateImageTool.mockReset()
  analyzeMediaTool.mockReset()
  streamForProvider.mockReset()
  chatForProvider.mockReset()
  listCodexModels.mockClear()
})

afterEach(async () => {
  await stopAllAiJobs()
  setAppChoiceSource(null)
  setAiRunGuard('ai-off', null)
})

const streamRequest = (requestId: string) => ({
  requestId,
  settings: {},
  system: 'system',
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 100,
})

/** a provider stream that runs until its signal ends it, or the test lets it finish */
function holdStream() {
  let finish!: () => void
  let signal!: AbortSignal
  streamForProvider.mockImplementationOnce(
    (...args: unknown[]) =>
      new Promise<void>((resolve, reject) => {
        signal = (args[6] as { signal: AbortSignal }).signal
        finish = resolve
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      }),
  )
  return {
    finish: () => finish(),
    signal: () => signal,
  }
}

describe('ai:stream (every editor’s chat goes through it)', () => {
  it('is one running chat job while it streams, gone once it ends', async () => {
    const sender = new FakeContents()
    const held = holdStream()
    const done = handlers.get('ai:stream')!({ sender }, streamRequest('r1')) as Promise<void>
    await vi.waitFor(() => expect(streamForProvider).toHaveBeenCalled())
    expect(runningAiJobCount()).toBe(1)
    held.finish()
    await done
    // the tab's turn may go on with its next model call: it still counts for a moment
    expect(runningAiJobCount()).toBe(1)
    await vi.waitFor(() => expect(runningAiJobCount()).toBe(0), { timeout: 6000 })
  })

  it('turning AI off stops it the way Stop does: the provider signal ends', async () => {
    const sender = new FakeContents()
    const held = holdStream()
    const done = handlers.get('ai:stream')!({ sender }, streamRequest('r2')) as Promise<void>
    await vi.waitFor(() => expect(streamForProvider).toHaveBeenCalled())
    expect(await stopAllAiJobs()).toBe(1)
    expect(held.signal().aborted).toBe(true)
    await done
    expect(runningAiJobCount()).toBe(0)
    // the screen hears an ordinary end of the turn
    expect(sender.send).toHaveBeenCalledWith('ai:stream-chunk', { requestId: 'r2', type: 'done' })
  })

  it('while AI is off answers the refusal and never reaches the provider or the job list', async () => {
    aiOn = false
    const sender = new FakeContents()
    await handlers.get('ai:stream')!({ sender }, streamRequest('r3'))
    expect(streamForProvider).not.toHaveBeenCalled()
    expect(runningAiJobCount()).toBe(0)
    expect(sender.send).toHaveBeenCalledWith('ai:stream-chunk', {
      requestId: 'r3',
      type: 'error',
      error: OFF_TEXT,
    })
  })
})

describe('ai:chat', () => {
  it('while AI is off is refused before the provider', async () => {
    aiOn = false
    const result = await handlers.get('ai:chat')!(
      { sender: new FakeContents() },
      { settings: {}, system: 's', user: 'u' },
    )
    expect(result).toEqual({ ok: false, error: OFF_TEXT })
    expect(chatForProvider).not.toHaveBeenCalled()
  })

  it('with AI on reaches the provider as before', async () => {
    chatForProvider.mockResolvedValueOnce({ ok: true, text: 'OK' })
    const result = await handlers.get('ai:chat')!(
      { sender: new FakeContents() },
      { settings: {}, system: 's', user: 'u' },
    )
    expect(result).toEqual({ ok: true, text: 'OK' })
  })
})

describe('ai:codex-models', () => {
  it('starts no Codex while AI is off', async () => {
    aiOn = false
    await expect(
      handlers.get('ai:codex-models')!({ sender: new FakeContents() }, undefined),
    ).rejects.toThrow(/turned off/)
    expect(listCodexModels).not.toHaveBeenCalled()
  })
})

const MEDIA = [
  { channel: 'docs:ai-generate-image', tool: generateImageTool, op: { prompt: 'a red kite' } },
  {
    channel: 'docs:analyze-media',
    tool: analyzeMediaTool,
    op: { mediaUrls: ['/docs/photo.png'], requirements: 'describe' },
  },
] as const

describe.each(MEDIA)('$channel', ({ channel, tool, op }) => {
  it('while AI is off is refused without running the tool', async () => {
    aiOn = false
    const result = await handlers.get(channel)!({ sender: new FakeContents() }, op)
    expect(result).toEqual({ error: expect.stringMatching(/turned off/) })
    expect(tool).not.toHaveBeenCalled()
    expect(runningAiJobCount()).toBe(0)
  })

  it('is a running AI job until it ends; turning AI off aborts its signal', async () => {
    let answer!: (value: unknown) => void
    tool.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    const result = handlers.get(channel)!({ sender: new FakeContents() }, op)
    await vi.waitFor(() => expect(tool).toHaveBeenCalled())
    expect(runningAiJobCount()).toBe(1)
    const { signal } = tool.mock.calls.at(-1)![2] as { signal: AbortSignal }
    const stopping = stopAllAiJobs()
    expect(signal.aborted).toBe(true)
    answer({ error: 'cancelled' })
    await stopping
    await result
    expect(runningAiJobCount()).toBe(0)
  })
})

describe('the subscription channels docs main sets up', () => {
  it('ask no status-check program and list no models while AI is off, on any path', async () => {
    const setup = subscriptionSetup!
    aiOn = false
    detectSubscriptionLogin.mockClear()
    listSubscriptionModels.mockClear()
    // the check a login's end or cancel starts goes through this same detect
    expect((await setup.detect('codex')).state).toBe('error')
    expect(await setup.listModels('codex')).toBeUndefined()
    expect(detectSubscriptionLogin).not.toHaveBeenCalled()
    expect(listSubscriptionModels).not.toHaveBeenCalled()
    aiOn = true
    await setup.detect('codex')
    await setup.listModels('codex')
    expect(detectSubscriptionLogin).toHaveBeenCalledTimes(1)
    expect(listSubscriptionModels).toHaveBeenCalledTimes(1)
  })

  it('end every running login when AI goes off', () => {
    cancelLogin.mockClear()
    stopAiBackgroundWork()
    for (const provider of AI_SUBSCRIPTION_PROVIDERS) {
      expect(cancelLogin).toHaveBeenCalledWith(provider)
    }
  })
})
