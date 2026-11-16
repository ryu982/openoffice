import { at } from './at'
import { issue, type PrintLayoutIssue } from './errors'
import { mmToPt, type Rect } from './geometry'
import { PAPER_SIZES_MM } from './paper'

export const LABEL_PAPERS = ['A4', 'Letter'] as const
export type LabelPaper = (typeof LABEL_PAPERS)[number]

/**
 * A label sheet grid. Pitches run from the start of one cell to the start of the
 * next, so a pitch equal to the cell size means no gap. Margins are measured
 * from the paper's top and left edges to the first cell.
 */
export interface LabelSpec {
  paper: LabelPaper
  cols: number
  rows: number
  cellWidthMm: number
  cellHeightMm: number
  topMarginMm: number
  leftMarginMm: number
  hPitchMm: number
  vPitchMm: number
}

export interface LabelPreset extends LabelSpec {
  /** Stable key; describes the grid only. */
  id: string
}

/** Which grid the labels use: a preset from `LABEL_PRESETS`, or one typed in. */
export type LabelSpecChoice = { kind: 'preset'; id: string } | { kind: 'custom'; spec: LabelSpec }

/**
 * Common A4 label grids, by cell count and size. Tunable list; the first entry is
 * the one the picker opens on. A test checks that every grid fits its paper.
 */
export const LABEL_PRESETS: readonly LabelPreset[] = [
  {
    id: 'a4-3x7-63.5x38.1',
    paper: 'A4',
    cols: 3,
    rows: 7,
    cellWidthMm: 63.5,
    cellHeightMm: 38.1,
    topMarginMm: 15.15,
    leftMarginMm: 7.21,
    hPitchMm: 66.04,
    vPitchMm: 38.1,
  },
  {
    id: 'a4-2x7-99.1x38.1',
    paper: 'A4',
    cols: 2,
    rows: 7,
    cellWidthMm: 99.1,
    cellHeightMm: 38.1,
    topMarginMm: 15.15,
    leftMarginMm: 4.65,
    hPitchMm: 101.6,
    vPitchMm: 38.1,
  },
  {
    id: 'a4-3x8-63.5x33.9',
    paper: 'A4',
    cols: 3,
    rows: 8,
    cellWidthMm: 63.5,
    cellHeightMm: 33.9,
    topMarginMm: 12.9,
    leftMarginMm: 7.21,
    hPitchMm: 66.04,
    vPitchMm: 33.9,
  },
  {
    id: 'a4-2x8-99.1x33.9',
    paper: 'A4',
    cols: 2,
    rows: 8,
    cellWidthMm: 99.1,
    cellHeightMm: 33.9,
    topMarginMm: 12.9,
    leftMarginMm: 4.65,
    hPitchMm: 101.6,
    vPitchMm: 33.9,
  },
  {
    id: 'a4-2x4-99.1x67.7',
    paper: 'A4',
    cols: 2,
    rows: 4,
    cellWidthMm: 99.1,
    cellHeightMm: 67.7,
    topMarginMm: 13,
    leftMarginMm: 4.65,
    hPitchMm: 101.6,
    vPitchMm: 67.7,
  },
  {
    id: 'a4-5x13-38.1x21.2',
    paper: 'A4',
    cols: 5,
    rows: 13,
    cellWidthMm: 38.1,
    cellHeightMm: 21.2,
    topMarginMm: 10.7,
    leftMarginMm: 4.75,
    hPitchMm: 40.6,
    vPitchMm: 21.2,
  },
  {
    id: 'a4-4x10-52.5x29.7',
    paper: 'A4',
    cols: 4,
    rows: 10,
    cellWidthMm: 52.5,
    cellHeightMm: 29.7,
    topMarginMm: 0,
    leftMarginMm: 0,
    hPitchMm: 52.5,
    vPitchMm: 29.7,
  },
  {
    id: 'a4-2x2-105x148.5',
    paper: 'A4',
    cols: 2,
    rows: 2,
    cellWidthMm: 105,
    cellHeightMm: 148.5,
    topMarginMm: 0,
    leftMarginMm: 0,
    hPitchMm: 105,
    vPitchMm: 148.5,
  },
]

export const DEFAULT_LABEL_PRESET_ID = at(LABEL_PRESETS, 0).id

/** Sums of decimal millimetres drift; a grid that ends this close to the edge still fits. */
const FIT_EPSILON_MM = 1e-6

export type LabelSpecResult = { ok: true; spec: LabelSpec } | { ok: false; error: PrintLayoutIssue }

function positiveInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

function positive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

function nonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

/** Checks a typed-in or preset grid: shape, pitch not below the cell, and the whole grid on the paper. */
export function validateLabelSpec(input: unknown): LabelSpecResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: issue('label-spec-invalid', 'label spec must be an object') }
  }
  const s = input as Record<string, unknown>
  if (typeof s.paper !== 'string' || !(LABEL_PAPERS as readonly string[]).includes(s.paper)) {
    return {
      ok: false,
      error: issue('label-spec-invalid', `unknown label paper ${String(s.paper)}`),
    }
  }
  if (!positiveInteger(s.cols) || !positiveInteger(s.rows)) {
    return {
      ok: false,
      error: issue('label-spec-invalid', 'cols and rows must be positive integers'),
    }
  }
  if (!positive(s.cellWidthMm) || !positive(s.cellHeightMm)) {
    return { ok: false, error: issue('label-spec-invalid', 'cell size must be positive') }
  }
  if (!nonNegative(s.topMarginMm) || !nonNegative(s.leftMarginMm)) {
    return { ok: false, error: issue('label-spec-invalid', 'margins must be zero or more') }
  }
  if (!positive(s.hPitchMm) || !positive(s.vPitchMm)) {
    return { ok: false, error: issue('label-spec-invalid', 'pitches must be positive') }
  }
  const spec: LabelSpec = {
    paper: s.paper as LabelPaper,
    cols: s.cols,
    rows: s.rows,
    cellWidthMm: s.cellWidthMm,
    cellHeightMm: s.cellHeightMm,
    topMarginMm: s.topMarginMm,
    leftMarginMm: s.leftMarginMm,
    hPitchMm: s.hPitchMm,
    vPitchMm: s.vPitchMm,
  }
  if (
    spec.hPitchMm + FIT_EPSILON_MM < spec.cellWidthMm ||
    spec.vPitchMm + FIT_EPSILON_MM < spec.cellHeightMm
  ) {
    return { ok: false, error: issue('label-pitch-below-cell', 'pitch is smaller than the cell') }
  }
  const paper = PAPER_SIZES_MM[spec.paper]
  const right = spec.leftMarginMm + (spec.cols - 1) * spec.hPitchMm + spec.cellWidthMm
  const bottom = spec.topMarginMm + (spec.rows - 1) * spec.vPitchMm + spec.cellHeightMm
  if (right > paper.widthMm + FIT_EPSILON_MM || bottom > paper.heightMm + FIT_EPSILON_MM) {
    return {
      ok: false,
      error: issue(
        'label-spec-off-paper',
        `grid needs ${right.toFixed(2)} x ${bottom.toFixed(2)} mm on ${paper.widthMm} x ${paper.heightMm} mm`,
      ),
    }
  }
  return { ok: true, spec }
}

/** The grid a choice stands for, or undefined for an unknown preset id. Does not validate custom specs. */
export function resolveLabelSpec(choice: LabelSpecChoice): LabelSpec | undefined {
  if (choice.kind === 'custom') return { ...choice.spec }
  const preset = LABEL_PRESETS.find((p) => p.id === choice.id)
  if (!preset) return undefined
  return {
    paper: preset.paper,
    cols: preset.cols,
    rows: preset.rows,
    cellWidthMm: preset.cellWidthMm,
    cellHeightMm: preset.cellHeightMm,
    topMarginMm: preset.topMarginMm,
    leftMarginMm: preset.leftMarginMm,
    hPitchMm: preset.hPitchMm,
    vPitchMm: preset.vPitchMm,
  }
}

export function labelCellCount(spec: LabelSpec): number {
  return spec.cols * spec.rows
}

/** Cell boxes in points, numbered row-first: index 0 is cell 1. */
export function labelCellBoxes(spec: LabelSpec): Rect[] {
  const boxes: Rect[] = []
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) {
      boxes.push({
        x: mmToPt(spec.leftMarginMm + c * spec.hPitchMm),
        y: mmToPt(spec.topMarginMm + r * spec.vPitchMm),
        width: mmToPt(spec.cellWidthMm),
        height: mmToPt(spec.cellHeightMm),
      })
    }
  }
  return boxes
}
