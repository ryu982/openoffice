/**
 * Pure rules of the shared advanced print parts (decision 0141). Editors call
 * these to pick their print route and to couple their own printer fields; the
 * components only lay them out.
 */
import type { Lang } from '@genoffice/i18n'
import {
  changesSheetArrangement,
  isDefaultOptions,
  labelCellCount,
  planSheets,
  PrintLayoutError,
  resolveLabelSpec,
  validateOptions,
  type LabelPreset,
  type LineSegment,
  type PageSize,
  type PrintLayoutIssue,
  type PrintLayoutOptions,
  type Rect,
} from '@genoffice/print-layout/plan'
import { printLayoutText, type PrintLayoutStringKey } from '../strings-print-layout'

/** What an editor tells the shared panel about itself (spec 4.5). */
export interface PrintLayoutCapabilities {
  /** false where the editor already has its own paper and fit fields (sheets, markdown) */
  showPaperAndFit: boolean
  /**
   * Set while the editor's own choice rules out layout modes (slides handouts or
   * notes). The panel keeps one page per sheet and shows this text as the reason.
   */
  layoutBlockedReason?: string | undefined
}

/** Same values as the word editor's duplex field. */
export type PrintLayoutDuplex = 'simplex' | 'longEdge' | 'shortEdge'

/** Progress of a running preview, print or save, counted in pages. */
export interface PrintLayoutProgress {
  done: number
  total: number
}

/** 1-based inclusive page range typed into a print range field. */
export interface PrintPageRange {
  from: number
  to: number
}

/** How many faces the layout diagram draws before it says "+n more". Tunable. */
export const PRINT_LAYOUT_SCHEMATIC_FACES = 4

/**
 * True when the job goes down the new print route (spec 3): one of mode,
 * sides, reverse, paper, fit, grayscale or dpi is off its default. False keeps
 * the editor's current print call and arguments unchanged.
 */
export function takesNewPrintRoute(options: PrintLayoutOptions): boolean {
  return !isDefaultOptions(options)
}

/**
 * True when an editor with its own preview swaps it for the layout diagram
 * (spec 4.7): the faces differ from the job's pages. Grayscale and dpi alone
 * keep the editor's preview.
 */
export function showsLayoutSchematic(options: PrintLayoutOptions): boolean {
  return changesSheetArrangement(options)
}

/** True while the editor's collate field must stay on and locked (spec 4.6). */
export function isCollateLocked(options: PrintLayoutOptions): boolean {
  return takesNewPrintRoute(options)
}

/** The collate value to send: forced on while any option is on, else the user's choice. */
export function effectiveCollate(options: PrintLayoutOptions, collate: boolean): boolean {
  return isCollateLocked(options) ? true : collate
}

/**
 * Duplex an option forces in an editor with its own duplex field (spec 4.6).
 * Odd/even means the user turns the sheets by hand, so it wins over booklet.
 */
export function forcedDuplex(options: PrintLayoutOptions): PrintLayoutDuplex | null {
  if (options.sides !== 'all') return 'simplex'
  if (options.mode === 'booklet') return 'shortEdge'
  return null
}

/**
 * The editor's duplex value plus what to restore when the forcing options go
 * off. `restore` is null when there is nothing to restore: no option forces
 * duplex, or the user changed duplex while one did.
 */
export interface DuplexCoupling {
  duplex: PrintLayoutDuplex
  restore: PrintLayoutDuplex | null
}

export function createDuplexCoupling(duplex: PrintLayoutDuplex): DuplexCoupling {
  return { duplex, restore: null }
}

/** Applies a change of panel options to the editor's duplex value. */
export function coupleDuplex(
  state: DuplexCoupling,
  previous: PrintLayoutOptions,
  next: PrintLayoutOptions,
): DuplexCoupling {
  const before = forcedDuplex(previous)
  const after = forcedDuplex(next)
  if (before === after) return state
  if (after !== null) {
    // Entering a forced state keeps the value to come back to; moving between
    // two forced states keeps whatever was kept before.
    return { duplex: after, restore: before === null ? state.duplex : state.restore }
  }
  if (state.restore !== null) return { duplex: state.restore, restore: null }
  return { duplex: state.duplex, restore: null }
}

/** The user picked a duplex value; nothing is restored later. */
export function setDuplexByUser(_state: DuplexCoupling, duplex: PrintLayoutDuplex): DuplexCoupling {
  return { duplex, restore: null }
}

/**
 * Fixes options the panel must not hold: paper and fit where the editor hides
 * them, fit without a chosen paper or with a mode other than single, and any
 * layout mode while the editor blocks them. Returns the same object when
 * nothing changes.
 */
export function normalizePanelOptions(
  options: PrintLayoutOptions,
  capabilities: PrintLayoutCapabilities,
): PrintLayoutOptions {
  let o = options
  if (capabilities.layoutBlockedReason && o.mode !== 'single') o = { ...o, mode: 'single' }
  if (!capabilities.showPaperAndFit && (o.paper !== 'source' || o.fitToPaper)) {
    o = { ...o, paper: 'source', fitToPaper: false }
  }
  if (o.fitToPaper && (o.paper === 'source' || o.mode !== 'single')) o = { ...o, fitToPaper: false }
  return o
}

/**
 * Why these options cannot print this job, or null. `pages` null means the
 * job's pages are not known yet (an editor still counting them).
 */
export function printLayoutProblem(
  options: PrintLayoutOptions,
  pages: readonly PageSize[] | null,
): PrintLayoutIssue | null {
  if (!pages || pages.length === 0) return null
  const checked = validateOptions(options, pages.length)
  if (!checked.ok) return checked.error
  try {
    const plan = planSheets(pages, checked.options)
    if (plan.output.length === 0) return { code: 'no-faces', message: 'no faces left to print' }
  } catch (e) {
    if (e instanceof PrintLayoutError) return e.toIssue()
    throw e
  }
  return null
}

const ISSUE_KEYS: Partial<Record<PrintLayoutIssue['code'], PrintLayoutStringKey>> = {
  'poster-single-tile': 'issuePosterSingleTile',
  'poster-tiles-out-of-range': 'issuePosterTiles',
  'poster-overlap-out-of-range': 'issuePosterOverlap',
  'poster-overlap-too-large': 'issuePosterOverlapLarge',
  'label-repeat-page-out-of-range': 'issueLabelRepeatPage',
  'label-start-cell-out-of-range': 'issueLabelStartCell',
  'label-spec-invalid': 'issueLabelSpecInvalid',
  'label-pitch-below-cell': 'issueLabelPitch',
  'label-spec-off-paper': 'issueLabelOffPaper',
  'no-faces': 'issueNoFaces',
}

/**
 * The reason for an issue in the user's language. `pageCount` and `cellCount`
 * fill the upper bound of the repeat page and start cell reasons.
 */
export function printLayoutIssueText(
  lang: Lang,
  issue: PrintLayoutIssue,
  context: { pageCount?: number | undefined; cellCount?: number | undefined } = {},
): string {
  const key = ISSUE_KEYS[issue.code] ?? 'issueGeneric'
  const max =
    issue.code === 'label-repeat-page-out-of-range'
      ? context.pageCount
      : issue.code === 'label-start-cell-out-of-range'
        ? context.cellCount
        : undefined
  return printLayoutText(lang, key, max === undefined ? undefined : { max })
}

/** The label sheet cell count for the options' spec, or undefined for an unusable spec. */
export function labelCellsOf(options: PrintLayoutOptions): number | undefined {
  const spec = resolveLabelSpec(options.labels.spec)
  if (!spec || !(spec.cols > 0 && spec.rows > 0)) return undefined
  return labelCellCount(spec)
}

const mm = (n: number): string => String(Math.round(n * 100) / 100)

/** A preset's name in the list: cell count, grid and size only. */
export function labelPresetText(lang: Lang, preset: LabelPreset): string {
  return printLayoutText(lang, 'labelPreset', {
    cells: preset.cols * preset.rows,
    cols: preset.cols,
    rows: preset.rows,
    width: mm(preset.cellWidthMm),
    height: mm(preset.cellHeightMm),
  })
}

/**
 * Reads "1-3, 5" into ranges. Accepts hyphen and en dash, ignores spaces.
 * Returns null for empty text, zero, reversed or malformed parts.
 */
export function parsePrintRanges(text: string): PrintPageRange[] | null {
  const parts = text.split(',').map((p) => p.trim())
  if (parts.length === 0 || parts.some((p) => p === '')) return null
  const out: PrintPageRange[] = []
  for (const part of parts) {
    const m = /^(\d+)\s*(?:[-–]\s*(\d+))?$/.exec(part)
    if (!m) return null
    const from = Number(m[1])
    const to = m[2] === undefined ? from : Number(m[2])
    if (from < 1 || to < from) return null
    out.push({ from, to })
  }
  return out
}

/** One cell of a face in the layout diagram, in face points (top-left origin). */
export interface SchematicCell {
  box: Rect
  /** where the whole page sits; may run past the face (poster pieces) */
  content: Rect | null
  /** 1-based job page, or null for an empty cell */
  page: number | null
  /** a booklet page added to reach a multiple of four */
  blank: boolean
  labelCell?: number | undefined
  /** a label cell before the start cell on the first sheet (already used) */
  skipped: boolean
  /** the label start cell */
  start: boolean
}

export interface SchematicFace {
  /** 1-based arranged face number */
  face: number
  width: number
  height: number
  /** dropped by the odd/even filter */
  excluded: boolean
  /** 1-based place in the printed order, or null when excluded */
  printOrder: number | null
  booklet?: { sheet: number; side: 'front' | 'back' } | undefined
  poster?: { page: number; piece: number; pieces: number } | undefined
  cells: SchematicCell[]
  cutMarks: LineSegment[]
}

export interface SchematicView {
  /** the first faces, in arranged order */
  faces: SchematicFace[]
  /** every arranged face */
  totalFaces: number
  /** faces that print after the odd/even filter */
  printedFaces: number
  /** why nothing can be drawn, or null */
  issue: PrintLayoutIssue | null
}

/** What the layout diagram draws: the first `maxFaces` arranged faces of the plan. */
export function layoutSchematic(
  pages: readonly PageSize[],
  options: PrintLayoutOptions,
  maxFaces: number = PRINT_LAYOUT_SCHEMATIC_FACES,
): SchematicView {
  const empty = (issue: PrintLayoutIssue | null): SchematicView => ({
    faces: [],
    totalFaces: 0,
    printedFaces: 0,
    issue,
  })
  if (pages.length === 0) return empty(null)
  const checked = validateOptions(options, pages.length)
  if (!checked.ok) return empty(checked.error)
  let plan: ReturnType<typeof planSheets>
  try {
    plan = planSheets(pages, checked.options)
  } catch (e) {
    if (e instanceof PrintLayoutError) return empty(e.toIssue())
    throw e
  }
  const o = checked.options
  const order = new Map(plan.output.map((f, i) => [f.face, i + 1]))
  const startCell = o.mode === 'labels' ? o.labels.startCell : 0
  const faces = plan.faces.slice(0, Math.max(0, maxFaces)).map((f): SchematicFace => {
    const firstLabelSheet = o.mode === 'labels' && f.face === 1
    return {
      face: f.face,
      width: f.width,
      height: f.height,
      excluded: !order.has(f.face),
      printOrder: order.get(f.face) ?? null,
      booklet: f.booklet,
      poster: f.poster && {
        page: f.poster.pageIndex + 1,
        piece: f.poster.row * f.poster.cols + f.poster.col + 1,
        pieces: f.poster.cols * f.poster.rows,
      },
      cells: f.cells.map((c) => ({
        box: c.box,
        content: c.content,
        page: c.pageIndex === null ? null : c.pageIndex + 1,
        blank: c.pageIndex === null && c.bookletPage !== undefined,
        labelCell: c.labelCell,
        skipped: firstLabelSheet && c.labelCell !== undefined && c.labelCell < startCell,
        start: firstLabelSheet && c.labelCell === startCell,
      })),
      cutMarks: f.cutMarks,
    }
  })
  return { faces, totalFaces: plan.faces.length, printedFaces: plan.output.length, issue: null }
}
