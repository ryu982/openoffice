import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The shell side of the editor choice (src/main/editor-choice-main.ts): the
 * one function that answers the choice that applies, the IPC channels, the
 * broadcast to every window, the source the editor mains read and the
 * "ai-off" AI run check.
 */

const { handlers, sent, liveIds } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  sent: [] as Array<{ id: number; channel: string; payload: unknown }>,
  liveIds: new Set<number>([1, 2]),
}))

vi.mock('electron', () => {
  const contents = (id: number) => ({
    id,
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => sent.push({ id, channel, payload }),
  })
  return {
    ipcMain: {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
        handlers.set(channel, fn)
      },
    },
    webContents: {
      getAllWebContents: () => [...liveIds].map(contents),
      fromId: (id: number) => (liveIds.has(id) ? contents(id) : undefined),
    },
  }
})

import { aiRunRefusal } from '@genoffice/electron-utils/ai-run-guard'
import { registerAiJob, runningAiJobCount } from '@genoffice/electron-utils/ai-activity'
import {
  APP_CHOICE_CHANNELS,
  EDITOR_ONLY_ITEM_IDS,
  appChoice,
} from '@genoffice/electron-utils/app-choice'
import { effectiveAppChoice, registerEditorChoiceIpc } from '../src/main/editor-choice-main'

const TEN_EDITORS = EDITOR_ONLY_ITEM_IDS

const dir = mkdtempSync(join(tmpdir(), 'editor-choice-main-'))
const settingsPath = join(dir, 'app-settings.json')

/** the shell's main window in these tests; 2 is an editor tab, 3 another window */
const SHELL_ID = 1

const service = registerEditorChoiceIpc({
  settingsPath: () => settingsPath,
  isShellSender: (event) => event.sender.id === SHELL_ID,
  aiOffRefusal: () => 'AI is off',
})

function invokeFrom(senderId: number, channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return handler({ sender: { id: senderId } }, ...args)
}

function invoke(channel: string, ...args: unknown[]): unknown {
  return invokeFrom(SHELL_ID, channel, ...args)
}

function stored(): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
}

beforeEach(() => {
  writeFileSync(settingsPath, JSON.stringify({ theme: 'dark', onboardingSeen: true }))
  sent.length = 0
})

afterEach(() => vi.restoreAllMocks())

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('reading', () => {
  it('answers everything on for a file without the keys', () => {
    expect(effectiveAppChoice(settingsPath)).toEqual({ off: [], aiFeatures: true, locked: false })
    expect(invoke(APP_CHOICE_CHANNELS.get)).toEqual({ off: [], aiFeatures: true, locked: false })
  })

  it('reads a stored file with all editors off as everything on', () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        editors: { off: [...TEN_EDITORS] },
      }),
    )
    expect(service.effective().off).toEqual([])
  })

  it('is the source the editor mains read', () => {
    writeFileSync(settingsPath, JSON.stringify({ editors: { off: ['hwp'] }, aiFeatures: false }))
    expect(appChoice()).toEqual({ off: ['hwp'], aiFeatures: false, locked: false })
  })
})

describe('changing', () => {
  it('stores the editors turned off, keeps other keys and tells every window', async () => {
    const heard: unknown[] = []
    const off = service.onChange((choice) => heard.push(choice))
    const next = await invoke(APP_CHOICE_CHANNELS.set, { off: ['epub', 'nope', 'docs'] })
    off()
    const choice = { off: ['docs', 'epub'], aiFeatures: true, locked: false }
    expect(next).toEqual(choice)
    expect(stored()).toEqual({
      theme: 'dark',
      onboardingSeen: true,
      editors: { off: ['docs', 'epub'] },
    })
    expect(sent.filter((m) => m.channel === APP_CHOICE_CHANNELS.changed)).toEqual([
      { id: 1, channel: APP_CHOICE_CHANNELS.changed, payload: choice },
      { id: 2, channel: APP_CHOICE_CHANNELS.changed, payload: choice },
    ])
    expect(heard).toEqual([choice])
  })

  it('stores nothing but an empty value once everything is on again', async () => {
    await invoke(APP_CHOICE_CHANNELS.set, { off: ['hwp'] })
    await invoke(APP_CHOICE_CHANNELS.set, { off: [] })
    expect(stored().editors).toEqual({})
  })

  it('refuses a value with every editor off and keeps the stored one', async () => {
    await invoke(APP_CHOICE_CHANNELS.set, { off: ['hwp'] })
    sent.length = 0
    const next = await invoke(APP_CHOICE_CHANNELS.set, { off: [...TEN_EDITORS] })
    expect(next).toEqual({ off: ['hwp'], aiFeatures: true, locked: false })
    expect(stored().editors).toEqual({ off: ['hwp'] })
    expect(sent).toEqual([])
  })

  it('writes AI off as false and removes the key when it is on again', async () => {
    await invoke(APP_CHOICE_CHANNELS.set, { aiFeatures: false })
    expect(stored().aiFeatures).toBe(false)
    expect(service.effective().aiFeatures).toBe(false)
    await invoke(APP_CHOICE_CHANNELS.set, { aiFeatures: true })
    expect('aiFeatures' in stored()).toBe(false)
    expect(service.effective().aiFeatures).toBe(true)
  })

  it('leaves the editors as they are when only AI changes', async () => {
    await invoke(APP_CHOICE_CHANNELS.set, { off: ['pdfTools'] })
    await invoke(APP_CHOICE_CHANNELS.set, { aiFeatures: false })
    expect(service.effective()).toEqual({ off: ['pdfTools'], aiFeatures: false, locked: false })
  })

  it('does not tell anyone when nothing changed', async () => {
    await invoke(APP_CHOICE_CHANNELS.set, { off: [] })
    await invoke(APP_CHOICE_CHANNELS.set, 'garbage')
    expect(sent).toEqual([])
  })
})

describe('the one-time picker', () => {
  it('is due after onboarding until it is marked seen', async () => {
    expect(invoke(APP_CHOICE_CHANNELS.pickDue)).toBe(true)
    await invoke(APP_CHOICE_CHANNELS.markPickSeen)
    expect(stored().editorPickSeen).toBe(true)
    expect(stored().theme).toBe('dark')
    expect(invoke(APP_CHOICE_CHANNELS.pickDue)).toBe(false)
  })

  it('is not due before onboarding was seen', () => {
    writeFileSync(settingsPath, JSON.stringify({}))
    expect(invoke(APP_CHOICE_CHANNELS.pickDue)).toBe(false)
  })
})

describe('the ai-off check', () => {
  it('refuses a run from an app screen while AI is off', async () => {
    expect(aiRunRefusal({ senderId: 1, provider: 'codex', model: '' })).toBeNull()
    await invoke(APP_CHOICE_CHANNELS.set, { aiFeatures: false })
    expect(aiRunRefusal({ senderId: 1, provider: 'codex', model: '' })).toBe('AI is off')
    // not a window of this app: not this check's business
    expect(aiRunRefusal({ senderId: 99, provider: 'codex', model: '' })).toBeNull()
  })
})

describe('running AI jobs', () => {
  it('answers the count and stops them all', async () => {
    const stop = vi.fn()
    registerAiJob({ kind: 'chat', stop })
    expect(invoke(APP_CHOICE_CHANNELS.aiJobCount)).toBe(1)
    expect(await invoke(APP_CHOICE_CHANNELS.stopAllAiJobs)).toBe(1)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(runningAiJobCount()).toBe(0)
  })

  it('tells every window when the count changes', () => {
    const done = registerAiJob({ kind: 'generate', stop: () => undefined })
    done()
    expect(
      sent.filter((m) => m.channel === APP_CHOICE_CHANNELS.aiJobsChanged).map((m) => m.payload),
    ).toEqual([1, 1, 0, 0])
  })
})

describe('requests from a window other than the shell', () => {
  it('cannot change the choice: they get it as it is and nothing is stored or told', async () => {
    const heard: unknown[] = []
    const off = service.onChange((choice) => heard.push(choice))
    for (const sender of [2, 3]) {
      expect(await invokeFrom(sender, APP_CHOICE_CHANNELS.set, { aiFeatures: false })).toEqual({
        off: [],
        aiFeatures: true,
        locked: false,
      })
      await invokeFrom(sender, APP_CHOICE_CHANNELS.set, { off: ['docs'] })
    }
    off()
    expect(stored()).toEqual({ theme: 'dark', onboardingSeen: true })
    expect(sent).toEqual([])
    expect(heard).toEqual([])
  })

  it('cannot mark the one-time picker seen', async () => {
    await invokeFrom(2, APP_CHOICE_CHANNELS.markPickSeen)
    expect('editorPickSeen' in stored()).toBe(false)
    expect(invokeFrom(2, APP_CHOICE_CHANNELS.pickDue)).toBe(true)
  })

  it('cannot stop every AI job, and may still read the count', async () => {
    const stop = vi.fn()
    const done = registerAiJob({ kind: 'chat', stop })
    expect(invokeFrom(2, APP_CHOICE_CHANNELS.aiJobCount)).toBe(1)
    expect(await invokeFrom(2, APP_CHOICE_CHANNELS.stopAllAiJobs)).toBe(0)
    expect(stop).not.toHaveBeenCalled()
    expect(runningAiJobCount()).toBe(1)
    done()
  })

  it('may still read the choice', async () => {
    writeFileSync(settingsPath, JSON.stringify({ editors: { off: ['hwp'] } }))
    expect(invokeFrom(2, APP_CHOICE_CHANNELS.get)).toEqual({
      off: ['hwp'],
      aiFeatures: true,
      locked: false,
    })
  })
})
