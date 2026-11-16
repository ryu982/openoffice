// @vitest-environment node
/**
 * html:ai-generate-image behind the AI-off switch (Settings › Editors and AI):
 * refused while AI is off without running the tool; otherwise one running AI
 * job, which turning AI off stops through the tab's Stop path. The tool is a
 * fake: nothing here starts a real CLI.
 */
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  loadFile = vi.fn()
  send = vi.fn()
}
vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    whenReady: () => new Promise(() => {}),
    getPath: (name: string) => join('/fake', name),
  },
  dialog: {},
  shell: {},
  net: {},
  protocol: { handle: vi.fn() },
  webContents: { fromId: () => null, getAllWebContents: () => [] },
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
vi.mock('@genoffice/ai-provider/subscription', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-provider/subscription')>()),
  sharedSubscriptionStatuses: () => ({}),
}))

import { runningAiJobCount, stopAllAiJobs } from '@genoffice/electron-utils/ai-activity'
import { setAppChoiceSource } from '@genoffice/electron-utils/app-choice'
import { createHtmlView } from '../src/main/html-main'
import { HTML_CHANNELS } from '../src/shared/ipc'

let aiOn = true
beforeEach(() => {
  aiOn = true
  setAppChoiceSource(() => ({ off: [], aiFeatures: aiOn, locked: false }))
  generateImageTool.mockReset()
})
afterEach(async () => {
  await stopAllAiJobs()
  setAppChoiceSource(null)
})

/** a new tab's webContents (its creation also registers the channels) */
function sender(): FakeContents {
  createHtmlView(null)
  return lastContents
}

const call = () => {
  const tab = sender()
  return handlers.get(HTML_CHANNELS.aiGenerateImage)!({ sender: tab }, { prompt: 'a red kite' })
}

describe('html:ai-generate-image and the AI switch', () => {
  it('is refused while AI is off, without running the tool', async () => {
    aiOn = false
    const result = await call()
    expect(result).toEqual({ error: expect.stringMatching(/turned off/) })
    expect(generateImageTool).not.toHaveBeenCalled()
    expect(runningAiJobCount()).toBe(0)
  })

  it('is a running AI job until it ends; turning AI off aborts its signal', async () => {
    let answer!: (value: unknown) => void
    generateImageTool.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    const result = call()
    await vi.waitFor(() => expect(generateImageTool).toHaveBeenCalled())
    expect(runningAiJobCount()).toBe(1)
    const { signal } = generateImageTool.mock.calls.at(-1)![2] as { signal: AbortSignal }
    const stopping = stopAllAiJobs()
    expect(signal.aborted).toBe(true)
    answer({ error: 'cancelled' })
    await stopping
    await result
    expect(runningAiJobCount()).toBe(0)
  })
})

describe('html:ai-generate-image model and note', () => {
  it("hands a named model to the tool trimmed, leaves a blank one out, and answers with the tool's note", async () => {
    generateImageTool.mockResolvedValue({ url: 'file:///store/a.png', note: 'Codex picks' })
    const tab = sender()
    const generate = handlers.get(HTML_CHANNELS.aiGenerateImage)!
    const result = await generate({ sender: tab }, { prompt: 'a', model: ' gpt-image-2 ' })
    expect(generateImageTool.mock.calls[0]![1]).toMatchObject({ model: 'gpt-image-2' })
    expect(result).toEqual({ url: 'file:///store/a.png', note: 'Codex picks' })
    // a non-string or blank model from the renderer is not a model name
    await generate({ sender: tab }, { prompt: 'a', model: 42 })
    await generate({ sender: tab }, { prompt: 'a', model: '   ' })
    expect(generateImageTool.mock.calls[1]![1]).not.toHaveProperty('model')
    expect(generateImageTool.mock.calls[2]![1]).not.toHaveProperty('model')
  })
})
