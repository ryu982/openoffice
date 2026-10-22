/**
 * Hangul's (HWP) formatting steps, which Korean users type without looking:
 * ⌥⇧Z / ⌥⇧A line spacing wider / narrower, ⌥⇧W / ⌥⇧N character spacing
 * wider / narrower, ⌥⇧E / ⌥⇧R font size one point larger / smaller.
 *
 * Hangul counts both spacings in percent: line spacing in steps of 10%,
 * character spacing in steps of 1% of the font size. Word stores line spacing
 * as a multiple of single (or a fixed height in twips under At least /
 * Exactly) and character spacing in twips, so the steps are translated into
 * those units here: 0.1 line (1 pt for a fixed height) and 1% of the size.
 */
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import type { DocDefaults, StyleDisplay, StyleInfo } from '@genoffice/docx-engine'

export type FormatStepAction = 'stepLineSpacing' | 'stepCharSpacing' | 'nudgeFontSize'

/** e.code, not e.key: Option rewrites the letter on the Mac (⌥⇧A types Å) */
const STEP_KEYS: Record<string, { action: FormatStepAction; dir: 1 | -1 }> = {
  KeyZ: { action: 'stepLineSpacing', dir: 1 },
  KeyA: { action: 'stepLineSpacing', dir: -1 },
  KeyW: { action: 'stepCharSpacing', dir: 1 },
  KeyN: { action: 'stepCharSpacing', dir: -1 },
  KeyE: { action: 'nudgeFontSize', dir: 1 },
  KeyR: { action: 'nudgeFontSize', dir: -1 },
}

/** The step a key press asks for: Alt+Shift (⌥⇧) and one of the six letters, nothing else held */
export function formatStepForKey(
  e: Pick<KeyboardEvent, 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'code'>,
): { action: FormatStepAction; dir: 1 | -1 } | null {
  if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return null
  return STEP_KEYS[e.code] ?? null
}

export interface LineSpacingValue {
  /** multiple of single spacing; null under an At least / Exactly rule */
  lineSpacing: number | null
  lineRule: 'atLeast' | 'exact' | null
  /** fixed line height under At least / Exactly */
  lineRawTwips: number | null
}

type LineSource = { lineSpacing?: unknown; lineRule?: unknown; lineRawTwips?: unknown }

function lineSpacingOf(src: LineSource | null | undefined): LineSpacingValue | null {
  if (!src) return null
  const raw = Number(src.lineRawTwips) || 0
  if ((src.lineRule === 'exact' || src.lineRule === 'atLeast') && raw > 0)
    return { lineSpacing: null, lineRule: src.lineRule, lineRawTwips: raw }
  const multiple = Number(src.lineSpacing) || (src.lineRule === 'auto' && raw > 0 ? raw / 240 : 0)
  return multiple > 0 ? { lineSpacing: multiple, lineRule: null, lineRawTwips: null } : null
}

/** a paragraph without w:pStyle takes the default paragraph style (Normal) */
export function paragraphStyleDisplay(
  styles: Map<string, StyleInfo> | undefined,
  styleId: unknown,
): StyleDisplay | undefined {
  if (!styles) return undefined
  const own = typeof styleId === 'string' && styleId ? styles.get(styleId) : undefined
  return (own ?? [...styles.values()].find((s) => s.type === 'paragraph' && s.isDefault))?.display
}

/** The line spacing Word lays the paragraph out with: direct, its style, the document default, single */
export function effectiveLineSpacing(
  paraAttrs: LineSource,
  paraStyle?: StyleDisplay,
  docDefaults?: DocDefaults,
): LineSpacingValue {
  return (
    lineSpacingOf(paraAttrs) ??
    lineSpacingOf(paraStyle) ??
    lineSpacingOf(docDefaults) ?? { lineSpacing: 1, lineRule: null, lineRawTwips: null }
  )
}

/**
 * The paragraph a step reads its current value from: the caret's, or the
 * first one in the selection (an AllSelection starts in the doc node itself,
 * whose attrs are no paragraph's)
 */
export function selectionParagraph(state: EditorState): PMNode | null {
  const { $from, from, to } = state.selection
  if ($from.parent.isTextblock) return $from.parent
  let found: PMNode | null = null
  state.doc.nodesBetween(from, to, (node) => {
    if (found) return false
    if (node.isTextblock) found = node
    return !found
  })
  return found
}

/** The line spacing of the selection's first paragraph */
export function lineSpacingAt(
  editor: Editor,
  styles: Map<string, StyleInfo> | undefined,
  docDefaults: DocDefaults | undefined,
): LineSpacingValue {
  const attrs = selectionParagraph(editor.state)?.attrs ?? {}
  return effectiveLineSpacing(attrs, paragraphStyleDisplay(styles, attrs.styleId), docDefaults)
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

/** One step wider (1) or narrower (-1), within the Paragraph dialog's ranges */
export function stepLineSpacing(cur: LineSpacingValue, dir: 1 | -1): LineSpacingValue {
  if (cur.lineRule) {
    const raw = clamp((cur.lineRawTwips ?? 240) + dir * 20, 20, 31680)
    return { lineSpacing: null, lineRule: cur.lineRule, lineRawTwips: raw }
  }
  const next = clamp(Math.round(((cur.lineSpacing ?? 1) + dir * 0.1) * 100) / 100, 0.06, 132)
  return { lineSpacing: next, lineRule: null, lineRawTwips: null }
}

export const sameLineSpacing = (a: LineSpacingValue, b: LineSpacingValue): boolean =>
  a.lineSpacing === b.lineSpacing && a.lineRule === b.lineRule && a.lineRawTwips === b.lineRawTwips

/**
 * Character spacing one step (1% of the font size) wider or narrower. Hangul
 * stops at ±50%; spacing already past that (set in the Font dialog) can still
 * be brought back toward zero.
 */
export function stepCharSpacingTwips(currentTwips: number, sizePt: number, dir: 1 | -1): number {
  const unit = (Math.max(sizePt, 1) * 20) / 100
  const pct = Math.round(currentTwips / unit)
  if (pct * dir >= 50) return currentTwips
  const next = Math.round((pct + dir) * unit)
  // below 5 pt one percent rounds to no twips at all; move by one instead
  return next === currentTwips ? currentTwips + dir : next
}

/** The selection's character spacing: its own, else its character style's, else its paragraph style's */
export function charSpacingAt(
  editor: Editor,
  styles: Map<string, StyleInfo> | undefined,
): { current: number; inherited: number } {
  const attrs = editor.getAttributes('docTextStyle')
  const charStyle =
    typeof attrs.styleId === 'string' && attrs.styleId ? styles?.get(attrs.styleId) : undefined
  const paraStyle = paragraphStyleDisplay(styles, selectionParagraph(editor.state)?.attrs.styleId)
  const inherited = charStyle?.display?.charSpacingTwips ?? paraStyle?.charSpacingTwips ?? 0
  const own = attrs.charSpacingTwips
  return { current: typeof own === 'number' ? own : inherited, inherited }
}

// Steps closer together than this coalesce into one trailing apply (the same
// window as the A+/A- buttons): every applied step re-lays out the document,
// and a held chord repeats ~30 times a second.
export const STEP_COALESCE_MS = 300

export interface StepBurst<T> {
  pending: T | null
  applied: T | null
  timer: number | null
  // editor snapshot the deferred apply validates against
  anchor: number
  head: number
  doc: PMNode | null
}

export const newStepBurst = <T>(): StepBurst<T> => ({
  pending: null,
  applied: null,
  timer: null,
  anchor: -1,
  head: -1,
  doc: null,
})

/**
 * Apply the first step of a burst at once and only advance `pending` for the
 * steps that follow inside the window; one trailing apply lays out the final
 * value. The trailing apply is dropped when the selection or the document
 * changed in between (a click, an undo, another edit) instead of overwriting it.
 */
export function burstStep<T>(
  burst: StepBurst<T>,
  target: Editor,
  current: T,
  step: (base: T) => T,
  apply: (value: T, deferred: boolean) => void,
  same: (a: T, b: T) => boolean,
): void {
  const next = step(burst.pending ?? current)
  burst.pending = next
  if (burst.timer === null) {
    burst.applied = next
    apply(next, false)
  } else {
    window.clearTimeout(burst.timer)
  }
  burst.anchor = target.state.selection.anchor
  burst.head = target.state.selection.head
  burst.doc = target.state.doc
  burst.timer = window.setTimeout(() => {
    burst.timer = null
    const pending = burst.pending
    burst.pending = null
    if (pending === null || (burst.applied !== null && same(pending, burst.applied))) return
    if (
      target.isDestroyed ||
      target.state.selection.anchor !== burst.anchor ||
      target.state.selection.head !== burst.head ||
      target.state.doc !== burst.doc
    )
      return
    burst.applied = pending
    apply(pending, true)
  }, STEP_COALESCE_MS)
}
