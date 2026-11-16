/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import type { HomeKindsApi, HomeKindsSettings } from '../src/shared/home-kinds'
import type { IntegrationsApi, IntegrationsStatus } from '../src/shared/integrations-api'
import type {
  AppChoice,
  AppChoicePatch,
  EditorChoiceApi,
  EditorItemId,
} from '../src/shared/editor-choice'
import type { TabsApi, TabSummary } from '../src/shared/tabs-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SettingsModal, type SettingsTarget } from '../src/renderer/src/SettingsModal'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

interface FakeChoice {
  api: EditorChoiceApi
  /** what the fake main process holds */
  stored: AppChoice
  /** send a change as if made elsewhere (another window, the first-run guide) */
  emit: (next: AppChoice) => void
  calls: string[]
}

function fakeChoice(initial: Partial<AppChoice>, jobs = 0): FakeChoice {
  const listeners = new Set<(choice: AppChoice) => void>()
  const fake: FakeChoice = {
    stored: { off: [], aiFeatures: true, locked: false, ...initial },
    calls: [],
    emit: (next) => {
      fake.stored = next
      for (const listener of listeners) listener(next)
    },
    api: {
      get: async () => fake.stored,
      set: vi.fn(async (patch: AppChoicePatch) => {
        fake.calls.push(`set:${JSON.stringify(patch)}`)
        fake.stored = {
          ...fake.stored,
          ...(patch.off ? { off: patch.off } : {}),
          ...(typeof patch.aiFeatures === 'boolean' ? { aiFeatures: patch.aiFeatures } : {}),
        }
        return fake.stored
      }),
      onChange: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      pickDue: async () => false,
      markPickSeen: async () => {},
      aiJobCount: vi.fn(async () => {
        fake.calls.push('count')
        return jobs
      }),
      onAiJobCountChange: () => () => {},
      stopAllAiJobs: vi.fn(async () => {
        fake.calls.push('stop')
        return jobs
      }),
    },
  }
  return fake
}

function fakeHomeKinds(initial: HomeKindsSettings) {
  let value = initial
  const set = vi.fn(async (next: HomeKindsSettings) => {
    value = next
    return value
  })
  const api: HomeKindsApi = { get: async () => value, set, onChanged: () => () => {} }
  return { api, set }
}

function integrationsStatus(): IntegrationsStatus {
  return {
    cli: {
      status: 'missing',
      location: '/usr/local/bin/ieumoffice',
      manual: 'sudo ln -sf a b',
      launcherDir: '/x',
      ephemeral: false,
      version: '0.4.0',
    },
    skillVersion: '2.1.0',
    skillNeedsCli: '0.4.0',
    agents: [],
  } as unknown as IntegrationsStatus
}

const subscription = {
  statuses: vi.fn(() => new Promise(() => {})),
  recheck: vi.fn(() => new Promise(() => {})),
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  subscription.statuses.mockClear()
  subscription.recheck.mockClear()
  window.aiOffice = {
    getTheme: async () => 'system',
    getDefaultSaveDir: async () => '',
    getAutoSaveDefault: async () => ({ on: false, updatedAt: 0 }),
    getAiPanelPrefs: async () => ({ fontSize: 'default', spellcheck: true }),
    getUpdateChannel: async () => 'stable',
    getAppVersion: async () => '1.0.0',
  } as unknown as HomeApi
  const w = window as unknown as Record<string, unknown>
  w.aiOfficeSubscription = subscription
  w.aiOfficeIntegrations = {
    status: async () => integrationsStatus(),
    copyText: async () => {},
  } as unknown as IntegrationsApi
  w.aiOfficeMcpServers = {
    list: async () => ({ servers: [] }),
    onChanged: () => () => {},
    onOpenServer: () => () => {},
  }
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  const w = window as unknown as Record<string, unknown>
  for (const key of [
    'aiOffice',
    'aiOfficeEditorChoice',
    'aiOfficeHomeKinds',
    'aiOfficeTabs',
    'aiOfficeSubscription',
    'aiOfficeIntegrations',
    'aiOfficeMcpServers',
  ])
    delete w[key]
})

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function open(
  choice: FakeChoice,
  target: SettingsTarget | null = null,
  extra: { tabs?: TabSummary[]; homeKinds?: HomeKindsApi } = {},
): Promise<void> {
  const w = window as unknown as Record<string, unknown>
  w.aiOfficeEditorChoice = choice.api
  if (extra.homeKinds) w.aiOfficeHomeKinds = extra.homeKinds
  if (extra.tabs) {
    const tabs = extra.tabs
    w.aiOfficeTabs = {
      list: async () => tabs,
      onChanged: () => () => {},
    } as unknown as TabsApi
  }
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(SettingsModal, { onClose: vi.fn(), target }),
      ),
    )
  })
  await flush()
}

const navLabels = () =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.set-nav-item')).map((b) =>
    b.textContent?.trim(),
  )
const activeNav = () => host.querySelector('.set-nav-item.active')?.textContent?.trim()
const navButton = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.set-nav-item')).find(
    (b) => b.textContent?.trim() === label,
  )!
const aiSwitch = () =>
  host.querySelector<HTMLButtonElement>('[data-item="ai"] button[role="switch"]')!
const itemSwitch = (item: EditorItemId) =>
  host.querySelector<HTMLButtonElement>(`[data-item="${item}"] button[role="switch"]`)!

async function click(el: HTMLElement | null | undefined): Promise<void> {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => {
    el!.click()
  })
  await flush()
}

describe('Settings → Editors and AI: which sections show', () => {
  it('lists every section with AI on, the editors and AI section right after General', async () => {
    await open(fakeChoice({}))
    expect(navLabels()).toEqual([
      'Account',
      'AI',
      'Skills',
      'General',
      'Editors and AI',
      'Integrations',
      'About',
    ])
    expect(activeNav()).toBe('Account')
  })

  it('hides account, AI and skills while AI is off and opens on General', async () => {
    await open(fakeChoice({ aiFeatures: false }))
    expect(navLabels()).toEqual(['General', 'Editors and AI', 'Integrations', 'About'])
    expect(activeNav()).toBe('General')
    await click(navButton('Editors and AI'))
    expect(activeNav()).toBe('Editors and AI')
    expect(aiSwitch().getAttribute('aria-checked')).toBe('false')
  })

  it('opens a hidden section as Editors and AI while AI is off', async () => {
    for (const section of ['account', 'aiModel', 'aiMedia', 'skills'] as const) {
      await open(fakeChoice({ aiFeatures: false }), { section })
      expect(activeNav(), section).toBe('Editors and AI')
      expect(host.querySelector('[data-testid="editor-choice-section"]'), section).toBeTruthy()
    }
  })

  it('starts no subscription check while AI is off, and checks while AI is on', async () => {
    await open(fakeChoice({ aiFeatures: false }))
    expect(subscription.recheck).not.toHaveBeenCalled()
    expect(subscription.statuses).not.toHaveBeenCalled()
    act(() => root.unmount())
    root = createRoot(host)
    await open(fakeChoice({}))
    expect(subscription.recheck).toHaveBeenCalled()
  })

  it('leaves the AI rows out of General while AI is off', async () => {
    await open(fakeChoice({ aiFeatures: false }))
    const text = host.querySelector('.set-pane')!.textContent ?? ''
    expect(text).not.toContain('AI sidebar position')
    expect(text).not.toContain('AI panel text size')
    expect(text).not.toContain('Spell check in AI chat')
    expect(host.querySelector('[data-testid="slides-ai-fonts"]')).toBeNull()
    // the other rows stay
    expect(text).toContain('Theme')
  })

  it('keeps the AI rows in General while AI is on', async () => {
    await open(fakeChoice({}), { section: 'general' })
    const text = host.querySelector('.set-pane')!.textContent ?? ''
    expect(text).toContain('AI sidebar position')
    expect(host.querySelector('[data-testid="slides-ai-fonts"]')).toBeTruthy()
  })

  it('leaves the MCP servers card out of Integrations while AI is off', async () => {
    await open(fakeChoice({ aiFeatures: false }), { section: 'integrations' })
    expect(host.querySelector('.set-intg-hero')).toBeTruthy()
    expect(host.querySelector('[data-testid="mcp-servers"]')).toBeNull()
    act(() => root.unmount())
    root = createRoot(host)
    await open(fakeChoice({}), { section: 'integrations' })
    expect(host.querySelector('[data-testid="mcp-servers"]')).toBeTruthy()
  })

  it('follows a change made elsewhere while open', async () => {
    const choice = fakeChoice({})
    await open(choice, { section: 'general' })
    expect(navLabels()).toContain('AI')
    await act(async () => choice.emit({ off: [], aiFeatures: false, locked: false }))
    await flush()
    expect(navLabels()).not.toContain('AI')
    expect(activeNav()).toBe('General')
  })
})

describe('Settings → Editors and AI: switches', () => {
  it('saves an editor switch at once and marks editors with open documents', async () => {
    const choice = fakeChoice({})
    await open(
      choice,
      { section: 'editorChoice' },
      {
        tabs: [
          { id: 'h', kind: 'home', active: true } as unknown as TabSummary,
          { id: 'd', kind: 'docs', active: false } as unknown as TabSummary,
        ],
      },
    )
    expect(host.querySelector('[data-item="docs"] .ec-row-open')).toBeTruthy()
    expect(host.querySelector('[data-item="sheets"] .ec-row-open')).toBeNull()
    await click(itemSwitch('slides'))
    expect(choice.calls).toEqual(['set:{"off":["slides"]}'])
    expect(itemSwitch('slides').getAttribute('aria-checked')).toBe('false')
  })

  it('turns AI off at once when no AI job is running', async () => {
    const choice = fakeChoice({}, 0)
    await open(choice, { section: 'editorChoice' })
    await click(aiSwitch())
    expect(choice.calls).toEqual(['count', 'set:{"aiFeatures":false}'])
    expect(host.querySelector('.es-confirm')).toBeNull()
    expect(navLabels()).not.toContain('AI')
    expect(activeNav()).toBe('Editors and AI')
    expect(choice.api.stopAllAiJobs).not.toHaveBeenCalled()
  })

  it('asks before stopping running AI jobs, then turns AI off and stops them', async () => {
    const choice = fakeChoice({}, 2)
    await open(choice, { section: 'editorChoice' })
    await click(aiSwitch())
    const confirm = host.querySelector('.es-confirm')
    expect(confirm?.textContent).toContain('AI jobs running: 2')
    expect(choice.calls).toEqual(['count'])
    expect(aiSwitch().getAttribute('aria-checked')).toBe('true')
    await click(host.querySelector<HTMLButtonElement>('.es-ai-off-stop'))
    expect(choice.calls).toEqual(['count', 'set:{"aiFeatures":false}', 'stop'])
    expect(host.querySelector('.es-confirm')).toBeNull()
    expect(aiSwitch().getAttribute('aria-checked')).toBe('false')
  })

  it('changes nothing when the question is cancelled', async () => {
    const choice = fakeChoice({}, 1)
    await open(choice, { section: 'editorChoice' })
    await click(aiSwitch())
    await click(host.querySelector<HTMLButtonElement>('.es-ai-off-cancel'))
    expect(choice.calls).toEqual(['count'])
    expect(choice.api.stopAllAiJobs).not.toHaveBeenCalled()
    expect(host.querySelector('.es-confirm')).toBeNull()
    expect(aiSwitch().getAttribute('aria-checked')).toBe('true')
    expect(navLabels()).toContain('AI')
  })

  it('turns AI back on and brings the AI sections back', async () => {
    const choice = fakeChoice({ aiFeatures: false })
    await open(choice, { section: 'skills' })
    expect(activeNav()).toBe('Editors and AI')
    await click(aiSwitch())
    expect(choice.calls).toEqual(['set:{"aiFeatures":true}'])
    expect(navLabels()).toContain('Skills')
    // a switch moved here: the page stays, it does not jump to the skills asked for at first
    expect(activeNav()).toBe('Editors and AI')
  })
})

describe('Settings → General: new documents on Home with items off', () => {
  it('lists only kinds whose item is on and keeps the off kinds stored', async () => {
    const stored: HomeKindsSettings = {
      order: ['docx', 'xlsx', 'pptx', 'md', 'html', 'xmind', 'drawio', 'hwp', 'pdf', 'pdfTools'],
      hidden: ['xlsx'],
    }
    const homeKinds = fakeHomeKinds(stored)
    await open(
      fakeChoice({ off: ['sheets', 'pdfTools'] }),
      { section: 'general' },
      {
        homeKinds: homeKinds.api,
      },
    )
    const rows = Array.from(host.querySelectorAll<HTMLElement>('.set-home-kind')).map(
      (row) => row.dataset.kind,
    )
    expect(rows).toEqual(['docx', 'pptx', 'md', 'html', 'xmind', 'drawio', 'hwp', 'pdf'])
    // move pptx up: it passes docx, the off xlsx keeps its place and its hidden mark
    const up = host.querySelector<HTMLButtonElement>('[data-kind="pptx"] .set-home-kind-move')!
    await click(up)
    expect(homeKinds.set).toHaveBeenCalledWith({
      order: ['pptx', 'xlsx', 'docx', 'md', 'html', 'xmind', 'drawio', 'hwp', 'pdf', 'pdfTools'],
      hidden: ['xlsx'],
    })
  })
})
