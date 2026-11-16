// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The mind map's picture generation (mindmap:ai-generate-image) against the AI-off switch
 * and the running-job list. It can run a subscription program, so while AI is off in
 * Settings it refuses before the tool runs (a second wall behind the screen hiding AI),
 * and while it runs it counts as a running AI job that Settings' "stop all" ends through
 * the call's signal. The shell's side is set here the way the shell sets it; the tool is a
 * fake, so no program is started.
 */

type Handler = (event: { sender: unknown }, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { getPath: (name: string) => `/fake/${name}` },
  ipcMain: { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) },
}))

const generateImageTool = vi.fn()
const abortMediaCalls = vi.fn()
vi.mock('@genoffice/ai-search', () => ({
  generateImageTool: (...args: unknown[]) => generateImageTool(...args),
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
import { registerMindmapImageIpc } from '../src/main/ai-image'
import { MINDMAP_CHANNELS } from '../src/shared/ipc'

const sender = { id: 7 }
let aiFeatures = true

beforeEach(() => {
  handlers.clear()
  generateImageTool.mockReset()
  abortMediaCalls.mockReset()
  aiFeatures = true
  // the shell's side, as editor-choice-main sets it
  setAppChoiceSource(() => ({ off: [], aiFeatures, locked: false }))
  setAiRunGuard('ai-off', () => (aiFeatures ? null : 'AI is off (shell words)'))
  registerMindmapImageIpc({ filePathOf: () => null, pastedImageDir: '/tmp/pasted' })
})

afterEach(() => {
  setAppChoiceSource(null)
  setAiRunGuard('ai-off', null)
})

const generate = () =>
  handlers.get(MINDMAP_CHANNELS.aiGenerateImage)!({ sender }, { prompt: 'a kite' })

describe('mindmap picture generation and the AI-off switch', () => {
  it('refuses while AI is off, with the shell words, before the tool runs', async () => {
    aiFeatures = false
    expect(await generate()).toEqual({ error: 'AI is off (shell words)' })
    expect(generateImageTool).not.toHaveBeenCalled()
    expect(runningAiJobCount()).toBe(0)
  })

  it('runs while AI is on, as one running AI job that stop all ends', async () => {
    let finish: (value: unknown) => void = () => {}
    generateImageTool.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const call = generate()
    expect(runningAiJobCount()).toBe(1)

    await stopAllAiJobs()
    expect(abortMediaCalls).toHaveBeenCalledWith(sender.id)
    expect(runningAiJobCount()).toBe(0)

    finish({ url: 'file:///store/a.png' })
    expect(await call).toEqual({ url: 'file:///store/a.png' })
    expect(runningAiJobCount()).toBe(0)
  })

  it('leaves the job list when the call fails', async () => {
    generateImageTool.mockRejectedValue(new Error('boom'))
    await expect(generate()).rejects.toThrow('boom')
    expect(runningAiJobCount()).toBe(0)
  })
})
