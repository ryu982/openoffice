import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isFileOpen, setOpenFilesSource } from '@genoffice/electron-utils/unsaved-files'
import {
  MCP_TOOLS_CHANNELS,
  mcpToolCallRequestOf,
} from '@genoffice/electron-utils/mcp-tools-channels'
import { matchPresetOfServer } from '../src/main/mcp-client/presets'
import { createMcpHub, type McpHub } from '../src/main/mcp-client/hub'
import { createMcpServersStore } from '../src/main/mcp-client/store'
import { agentRelayPlans } from '../src/main/agent/agent-mcp-relay'
import type { McpSecretCodec } from '../src/main/mcp-client/secrets'

const fakeCodec: McpSecretCodec = {
  canSeal: () => true,
  seal: (p) => `sealed:v1:${Buffer.from(p, 'utf8').toString('base64')}`,
  open: (s) =>
    s.startsWith('sealed:v1:')
      ? Buffer.from(s.slice('sealed:v1:'.length), 'base64').toString('utf8')
      : null,
}

let tempDir: string
let vaultDir1: string
let vaultDir2: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ieum-connectors-hub-'))
  vaultDir1 = join(tempDir, 'VaultOne')
  vaultDir2 = join(tempDir, 'VaultTwo')
  await mkdir(join(vaultDir1, '.obsidian'), { recursive: true })
  await mkdir(vaultDir2, { recursive: true })
  await writeFile(join(vaultDir1, 'NoteA.md'), '# Note A\nHello from VaultOne', 'utf8')
  await writeFile(join(vaultDir2, 'NoteB.md'), '# Note B\nHello from VaultTwo', 'utf8')
})

afterEach(async () => {
  setOpenFilesSource(null)
  await rm(tempDir, { recursive: true, force: true })
})

function makeHub() {
  const store = createMcpServersStore(join(tempDir, 'mcp-servers.json'), fakeCodec)
  const remoteCalls: Array<{ tool: string; input: Record<string, unknown> }> = []
  const revoked: string[] = []
  const openedIntegrations = vi.fn()
  const hub: McpHub = createMcpHub({
    store,
    remote: (server) => ({
      listTools: async () => ({
        tools: [
          { name: 'notion-search', description: 'Search pages', inputSchema: { type: 'object' } },
        ],
        instructions: null,
      }),
      callTool: async (tool, input) => {
        remoteCalls.push({ tool, input })
        return {
          content: [{ type: 'text', text: JSON.stringify({ results: [] }) }],
          isError: false,
        }
      },
      signIn: async () => ({ ok: true }),
      revoke: async () => {
        revoked.push(server.id)
      },
      needsSignIn: () => false,
      onToolsChanged: () => () => {},
      close: async () => {},
    }),
    local: () => ({
      setServer: () => {},
      ensure: async () => {},
      listTools: async () => ({ tools: [], instructions: null }),
      callTool: async () => ({ output: 'ok', isError: false }),
      status: () => ({ state: 'stopped' }),
      stderrTail: () => [],
      retry: () => {},
      onStateChanged: () => () => {},
      onToolsChanged: () => () => {},
      stop: async () => {},
    }),
    kit: { resolveCommand: async () => ({ ok: false, reason: 'not-found' }) as never },
    plannedLaunch: async () =>
      ({
        ok: true,
        command: '/usr/bin/npx',
        args: ['-y', 'korean-law-mcp'],
        addedArgs: [],
        env: [],
        droppedEnv: [],
        source: 'pc',
        runtime: null,
      }) as never,
    lang: () => 'ko',
    openExternal: async () => true,
    openSettings: () => {},
    openIntegrations: openedIntegrations,
    obsidian: {
      homeDir: join(tempDir, 'FakeHome'),
      userData: join(tempDir, 'FakeUserData'),
      isFileOpen: () => false,
      hasUnsavedChanges: () => false,
      parseFileToText: async (p) => ({
        ok: true,
        text: await import('node:fs/promises').then((m) => m.readFile(p, 'utf8')),
      }),
      trashItem: async () => {},
    },
  })
  return { store, hub, remoteCalls, revoked, openedIntegrations }
}

describe('electron-utils unsaved-files & mcp-tools-channels extensions', () => {
  it('checks whether a file is currently open regardless of dirty flag', async () => {
    const file = join(vaultDir1, 'NoteA.md')
    setOpenFilesSource(() => [{ filePath: file, dirty: false }])
    expect(await isFileOpen(file)).toBe(true)
    expect(await isFileOpen(join(vaultDir2, 'NoteB.md'))).toBe(false)
  })

  it('validates disabledVaults and defines openIntegrations channel', () => {
    expect(MCP_TOOLS_CHANNELS.openIntegrations).toBe('mcp-tools:open-integrations')
    expect(
      mcpToolCallRequestOf({
        server: 'obsidian',
        tool: 'list_notes',
        input: {},
        callId: 'c1',
        disabledVaults: ['v1', 'v1'],
      }),
    ).toEqual({
      server: 'obsidian',
      tool: 'list_notes',
      input: {},
      callId: 'c1',
      disabledVaults: ['v1'],
    })
    expect(
      mcpToolCallRequestOf({
        server: 'obsidian',
        tool: 'list_notes',
        input: {},
        callId: 'c1',
        disabledVaults: [123],
      }),
    ).toBeUndefined()
  })
})

describe('preset catalog matching and lifecycle', () => {
  it('matches official URLs/commands only, never by name alone', () => {
    expect(
      matchPresetOfServer({
        kind: 'remote',
        presetId: null,
        url: 'https://mcp.notion.com/mcp/',
        command: '',
        args: [],
      }),
    ).toBe('notion')
    expect(
      matchPresetOfServer({
        kind: 'remote',
        presetId: null,
        url: 'https://unofficial.example/notion',
        command: '',
        args: [],
      }),
    ).toBeNull()
    expect(
      matchPresetOfServer({
        kind: 'local',
        presetId: null,
        url: '',
        command: 'npx',
        args: ['-y', 'korean-law-mcp'],
      }),
    ).toBe('korean-law')
    expect(
      matchPresetOfServer({
        kind: 'local',
        presetId: null,
        url: '',
        command: 'npx',
        args: ['-y', 'kordoc', 'mcp'],
      }),
    ).toBe('kordoc')
  })

  it('disambiguates conflicting manual server names and preserves local launch approval & sealed LAW_OC', async () => {
    const { hub, store } = makeHub()
    // Register an unofficial manual server named "notion"
    await hub.add({ name: 'notion', kind: 'remote', url: 'https://custom.example/mcp' })
    const connected = await hub.connectPreset({ presetId: 'notion' })
    expect(connected.ok).toBe(true)
    if (!connected.ok) return
    expect(store.server(connected.id)?.name).toBe('notion-2')
    expect(store.server(connected.id)?.keepResultsInside).toBe(true)

    // Korean Law requires LAW_OC, seals it, sets keepResultsInside=false, and requires launch approval
    const missingKey = await hub.connectPreset({ presetId: 'korean-law', lawOc: '  ' })
    expect(missingKey.ok).toBe(false)
    const law = await hub.connectPreset({ presetId: 'korean-law', lawOc: 'my-secret-oc-key' })
    expect(law.ok).toBe(true)
    if (!law.ok) return
    const lawServer = store.server(law.id)
    expect(lawServer?.keepResultsInside).toBe(false)
    expect(lawServer?.env.LAW_OC).toBe('my-secret-oc-key')
    expect(lawServer?.approvedLaunch).toBeNull()
    const lawView = hub.settingsView().servers.find((s) => s.id === law.id)
    expect(lawView?.presetId).toBe('korean-law')
    expect(lawView?.launchReviewNeeded).toBe(true)

    // kordoc sets keepResultsInside=true and requires launch approval
    const kordoc = await hub.connectPreset({ presetId: 'kordoc' })
    expect(kordoc.ok).toBe(true)
    if (!kordoc.ok) return
    expect(store.server(kordoc.id)?.keepResultsInside).toBe(true)
    expect(store.server(kordoc.id)?.approvedLaunch).toBeNull()
  })
})

describe('built-in Obsidian vault hub integration & picker accessors & agent relay', () => {
  it('manages multiple vaults, handles server name conflict, enforces disabledVaults, and relays to Agent Mode', async () => {
    const { hub, store } = makeHub()
    // Pre-existing manual server named "obsidian"
    await hub.add({ name: 'obsidian', kind: 'remote', url: 'https://other.example/mcp' })

    const v1 = await hub.addVault({ path: vaultDir1, name: 'Personal' })
    expect(v1.ok).toBe(true)
    if (!v1.ok) return
    expect(store.server(v1.serverId)?.name).toBe('obsidian-2')

    // Duplicate path rejected
    const dup = await hub.addVault({ path: vaultDir1, name: 'Personal Copy' })
    expect(dup.ok).toBe(false)

    const v2 = await hub.addVault({ path: vaultDir2, name: 'Work' })
    expect(v2.ok).toBe(true)
    if (!v2.ok) return

    const editorList = hub.editorList()
    const obsView = editorList.find((s) => s.name === 'obsidian-2')
    expect(obsView?.localOnly).toBe(true)
    expect(obsView?.vaults).toHaveLength(2)
    expect(obsView?.tools).toHaveLength(7)

    // disabledVaults blocks VaultOne for this call only
    const callRes = await hub.call('w1', 'obsidian-2', 'list_notes', {}, 'call-1', {
      disabledVaults: [v1.vaultId],
    })
    expect(callRes.ok).toBe(true)
    if (callRes.ok) {
      expect(callRes.output).toContain('NoteB.md')
      expect(callRes.output).not.toContain('NoteA.md')
    }

    // Agent relay includes obsidian-2 with externalVaults
    const plans = agentRelayPlans(editorList)
    const obsPlan = plans.find((p) => p.server === 'obsidian-2')
    expect(obsPlan?.tools).toHaveLength(7)
    expect(obsPlan?.externalVaults).toEqual(['Personal', 'Work'])

    // Disabling server still exposes registeredVaults() for user picker
    await hub.setEnabled(v1.serverId, false)
    expect(hub.registeredVaults()).toHaveLength(2)

    // Removing all vaults removes the built-in vault server
    await hub.removeVault(v1.vaultId)
    await hub.removeVault(v2.vaultId)
    expect(hub.registeredVaults()).toHaveLength(0)
    expect(store.server(v1.serverId)).toBeNull()
  })

  it('exposes notionPickerStatus and callForUserPicker even when Notion server is disabled', async () => {
    const { hub, store, remoteCalls } = makeHub()
    const notion = await hub.connectPreset({ presetId: 'notion' })
    expect(notion.ok).toBe(true)
    if (!notion.ok) return
    // Simulate OAuth token stored
    await store.update((f) => {
      const s = f.servers.find((x) => x.id === notion.id)
      if (s) s.oauth = { clientId: 'cid', clientSecret: '', tokens: '{"access_token":"tok"}' }
    })
    await hub.setEnabled(notion.id, false)

    expect(hub.notionPickerStatus()).toEqual({ available: true, serverId: notion.id })
    const res = await hub.callForUserPicker(notion.id, 'notion-search', { query: 'test' })
    expect(res.ok).toBe(true)
    expect(remoteCalls).toEqual([{ tool: 'notion-search', input: { query: 'test' } }])
  })
})
