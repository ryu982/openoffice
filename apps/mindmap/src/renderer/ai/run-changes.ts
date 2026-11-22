/**
 * The runs that changed the map, as their cards under the chat show them
 * (`AiChangesCard`). Each run keeps its undo point (`MapTurn`) while the card
 * can still take it back; reverting a run takes every later applied run back
 * with it, newest first, and only the newest `KEPT_RUNS` points are kept.
 */
import type { AiChangeLine, AiChangesState } from '@genoffice/ui'

/** How many runs keep their undo point: an older one's card says it expired. */
export const KEPT_RUNS = 20

export interface MindmapChangeLine extends AiChangeLine {
  readonly sheetKey?: string
  readonly topicId?: string
}

export interface RunChange<P> {
  /** grows with every run, so a later run has a larger id */
  readonly id: number
  /** the undo point; null once the run was taken back or its point expired */
  readonly point: P | null
  readonly state: AiChangesState
  /** how many places the run changed (0: not known) */
  readonly count: number
  /** detailed per-topic lines shown inside AiChangesCard */
  readonly lines?: readonly MindmapChangeLine[]
}

/** The list with a new run; runs past the kept ones lose their point. */
export function addRun<P>(runs: readonly RunChange<P>[], run: RunChange<P>): RunChange<P>[] {
  const next = [...runs, run]
  let kept = 0
  for (let at = next.length - 1; at >= 0; at--) {
    const each = next[at]!
    if (each.state !== 'applied' || each.point === null) continue
    if (++kept > KEPT_RUNS) next[at] = { ...each, point: null, state: 'expired' }
  }
  return next
}

/** The runs reverting `id` takes back: it and every later applied one, newest first. */
export function revertChain<P>(
  runs: readonly RunChange<P>[],
  id: number,
): Array<RunChange<P> & { point: P }> {
  return runs
    .filter(
      (run): run is RunChange<P> & { point: P } =>
        run.id >= id && run.state === 'applied' && run.point !== null,
    )
    .reverse()
}

/** True when reverting `id` would take later runs back too. */
export function revertsLater<P>(runs: readonly RunChange<P>[], id: number): boolean {
  return runs.some((run) => run.id > id && run.state === 'applied' && run.point !== null)
}

/** The runs after a revert: each one tried takes its outcome and gives up its point. */
export function settleRuns<P>(
  runs: readonly RunChange<P>[],
  outcomes: ReadonlyMap<number, AiChangesState>,
): RunChange<P>[] {
  return runs.map((run) => {
    const state = outcomes.get(run.id)
    if (state === undefined) return run
    return { ...run, state, point: state === 'applied' ? run.point : null }
  })
}
