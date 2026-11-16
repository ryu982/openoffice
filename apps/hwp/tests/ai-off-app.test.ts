/** @vitest-environment jsdom */
/**
 * AI turned off in Settings (Settings › Editors and AI), in the whole Hangul editor screen
 * with a fake editor: the AI dock and its rail are not drawn, the editor's right-click
 * 쉬운 말로 풀기 is taken out of the plugin's commands (so the menus leave it out) and the
 * marks of the AI's changes are cleared, and the panel never asks for the subscription
 * statuses. Turned on again they come back at once; turned off they go from an open tab.
 * No editor is started and no provider program can be reached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAiSettings } from '@genoffice/ai-provider'
import type { AppChoiceSource, AppChoiceState } from '@genoffice/ui'
import type { HwpApi } from '../src/shared/ipc'

/** every call the screen made into the app's plugin inside the editor, by method name */
const pluginCalls: string[] = []

vi.mock('@rhwp/editor', () => ({
  createEditor: async (host: HTMLElement) => {
    const frame = document.createElement('iframe')
    host.appendChild(frame)
    return {
      element: frame,
      loadFile: async () => undefined,
      commands: { context: async () => ({ isDirty: false, passwordProtected: false }) },
      plugins: {
        load: async () => undefined,
        invoke: async (_plugin: string, method: string) => {
          pluginCalls.push(method)
          return { ok: true, memos: [], tabs: [], count: 0, segments: [], fonts: [] }
        },
      },
      chrome: { get: async () => ({}), set: async () => undefined },
      exportHwp: async () => new Uint8Array(),
      exportHwpx: async () => new Uint8Array(),
      notifySaved: () => undefined,
      destroy: () => undefined,
    }
  },
}))

import App from '../src/renderer/App'
import { LocaleProvider } from '../src/renderer/i18n/locale'

/**
 * The preload API: the calls named here answer as written, every other `on…` is a
 * subscription that never fires and every other call resolves to nothing.
 */
function fakeApi() {
  const statuses = vi.fn(async () => ({}))
  const given: Record<string, unknown> = {
    consumePending: async () => 'C:/docs/a.hwp',
    untitledCopy: async () => null,
    readFile: async () => new Uint8Array([1, 2, 3]),
    trackingDropped: async () => false,
    getTheme: async () => 'system',
    getLanguage: async () => 'en',
    getAutoSaveDefault: async () => ({ on: false, updatedAt: 0 }),
    getMemoModalOpen: async () => false,
    getAuthorName: async () => ({ value: '', fallback: '' }),
    getAiSettings: async () => ({ ...defaultAiSettings(), subscriptionNoticeSeen: true }),
    getAiPanelPrefs: async () => ({}),
    setAiPanelPrefs: async () => ({}),
    pickAttachments: async () => ({ accepted: [], rejected: [] }),
    addAttachmentPaths: async () => ({ accepted: [], rejected: [] }),
    addPastedImage: async () => ({ accepted: [], rejected: [] }),
    readAttachmentImage: async () => ({ ok: false }),
    getPathForFile: () => '',
    aiSubscription: {
      statuses,
      recheck: statuses,
      onChanged: () => () => undefined,
    },
  }
  const api = new Proxy(given, {
    get(target, name) {
      if (typeof name !== 'string' || name === 'then') return undefined
      if (name in target) return target[name]
      if (/^on[A-Z]/.test(name)) return () => () => undefined
      return async () => undefined
    },
  })
  return { api: api as unknown as HwpApi, statuses }
}

/** The shell's editor choice as the preload exposes it: read and followed */
function fakeChoice(aiFeatures: boolean) {
  let current: AppChoiceState = { off: [], aiFeatures, locked: false }
  const listeners = new Set<(choice: AppChoiceState) => void>()
  const source: AppChoiceSource = {
    get: async () => current,
    onChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    source,
    /** the person flips AI in Settings: every window hears the new choice */
    setAi(on: boolean) {
      current = { ...current, aiFeatures: on }
      act(() => {
        for (const listener of [...listeners]) listener(current)
      })
    },
  }
}

let container: HTMLElement
let root: Root | null = null

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Element.prototype.scrollTo = () => undefined
  localStorage.clear()
  pluginCalls.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container.remove()
  delete (window as { hwpApi?: unknown }).hwpApi
  vi.unstubAllGlobals()
})

async function settle(turns = 16): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function mountApp(
  fake: ReturnType<typeof fakeApi>,
  choice: ReturnType<typeof fakeChoice>,
): Promise<void> {
  Object.assign(window, { hwpApi: fake.api })
  vi.stubGlobal('aiOfficeEditorChoice', choice.source)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(LocaleProvider, { initial: 'en', children: createElement(App) }))
  })
  await settle()
  expect(container.querySelector('.hwp-app')?.getAttribute('data-phase')).toBe('ready')
}

const dock = () => container.querySelector('.ai-dock')
const rail = () => container.querySelector('.ai-rail')
const called = (method: string) => pluginCalls.filter((name) => name === method).length

describe('AI turned off in Settings', () => {
  it('draws no AI dock or rail, keeps 쉬운 말로 풀기 out of the menus and asks nothing', async () => {
    const fake = fakeApi()
    await mountApp(fake, fakeChoice(false))
    expect(dock()).toBeNull()
    expect(rail()).toBeNull()
    expect(container.querySelector('.ai-input-box')).toBeNull()
    expect(called('installEasyWords')).toBe(0)
    expect(called('removeEasyWords')).toBeGreaterThan(0)
    expect(fake.statuses).not.toHaveBeenCalled()
    // the rest of the screen is there: the check panel's button and the memo toggle
    expect(container.querySelector('.hwp-topbar')).not.toBeNull()
  })

  it('brings the dock and the right-click item back at once when AI is turned on', async () => {
    const choice = fakeChoice(false)
    await mountApp(fakeApi(), choice)
    expect(dock()).toBeNull()

    choice.setAi(true)
    await settle()
    expect(dock()).not.toBeNull()
    expect(called('installEasyWords')).toBeGreaterThan(0)
  })

  it('takes them away from an open tab when AI is turned off, with the AI marks', async () => {
    const choice = fakeChoice(true)
    await mountApp(fakeApi(), choice)
    expect(dock()).not.toBeNull()
    expect(called('installEasyWords')).toBeGreaterThan(0)
    expect(called('removeEasyWords')).toBe(0)
    const cleared = called('clearMarks')

    choice.setAi(false)
    await settle()
    expect(dock()).toBeNull()
    expect(called('removeEasyWords')).toBeGreaterThan(0)
    expect(called('clearMarks')).toBeGreaterThan(cleared)
  })
})
