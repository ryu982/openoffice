import { issue, type PrintLayoutIssue } from './errors'
import {
  DEFAULT_LABEL_PRESET_ID,
  labelCellCount,
  resolveLabelSpec,
  validateLabelSpec,
  type LabelSpecChoice,
} from './labels'
import { isPaperName, type PaperName } from './paper'

export const LAYOUT_MODES = ['single', 'nup', 'booklet', 'poster', 'labels'] as const
export type LayoutMode = (typeof LAYOUT_MODES)[number]

export const NUP_COUNTS = [2, 4, 6, 9, 16] as const
export type NupCount = (typeof NUP_COUNTS)[number]

/** `row`: left to right, then top to bottom. `column`: top to bottom, then left to right. */
export const NUP_ORDERS = ['row', 'column'] as const
export type NupOrder = (typeof NUP_ORDERS)[number]

export const BOOKLET_BINDINGS = ['left', 'right'] as const
export type BookletBinding = (typeof BOOKLET_BINDINGS)[number]

export const LABEL_FILLS = ['repeat', 'sequence'] as const
export type LabelFill = (typeof LABEL_FILLS)[number]

/** Face filter; faces count from 1 in the arranged output, not by document page. */
export const SIDES_FILTERS = ['all', 'odd', 'even'] as const
export type SidesFilter = (typeof SIDES_FILTERS)[number]

/** `source` keeps the job's own page size. */
export type PaperChoice = 'source' | PaperName

export const DPI_CHOICES = ['auto', 150, 300, 600] as const
export type DpiChoice = (typeof DPI_CHOICES)[number]

export const POSTER_TILES_MIN = 1
export const POSTER_TILES_MAX = 8
export const POSTER_OVERLAP_MM_MIN = 0
export const POSTER_OVERLAP_MM_MAX = 30

export interface NupOptions {
  count: NupCount
  order: NupOrder
}

export interface BookletOptions {
  binding: BookletBinding
}

export interface PosterOptions {
  /** sheets across, 1-8 */
  cols: number
  /** sheets down, 1-8; cols x rows must be more than one sheet */
  rows: number
  /** 0-30 mm */
  overlapMm: number
  cutMarks: boolean
}

export interface LabelOptions {
  fill: LabelFill
  /** 1-based job page used by `repeat`; at most the job page count */
  repeatPage: number
  /** 1-based first cell on the first sheet; cells count row-first */
  startCell: number
  spec: LabelSpecChoice
}

/**
 * Every option of the shared page layout panel. All sub-option groups are always
 * present; only the group of the chosen `mode` takes effect.
 */
export interface PrintLayoutOptions {
  mode: LayoutMode
  nup: NupOptions
  booklet: BookletOptions
  poster: PosterOptions
  labels: LabelOptions
  sides: SidesFilter
  reverse: boolean
  paper: PaperChoice
  /** shrink pages larger than `paper`; only with mode `single` and a chosen paper */
  fitToPaper: boolean
  grayscale: boolean
  dpi: DpiChoice
}

/** A fresh default set; the panel starts from this every time it opens. */
export function createDefaultOptions(): PrintLayoutOptions {
  return {
    mode: 'single',
    nup: { count: 2, order: 'row' },
    booklet: { binding: 'left' },
    poster: { cols: 2, rows: 2, overlapMm: 10, cutMarks: true },
    labels: {
      fill: 'sequence',
      repeatPage: 1,
      startCell: 1,
      spec: { kind: 'preset', id: DEFAULT_LABEL_PRESET_ID },
    },
    sides: 'all',
    reverse: false,
    paper: 'source',
    fitToPaper: false,
    grayscale: false,
    dpi: 'auto',
  }
}

/**
 * True when nothing sends the job down the new print route: mode, sides,
 * reverse, paper, fit, grayscale and dpi are all at their defaults. Sub-options
 * of a mode that is not chosen do not count.
 */
export function isDefaultOptions(o: PrintLayoutOptions): boolean {
  return (
    o.mode === 'single' &&
    o.sides === 'all' &&
    !o.reverse &&
    o.paper === 'source' &&
    !o.fitToPaper &&
    !o.grayscale &&
    o.dpi === 'auto'
  )
}

/**
 * True when the faces differ from the job's pages (mode, sides, reverse, paper,
 * fit). Grayscale and dpi alone keep the arrangement, so an editor keeps its own
 * preview and the arranged PDF equals the job PDF.
 */
export function changesSheetArrangement(o: PrintLayoutOptions): boolean {
  return (
    o.mode !== 'single' || o.sides !== 'all' || o.reverse || o.paper !== 'source' || o.fitToPaper
  )
}

export type OptionsResult =
  { ok: true; options: PrintLayoutOptions } | { ok: false; error: PrintLayoutIssue }

class Invalid {
  constructor(readonly issue: PrintLayoutIssue) {}
}

function fail(code: PrintLayoutIssue['code'], message: string): never {
  throw new Invalid(issue(code, message))
}

function record(v: unknown, name: string): Record<string, unknown> {
  if (v === undefined) return {}
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    fail('invalid-options', `${name} must be an object`)
  }
  return v as Record<string, unknown>
}

function pick<T>(
  v: unknown,
  fallback: T,
  allowed: readonly T[],
  code: PrintLayoutIssue['code'],
  name: string,
): T {
  if (v === undefined) return fallback
  if (!(allowed as readonly unknown[]).includes(v)) fail(code, `${name} cannot be ${String(v)}`)
  return v as T
}

function flag(v: unknown, fallback: boolean, name: string): boolean {
  if (v === undefined) return fallback
  if (typeof v !== 'boolean') fail('invalid-flag', `${name} must be true or false`)
  return v
}

/** Strict read for the chosen mode: missing takes the default, anything else is kept for the range check. */
function strictNum(v: unknown, fallback: number): number {
  if (v === undefined) return fallback
  return typeof v === 'number' ? v : NaN
}

/** Lenient read for modes that are not chosen: unusable values fall back to the default. */
function looseNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function isSpecChoiceShape(v: unknown): v is LabelSpecChoice {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return (
    (c.kind === 'preset' && typeof c.id === 'string') ||
    (c.kind === 'custom' && typeof c.spec === 'object' && c.spec !== null)
  )
}

function normalize(input: unknown, jobPageCount: number): PrintLayoutOptions {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail('invalid-options', 'options must be an object')
  }
  if (!Number.isInteger(jobPageCount) || jobPageCount < 1) {
    fail('no-pages', 'the print job has no pages')
  }
  const d = createDefaultOptions()
  const i = input as Record<string, unknown>
  const nupIn = record(i.nup, 'nup')
  const bookletIn = record(i.booklet, 'booklet')
  const posterIn = record(i.poster, 'poster')
  const labelsIn = record(i.labels, 'labels')

  const mode = pick(i.mode, d.mode, LAYOUT_MODES, 'invalid-mode', 'mode')
  const sides = pick(i.sides, d.sides, SIDES_FILTERS, 'invalid-sides', 'sides')
  const reverse = flag(i.reverse, d.reverse, 'reverse')
  let paper: PaperChoice = d.paper
  if (i.paper !== undefined) {
    if (i.paper !== 'source' && !isPaperName(i.paper)) {
      fail('invalid-paper', `paper cannot be ${String(i.paper)}`)
    }
    paper = i.paper as PaperChoice
  }
  const fitToPaper = flag(i.fitToPaper, d.fitToPaper, 'fitToPaper')
  const grayscale = flag(i.grayscale, d.grayscale, 'grayscale')
  const dpi = pick(i.dpi, d.dpi, DPI_CHOICES, 'invalid-dpi', 'dpi')

  const nup: NupOptions = { ...d.nup }
  const booklet: BookletOptions = { ...d.booklet }
  const posterNum = mode === 'poster' ? strictNum : looseNum
  const poster: PosterOptions = {
    cols: posterNum(posterIn.cols, d.poster.cols),
    rows: posterNum(posterIn.rows, d.poster.rows),
    overlapMm: posterNum(posterIn.overlapMm, d.poster.overlapMm),
    cutMarks: typeof posterIn.cutMarks === 'boolean' ? posterIn.cutMarks : d.poster.cutMarks,
  }
  const labelNum = mode === 'labels' ? strictNum : looseNum
  const labels: LabelOptions = {
    fill: d.labels.fill,
    repeatPage: labelNum(labelsIn.repeatPage, d.labels.repeatPage),
    startCell: labelNum(labelsIn.startCell, d.labels.startCell),
    spec: d.labels.spec,
  }
  if (labelsIn.spec !== undefined && mode === 'labels')
    labels.spec = labelsIn.spec as LabelSpecChoice
  else if (isSpecChoiceShape(labelsIn.spec)) labels.spec = labelsIn.spec

  // Only the chosen mode's group is checked strictly; the others are carried
  // through as given so the panel keeps them when the user switches back.
  if (mode === 'nup') {
    nup.count = pick(nupIn.count, d.nup.count, NUP_COUNTS, 'invalid-nup-count', 'nup.count')
    nup.order = pick(nupIn.order, d.nup.order, NUP_ORDERS, 'invalid-nup-order', 'nup.order')
  } else {
    if ((NUP_COUNTS as readonly unknown[]).includes(nupIn.count))
      nup.count = nupIn.count as NupCount
    if ((NUP_ORDERS as readonly unknown[]).includes(nupIn.order))
      nup.order = nupIn.order as NupOrder
  }

  if (mode === 'booklet') {
    booklet.binding = pick(
      bookletIn.binding,
      d.booklet.binding,
      BOOKLET_BINDINGS,
      'invalid-booklet-binding',
      'booklet.binding',
    )
  } else if ((BOOKLET_BINDINGS as readonly unknown[]).includes(bookletIn.binding)) {
    booklet.binding = bookletIn.binding as BookletBinding
  }

  if (mode === 'poster') {
    for (const [name, v] of [
      ['poster.cols', poster.cols],
      ['poster.rows', poster.rows],
    ] as const) {
      if (!Number.isInteger(v) || v < POSTER_TILES_MIN || v > POSTER_TILES_MAX) {
        fail('poster-tiles-out-of-range', `${name} must be a whole number from 1 to 8`)
      }
    }
    if (poster.cols * poster.rows === 1)
      fail('poster-single-tile', 'a poster needs more than one sheet')
    if (
      !Number.isFinite(poster.overlapMm) ||
      poster.overlapMm < POSTER_OVERLAP_MM_MIN ||
      poster.overlapMm > POSTER_OVERLAP_MM_MAX
    ) {
      fail('poster-overlap-out-of-range', 'poster.overlapMm must be from 0 to 30')
    }
    poster.cutMarks = flag(posterIn.cutMarks, d.poster.cutMarks, 'poster.cutMarks')
  }

  if (mode === 'labels') {
    labels.fill = pick(
      labelsIn.fill,
      d.labels.fill,
      LABEL_FILLS,
      'invalid-label-fill',
      'labels.fill',
    )
    const choice = record(labels.spec, 'labels.spec')
    let cells: number
    if (choice.kind === 'preset') {
      const spec =
        typeof choice.id === 'string'
          ? resolveLabelSpec({ kind: 'preset', id: choice.id })
          : undefined
      if (!spec) fail('label-unknown-preset', `no label preset ${String(choice.id)}`)
      labels.spec = { kind: 'preset', id: choice.id as string }
      cells = labelCellCount(spec)
    } else if (choice.kind === 'custom') {
      const r = validateLabelSpec(choice.spec)
      if (!r.ok) throw new Invalid(r.error)
      labels.spec = { kind: 'custom', spec: r.spec }
      cells = labelCellCount(r.spec)
    } else {
      fail('label-spec-invalid', 'labels.spec.kind must be preset or custom')
    }
    if (!Number.isInteger(labels.startCell) || labels.startCell < 1 || labels.startCell > cells) {
      fail('label-start-cell-out-of-range', `labels.startCell must be from 1 to ${cells}`)
    }
    if (
      labels.fill === 'repeat' &&
      (!Number.isInteger(labels.repeatPage) ||
        labels.repeatPage < 1 ||
        labels.repeatPage > jobPageCount)
    ) {
      fail('label-repeat-page-out-of-range', `labels.repeatPage must be from 1 to ${jobPageCount}`)
    }
  } else if ((LABEL_FILLS as readonly unknown[]).includes(labelsIn.fill)) {
    labels.fill = labelsIn.fill as LabelFill
  }

  if (fitToPaper && paper === 'source') fail('fit-needs-paper', 'fitToPaper needs a chosen paper')
  if (fitToPaper && mode !== 'single')
    fail('fit-needs-single', 'fitToPaper only applies to one page per sheet')

  return { mode, nup, booklet, poster, labels, sides, reverse, paper, fitToPaper, grayscale, dpi }
}

/**
 * Checks options (for example from the screen over IPC) against a job of
 * `jobPageCount` pages. Missing fields take their defaults. Never throws.
 */
export function validateOptions(input: unknown, jobPageCount: number): OptionsResult {
  try {
    return { ok: true, options: normalize(input, jobPageCount) }
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.issue }
    throw e
  }
}
