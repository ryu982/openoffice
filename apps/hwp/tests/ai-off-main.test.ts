// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Hangul editor's picture calls (hwp:ai-generate-image, hwp:analyze-media) against the
 * AI-off switch and the running-job list. Either can run a subscription program, so while
 * AI is off in Settings they refuse before any tool runs (a second wall behind the screen
 * hiding AI), and while one runs it counts as a running AI job that Settings' "stop all"
 * ends through the call's signal. The shell's side (choice source and "ai-off" check) is
 * set here the way the shell sets it; the tools are fakes, so no program is started.
 */

type Handler = (event: { sender: unknown }, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { getPath: (name: string) => `/fake/${name}` },
  ipcMain: { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) },
}))

const generateImageTool = vi.fn()
const analyzeMediaTool = vi.fn()
const abortMediaCalls = vi.fn()
vi.mock('@genoffice/ai-search', () => ({
  generateImageTool: (...args: unknown[]) => generateImageTool(...args),
  analyzeMediaTool: (...args: unknown[]) => analyzeMediaTool(...args),
  abortMediaCalls: (id: number) => abortMediaCalls(id),
  documentMediaRoots: () => [],
  withMediaCallSignal: (_sender: unknown, run: (signal: AbortSignal) => unknown) =>
    run(new AbortController().signal),
}))

vi.mock('@genoffice/ai-provider/subscription', () => ({
  sharedSubscriptionStatuses: () => ({ codex: 'ready' }),
}))

vi.mock('@genoffice/electron-utils/fetch-image-bytes', () => ({
  fetchImageBytes: vi.fn(),
}))

import { runningAiJobCount, stopAllAiJobs } from '@genoffice/electron-utils/ai-activity'
import { setAiRunGuard } from '@genoffice/electron-utils/ai-run-guard'
import { setAppChoiceSource } from '@genoffice/electron-utils/app-choice'
import { registerHwpImageIpc } from '../src/main/ai-image'
import { HWP_CHANNELS } from '../src/shared/ipc'

const sender = { id: 9 }
const PICTURE = 'data:image/png;base64,AA=='
let aiFeatures = true

beforeEach(() => {
  handlers.clear()
  generateImageTool.mockReset()
  analyzeMediaTool.mockReset()
  abortMediaCalls.mockReset()
  aiFeatures = true
  // the shell's side, as editor-choice-main sets it
  setAppChoiceSource(() => ({ off: [], aiFeatures, locked: false }))
  setAiRunGuard('ai-off', () => (aiFeatures ? null : 'AI is off (shell words)'))
  registerHwpImageIpc({ filePathOf: () => 'C:/docs/a.hwp' })
})

afterEach(() => {
  setAppChoiceSource(null)
  setAiRunGuard('ai-off', null)
})

const generate = (op: unknown = { prompt: 'a kite' }) =>
  handlers.get(HWP_CHANNELS.aiGenerateImage)!({ sender }, op)
const analyze = () =>
  handlers.get(HWP_CHANNELS.analyzeMedia)!({ sender }, { mediaUrls: [PICTURE], requirements: '' })

describe('AI off in Settings', () => {
  it('refuses a picture generation with the shell words, before the tool runs', async () => {
    aiFeatures = false
    expect(await generate()).toEqual({ error: 'AI is off (shell words)' })
    expect(generateImageTool).not.toHaveBeenCalled()
    expect(runningAiJobCount()).toBe(0)
  })

  it('refuses looking at a picture the same way', async () => {
    aiFeatures = false
    expect(await analyze()).toEqual({ error: 'AI is off (shell words)' })
    expect(analyzeMediaTool).not.toHaveBeenCalled()
  })

  it('lets both run while AI is on', async () => {
    generateImageTool.mockResolvedValue({ url: 'file:///store/a.png' })
    analyzeMediaTool.mockResolvedValue({ text: 'a kite' })
    expect(await generate()).toEqual({ url: 'file:///store/a.png' })
    expect(await analyze()).toEqual({ text: 'a kite' })
  })
})

describe('a running picture call', () => {
  it('counts as one running AI job until it ends, and stop all ends it', async () => {
    let finish: (value: unknown) => void = () => {}
    generateImageTool.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const call = generate()
    expect(runningAiJobCount()).toBe(1)

    await stopAllAiJobs()
    expect(abortMediaCalls).toHaveBeenCalledWith(sender.id)
    expect(runningAiJobCount()).toBe(0)

    finish({ error: 'aborted' })
    expect(await call).toEqual({ error: 'aborted' })
    expect(runningAiJobCount()).toBe(0)
  })

  it('leaves the list when it fails', async () => {
    analyzeMediaTool.mockRejectedValue(new Error('boom'))
    await expect(analyze()).rejects.toThrow('boom')
    expect(runningAiJobCount()).toBe(0)
  })
})
