import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ADDRESS_DECLINED,
  DRIVE_OUTBOUND_BLOCKED,
  INTERNET_TOOLS_OFF,
  addressInConversation,
  composeWithDrive,
  createBridgedDriveSkill,
  createDriveWindowState,
  createMcpWindowState,
  createUserMcpSkill,
  guardOutbound,
  isOutboundCall,
  keepInsideRefusalText,
  mcpServersOf,
  windowDriveState,
  windowMcpState,
  type AgentMessage,
  type AgentSkill,
  type AgentToolCall,
  type DriveBridgeLike,
  type McpServerView,
  type McpToolsBridgeLike,
  type OutboundBridgeLike,
} from '../src'

const call = (name: string, input: Record<string, unknown> = {}): AgentToolCall => ({
  id: name,
  name,
  input,
})

const flush = () => new Promise((r) => setTimeout(r, 0))

const OBSIDIAN_SERVER: McpServerView = {
  name: 'obsidian',
  status: 'connected',
  newToolCount: 0,
  keepResultsInside: true,
  localOnly: true,
  vaults: [
    { id: 'v1', name: 'Personal', enabled: true },
    { id: 'v2', name: 'Work', enabled: true },
    { id: 'v3', name: 'Archive', enabled: false },
  ],
  instructions: 'Active Obsidian vaults: Personal, Work',
  tools: [
    {
      name: 'list_notes',
      exposedName: 'mcp__obsidian__list_notes',
      description: 'List notes',
      inputSchema: { type: 'object', properties: {} },
      permission: 'always',
      pending: false,
    },
    {
      name: 'read_note',
      exposedName: 'mcp__obsidian__read_note',
      description: 'Read a note',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      permission: 'always',
      pending: false,
    },
    {
      name: 'create_note',
      exposedName: 'mcp__obsidian__create_note',
      description: 'Create a note',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      permission: 'always',
      pending: false,
    },
  ],
}

const NOTION_SERVER: McpServerView = {
  name: 'notion',
  status: 'connected',
  newToolCount: 0,
  keepResultsInside: true,
  presetId: 'notion',
  instructions: 'Notion workspace',
  tools: [
    {
      name: 'search',
      exposedName: 'mcp__notion__search',
      description: 'Search Notion',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      permission: 'always',
      pending: false,
    },
  ],
}

const LAW_SERVER: McpServerView = {
  name: 'korean-law',
  status: 'connected',
  newToolCount: 0,
  keepResultsInside: false,
  presetId: 'korean-law',
  instructions: null,
  tools: [
    {
      name: 'search_law',
      exposedName: 'mcp__korean-law__search_law',
      description: 'Search Korean laws',
      inputSchema: { type: 'object', properties: {} },
      permission: 'always',
      pending: false,
    },
  ],
}

function makeMcpBridge(servers: McpServerView[]) {
  const listeners = new Set<() => void>()
  let list = servers
  const bridge: McpToolsBridgeLike = {
    list: vi.fn(async () => list),
    call: vi.fn(async (server, tool) => ({
      ok: true,
      output:
        server === 'obsidian' && tool === 'read_note'
          ? 'See https://vault-only.example/secret'
          : `ok:${server}:${tool}`,
      isError: false,
    })),
    cancel: vi.fn(),
    onChanged: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    retry: vi.fn(async () => ({ ok: true })),
    openSettings: vi.fn(async () => ({ ok: true })),
    openIntegrations: vi.fn(async () => ({ ok: true })),
  }
  return {
    bridge,
    setServers(next: McpServerView[]) {
      list = next
      for (const fn of listeners) fn()
    },
  }
}

function makeOutboundBridge(initialOn: boolean, confirmAnswer = false) {
  let on = initialOn
  const listeners = new Set<(on: boolean) => void>()
  const bridge: OutboundBridgeLike = {
    internetToolsEnabled: vi.fn(async () => on),
    onInternetToolsChanged: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    confirmAddresses: vi.fn(async () => confirmAnswer),
  }
  return {
    bridge,
    setOn(v: boolean) {
      on = v
      for (const fn of listeners) fn(v)
    },
  }
}

function makeDriveBridge(initialEnabled = true) {
  let enabled = initialEnabled
  const listeners = new Set<(on: boolean) => void>()
  const bridge: DriveBridgeLike = {
    driveAiEnabled: vi.fn(async () => enabled),
    driveSearch: vi.fn(async () => ({
      ok: true,
      hits: [{ id: 'd1', name: 'Report', type: 'document', modified: '2026-11-01T00:00:00Z' }],
    })),
    driveRead: vi.fn(async () => ({
      ok: true,
      page: { name: 'Report', text: 'Drive confidential', totalChars: 18, offset: 0 },
    })),
    onDriveAiChanged: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  return {
    bridge,
    setEnabled(v: boolean) {
      enabled = v
      for (const fn of listeners) fn(v)
    },
  }
}

afterEach(() => {
  delete (globalThis as { aiOfficeMcpTools?: unknown }).aiOfficeMcpTools
  delete (globalThis as { aiOfficeOutbound?: unknown }).aiOfficeOutbound
  delete (globalThis as { aiOfficeDriveAi?: unknown }).aiOfficeDriveAi
})

describe('mcpServersOf extended connector fields', () => {
  it('copies localOnly, presetId, and sanitized vaults without leaking path', () => {
    const parsed = mcpServersOf([
      {
        ...OBSIDIAN_SERVER,
        vaults: [
          { id: 'v1', name: 'Personal', enabled: true, path: 'C:\\secret\\path' },
          { id: 'v1', name: 'Duplicate', enabled: false },
          { id: '', name: 'EmptyId', enabled: true },
          { id: 'v2', name: 'Work', enabled: false },
        ],
      },
      { ...NOTION_SERVER, localOnly: 'yes' },
    ])
    expect(parsed).toHaveLength(2)
    expect(parsed[0]?.localOnly).toBe(true)
    expect(parsed[0]?.vaults).toEqual([
      { id: 'v1', name: 'Personal', enabled: true },
      { id: 'v2', name: 'Work', enabled: false },
    ])
    expect('path' in (parsed[0]?.vaults?.[0] ?? {})).toBe(false)
    expect(parsed[1]?.localOnly).toBeUndefined()
    expect(parsed[1]?.presetId).toBe('notion')
  })
})

describe('localOnly MCP tools and per-vault toggles', () => {
  it('keeps localOnly Obsidian tools usable when internet tools are off, while dropping remote MCP tools', async () => {
    const { bridge } = makeMcpBridge([OBSIDIAN_SERVER, NOTION_SERVER])
    const { bridge: outbound } = makeOutboundBridge(false)
    const state = createMcpWindowState(bridge, outbound)
    await flush()

    expect([...state.usableServers()]).toEqual(['obsidian'])
    expect(state.isLocalOnly('obsidian')).toBe(true)
    expect(state.isLocalOnly('notion')).toBe(false)

    const skill = createUserMcpSkill(state, () => [])
    expect(skill.systemPrompt).toContain('obsidian')
    expect(skill.systemPrompt).not.toContain('notion')

    const guarded = guardOutbound(skill, outbound, () => [], {
      isLocalOnlyTool: (name) => name.startsWith('mcp__obsidian__'),
    })
    await flush()
    expect(guarded.tools.map((t) => t.name)).toEqual([
      'mcp__obsidian__list_notes',
      'mcp__obsidian__read_note',
      'mcp__obsidian__create_note',
    ])
    const res = await guarded.executeTool(call('mcp__obsidian__list_notes'))
    expect(res.isError).toBeFalsy()
    const blocked = await guarded.executeTool(call('mcp__notion__search'))
    expect(blocked).toMatchObject({ isError: true, output: INTERNET_TOOLS_OFF })
    state.dispose()
  })

  it('passes disabledVaults when some vaults are turned off in chat, hides tools when all enabled vaults are off, and resets on newConversation', async () => {
    const { bridge } = makeMcpBridge([OBSIDIAN_SERVER])
    const state = createMcpWindowState(bridge, null)
    await flush()

    const skill = createUserMcpSkill(state, () => [])
    // Turning off v1 leaves v2 active
    state.setVaultOffInChat('v1', true)
    expect([...state.vaultsOffInChat()]).toEqual(['v1'])
    expect([...state.usableServers()]).toEqual(['obsidian'])
    expect(skill.tools).toHaveLength(3)

    await skill.executeTool(call('mcp__obsidian__list_notes', {}))
    expect(bridge.call).toHaveBeenCalledWith('obsidian', 'list_notes', {}, expect.any(String), {
      disabledVaults: ['v1'],
    })

    // Turning off v2 too leaves 0 active vaults (v3 is disabled in settings)
    state.setVaultOffInChat('v2', true)
    expect([...state.usableServers()]).toEqual([])
    expect(skill.tools).toEqual([])
    const refused = await skill.executeTool(call('mcp__obsidian__list_notes', {}))
    expect(refused.isError).toBe(true)

    // Reset restores both vaults
    state.newConversation()
    expect(state.vaultsOffInChat().size).toBe(0)
    expect([...state.usableServers()]).toEqual(['obsidian'])
    expect(skill.tools).toHaveLength(3)
    state.dispose()
  })
})

describe('cross-boundary security matrix (localOnly vs Drive vs keepResultsInside vs unvouched URLs)', () => {
  it('allows Obsidian after Drive read and after Notion read, while blocking outbound tools after Obsidian read', async () => {
    const { bridge: mcpBridge } = makeMcpBridge([OBSIDIAN_SERVER, NOTION_SERVER, LAW_SERVER])
    const { bridge: outbound } = makeOutboundBridge(true, false)
    const { bridge: driveBridge } = makeDriveBridge(true)

    ;(globalThis as { aiOfficeMcpTools?: unknown }).aiOfficeMcpTools = mcpBridge
    ;(globalThis as { aiOfficeOutbound?: unknown }).aiOfficeOutbound = outbound
    ;(globalThis as { aiOfficeDriveAi?: unknown }).aiOfficeDriveAi = driveBridge

    let history: AgentMessage[] = []
    const webSkill: AgentSkill = {
      id: 'web',
      systemPrompt: '',
      tools: [
        { name: 'web_search', description: '', inputSchema: { type: 'object' } },
        { name: 'read_url', description: '', inputSchema: { type: 'object' } },
        { name: 'edit_doc', description: '', inputSchema: { type: 'object' } },
      ],
      executeTool: (c) => ({ output: `ran:${c.name}`, summary: c.name }),
    }
    const composed = composeWithDrive('test', '', () => history, [webSkill])
    await flush()
    await flush()

    // 1. Read Drive -> outbound tools (web_search, notion, korean-law) are blocked, Obsidian is ALLOWED
    const driveRes = await composed.executeTool(call('drive_read', { file_id: 'd1' }))
    expect(driveRes.isError).toBeFalsy()
    expect((await composed.executeTool(call('web_search'))).output).toBe(DRIVE_OUTBOUND_BLOCKED)
    expect((await composed.executeTool(call('mcp__notion__search'))).output).toBe(
      DRIVE_OUTBOUND_BLOCKED,
    )
    expect((await composed.executeTool(call('mcp__korean-law__search_law'))).output).toBe(
      DRIVE_OUTBOUND_BLOCKED,
    )
    const obsAfterDrive = await composed.executeTool(
      call('mcp__obsidian__create_note', { path: 'a.md' }),
    )
    expect(obsAfterDrive.isError).toBeFalsy()

    // 2. Start a new chat -> Notion read -> Obsidian is ALLOWED, web/law are BLOCKED
    history = []
    windowMcpState()?.newConversation()
    composed.buildContext?.()
    const notionRes = await composed.executeTool(call('mcp__notion__search', { query: 'roadmap' }))
    expect(notionRes.isError).toBeFalsy()
    expect((await composed.executeTool(call('web_search'))).output).toBe(
      keepInsideRefusalText(['notion']),
    )
    expect((await composed.executeTool(call('mcp__korean-law__search_law'))).output).toBe(
      keepInsideRefusalText(['notion']),
    )
    const obsAfterNotion = await composed.executeTool(
      call('mcp__obsidian__create_note', { path: 'b.md' }),
    )
    expect(obsAfterNotion.isError).toBeFalsy()

    // 3. Start a new chat -> Obsidian (keepResultsInside: true) read -> outbound tools (web, notion, korean-law) are BLOCKED; Obsidian & edit_doc stay ALLOWED
    history = []
    windowMcpState()?.newConversation()
    composed.buildContext?.()
    const obsRead = await composed.executeTool(
      call('mcp__obsidian__read_note', { path: 'secret.md' }),
    )
    expect(obsRead.isError).toBeFalsy()
    expect((await composed.executeTool(call('web_search'))).output).toBe(
      keepInsideRefusalText(['obsidian']),
    )
    expect((await composed.executeTool(call('mcp__notion__search'))).output).toBe(
      keepInsideRefusalText(['obsidian']),
    )
    expect((await composed.executeTool(call('mcp__korean-law__search_law'))).output).toBe(
      keepInsideRefusalText(['obsidian']),
    )
    expect((await composed.executeTool(call('mcp__obsidian__list_notes'))).isError).toBeFalsy()
    expect((await composed.executeTool(call('edit_doc'))).isError).toBeFalsy()
  })

  it('does not vouch for URLs returned only in localOnly Obsidian tool results', async () => {
    const obsidianNoKeep: McpServerView = { ...OBSIDIAN_SERVER, keepResultsInside: false }
    const { bridge: mcpBridge } = makeMcpBridge([obsidianNoKeep])
    const { bridge: outbound } = makeOutboundBridge(true, false)
    ;(globalThis as { aiOfficeMcpTools?: unknown }).aiOfficeMcpTools = mcpBridge
    ;(globalThis as { aiOfficeOutbound?: unknown }).aiOfficeOutbound = outbound

    const history: AgentMessage[] = [
      { role: 'user', text: 'check my note' },
      {
        role: 'tool',
        results: [
          {
            id: '1',
            name: 'mcp__obsidian__read_note',
            output: 'See https://vault-only.example/secret',
          },
        ],
      },
    ]
    const webSkill: AgentSkill = {
      id: 'web',
      systemPrompt: '',
      tools: [{ name: 'read_url', description: '', inputSchema: { type: 'object' } }],
      executeTool: (c) => ({ output: `fetched:${c.input.url}`, summary: c.name }),
    }
    const composed = composeWithDrive('test', '', () => history, [webSkill])
    await flush()

    expect(
      addressInConversation('https://vault-only.example/secret', history, {
        isUnvouchedTool: (name) => name.startsWith('mcp__obsidian__'),
      }),
    ).toBe(false)

    const res = await composed.executeTool(
      call('read_url', { url: 'https://vault-only.example/secret' }),
    )
    expect(outbound.confirmAddresses).toHaveBeenCalledWith('read_url', [
      'https://vault-only.example/secret',
    ])
    expect(res).toMatchObject({ isError: true, output: ADDRESS_DECLINED })
  })

  it('isOutboundCall treats localOnly MCP tools as local unless input fetches a web address', () => {
    const isLocal = (name: string) => name.startsWith('mcp__obsidian__')
    expect(isOutboundCall(call('mcp__obsidian__read_note', { path: 'a.md' }), isLocal)).toBe(false)
    expect(
      isOutboundCall(call('mcp__obsidian__read_note', { url: 'https://evil.example/a' }), isLocal),
    ).toBe(true)
    expect(isOutboundCall(call('mcp__notion__search', { query: 'x' }), isLocal)).toBe(true)
  })
})

describe('windowDriveState per-chat Drive toggle', () => {
  it('hides Drive tools and prompt while off in chat, refuses calls, and resets on empty history or windowMcpState.newConversation()', async () => {
    const { bridge: driveBridge } = makeDriveBridge(true)
    const { bridge: mcpBridge } = makeMcpBridge([NOTION_SERVER])
    ;(globalThis as { aiOfficeDriveAi?: unknown }).aiOfficeDriveAi = driveBridge
    ;(globalThis as { aiOfficeMcpTools?: unknown }).aiOfficeMcpTools = mcpBridge

    let history: AgentMessage[] = [{ role: 'user', text: 'hi' }]
    const driveState = windowDriveState()
    const mcpState = windowMcpState()
    expect(driveState).not.toBeNull()
    const skill = createBridgedDriveSkill(driveBridge, () => history)
    await flush()

    expect(driveState!.enabled()).toBe(true)
    expect(driveState!.offInChat()).toBe(false)
    expect(skill.tools.map((t) => t.name)).toEqual(['drive_search', 'drive_read'])
    expect(skill.systemPrompt).toContain('Google Drive')

    // Turn off for this chat only
    driveState!.setOffInChat(true)
    expect(driveState!.offInChat()).toBe(true)
    expect(skill.tools).toEqual([])
    expect(skill.systemPrompt).toBe('')
    const refused = await skill.executeTool(call('drive_search', { query: 'q' }))
    expect(refused.isError).toBe(true)

    // mcpState.newConversation() resets driveState.offInChat too
    mcpState!.newConversation()
    expect(driveState!.offInChat()).toBe(false)
    expect(skill.tools.map((t) => t.name)).toEqual(['drive_search', 'drive_read'])

    // Empty history on buildContext also resets offInChat
    driveState!.setOffInChat(true)
    expect(driveState!.offInChat()).toBe(true)
    history = []
    skill.buildContext?.()
    expect(driveState!.offInChat()).toBe(false)
    expect(skill.tools.map((t) => t.name)).toEqual(['drive_search', 'drive_read'])
  })

  it('createDriveWindowState notifies subscribers on bridge and per-chat changes', async () => {
    const { bridge, setEnabled } = makeDriveBridge(false)
    const state = createDriveWindowState(bridge)
    const listener = vi.fn()
    const unsub = state.subscribe(listener)
    await flush()
    expect(state.enabled()).toBe(false)
    setEnabled(true)
    expect(state.enabled()).toBe(true)
    state.setOffInChat(true)
    expect(state.offInChat()).toBe(true)
    state.newConversation()
    expect(state.offInChat()).toBe(false)
    expect(listener).toHaveBeenCalled()
    unsub()
    state.dispose()
  })
})
