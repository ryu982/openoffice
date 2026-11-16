import { describe, expect, it } from 'vitest'
import {
  changesSheetArrangement,
  createDefaultOptions,
  isDefaultOptions,
  LABEL_PRESETS,
  labelCellCount,
  paperSizePt,
  planSheets,
  PrintLayoutError,
  resolveLabelSpec,
  validateLabelSpec,
  validateOptions,
  type PageSize,
  type PrintLayoutOptions,
} from '../src/plan'

const MM = 72 / 25.4
const A4: PageSize = { widthPt: 210 * MM, heightPt: 297 * MM }
const A4L: PageSize = { widthPt: 297 * MM, heightPt: 210 * MM }

function opts(patch: (o: PrintLayoutOptions) => void): PrintLayoutOptions {
  const o = createDefaultOptions()
  patch(o)
  return o
}

function pages(n: number, size: PageSize = A4): PageSize[] {
  return Array.from({ length: n }, () => ({ ...size }))
}

/** Job page index (1-based for readability) per cell of each output face. */
function layout(plan: ReturnType<typeof planSheets>): Array<Array<number | null>> {
  return plan.output.map((f) => f.cells.map((c) => (c.pageIndex === null ? null : c.pageIndex + 1)))
}

describe('defaults', () => {
  it('pins every default value', () => {
    expect(createDefaultOptions()).toEqual({
      mode: 'single',
      nup: { count: 2, order: 'row' },
      booklet: { binding: 'left' },
      poster: { cols: 2, rows: 2, overlapMm: 10, cutMarks: true },
      labels: {
        fill: 'sequence',
        repeatPage: 1,
        startCell: 1,
        spec: { kind: 'preset', id: LABEL_PRESETS[0].id },
      },
      sides: 'all',
      reverse: false,
      paper: 'source',
      fitToPaper: false,
      grayscale: false,
      dpi: 'auto',
    })
  })

  it('returns a fresh object every time', () => {
    const a = createDefaultOptions()
    a.nup.count = 4
    expect(createDefaultOptions().nup.count).toBe(2)
  })

  it('isDefaultOptions follows exactly the seven route fields', () => {
    expect(isDefaultOptions(createDefaultOptions())).toBe(true)
    // Sub-options of a mode that is not chosen do not leave the default route.
    expect(isDefaultOptions(opts((o) => (o.nup.count = 16)))).toBe(true)
    expect(isDefaultOptions(opts((o) => (o.poster.cols = 3)))).toBe(true)
    const flips: Array<(o: PrintLayoutOptions) => void> = [
      (o) => (o.mode = 'nup'),
      (o) => (o.mode = 'booklet'),
      (o) => (o.mode = 'poster'),
      (o) => (o.mode = 'labels'),
      (o) => (o.sides = 'odd'),
      (o) => (o.sides = 'even'),
      (o) => (o.reverse = true),
      (o) => (o.paper = 'A4'),
      (o) => (o.fitToPaper = true),
      (o) => (o.grayscale = true),
      (o) => (o.dpi = 150),
      (o) => (o.dpi = 300),
      (o) => (o.dpi = 600),
    ]
    for (const flip of flips) expect(isDefaultOptions(opts(flip))).toBe(false)
  })

  it('changesSheetArrangement ignores grayscale and dpi', () => {
    expect(changesSheetArrangement(createDefaultOptions())).toBe(false)
    expect(changesSheetArrangement(opts((o) => (o.grayscale = true)))).toBe(false)
    expect(changesSheetArrangement(opts((o) => (o.dpi = 600)))).toBe(false)
    expect(changesSheetArrangement(opts((o) => (o.mode = 'poster')))).toBe(true)
    expect(changesSheetArrangement(opts((o) => (o.sides = 'even')))).toBe(true)
    expect(changesSheetArrangement(opts((o) => (o.reverse = true)))).toBe(true)
    expect(changesSheetArrangement(opts((o) => (o.paper = 'B5')))).toBe(true)
    expect(
      changesSheetArrangement(
        opts((o) => {
          o.paper = 'A4'
          o.fitToPaper = true
        }),
      ),
    ).toBe(true)
  })
})

describe('validateOptions', () => {
  it('fills missing fields with defaults', () => {
    const r = validateOptions({ mode: 'nup', nup: { count: 4 } }, 3)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.options.mode).toBe('nup')
    expect(r.options.nup).toEqual({ count: 4, order: 'row' })
    expect(r.options.poster).toEqual(createDefaultOptions().poster)
    expect(r.options.dpi).toBe('auto')
  })

  it('accepts every documented value', () => {
    for (const count of [2, 4, 6, 9, 16])
      for (const order of ['row', 'column'])
        expect(validateOptions({ mode: 'nup', nup: { count, order } }, 1).ok).toBe(true)
    for (const paper of ['source', 'A3', 'A4', 'A5', 'B4', 'B5', 'Letter', 'Legal'])
      expect(validateOptions({ paper }, 1).ok).toBe(true)
    for (const dpi of ['auto', 150, 300, 600]) expect(validateOptions({ dpi }, 1).ok).toBe(true)
    for (const sides of ['all', 'odd', 'even']) expect(validateOptions({ sides }, 1).ok).toBe(true)
    expect(validateOptions({ mode: 'poster', poster: { cols: 1, rows: 8 } }, 1).ok).toBe(true)
    expect(validateOptions({ mode: 'poster', poster: { overlapMm: 0 } }, 1).ok).toBe(true)
    expect(validateOptions({ mode: 'poster', poster: { overlapMm: 30 } }, 1).ok).toBe(true)
  })

  const cases: Array<[string, unknown, number, string]> = [
    ['non-object input', 'single', 1, 'invalid-options'],
    ['no job pages', {}, 0, 'no-pages'],
    ['unknown mode', { mode: 'grid' }, 1, 'invalid-mode'],
    ['3-up', { mode: 'nup', nup: { count: 3 } }, 1, 'invalid-nup-count'],
    ['nup order', { mode: 'nup', nup: { order: 'diagonal' } }, 1, 'invalid-nup-order'],
    ['binding', { mode: 'booklet', booklet: { binding: 'top' } }, 1, 'invalid-booklet-binding'],
    ['poster 1x1', { mode: 'poster', poster: { cols: 1, rows: 1 } }, 1, 'poster-single-tile'],
    ['poster 9 cols', { mode: 'poster', poster: { cols: 9 } }, 1, 'poster-tiles-out-of-range'],
    ['poster 0 rows', { mode: 'poster', poster: { rows: 0 } }, 1, 'poster-tiles-out-of-range'],
    ['poster 1.5 rows', { mode: 'poster', poster: { rows: 1.5 } }, 1, 'poster-tiles-out-of-range'],
    ['overlap 31', { mode: 'poster', poster: { overlapMm: 31 } }, 1, 'poster-overlap-out-of-range'],
    ['overlap -1', { mode: 'poster', poster: { overlapMm: -1 } }, 1, 'poster-overlap-out-of-range'],
    ['cut marks', { mode: 'poster', poster: { cutMarks: 'yes' } }, 1, 'invalid-flag'],
    ['label fill', { mode: 'labels', labels: { fill: 'all' } }, 1, 'invalid-label-fill'],
    [
      'repeat page 4 of 3',
      { mode: 'labels', labels: { fill: 'repeat', repeatPage: 4 } },
      3,
      'label-repeat-page-out-of-range',
    ],
    [
      'repeat page 0',
      { mode: 'labels', labels: { fill: 'repeat', repeatPage: 0 } },
      3,
      'label-repeat-page-out-of-range',
    ],
    [
      'start cell 22 of 21',
      { mode: 'labels', labels: { startCell: 22 } },
      1,
      'label-start-cell-out-of-range',
    ],
    [
      'start cell 0',
      { mode: 'labels', labels: { startCell: 0 } },
      1,
      'label-start-cell-out-of-range',
    ],
    [
      'unknown preset',
      { mode: 'labels', labels: { spec: { kind: 'preset', id: 'nope' } } },
      1,
      'label-unknown-preset',
    ],
    ['sides', { sides: 'both' }, 1, 'invalid-sides'],
    ['reverse', { reverse: 1 }, 1, 'invalid-flag'],
    ['paper', { paper: 'A6' }, 1, 'invalid-paper'],
    ['dpi', { dpi: 200 }, 1, 'invalid-dpi'],
    ['grayscale', { grayscale: 'on' }, 1, 'invalid-flag'],
    ['fit without paper', { fitToPaper: true }, 1, 'fit-needs-paper'],
    ['fit with nup', { mode: 'nup', paper: 'A4', fitToPaper: true }, 1, 'fit-needs-single'],
  ]
  for (const [name, input, count, code] of cases) {
    it(`rejects ${name} with ${code}`, () => {
      const r = validateOptions(input, count)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.error.code).toBe(code)
      expect(typeof r.error.message).toBe('string')
    })
  }

  it('checks only the chosen mode sub-options', () => {
    expect(validateOptions({ mode: 'single', poster: { cols: 1, rows: 1 } }, 1).ok).toBe(true)
  })
})

describe('label specs', () => {
  it('every preset fits on its paper and ids are unique', () => {
    expect(LABEL_PRESETS.length).toBeGreaterThan(2)
    const ids = new Set<string>()
    for (const p of LABEL_PRESETS) {
      expect(ids.has(p.id)).toBe(false)
      ids.add(p.id)
      const r = validateLabelSpec(p)
      expect(r.ok, p.id).toBe(true)
    }
  })

  it('starts with the 3 x 7, 63.5 x 38.1 mm grid', () => {
    const first = LABEL_PRESETS[0]
    expect([first.paper, first.cols, first.rows, first.cellWidthMm, first.cellHeightMm]).toEqual([
      'A4',
      3,
      7,
      63.5,
      38.1,
    ])
    expect(labelCellCount(first)).toBe(21)
  })

  const custom = {
    paper: 'A4',
    cols: 2,
    rows: 5,
    cellWidthMm: 90,
    cellHeightMm: 50,
    topMarginMm: 10,
    leftMarginMm: 10,
    hPitchMm: 95,
    vPitchMm: 55,
  }

  it('accepts a custom grid that fits', () => {
    const r = validateLabelSpec(custom)
    expect(r.ok).toBe(true)
    expect(resolveLabelSpec({ kind: 'custom', spec: custom as never })).toEqual(custom)
  })

  const bad: Array<[string, object, string]> = [
    ['pitch below cell width', { hPitchMm: 80 }, 'label-pitch-below-cell'],
    ['pitch below cell height', { vPitchMm: 40 }, 'label-pitch-below-cell'],
    ['too wide for paper', { leftMarginMm: 30 }, 'label-spec-off-paper'],
    ['too tall for paper', { rows: 6 }, 'label-spec-off-paper'],
    ['fits A4 but not the shorter Letter', { paper: 'Letter' }, 'label-spec-off-paper'],
    ['zero columns', { cols: 0 }, 'label-spec-invalid'],
    ['fractional rows', { rows: 2.5 }, 'label-spec-invalid'],
    ['negative margin', { topMarginMm: -1 }, 'label-spec-invalid'],
    ['zero cell', { cellHeightMm: 0 }, 'label-spec-invalid'],
    ['unknown paper', { paper: 'A5' }, 'label-spec-invalid'],
  ]
  for (const [name, patch, code] of bad) {
    it(`rejects ${name}`, () => {
      const r = validateLabelSpec({ ...custom, ...patch })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe(code)
    })
  }

  it('rejects an off-paper custom spec through validateOptions', () => {
    const r = validateOptions(
      {
        mode: 'labels',
        labels: { spec: { kind: 'custom', spec: { ...custom, leftMarginMm: 30 } } },
      },
      1,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('label-spec-off-paper')
  })
})

describe('planSheets', () => {
  it('throws a coded error for invalid options', () => {
    try {
      planSheets(
        pages(1),
        opts((o) => (o.fitToPaper = true)),
      )
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(PrintLayoutError)
      expect((e as PrintLayoutError).code).toBe('fit-needs-paper')
    }
    expect(() => planSheets([{ widthPt: 0, heightPt: 10 }], createDefaultOptions())).toThrow(
      PrintLayoutError,
    )
  })

  it('single + source keeps every page as is', () => {
    const plan = planSheets([A4, A4L], createDefaultOptions())
    expect(plan.output.map((f) => [f.width, f.height])).toEqual([
      [A4.widthPt, A4.heightPt],
      [A4L.widthPt, A4L.heightPt],
    ])
    expect(plan.output[1].cells[0].content).toEqual({
      x: 0,
      y: 0,
      width: A4L.widthPt,
      height: A4L.heightPt,
    })
  })

  it('nup 2 portrait pages: landscape sheet, side by side', () => {
    const plan = planSheets(
      pages(3),
      opts((o) => (o.mode = 'nup')),
    )
    expect(plan.output).toHaveLength(2)
    const f = plan.output[0]
    expect([f.width, f.height]).toEqual([A4.heightPt, A4.widthPt])
    expect(f.cells.map((c) => c.box.x)).toEqual([0, A4.heightPt / 2])
    expect(layout(plan)).toEqual([
      [1, 2],
      [3, null],
    ])
  })

  it('nup 2 landscape pages: portrait sheet, stacked', () => {
    const plan = planSheets(
      pages(2, A4L),
      opts((o) => (o.mode = 'nup')),
    )
    const f = plan.output[0]
    expect([f.width, f.height]).toEqual([A4.widthPt, A4.heightPt])
    expect(f.cells.map((c) => c.box.y)).toEqual([0, A4.heightPt / 2])
  })

  it('nup grids put more cells along the long edge', () => {
    const grid = (count: 2 | 4 | 6 | 9 | 16, size: PageSize) => {
      const f = planSheets(
        pages(count, size),
        opts((o) => {
          o.mode = 'nup'
          o.nup.count = count
        }),
      ).output[0]
      const cols = new Set(f.cells.map((c) => c.box.x)).size
      const rows = new Set(f.cells.map((c) => c.box.y)).size
      return [f.width > f.height ? 'landscape' : 'portrait', cols, rows]
    }
    expect(grid(4, A4)).toEqual(['portrait', 2, 2])
    expect(grid(6, A4)).toEqual(['landscape', 3, 2])
    expect(grid(9, A4)).toEqual(['portrait', 3, 3])
    expect(grid(16, A4)).toEqual(['portrait', 4, 4])
    expect(grid(6, A4L)).toEqual(['portrait', 2, 3])
  })

  it('nup column order fills down first', () => {
    const plan = planSheets(
      pages(4),
      opts((o) => {
        o.mode = 'nup'
        o.nup = { count: 4, order: 'column' }
      }),
    )
    const byPos = plan.output[0].cells
      .slice()
      .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
      .map((c) => c.pageIndex! + 1)
    // reading the grid row by row: 1 3 / 2 4
    expect(byPos).toEqual([1, 3, 2, 4])
  })

  it('booklet 8 pages: [8|1] [2|7] [6|3] [4|5], right binding mirrors', () => {
    const left = planSheets(
      pages(8),
      opts((o) => (o.mode = 'booklet')),
    )
    expect(layout(left)).toEqual([
      [8, 1],
      [2, 7],
      [6, 3],
      [4, 5],
    ])
    expect(left.output.map((f) => f.booklet)).toEqual([
      { sheet: 1, side: 'front' },
      { sheet: 1, side: 'back' },
      { sheet: 2, side: 'front' },
      { sheet: 2, side: 'back' },
    ])
    const right = planSheets(
      pages(8),
      opts((o) => {
        o.mode = 'booklet'
        o.booklet.binding = 'right'
      }),
    )
    expect(layout(right)).toEqual([
      [1, 8],
      [7, 2],
      [3, 6],
      [5, 4],
    ])
  })

  it('booklet pads with blanks at the end', () => {
    expect(
      layout(
        planSheets(
          pages(5),
          opts((o) => (o.mode = 'booklet')),
        ),
      ),
    ).toEqual([
      [null, 1],
      [2, null],
      [null, 3],
      [4, 5],
    ])
    const nine = planSheets(
      pages(9),
      opts((o) => (o.mode = 'booklet')),
    )
    expect(nine.output).toHaveLength(6)
    expect(nine.output[0].cells.map((c) => c.bookletPage)).toEqual([12, 1])
  })

  it('booklet of A4 pages uses an A4 landscape sheet with A5-size pages', () => {
    const f = planSheets(
      pages(4),
      opts((o) => (o.mode = 'booklet')),
    ).output[0]
    expect([f.width, f.height]).toEqual([A4.heightPt, A4.widthPt])
    const c = f.cells[1].content!
    expect(c.width).toBeCloseTo(148.5 * MM, 0)
  })

  it('poster tiles cover the poster row-first with cut marks', () => {
    const plan = planSheets(
      pages(1),
      opts((o) => {
        o.mode = 'poster'
        o.poster = { cols: 3, rows: 2, overlapMm: 10, cutMarks: true }
      }),
    )
    expect(plan.output).toHaveLength(6)
    expect(plan.output.map((f) => [f.poster!.col, f.poster!.row])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ])
    const o = 10 * MM
    const { width: W, height: H } = plan.output[0]
    const first = plan.output[0]
    expect(first.cutMarks).toEqual(
      expect.arrayContaining([
        { x1: W - o, y1: 0, x2: W - o, y2: H },
        { x1: 0, y1: H - o, x2: W, y2: H - o },
      ]),
    )
    expect(first.cutMarks).toHaveLength(2)
    // the last tile has nothing to its right or below
    expect(plan.output[5].cutMarks).toEqual([])
    // the right column only has the bottom mark
    expect(plan.output[2].cutMarks).toEqual([{ x1: 0, y1: H - o, x2: W, y2: H - o }])
    // content shifts by (W - o) per column
    const c0 = plan.output[0].cells[0].content!
    const c1 = plan.output[1].cells[0].content!
    expect(c0.x - c1.x).toBeCloseTo(W - o, 6)
  })

  it('poster without cut marks has none', () => {
    const plan = planSheets(
      pages(1),
      opts((o) => {
        o.mode = 'poster'
        o.poster.cutMarks = false
      }),
    )
    expect(plan.output.every((f) => f.cutMarks.length === 0)).toBe(true)
  })

  it('rejects a poster overlap that does not fit a tiny sheet', () => {
    expect(() =>
      planSheets(
        [{ widthPt: 20 * MM, heightPt: 20 * MM }],
        opts((o) => {
          o.mode = 'poster'
          o.poster.overlapMm = 25
        }),
      ),
    ).toThrow(/poster-overlap-too-large/)
  })

  it('labels sequence and repeat number cells row-first', () => {
    const seq = planSheets(
      pages(4),
      opts((o) => {
        o.mode = 'labels'
        o.labels.startCell = 20
      }),
    )
    expect(seq.output).toHaveLength(2)
    expect(seq.output[0].cells.map((c) => c.labelCell)).toEqual(
      Array.from({ length: 21 }, (_, i) => i + 1),
    )
    expect(layout(seq)[0].slice(18)).toEqual([null, 1, 2])
    expect(layout(seq)[1].slice(0, 3)).toEqual([3, 4, null])
    const rep = planSheets(
      pages(3),
      opts((o) => {
        o.mode = 'labels'
        o.labels = { ...o.labels, fill: 'repeat', repeatPage: 2, startCell: 19 }
      }),
    )
    expect(layout(rep)).toEqual([[...Array(18).fill(null), 2, 2, 2]])
    const spec = resolveLabelSpec(createDefaultOptions().labels.spec)!
    expect(rep.output[0].cells[0].box.x).toBeCloseTo(spec.leftMarginMm * MM, 6)
    expect(rep.output[0].cells[1].box.x).toBeCloseTo((spec.leftMarginMm + spec.hPitchMm) * MM, 6)
  })

  it('sides and reverse act on arranged faces', () => {
    const run = (sides: 'all' | 'odd' | 'even', reverse: boolean) =>
      planSheets(
        pages(5),
        opts((o) => {
          o.sides = sides
          o.reverse = reverse
        }),
      ).output.map((f) => f.face)
    expect(run('odd', false)).toEqual([1, 3, 5])
    expect(run('even', false)).toEqual([2, 4])
    expect(run('all', true)).toEqual([5, 4, 3, 2, 1])
    expect(run('even', true)).toEqual([4, 2])
    const plan = planSheets(
      pages(5),
      opts((o) => (o.sides = 'even')),
    )
    expect(plan.faces).toHaveLength(5)
  })

  it('paper sizes are in points', () => {
    expect(paperSizePt('A4').widthPt).toBeCloseTo(595.28, 1)
    expect(paperSizePt('Letter').widthPt).toBeCloseTo(612, 6)
    expect(paperSizePt('Letter').heightPt).toBeCloseTo(792, 6)
  })
})
