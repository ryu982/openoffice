// @vitest-environment node
/**
 * AI turned off in Settings (the shell's 'ai-off' check): the slides main
 * refuses the AI work a window asks for, and counts the work it lets run so
 * that turning AI off stops it. The tools and the stream are mocked —
 * nothing here starts a real program.
 */
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

// The shaping chain loads a harfbuzz wasm that cannot resolve in the unit-test env
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

/** the provider stream: stays in flight until its signal aborts */
const runAiStream = vi.fn(
  ({ signal }: { signal: AbortSignal }) =>
    new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve())),
)
vi.mock('../src/main/ai-stream', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/ai-stream')>()),
  runAiStream: (...args: [{ signal: AbortSignal }]) => runAiStream(...args),
}))

vi.mock('@genoffice/ai-provider/subscription', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-provider/subscription')>()),
  ensureSubscriptionIpc: () => ({}),
  sharedSubscriptionStatuses: () => ({}),
}))

import { defaultAiSettings } from '@genoffice/ai-provider'
import { runningAiJobCount, stopAllAiJobs } from '@genoffice/electron-utils/ai-activity'
import { setAiRunGuard } from '@genoffice/electron-utils/ai-run-guard'
import { registerAiIpc, registerSlidesOnlyAiIpc } from '../src/main/ai-ipc'

let nextId = 600
class FakeContents extends EventEmitter {
  id = ++nextId
  destroyed = false
  isDestroyed = () => this.destroyed
  send = vi.fn()
}

const AI_OFF = 'AI is turned off.'
const turnAiOff = () => setAiRunGuard('ai-off', () => AI_OFF)

beforeAll(() => {
  registerAiIpc()
  registerSlidesOnlyAiIpc()
})

beforeEach(() => {
  generateImageTool.mockReset()
  analyzeMediaTool.mockReset()
  runAiStream.mockClear()
})

afterEach(async () => {
  setAiRunGuard('ai-off', null)
  await stopAllAiJobs()
})

const MEDIA_CALLS = [
  { channel: 'ai:generate-image', tool: generateImageTool, op: { prompt: 'a red kite' } },
  {
    channel: 'ai:analyze-media',
    tool: analyzeMediaTool,
    op: { mediaUrls: ['/deck/photo.png'], requirements: 'describe' },
  },
] as const

describe.each(MEDIA_CALLS)('$channel while AI is turned off', ({ channel, tool, op }) => {
  it('is refused without running the tool', async () => {
    turnAiOff()
    const result = await handlers.get(channel)!({ sender: new FakeContents() }, op)
    expect(result).toEqual({ error: AI_OFF, errorCode: 'unavailable' })
    expect(tool).not.toHaveBeenCalled()
    expect(runningAiJobCount()).toBe(0)
  })

  it('runs while AI is on, counted as one AI job that turning AI off stops', async () => {
    let answer!: (value: unknown) => void
    tool.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    const result = handlers.get(channel)!({ sender: new FakeContents() }, op)
    const { signal } = tool.mock.calls.at(-1)![2] as { signal: AbortSignal }
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
    const sender = new FakeContents()
    await handlers.get('ai:stream')!({ sender }, request('r-off'))
    expect(runAiStream).not.toHaveBeenCalled()
    expect(sender.send).toHaveBeenCalledWith('ai:stream-chunk', {
      requestId: 'r-off',
      type: 'error',
      error: AI_OFF,
    })
    expect(runningAiJobCount()).toBe(0)
  })

  it('counts a running turn as one AI job, which "stop all" ends', async () => {
    const turn = handlers.get('ai:stream')!({ sender: new FakeContents() }, request('r-on'))
    expect(runAiStream).toHaveBeenCalledTimes(1)
    const { signal } = runAiStream.mock.calls[0]![0]
    expect(runningAiJobCount()).toBe(1)

    expect(await stopAllAiJobs()).toBe(1)
    expect(signal.aborted).toBe(true)
    await turn
    expect(runningAiJobCount()).toBe(0)
  })
})
