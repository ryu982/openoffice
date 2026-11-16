// The rules of the one-time editor picker on Home (spec §5): when it shows,
// what it marks, and how Home learns that the launch has restored its tabs.
// Pure apart from waitForLaunchSettled, which only polls the bridge it gets.

import {
  editorItemOfTabKind,
  type AppChoicePatch,
  type EditorItemId,
} from '../../../shared/editor-choice'
import type { RecoveryListApi } from '../../../shared/recovery-list-api'
import type { TabSummary } from '../../../shared/tabs-api'

export interface OneTimePickState {
  /** the main process says the picker is due (onboarding seen, picker not yet) */
  due: boolean
  /** the launch has restored its tabs (and the recovery list, if any, was answered) */
  launchSettled: boolean
  /** the home tab is in front: editor views paint above every shell overlay */
  homeActive: boolean
  /** saved or closed in this run */
  done: boolean
}

export function oneTimePickVisible(state: OneTimePickState): boolean {
  return state.due && state.launchSettled && state.homeActive && !state.done
}

/** home is in front when no tab is active or the active one is home (as AppFrame reads it) */
export function homeTabActive(tabs: readonly TabSummary[]): boolean {
  const active = tabs.find((tab) => tab.active)
  return !active || active.kind === 'home'
}

/** the items whose editor has a tab open in the strip */
export function openEditorItems(tabs: readonly Pick<TabSummary, 'kind'>[]): Set<EditorItemId> {
  const items = new Set<EditorItemId>()
  for (const tab of tabs) {
    const item = editorItemOfTabKind(tab.kind)
    if (item) items.add(item)
  }
  return items
}

/** what saving the picker sends: every item and AI as switched */
export function pickPatch(off: readonly EditorItemId[], aiFeatures: boolean): AppChoicePatch {
  return { off: [...off], aiFeatures }
}

/** how often the launch list is asked again while it waits for the user's answer */
export const LAUNCH_LIST_POLL_MS = 500

/**
 * Resolves once the launch has laid out its tabs. The launch recovery list
 * bridge answers only when the launch flow knows what to ask: nothing (null
 * or empty) means the launch is laid out. Rows mean the list is up on Home
 * and the tabs load after its answer, so it is asked again until it answers
 * nothing. No bridge, or a failing one, has nothing to wait for.
 */
export async function waitForLaunchSettled(
  recovery: Pick<RecoveryListApi, 'getLaunchRecoveryList'> | undefined,
  options: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  if (!recovery) return
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  for (;;) {
    let rows: unknown[] | null
    try {
      rows = await recovery.getLaunchRecoveryList()
    } catch {
      return
    }
    if (!rows || rows.length === 0) return
    await sleep(LAUNCH_LIST_POLL_MS)
  }
}
