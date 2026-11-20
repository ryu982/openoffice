/**
 * The changes card of an AI run (AiChangesCard of @genoffice/ui): how the
 * run's applies can be taken back, and where its card stands.
 *
 * A file-backed workbook takes a run back through Univer's own undo stack, so
 * the card records which stack entries the run pushed: the entry under them
 * (`base`) and the newest of them (`top`). The card may undo them only while
 * `top` is still the newest entry (nothing was done since); after a user edit
 * it refuses, and once the entries are gone (pushed out of Univer's 20-entry
 * stack, dropped by the AI undo budget, replaced by a save's session swap)
 * the card has expired. The in-memory blank workbook keeps AI applies in the
 * adapter's history instead, checked by its revision.
 */
import type { AiChangesState } from '@genoffice/ui'

/** Univer keeps this many undo entries per workbook (STACK_CAPACITY of @univerjs/core) */
export const UNIVER_UNDO_CAPACITY = 20

export type AiRunUndoGuard =
  | {
      readonly kind: 'univer'
      /** the stack entry under the run's entries (null: the stack was empty) */
      readonly base: unknown
      /** the newest entry the run pushed */
      readonly top: unknown
      readonly steps: number
      /** every entry the run pushed is still on the stack */
      readonly complete: boolean
    }
  | {
      readonly kind: 'adapter'
      /** the adapter revision right after the run's last apply */
      readonly revision: number
      readonly steps: number
    }

export type UniverUndoGuard = Extract<AiRunUndoGuard, { kind: 'univer' }>
export type AdapterUndoGuard = Extract<AiRunUndoGuard, { kind: 'adapter' }>

/** what an applied run shows in its message */
export interface AiRunReceipt {
  /** places changed: cells, ranges, renames and structural edits as planned */
  readonly opCount: number
  readonly undoSteps: number
  readonly guard?: AiRunUndoGuard | undefined
  /** absent while the changes stand and can be taken back */
  readonly state?: AiChangesState | undefined
  /** the cells of this run carry marks on the grid */
  readonly marked?: boolean | undefined
}

/**
 * The entries one apply pushed onto Univer's stack, from the stack before
 * and after it. Entries above the old newest entry are the apply's; when that
 * entry is gone, the apply pushed the stack full and the oldest of its own
 * entries may have fallen out, so it cannot be taken back whole.
 */
export function univerApplyGuard(
  before: readonly unknown[],
  after: readonly unknown[],
  capacity = UNIVER_UNDO_CAPACITY,
): UniverUndoGuard {
  const top = after.length > 0 ? after[after.length - 1] : null
  if (before.length === 0) {
    return {
      kind: 'univer',
      base: null,
      top,
      steps: after.length,
      complete: after.length < capacity,
    }
  }
  const base = before[before.length - 1]
  const at = after.lastIndexOf(base)
  if (at < 0) return { kind: 'univer', base, top, steps: after.length, complete: false }
  return { kind: 'univer', base, top, steps: after.length - 1 - at, complete: true }
}

/** One run can apply several plans: their entries add up when they sit one on another. */
export function joinUndoGuards(
  previous: AiRunUndoGuard | undefined,
  next: AiRunUndoGuard,
): AiRunUndoGuard {
  if (!previous) return next
  if (previous.kind === 'adapter' && next.kind === 'adapter') {
    return { kind: 'adapter', revision: next.revision, steps: previous.steps + next.steps }
  }
  if (previous.kind === 'univer' && next.kind === 'univer') {
    return {
      kind: 'univer',
      base: previous.base,
      top: next.top,
      steps: previous.steps + next.steps,
      complete: previous.complete && next.complete && next.base === previous.top,
    }
  }
  // the workbook changed under the run (a file opened between two applies)
  return { kind: 'univer', base: null, top: null, steps: 0, complete: false }
}

export type RevertVerdict = 'ok' | 'refused' | 'expired'

/** May the card undo the run now, given Univer's undo stack as it is? */
export function univerRevertVerdict(
  guard: UniverUndoGuard,
  stack: readonly unknown[],
): RevertVerdict {
  if (!guard.complete || guard.steps <= 0 || guard.top === null) return 'expired'
  if (stack.length > 0 && stack[stack.length - 1] === guard.top) return 'ok'
  // still there but under later entries: something was done since
  return stack.includes(guard.top) ? 'refused' : 'expired'
}

/** After undoing the run's steps, the entry under them is the newest again. */
export function univerRevertOutcome(
  guard: UniverUndoGuard,
  stack: readonly unknown[],
): 'reverted' | 'partial' {
  const top = stack.length > 0 ? stack[stack.length - 1] : null
  return top === guard.base ? 'reverted' : 'partial'
}

/** May the card undo an in-memory workbook's run: no AI apply and no grid edit since. */
export function adapterRevertVerdict(
  guard: AdapterUndoGuard,
  revision: number,
  gridUndoDepth: number,
): RevertVerdict {
  if (guard.steps <= 0) return 'expired'
  return revision === guard.revision && gridUndoDepth === 0 ? 'ok' : 'refused'
}

/** where the card of a receipt stands */
export function receiptState(receipt: AiRunReceipt): AiChangesState {
  if (receipt.state) return receipt.state
  // the batch went over the undo budget and kept no stack entry, or entries fell out
  if (receipt.undoSteps <= 0) return 'expired'
  if (receipt.guard?.kind === 'univer' && !receipt.guard.complete) return 'expired'
  return 'applied'
}

/**
 * The status line after the card took a run back: the notice that offered undo
 * for the run's unsaved changes now says they went back; any other line stays.
 */
export function statusAfterRevert(
  current: string,
  appliedNotice: string,
  reverted: string,
): string {
  return current === appliedNotice ? reverted : current
}
