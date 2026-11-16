/**
 * markdown:ai-generate-image behind the AI-off switch (Settings › Editors and
 * AI): refused while AI is off without running the tool; otherwise one running
 * AI job, which turning AI off stops through the tab's Stop path. The tool is
 * a fake: nothing here starts a real CLI.
 */
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: { sender: { id: number } }, ...args: unknown[]) => unknown

const handlers = new Map<string, IpcHandler>()
const generateImageTool = vi.fn()
let nextId = 300
class FakeContents extends EventEmitter {
  id = ++nextId
  destroyed = false
  isDestroyed = () => this.destroyed
  loadFile = vi.fn()
  loadURL = vi.fn()
  send = vi.fn()
  setWindowOpenHandler = vi.fn()
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
  dialog: { showMessageBox: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    on: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    removeHandler: vi.fn(),
  },
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
  WebContentsView: class {
    webContents = new FakeContents()
  },
}))

vi.mock('@genoffice/electron-utils', () => ({
  configuredDefaultSaveDir: vi.fn(() => tmpdir()),
  contextMenuLabels: vi.fn(() => ({})),
  installContextMenu: vi.fn(),
  installNavigationGuard: vi.fn(),
  registerRecoveryEditor: vi.fn(() => () => {}),
  rendererUrl: vi.fn(() => 'genoffice-app://markdown/index.html'),
  safeExternalUrl: vi.fn(() => null),
  showOpenDialogWithMemory: vi.fn(),
  showSaveDialogWithMemory: vi.fn(),
}))

vi.mock('@genoffice/ai-search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-search')>()),
  generateImageTool: (...args: unknown[]) => generateImageTool(...args),
  documentMediaRoots: vi.fn(() => ['/doc-dir']),
}))

vi.mock('@genoffice/ai-provider/subscription', () => ({
  sharedSubscriptionStatuses: vi.fn(() => ({})),
}))

import { runningAiJobCount, stopAllAiJobs } from '@genoffice/electron-utils/ai-activity'
import { setAppChoiceSource } from '@genoffice/electron-utils/app-choice'
import { createMarkdownView } from '../src/main/markdown-main'
import { MARKDOWN_CHANNELS } from '../src/shared/ipc'

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

/** a new tab asks (its creation also registers the channels) */
const call = () => {
  const sender = createMarkdownView(null).webContents as never
  return handlers.get(MARKDOWN_CHANNELS.aiGenerateImage)!(
    { sender },
    { prompt: 'a lighthouse at dusk' },
  )
}

describe('markdown:ai-generate-image and the AI switch', () => {
  it('is refused while AI is off, without running the tool', async () => {
    aiOn = false
    expect(await call()).toEqual({ error: expect.stringMatching(/turned off/) })
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

describe('markdown:ai-generate-image model and note', () => {
  it("hands a named model to the tool trimmed, leaves a blank one out, and answers with the tool's note", async () => {
    generateImageTool.mockResolvedValue({ url: 'file:///store/a.png', note: 'Codex picks' })
    const sender = createMarkdownView(null).webContents as never
    const generate = handlers.get(MARKDOWN_CHANNELS.aiGenerateImage)!
    const result = await generate({ sender }, { prompt: 'a', model: ' gpt-image-2 ' })
    expect(generateImageTool.mock.calls[0]![1]).toMatchObject({ model: 'gpt-image-2' })
    expect(result).toEqual({ url: 'file:///store/a.png', note: 'Codex picks' })
    // a non-string or blank model from the renderer is not a model name
    await generate({ sender }, { prompt: 'a', model: 42 })
    await generate({ sender }, { prompt: 'a', model: '   ' })
    expect(generateImageTool.mock.calls[1]![1]).not.toHaveProperty('model')
    expect(generateImageTool.mock.calls[2]![1]).not.toHaveProperty('model')
  })
})
