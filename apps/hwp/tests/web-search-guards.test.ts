/**
 * web_search in the Hangul editor goes through the same two gates as in every other
 * editor: the person's "Let AI use internet tools" switch and the Drive block. The panel
 * composes the hwp skill with `composeWithDrive`; this file composes it the same way, with
 * the window bridges the preload exposes faked, and checks that the call never reaches the
 * preload's webSearch while either gate is shut.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  composeWithDrive,
  DRIVE_OUTBOUND_BLOCKED,
  INTERNET_TOOLS_OFF,
  type AgentMessage,
} from '@genoffice/agent-core'
import type { AgentBridge } from '../src/renderer/ai/agent-bridge'
import { createHwpSkill } from '../src/renderer/ai/hwp-skill'

const read = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf8')

const SEARCH_RESULT = {
  results: [{ title: 'A', url: 'https://a.example/', snippet: 'a' }],
  method: 'tavily',
}

/** Lets the bridges' first answers (internet switch, Drive enabled) settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function compose(options: { internet: boolean; history?: AgentMessage[] }) {
  const webSearch = vi.fn(async () => SEARCH_RESULT)
  const internetToolsEnabled = vi.fn(async () => options.internet)
  vi.stubGlobal('window', { hwpApi: { webSearch } })
  vi.stubGlobal('aiOfficeOutbound', {
    internetToolsEnabled,
    confirmAddresses: vi.fn(async () => false),
  })
  vi.stubGlobal('aiOfficeDriveAi', {
    driveAiEnabled: async () => true,
    driveSearch: async () => ({ ok: true, hits: [] }),
    driveRead: async () => null,
  })
  const history = options.history ?? []
  // web_search never touches the editor: an empty bridge is enough
  const { skill: hwp } = createHwpSkill({
    bridge: {} as AgentBridge,
    label: (key) => key,
    onChange: () => {},
    confirmMemoRemoval: async () => false,
  })
  const skill = composeWithDrive('hwp+files', '', () => history, [hwp])
  const search = () =>
    skill.executeTool({ id: '1', name: 'web_search', input: { query: '출산율' } })
  return { skill, search, webSearch, internetToolsEnabled }
}

afterEach(() => vi.unstubAllGlobals())

describe('web_search behind the internet-tools switch', () => {
  it('leaves the tool list while the switch is off, and is refused if called anyway', async () => {
    const { skill, search, webSearch } = compose({ internet: false })
    await settle()
    expect(skill.tools.map((tool) => tool.name)).not.toContain('web_search')
    const result = await search()
    expect(result.isError).toBe(true)
    expect(result.output).toBe(INTERNET_TOOLS_OFF)
    expect(webSearch).not.toHaveBeenCalled()
  })

  it('is offered and searches while the switch is on', async () => {
    const { skill, search, webSearch, internetToolsEnabled } = compose({ internet: true })
    await settle()
    expect(skill.tools.map((tool) => tool.name)).toContain('web_search')
    const result = await search()
    expect(result.isError).toBeUndefined()
    expect(webSearch).toHaveBeenCalledWith('출산율', 6)
    // asked again right before the call, not only from the cached answer
    expect(internetToolsEnabled.mock.calls.length).toBeGreaterThan(1)
  })
})

describe('web_search in a conversation that read Google Drive', () => {
  it('is refused once a Drive file was read, and searches in a chat without one', async () => {
    const driveRead: AgentMessage = {
      role: 'tool',
      results: [{ id: 'd1', name: 'drive_read', output: '회의록 — characters 0..5 of 5 (end)' }],
    }
    const tainted = compose({
      internet: true,
      history: [{ role: 'user', text: '드라이브의 회의록을 요약해 줘' }, driveRead],
    })
    await settle()
    // the loop builds the context at the start of every run: that is where Drive content is seen
    tainted.skill.buildContext?.()
    const refused = await tainted.search()
    expect(refused.isError).toBe(true)
    expect(refused.output).toBe(DRIVE_OUTBOUND_BLOCKED)
    expect(tainted.webSearch).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const clean = compose({ internet: true, history: [{ role: 'user', text: '찾아 줘' }] })
    await settle()
    clean.skill.buildContext?.()
    expect((await clean.search()).isError).toBeUndefined()
    expect(clean.webSearch).toHaveBeenCalled()
  })
})

describe('web_search wiring', () => {
  it('composes the hwp skill with the guards in the panel', () => {
    const panel = read('src/renderer/ai/AiPanel.tsx')
    expect(panel).toMatch(
      /composeWithDrive\('hwp\+files', '', \(\) => loopRef\.current\?\.messages \?\? \[\], \[\s*skillRef\.current\.skill,/,
    )
  })

  it('reaches the shared ai:web-search handler through the preload', () => {
    expect(read('src/shared/ipc.ts')).toContain("webSearch: 'ai:web-search'")
    expect(read('src/preload/index.ts')).toMatch(
      /webSearch: \(query, maxResults\) =>\s*ipcRenderer\.invoke\(AI_CHANNELS\.webSearch, query, maxResults\)/,
    )
  })
})
