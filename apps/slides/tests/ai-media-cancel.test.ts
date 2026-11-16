// @vitest-environment node
/**
 * generate_image / analyze_media in the slides main process can run a
 * subscription program: the call must end when its window is closed or the
 * user stops the AI run. The tools are mocked — nothing here starts a real CLI.
 */
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: { sender: FakeContents }, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getName: () => 'slides-test',
    getVersion: () => '0',
    once: () => {},
  },
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
    on: () => {},
    removeHandler: () => {},
  },
  nativeImage: {},
  net: {},
  webContents: { getAllWebContents: () => [], fromId: () => null },
}))

// The shaping chain loads a harfbuzz wasm that cannot resolve in the unit-test env;
// nothing here renders text.
vi.mock('../src/main/shaped-metrics', () => ({
  shapedMetricsReady: async () => {},
  refineComplexWidths: async () => {},
  complexScriptOf: () => null,
  initShapedMetrics: () => {},
  gtMeasure: (t: string) => ({ width: t.length * 8 }),
  shapedFamily: () => null,
  shapedMeasure: () => ({ width: 0 }),
}))

const generateImageTool = vi.fn()
const analyzeMediaTool = vi.fn()
vi.mock('@genoffice/ai-search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-search')>()),
  generateImageTool: (...args: unknown[]) => generateImageTool(...args),
  analyzeMediaTool: (...args: unknown[]) => analyzeMediaTool(...args),
}))

// no status check either: registering the subscription channels would look for the CLIs
vi.mock('@genoffice/ai-provider/subscription', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-provider/subscription')>()),
  ensureSubscriptionIpc: () => ({}),
  sharedSubscriptionStatuses: () => ({}),
}))

import { registerAiIpc, registerSlidesOnlyAiIpc } from '../src/main/ai-ipc'

let nextId = 300
/** a window's webContents: an id, and the `destroyed` event of a closed window */
class FakeContents extends EventEmitter {
  id = ++nextId
  destroyed = false
  isDestroyed = () => this.destroyed
  send = vi.fn()
  destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

const CALLS = [
  {
    channel: 'ai:generate-image',
    tool: generateImageTool,
    op: { prompt: 'a red kite' },
    done: { url: 'file:///fake/out.png' },
  },
  {
    channel: 'ai:analyze-media',
    tool: analyzeMediaTool,
    op: { mediaUrls: ['/deck/photo.png'], requirements: 'describe' },
    done: { text: 'a photo' },
  },
] as const

beforeAll(() => {
  // the standalone app registers both; in the suite the docs main answers ai:stream-cancel
  registerAiIpc()
  registerSlidesOnlyAiIpc()
})

beforeEach(() => {
  generateImageTool.mockReset()
  analyzeMediaTool.mockReset()
})

describe.each(CALLS)('$channel, cancelling', ({ channel, tool, op, done }) => {
  /** a request that stays in flight until the test answers it */
  function startRequest(sender = new FakeContents()) {
    let answer!: (result: unknown) => void
    tool.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    const result = handlers.get(channel)!({ sender }, op)
    const options = tool.mock.calls.at(-1)![2] as { signal: AbortSignal; context: unknown }
    return { sender, signal: options.signal, options, result, answer }
  }

  it('hands the tool a signal that stays live while nothing is cancelled', async () => {
    const request = startRequest()
    expect(request.signal).toBeInstanceOf(AbortSignal)
    expect(request.options.context).toEqual({ path: 'screen', statuses: {} })
    request.answer(done)
    expect(await request.result).toEqual(done)
    expect(request.signal.aborted).toBe(false)
  })

  it('aborts when the window that asked is closed', async () => {
    const request = startRequest()
    request.sender.destroy()
    expect(request.signal.aborted).toBe(true)
    request.answer({ error: 'cancelled' })
    await request.result
  })

  it('aborts when the user stops the AI run, and leaves another window alone', async () => {
    const stopped = startRequest()
    const other = startRequest()
    // Stop while a tool runs: the loop cancels the turn that already ended
    await handlers.get('ai:stream-cancel')!({ sender: stopped.sender }, 'turn-that-already-ended')
    expect(stopped.signal.aborted).toBe(true)
    expect(other.signal.aborted).toBe(false)
    stopped.answer({ error: 'cancelled' })
    other.answer(done)
    expect(await other.result).toEqual(done)
    await stopped.result
  })
})

describe('ai:generate-image, model', () => {
  it('hands a model the user named to the tool unchanged', async () => {
    generateImageTool.mockResolvedValue({ url: 'file:///fake/out.png' })
    await handlers.get('ai:generate-image')!(
      { sender: new FakeContents() },
      { prompt: 'a red kite', model: 'gpt-image-2' },
    )
    expect(generateImageTool.mock.calls.at(-1)![1]).toMatchObject({
      prompt: 'a red kite',
      model: 'gpt-image-2',
    })
  })

  it("trims a named model, leaves a blank one out, and answers with the tool's note", async () => {
    generateImageTool.mockResolvedValue({ url: 'file:///fake/out.png', note: 'Codex picks' })
    const generate = handlers.get('ai:generate-image')!
    const sender = new FakeContents()
    const result = await generate({ sender }, { prompt: 'a red kite', model: ' gpt-image-2 ' })
    expect(generateImageTool.mock.calls.at(-1)![1]).toMatchObject({ model: 'gpt-image-2' })
    expect(result).toEqual({ url: 'file:///fake/out.png', note: 'Codex picks' })
    // a non-string or blank model from the renderer is not a model name
    await generate({ sender }, { prompt: 'a red kite', model: 42 })
    expect(generateImageTool.mock.calls.at(-1)![1]).not.toHaveProperty('model')
    await generate({ sender }, { prompt: 'a red kite', model: '   ' })
    expect(generateImageTool.mock.calls.at(-1)![1]).not.toHaveProperty('model')
  })
})
