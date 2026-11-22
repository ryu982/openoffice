import { Fragment } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { pdfRectToCss, pdfToView } from './annotations'
import type { PageGeom } from './annotations'
import { colorSegments, decodeStyle, encodeStyle, runsToColors } from './color-runs'
import type { CharStyle } from './color-runs'
import type { DocFontStyle } from './doc-font'
import { EDIT_FONTS, SYNTHETIC_BOLD_STROKE_EM } from '../shared/ipc'
import type { TextEditInput, TextEditValidation, TextInsertInput } from '../shared/ipc'
import type { TextBlock } from './text-block'
import { joinBlockLines } from './text-wrap'

export const EDIT_FONT_BY_ID = new Map<string, (typeof EDIT_FONTS)[number]>(
  EDIT_FONTS.map((f) => [f.id, f]),
)

let measureCtx: CanvasRenderingContext2D | null = null
/** Width of text in the given CSS font (shared hidden canvas) */
export function measureTextWidth(text: string, font: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return 0
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

export const rgbToHex = (c: readonly [number, number, number]): string =>
  `#${c
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
export const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
]

/** Text-edit colors travel as 0-255 RGB (PDFium fill color), unlike markups' 0-1 floats */
export const hexTo255 = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]
const luminance = ([r, g, b]: readonly [number, number, number]): number =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
/** The run's base ink as CSS, unless it is indistinguishable from the paper behind the
    preview box (it would vanish; the default ink shows then) */
export const visibleInk = (
  baseColor: readonly [number, number, number],
  paper: string | undefined,
): string | undefined => {
  const back = paper ? hexTo255(paper) : ([255, 255, 255] as const)
  return Math.abs(luminance(baseColor) - luminance(back)) > 0.15
    ? rgb255ToHex(baseColor)
    : undefined
}
export const rgb255ToHex = (c: readonly [number, number, number]): string =>
  `#${c
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`

/** Committed IPC style runs → encoded-key runs over newText (the draft/preview form) */
export const styleRunsToKeyRuns = (
  runs: NonNullable<TextEditInput['styleRuns']>,
): { start: number; end: number; color: string }[] =>
  runs.map((r) => ({
    start: r.start,
    end: r.end,
    color: encodeStyle({
      color: r.color ? rgb255ToHex(r.color) : undefined,
      font: r.font,
      size: r.size,
      bold: r.bold,
      italic: r.italic,
    }),
  }))

/** Preview of a bold toggle, mirroring the engine: an explicit edit font draws its real
    bold face; the document's own face is stroked in place (same advances), unless its
    name already says it is bold — then the engine leaves it alone. */
export const boldCss = (
  bold: boolean | undefined,
  explicitFont: boolean,
  baseWeight?: number,
): CSSProperties => {
  if (bold === undefined) return {}
  if (!bold) return { fontWeight: 400, WebkitTextStroke: '0' }
  if (explicitFont) return { fontWeight: 700 }
  if (baseWeight && baseWeight >= 600) return { fontWeight: baseWeight }
  return { WebkitTextStroke: `${SYNTHETIC_BOLD_STROKE_EM}em currentColor` }
}

/** Weight token for canvas font shorthands: synthetic bold keeps regular advances */
export const boldToken = (bold: boolean | undefined, explicitFont: boolean, baseWeight?: number) =>
  bold && explicitFont ? 'bold' : baseWeight ? String(baseWeight) : ''

/** CSS of one styled segment in the editor mirror / pending preview. Explicit on/off
    overrides the inherited draft-level weight/slant; size scales like the host text. */
export const styleSegCss = (s: CharStyle, scale: number, draftFont?: string): CSSProperties => ({
  ...(s.color ? { color: s.color } : {}),
  ...(s.font ? { fontFamily: EDIT_FONT_BY_ID.get(s.font)?.css } : {}),
  ...(s.size !== undefined ? { fontSize: s.size * scale * 0.92 } : {}),
  ...boldCss(s.bold, !!(s.font ?? draftFont)),
  ...(s.italic !== undefined ? { fontStyle: s.italic ? 'italic' : 'normal' } : {}),
})

/** Encoded-key runs → the IPC styleRuns the engine consumes */
export const keyRunsToStyleRuns = (
  runs: { start: number; end: number; color: string }[],
): NonNullable<TextEditInput['styleRuns']> =>
  runs.map((r) => {
    const s = decodeStyle(r.color)
    return {
      start: r.start,
      end: r.end,
      color: s.color ? hexTo255(s.color) : undefined,
      font: s.font,
      size: s.size,
      bold: s.bold,
      italic: s.italic,
    }
  })

export interface LocalTextEdit {
  id: string
  input: TextEditInput
  /** Matched run's ink bounds from validation (PDF user space). The edit rect is a pdf.js
      layout box; glyph ink can poke out of it, so the preview covers this instead */
  cover?: [number, number, number, number]
  /** The run's base ink (display-only, from the draft's probe): the pending preview
      shows the document's real color when the edit doesn't change it */
  baseInk?: string
  /** Local look-alike of the run's own font (display-only, from the PostScript
      name): the pending preview reads like the document. Never sent to the engine. */
  baseFont?: DocFontStyle
  /** Page color sampled around the run when the draft opened (CSS). Backs the preview
      until the live render has erased the original ink; display-only. */
  paper?: string
  /** Accumulated block-move delta (PDF user space). Renderer metadata only: the preview
      and hover box draw at rect + moveBy while input.rect stays at the original position
      (it is the save-time match key). The engine-side position rides in input.translate
      (pure moves) or the shifted input.origin (moved rebuild edits). */
  moveBy?: [number, number]
}

/** Stable per-render key for a clustered block's rect (same idea as imageRectKey) */
export const blockRectKey = (r: readonly number[]): string => r.map((v) => v.toFixed(2)).join(',')

/** Probe the live page render erases a run with (same shape the open validation sends) */
export const textEraseProbe = (
  pageIndex: number,
  rect: [number, number, number, number],
  oldText: string,
  fontSize: number,
): TextEditInput => ({ pageIndex, rect, oldText, newText: '', fontSize })

/** Identity of an erase probe across draft → pending edit (both address the same run) */
export const textEraseKey = (p: TextEditInput): string =>
  `${p.pageIndex}|${blockRectKey(p.rect)}|${p.oldText}`

/** Background for a run's editor/preview box: transparent once the live render has
    erased the original ink, the sampled page color until then, paper as the last resort */
export const paperCss = (erased: boolean, paper: string | undefined): CSSProperties =>
  erased ? { background: 'transparent' } : paper ? { background: paper } : {}

export const shiftRect = (
  r: readonly [number, number, number, number],
  d: readonly [number, number],
): [number, number, number, number] => [r[0] + d[0], r[1] + d[1], r[2] + d[0], r[3] + d[1]]

/** Pure move of an untouched block: the engine translates the original text objects
    as-is (fonts/kerning/leading survive byte-identical); newText keeps the document's
    own visual lines so the pending preview stacks them the way the page draws them */
export const blockMoveInput = (
  origIdx: number,
  block: TextBlock,
  d: readonly [number, number],
): TextEditInput => {
  const lines = block.lines.map((l) => l.text)
  const oldText = joinBlockLines(lines)
  return {
    pageIndex: origIdx,
    rect: [...block.rect],
    oldText,
    newText: lines.join('\n'),
    fontSize: block.fontSize,
    origin: [block.rect[0] + d[0], block.lines[0]!.y + d[1]],
    lineLeading: block.lineHeight,
    align: block.align !== 'left' ? block.align : undefined,
    blockSource: oldText,
    translate: [d[0], d[1]],
  }
}

/** Shift a pending edit that owns `block` by d: block rebuilds move their origin, pure
    moves their translate. A line edit carries no position of its own (the rebuild sits
    at the matched objects), so moving it converts it to an origin-anchored rebuild at
    its own shifted line start — a restyled/edited line cannot take the pure-translate
    path, that would discard its pending changes. */
export const shiftPendingEdit = (
  te: LocalTextEdit,
  block: TextBlock,
  d: readonly [number, number],
): LocalTextEdit => {
  const input = { ...te.input }
  if (input.origin) {
    input.origin = [input.origin[0] + d[0], input.origin[1] + d[1]]
  } else if (!input.translate) {
    // Anchor at the edit's own rect, not the block corner: the edit's visual line
    // can start left of the block (the DOM line grouping joins runs the clustering
    // split off). Baseline comes from the block row containing the edit; buildLine
    // puts the row bottom 0.2 font sizes under the baseline, hence the fallback.
    const cy = (input.rect[1] + input.rect[3]) / 2
    const row = block.lines.find((l) => cy >= l.rect[1] && cy <= l.rect[3])
    input.origin = [input.rect[0] + d[0], (row?.y ?? input.rect[1] + input.fontSize * 0.2) + d[1]]
    input.lineLeading ??= block.lineHeight
  }
  if (input.translate) input.translate = [input.translate[0] + d[0], input.translate[1] + d[1]]
  return {
    ...te,
    input,
    moveBy: [(te.moveBy?.[0] ?? 0) + d[0], (te.moveBy?.[1] ?? 0) + d[1]],
  }
}

/** Paragraph-level pending edit (rewrite or pure move): the editor and the AI tools
    always record the logical paragraph text on those, while a line edit never gets one —
    even after a block move gives it an origin */
const isBlockEdit = (e: LocalTextEdit): boolean => e.input.blockSource !== undefined

/** Block-level pending edit of exactly this block (its objects were validated when it
    was queued, so shifting it needs no new dry-run) */
export const isBlockEditOf = (te: LocalTextEdit, block: TextBlock): boolean =>
  isBlockEdit(te) && blockRectKey(te.input.rect) === blockRectKey(block.rect)

/** Whether a pending edit moves `block` as a whole: a block-level edit of it, or a line
    edit whose text is the entire block (single-line blocks). A line edit inside a
    longer paragraph only drags its own row along. */
export const editCarriesBlock = (te: LocalTextEdit, block: TextBlock): boolean => {
  const squash = (t: string) => t.replace(/\s+/g, '')
  return (
    isBlockEditOf(te, block) ||
    squash(te.input.oldText) === squash(joinBlockLines(block.lines.map((l) => l.text)))
  )
}

/** Where a new AI text edit lands among the pending edits. A paragraph rewrite
    supersedes the pending edits that claim its objects — the block-level edit of the
    same block and any line edits inside it — and rebuilds at the block's pending
    displacement: the engine cannot translate and rebuild in one edit, so this is what
    reopening a moved block in the editor does. A line edit inside a pending block-level
    edit cannot fold (that edit still claims its objects), so it is refused. */
export const resolveTextEdit = (
  edits: LocalTextEdit[],
  input: TextEditInput,
):
  | { input: TextEditInput; replaces: LocalTextEdit[]; moveBy?: [number, number] }
  | { reason: string } => {
  const key = blockRectKey(input.rect)
  const inside = (r: readonly number[], of: readonly number[]) => {
    const cx = (r[0]! + r[2]!) / 2
    const cy = (r[1]! + r[3]!) / 2
    return cx >= of[0]! && cx <= of[2]! && cy >= of[1]! && cy <= of[3]!
  }
  const onPage = edits.filter((e) => e.input.pageIndex === input.pageIndex)
  if (input.origin === undefined) {
    const blocker = onPage.find(
      (e) =>
        isBlockEdit(e) && (blockRectKey(e.input.rect) === key || inside(input.rect, e.input.rect)),
    )
    if (blocker) {
      return {
        reason:
          'the paragraph containing this text already has a pending move or rewrite; use edit_block on the whole paragraph (its pending position is kept)',
      }
    }
    return { input, replaces: [] }
  }
  const owner = onPage.find((e) => isBlockEdit(e) && blockRectKey(e.input.rect) === key)
  const embedded = onPage.filter((e) => !isBlockEdit(e) && inside(e.input.rect, input.rect))
  const replaces = owner ? [owner, ...embedded] : embedded
  const moveBy = replaces.find((e) => e.moveBy)?.moveBy
  return {
    input: moveBy
      ? { ...input, origin: [input.origin[0] + moveBy[0], input.origin[1] + moveBy[1]] }
      : input,
    replaces,
    moveBy,
  }
}

type StyleRun = NonNullable<TextEditInput['styleRuns']>[number]
type RunStyleFields = Omit<StyleRun, 'start' | 'end'>
/** The engine's report of a fragment match: the whole run it will rewrite */
export type FragmentRun = NonNullable<TextEditValidation['run']>

const definedStyle = (s: RunStyleFields): RunStyleFields =>
  Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as RunStyleFields

/**
 * A line edit whose oldText is only part of a PDF text object, widened to that whole
 * object. The engine rewrites a fragment match as the entire run drawn from the run's
 * own origin (the text after the fragment moves to follow the replacement), so only
 * the widened form lets the preview and the live page render (which erases exactly
 * the edit's run) show what the save will write. The edit-level styles the caller
 * asked for apply to the replaced fragment alone: they become a style run over it,
 * leaving the rest of the run as it is.
 */
export const widenToRun = (input: TextEditInput, run: FragmentRun): TextEditInput => {
  const b = run.bounds
  const base = definedStyle({
    color: input.newColor,
    font: input.newFont,
    size: input.newFontSize,
    bold: input.newBold,
    italic: input.newItalic,
  })
  // Selection-level runs of the fragment (offsets into input.newText) move with it
  const own = (input.styleRuns ?? input.colorRuns ?? []).map((r) => ({ ...r }))
  const runs: StyleRun[] = []
  const from = run.start
  const to = run.newEnd
  let at = from
  const pushBase = (end: number) => {
    if (end > at && Object.keys(base).length > 0) runs.push({ start: at, end, ...base })
    at = Math.max(at, end)
  }
  for (const r of own) {
    const start = Math.min(to, from + r.start)
    const end = Math.min(to, from + r.end)
    if (end <= start) continue
    pushBase(start)
    const { start: _s, end: _e, ...fields } = r
    runs.push({ start, end, ...base, ...definedStyle(fields) })
    at = end
  }
  pushBase(to)
  return {
    pageIndex: input.pageIndex,
    // x: the whole run; y: the caller's layout box (the preview box is a line box)
    rect: [
      Math.min(input.rect[0], b[0]),
      input.rect[1],
      Math.max(input.rect[2], b[2]),
      input.rect[3],
    ],
    oldText: run.oldText,
    newText: run.newText,
    fontSize: input.fontSize,
    ...(runs.length > 0 ? { styleRuns: runs } : {}),
  }
}

const squashWs = (s: string) => s.replace(/\s+/g, '')
const rectsTouch = (a: readonly number[], b: readonly number[]) =>
  a[0]! < b[2]! && b[0]! < a[2]! && a[1]! < b[3]! && b[1]! < a[3]!

/** Pending line edits addressing the same run as `input` (same page, same original
    text, overlapping position). Paragraph-level edits are resolveTextEdit's business. */
export const sameRunEdits = (edits: LocalTextEdit[], input: TextEditInput): LocalTextEdit[] =>
  edits.filter(
    (e) =>
      e.input.pageIndex === input.pageIndex &&
      !isBlockEdit(e) &&
      !e.input.translate &&
      squashWs(e.input.oldText) === squashWs(input.oldText) &&
      rectsTouch(e.input.rect, input.rect),
  )

/** Raw offset in `s` of the k-th non-space character (s.length past the last one) */
const nsOffset = (s: string, k: number): number => {
  let seen = 0
  for (let i = 0; i < s.length; i++) {
    if (/\s/.test(s[i]!)) continue
    if (seen === k) return i
    seen++
  }
  return s.length
}
const nsCount = (s: string, end: number): number => squashWs(s.slice(0, end)).length

/** Splice code-unit style runs: [at, at + removed) is replaced by `inserted` units */
const spliceRuns = (runs: StyleRun[], at: number, removed: number, inserted: number) => {
  const delta = inserted - removed
  const out: StyleRun[] = []
  for (const r of runs) {
    if (r.end <= at) out.push(r)
    else if (r.start >= at + removed) out.push({ ...r, start: r.start + delta, end: r.end + delta })
    else {
      if (r.start < at) out.push({ ...r, end: at })
      if (r.end > at + removed) out.push({ ...r, start: at + inserted, end: r.end + delta })
    }
  }
  return out
}

/**
 * A second fragment edit on a run that already has a pending line edit: both would
 * claim the same text objects, and the save applies only the first. Fold the new
 * replacement into the pending edit's text instead, when it touches only text that
 * edit left unchanged; otherwise refuse with a reason that shows the line as it now
 * reads. Returns null when no pending edit owns the run.
 */
export const foldIntoRunEdit = (
  edits: LocalTextEdit[],
  widened: TextEditInput,
  run: FragmentRun,
): { owner: LocalTextEdit; input: TextEditInput } | { reason: string } | null => {
  const owner = sameRunEdits(edits, widened)[0]
  if (!owner) return null
  const before = owner.input.oldText
  const now = owner.input.newText
  // The fragment's span in the owner's oldText (equal to run.oldText up to whitespace)
  const ps = before === run.oldText ? run.start : nsOffset(before, nsCount(run.oldText, run.start))
  const pe =
    before === run.oldText
      ? run.oldEnd
      : Math.max(ps, nsOffset(before, nsCount(run.oldText, run.oldEnd) - 1) + 1)
  // The window the owner changed: everything outside it is still the original text
  const max = Math.min(before.length, now.length)
  let pre = 0
  while (pre < max && before[pre] === now[pre]) pre++
  let suf = 0
  while (suf < max - pre && before[before.length - 1 - suf] === now[now.length - 1 - suf]) suf++
  const shift = now.length - before.length
  const at = pe <= pre ? ps : ps >= before.length - suf ? ps + shift : -1
  if (at < 0) {
    return {
      reason: `this text is part of a line that already has a pending edit changing it (the line now reads "${now}"); edit only text outside that change, or replace the line's original text "${before}" as a whole`,
    }
  }
  const replacement = run.newText.slice(run.start, run.newEnd)
  const ownRuns = (owner.input.styleRuns ?? owner.input.colorRuns ?? []).map((r) => ({ ...r }))
  const added = (widened.styleRuns ?? [])
    .filter((r) => r.end > run.start && r.start < run.newEnd)
    .map((r) => ({
      ...r,
      start: Math.max(r.start, run.start) - run.start + at,
      end: Math.min(r.end, run.newEnd) - run.start + at,
    }))
  const styleRuns = [...spliceRuns(ownRuns, at, pe - ps, replacement.length), ...added].sort(
    (a, b) => a.start - b.start,
  )
  const input: TextEditInput = {
    ...owner.input,
    newText: now.slice(0, at) + replacement + now.slice(at + (pe - ps)),
    colorRuns: undefined,
    styleRuns: styleRuns.length > 0 ? styleRuns : undefined,
  }
  return { owner, input }
}

/** An AI text edit resolved against the pending edits and the engine's dry-run */
export interface PlannedAiTextEdit {
  input: TextEditInput
  /** Ink bounds of the matched run (the preview cover) */
  cover?: [number, number, number, number]
  /** The run's base fill (0-255), for the preview's ink */
  baseColor?: [number, number, number]
  /** The pending edit of the same run this one folds into (kept by id, rewritten) */
  owner?: LocalTextEdit
  /** Pending edits the new one supersedes */
  gone: Set<string>
  moveBy?: [number, number]
  /** A single-run edit (edit_text), not a paragraph rebuild */
  lineEdit: boolean
}

/**
 * Where an AI edit (edit_text / edit_block) lands: resolveTextEdit's paragraph rules,
 * then the engine's dry-run. A line edit the engine matches as a fragment of a larger
 * text object is widened to that whole object (widenToRun) — folded into a pending
 * edit of the same object if there is one — and must re-match as the whole run; a
 * whole-run line edit supersedes a pending line edit of the same run. `pending` is
 * read live: the dry-runs are async. `validate` null = no file to check against.
 */
export const planAiTextEdit = async (
  pending: () => LocalTextEdit[],
  raw: TextEditInput,
  validate: ((e: TextEditInput) => Promise<TextEditValidation | undefined>) | null,
): Promise<PlannedAiTextEdit | { reason: string }> => {
  const resolved = resolveTextEdit(pending(), raw)
  if ('reason' in resolved) return resolved
  const { replaces, moveBy } = resolved
  let input = resolved.input
  let cover: [number, number, number, number] | undefined
  let baseColor: [number, number, number] | undefined
  let owner: LocalTextEdit | undefined
  const lineEdit = input.origin === undefined && input.lineLeading === undefined
  if (validate) {
    try {
      const v = await validate(input)
      if (v?.reason) return { reason: v.reason }
      cover = v?.bounds
      baseColor = v?.baseColor
      if (v?.run && lineEdit) {
        // old_text is only part of a PDF text object: the save rewrites that whole
        // object, so the pending edit must address it whole — else the preview draws
        // the fragment's replacement over the rest of the run, which the live page
        // render redraws moved to the run's start
        const widened = widenToRun(input, v.run)
        const fold = foldIntoRunEdit(pending(), widened, v.run)
        if (fold && 'reason' in fold) return fold
        const next = fold ? fold.input : widened
        const b = v.run.bounds
        // Second try when the layout box clips the run's ink: its full bounds
        const inkRect: [number, number, number, number] = [
          Math.min(next.rect[0], b[0]),
          Math.min(next.rect[1], b[1]),
          Math.max(next.rect[2], b[2]),
          Math.max(next.rect[3], b[3]),
        ]
        for (const cand of [next, { ...next, rect: inkRect }]) {
          const w = await validate(cand)
          if (!w || w.reason || w.run) continue
          input = cand
          owner = fold?.owner
          cover = w.bounds
          baseColor = w.baseColor
          break
        }
        // Neither form re-matched as the whole run: keep the fragment edit (the
        // save still writes it correctly; only its preview is approximate)
      }
    } catch {
      /* best-effort: the save path skips-and-reports unmatched edits anyway */
    }
  }
  // A whole-run line edit of a run that already has a pending line edit replaces it:
  // both would claim the same text objects and the save would drop the later one
  const superseded = owner || !lineEdit ? [] : sameRunEdits(pending(), input)
  return {
    input,
    cover,
    baseColor,
    owner,
    gone: new Set([...replaces, ...superseded].map((e) => e.id)),
    moveBy: owner ? owner.moveBy : moveBy,
    lineEdit,
  }
}

/** Land `te` on the live pending list: replace it in place by id and drop the edits it
    superseded. A functional patch — never a snapshot written back — so edits queued or
    dropped while an async validation ran survive. 'upsert' appends a new edit; 'replace'
    (a shifted or folded owner) leaves the list untouched when that owner is gone, so a
    background dry-run that dropped it is not undone by resurrecting the edit. */
export const patchPendingEdits = (
  prev: LocalTextEdit[],
  te: LocalTextEdit,
  remove: ReadonlySet<string> = new Set(),
  mode: 'upsert' | 'replace' = 'upsert',
): LocalTextEdit[] => {
  const present = prev.some((e) => e.id === te.id)
  if (!present && mode === 'replace') return prev
  const kept = prev.filter((e) => e.id === te.id || !remove.has(e.id))
  return present ? kept.map((e) => (e.id === te.id ? te : e)) : [...kept, te]
}

export interface LocalTextInsert {
  id: string
  input: TextInsertInput
}

/** Area a pending edit must blank: the edit rect grown to the validated ink bounds */
export const unionCover = (
  rect: readonly [number, number, number, number],
  cover: readonly [number, number, number, number] | undefined,
): [number, number, number, number] =>
  cover
    ? [
        Math.min(rect[0], cover[0]),
        Math.min(rect[1], cover[1]),
        Math.max(rect[2], cover[2]),
        Math.max(rect[3], cover[3]),
      ]
    : [rect[0], rect[1], rect[2], rect[3]]

/** Expand a CSS box by p px on every side (antialiasing bleeds past exact ink bounds) */
export const inflateCss = (
  b: { left: number; top: number; width: number; height: number },
  p: number,
) => ({
  left: b.left - p,
  top: b.top - p,
  width: b.width + 2 * p,
  height: b.height + 2 * p,
})

/** Pending text-insert preview style; shared by the canvas overlay and the thumbnail mirror */
export const textInsertPreviewStyle = (
  insert: LocalTextInsert,
  geom: PageGeom,
  scale: number,
): CSSProperties => {
  const [vx, vy] = pdfToView(geom, insert.input.origin[0], insert.input.origin[1])
  const align = insert.input.align ?? 'left'
  const style: CSSProperties = {
    left: vx * scale,
    top: (vy - insert.input.fontSize) * scale,
    fontSize: insert.input.fontSize * scale * 0.92,
    lineHeight: insert.input.lineLeading ? `${insert.input.lineLeading * scale}px` : 1.2,
    color: `rgb(${insert.input.color.join(', ')})`,
    whiteSpace: 'pre',
    transform:
      align === 'center' ? 'translateX(-50%)' : align === 'right' ? 'translateX(-100%)' : undefined,
    textAlign: align,
  }
  if (insert.input.font) style.fontFamily = EDIT_FONT_BY_ID.get(insert.input.font)?.css
  if (insert.input.bold) Object.assign(style, boldCss(true, !!insert.input.font))
  if (insert.input.italic) style.fontStyle = 'italic'
  return style
}

/** Pending text-edit preview style + original-run cover; shared with the thumbnail mirror */
export const textEditPreviewParts = (
  te: LocalTextEdit,
  geom: PageGeom,
  scale: number,
  erased = false,
): { style: CSSProperties; coverStyle: CSSProperties | null } => {
  const fs = (te.input.newFontSize ?? te.input.fontSize) * scale * 0.92
  const lineCount = te.input.newText.split('\n').length
  const leadPx = te.input.lineLeading ? te.input.lineLeading * scale : fs * 1.2
  const style: CSSProperties = {
    // A moved block previews at its new position; input.rect stays at the original
    // (it is the save-time match key, and the cover below must hide the original ink)
    ...pdfRectToCss(geom, te.moveBy ? shiftRect(te.input.rect, te.moveBy) : te.input.rect, scale),
    fontSize: fs,
    ...(te.input.lineLeading ? { lineHeight: `${leadPx}px` } : {}),
    ...paperCss(erased, te.paper),
  }
  if (te.input.newColor) {
    style.color = `rgb(${te.input.newColor.join(', ')})`
  } else if (te.baseInk) {
    style.color = te.baseInk
  }
  const baseF = te.input.newFont ? undefined : te.baseFont
  if (te.input.newFont) {
    style.fontFamily = EDIT_FONT_BY_ID.get(te.input.newFont)?.css
  } else if (baseF) {
    // Look-alike of the document's own face
    style.fontFamily = baseF.css
  }
  if (te.input.newBold) Object.assign(style, boldCss(true, !!te.input.newFont, baseF?.weight))
  else if (baseF?.weight) style.fontWeight = baseF.weight
  if (te.input.newItalic) style.fontStyle = 'italic'
  else if (baseF?.italic) style.fontStyle = 'italic'
  if (lineCount > 1) {
    // Grow below the original rect, same leading the engine writes
    // (block edits carry the paragraph's own leading)
    style.height = lineCount * leadPx
    style.lineHeight = te.input.lineLeading ? `${leadPx}px` : 1.2
    style.alignItems = 'flex-start'
  } else if (typeof style.height === 'number' && fs + 2 > style.height) {
    // Enlarged single line: the engine keeps the run's baseline, so glyphs grow
    // upward past the original rect — extend the box up and bottom-align, or the
    // preview clips the taller glyphs (overflow: hidden)
    const grown = Math.ceil(fs) + 2
    style.top = (style.top as number) - (grown - style.height)
    style.height = grown
    style.alignItems = 'flex-end'
  }
  // The rebuilt run grows right past the original rect when the replacement is
  // longer; the preview must too, or the extra characters look cut off until
  // the save (overflow: hidden)
  const previewFont = [
    te.input.newItalic || baseF?.italic ? 'italic' : '',
    boldToken(te.input.newBold, !!te.input.newFont, baseF?.weight),
    `${fs}px`,
    (te.input.newFont && EDIT_FONT_BY_ID.get(te.input.newFont)?.css) ||
      baseF?.css ||
      getComputedStyle(document.body).fontFamily,
  ]
    .filter(Boolean)
    .join(' ')
  const widest = Math.max(
    ...te.input.newText.split('\n').map((l) => measureTextWidth(l, previewFont)),
  )
  if (typeof style.width === 'number' && widest > style.width) {
    style.width = widest + 2
  }
  if (te.input.align) {
    // The preview is a flex container and its text is one shrink-to-fit anonymous
    // item: textAlign only aligns lines within that item, justifyContent moves
    // the item itself off main-start
    style.textAlign = te.input.align
    if (te.input.align === 'center') style.justifyContent = 'center'
    if (te.input.align === 'right') style.justifyContent = 'flex-end'
  }
  const coverStyle =
    te.cover && !erased
      ? {
          ...inflateCss(pdfRectToCss(geom, unionCover(te.input.rect, te.cover), scale), 1.5),
          ...paperCss(false, te.paper),
        }
      : null
  return { style, coverStyle }
}

/** Styled-run children of a text-edit preview; shared with the thumbnail mirror */
export const textEditPreviewContent = (te: LocalTextEdit, scale: number): ReactNode =>
  (te.input.styleRuns ?? te.input.colorRuns)?.length ? (
    // One wrapper span = one flex item: the preview is a row flex container, and
    // bare segments would become separate items laid out horizontally, breaking
    // '\n' stacking in multi-line previews
    <span>
      {colorSegments(
        te.input.newText,
        runsToColors(
          te.input.newText.length,
          styleRunsToKeyRuns(te.input.styleRuns ?? te.input.colorRuns ?? []),
        ),
      ).map((seg, i) => {
        if (!seg.color) return <Fragment key={i}>{seg.text}</Fragment>
        const s = decodeStyle(seg.color)
        return (
          <span key={i} style={styleSegCss(s, scale, te.input.newFont)}>
            {seg.text}
          </span>
        )
      })}
    </span>
  ) : (
    te.input.newText
  )

/** Editor state for the floating text-edit box; editId set when re-opening a pending edit */
export interface TextDraft {
  origIdx: number
  rect: [number, number, number, number]
  oldText: string
  fontSize: number
  value: string
  /** Style overrides; undefined = keep the run's original size/color */
  size?: number
  /** CSS hex like '#d32f2f' */
  color?: string
  /** Selection-level styles, one encoded key per code unit of value (see encodeStyle);
      '' = base (the draft-level overrides ?? original). undefined/all-'' = uniform
      draft (the pre-existing whole-run behavior). */
  charStyles?: string[]
  /** Colors the document already draws the run with (async, from the open probe),
      pre-seeded into charStyles as color-only keys. A commit whose styles still equal
      these carries no *change* — they only ride along so a rebuild repaints them. */
  seedStyleRuns?: { start: number; end: number; color: string }[]
  /** The run's base ink in the document (async, from the open probe). Display-only:
      the editor/preview text shows the real color; never committed as a change. */
  seedInk?: string
  /** Local look-alike of the run's own font (async, from the dominant run's
      PostScript name). Display + reflow measurement only; never committed. */
  seedFont?: DocFontStyle
  /** Page color sampled around the run at open (CSS); see LocalTextEdit.paper */
  paper?: string
  /** EDIT_FONTS id; undefined = automatic rebuild font */
  font?: string
  /** Style toggles; true = on, undefined = off (resolved via font variants at save) */
  bold?: true
  italic?: true
  editId?: string
  /** Further pending edits folded into this block draft (besides editId); the
      commit replaces editId and removes these — they would overlap the block
      edit at save otherwise */
  foldedIds?: string[]
  /** The value the editor opened with when pending edits were folded in: an
      unmodified commit must keep those edits instead of converting them */
  foldBase?: string
  /** charStyles the fold seeded (styles of the folded line edits); an unmodified
      commit compares against these, not against empty */
  foldStyles?: string[]
  /** Ink bounds of the run being edited (async, from a dry-run validate) */
  cover?: [number, number, number, number]
  /** Present for paragraph (block) edits: the geometry the commit reflows into.
      lineHeight is the block's original leading at the original font size;
      bottomPt is the block's bottom edge in firstBaseline's (possibly moved)
      frame — the overflow guard measures growth against it. */
  block?: {
    leftPt: number
    firstBaseline: number
    widthPt: number
    lineHeight: number
    align: 'left' | 'center' | 'right'
    bottomPt: number
  }
  /** Carried from a reopened moved edit: the floating editor draws at rect + moveBy
      (where the preview sits) while rect itself stays the save-time match key */
  moveBy?: [number, number]
}

export const draftOwnedEditIds = (
  d: Pick<TextDraft, 'editId' | 'foldedIds'> | null,
): ReadonlySet<string> =>
  new Set(d ? [d.editId, ...(d.foldedIds ?? [])].filter((id) => id !== undefined) : [])

export const previewsTextEdit = (
  te: LocalTextEdit,
  pageIndex: number,
  draftOwned: ReadonlySet<string>,
): boolean => te.input.pageIndex === pageIndex && !draftOwned.has(te.id)

/** Seed a fresh draft's colors from the open probe's report of what the document
    already draws: the run's base ink (display-only) plus earlier saved selection
    colors. Selection colors only while the draft is pristine — the runs are offsets
    into oldText, and once typing starts they no longer align (the engine-side
    rebuild still preserves the colors on save). */
export const seedDraftColors = (d: TextDraft, v: TextEditValidation): TextDraft => {
  let next = d
  if (v.baseColor && !next.color && !next.seedInk) {
    const ink = visibleInk(v.baseColor, next.paper)
    if (ink) next = { ...next, seedInk: ink }
  }
  if (!v.colorRuns || v.colorRuns.length === 0) return next
  if (next.charStyles || next.seedStyleRuns || next.value !== next.oldText) return next
  const keyRuns = v.colorRuns.map((r) => ({
    start: r.start,
    end: r.end,
    color: encodeStyle({ color: rgb255ToHex(r.color) }),
  }))
  return {
    ...next,
    charStyles: runsToColors(next.oldText.length, keyRuns),
    seedStyleRuns: keyRuns,
  }
}
