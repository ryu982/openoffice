/**
 * AI turned off in Settings (Settings › Editors and AI), in the whole editor against a
 * scripted main process: the AI panel and its rail are not drawn. Turned on again they come
 * back at once, and turned off they go, without reopening the tab; a panel taken away asks
 * nothing more about the subscriptions. draw.io itself is never loaded (jsdom does not load
 * the frame), and the statuses are fakes: nothing can start a program.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { defaultAiSettings } from '@genoffice/ai-provider'
import type { SubscriptionStatusMap } from '@genoffice/ai-provider/browser'
import type { Lang } from '@genoffice/i18n'
import type { AppChoiceSource, AppChoiceState } from '@genoffice/ui'
import App from '../src/renderer/App'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import type { DiagramApi } from '../src/shared/ipc'

const NOT_CONNECTED: SubscriptionStatusMap = {
  'claude-code': { provider: 'claude-code', state: 'signed-out', meteredAccepted: false },
  codex: { provider: 'codex', state: 'not-installed', meteredAccepted: false },
}

/**
 * The preload API: the calls named here answer as written, every other `on…` is a
 * subscription that never fires and every other call resolves to nothing.
 */
function fakeApi() {
  const statuses = vi.fn(async () => NOT_CONNECTED)
  const given: Record<string, unknown> = {
    consumePending: async () => null,
    takeSeed: async () => null,
    getLanguage: async () => 'en' as Lang,
    getTheme: async () => 'system',
    getAutoSaveDefault: async () => ({ on: false, updatedAt: 0 }),
    getAiSettings: async () => ({ ...defaultAiSettings(), subscriptionNoticeSeen: true }),
    getAiPanelPrefs: async () => ({}),
    addAttachmentPaths: async () => ({ accepted: [], rejected: [] }),
    readAttachmentImage: async () => ({ ok: false }),
    subscription: {
      statuses,
      recheck: statuses,
      login: vi.fn(async () => ({ ok: true })),
      install: vi.fn(async () => ({ ok: true })),
      setMeteredAccepted: vi.fn(async () => ({ ok: true, statuses: NOT_CONNECTED })),
      onChanged: () => () => {},
      openInstallHelp: vi.fn(async () => undefined),
    },
  }
  const api = new Proxy(given, {
    get(target, name) {
      if (typeof name !== 'string' || name === 'then') return undefined
      if (name in target) return target[name]
      if (/^on[A-Z]/.test(name)) return () => () => {}
      return async () => undefined
    },
  })
  return { api: api as unknown as DiagramApi, statuses }
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
let unmount: () => void = () => {}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  Element.prototype.scrollTo = () => undefined
})
afterEach(() => {
  unmount()
  unmount = () => {}
  document.body.innerHTML = ''
  delete (window as { diagramApi?: unknown }).diagramApi
  vi.unstubAllGlobals()
})

async function settle(turns = 12): Promise<void> {
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
  ;(window as unknown as { diagramApi: DiagramApi }).diagramApi = fake.api
  vi.stubGlobal('aiOfficeEditorChoice', choice.source)
  container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(LocaleProvider, {
        initial: 'en',
        children: createElement(App, { initialTheme: 'system' }),
      }),
    )
  })
  unmount = () => act(() => root.unmount())
  await settle()
}

const dock = () => container.querySelector('.ai-dock')
const rail = () => container.querySelector('.ai-rail')

describe('AI turned off in Settings', () => {
  it('draws no AI panel or rail', async () => {
    const fake = fakeApi()
    await mountApp(fake, fakeChoice(false))
    expect(container.querySelector('.dg-frame')).not.toBeNull()
    expect(dock()).toBeNull()
    expect(rail()).toBeNull()
    expect(container.querySelector('.ai-input-box')).toBeNull()
  })

  it('brings the panel back at once when AI is turned on', async () => {
    const choice = fakeChoice(false)
    await mountApp(fakeApi(), choice)
    expect(dock()).toBeNull()

    choice.setAi(true)
    await settle()
    expect(dock()).not.toBeNull()
  })

  it('takes the panel away from an open tab when AI is turned off', async () => {
    const fake = fakeApi()
    const choice = fakeChoice(true)
    await mountApp(fake, choice)
    expect(dock()).not.toBeNull()

    choice.setAi(false)
    await settle()
    expect(dock()).toBeNull()
    fake.statuses.mockClear()
    await settle()
    expect(fake.statuses).not.toHaveBeenCalled()
    expect(container.querySelector('.dg-frame')).not.toBeNull()
  })
})
