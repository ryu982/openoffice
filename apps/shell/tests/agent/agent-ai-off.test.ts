/**
 * Editor choice spec 6.2 / 8.3: one run of the agent window is one running AI
 * job (counted, and stopped by "stop all" with its program), and while AI
 * features are off the main process starts none. The programs are fakes.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession, AgentSessionEvent } from '@genoffice/ai-provider/agent-session'
import { normalizeAiSettings, type AiSubscriptionStatus } from '@genoffice/ai-provider'
import { runningAiJobCount, stopAllAiJobs } from '@genoffice/electron-utils/ai-activity'
import { setAppChoiceSource } from '@genoffice/electron-utils/app-choice'
import { createAgentManager, type AgentManager } from '../../src/main/agent/agent-sessions'
import { AGENT_WARNING_VERSION, DEFAULT_AGENT_PREFS } from '../../src/shared/agent-api'

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0' },
  BrowserWindow: class {},
  dialog: {},
  ipcMain: { handle: vi.fn() },
  shell: {},
}))
const { startAgentForWindow } = await import('../../src/main/agent/agent-window')

const roots: string[] = []
const managers: AgentManager[] = []
afterEach(() => {
  setAppChoiceSource(null)
  for (const m of managers.splice(0)) m.stopAll()
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const ready = (provider: 'claude-code' | 'codex'): AiSubscriptionStatus =>
  ({ provider, state: 'ready', meteredAccepted: false }) as AiSubscriptionStatus

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'agent-ai-off-'))
  roots.push(home)
  const project = join(home, 'Project')
  mkdirSync(project)
  const userData = join(home, 'AppData', 'IeumOffice')
  mkdirSync(userData, { recursive: true })
  const stops: Array<ReturnType<typeof vi.fn>> = []
  let onEvent: ((event: AgentSessionEvent) => void) | undefined
  const codex = vi.fn(async (_options: unknown, listener: (event: AgentSessionEvent) => void) => {
    onEvent = listener
    const stop = vi.fn()
    stops.push(stop)
    const session: AgentSession = {
      provider: 'codex',
      send: async () => undefined,
      answer: () => undefined,
      setOpenDocuments: () => undefined,
      stop,
    }
    return session
  })
  const manager = createAgentManager({
    runners: { claude: codex as never, codex },
    statuses: () => ({ 'claude-code': ready('claude-code'), codex: ready('codex') }),
    aiSettings: () => normalizeAiSettings({ providers: {} }),
    openDocuments: () => [],
    userData,
    homeDir: home,
    language: () => 'en',
    emit: () => undefined,
  })
  managers.push(manager)
  const window = {
    userData,
    readPrefs: () => ({ ...DEFAULT_AGENT_PREFS, warningAccepted: AGENT_WARNING_VERSION }),
    writePrefs: vi.fn(),
    readProjectPrefs: () => ({}),
  }
  const start = () =>
    startAgentForWindow(window, manager, 1, {
      provider: 'codex',
      mode: 'ask-commands',
      folder: project,
    })
  return { start, manager, codex, stops, ended: () => onEvent?.({ type: 'ended' } as never) }
}

function aiOff(): void {
  setAppChoiceSource(() => ({ off: [], aiFeatures: false, locked: false }))
}

describe('the agent window while AI features are off', () => {
  it('starts no program', async () => {
    aiOff()
    const { start, codex } = setup()
    const response = await start()
    expect(response.ok).toBe(false)
    expect(codex).not.toHaveBeenCalled()
    expect(runningAiJobCount()).toBe(0)
  })
})

describe('an agent run as a running AI job', () => {
  it('counts from its start until it is stopped', async () => {
    const { start, manager, stops } = setup()
    const response = await start()
    if (!response.ok) throw new Error(`the start failed: ${JSON.stringify(response.failure)}`)
    expect(runningAiJobCount()).toBe(1)
    manager.stop(1, response.sessionId)
    expect(stops[0]).toHaveBeenCalledTimes(1)
    expect(runningAiJobCount()).toBe(0)
  })

  it('ends with its program when every AI job is stopped', async () => {
    const { start, stops } = setup()
    const response = await start()
    expect(response.ok).toBe(true)
    await expect(stopAllAiJobs()).resolves.toBe(1)
    expect(stops[0]).toHaveBeenCalledTimes(1)
    expect(runningAiJobCount()).toBe(0)
  })

  it('leaves the count when the program ends by itself', async () => {
    const { start, ended } = setup()
    await start()
    expect(runningAiJobCount()).toBe(1)
    ended()
    expect(runningAiJobCount()).toBe(0)
  })

  it('leaves the count when its window closes', async () => {
    const { start, manager } = setup()
    await start()
    manager.stopOwner(1)
    expect(runningAiJobCount()).toBe(0)
  })
})
