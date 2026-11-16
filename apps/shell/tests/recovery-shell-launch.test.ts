import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaunchOutcome, LaunchPlan, PlannedTab } from '../src/main/launch-recovery'
import type { RecoveryListItem } from '../src/shared/recovery-list-api'

/**
 * runLaunchRecovery's own wiring (recovery-shell.ts): the session record
 * learns the restored untitled tabs' copies, and a launch whose restored
 * session cannot be laid out still settles (Home, the launch gate closed).
 */

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\userData' } }))

const store = vi.hoisted(() => ({
  pruneStaleCopies: vi.fn(),
  applyLaunchDecision: vi.fn(),
  copyInfo: vi.fn(() => null),
  openPlan: vi.fn(() => ({ action: 'open' })),
}))

vi.mock('@genoffice/electron-utils', () => ({
  createRecoveryStore: () => store,
  isUntitledIdentity: (identity: object) => 'untitledId' in identity,
  recoveryEditor: () => null,
}))
vi.mock('../../docs/src/main/docs-main', () => ({
  discardDocsRecovery: vi.fn(),
  docsRecoveryIdentity: () => null,
}))
vi.mock('../../sheets/src/main/sheets-main', () => ({
  createSheetsView: vi.fn(),
  migrateSheetsLegacyRecovery: vi.fn(),
  sheetsRecoveryIdentity: () => null,
}))
vi.mock('../../pdf/src/main/pdf-main', () => ({
  createPdfView: vi.fn(),
  pdfRecoveryIdentity: () => null,
}))
vi.mock('../../slides/src/main/slides-main', () => ({ slidesRecoveryIdentity: () => null }))
vi.mock('../../markdown/src/main/markdown-main', () => ({
  markdownRecoveryIdentity: () => null,
  setMarkdownRecoveryTitleSource: vi.fn(),
}))
vi.mock('../../html/src/main/html-main', () => ({
  htmlRecoveryIdentity: () => null,
  setHtmlRecoveryTitleSource: vi.fn(),
}))
vi.mock('../../mindmap/src/main/mindmap-main', () => ({
  discardMindmapRecovery: vi.fn(),
  mindmapRecoveryIdentity: () => null,
  setMindmapRecoveryTitleHook: vi.fn(),
}))
vi.mock('../../hwp/src/main/hwp-main', () => ({
  hwpDiscardRecoveryCopy: vi.fn(),
  hwpRecoveryIdentity: () => null,
  setHwpRecoveryTitle: vi.fn(),
}))
vi.mock('../../diagram/src/main/diagram-main', () => ({
  discardDiagramRecovery: vi.fn(),
  diagramRecoveryIdentity: () => null,
  setDiagramRecoveryTitleHook: vi.fn(),
}))
vi.mock('../src/main/tab-manager', () => ({ createPlainEditorView: vi.fn() }))
const session = vi.hoisted(() => ({ startRun: vi.fn() }))
vi.mock('../src/main/session-record', () => ({
  initSessionRecord: () => ({ previous: { status: 'missing' }, startRun: session.startRun }),
  judgePreviousExit: () => ({ abnormal: true, crashLoop: false }),
}))
vi.mock('../src/main/launch-recovery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/launch-recovery')>()),
  planLaunch: vi.fn(),
  resolveLaunchDecisions: vi.fn(),
}))

const { planLaunch, resolveLaunchDecisions, createLaunchListGate } =
  await import('../src/main/launch-recovery')
const { runLaunchRecovery, tabUntitledCopy } = await import('../src/main/recovery-shell')

const untitledTab: PlannedTab = {
  key: 'k1',
  kind: 'docs',
  title: 'Untitled 1',
  open: { type: 'untitledCopy', copy: { kind: 'docs', untitledId: 'u1', ext: '.docx' } },
}

const listItem: RecoveryListItem = {
  id: 'r1',
  editorKind: 'docs',
  name: 'Untitled 1',
  folder: null,
  lastCopyTime: 1,
  untitled: true,
  fileChangedAfterCopy: false,
} as RecoveryListItem

function plan(items: RecoveryListItem[]): LaunchPlan {
  return {
    restoreRun: true,
    crashLoop: false,
    plainLaunch: false,
    tabs: [untitledTab],
    items,
    copies: new Map(),
    launchPaths: [],
  }
}

const outcome: LaunchOutcome = {
  storeDecisions: [],
  remove: [],
  replace: [],
  append: [],
  front: 'k1',
  launchPaths: [],
  splitMemoryOrHome: false,
}

function fakeManager(onChanged: () => void) {
  const tabs: Array<{ id: string; kind: string; filePath?: string }> = []
  let next = 1
  return {
    tabs,
    hydrateSession: vi.fn((session: { tabs: Array<{ kind: string; filePath?: string }> }) => {
      const ids = session.tabs.map((spec) => {
        const id = `t${next++}`
        tabs.push({ id, kind: spec.kind, filePath: spec.filePath })
        return id
      })
      onChanged()
      return ids
    }),
    list: () => tabs,
    addUnloadedTab: vi.fn(() => `t${next++}`),
    closeTabWithoutPrompt: vi.fn(),
    reorderTab: vi.fn(),
    beginSplit: vi.fn(),
    splitState: () => null,
    activateTab: vi.fn(),
    openHomeTab: vi.fn(),
  }
}

describe('runLaunchRecovery', () => {
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
    vi.mocked(planLaunch).mockReset()
    vi.mocked(resolveLaunchDecisions).mockReset()
  })

  it('tells the session record again once the restored untitled tabs know their copies', () => {
    vi.mocked(planLaunch).mockReturnValue(plan([listItem]))
    const seen: Array<ReturnType<typeof tabUntitledCopy>> = []
    const snapshot = (): void => {
      seen.push(tabUntitledCopy({ id: 't1' }, 'docs', undefined))
    }
    const manager = fakeManager(snapshot)
    runLaunchRecovery({
      userDataDir: 'C:\\userData',
      gate: createLaunchListGate(),
      manager: () => manager as never,
      launchPaths: [],
      openLaunchPaths: vi.fn(),
      restoreSplitMemoryOrHome: vi.fn(),
      afterSheetsOpen: vi.fn(),
      settled: vi.fn(),
      sessionChanged: snapshot,
    })
    expect(seen.at(-1)).toEqual({ untitledId: 'u1', ext: '.docx' })
  })

  it('falls back to Home and settles when the answered session cannot be laid out', async () => {
    vi.mocked(planLaunch).mockReturnValue(plan([listItem]))
    vi.mocked(resolveLaunchDecisions).mockReturnValue({
      ...outcome,
      storeDecisions: [
        { identity: { kind: 'docs', untitledId: 'u1', ext: '.docx' }, decision: 'restore' },
      ] as LaunchOutcome['storeDecisions'],
    })
    const manager = fakeManager(() => {})
    manager.activateTab.mockImplementation(() => {
      throw new Error('boom')
    })
    const gate = createLaunchListGate()
    const settled = vi.fn()
    runLaunchRecovery({
      userDataDir: 'C:\\userData',
      gate,
      manager: () => manager as never,
      launchPaths: [],
      openLaunchPaths: vi.fn(),
      restoreSplitMemoryOrHome: vi.fn(),
      afterSheetsOpen: vi.fn(),
      settled,
      sessionChanged: vi.fn(),
    })
    manager.openHomeTab.mockClear()
    await expect(gate.submit({ decisions: { r1: 'restore' } })).resolves.toBeUndefined()
    // the decision already made stays made; the list does not come back
    expect(store.applyLaunchDecision).toHaveBeenCalledTimes(1)
    expect(manager.openHomeTab).toHaveBeenCalled()
    expect(settled).toHaveBeenCalledTimes(1)
    expect(gate.blocking()).toBe(false)
    await expect(gate.get()).resolves.toBeNull()
  })

  it('settles a launch with nothing to ask even when laying out the tabs throws', () => {
    vi.mocked(planLaunch).mockReturnValue(plan([]))
    vi.mocked(resolveLaunchDecisions).mockReturnValue(outcome)
    const manager = fakeManager(() => {})
    manager.activateTab.mockImplementation(() => {
      throw new Error('boom')
    })
    const settled = vi.fn()
    expect(() =>
      runLaunchRecovery({
        userDataDir: 'C:\\userData',
        gate: createLaunchListGate(),
        manager: () => manager as never,
        launchPaths: [],
        openLaunchPaths: vi.fn(),
        restoreSplitMemoryOrHome: vi.fn(),
        afterSheetsOpen: vi.fn(),
        settled,
        sessionChanged: vi.fn(),
      }),
    ).not.toThrow()
    expect(manager.openHomeTab).toHaveBeenCalled()
    expect(settled).toHaveBeenCalledTimes(1)
  })
})

describe('runLaunchRecovery with editors turned off (editor choice spec 7.5)', () => {
  const fileTab = (key: string, kind: PlannedTab['kind']): PlannedTab => ({
    key,
    kind,
    title: `${key}.${kind}`,
    filePath: `C:/${key}.${kind}`,
    open: { type: 'file' },
  })
  const twoTabs = (): LaunchPlan => ({
    restoreRun: true,
    crashLoop: false,
    plainLaunch: false,
    tabs: [fileTab('s0', 'docs'), fileTab('s1', 'slides')],
    front: 's1',
    items: [],
    copies: new Map(),
    launchPaths: [],
  })
  const deps = (manager: ReturnType<typeof fakeManager>, extra: object) => ({
    userDataDir: 'C:/userData',
    gate: createLaunchListGate(),
    manager: () => manager as never,
    launchPaths: [],
    openLaunchPaths: vi.fn(),
    restoreSplitMemoryOrHome: vi.fn(),
    afterSheetsOpen: vi.fn(),
    settled: vi.fn(),
    sessionChanged: vi.fn(),
    ...extra,
  })

  beforeEach(() => {
    session.startRun.mockClear()
    vi.mocked(resolveLaunchDecisions).mockImplementation((p: LaunchPlan): LaunchOutcome => ({
      storeDecisions: [],
      remove: [],
      replace: [],
      append: [],
      ...(p.front ? { front: p.front } : {}),
      launchPaths: [],
      splitMemoryOrHome: false,
    }))
  })
  afterEach(() => {
    vi.mocked(planLaunch).mockReset()
    vi.mocked(resolveLaunchDecisions).mockReset()
  })

  it('asks before placing any tab and leaves a declined one out of the strip and the record', async () => {
    vi.mocked(planLaunch).mockReturnValue(twoTabs())
    const manager = fakeManager(() => {})
    let answer: (refused: ReadonlySet<string>) => void = () => {}
    const askRestore = vi.fn(
      (_tabs: readonly PlannedTab[]) =>
        new Promise<ReadonlySet<string>>((resolve) => {
          answer = resolve
        }),
    )
    const d = deps(manager, { askRestore })
    runLaunchRecovery(d)
    expect(askRestore.mock.calls[0][0].map((t) => t.key)).toEqual(['s0', 's1'])
    expect(askRestore.mock.calls[0][1]).toEqual({ fromList: false })
    // nothing is placed while the question is up, and the launch list waits
    expect(manager.hydrateSession).not.toHaveBeenCalled()
    expect(d.gate.blocking()).toBe(true)
    answer(new Set(['s1']))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(manager.tabs.map((t) => t.kind)).toEqual(['docs'])
    expect(session.startRun).toHaveBeenCalledWith({ restoreRun: true, dropTabs: new Set([1]) })
    // the declined front tab is gone: Home comes forward instead
    expect(manager.openHomeTab).toHaveBeenCalled()
    expect(d.settled).toHaveBeenCalledTimes(1)
  })

  it('places everything at once when the answer is there at once', () => {
    vi.mocked(planLaunch).mockReturnValue(twoTabs())
    const manager = fakeManager(() => {})
    runLaunchRecovery(deps(manager, { askRestore: () => new Set<string>() }))
    expect(manager.tabs.map((t) => t.kind)).toEqual(['docs', 'slides'])
    expect(manager.activateTab).toHaveBeenCalled()
  })

  it('restores everything when the question cannot be asked (nothing is lost)', async () => {
    vi.mocked(planLaunch).mockReturnValue(twoTabs())
    const manager = fakeManager(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    runLaunchRecovery(deps(manager, { askRestore: () => Promise.reject(new Error('no dialog')) }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(manager.tabs.map((t) => t.kind)).toEqual(['docs', 'slides'])
    warn.mockRestore()
  })
})
