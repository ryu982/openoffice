// Settings → General "New documents on Home" with some items turned off
// (spec §6): only kinds whose item is on are listed. The stored order and
// hidden marks of the off kinds are never touched, so turning an item back on
// puts its kind back where it was. Pure.

import { editorItemOfHomeKind, type EditorItemId } from '../../../shared/editor-choice'
import { HOME_KINDS, type HomeKind, type HomeKindsSettings } from '../../../shared/home-kinds'

/** the kinds the field lists: those whose item is on, in the stored order */
export function shownHomeKinds(
  settings: HomeKindsSettings,
  off: readonly EditorItemId[],
): HomeKind[] {
  return settings.order.filter((kind) => {
    const item = editorItemOfHomeKind(kind)
    return !item || !off.includes(item)
  })
}

/**
 * Swap `kind` with its neighbour among the listed kinds; the kinds not listed
 * keep their places. Unchanged at either end of the list.
 */
export function moveShownHomeKind(
  settings: HomeKindsSettings,
  kind: HomeKind,
  step: -1 | 1,
  shown: readonly HomeKind[],
): HomeKindsSettings {
  const at = shown.indexOf(kind)
  const neighbour = at < 0 ? undefined : shown[at + step]
  if (!neighbour) return settings
  const order = [...settings.order]
  const from = order.indexOf(kind)
  const to = order.indexOf(neighbour)
  if (from < 0 || to < 0) return settings
  ;[order[from], order[to]] = [order[to], order[from]]
  return { order, hidden: [...settings.hidden] }
}

/** whether the listed kinds already stand in the first order */
export function homeKindsInFirstOrder(shown: readonly HomeKind[]): boolean {
  const first = HOME_KINDS.filter((kind) => shown.includes(kind))
  return first.every((kind, index) => kind === shown[index])
}

/** put the listed kinds back in the first order, in the places they hold; the rest stay */
export function resetShownHomeKinds(
  settings: HomeKindsSettings,
  shown: readonly HomeKind[],
): HomeKindsSettings {
  const sorted = HOME_KINDS.filter((kind) => shown.includes(kind))
  let next = 0
  const order = settings.order.map((kind) => (shown.includes(kind) ? sorted[next++] : kind))
  return { order, hidden: [...settings.hidden] }
}
