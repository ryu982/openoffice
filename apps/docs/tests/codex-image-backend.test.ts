// @vitest-environment node
/**
 * The app's Codex image generator: the docs main registers it once
 * per process when the AI IPC is, turns the Codex picture route on, and sends
 * the usage Codex reports while it draws to every live window, the same way
 * the subscription statuses go out. The docs tab's picture channel hands the
 * model the user named on to the shared tool. The generator and the tool are
 * fakes: nothing here starts a real CLI.
 */
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: { sender: FakeContents }, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
const liveContents: FakeContents[] = []

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
  webContents: { getAllWebContents: () => liveContents, fromId: () => null },
}))

interface GeneratorOptions {
  settingsPath(): string
  onUsage?: (usage: unknown[]) => void
}
const fakeGenerator = { generate: vi.fn(), models: vi.fn() }
const createCodexImageGenerator = vi.fn((_options: GeneratorOptions) => fakeGenerator)
const registerCodexImageGenerator = vi.fn()
const generateImageTool = vi.fn()
vi.mock('@genoffice/ai-search', async () => ({
  ...(await import('../../../packages/ai-search/src/media-call-abort')),
  generateImageTool: (...args: unknown[]) => generateImageTool(...args),
  analyzeMediaTool: async () => ({ text: '' }),
  documentMediaRoots: () => [],
  createCodexImageGenerator: (options: GeneratorOptions) => createCodexImageGenerator(options),
  registerCodexImageGenerator: (generator: unknown) => registerCodexImageGenerator(generator),
}))

const setCodexImageGenerationAvailable = vi.fn()
vi.mock('@genoffice/ai-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-provider')>()),
  setCodexImageGenerationAvailable: (available: boolean) =>
    setCodexImageGenerationAvailable(available),
}))

// no status check either: registering the subscription channels would look for the CLIs
vi.mock('@genoffice/ai-provider/subscription', () => ({
  ensureSubscriptionIpc: () => ({}),
  sharedSubscriptionStatuses: () => ({}),
  detectSubscriptionLogin: async () => ({}),
  listSubscriptionModels: async () => [],
  subscriptionStatusErrorText: () => '',
}))
vi.mock('@genoffice/ai-provider/codex-app-server', () => ({
  shutdownCodexAppServers: () => {},
  listCodexModels: async () => ({ models: [] }),
}))
vi.mock('@genoffice/ai-provider/custom-models', () => ({}))
vi.mock('../src/main/lazy-media', () => ({ readLazyMedia: async () => null }))
vi.mock('../src/main/lazy-media-inline', () => ({}))

import { registerAiIpc } from '../src/main/docs-main'

let nextId = 900
class FakeContents extends EventEmitter {
  id = ++nextId
  destroyed = false
  isDestroyed = () => this.destroyed
  send = vi.fn()
}

beforeAll(() => {
  // the shell and every editor main ask for the AI IPC; the generator is made once
  registerAiIpc()
  registerAiIpc()
})

beforeEach(() => {
  generateImageTool.mockReset()
  generateImageTool.mockResolvedValue({ url: 'file:///fake/out.png' })
  liveContents.length = 0
})

describe('the Codex image generator of the app', () => {
  it('is made and registered once per process, and turns the Codex picture route on', () => {
    expect(createCodexImageGenerator).toHaveBeenCalledTimes(1)
    expect(registerCodexImageGenerator).toHaveBeenCalledTimes(1)
    expect(registerCodexImageGenerator).toHaveBeenCalledWith(fakeGenerator)
    expect(setCodexImageGenerationAvailable).toHaveBeenCalledTimes(1)
    expect(setCodexImageGenerationAvailable).toHaveBeenCalledWith(true)
  })

  it('reads the app settings file on each call', () => {
    const options = createCodexImageGenerator.mock.calls[0]![0]
    expect(options.settingsPath()).toMatch(/ai-settings\.json$/)
  })

  it('sends the usage Codex reports to every live window, not to a closed one', () => {
    const onUsage = createCodexImageGenerator.mock.calls[0]![0].onUsage
    expect(onUsage).toBeTypeOf('function')
    const tab = new FakeContents()
    const home = new FakeContents()
    const closed = new FakeContents()
    closed.destroyed = true
    liveContents.push(tab, home, closed)
    const usage = [
      { provider: 'codex', window: 'five_hour', utilization: 0.42, resetsAt: 1_800_000_000_000 },
    ]
    onUsage!(usage)
    for (const wc of [tab, home]) {
      expect(wc.send).toHaveBeenCalledTimes(1)
      expect(wc.send).toHaveBeenCalledWith('ai:subscription-usage-update', usage)
    }
    expect(closed.send).not.toHaveBeenCalled()
  })
})

describe('docs:ai-generate-image and the named model', () => {
  async function ask(op: Record<string, unknown>) {
    const result = await handlers.get('docs:ai-generate-image')!({ sender: new FakeContents() }, op)
    expect(result).toEqual({ url: 'file:///fake/out.png' })
    expect(generateImageTool).toHaveBeenCalledTimes(1)
    return generateImageTool.mock.calls[0]![1] as Record<string, unknown>
  }

  it('hands the trimmed model name on to the tool', async () => {
    const input = await ask({ prompt: 'a red kite', aspectRatio: '16:9', model: '  gpt-image-2 ' })
    expect(input).toEqual({ prompt: 'a red kite', aspectRatio: '16:9', model: 'gpt-image-2' })
  })

  it.each([
    ['no model', {}],
    ['a blank model', { model: '   ' }],
    ['a model that is not a string', { model: 42 }],
  ])('passes no model for %s', async (_label, extra) => {
    const input = await ask({ prompt: 'a red kite', ...extra })
    expect(input).not.toHaveProperty('model')
    expect(input.prompt).toBe('a red kite')
  })
})
