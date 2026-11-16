/**
 * AI turned off in Settings (Settings › Editors and AI), in the whole editor against a
 * scripted main process: the toolbar's AI button, the AI panel and its rail are not drawn,
 * a request the shell handed over is not taken, and the panel never asks for the
 * subscription statuses. Turned on again they come back at once, and turned off they go,
 * without reopening the tab. The statuses are fakes: nothing can start a program.
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
import type { MindmapApi, MindmapHandoff } from '../src/shared/ipc'
import { mapLoaded, until } from './helpers/wait'

const NOT_CONNECTED: SubscriptionStatusMap = {
  'claude-code': { provider: 'claude-code', state: 'signed-out', meteredAccepted: false },
  codex: { provider: 'codex', state: 'not-installed', meteredAccepted: false },
}

const HANDOFF: MindmapHandoff = { id: 'handoff-1', sourcePaths: [], prompt: 'Make a map' }

function fakeApi() {
  const off = () => () => {}
  const statuses = vi.fn(async () => NOT_CONNECTED)
  const takeHandoff = vi.fn(async () => HANDOFF)
  const api = {
    consumePending: async () => null,
    save: async () => ({ ok: true, path: 'C:/maps/new.xmind' }),
    setDirty: () => {},
    onSaveRequest: off,
    sendSaveRequestAck: () => {},
    onCloseSaveRequest: off,
    sendCloseSaveResult: () => {},
    onFileRenamed: off,
    openLink: async () => true,
    onMenuCommand: off,
    onExportRequest: off,
    onPrintRequest: off,
    getLanguage: async () => 'en' as Lang,
    onLanguageChanged: off,
    getTheme: async () => 'system' as const,
    onThemeChanged: off,
    getAutoSaveDefault: async () => ({ on: false, updatedAt: 0 }),
    onAutoSaveDefaultChanged: off,
    onChromePressed: off,
    onOutlineRequest: off,
    sendOutlineResult: () => {},
    onBytesRequest: off,
    sendBytesResult: () => {},
    takeHandoff,
    notifyHandoffRunStarted: () => {},
    getAiSettings: async () => ({ ...defaultAiSettings(), subscriptionNoticeSeen: true }),
    setAiSettings: async () => {},
    onAiSettingsChanged: off,
    openAiModelSettings: async () => {},
    getAiPanelPrefs: async () => ({}),
    onAiPanelPrefsChanged: off,
    setProvisionalTitle: () => {},
    addAttachmentPaths: async () => ({ accepted: [], rejected: [] }),
    readAttachmentImage: async () => ({ ok: false }),
    subscription: {
      statuses,
      recheck: statuses,
      login: vi.fn(async () => ({ ok: true })),
      install: vi.fn(async () => ({ ok: true })),
      setMeteredAccepted: vi.fn(async () => ({ ok: true, statuses: NOT_CONNECTED })),
      onChanged: off,
      openInstallHelp: vi.fn(async () => undefined),
    },
    onAiStream: off,
    aiStream: vi.fn(async () => {}),
    aiStreamCancel: async () => {},
  }
  return { api: api as unknown as MindmapApi, statuses, takeHandoff }
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
  delete (window as { mindmapApi?: unknown }).mindmapApi
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
  ;(window as unknown as { mindmapApi: MindmapApi }).mindmapApi = fake.api
  vi.stubGlobal('aiOfficeEditorChoice', choice.source)
  container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en', children: createElement(App) }))
  })
  unmount = () => act(() => root.unmount())
  await until(() => mapLoaded(container), 'the map to open')
  await settle()
}

const aiButton = () => container.querySelector('[data-action="ai"]')
const dock = () => container.querySelector('.ai-dock')
const rail = () => container.querySelector('.ai-rail')

describe('AI turned off in Settings', () => {
  it('draws no AI button, panel or rail, takes no handed-over request and asks nothing', async () => {
    const fake = fakeApi()
    await mountApp(fake, fakeChoice(false))
    expect(container.querySelector('.mm-sheet-host')).not.toBeNull()
    expect(aiButton()).toBeNull()
    expect(dock()).toBeNull()
    expect(rail()).toBeNull()
    expect(container.querySelector('.ai-input-box')).toBeNull()
    expect(fake.takeHandoff).not.toHaveBeenCalled()
    expect(fake.statuses).not.toHaveBeenCalled()
  })

  it('brings them back at once when AI is turned on', async () => {
    const fake = fakeApi()
    const choice = fakeChoice(false)
    await mountApp(fake, choice)
    expect(aiButton()).toBeNull()

    choice.setAi(true)
    await settle()
    expect(aiButton()).not.toBeNull()
    expect(dock()).not.toBeNull()
  })

  it('takes them away from an open tab when AI is turned off', async () => {
    const fake = fakeApi()
    const choice = fakeChoice(true)
    await mountApp(fake, choice)
    expect(aiButton()).not.toBeNull()
    expect(dock()).not.toBeNull()

    choice.setAi(false)
    await settle()
    expect(aiButton()).toBeNull()
    expect(dock()).toBeNull()
    // the map itself stays as it was
    expect(container.querySelector('.mm-sheet-host')).not.toBeNull()
  })
})
