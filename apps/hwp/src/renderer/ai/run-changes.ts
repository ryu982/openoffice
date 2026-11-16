import type { AiChangeLine } from '@genoffice/ui'
import type { HwpChange } from './hwp-skill'

/**
 * Where one run's changes stand, as its card shows them. `partial` is an undo that
 * stopped part way (the editor's history ran short): like `refused`, the history is no
 * longer the run's, so neither it nor an older run is offered for undo again.
 */
export type HwpRunState = 'applied' | 'reverted' | 'partial' | 'refused'

/** a sign after the + of an added table or picture, the same in every language */
const TABLE_GLYPH = '▦'
const PICTURE_GLYPH = '▣'

/** One change of the run as a line of the shared changes card. */
export function hwpChangeLine(item: HwpChange): AiChangeLine {
  const showable = item.place !== undefined
  switch (item.kind) {
    case 'insert':
      return { kind: 'insert', to: item.to, showable }
    case 'table':
      return { kind: 'insert', to: item.to, glyph: TABLE_GLYPH, showable }
    case 'image':
      return { kind: 'insert', to: item.to, glyph: PICTURE_GLYPH, showable }
    case 'delete':
      return { kind: 'delete', from: item.from, showable }
    case 'field':
    case 'format':
    case 'cells':
    case 'lines':
    case 'note':
      // named, not struck through: this stays, it is what the change was done to
      return { kind: 'named', from: item.from, to: item.to, count: item.count, showable }
    case 'replace':
    case 'replaceAll':
      return { kind: 'replace', from: item.from, to: item.to, count: item.count, showable }
  }
}

/** How many places the run changed: a replace-all or filled cells count each place. */
export function hwpChangeCount(items: readonly HwpChange[]): number {
  return items.reduce((sum, item) => sum + item.count, 0)
}

/**
 * What an undo of the run left: all its steps taken back, some of them (the editor's
 * history ran out part way), or none (the document was changed since, or the call failed).
 */
export function undoOutcome(
  result: { ok: boolean; undone: number } | null,
): Exclude<HwpRunState, 'applied'> {
  if (!result) return 'refused'
  if (result.ok) return 'reverted'
  return result.undone > 0 ? 'partial' : 'refused'
}

/**
 * The editor's history is one stack: only the newest run still in the document can be
 * taken back, and a run that could not be taken back whole blocks the ones under it.
 */
export function revertableIndex(states: readonly (HwpRunState | undefined)[]): number {
  for (let i = states.length - 1; i >= 0; i--) {
    const state = states[i]
    if (state === 'applied') return i
    if (state === 'refused' || state === 'partial') return -1
  }
  return -1
}
