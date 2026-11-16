import { describe, expect, it } from 'vitest'
import {
  createDefaultOptions,
  LABEL_PRESETS,
  type PageSize,
  type PrintLayoutOptions,
} from '@genoffice/print-layout/plan'
import {
  coupleDuplex,
  createDuplexCoupling,
  effectiveCollate,
  forcedDuplex,
  isCollateLocked,
  labelPresetText,
  layoutSchematic,
  normalizePanelOptions,
  parsePrintRanges,
  printLayoutIssueText,
  printLayoutProblem,
  PRINT_LAYOUT_SCHEMATIC_FACES,
  setDuplexByUser,
  showsLayoutSchematic,
  takesNewPrintRoute,
} from '../src/print-layout/model'

const A4: PageSize = { widthPt: 595.28, heightPt: 841.89 }
const pages = (n: number): PageSize[] => Array.from({ length: n }, () => ({ ...A4 }))

function opts(patch: (o: PrintLayoutOptions) => void): PrintLayoutOptions {
  const o = createDefaultOptions()
  patch(o)
  return o
}

describe('route helpers', () => {
  it('takes the current print path only when the seven route fields are default', () => {
    expect(takesNewPrintRoute(createDefaultOptions())).toBe(false)
    expect(takesNewPrintRoute(opts((o) => (o.dpi = 300)))).toBe(true)
    expect(takesNewPrintRoute(opts((o) => (o.grayscale = true)))).toBe(true)
    expect(takesNewPrintRoute(opts((o) => (o.reverse = true)))).toBe(true)
    // a sub-option of a mode that is not chosen does not count
    expect(takesNewPrintRoute(opts((o) => (o.nup.count = 9)))).toBe(false)
  })

  it('swaps an editor preview for the schematic only when the faces change', () => {
    expect(showsLayoutSchematic(createDefaultOptions())).toBe(false)
    expect(showsLayoutSchematic(opts((o) => (o.grayscale = true)))).toBe(false)
    expect(showsLayoutSchematic(opts((o) => (o.dpi = 600)))).toBe(false)
    expect(showsLayoutSchematic(opts((o) => (o.sides = 'odd')))).toBe(true)
    expect(showsLayoutSchematic(opts((o) => (o.mode = 'booklet')))).toBe(true)
    expect(showsLayoutSchematic(opts((o) => (o.paper = 'A4')))).toBe(true)
  })

  it('forces collate on while any option is on', () => {
    const plain = createDefaultOptions()
    expect(isCollateLocked(plain)).toBe(false)
    expect(effectiveCollate(plain, false)).toBe(false)
    expect(effectiveCollate(plain, true)).toBe(true)
    const gray = opts((o) => (o.grayscale = true))
    expect(isCollateLocked(gray)).toBe(true)
    expect(effectiveCollate(gray, false)).toBe(true)
  })
})

describe('duplex coupling (word)', () => {
  const plain = createDefaultOptions()
  const odd = opts((o) => (o.sides = 'odd'))
  const even = opts((o) => (o.sides = 'even'))
  const booklet = opts((o) => (o.mode = 'booklet'))

  it('names the forced value', () => {
    expect(forcedDuplex(plain)).toBeNull()
    expect(forcedDuplex(odd)).toBe('simplex')
    expect(forcedDuplex(even)).toBe('simplex')
    expect(forcedDuplex(booklet)).toBe('shortEdge')
    // printing one side of the sheets by hand: odd/even wins over booklet
    expect(forcedDuplex(opts((o) => ((o.mode = 'booklet'), (o.sides = 'odd'))))).toBe('simplex')
  })

  it('turns duplex off for odd/even and restores it afterwards', () => {
    let s = createDuplexCoupling('longEdge')
    s = coupleDuplex(s, plain, odd)
    expect(s.duplex).toBe('simplex')
    s = coupleDuplex(s, odd, even)
    expect(s.duplex).toBe('simplex')
    s = coupleDuplex(s, even, plain)
    expect(s.duplex).toBe('longEdge')
  })

  it('sets short edge for booklet and restores the earlier value', () => {
    let s = createDuplexCoupling('simplex')
    s = coupleDuplex(s, plain, booklet)
    expect(s.duplex).toBe('shortEdge')
    s = coupleDuplex(s, booklet, plain)
    expect(s.duplex).toBe('simplex')
  })

  it('keeps the original value through a change from one forcing option to another', () => {
    let s = createDuplexCoupling('longEdge')
    s = coupleDuplex(s, plain, booklet)
    s = coupleDuplex(s, booklet, odd)
    expect(s.duplex).toBe('simplex')
    s = coupleDuplex(s, odd, plain)
    expect(s.duplex).toBe('longEdge')
  })

  it('does not restore when the user changed duplex in between', () => {
    let s = createDuplexCoupling('longEdge')
    s = coupleDuplex(s, plain, booklet)
    s = setDuplexByUser(s, 'longEdge')
    s = coupleDuplex(s, booklet, plain)
    expect(s.duplex).toBe('longEdge')

    let t = createDuplexCoupling('shortEdge')
    t = coupleDuplex(t, plain, odd)
    t = setDuplexByUser(t, 'longEdge')
    t = coupleDuplex(t, odd, plain)
    expect(t.duplex).toBe('longEdge')
  })

  it('leaves duplex alone for options that do not force it', () => {
    let s = createDuplexCoupling('longEdge')
    s = coupleDuplex(
      s,
      plain,
      opts((o) => (o.grayscale = true)),
    )
    expect(s.duplex).toBe('longEdge')
    s = setDuplexByUser(s, 'shortEdge')
    s = coupleDuplex(s, plain, plain)
    expect(s.duplex).toBe('shortEdge')
  })
})

describe('normalizePanelOptions', () => {
  const caps = { showPaperAndFit: true }

  it('clears fit when no paper is chosen or the mode is not single', () => {
    const noPaper = normalizePanelOptions(
      opts((o) => (o.fitToPaper = true)),
      caps,
    )
    expect(noPaper.fitToPaper).toBe(false)
    const nup = normalizePanelOptions(
      opts((o) => ((o.paper = 'A4'), (o.fitToPaper = true), (o.mode = 'nup'))),
      caps,
    )
    expect(nup.fitToPaper).toBe(false)
    expect(nup.paper).toBe('A4')
    const kept = normalizePanelOptions(
      opts((o) => ((o.paper = 'A4'), (o.fitToPaper = true))),
      caps,
    )
    expect(kept.fitToPaper).toBe(true)
  })

  it('drops paper and fit when the editor hides them', () => {
    const o = normalizePanelOptions(
      opts((o) => ((o.paper = 'A3'), (o.fitToPaper = true))),
      { showPaperAndFit: false },
    )
    expect(o.paper).toBe('source')
    expect(o.fitToPaper).toBe(false)
  })

  it('keeps one page per sheet while layout modes are blocked', () => {
    const o = normalizePanelOptions(
      opts((o) => ((o.mode = 'poster'), (o.sides = 'even'))),
      { showPaperAndFit: true, layoutBlockedReason: 'handouts' },
    )
    expect(o.mode).toBe('single')
    expect(o.sides).toBe('even')
  })

  it('returns the same object when nothing needs fixing', () => {
    const o = createDefaultOptions()
    expect(normalizePanelOptions(o, caps)).toBe(o)
  })
})

describe('printLayoutProblem', () => {
  it('is null for printable options', () => {
    expect(printLayoutProblem(createDefaultOptions(), pages(3))).toBeNull()
  })

  it('reports option and plan problems by code', () => {
    expect(
      printLayoutProblem(
        opts((o) => ((o.mode = 'poster'), (o.poster.cols = 1), (o.poster.rows = 1))),
        pages(1),
      )?.code,
    ).toBe('poster-single-tile')
    expect(
      printLayoutProblem(
        opts((o) => ((o.mode = 'labels'), (o.labels.fill = 'repeat'), (o.labels.repeatPage = 4))),
        pages(3),
      )?.code,
    ).toBe('label-repeat-page-out-of-range')
    // one page, even faces only: nothing left to print
    expect(
      printLayoutProblem(
        opts((o) => (o.sides = 'even')),
        pages(1),
      )?.code,
    ).toBe('no-faces')
  })

  it('reads a job with no known pages as printable for now', () => {
    expect(printLayoutProblem(createDefaultOptions(), null)).toBeNull()
  })
})

describe('printLayoutIssueText', () => {
  it('turns a code into a translated reason with its numbers', () => {
    expect(
      printLayoutIssueText(
        'ko',
        { code: 'label-start-cell-out-of-range', message: '' },
        {
          cellCount: 21,
        },
      ),
    ).toBe('시작 칸은 1에서 21까지 고를 수 있습니다.')
    expect(printLayoutIssueText('en', { code: 'label-spec-off-paper', message: '' })).toMatch(
      /paper/,
    )
    expect(printLayoutIssueText('en', { code: 'invalid-dpi', message: 'x' })).toBe(
      printLayoutIssueText('en', { code: 'invalid-options', message: 'y' }),
    )
  })
})

describe('labelPresetText', () => {
  it('names a grid by cell count and size only', () => {
    expect(labelPresetText('en', LABEL_PRESETS[0])).toBe('21 labels (3 × 7) · 63.5 × 38.1 mm')
    expect(labelPresetText('ko', LABEL_PRESETS[0])).toBe('21칸(3×7) · 63.5×38.1mm')
  })
})

describe('parsePrintRanges', () => {
  it('reads page lists and ranges', () => {
    expect(parsePrintRanges('1-3, 5')).toEqual([
      { from: 1, to: 3 },
      { from: 5, to: 5 },
    ])
    expect(parsePrintRanges(' 7 ')).toEqual([{ from: 7, to: 7 }])
    expect(parsePrintRanges('2–4')).toEqual([{ from: 2, to: 4 }])
  })

  it('rejects empty, reversed and malformed text', () => {
    expect(parsePrintRanges('')).toBeNull()
    expect(parsePrintRanges('3-1')).toBeNull()
    expect(parsePrintRanges('0')).toBeNull()
    expect(parsePrintRanges('a-b')).toBeNull()
    expect(parsePrintRanges('1,,2')).toBeNull()
  })
})

describe('layoutSchematic', () => {
  it('numbers an 8-page booklet front and back', () => {
    const view = layoutSchematic(
      pages(8),
      opts((o) => (o.mode = 'booklet')),
    )
    expect(view.issue).toBeNull()
    expect(view.totalFaces).toBe(4)
    expect(view.faces.map((f) => f.cells.map((c) => c.page))).toEqual([
      [8, 1],
      [2, 7],
      [6, 3],
      [4, 5],
    ])
    expect(view.faces.map((f) => f.booklet)).toEqual([
      { sheet: 1, side: 'front' },
      { sheet: 1, side: 'back' },
      { sheet: 2, side: 'front' },
      { sheet: 2, side: 'back' },
    ])
  })

  it('shows the blank pages a 5-page booklet adds', () => {
    const view = layoutSchematic(
      pages(5),
      opts((o) => (o.mode = 'booklet')),
    )
    expect(view.faces[0]!.cells.map((c) => c.page)).toEqual([null, 1])
    expect(view.faces[0]!.cells[0]!.blank).toBe(true)
  })

  it('marks the faces the odd/even filter drops and counts the rest', () => {
    const view = layoutSchematic(
      pages(5),
      opts((o) => (o.sides = 'odd')),
    )
    expect(view.faces.map((f) => f.excluded)).toEqual([false, true, false, true])
    expect(view.totalFaces).toBe(5)
    expect(view.printedFaces).toBe(3)
    expect(view.faces.length).toBe(PRINT_LAYOUT_SCHEMATIC_FACES)
  })

  it('marks booklet backs as dropped when only odd faces print', () => {
    const view = layoutSchematic(
      pages(8),
      opts((o) => ((o.mode = 'booklet'), (o.sides = 'odd'))),
    )
    expect(view.faces.filter((f) => !f.excluded).map((f) => f.booklet?.side)).toEqual([
      'front',
      'front',
    ])
  })

  it('gives print order with reverse on', () => {
    const view = layoutSchematic(
      pages(3),
      opts((o) => (o.reverse = true)),
    )
    expect(view.faces.map((f) => f.printOrder)).toEqual([3, 2, 1])
  })

  it('splits each page into poster tiles', () => {
    const view = layoutSchematic(
      pages(2),
      opts((o) => ((o.mode = 'poster'), (o.poster.cols = 3), (o.poster.rows = 2))),
      8,
    )
    expect(view.totalFaces).toBe(12)
    expect(view.faces.length).toBe(8)
    expect(view.faces[0]!.poster).toEqual({ page: 1, piece: 1, pieces: 6 })
    expect(view.faces[5]!.poster).toEqual({ page: 1, piece: 6, pieces: 6 })
    expect(view.faces[6]!.poster).toEqual({ page: 2, piece: 1, pieces: 6 })
    expect(view.faces[0]!.cutMarks.length).toBe(2)
  })

  it('shows used label cells before the start cell', () => {
    const view = layoutSchematic(
      pages(3),
      opts((o) => ((o.mode = 'labels'), (o.labels.startCell = 4))),
    )
    const cells = view.faces[0]!.cells
    expect(cells.length).toBe(21)
    expect(cells.slice(0, 3).every((c) => c.skipped)).toBe(true)
    expect(cells[3]!.start).toBe(true)
    expect(cells.slice(3, 6).map((c) => c.page)).toEqual([1, 2, 3])
    expect(cells[6]!.page).toBeNull()
    expect(cells[6]!.skipped).toBe(false)
  })

  it('carries the reason instead of faces when the options cannot be planned', () => {
    const view = layoutSchematic(
      pages(1),
      opts((o) => ((o.mode = 'poster'), (o.poster.cols = 1), (o.poster.rows = 1))),
    )
    expect(view.faces).toEqual([])
    expect(view.issue?.code).toBe('poster-single-tile')
  })
})
