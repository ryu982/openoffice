/**
 * The data and pure functions behind the looks the AI gives a document
 * (studio-plugin/document-looks.mjs): border rules, the lines of a block of cells, the
 * looks of a table and of a title box, the font that stands in for one a PC lacks, the
 * page number names and the pieces of a header text.
 */
import { describe, expect, it } from 'vitest'
import {
  NUMBERED_MARKS,
  numberedMarkOf,
  BORDER_WIDTHS_MM,
  DOCUMENT_FONTS,
  PAGE_NUMBER_PLACES,
  borderRuleOf,
  borderWidthIndex,
  cellBorders,
  headerPieces,
  pageNumberOf,
  standInFont,
  tableLookBlocks,
  titleBoxCells,
  CELL_DIAGONALS,
  tabStopsOf,
  MIN_TEXT_CONTRAST,
  contrastRatio,
  textColorOnFill,
  rowEdgesAfterAdding,
} from '../studio-plugin/document-looks.mjs'

describe('the lines new rows of a table get', () => {
  const line = (type: number, width: number) => ({ type, width, color: '#000000' })
  const edge = (one: ReturnType<typeof line>) => [one, one, one]
  const heavy = line(1, 6)
  const thin = line(1, 1)
  const none = line(0, 0)
  /** The line a row added after the last of two rows gets. */
  const added = (edges: ReturnType<typeof line>[][], verticals: ReturnType<typeof line>[]) =>
    rowEdgesAfterAdding(edges, [false, false], verticals, 2, 1)?.[2]

  it('never draws the outline between rows of a table with no line between two body rows', () => {
    const outlined = [edge(heavy), edge(thin), edge(heavy)]
    expect(added(outlined, [line(1, 3)])).toEqual(edge(line(1, 3)))
    expect(added(outlined, [none, none])).toEqual(edge(thin))
    expect(added([edge(heavy), edge(none), edge(line(1, 4))], [none])).toEqual(edge(line(1, 4)))
    expect(added([edge(none), edge(none), edge(none)], [none])).toBeUndefined()
  })
})

describe('border rules', () => {
  it('takes the nearest of the widths Hangul has', () => {
    expect(BORDER_WIDTHS_MM[borderWidthIndex(0.12)]).toBe(0.12)
    expect(BORDER_WIDTHS_MM[borderWidthIndex(0.45)]).toBe(0.4)
    expect(BORDER_WIDTHS_MM[borderWidthIndex(0.52)]).toBe(0.5)
    expect(BORDER_WIDTHS_MM[borderWidthIndex(9)]).toBe(5)
  })

  it('reads a rule with its defaults: all sides, a thin solid black line', () => {
    expect(borderRuleOf({})).toEqual({
      sides: 'all',
      line: { type: 1, width: 1, color: '#000000' },
    })
    // a double line is drawn as two only when it is wide enough
    expect(borderRuleOf({ line: 'double' }).line).toEqual({ type: 8, width: 7, color: '#000000' })
    expect(borderRuleOf({ sides: 'top', line: 'none' }).line.type).toBe(0)
    expect(borderRuleOf({ line: 'dashed', width: 1, color: '#C00000' }).line).toEqual({
      type: 2,
      width: 10,
      color: '#c00000',
    })
  })

  it('says what is wrong with a rule', () => {
    expect(() => borderRuleOf({ sides: 'diagonal' })).toThrow(/sides must be one of/)
    expect(() => borderRuleOf({ line: 'wavy' })).toThrow(/line must be one of/)
    expect(() => borderRuleOf({ width: 12 })).toThrow(/width must be/)
    expect(() => borderRuleOf({ color: 'red' })).toThrow(/color must look like/)
    expect(() => borderRuleOf(null)).toThrow(/each border/)
  })
})

/** A plain grid of rows x cols cells, numbered row by row. */
const grid = (rows: number, cols: number) =>
  Array.from({ length: rows * cols }, (_, cell) => ({
    cell,
    row: Math.floor(cell / cols),
    col: cell % cols,
    rowSpan: 1,
    colSpan: 1,
  }))

const rule = (sides: string, line = 'solid', width?: number) =>
  borderRuleOf({ sides, line, ...(width ? { width } : {}) })

describe('the lines of a block of cells', () => {
  const whole = { top: 0, left: 0, bottom: 1, right: 1 }

  it('tells the outline of a block from the lines inside it', () => {
    const borders = cellBorders(grid(2, 2), whole, [
      rule('outer', 'solid', 0.5),
      rule('inner', 'dotted'),
    ])
    const topLeft = borders.get(0)
    expect(topLeft.borderTop.width).toBe(7)
    expect(topLeft.borderLeft.width).toBe(7)
    expect(topLeft.borderRight.type).toBe(3)
    expect(topLeft.borderBottom.type).toBe(3)
    // the line between two cells is the same from both sides
    expect(borders.get(1).borderLeft).toEqual(topLeft.borderRight)
    expect(borders.get(2).borderTop).toEqual(topLeft.borderBottom)
  })

  it('lets a later rule go over an earlier one, edge by edge', () => {
    const borders = cellBorders(grid(2, 2), whole, [
      rule('all'),
      rule('left', 'none'),
      rule('inner_horizontal', 'double'),
    ])
    expect(borders.get(0).borderLeft.type).toBe(0)
    expect(borders.get(0).borderTop.type).toBe(1)
    expect(borders.get(0).borderBottom.type).toBe(8)
    expect(borders.get(0).borderRight.type).toBe(1)
    expect(borders.get(1).borderLeft.type).toBe(1)
  })

  it('touches only the cells of the block, and of those only the edges it means', () => {
    const borders = cellBorders(grid(3, 3), { top: 0, left: 0, bottom: 0, right: 2 }, [
      rule('bottom', 'double'),
    ])
    expect([...borders.keys()]).toEqual([0, 1, 2])
    expect(Object.keys(borders.get(1))).toEqual(['borderBottom'])
  })

  it('leaves the edge of a merged cell that lies outside the block alone', () => {
    // a cell two rows high whose lower half is outside the block
    const cells = [
      { cell: 0, row: 0, col: 0, rowSpan: 2, colSpan: 1 },
      { cell: 1, row: 0, col: 1, rowSpan: 1, colSpan: 1 },
    ]
    const borders = cellBorders(cells, { top: 0, left: 0, bottom: 0, right: 1 }, [rule('all')])
    expect(borders.get(0)).not.toHaveProperty('borderBottom')
    expect(borders.get(1)).toHaveProperty('borderBottom')
  })
})

describe('table looks', () => {
  it('leaves the plain grid as the paste made it', () => {
    expect(tableLookBlocks('grid', true)).toEqual([])
  })

  it('opens the sides of an open table and underlines its header', () => {
    const blocks = tableLookBlocks('open', true)
    expect(blocks.map((block) => block.header)).toEqual([false, true])
    const borders = cellBorders(
      grid(2, 2),
      { top: 0, left: 0, bottom: 1, right: 1 },
      blocks[0].rules,
    )
    expect(borders.get(0).borderLeft.type).toBe(0)
    expect(borders.get(1).borderRight.type).toBe(0)
    expect(borders.get(0).borderTop.width).toBeGreaterThan(borders.get(0).borderBottom.width)
    expect(tableLookBlocks('open', false)).toHaveLength(1)
  })

  it('draws only the lines between rows for the rows look', () => {
    const [body] = tableLookBlocks('rows', false)
    const borders = cellBorders(grid(2, 2), { top: 0, left: 0, bottom: 1, right: 1 }, body.rules)
    expect(borders.get(0).borderRight.type).toBe(0)
    expect(borders.get(0).borderBottom.type).toBe(1)
  })
})

describe('title boxes', () => {
  it('makes bands as three rows with the title in the middle one', () => {
    const box = titleBoxCells('bands', '#1f3864', '#c00000')
    expect([box.rows, box.title, box.bands]).toEqual([3, 1, [0, 2]])
    expect(box.cells[0]).toMatchObject({ fillColor: '#1f3864', patternType: -1 })
    expect(box.cells[2].fillColor).toBe('#c00000')
    expect(box.cells[1].borderTop.type).toBe(0)
  })

  it('makes the other looks as one cell', () => {
    expect(titleBoxCells('lines', '#000000').cells[0]).toMatchObject({
      borderTop: { type: 1 },
      borderLeft: { type: 0 },
    })
    expect(titleBoxCells('box', '#000000').cells[0].borderLeft.type).toBe(1)
    expect(titleBoxCells('shaded', '#e7edf5').cells[0]).toMatchObject({
      fillType: 'solid',
      borderTop: { type: 0 },
    })
    expect(titleBoxCells('shaded', '#e7edf5', '#1f3864').cells[0].borderTop.type).toBe(1)
  })
})

describe('the colour of words on a fill', () => {
  it('is white where black would be hard to read, when the call names none', () => {
    expect(textColorOnFill('#1F3864')).toBe('#ffffff')
    expect(textColorOnFill('#000000')).toBe('#ffffff')
    expect(textColorOnFill('#404040')).toBe('#ffffff')
  })

  it('is left to the words on a fill black shows on', () => {
    for (const fill of ['#FFFFFF', '#E5E5E5', '#D9E2F3', '#FFE699', '#5B9BD5', '#4472C4']) {
      expect(textColorOnFill(fill), fill).toBeNull()
    }
  })

  it('does not decide for a colour the call asks for: accent colours on white stay', () => {
    for (const asked of ['#ED7D31', '#00B050', '#FF9900']) {
      const contrast = contrastRatio(asked, '#ffffff')
      expect(contrast, asked).toBeLessThan(3)
      expect(contrast, asked).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    }
  })
})

describe('the font that stands in for one a PC lacks', () => {
  const pc =
    (...fonts: string[]) =>
    (name: string) =>
      fonts.includes(name)

  it('gives a headline face a gothic in bold', () => {
    expect(standInFont('HY헤드라인M', pc('맑은 고딕', '바탕'))).toEqual({
      font: '맑은 고딕',
      bold: true,
    })
  })

  it('gives a serif text face the first serif the PC has', () => {
    expect(standInFont('휴먼명조', pc('맑은 고딕', '바탕'))).toEqual({ font: '바탕', bold: false })
    expect(standInFont('휴먼명조', pc('맑은 고딕', '바탕', '함초롬바탕'))).toEqual({
      font: '함초롬바탕',
      bold: false,
    })
  })

  it('gives a gothic text face a gothic', () => {
    expect(standInFont('휴먼고딕', pc('맑은 고딕'))).toEqual({ font: '맑은 고딕', bold: false })
  })

  it('leaves the name alone when the PC has it, when nothing is known, or when no stand-in is there', () => {
    expect(standInFont('HY헤드라인M', pc('HY헤드라인M', '맑은 고딕'))).toBeNull()
    expect(standInFont('HY헤드라인M', () => undefined)).toBeNull()
    expect(standInFont('휴먼명조', pc('맑은 고딕'))).toBeNull()
    expect(standInFont('', pc('맑은 고딕'))).toBeNull()
  })

  it('lists the fonts documents are written in, the two of Hancom Office first', () => {
    expect(DOCUMENT_FONTS.slice(0, 2)).toEqual(['HY헤드라인M', '휴먼명조'])
    expect(DOCUMENT_FONTS).toContain('맑은 고딕')
  })
})

describe('page numbers and header text', () => {
  it('names a page number setting, and none for a hidden one', () => {
    expect(pageNumberOf({ format: 0, position: 5, dash: true })).toEqual({
      position: 'bottom_center',
      format: 'digit',
      dashes: true,
    })
    expect(pageNumberOf({ format: 2, position: PAGE_NUMBER_PLACES.none, dash: false })).toBeNull()
    expect(pageNumberOf(null)).toBeNull()
  })

  it('splits a header text into words and fields', () => {
    expect(headerPieces('계획 | {page} / {pages}')).toEqual([
      { text: '계획 | ' },
      { field: 1 },
      { text: ' / ' },
      { field: 2 },
    ])
    expect(headerPieces('{page}')).toEqual([{ field: 1 }])
    expect(headerPieces('교무기획부')).toEqual([{ text: '교무기획부' }])
    expect(headerPieces('')).toEqual([])
  })
})

describe('numbered levels', () => {
  it('tells the level of a paragraph by the number it starts with', () => {
    expect(Object.keys(NUMBERED_MARKS)).toEqual(['Ⅰ', '1.', '가.', '1)', '가)', '(1)', '(가)', '①'])
    const cases: [string, string | null][] = [
      ['Ⅰ. 목적', 'Ⅰ'],
      ['Ⅱ 방침', 'Ⅰ'],
      ['IV. 결론', 'Ⅰ'],
      ['1. 운영 방향', '1.'],
      ['12. 기타', '1.'],
      ['  가. 대상', '가.'],
      ['1) 세부 일정', '1)'],
      ['하) 마지막', '가)'],
      ['(2) 항목', '(1)'],
      ['(나) 항목', '(가)'],
      ['③ 선택지', '①'],
    ]
    for (const [text, level] of cases) expect(numberedMarkOf(text), text).toBe(level)
  })

  it('does not take a decimal, a year, a word or a bullet for a number of a level', () => {
    for (const text of [
      '1.5배 늘어남',
      '2026. 7. 27.(월)',
      '가구 수 조사',
      'I am here',
      '○ 항목',
      '',
    ]) {
      expect(numberedMarkOf(text), text).toBeNull()
    }
  })
})

describe('tab stops', () => {
  it('stands at the right edge with right-aligned text unless a place is given', () => {
    expect(tabStopsOf([{ leader: 'dots' }])).toEqual([{ atMm: null, type: 1, fill: 3 }])
    expect(tabStopsOf([{}])).toEqual([{ atMm: null, type: 1, fill: 0 }])
    expect(tabStopsOf([{ atMm: 40 }])).toEqual([{ atMm: 40, type: 0, fill: 0 }])
    expect(tabStopsOf([{ atMm: 40, align: 'decimal', leader: 'line' }])).toEqual([
      { atMm: 40, type: 3, fill: 1 },
    ])
    expect(tabStopsOf([])).toEqual([])
  })

  it('sorts the stops from the left, the right edge last', () => {
    const stops = tabStopsOf([{ leader: 'dashes' }, { atMm: 90, align: 'center' }, { atMm: 20 }])
    expect(stops.map((stop) => stop.atMm)).toEqual([20, 90, null])
    expect(stops.map((stop) => stop.type)).toEqual([0, 2, 1])
  })

  it('refuses what it cannot read', () => {
    for (const bad of [
      'dots',
      [{ leader: 'stars' }],
      [{ align: 'middle' }],
      [{ atMm: 0 }],
      [{ atMm: 900 }],
      [{ atMm: '40' }],
      [{}, {}],
      ['right'],
      Array(9).fill({ atMm: 10 }),
    ]) {
      expect(() => tabStopsOf(bad as never), JSON.stringify(bad)).toThrow(/tab/)
    }
  })
})

describe('the diagonal of a cell', () => {
  it('names the two lines the engine draws, and none', () => {
    expect(CELL_DIAGONALS.down).toEqual({ diagonalSlash: 0, diagonalBackSlash: 2 })
    expect(CELL_DIAGONALS.up).toEqual({ diagonalSlash: 2, diagonalBackSlash: 0 })
    expect(CELL_DIAGONALS.both).toEqual({ diagonalSlash: 2, diagonalBackSlash: 2 })
    expect(CELL_DIAGONALS.none).toEqual({ diagonalSlash: 0, diagonalBackSlash: 0 })
  })
})
