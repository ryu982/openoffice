/**
 * Hangul's (HWP) formatting chords in the slide editor: ⌥⇧Z / ⌥⇧A line
 * spacing one tenth of a line (10%) wider / narrower, ⌥⇧W / ⌥⇧N character
 * spacing 1% of the font size wider / narrower, ⌥⇧E / ⌥⇧R font size one point
 * larger / smaller (the ⌘] / ⌘[ step). Shared by the renderer, which reads the
 * keys and steps an editing selection, and the main process, which steps whole
 * elements from the model.
 */

export type FormatStepAction = 'lineSpacing' | 'charSpacing' | 'fontSize'

/** e.code, not e.key: Option rewrites the letter on the Mac (⌥⇧A types Å) */
const STEP_KEYS: Record<string, { action: FormatStepAction; dir: 1 | -1 }> = {
  KeyZ: { action: 'lineSpacing', dir: 1 },
  KeyA: { action: 'lineSpacing', dir: -1 },
  KeyW: { action: 'charSpacing', dir: 1 },
  KeyN: { action: 'charSpacing', dir: -1 },
  KeyE: { action: 'fontSize', dir: 1 },
  KeyR: { action: 'fontSize', dir: -1 },
}

/** The step a key press asks for: Alt+Shift (⌥⇧) and one of the letters, nothing else held */
export function formatStepForKey(
  e: Pick<KeyboardEvent, 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'code'>,
): { action: FormatStepAction; dir: 1 | -1 } | null {
  if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return null
  return STEP_KEYS[e.code] ?? null
}

/** Line spacing in percent of single (lnSpc spcPct); a fixed height (spcPts) steps from single */
export function lineSpacingPctOf(p?: { lineHeight?: number; lineExact?: number }): number {
  return p?.lineExact == null && p?.lineHeight != null ? p.lineHeight : 100
}

/** setParagraphFormat's lineSpacingPct range (ST_TextSpacingPercent) */
const LINE_SPACING_PCT_MAX = 13200
/** the narrowest a step goes: a tenth of a line */
const LINE_SPACING_PCT_MIN = 10

/** One step wider (1) or narrower (-1); spacing already below a tenth of a line is not narrowed further */
export function stepLineSpacingPct(cur: number, dir: 1 | -1): number {
  const next = Math.round(cur) + dir * 10
  if (dir < 0) return cur <= LINE_SPACING_PCT_MIN ? cur : Math.max(next, LINE_SPACING_PCT_MIN)
  return Math.min(next, LINE_SPACING_PCT_MAX)
}

/**
 * Character spacing (pt, a:rPr spc) one step — 1% of the font size — wider or
 * narrower, in the hundredths of a point the file stores. Hangul stops at ±50%;
 * spacing already past that can still be brought back toward zero.
 */
export function stepLetterSpacingPt(curPt: number, sizePt: number, dir: 1 | -1): number {
  const cur = Math.round(curPt * 100)
  // one percent of the size, in hundredths of a point; at least one so a step always moves
  const unit = Math.max(sizePt, 1)
  const pct = Math.round(cur / unit)
  if (pct * dir >= 50) return cur / 100
  return Math.round((pct + dir) * unit) / 100
}
