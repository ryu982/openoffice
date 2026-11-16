// @vitest-environment node
/**
 * The PDF editor's main side while AI is turned off (Settings): a document
 * job a screen begins and an image generation the AI window asks for are
 * refused with the shell's refusal; while AI is on, each is one entry on the
 * shell's list of running AI work and "stop all" ends it. The subscription
 * programs are never reached: the image tool is a fake.
 */
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDF_CHANNELS } from '../src/shared/ipc'

type Handler = (event: { sender: FakeContents }, ...args: any[]) => any
const handlers = new Map<string, Handler>()
let lastContents: FakeContents
let nextId = 500
class FakeContents extends EventEmitter {
  id = ++nextId
  setWindowOpenHandler = vi.fn()
  loadURL = vi.fn()
  loadFile = vi.fn()
  destroyed = false
  isDestroyed = () => this.destroyed
  send = vi.fn()
  /** the tab or window was closed */
  destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}
vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    whenReady: () => new Promise(() => {}),
    getPath: (name: string) => join('/fake', name),
  },
  dialog: {},
  shell: {},
  BrowserWindow: { fromWebContents: () => null },
  WebContentsView: class {
    webContents = (lastContents = new FakeContents())
  },
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
    on: (channel: string, fn: Handler) => handlers.set(channel, fn),
    removeHandler: vi.fn(),
  },
}))

const generateImageTool = vi.fn()
vi.mock('@genoffice/ai-search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-search')>()),
  generateImageTool: (...args: unknown[]) => generateImageTool(...args),
}))

const sharedSubscriptionStatuses = vi.fn()
vi.mock('@genoffice/ai-provider/subscription', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-provider/subscription')>()),
  sharedSubscriptionStatuses: () => sharedSubscriptionStatuses(),
}))

import { runningAiJobCount, stopAllAiJobs } from '@genoffice/electron-utils/ai-activity'
import { setAiRunGuard } from '@genoffice/electron-utils/ai-run-guard'
import { setAppChoiceSource } from '@genoffice/electron-utils/app-choice'
import { createPdfView } from '../src/main/pdf-main'

const REFUSAL = 'AI features are turned off in Settings.'
let aiOn = true

beforeEach(() => {
  generateImageTool.mockReset()
  sharedSubscriptionStatuses.mockReset()
  sharedSubscriptionStatuses.mockReturnValue({})
  aiOn = true
  // what the shell sets: the choice to read, and the "ai-off" check of every AI run
  setAppChoiceSource(() => ({ off: [], aiFeatures: aiOn, locked: false }))
  setAiRunGuard('ai-off', () => (aiOn ? null : REFUSAL))
})

afterEach(async () => {
  await stopAllAiJobs()
  setAppChoiceSource(null)
  setAiRunGuard('ai-off', null)
})

const call = (channel: string, sender: FakeContents, ...args: unknown[]) =>
  handlers.get(channel)!({ sender }, ...args)

describe('PDF main while AI is off', () => {
  it('refuses a document job and lists nothing', async () => {
    createPdfView('/docs/report.pdf')
    aiOn = false
    expect(await call(PDF_CHANNELS.aiJobBegin, lastContents, 'job-1')).toEqual({
      ok: false,
      error: REFUSAL,
    })
    expect(runningAiJobCount()).toBe(0)
  })

  it('refuses an image generation without starting it', async () => {
    createPdfView('/docs/report.pdf')
    aiOn = false
    expect(await call(PDF_CHANNELS.generateImage, lastContents, { prompt: 'a kite' })).toEqual({
      error: REFUSAL,
    })
    expect(generateImageTool).not.toHaveBeenCalled()
    expect(runningAiJobCount()).toBe(0)
  })
})

describe('PDF main while AI is on', () => {
  it('lists a document job from its begin to its end', async () => {
    createPdfView('/docs/report.pdf')
    const sender = lastContents
    expect(await call(PDF_CHANNELS.aiJobBegin, sender, 'job-1')).toEqual({ ok: true })
    expect(runningAiJobCount()).toBe(1)
    await call(PDF_CHANNELS.aiJobEnd, sender, 'job-1')
    expect(runningAiJobCount()).toBe(0)
  })

  it('stop all asks the tab to stop its job and waits for the job to end', async () => {
    createPdfView('/docs/report.pdf')
    const sender = lastContents
    await call(PDF_CHANNELS.aiJobBegin, sender, 'job-1')
    const stopping = stopAllAiJobs()
    await Promise.resolve()
    expect(sender.send).toHaveBeenCalledWith(PDF_CHANNELS.aiJobStop, 'job-1')
    await call(PDF_CHANNELS.aiJobEnd, sender, 'job-1')
    expect(await stopping).toBe(1)
    expect(runningAiJobCount()).toBe(0)
  })

  it('a closed tab takes its job off the list', async () => {
    createPdfView('/docs/report.pdf')
    const sender = lastContents
    await call(PDF_CHANNELS.aiJobBegin, sender, 'job-1')
    sender.destroy()
    expect(runningAiJobCount()).toBe(0)
  })

  it('an image generation is on the list while it runs, and stop all ends it', async () => {
    let answer!: (result: { url?: string; error?: string }) => void
    generateImageTool.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    createPdfView('/docs/report.pdf')
    const result = call(PDF_CHANNELS.generateImage, lastContents, { prompt: 'a kite' })
    const signal: AbortSignal = generateImageTool.mock.calls.at(-1)![2].signal
    expect(runningAiJobCount()).toBe(1)
    const stopping = stopAllAiJobs()
    // the stop aborts the call; the tool then answers and the stop settles
    expect(signal.aborted).toBe(true)
    answer({ error: 'cancelled' })
    expect(await stopping).toBe(1)
    await result
    expect(runningAiJobCount()).toBe(0)
  })

  it('a finished image generation leaves the list', async () => {
    generateImageTool.mockResolvedValue({ url: 'file:///fake/out.png' })
    createPdfView('/docs/report.pdf')
    expect(await call(PDF_CHANNELS.generateImage, lastContents, { prompt: 'a kite' })).toEqual({
      url: 'file:///fake/out.png',
    })
    expect(runningAiJobCount()).toBe(0)
  })
})
