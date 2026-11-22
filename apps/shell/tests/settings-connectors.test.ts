/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import type {
  McpServerSettingsView,
  McpServersApi,
  McpServersSettingsView,
} from '../src/shared/mcp-servers-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { McpServersCard } from '../src/renderer/src/mcp/McpServersCard'
import { DriveSettingsCard } from '../src/renderer/src/DriveSettingsCard'
import {
  connectorsText,
  connectorsUiStrings,
  type ConnectorsStringKey,
} from '../src/renderer/src/i18n/strings-connectors'
import { agentMcpStrings } from '../src/renderer/src/i18n/strings-agent-mcp'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function makeServer(over: Partial<McpServerSettingsView> = {}): McpServerSettingsView {
  return {
    id: 's1',
    name: 'notion',
    kind: 'remote',
    presetId: null,
    enabled: true,
    keepResultsInside: true,
    url: 'https://mcp.notion.com/mcp',
    transport: 'auto',
    headers: {},
    oauth: { clientId: '', clientSecret: { state: 'missing', last4: '' }, signedIn: true },
    command: '',
    args: [],
    env: {},
    vaults: [],
    launchReviewNeeded: false,
    instructions: null,
    pendingInstructions: null,
    tools: {},
    newTools: [],
    secretsMemoryOnly: false,
    status: { status: 'connected' },
    review: [],
    toolNames: {},
    failure: null,
    ...over,
  }
}

function makeFakeApi(servers: McpServerSettingsView[]) {
  const state = { view: { sealing: true, runtimes: {}, servers } as McpServersSettingsView }
  const ok = async () => ({ ok: true as const })
  const api = {
    list: vi.fn(async () => state.view),
    onChanged: vi.fn(() => () => undefined),
    onOpenServer: vi.fn(() => () => undefined),
    parsePaste: vi.fn(async () => ({ ok: false as const, error: 'empty' as const })),
    add: vi.fn(async () => ({ ok: true as const, id: 'custom-1' })),
    edit: vi.fn(ok),
    remove: vi.fn(ok),
    test: vi.fn(async () => ({ ok: true as const, toolCount: 3 })),
    signIn: vi.fn(async () => ({ ok: true as const })),
    cancelSignIn: vi.fn(async () => {}),
    approveTool: vi.fn(ok),
    approveInstructions: vi.fn(ok),
    approveLaunch: vi.fn(ok),
    setToolPermission: vi.fn(ok),
    setKeepResultsInside: vi.fn(ok),
    setEnabled: vi.fn(ok),
    markToolsSeen: vi.fn(ok),
    plannedLaunch: vi.fn(async () => ({ ok: false as const, problem: 'not-local' as const })),
    answerRuntimeDownload: vi.fn(async () => ({
      ok: false as const,
      problem: 'not-local' as const,
    })),
    retry: vi.fn(ok),
    connectPreset: vi.fn(async () => ({ ok: true as const, id: 'preset-new' })),
    pickVaultFolder: vi.fn(async () => ({
      ok: true as const,
      path: 'C:/Vaults/Notes',
      suggestedName: 'Notes',
      hasObsidianDir: false,
    })),
    addVault: vi.fn(async () => ({ ok: true as const, serverId: 'obs-1', vaultId: 'v-1' })),
    removeVault: vi.fn(ok),
    renameVault: vi.fn(ok),
    setVaultEnabled: vi.fn(ok),
  } as unknown as McpServersApi & Record<string, ReturnType<typeof vi.fn>>
  return { api, state }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function click(el: Element | null | undefined): Promise<void> {
  expect(el).toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
    await Promise.resolve()
  })
  await flush()
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete window.aiOfficeMcpServers
  delete window.aiOfficeDrive
})

describe('Settings → Integrations: 6-service curated connectors', () => {
  it('renders Notion, Canva, Obsidian Vault, Korean Law MCP, and kordoc MCP in exact order', async () => {
    const h = makeFakeApi([])
    window.aiOfficeMcpServers = h.api
    await act(async () => {
      root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(McpServersCard)))
    })
    await flush()
    const presets = [...host.querySelectorAll('[data-preset]')].map((el) =>
      el.getAttribute('data-preset'),
    )
    expect(presets).toEqual(['notion', 'canva', 'obsidian', 'korean-law', 'kordoc'])
  })

  it('runs Notion 1-flow: short notice → connectPreset → signIn → test', async () => {
    const h = makeFakeApi([])
    window.aiOfficeMcpServers = h.api
    await act(async () => {
      root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(McpServersCard)))
    })
    await flush()
    const card = host.querySelector('[data-preset="notion"]')!
    await click(card.querySelector('button'))
    const panel = host.querySelector('[data-testid="preset-confirm-notion"]')!
    expect(panel.textContent).toContain(connectorsText('en', 'notionNotice'))
    const buttons = [...panel.querySelectorAll('button')]
    await click(buttons.find((b) => b.textContent === connectorsText('en', 'continueSignIn')))
    expect(h.api.connectPreset).toHaveBeenCalledWith({ presetId: 'notion' })
    expect(h.api.signIn).toHaveBeenCalledWith('preset-new')
    expect(h.api.test).toHaveBeenCalledWith('preset-new')
  })

  it('asks one-time confirmation when adding an Obsidian folder without .obsidian', async () => {
    const h = makeFakeApi([])
    window.aiOfficeMcpServers = h.api
    await act(async () => {
      root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(McpServersCard)))
    })
    await flush()
    const card = host.querySelector('[data-preset="obsidian"]')!
    await click(card.querySelector('button'))
    const confirm = host.querySelector('[data-testid="obsidian-missing-dir-confirm"]')!
    expect(confirm).toBeTruthy()
    expect(h.api.addVault).not.toHaveBeenCalled()
    const buttons = [...confirm.querySelectorAll('button')]
    await click(
      buttons.find((b) => b.textContent === connectorsText('en', 'obsidianConnectAnyway')),
    )
    expect(h.api.addVault).toHaveBeenCalledWith({ path: 'C:/Vaults/Notes', name: 'Notes' })
  })

  it('hides only the Drive AI access toggle when aiOn is false', async () => {
    ;(window as unknown as { aiOfficeDrive?: unknown }).aiOfficeDrive = {
      state: vi.fn(async () => ({
        state: 'connected',
        email: 'user@example.com',
        name: 'User',
        aiAccess: true,
        trainingAck: true,
        persisted: true,
        expired: false,
      })),
      onStateChanged: vi.fn(() => () => undefined),
      setAiAccess: vi.fn(async () => {}),
      setTrainingAck: vi.fn(async () => {}),
      connect: vi.fn(async () => ({ ok: true })),
      cancelConnect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
    }
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(DriveSettingsCard, { aiOn: false }),
        ),
      )
    })
    await flush()
    const card = host.querySelector('[data-testid="drive-settings"]')!
    expect(card).toBeTruthy()
    expect(card.textContent).toContain('user@example.com')
    // Only the training ack checkbox remains; the AI access checkbox is hidden
    expect(card.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
  })

  it('keeps preset servers out of the custom MCP list and shows kordoc non-redaction notice', async () => {
    const h = makeFakeApi([
      makeServer({ id: 'n1', name: 'notion', presetId: 'notion' }),
      makeServer({ id: 'c1', name: 'my-custom', presetId: null }),
    ])
    window.aiOfficeMcpServers = h.api
    await act(async () => {
      root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(McpServersCard)))
    })
    await flush()
    const kordoc = host.querySelector('[data-preset="kordoc"]')!
    await click(kordoc.querySelector('button'))
    const setup = host.querySelector('[data-testid="preset-setup-kordoc"]')!
    expect(setup.textContent).toContain(connectorsText('en', 'kordocNotice'))
    // Custom server list contains only c1 (not n1)
    const customList = host.querySelector('section > ul.mcp-list')!
    expect(customList.querySelectorAll('[data-mcp-server]')).toHaveLength(1)
    expect(customList.querySelector('[data-mcp-server="c1"]')).toBeTruthy()
  })

  it('sends lawOc (not env) when connecting Korean Law MCP', async () => {
    const h = makeFakeApi([])
    window.aiOfficeMcpServers = h.api
    await act(async () => {
      root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(McpServersCard)))
    })
    await flush()
    const lawCard = host.querySelector('[data-preset="korean-law"]')!
    await click(lawCard.querySelector('button'))
    const setup = host.querySelector('[data-testid="preset-setup-korean-law"]')!
    const input = setup.querySelector<HTMLInputElement>('input[name="LAW_OC"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        '  my-oc-id  ',
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })
    const buttons = [...setup.querySelectorAll('button')]
    await click(buttons.find((b) => b.textContent === connectorsText('en', 'registerAndReview')))
    expect(h.api.connectPreset).toHaveBeenCalledWith({
      presetId: 'korean-law',
      lawOc: 'my-oc-id',
    })
  })

  it('provides all 22 UI languages with matching placeholders for connectors & agent-mcp strings', () => {
    const keys = Object.keys(connectorsUiStrings.zh) as ConnectorsStringKey[]
    for (const lang of LANGS) {
      const table = connectorsUiStrings[lang] as Record<string, string>
      expect(Object.keys(table).sort(), lang).toEqual([...keys].sort())
      for (const key of keys) {
        const holes = (connectorsUiStrings.en[key].match(/\{\w+\}/g) ?? []).sort()
        expect((table[key]!.match(/\{\w+\}/g) ?? []).sort(), `${lang}.${key}`).toEqual(holes)
      }
      expect(agentMcpStrings[lang].mcpExternalVaultWarning).toContain('{vaults}')
    }
  })
})
