/**
 * The looks the plugin gives a document, against the real rhwp engine: the lines of table
 * cells, the looks of a new table, paragraph styles made and applied in one call, a title
 * box, the page number, the header and footer, and the font that stands in for one this PC
 * lacks. The editor's history is modelled by snapshots, as in agent-plugin-doc-settings.test.ts.
 */
import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import JSZip from 'jszip'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import {
  agentPlugin,
  splitsWord,
  tablesOf,
  type AgentMapPage,
  type AgentPageEnd,
  type AgentPluginHost,
} from '../studio-plugin/agent-plugin.mjs'
import { installFontPresence } from '../studio-plugin/pc-fonts.mjs'
import { EXAM_PAPER, examChoiceStops, examColumnWidthMm } from '../studio-plugin/document-looks.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

afterEach(() => {
  // what this PC has is not known unless a test says so
  installFontPresence(null as never)
})

const TITLE = '2026학년도 현장체험학습 운영 계획'
const LINES = [
  TITLE,
  '□ 추진 배경',
  '○ 학생의 진로 탐색 기회를 넓히기 위해 운영함',
  '  - 만족도 조사에서 87%가 확대를 희망',
  '□ 세부 일정',
  '○ 참가 동의서는 담임 교사에게 제출',
]

const ONE_PIXEL = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)

/** The text drawn on each page, page numbers and list numbers with it. */
function drawnPages(doc: HwpDocument): string[] {
  return Array.from({ length: doc.pageCount() }, (_, page) =>
    [...doc.renderPageSvgWithProfile(page, 'print').matchAll(/<text[^>]*>([^<]*)<[/]text>/g)]
      .map((run) => run[1])
      .join(''),
  )
}

function blank(lines: string[] = LINES): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  lines.forEach((line, index) => {
    if (index > 0) doc.splitParagraph(0, index - 1, doc.getParagraphLength(0, index - 1))
    doc.insertText(0, index, 0, line)
  })
  return doc
}

function open(start: HwpDocument = blank()) {
  let doc = start
  const history: Uint8Array[] = []
  const host = {
    read: (fn: (d: never) => unknown) => fn(doc as never),
    transaction: (_label: string, fn: (tx: never) => unknown) => {
      const before = doc.exportHwp()
      try {
        const result = fn({ doc: () => doc, deferPagination: () => {} } as never)
        history.push(before)
        return result
      } catch (thrown) {
        doc = new HwpDocument(before)
        throw thrown
      }
    },
    events: { on: () => 0 },
    automation: { registerCommand: () => {}, execute: () => ({ ok: false }) },
  } as unknown as AgentPluginHost
  return { plugin: agentPlugin.activate(host), doc: () => doc, steps: () => history.length }
}

/** The fonts of this PC, as the editor knows them after it looked. */
function pcHas(...fonts: string[]) {
  installFontPresence({
    resolveLocalFont: (name: string) => (fonts.includes(name) ? { family: name } : null),
    records: () => [],
    detected: () => [],
    state: () => ({ source: 'local-font-access' }),
  } as never)
}

interface Line {
  type: number
  width: number
  color: string
}
interface Cell {
  width: number
  height: number
  verticalAlign: number
  borderLeft: Line
  borderRight: Line
  borderTop: Line
  borderBottom: Line
  fillType: string
  fillColor: string
}

/** The first table of body paragraph `para`: its control and the properties of a cell. */
function tableIn(doc: HwpDocument, para: number) {
  for (let control = 0; control < 8; control++) {
    try {
      const dims = JSON.parse(doc.getTableDimensions(0, para, control)) as {
        rowCount?: number
        colCount: number
        cellCount: number
      }
      if (dims.rowCount === undefined) continue
      return {
        control,
        rows: dims.rowCount,
        cols: dims.colCount,
        cells: dims.cellCount,
        cell: (index: number) => JSON.parse(doc.getCellProperties(0, para, control, index)) as Cell,
      }
    } catch {
      // not a table
    }
  }
  throw new Error(`no table in paragraph ${para}`)
}

const ROWS = [
  ['구분', '일시', '장소'],
  ['1학년', '9. 12.(금)', '국립중앙박물관'],
  ['2학년', '9. 19.(금)', '국립과천과학관'],
]

/** A document with a 3 x 3 table after the "세부 일정" line (body paragraph 5). */
function withTable(look: Parameters<ReturnType<typeof open>['plugin']['insertTable']>[4] = true) {
  const opened = open()
  const made = opened.plugin.insertTable('□ 세부 일정', null, 'after', ROWS, look)
  expect(made).toMatchObject({ ok: true, rows: 3, cols: 3 })
  return { ...opened, para: 5 }
}

describe('formatCells: borders', () => {
  it('draws the outline of a block and the lines inside it, the same from both sides', () => {
    const { plugin, doc, steps, para } = withTable()
    const before = steps()
    const result = plugin.formatCells(1, null, {
      borders: [
        { sides: 'all', line: 'solid', width: 0.12 },
        { sides: 'left', line: 'none' },
        { sides: 'right', line: 'none' },
        { sides: 'top', line: 'solid', width: 0.5 },
        { sides: 'bottom', line: 'solid', width: 0.5 },
      ],
    })
    expect(result).toMatchObject({ ok: true, count: 9 })
    expect(steps()).toBe(before + 1)
    const table = tableIn(doc(), para)
    // top left cell: no line at the left, a heavy one above, thin ones inside
    expect(table.cell(0).borderLeft.type).toBe(0)
    expect(table.cell(0).borderTop).toMatchObject({ type: 1, width: 7 })
    expect(table.cell(0).borderRight).toMatchObject({ type: 1, width: 1 })
    expect(table.cell(0).borderBottom).toMatchObject({ type: 1, width: 1 })
    // the line between two rows is one line: both cells name it alike
    expect(table.cell(3).borderTop).toEqual(table.cell(0).borderBottom)
    // bottom right cell: no line at the right, a heavy one below
    expect(table.cell(8).borderRight.type).toBe(0)
    expect(table.cell(8).borderBottom).toMatchObject({ type: 1, width: 7 })
  })

  it('takes a block, and a later rule goes over an earlier one', () => {
    const { plugin, doc, para } = withTable()
    const result = plugin.formatCells(
      1,
      { fromRow: 1, fromCol: 1, toRow: 1, toCol: 3 },
      { borders: [{ sides: 'bottom', line: 'double', color: '#1F3864' }], verticalAlign: 'middle' },
    )
    expect(result).toMatchObject({ ok: true, count: 3 })
    const table = tableIn(doc(), para)
    for (const cell of [0, 1, 2]) {
      expect(table.cell(cell).borderBottom).toMatchObject({ type: 8, width: 7, color: '#1f3864' })
      expect(table.cell(cell).verticalAlign).toBe(1)
    }
    // the row below shares that line; the cells further down keep their own
    expect(table.cell(3).borderTop.type).toBe(8)
    expect(table.cell(6).borderTop.type).toBe(1)
  })

  it('keeps the lines and the fill through HWPX and HWP', () => {
    const { plugin, doc, para } = withTable()
    plugin.formatCells(1, [{ row: 2, col: 2 }], {
      background: '#FFF2CC',
      borders: [{ sides: 'outer', line: 'dashed', width: 0.4, color: '#C00000' }],
    })
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const cell = tableIn(new HwpDocument(bytes), para).cell(4)
      expect(cell.fillType).toBe('solid')
      expect(cell.fillColor).toBe('#fff2cc')
      for (const side of ['borderLeft', 'borderRight', 'borderTop', 'borderBottom'] as const) {
        expect(cell[side]).toMatchObject({ type: 2, width: 6, color: '#c00000' })
      }
    }
  })

  it('still takes a background alone, as before', () => {
    const { plugin, doc, para } = withTable()
    expect(plugin.formatCells(1, [{ row: 3, col: 1 }], '#DCE6F5')).toMatchObject({
      ok: true,
      count: 1,
    })
    expect(tableIn(doc(), para).cell(6).fillColor).toBe('#dce6f5')
    expect(plugin.formatCells(1, [{ row: 3, col: 1 }], 'none')).toMatchObject({ ok: true })
    expect(tableIn(doc(), para).cell(6).fillType).toBe('none')
  })

  it('refuses a block outside the table and a rule it cannot read, changing nothing', () => {
    const { plugin, steps } = withTable()
    const before = steps()
    expect(
      plugin.formatCells(
        1,
        { fromRow: 1, fromCol: 1, toRow: 4, toCol: 3 },
        { background: '#eeeeee' },
      ),
    ).toMatchObject({ ok: false, reason: 'no_such_cell', rows: 3, cols: 3 })
    expect(() =>
      plugin.formatCells(1, null, { borders: [{ sides: 'diagonal' as never, line: 'solid' }] }),
    ).toThrow(/sides must be one of/)
    expect(() => plugin.formatCells(1, null, {})).toThrow(/name what to change/)
    expect(steps()).toBe(before)
  })
})

describe('insertTable: looks', () => {
  it('makes an open table: no lines at the sides, heavier above and below, a line under the header', () => {
    const { doc, para } = withTable({ header: true, look: 'open', headerColor: '#DCE6F5' })
    const table = tableIn(doc(), para)
    expect(table.cell(0).borderLeft.type).toBe(0)
    expect(table.cell(2).borderRight.type).toBe(0)
    expect(table.cell(0).borderTop).toMatchObject({ type: 1, width: 7 })
    expect(table.cell(8).borderBottom).toMatchObject({ type: 1, width: 7 })
    expect(table.cell(0).borderBottom).toMatchObject({ type: 1, width: 5 })
    expect(table.cell(3).borderTop).toMatchObject({ type: 1, width: 5 })
    expect(table.cell(1).fillColor).toBe('#dce6f5')
    expect(table.cell(4).fillType).not.toBe('solid')
  })

  it('sets body cells left and gives empty cells the size, font and alignment of the table text', () => {
    const rows = [
      ['구분', ''],
      ['1주', ''],
      ['', '직무 과정'],
    ]
    const looks = (source: HwpDocument, para: number) => {
      const table = tableIn(source, para)
      return Array.from({ length: table.cells }, (_, cell) => {
        const chars = JSON.parse(
          source.getCellCharPropertiesAt(0, para, table.control, cell, 0, 0),
        ) as { fontSize: number; fontFamily: string; bold: boolean }
        const { alignment } = JSON.parse(
          source.getCellParaPropertiesAt(0, para, table.control, cell, 0),
        ) as { alignment: string }
        return `${chars.fontFamily} ${chars.fontSize / 100}${chars.bold ? ' bold' : ''} ${alignment}`
      })
    }
    const { plugin, doc } = open()
    plugin.insertTable('□ 세부 일정', null, 'after', rows, {
      header: true,
      size: 9,
      font: '함초롬돋움',
    })
    expect(looks(doc(), 5)).toEqual([
      '함초롬돋움 9 bold center',
      '함초롬돋움 9 bold center',
      '함초롬돋움 9 left',
      '함초롬돋움 9 left',
      '함초롬돋움 9 left',
      '함초롬돋움 9 left',
    ])
    plugin.fillCells(1, [{ row: 2, col: 2, text: '공통 과정' }], false)
    for (const source of [
      doc(),
      new HwpDocument(doc().exportHwpx()),
      new HwpDocument(doc().exportHwp()),
    ]) {
      expect(looks(source, 5)[3]).toBe('함초롬돋움 9 left')
    }
    const centred = open()
    centred.plugin.insertTable('□ 세부 일정', null, 'after', rows, { align: 'center' })
    expect(looks(centred.doc(), 5).slice(2)).toEqual(Array(4).fill('함초롬바탕 10 center'))
  })

  it('sets a new table in the font most body characters have, headings left out', () => {
    const cellFont = (source: HwpDocument, para: number) => {
      const table = tableIn(source, para)
      const chars = JSON.parse(
        source.getCellCharPropertiesAt(0, para, table.control, table.cols, 0, 0),
      ) as { fontSize: number; fontFamily: string }
      return `${chars.fontFamily} ${chars.fontSize / 100}`
    }
    // bold headings of 15 pt, and body lines of 12 pt in two indents of a look each
    const lines = [
      '1. 추진 배경',
      '○ 첫째 내용을 적는다.',
      '- 세부 하나를 적는다.',
      '2. 추진 내용',
      '○ 둘째 내용을 적는다.',
      '- 세부 둘을 적는다.',
    ]
    const { plugin, doc } = open(blank(lines))
    plugin.styleParagraphs({
      styles: [
        { name: '장제목', format: { size: 15, bold: true, font: '함초롬돋움' } },
        { name: '본문하나', format: { size: 12, marginLeft: 5 } },
        { name: '본문둘', format: { size: 12, marginLeft: 10 } },
      ],
      apply: [
        { style: '장제목', startsWith: '1.' },
        { style: '장제목', startsWith: '2.' },
        { style: '본문하나', startsWith: '○' },
        { style: '본문둘', startsWith: '-' },
      ],
    })
    plugin.insertTable(
      '- 세부 하나',
      null,
      'after',
      [
        ['구분', '내용'],
        ['1주', '공통 과정'],
      ],
      true,
    )
    expect(cellFont(doc(), 3)).toBe('함초롬바탕 12')
    // a form of Hangul whose body is 10 pt under big headings and boxes
    const form = open(
      new HwpDocument(readFileSync(join(__dirname, 'fixtures', 'title-table-zone-fill.hwpx'))),
    )
    expect(
      form.plugin.insertTable(
        '가나다라마 사아 차카타파하',
        null,
        'after',
        [
          ['구분', '내용'],
          ['1주', '공통'],
        ],
        true,
      ),
    ).toMatchObject({ ok: true })
    const found = JSON.parse(form.doc().getControls()) as {
      ctrlId: string
      para: number
      list: number
    }[]
    const paras = found
      .filter((one) => one.ctrlId === 'tbl' && one.list === 0)
      .map((one) => one.para)
    expect(cellFont(form.doc(), Math.max(...paras))).toBe('나눔스퀘어 10')
  })

  describe('the font of a new table', () => {
    const cellFont = (source: HwpDocument, para: number) => {
      const table = tableIn(source, para)
      const chars = JSON.parse(
        source.getCellCharPropertiesAt(0, para, table.control, table.cols, 0, 0),
      ) as { fontSize: number; fontFamily: string }
      return `${chars.fontFamily} ${chars.fontSize / 100}`
    }
    const TITLE_LINE = '2026학년도 1학기 학부모 상담 주간 운영 계획 안내'
    const ROWS_2 = [
      ['날짜', '내용'],
      ['11. 20.', '1학년 상담'],
    ]

    it('leaves out a 20 pt bold title longer than the 10 pt lines under it', () => {
      const { plugin, doc } = open(blank([TITLE_LINE, '일정', '상담은 교실에서 합니다.']))
      plugin.formatText(TITLE_LINE, null, false, { size: 20, bold: true })
      plugin.insertTable('일정', null, 'after', ROWS_2, true)
      expect(cellFont(doc(), 2)).toBe('함초롬바탕 10')
    })

    it('takes the body line it follows when a longer title of a size of its own is not bold', () => {
      const { plugin, doc } = open(blank([TITLE_LINE, '상담은 아래와 같이 합니다.']))
      plugin.formatText(TITLE_LINE, null, false, { size: 20, font: '돋움' })
      plugin.insertTable('상담은 아래와', null, 'after', ROWS_2, true)
      expect(cellFont(doc(), 2)).toBe('함초롬바탕 10')
    })

    it('takes the look of the body after a small plain line such as a unit note', () => {
      const { plugin, doc } = open(
        blank([
          '학교 현황 보고',
          '학생 수는 학년마다 다르다. 올해는 학생이 조금 늘었고 내년에도 늘 것이다.',
          '교사 수는 작년과 같고 교실도 그대로이다.',
          '(단위: 명)',
        ]),
      )
      plugin.formatText('(단위: 명)', null, false, { size: 8, font: '돋움' })
      plugin.insertTable('(단위: 명)', null, 'after', ROWS_2, true)
      expect(cellFont(doc(), 4)).toBe('함초롬바탕 10')
    })

    it('takes the look of text that is not bold when every line is a heading', () => {
      const { plugin, doc } = open(
        blank([
          '1. 추진 배경',
          '가. 학생 수가 늘어 교실이 모자라 수업 공간을 새로 마련해야 한다.',
          '나. 교사 연수 공간이 필요하다.',
          '2. 추진 계획',
        ]),
      )
      plugin.styleParagraphs({
        styles: [
          { name: '개요 1', format: { font: '함초롬돋움', size: 15, bold: true } },
          { name: '개요 2', format: { font: '함초롬돋움', size: 13 } },
        ],
        apply: [
          { style: '개요 1', startsWith: '1.' },
          { style: '개요 1', startsWith: '2.' },
          { style: '개요 2', startsWith: '가.' },
          { style: '개요 2', startsWith: '나.' },
        ],
      })
      plugin.insertTable('나. 교사 연수', null, 'after', ROWS_2, true)
      expect(cellFont(doc(), 3)).toBe('함초롬돋움 13')
    })

    it('takes the look of the line it follows when the document has only a bold line', () => {
      const { plugin, doc } = open(blank(['2026학년도 학교 운영 계획']))
      plugin.formatText('2026학년도 학교 운영 계획', null, false, {
        size: 15,
        bold: true,
        font: '함초롬돋움',
      })
      plugin.insertTable('2026학년도 학교 운영 계획', null, 'after', ROWS_2, true)
      expect(cellFont(doc(), 1)).toBe('함초롬돋움 15')
    })

    it('takes the look of the body after a plain line larger than the body', () => {
      const { plugin, doc } = open(
        blank(['본문 첫째 줄입니다.', '본문 둘째 줄입니다.', '큰 줄', '끝 줄']),
      )
      plugin.formatText('큰 줄', null, false, { size: 14 })
      plugin.insertTable('큰 줄', null, 'after', ROWS_2, true)
      expect(cellFont(doc(), 3)).toBe('함초롬바탕 10')
    })
  })

  it('keeps the outline at the edge of an open table and the header line under the header when rows are added', () => {
    /** The line under each row of column 1, and the line over the table, as widths. */
    const lines = (source: HwpDocument) => {
      const table = tableIn(source, 5)
      const under = Array.from({ length: table.rows }, (_, row) => {
        for (let cell = 0; cell < table.cells; cell++) {
          const info = JSON.parse(source.getCellInfo(0, 5, table.control, cell)) as {
            row: number
            col: number
            rowSpan: number
          }
          if (info.col === 0 && info.row + info.rowSpan - 1 === row) {
            return table.cell(cell).borderBottom.width
          }
        }
        return null
      })
      return [table.cell(0).borderTop.width, ...under]
    }
    const heavy = 7
    const header = 5
    const look = { header: true, look: 'open' as const }
    const appended = withTable(look)
    const inner = lines(appended.doc())[2]
    expect(lines(appended.doc())).toEqual([heavy, header, inner, heavy])
    expect(appended.plugin.addTableLines(1, 'rows', 3, 'after', 1)).toMatchObject({ ok: true })
    appended.plugin.addTableLines(1, 'rows', 4, 'after', 2)
    expect(lines(appended.doc())).toEqual([heavy, header, inner, inner, inner, inner, heavy])
    for (const bytes of [appended.doc().exportHwpx(), appended.doc().exportHwp()]) {
      expect(lines(new HwpDocument(bytes))).toEqual([
        heavy,
        header,
        inner,
        inner,
        inner,
        inner,
        heavy,
      ])
    }

    const first = withTable(look)
    first.plugin.addTableLines(1, 'rows', 1, 'before', 1)
    expect(lines(first.doc())).toEqual([heavy, inner, header, inner, heavy])

    const merged = withTable(look)
    merged.plugin.mergeCells(1, { row: 3, col: 1 }, { row: 3, col: 3 })
    merged.plugin.addTableLines(1, 'rows', 3, 'after', 1)
    expect(lines(merged.doc())).toEqual([heavy, header, inner, inner, heavy])

    // a header and one row: no line between two body rows, so new rows take the line between the columns
    const short = open()
    short.plugin.insertTable('□ 세부 일정', null, 'after', ROWS.slice(0, 2), look)
    short.plugin.addTableLines(1, 'rows', 2, 'after', 2)
    expect(lines(short.doc())).toEqual([heavy, header, inner, inner, heavy])
  })

  it('draws no outline line inside a two-row table with a heavy outline', () => {
    const { plugin, doc } = open()
    plugin.insertTable('□ 세부 일정', null, 'after', [
      ['김민수', '90'],
      ['이서연', '80'],
    ])
    plugin.formatCells(1, null, { borders: [{ sides: 'outer', width: 0.4 }] })
    const under = () => {
      const table = tableIn(doc(), 5)
      return Array.from({ length: table.rows }, (_, row) => table.cell(row * 2).borderBottom.width)
    }
    const [thin, heavy] = under()
    expect(heavy).toBeGreaterThan(thin)
    plugin.addTableLines(1, 'rows', 2, 'after', 2)
    expect(under()).toEqual([thin, thin, thin, heavy])
  })

  it('copies the line between two body rows, not the line under a head the user drew', () => {
    const NAMES = [
      ['번호', '이름', '부서'],
      ['1', '김', '총무'],
      ['2', '이', '교무'],
      ['3', '박', '연구'],
    ]
    /** The line under each row of the first column, as type/width. */
    const under = (source: HwpDocument) => {
      const table = tableIn(source, 5)
      return Array.from({ length: table.rows }, (_, row) => {
        const line = table.cell(row * table.cols).borderBottom
        return `${line.type}/${line.width}`
      })
    }
    const double = { sides: 'bottom', line: 'double', width: 0.5 } as const
    // a double line under the first row, no header flag
    const drawn = open()
    drawn.plugin.insertTable('□ 세부 일정', null, 'after', NAMES)
    drawn.plugin.formatCells(
      1,
      { fromRow: 1, fromCol: 1, toRow: 1, toCol: 3 },
      {
        borders: [double],
      },
    )
    const [head, thin] = under(drawn.doc())
    drawn.plugin.addTableLines(1, 'rows', 4, 'after', 2)
    expect(under(drawn.doc())).toEqual([head, thin, thin, thin, thin, under(drawn.doc())[5]])
    expect(head).not.toBe(thin)
    // the same with a grey fill on the first row
    const grey = open()
    grey.plugin.insertTable('□ 세부 일정', null, 'after', NAMES)
    grey.plugin.formatCells(
      1,
      { fromRow: 1, fromCol: 1, toRow: 1, toCol: 3 },
      {
        borders: [double],
        background: '#D9D9D9',
      },
    )
    grey.plugin.addTableLines(1, 'rows', 4, 'after', 2)
    expect(under(grey.doc()).slice(1, 5)).toEqual([thin, thin, thin, thin])
    // a head of two flagged rows with a double line under the second
    const two = open()
    two.plugin.insertTable('□ 세부 일정', null, 'after', [['구분', '', ''], ...NAMES], true)
    const table = tableIn(two.doc(), 5)
    for (let cell = 0; cell < 6; cell++) {
      two.doc().setCellProperties(0, 5, table.control, cell, JSON.stringify({ isHeader: true }))
    }
    two.plugin.formatCells(
      1,
      { fromRow: 2, fromCol: 1, toRow: 2, toCol: 3 },
      {
        borders: [double],
      },
    )
    const before = under(two.doc())
    two.plugin.addTableLines(1, 'rows', 5, 'after', 2)
    const after = under(two.doc())
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2))
    expect(after.slice(2, 6)).toEqual([before[2], before[2], before[2], before[2]])
    expect(after[1]).not.toBe(after[2])
  })

  it('keeps a line drawn under the first of two rows under that row only', () => {
    const under = (source: HwpDocument) => {
      const table = tableIn(source, 5)
      return Array.from({ length: table.rows }, (_, row) => {
        const line = table.cell(row * table.cols).borderBottom
        return `${line.type}/${line.width}`
      })
    }
    const { plugin, doc } = open()
    plugin.insertTable('□ 세부 일정', null, 'after', [
      ['회의록', '2026. 11. 15.'],
      ['안건', '내용'],
    ])
    plugin.formatCells(
      1,
      { fromRow: 1, fromCol: 1, toRow: 1, toCol: 2 },
      { borders: [{ sides: 'bottom', line: 'double', width: 0.5 }] },
    )
    const [head, bottom] = under(doc())
    plugin.addTableLines(1, 'rows', 2, 'after', 2)
    expect(under(doc())).toEqual([head, bottom, bottom, bottom])
    expect(head).not.toBe(bottom)
  })

  it('gives a new line under a merged cell the line of the nearest column, no line the table lacks', () => {
    const { plugin, doc } = open()
    plugin.insertTable('□ 세부 일정', null, 'after', [
      ['구분', '내용', '비고'],
      ['가', '나', '다'],
      ['라', '마', '바'],
    ])
    plugin.formatCells(1, null, { borders: [{ sides: 'all', line: 'solid', width: 0.4 }] })
    plugin.mergeCells(1, { row: 1, col: 2 }, { row: 2, col: 2 })
    const widths = () => {
      const source = doc()
      const table = tableIn(source, 5)
      const all = new Set<number>()
      for (let cell = 0; cell < table.cells; cell++) {
        all.add(table.cell(cell).borderTop.width)
        all.add(table.cell(cell).borderBottom.width)
      }
      return all
    }
    const before = widths()
    plugin.addTableLines(1, 'rows', 3, 'after', 1)
    expect(widths()).toEqual(before)
    const table = tableIn(doc(), 5)
    const last = table.cell(table.cells - 2)
    expect(last.borderTop.width).toBe(table.cell(0).borderBottom.width)
  })

  it('writes the words of a header row white on a dark fill, in the document and in both files', () => {
    const { doc, para } = withTable({ header: true, headerColor: '#1F3864' })
    const colours = (source: HwpDocument) => {
      const table = tableIn(source, para)
      return [0, 2, 3].map(
        (cell) =>
          (
            JSON.parse(source.getCellCharPropertiesAt(0, para, table.control, cell, 0, 0)) as {
              textColor: string
            }
          ).textColor,
      )
    }
    expect(colours(doc())).toEqual(['#ffffff', '#ffffff', '#000000'])
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      expect(colours(new HwpDocument(bytes))).toEqual(['#ffffff', '#ffffff', '#000000'])
    }
  })

  it('says that it chose white for the header row, and leaves black where black shows', () => {
    const insert = (look: Parameters<typeof withTable>[0]) =>
      open().plugin.insertTable('□ 세부 일정', null, 'after', ROWS, look)
    expect(insert({ header: true, headerColor: '#1F3864' })).toMatchObject({
      ok: true,
      headerTextColor: '#ffffff',
    })
    for (const look of [
      { header: true, headerColor: '#D9E2F3' },
      { header: true },
      { header: true, headerColor: 'none' },
      { headerColor: '#1F3864' },
    ]) {
      expect(insert(look), JSON.stringify(look)).not.toHaveProperty('headerTextColor')
    }
    const { doc, para } = withTable({ header: true, headerColor: '#D9E2F3' })
    const table = tableIn(doc(), para)
    const chars = JSON.parse(doc().getCellCharPropertiesAt(0, para, table.control, 0, 0, 0)) as {
      textColor: string
    }
    expect(chars.textColor).toBe('#000000')
  })

  it('gives the columns their shares of the width and the text its size', () => {
    const { doc, para } = withTable({
      header: true,
      columnWidths: [1, 2, 1],
      align: 'center',
      size: 11,
    })
    const table = tableIn(doc(), para)
    const [narrow, wide, last] = [table.cell(0).width, table.cell(1).width, table.cell(2).width]
    expect(wide / narrow).toBeGreaterThan(1.9)
    expect(wide / narrow).toBeLessThan(2.1)
    expect(Math.abs(last - narrow)).toBeLessThan(60)
    const chars = JSON.parse(doc().getCellCharPropertiesAt(0, para, table.control, 4, 0, 0)) as {
      fontSize: number
    }
    expect(chars.fontSize).toBe(1100)
    const paragraph = JSON.parse(doc().getCellParaPropertiesAt(0, para, table.control, 4, 0)) as {
      alignment: string
    }
    expect(paragraph.alignment).toBe('center')
  })

  it('gives the columns of a table that is there new shares, merged cells and all, its width kept', () => {
    const { plugin, doc, para } = withTable(true)
    const address = '신청자 연락처 haneul.kim@example.org 로 회신'
    plugin.fillCells(1, [{ row: 2, col: 3, text: address }], true)
    const widths = (source: HwpDocument) => {
      const table = tableIn(source, para)
      return [0, 1, 2].map((cell) => table.cell(cell).width)
    }
    const lineCount = () =>
      (
        JSON.parse(doc().getLineInfoInCell(0, para, tableIn(doc(), para).control, 5, 0, 0)) as {
          lineCount: number
        }
      ).lineCount
    const before = widths(doc())
    const wrapped = lineCount()
    expect(wrapped).toBeGreaterThan(1)
    const result = plugin.formatCells(1, null, { columnWidths: [1, 1, 4] })
    expect(result).toMatchObject({ ok: true })
    const after = widths(doc())
    expect(after.reduce((a, b) => a + b)).toBe(before.reduce((a, b) => a + b))
    expect(after[2] / after[0]).toBeGreaterThan(3.9)
    expect(after[2] / after[0]).toBeLessThan(4.1)
    expect(result.ok && result.columnWidthsMm).toHaveLength(3)
    // the engine wraps the text again for the new width
    expect(lineCount()).toBeLessThan(wrapped)
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      expect(widths(new HwpDocument(bytes))).toEqual(after)
    }
    // a merged cell takes the sum of the columns it spans
    plugin.mergeCells(1, { row: 1, col: 1 }, { row: 1, col: 2 })
    plugin.formatCells(1, null, { columnWidths: [2, 1, 3] })
    const table = tableIn(doc(), para)
    const merged = table.cell(0).width
    const [left, middle] = [table.cell(2).width, table.cell(3).width]
    expect(Math.abs(merged - (left + middle))).toBeLessThan(5)
    expect(plugin.formatCells(1, null, { columnWidths: [1, 2] })).toEqual({
      ok: false,
      reason: 'column_count',
      cols: 3,
    })
  })

  it('refuses widths that do not fit the columns', () => {
    const { plugin } = open()
    expect(() =>
      plugin.insertTable('□ 세부 일정', null, 'after', ROWS, { columnWidths: [1, 2] }),
    ).toThrow(/columnWidths must be 3 positive numbers/)
    expect(() =>
      plugin.insertTable('□ 세부 일정', null, 'after', ROWS, { look: 'fancy' as never }),
    ).toThrow(/look must be one of/)
  })
})

const STYLES = [
  {
    name: '중제목',
    format: {
      font: '맑은 고딕',
      size: 15,
      bold: true,
      lineSpacing: 180,
      indent: -21,
      spacingBefore: 10,
    },
  },
  {
    name: '본문항목',
    format: { font: '바탕', size: 13, lineSpacing: 180, marginLeft: 7, indent: -19 },
  },
  {
    name: '세부항목',
    format: { font: '바탕', size: 13, lineSpacing: 180, marginLeft: 20, indent: -13 },
  },
]

const styleOf = (doc: HwpDocument, para: number) =>
  (JSON.parse(doc.getStyleAt(0, para)) as { name: string }).name
const charsOf = (doc: HwpDocument, para: number) =>
  JSON.parse(doc.getCharPropertiesAt(0, para, 0)) as {
    fontFamily: string
    fontSize: number
    bold: boolean
  }

describe('styleParagraphs', () => {
  it('makes the styles and gives each paragraph its style, in one undo step', () => {
    const { plugin, doc, steps } = open()
    const before = steps()
    const result = plugin.styleParagraphs({
      styles: [...STYLES, { name: '문서제목', format: { size: 20, bold: true, align: 'center' } }],
      apply: [
        { style: '문서제목', find: TITLE },
        { style: '중제목', startsWith: '□' },
        { style: '본문항목', startsWith: '○' },
        { style: '세부항목', startsWith: '-' },
      ],
    })
    expect(result).toMatchObject({
      ok: true,
      made: 4,
      changed: 0,
      paragraphs: 6,
      rules: [
        { style: '문서제목', paragraphs: 1 },
        { style: '중제목', paragraphs: 2 },
        { style: '본문항목', paragraphs: 2 },
        { style: '세부항목', paragraphs: 1 },
      ],
    })
    expect(steps()).toBe(before + 1)
    expect([0, 1, 2, 3, 4, 5].map((para) => styleOf(doc(), para))).toEqual([
      '문서제목',
      '중제목',
      '본문항목',
      '세부항목',
      '중제목',
      '본문항목',
    ])
    expect(charsOf(doc(), 1)).toMatchObject({ fontFamily: '맑은 고딕', fontSize: 1500, bold: true })
    expect(charsOf(doc(), 2)).toMatchObject({ fontFamily: '바탕', fontSize: 1300, bold: false })
    // the styles and what uses them survive both formats
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const again = new HwpDocument(bytes)
      expect(styleOf(again, 4)).toBe('중제목')
      expect(charsOf(again, 3).fontSize).toBe(1300)
    }
  })

  it('changes a style the document already has, and its paragraphs with it', () => {
    const { plugin, doc } = open()
    plugin.styleParagraphs({ styles: STYLES, apply: [{ style: '중제목', startsWith: '□' }] })
    const result = plugin.styleParagraphs({ styles: [{ name: '중제목', format: { size: 16 } }] })
    expect(result).toMatchObject({ ok: true, made: 0, changed: 1, paragraphs: 0 })
    expect(charsOf(doc(), 1).fontSize).toBe(1600)
    expect(charsOf(doc(), 4).fontSize).toBe(1600)
  })

  it('takes over formatting a paragraph had of its own', () => {
    const { plugin, doc } = open()
    plugin.formatParagraph('□ 추진 배경', null, { size: 30, align: 'right' })
    plugin.styleParagraphs({ styles: STYLES, apply: [{ style: '중제목', startsWith: '□' }] })
    expect(charsOf(doc(), 1).fontSize).toBe(1500)
    expect(charsOf(doc(), 4).fontSize).toBe(1500)
  })

  it('writes a font this PC has in place of one it lacks, and says so', () => {
    pcHas('맑은 고딕', '바탕')
    const { plugin, doc } = open()
    const result = plugin.styleParagraphs({
      styles: [
        { name: '중제목', format: { font: 'HY헤드라인M', size: 15 } },
        { name: '본문항목', format: { font: '휴먼명조', size: 13 } },
      ],
      apply: [
        { style: '중제목', startsWith: '□' },
        { style: '본문항목', startsWith: '○' },
      ],
    })
    expect(result).toMatchObject({
      ok: true,
      standIn: [
        { asked: 'HY헤드라인M', used: '맑은 고딕' },
        { asked: '휴먼명조', used: '바탕' },
      ],
    })
    // a headline face has no family of its weight on every PC: a gothic in bold stands in
    expect(charsOf(doc(), 1)).toMatchObject({ fontFamily: '맑은 고딕', bold: true })
    expect(charsOf(doc(), 2)).toMatchObject({ fontFamily: '바탕', bold: false })
  })

  it('writes the font as asked when the PC has it, or when its fonts are not known', () => {
    const { plugin, doc } = open()
    const spec = {
      styles: [{ name: '중제목', format: { font: 'HY헤드라인M', size: 15 } }],
      apply: [{ style: '중제목', startsWith: '□' }],
    }
    expect(plugin.styleParagraphs(spec)).not.toHaveProperty('standIn')
    expect(charsOf(doc(), 1).fontFamily).toBe('HY헤드라인M')
    pcHas('HY헤드라인M', '맑은 고딕')
    const other = open()
    expect(other.plugin.styleParagraphs(spec)).not.toHaveProperty('standIn')
    expect(charsOf(other.doc(), 1)).toMatchObject({ fontFamily: 'HY헤드라인M', bold: false })
  })

  it('refuses a rule it cannot place, and changes nothing', () => {
    const { plugin, steps } = open()
    const before = steps()
    expect(
      plugin.styleParagraphs({ styles: STYLES, apply: [{ style: '중제목', find: '없는 글' }] }),
    ).toMatchObject({ ok: false, reason: 'not_found', find: '없는 글' })
    expect(
      plugin.styleParagraphs({ apply: [{ style: '없는 스타일', startsWith: '□' }] }),
    ).toMatchObject({ ok: false, reason: 'no_such_style' })
    expect(() =>
      plugin.styleParagraphs({ apply: [{ style: '바탕글', startsWith: '□', find: '□' }] }),
    ).toThrow(/by startsWith, by numbered or by find/)
    expect(steps()).toBe(before)
  })
})

const WRAPPING =
  '연수 기간 동안 신규 직원은 부서별 실습과 멘토 면담을 거쳐 직무 기본 역량을 갖추고 수료 발표로 마무리한다'

/**
 * Where the words after the mark (character `at`) of body paragraph `para` are drawn on its
 * first line, and where its second line starts, in page pixels, as the engine lays page 1 out.
 */
function linesOf(doc: HwpDocument, para: number, at: number) {
  const { runs } = JSON.parse(doc.getPageTextLayout(0)) as {
    runs: {
      text: string
      x: number
      y: number
      charX: number[]
      paraIdx: number
      charStart: number
    }[]
  }
  const own = runs.filter((run) => run.paraIdx === para)
  const top = Math.min(...own.map((run) => run.y))
  const holder = own.find(
    (run) => run.y === top && run.charStart <= at && at < run.charStart + [...run.text].length,
  )
  const second = own.find((run) => run.y > top + 1)
  return {
    text: holder ? holder.x + holder.charX[at - holder.charStart]! : NaN,
    second: second?.x ?? null,
  }
}

const indentOf = (doc: HwpDocument, para: number) =>
  (JSON.parse(doc.getParaPropertiesAt(0, para)) as { indent: number }).indent

describe('indent "mark"', () => {
  it('hangs each paragraph by its own mark, the style by the width most have', () => {
    const lines = [`1. ${WRAPPING}`, `9. ${WRAPPING}`, `10. ${WRAPPING}`, `가. ${WRAPPING}`]
    const { plugin, doc } = open(blank(lines))
    const result = plugin.styleParagraphs({
      styles: [
        { name: '번호', format: { size: 13, align: 'left', indent: 'mark' } },
        { name: '가나', format: { size: 13, align: 'left', marginLeft: 20, indent: 'mark' } },
      ],
      apply: [
        { style: '번호', numbered: '1.' },
        { style: '가나', numbered: '가.' },
      ],
    })
    expect(result).toMatchObject({
      ok: true,
      paragraphs: 4,
      hang: { hung: 4, apart: 1, noMark: 0, outOfRange: 0 },
    })
    for (const [para, mark] of [
      [0, 3],
      [1, 3],
      [2, 4],
      [3, 3],
    ]) {
      const { text, second } = linesOf(doc(), para, mark)
      expect(second, `paragraph ${para} runs onto a second line`).not.toBeNull()
      expect(Math.abs((second as number) - text), `paragraph ${para}`).toBeLessThan(0.2)
    }
    expect(indentOf(doc(), 0)).toBe(indentOf(doc(), 1))
    expect(indentOf(doc(), 2)).toBeLessThan(indentOf(doc(), 0))
    const shapes = [0, 1, 2].map(
      (para) =>
        (JSON.parse(doc().getParaPropertiesAt(0, para)) as { paraShapeId: number }).paraShapeId,
    )
    expect(shapes[0]).toBe(shapes[1])
    expect(shapes[2]).not.toBe(shapes[0])
  })

  it('takes the width a mark has unjustified, whatever the stretch of a justified first line', () => {
    const items = [
      `○ ${WRAPPING}`,
      '○ 가나다 라마바 사아자 차카타파하가나다라마바사아자차카타파하가나다라마바사아자차카타파하가나다라마바사',
      '○ 짧은 말 하나 둘 셋 넷 다섯 여섯 일곱 여덟 아홉 열 열하나 열둘 열셋 열넷 열다섯 열여섯 열일곱',
      '○ 참고: https://www.example.com/documents/training/2026/first-half/new-staff/guide 에서 내려받는다',
    ]
    const indents = (align: string) => {
      const { plugin, doc } = open(blank(items))
      const result = plugin.styleParagraphs({
        styles: [{ name: '항목', format: { size: 13, align, indent: 'mark' } }],
        apply: [{ style: '항목', startsWith: '○' }],
      })
      expect(result, align).toMatchObject({ hang: { hung: 4, apart: 0, outOfRange: 0 } })
      return items.map((_, para) => indentOf(doc(), para))
    }
    const justified = indents('justify')
    expect(new Set(justified).size).toBe(1)
    // caret places are read to a tenth of a pixel
    indents('left').forEach((left, at) => expect(Math.abs(justified[at]! - left)).toBeLessThan(0.2))
    // 13 pt × 1.5, in the engine's page pixels: the hang of "○ " in 함초롬바탕
    expect(justified[0]).toBeCloseTo(-26, 0)
  })

  it('leaves a paragraph without a mark, and a tab under a first line set further in, as they are', () => {
    const { plugin, doc } = open(blank([`본문 ${WRAPPING}`, `1.\t탭 ${WRAPPING}`]))
    plugin.formatParagraph('본문', null, { indent: 15 })
    plugin.formatParagraph('1.\t탭', null, { indent: 20 })
    const before = [indentOf(doc(), 0), indentOf(doc(), 1)]
    expect(plugin.formatParagraph('본문', null, { indent: 'mark' })).toMatchObject({
      hang: { hung: 0, noMark: 1 },
    })
    expect(plugin.formatParagraph('1.\t탭', null, { indent: 'mark' })).toMatchObject({
      hang: { hung: 0, tab: 1 },
    })
    expect([indentOf(doc(), 0), indentOf(doc(), 1)]).toEqual(before)
  })

  it('does not count paragraphs without a mark as hung apart, and keeps their indent', () => {
    const { plugin, doc } = open(blank([`○ ${WRAPPING}`, `○ 둘 ${WRAPPING}`, `본문 ${WRAPPING}`]))
    plugin.createStyle({ name: '항목', format: { align: 'left' } })
    plugin.formatParagraph('본문', null, { style: '항목' })
    const result = plugin.styleParagraphs({
      styles: [{ name: '항목', format: { size: 12, indent: 'mark' } }],
      apply: [{ style: '항목', startsWith: '○' }],
    })
    expect(result).toMatchObject({ hang: { hung: 2, apart: 0, noMark: 1, kept: 1 } })
    expect(indentOf(doc(), 0)).toBeLessThan(0)
    expect(indentOf(doc(), 2)).toBe(0)
  })

  it('measures the paragraphs of a style in table cells too, and refuses a style no paragraph has', () => {
    const { plugin, doc } = open(blank(['표 앞 문단']))
    plugin.insertTable('표 앞 문단', null, 'after', [['구분', `○ 칸 ${WRAPPING}`]])
    plugin.styleParagraphs({
      styles: [{ name: '칸항목', format: { size: 11, align: 'left' } }],
      apply: [{ style: '칸항목', find: '○ 칸' }],
    })
    expect(plugin.editStyle('칸항목', { format: { size: 14, indent: 'mark' } })).toMatchObject({
      ok: true,
      hang: { hung: 1, split: 0 },
    })
    const para = [0, 1, 2].find((at) => {
      try {
        tableIn(doc(), at)
        return true
      } catch {
        return false
      }
    })!
    const { control } = tableIn(doc(), para)
    const cellIndent = (
      JSON.parse(doc().getCellParaPropertiesAt(0, para, control, 1, 0)) as { indent: number }
    ).indent
    expect(cellIndent).toBeLessThan(-20)
    plugin.createStyle({ name: '빈', format: { size: 12 } })
    expect(() => plugin.editStyle('빈', { format: { indent: 'mark' } })).toThrow(
      /this style has none/,
    )
  })

  it('follows a later change of the font size when asked again, and a style edit', () => {
    const { plugin, doc } = open(blank([`가. ${WRAPPING}`, `나. ${WRAPPING}`]))
    plugin.styleParagraphs({
      styles: [{ name: '가나', format: { size: 11, align: 'left', indent: 'mark' } }],
      apply: [{ style: '가나', numbered: '가.' }],
    })
    const small = indentOf(doc(), 0)
    const edited = plugin.editStyle('가나', { format: { size: 16, indent: 'mark' } })
    expect(edited).toMatchObject({ ok: true, hang: { hung: 2 } })
    expect(indentOf(doc(), 0)).toBeLessThan(small)
    const { text, second } = linesOf(doc(), 1, 3)
    expect(Math.abs((second as number) - text)).toBeLessThan(0.2)
  })

  it('hangs one paragraph by its mark with formatParagraph', () => {
    const { plugin, doc } = open(blank([`□ ${WRAPPING}`]))
    expect(
      plugin.formatParagraph('□ 연수', null, { size: 14, align: 'left', indent: 'mark' }),
    ).toMatchObject({ ok: true, hang: { hung: 1 } })
    const { text, second } = linesOf(doc(), 0, 2)
    expect(Math.abs((second as number) - text)).toBeLessThan(0.2)
  })

  it('refuses another word, and a new style with nothing to measure', () => {
    const { plugin, steps } = open()
    const before = steps()
    expect(() =>
      plugin.styleParagraphs({ styles: [{ name: '새', format: { indent: 'makr' } }] }),
    ).toThrow(/indent must be -100 to 100 points, or "mark"/)
    expect(() => plugin.createStyle({ name: '새', format: { indent: 'mark' } })).toThrow(
      /a new style has none: give indent in points, or make and apply the style with style_paragraphs/,
    )
    expect(steps()).toBe(before)
  })
})

describe('indent "mark" by construction', () => {
  const hangsOf = (
    lines: string[],
    align: string,
    before?: (doc: HwpDocument) => void,
    startsWith?: string,
  ) => {
    const start = blank(lines)
    before?.(start)
    const { plugin, doc } = open(start)
    const result = plugin.styleParagraphs({
      styles: [{ name: '항목', format: { size: 12, align, indent: 'mark' } }],
      apply: startsWith
        ? [{ style: '항목', startsWith }]
        : lines.map((line) => ({ style: '항목', find: [...line].slice(0, 4).join('') })),
    })
    return { result, indents: lines.map((_, para) => indentOf(doc(), para)) }
  }
  const sameAsLeft = (
    lines: string[],
    before?: (doc: HwpDocument) => void,
    startsWith?: string,
  ) => {
    const justified = hangsOf(lines, 'justify', before, startsWith)
    const left = hangsOf(lines, 'left', before, startsWith)
    expect(justified.result).toMatchObject({ hang: { hung: lines.length } })
    left.indents.forEach((indent, at) =>
      expect(Math.abs(justified.indents[at]! - indent), lines[at]).toBeLessThan(0.2),
    )
    return justified
  }

  it('reads a line with characters outside the Basic Multilingual Plane right', () => {
    sameAsLeft([`○ 이모지😀😀😀😀😀😀 ${WRAPPING}`, `○ 한자𠀀𠀁𠀂𠀃 ${WRAPPING}`])
  })

  it('reads a line with a tab later in it right', () => {
    sameAsLeft([
      `○ 문의\t교육지원과 장학사 홍길동 ${WRAPPING}`,
      `□ 붙임\t2026학년도 운영 계획 ${WRAPPING}`,
    ])
  })

  it('gives marks after leading spaces one width', () => {
    const lines = [
      `  - 세부 내용 ${WRAPPING}`,
      '  - 가나다 라마바 사아자 차카타파하가나다라마바사아자차카타파하가나다라마바사아자차카타파하',
      '  - 짧은 말 하나 둘 셋 넷 다섯 여섯 일곱 여덟 아홉 열 열하나 열둘 열셋 열넷 열다섯 열여섯',
      '  - 세부내용연수기간동안신규직원은부서별실습과멘토면담을거쳐직무기본역량을갖추고 끝말',
    ]
    const { result, indents } = sameAsLeft(lines, undefined, '-')
    expect(result).toMatchObject({ hang: { hung: 4, apart: 0 } })
    expect(new Set(indents).size).toBe(1)
  })

  it('reads a mark in another size than its text', () => {
    const hang = (align: string) => {
      const { plugin, doc } = open(blank([`◆ 큰 표지 ${WRAPPING}`]))
      plugin.formatParagraph('◆ 큰', null, { size: 12, align })
      plugin.formatText('◆', null, false, { size: 18 })
      expect(plugin.formatParagraph('◆ 큰', null, { indent: 'mark' }), align).toMatchObject({
        hang: { hung: 1 },
      })
      return indentOf(doc(), 0)
    }
    expect(Math.abs(hang('justify') - hang('left'))).toBeLessThan(0.2)
  })

  it('reads the space from the first line where no last line holds one in its size', () => {
    const line =
      '가. 연수 기간 동안 신규 직원은 부서별 실습과 멘토 면담을 거쳐 직무 기본 역량을 갖추고 수료 발표로 마무리하며 그 결과를 정리한다'
    const hang = (align: string) => {
      const { plugin, doc } = open(blank([line]))
      const result = plugin.styleParagraphs({
        styles: [{ name: '소', format: { size: 14, marginLeft: 20, align, indent: 'mark' } }],
        apply: [{ style: '소', numbered: '가.' }],
      })
      expect(result, align).toMatchObject({ hang: { hung: 1, noSpace: 0 } })
      return indentOf(doc(), 0)
    }
    expect(Math.abs(hang('justify') - hang('left'))).toBeLessThan(0.3)
  })

  it('leaves right, centred and spread paragraphs as they are, and says so', () => {
    for (const alignment of ['right', 'center', 'distribute']) {
      const start = blank([`○ ${WRAPPING}`])
      start.applyParaFormat(0, 0, JSON.stringify({ alignment }))
      const { plugin, doc } = open(start)
      const before = indentOf(doc(), 0)
      expect(plugin.formatParagraph('○ 연수', null, { indent: 'mark' }), alignment).toMatchObject({
        hang: { hung: 0, alignment: 1 },
      })
      expect(indentOf(doc(), 0), alignment).toBe(before)
    }
  })

  it('changes nothing when edit_style with "mark" alone hangs no paragraph', () => {
    const start = blank([`○ ${WRAPPING}`, `○ 둘 ${WRAPPING}`])
    const { plugin, steps } = open(start)
    plugin.styleParagraphs({
      styles: [{ name: '가운데', format: { align: 'center' } }],
      apply: [{ style: '가운데', startsWith: '○' }],
    })
    const before = steps()
    expect(plugin.editStyle('가운데', { format: { indent: 'mark' } })).toMatchObject({
      ok: false,
      reason: 'not_hung',
      hang: { hung: 0, alignment: 2 },
    })
    expect(steps()).toBe(before)
  })

  it('names the paragraphs in tables inside cells it could not look at', () => {
    const nested = new HwpDocument(readFileSync(join(__dirname, 'fixtures', 'nested-form.hwp')))
    const { plugin } = open(nested)
    const result = plugin.editStyle('바탕글', { format: { align: 'left', indent: 'mark' } })
    expect(result).toMatchObject({ ok: true })
    expect((result as { hang: { unread: number } }).hang.unread).toBeGreaterThan(0)
  })

  it('counts formatting in a table inside a cell against a plain look', () => {
    const nested = new HwpDocument(readFileSync(join(__dirname, 'fixtures', 'nested-form.hwp')))
    const { plugin } = open(nested)
    expect(plugin.documentShape().plain.tables).toBe(true)
    plugin.formatText('평가 종류', null, false, { bold: true })
    expect(plugin.documentShape().plain.tables).toBe(false)
  })

  it('marks a rule whose lines were all left out on purpose', () => {
    const { plugin } = open(blank(['○○ 사업 담당자', '본문 한 줄']))
    expect(
      plugin.styleParagraphs({
        styles: [{ name: '항목', format: { bold: true } }],
        apply: [{ style: '항목', startsWith: '○' }],
      }),
    ).toMatchObject({ rules: [{ style: '항목', paragraphs: 0, skipped: 1 }] })
  })
})

describe('indent "mark" on lines that keep their spaces', () => {
  /**
   * What edit_style 바탕글 "mark" does to `lines`, paragraph `odd` aligned `align` and the
   * others `rest`: the answer and each paragraph's indent after it.
   */
  const hangs = (lines: string[], odd: number, align: string, rest: string) => {
    const start = blank(lines)
    lines.forEach((_, para) =>
      start.applyParaFormat(0, para, JSON.stringify({ alignment: para === odd ? align : rest })),
    )
    const { plugin, doc } = open(start)
    const result = plugin.editStyle('바탕글', { format: { indent: 'mark' } })
    return { result, indents: lines.map((_, para) => indentOf(doc(), para)) }
  }
  const LINES_OF_MARKS = [
    `□ 배분 정렬 제목 문단 ${WRAPPING}`,
    `○ 기준 문단 ${WRAPPING}`,
    `○ 둘째 문단 ${WRAPPING}`,
  ]

  it('takes no space from a spread or split paragraph, whichever comes first', () => {
    for (const align of ['distribute', 'split']) {
      for (const odd of [0, LINES_OF_MARKS.length - 1]) {
        const lines = odd === 0 ? LINES_OF_MARKS : [...LINES_OF_MARKS.slice(1), LINES_OF_MARKS[0]!]
        const justified = hangs(lines, odd, align, 'justify')
        const left = hangs(lines, odd, align, 'left')
        expect(justified.result, `${align} ${odd}`).toMatchObject({
          ok: true,
          hang: { hung: 2, alignment: 1, outOfRange: 0 },
        })
        lines.forEach((_, para) => {
          if (para === odd) return
          const off = Math.abs(justified.indents[para]! - left.indents[para]!)
          expect(off, `${align} ${odd} ${para}`).toBeLessThan(0.2)
        })
      }
    }
  })

  /** What format_paragraph "mark" does to `text` in `columns` columns, in `size` and `align`. */
  const columnHang = (text: string, columns: number, size: number, align: string) => {
    const { plugin, doc } = open(blank([text]))
    plugin.setColumns({ count: columns })
    plugin.formatParagraph(text.slice(0, 8), null, { size, align })
    const result = plugin.formatParagraph(text.slice(0, 8), null, { indent: 'mark' })
    return { result, indent: indentOf(doc(), 0) }
  }

  it('counts the lines of a paragraph in columns by the paragraph, not by where they stand', () => {
    const text = `○ ${WRAPPING} ${WRAPPING} ${WRAPPING} 연수 기간 동안 신규`
    const justified = columnHang(text, 2, 22, 'justify')
    const left = columnHang(text, 2, 22, 'left')
    expect(justified.result).toMatchObject({ hang: { hung: 1 } })
    expect(Math.abs(justified.indent - left.indent)).toBeLessThan(0.2)
  })

  it('reads the space after a mark in the language slot the editor sets it in', () => {
    const lines = ['1.', '2.', '3.'].map((number) => `${number} 가나다라 마바사 아자차 ${WRAPPING}`)
    for (const latin of [80, 50, 150]) {
      const ratios = [100, latin, 100, 100, 100, 100, 100]
      const indents = (align: string) => {
        const start = blank(lines)
        lines.forEach((line, para) =>
          start.applyCharFormat(0, para, 0, [...line].length, JSON.stringify({ ratios })),
        )
        const { plugin, doc } = open(start)
        expect(
          plugin.styleParagraphs({
            styles: [{ name: '항목', format: { align, indent: 'mark' } }],
            apply: [{ style: '항목', numbered: '1.' }],
          }),
        ).toMatchObject({ hang: { hung: 3 } })
        return lines.map((_, para) => indentOf(doc(), para))
      }
      const left = indents('left')
      indents('justify').forEach((indent, para) =>
        expect(Math.abs(indent - left[para]!), `${latin} ${para}`).toBeLessThan(0.2),
      )
    }
  })

  it('leaves a paragraph with a field before or inside its mark as it is, and says so', () => {
    for (const offset of [0, 1]) {
      const start = blank([`○ 누름틀 문단 ${WRAPPING}`, `○ 보통 문단 ${WRAPPING}`])
      start.insertClickHereField(0, 0, offset, '여기에 입력', '', 'f1', true)
      const { plugin, doc } = open(start)
      expect(
        plugin.formatParagraph('누름틀 문단', null, { indent: 'mark' }),
        `${offset}`,
      ).toMatchObject({ hang: { hung: 0, object: 1 } })
      expect(indentOf(doc(), 0), `${offset}`).toBe(0)
    }
    const after = blank([`○ 누름틀 문단 ${WRAPPING}`])
    after.insertClickHereField(0, 0, 2, '여기에 입력', '', 'f1', true)
    expect(
      open(after).plugin.formatParagraph('누름틀 문단', null, { indent: 'mark' }),
    ).toMatchObject({ hang: { hung: 1, object: 0 } })
  })

  it('keeps the indent of the paragraphs it does not hang under a style that takes a hang', () => {
    const lines = [
      `○ 항목 ${WRAPPING}`,
      `본문 산문 ${WRAPPING}`,
      `본문 들여쓴 ${WRAPPING}`,
      `○ 배분 ${WRAPPING}`,
      `○ 둘째 항목 ${WRAPPING}`,
    ]
    const start = blank(lines)
    start.applyParaFormat(0, 2, JSON.stringify({ indent: 2000 }))
    start.applyParaFormat(0, 3, JSON.stringify({ alignment: 'distribute' }))
    const { plugin, doc } = open(start)
    const before = lines.map((_, para) => indentOf(doc(), para))
    expect(plugin.editStyle('바탕글', { format: { indent: 'mark' } })).toMatchObject({
      ok: true,
      hang: { hung: 2, noMark: 2, alignment: 1, kept: 2 },
    })
    expect(indentOf(doc(), 0)).toBeLessThan(0)
    for (const para of [1, 2, 3]) expect(indentOf(doc(), para), `${para}`).toBe(before[para])
    expect(indentOf(doc(), 4)).toBe(indentOf(doc(), 0))
  })

  it('hangs the marked paragraphs of a style in a text box and keeps the indent of the others', () => {
    const start = blank([`○ 항목 ${WRAPPING}`, '', ''])
    const boxes = [1, 2].map((para) => {
      const made = JSON.parse(
        start.createShapeControl(
          JSON.stringify({
            sectionIdx: 0,
            paraIdx: para,
            charOffset: 0,
            width: 30000,
            height: 12000,
            horzOffset: 0,
            vertOffset: 0,
            treatAsChar: true,
          }),
        ),
      ) as { paraIdx: number; controlIdx: number }
      start.setTextBoxAt(made.paraIdx, made.controlIdx, true)
      return JSON.stringify([{ controlIndex: made.controlIdx, cellIndex: 0, cellParaIndex: 0 }])
    })
    start.insertTextInCellByPath(0, 1, boxes[0]!, 0, `상자 산문 ${WRAPPING}`)
    start.insertTextInCellByPath(0, 2, boxes[1]!, 0, `○ 상자 항목 ${WRAPPING}`)
    const { plugin, doc } = open(start)
    const boxIndent = (para: number) =>
      (
        JSON.parse(doc().getCellParaPropertiesAtByPath(0, para, boxes[para - 1]!)) as {
          indent: number
        }
      ).indent
    expect(plugin.editStyle('바탕글', { format: { indent: 'mark' } })).toMatchObject({
      ok: true,
      hang: { hung: 2 },
    })
    expect(boxIndent(1)).toBe(0)
    expect(boxIndent(2)).toBeLessThan(0)
  })

  it('names the shapes it cannot look into only for a style that could be in them', () => {
    const letter = () =>
      open(new HwpDocument(readFileSync(join(__dirname, 'fixtures', 'shape-in-cell-letter.hwp'))))
    const made = letter().plugin.styleParagraphs({
      styles: [{ name: '항목', format: { indent: 'mark' } }],
      apply: [{ style: '항목', startsWith: '○' }],
    }) as { hang: { hung: number; unreachedShapes?: number } }
    expect(made.hang.hung).toBe(2)
    expect(made.hang.unreachedShapes).toBeUndefined()
    expect(letter().plugin.editStyle('바탕글', { format: { indent: 'mark' } })).toMatchObject({
      ok: true,
      hang: { unreachedShapes: 1 },
    })
  })

  it('changes nothing when format_paragraph with "mark" alone hangs nothing', () => {
    const start = blank([`○ 하나 ${WRAPPING}`])
    start.applyParaFormat(0, 0, JSON.stringify({ alignment: 'center' }))
    const { plugin, steps } = open(start)
    expect(plugin.formatParagraph('○ 하나', null, { indent: 'mark' })).toMatchObject({
      ok: false,
      reason: 'not_hung',
      hang: { hung: 0, alignment: 1 },
    })
    expect(steps()).toBe(0)
  })

  it('changes nothing when format_look with "mark" alone hangs no paragraph', () => {
    const start = blank([`○ 하나 ${WRAPPING}`, `○ 둘 ${WRAPPING}`])
    for (const para of [0, 1])
      start.applyParaFormat(0, para, JSON.stringify({ alignment: 'center' }))
    const { plugin, steps } = open(start)
    const read = plugin.formatting()
    if (!read.ok) throw new Error('not read')
    const look = read.looks.find((entry) => entry.paragraphs === 2)!
    const before = steps()
    expect(plugin.formatLook(look.id!, { indent: 'mark' })).toMatchObject({
      ok: false,
      reason: 'not_hung',
      hang: { hung: 0, alignment: 2 },
    })
    expect(steps()).toBe(before)
  })

  it('keeps a hang within half the column the paragraph stands in', () => {
    const lines = ['가', '나', '다'].map(
      (first) => `□ ${first}나다라 마바사 아자차 카타파하 가나다 라마바사`,
    )
    const { plugin, doc } = open(blank(lines))
    plugin.setColumns({ count: 4 })
    ;[30, 34, 37].forEach((size, para) => {
      const find = lines[para]!.slice(2, 9)
      plugin.formatParagraph(find, null, { size })
      const { hang } = plugin.formatParagraph(find, null, { indent: 'mark' }) as {
        hang: { hung: number; outOfRange: number; split: number }
      }
      expect(hang.hung, find).toBe(0)
      expect(hang.outOfRange + hang.split, find).toBe(1)
      expect(indentOf(doc(), para), find).toBe(0)
    })
  })
})

describe('the shape the context tells', () => {
  it('says an empty document is plain and on one paper', () => {
    const empty = HwpDocument.createEmpty()
    empty.createBlankDocument()
    expect(open(empty).plugin.documentShape()).toMatchObject({
      pages: 1,
      paper: 'A4',
      orientation: 'portrait',
      columns: 1,
      plain: { body: true, tables: null },
    })
    expect(open(empty).plugin.documentShape()).not.toHaveProperty('otherPapers')
  })

  it('tells formatting in a table apart from plain body text', () => {
    const { plugin } = open(blank(['표 앞 문단', '본문 한 줄']))
    expect(plugin.documentShape().plain).toEqual({ body: true, tables: null })
    plugin.insertTable('표 앞 문단', null, 'after', ROWS, true)
    expect(plugin.documentShape().plain).toEqual({ body: true, tables: false })
    plugin.formatParagraph('본문 한 줄', null, { bold: true })
    expect(plugin.documentShape().plain).toEqual({ body: false, tables: false })
  })

  it('says the search for tables inside cells stopped only when a cell paragraph was left unasked', () => {
    const doc = blank(['표 앞'])
    doc.createTable(0, 0, 0, 2, 3)
    // six cell paragraphs, three engine calls each
    expect(tablesOf(doc, Infinity, 18).partial).toBe(false)
    expect(tablesOf(doc, Infinity, 16).partial).toBe(false)
    expect(tablesOf(doc, Infinity, 15).partial).toBe(true)
    expect(tablesOf(doc, Infinity).partial).toBe(false)
  })

  it('reads formatting in a table nested deeper than the list of tables goes', () => {
    const start = blank(['표 앞'])
    const made = JSON.parse(start.createTable(0, 0, 0, 2, 2)) as {
      paraIdx: number
      controlIdx: number
    }
    let path = [{ controlIndex: made.controlIdx, cellIndex: 0, cellParaIndex: 0 }]
    for (let level = 1; level <= 4; level++) {
      const inner = JSON.parse(
        start.createTableInCellByPath(
          0,
          made.paraIdx,
          JSON.stringify(path),
          0,
          JSON.stringify({ rowCount: 1, colCount: 2 }),
        ),
      ) as { cellPath: typeof path }
      path = inner.cellPath
    }
    start.insertTextInCellByPath(0, made.paraIdx, JSON.stringify(path), 0, '깊은 칸 굵은 글')
    const { plugin, doc } = open(start)
    expect(plugin.documentShape().plain.tables).toBe(true)
    doc().applyCharFormatInCellByPath(0, made.paraIdx, JSON.stringify(path), 0, 4, '{"bold":true}')
    expect(plugin.documentShape().plain.tables).toBe(false)
  })

  it('names a later section on another paper', () => {
    const sections = new HwpDocument(
      readFileSync(join(__dirname, 'fixtures', 'master-page-next-section.hwpx')),
    )
    const { plugin } = open(sections)
    expect(plugin.documentShape()).not.toHaveProperty('otherPapers')
    expect(plugin.setPageSetup({ orientation: 'landscape' }, 2)).toMatchObject({ ok: true })
    expect(plugin.documentShape().otherPapers).toEqual([
      expect.objectContaining({ section: 2, orientation: 'landscape' }),
    ])
  })
})

describe('the lines a second style call counts', () => {
  it('counts only lines still in the default style, and none for a call by find alone', () => {
    const { plugin } = open(blank(['□ 첫째', '○ 둘째', '본문 한 줄']))
    plugin.styleParagraphs({
      styles: [{ name: '큰', format: { bold: true } }],
      apply: [{ style: '큰', startsWith: '□' }],
    })
    expect(
      plugin.styleParagraphs({
        styles: [{ name: '작은', format: { italic: true } }],
        apply: [{ style: '작은', startsWith: '○' }],
      }),
    ).toMatchObject({ ok: true, unmatched: 1 })
    expect(
      plugin.styleParagraphs({
        styles: [{ name: '제목', format: { size: 20 } }],
        apply: [{ style: '제목', find: '본문 한 줄' }],
      }),
    ).not.toHaveProperty('unmatched')
  })
})

describe('the limits of one call', () => {
  it('states each limit and sends the rest to another call, and changes nothing', () => {
    const { plugin, steps } = open()
    const before = steps()
    const many = (count: number) => Array.from({ length: count }, (_, index) => `문단 ${index + 1}`)
    expect(() => plugin.insertParagraphs('', null, 'end', many(101))).toThrow(
      /^paragraphs takes up to 100; send the rest in another call$/,
    )
    expect(() => plugin.insertEquations(many(61).map((find) => ({ find, script: 'x^2' })))).toThrow(
      /^equations takes up to 60; send the rest in another call$/,
    )
    expect(() =>
      plugin.styleParagraphs({
        styles: many(13).map((name) => ({ name, format: { bold: true } })),
      }),
    ).toThrow(/^styles takes up to 12; send the rest in another call$/)
    expect(() =>
      plugin.styleParagraphs({
        apply: many(41).map((find) => ({ style: '바탕글', find })),
      }),
    ).toThrow(/^apply takes up to 40 rules; send the rest in another call$/)
    expect(() =>
      plugin.insertTable(
        TITLE,
        null,
        'after',
        Array.from({ length: 101 }, () => many(4)),
      ),
    ).toThrow(/^a new table takes up to 400 cells; .* add_to_table in another call$/)
    expect(steps()).toBe(before)
  })
})

describe('the lines a style rule takes', () => {
  const LINES_OF_RULES = [
    '○○ 사업 담당자: 홍길동',
    '○ ○○초등학교 강당에서 진행',
    '○ 일시: 11. 12.(목)',
    '- 준비물: 필기도구',
    '- -5℃ 이하에서는 야외 활동 금지',
    '- - - 절취선 - - -',
    '11. 12.(목) 09:00 개회',
    '3. 0.5의 역수를 구하시오.',
    '가.접수 기간',
    '본문 한 줄',
  ]

  it('leaves a placeholder, a cut line and a date alone, and names what it left', () => {
    const { plugin, doc } = open(blank(LINES_OF_RULES))
    const result = plugin.styleParagraphs({
      styles: [
        { name: '항목', format: { bold: true } },
        { name: '줄표', format: { marginLeft: 10 } },
        { name: '번호', format: { italic: true } },
        { name: '가나', format: { size: 12 } },
      ],
      apply: [
        { style: '항목', startsWith: '○' },
        { style: '줄표', startsWith: '-' },
        { style: '번호', numbered: '1.' },
        { style: '가나', numbered: '가.' },
      ],
    })
    expect(result).toMatchObject({
      ok: true,
      madeStyles: ['항목', '줄표', '번호', '가나'],
      changedStyles: [],
      unmatched: 5,
      withoutSpace: ['가.접수 기간'],
      rules: [
        { style: '항목', paragraphs: 2 },
        { style: '줄표', paragraphs: 2 },
        { style: '번호', paragraphs: 1 },
        { style: '가나', paragraphs: 0 },
      ],
    })
    expect([0, 5, 6, 8, 9].map((para) => styleOf(doc(), para))).toEqual(Array(5).fill('바탕글'))
    expect(
      plugin.styleParagraphs({ apply: [{ style: '줄표', startsWith: '- - -' }] }),
    ).toMatchObject({ ok: true, paragraphs: 1, madeStyles: [], changedStyles: [] })
    expect(styleOf(doc(), 5)).toBe('줄표')
  })

  it('names a style it changed by the name the document has', () => {
    const { plugin } = open(blank(['□ 첫째', '○ 둘째', '본문']))
    plugin.createStyle({ name: '항목', format: { size: 12 } })
    expect(
      plugin.styleParagraphs({
        styles: [
          { name: '항목', format: { bold: true } },
          { name: '소항목', format: { marginLeft: 14 } },
        ],
        apply: [
          { style: '항목', startsWith: '□' },
          { style: '소항목', startsWith: '○' },
        ],
      }),
    ).toMatchObject({
      ok: true,
      made: 1,
      changed: 1,
      madeStyles: ['소항목'],
      changedStyles: ['항목'],
      unmatched: 1,
    })
  })
})

describe('insertTitleBox', () => {
  it('turns the title paragraph into a box with bands of colour, its words inside', () => {
    const { plugin, doc, steps } = open()
    plugin.formatParagraph(TITLE, null, { size: 20, bold: true })
    const before = steps()
    const result = plugin.insertTitleBox(TITLE, null, {
      look: 'bands',
      color: '#1F3864',
      color2: '#C00000',
    })
    expect(result).toMatchObject({ ok: true, look: 'bands' })
    expect(steps()).toBe(before + 1)
    const table = tableIn(doc(), 0)
    expect([table.rows, table.cols]).toEqual([3, 1])
    expect(table.cell(0)).toMatchObject({ fillType: 'solid', fillColor: '#1f3864', height: 567 })
    expect(table.cell(2)).toMatchObject({ fillType: 'solid', fillColor: '#c00000' })
    for (const cell of [0, 1, 2]) {
      expect(table.cell(cell).borderLeft.type).toBe(0)
      expect(table.cell(cell).borderTop.type).toBe(0)
    }
    // the words moved into the middle cell with the look they had, centred
    expect(doc().getTextInCell(0, 0, table.control, 1, 0, 0, TITLE.length)).toBe(TITLE)
    const chars = JSON.parse(doc().getCellCharPropertiesAt(0, 0, table.control, 1, 0, 0)) as {
      fontSize: number
      bold: boolean
    }
    expect(chars).toMatchObject({ fontSize: 2000, bold: true })
    const paragraph = JSON.parse(doc().getCellParaPropertiesAt(0, 0, table.control, 1, 0)) as {
      alignment: string
    }
    expect(paragraph.alignment).toBe('center')
    // the rest of the document is where it was
    expect(doc().getTextRange(0, 1, 0, 7)).toBe('□ 추진 배경')
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const again = tableIn(new HwpDocument(bytes), 0)
      expect([again.rows, again.cell(0).fillColor]).toEqual([3, '#1f3864'])
    }
  })

  it('makes the other looks as one cell', () => {
    for (const [look, check] of [
      [
        'lines',
        (cell: Cell) => expect([cell.borderTop.type, cell.borderLeft.type]).toEqual([1, 0]),
      ],
      ['box', (cell: Cell) => expect([cell.borderTop.type, cell.borderLeft.type]).toEqual([1, 1])],
      [
        'shaded',
        (cell: Cell) => expect([cell.fillType, cell.borderTop.type]).toEqual(['solid', 0]),
      ],
    ] as const) {
      const { plugin, doc } = open()
      expect(plugin.insertTitleBox(TITLE, null, { look })).toMatchObject({ ok: true, look })
      const table = tableIn(doc(), 0)
      expect(table.rows).toBe(1)
      check(table.cell(0))
    }
  })

  it('refuses the text of any table, whatever its shape, and leaves it as it was', () => {
    const boxes: [string, string[][], (plugin: ReturnType<typeof open>['plugin']) => void][] = [
      ['안전 교육은 출발 전날에 합니다.', [['안전 교육은 출발 전날에 합니다.']], () => {}],
      [
        '서류는 행정실로',
        [['서류는 행정실로 제출합니다.']],
        (plugin) =>
          plugin.formatCells(1, null, {
            borders: [{ sides: 'all', line: 'double', width: 0.7, color: '#2F5597' }],
            heightMm: 25,
            verticalAlign: 'top',
            background: '#FFF2CC',
          }),
      ],
      ['안내 사항', [['안내 사항'], [''], ['']], () => {}],
      ['의견', [['의견'], [''], [''], ['']], () => {}],
      [
        '네 칸 상자',
        [['네 칸 상자']],
        (plugin) =>
          plugin.formatCells(1, null, {
            borders: [{ sides: 'all', line: 'solid', width: 0.4, color: '#000000' }],
            verticalAlign: 'middle',
          }),
      ],
      [
        '알려 드립니다',
        [['알려 드립니다']],
        (plugin) => plugin.formatCells(1, null, { borders: [{ sides: 'all', width: 0.5 }] }),
      ],
      [
        '채운 상자',
        [['채운 상자']],
        (plugin) =>
          plugin.formatCells(1, null, {
            borders: [{ sides: 'all', line: 'none' }],
            background: '#E7EDF5',
          }),
      ],
    ]
    for (const [text, rows, shape] of boxes) {
      const { plugin, doc, steps } = open()
      plugin.insertTable('□ 세부 일정', null, 'after', rows)
      shape(plugin)
      const was = doc().exportHwp()
      const before = steps()
      expect(plugin.insertTitleBox(text, null, { look: 'shaded', color: '#C00000' })).toMatchObject(
        { ok: false, reason: 'in_table', table: 1 },
      )
      expect(steps()).toBe(before)
      expect(doc().exportHwp()).toEqual(was)
    }
  })

  it('refuses the text of a title box it made too, before and after the user changed it', () => {
    const { plugin, doc, steps } = open()
    plugin.insertTitleBox(TITLE, null, { look: 'box' })
    for (const change of [
      () => {},
      () => plugin.formatCells(1, null, { borders: [{ sides: 'all', color: '#C00000' }] }),
      () => plugin.formatCells(1, null, { background: '#FFF2CC' }),
      () => plugin.formatCells(1, null, { verticalAlign: 'top' }),
    ]) {
      change()
      const was = doc().exportHwp()
      const before = steps()
      expect(plugin.insertTitleBox(TITLE, null, { look: 'lines' })).toMatchObject({
        ok: false,
        reason: 'in_table',
        table: 1,
      })
      expect([steps(), doc().exportHwp()]).toEqual([before, was])
    }
  })

  it('refuses text in a table cell and a look it does not know', () => {
    const { plugin, steps } = withTable()
    const before = steps()
    expect(plugin.insertTitleBox('국립중앙박물관', null, { look: 'box' })).toMatchObject({
      ok: false,
      reason: 'in_table',
    })
    expect(() => plugin.insertTitleBox(TITLE, null, { look: 'ribbon' as never })).toThrow(
      /look must be one of/,
    )
    expect(steps()).toBe(before)
  })
})

describe('page number, header and footer', () => {
  it('numbers the pages and reads the setting back', () => {
    const { plugin, doc, steps } = open()
    expect(plugin.pageLayout()).toMatchObject({
      pageNumber: null,
      header: { exists: false },
      footer: { exists: false },
    })
    const before = steps()
    expect(plugin.setPageNumber({ position: 'bottom_center' })).toMatchObject({
      ok: true,
      pageNumber: { position: 'bottom_center', format: 'digit', dashes: true },
    })
    expect(steps()).toBe(before + 1)
    plugin.setPageNumber({ position: 'bottom_right', format: 'upperRoman', dashes: false })
    expect(plugin.pageLayout().pageNumber).toEqual({
      position: 'bottom_right',
      format: 'upperRoman',
      dashes: false,
    })
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const again = JSON.parse(new HwpDocument(bytes).getPageNumberPos(0)) as {
        pageNumber: { position: number; format: number; dash: boolean }
      }
      expect(again.pageNumber).toMatchObject({ position: 6, format: 2, dash: false })
    }
    expect(() => plugin.setPageNumber({ position: 'middle' as never })).toThrow(
      /position must be one of/,
    )
  })

  it('writes a header and a footer with the page number, rewrites and removes them', () => {
    const { plugin, doc } = open()
    expect(
      plugin.setHeaderFooter('header', { text: '○○초등학교 교무기획부', align: 'right', size: 9 }),
    ).toMatchObject({
      ok: true,
      kind: 'header',
      removed: false,
    })
    expect(
      plugin.setHeaderFooter('footer', { text: '운영 계획 | {page} / {pages}' }),
    ).toMatchObject({
      ok: true,
      kind: 'footer',
    })
    const layout = plugin.pageLayout()
    expect(layout.header).toEqual({
      exists: true,
      text: '○○초등학교 교무기획부',
      plain: true,
      align: 'right',
      size: 9,
    })
    expect(layout.footer).toEqual({
      exists: true,
      text: '운영 계획 | {page} / {pages}',
      plain: true,
      align: 'center',
      size: 10,
    })
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const again = new HwpDocument(bytes)
      expect((JSON.parse(again.getHeaderFooter(0, true, 0)) as { text: string }).text).toBe(
        '○○초등학교 교무기획부',
      )
      expect((JSON.parse(again.getHeaderFooter(0, false, 0)) as { exists: boolean }).exists).toBe(
        true,
      )
    }
    plugin.setHeaderFooter('header', { text: '교무기획부' })
    expect(plugin.pageLayout().header).toMatchObject({ text: '교무기획부', align: 'right' })
    plugin.setHeaderFooter('header', { text: '교무기획부', align: 'left' })
    expect(plugin.pageLayout().header).toMatchObject({ align: 'left' })
    expect(() =>
      plugin.setHeaderFooter('header', { text: '교무기획부', align: 'justify' as never }),
    ).toThrow(/align must be one of left, center, right/)
    expect(plugin.setHeaderFooter('header', { text: '' })).toMatchObject({
      ok: true,
      removed: true,
    })
    expect(plugin.pageLayout().header).toEqual({ exists: false })
    expect(plugin.setHeaderFooter('header', { text: '' })).toEqual({
      ok: false,
      reason: 'not_there',
    })
  })

  it('takes a footer back as it was read, page fields and all', () => {
    const { plugin, doc } = open()
    plugin.setHeaderFooter('footer', { text: '{page} / {pages}', align: 'right', size: 9 })
    const {
      exists: _exists,
      plain: _plain,
      ...read
    } = plugin.pageLayout().footer as {
      exists: true
      plain: boolean
      text: string
      align?: 'left' | 'center' | 'right'
      size?: number
    }
    expect(read).toEqual({ text: '{page} / {pages}', align: 'right', size: 9 })
    plugin.setHeaderFooter('footer', { text: '다른 글', align: 'left', size: 12 })
    plugin.setHeaderFooter('footer', read)
    expect(plugin.pageLayout().footer).toMatchObject(read)
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const page = new HwpDocument(bytes).renderPageSvgWithProfile(0, 'print')
      const drawn = [...page.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join('')
      expect(drawn.endsWith('1/1')).toBe(true)
      expect(drawn).not.toContain('{')
    }
  })

  it('leaves a header someone laid out by hand alone', () => {
    const start = blank()
    start.createHeaderFooter(0, true, 0)
    start.insertTextInHeaderFooter(0, true, 0, 0, 0, '첫 줄')
    start.splitParagraphInHeaderFooter(0, true, 0, 0, 3)
    start.insertTextInHeaderFooter(0, true, 0, 1, 0, '둘째 줄')
    const { plugin, steps } = open(start)
    expect(plugin.pageLayout().header).toMatchObject({ exists: true, plain: false })
    const before = steps()
    expect(plugin.setHeaderFooter('header', { text: '새 머리말' })).toEqual({
      ok: false,
      reason: 'not_plain',
    })
    expect(steps()).toBe(before)
  })
})

describe('documentFonts', () => {
  it('says nothing when the fonts of the PC are not known', () => {
    expect(open().plugin.documentFonts()).toEqual({ known: false, onPc: [], missing: [] })
  })

  it('tells which document fonts the PC has and lacks', () => {
    pcHas('맑은 고딕', '바탕')
    const fonts = open().plugin.documentFonts()
    expect(fonts.known).toBe(true)
    expect(fonts.onPc).toEqual(['맑은 고딕', '바탕'])
    expect(fonts.missing).toContain('HY헤드라인M')
    expect(fonts.missing).toContain('휴먼명조')
  })
})

describe('styleParagraphs: numbered levels and headings that stay with their text', () => {
  const NUMBERED = [
    '운영 계획',
    'Ⅰ. 목적',
    '1. 운영 방향',
    '가. 대상: 2학년 전체',
    '1) 1차: 9. 12.(금)',
    '가) 장소는 추후 안내',
    '2. 2026학년도 일정',
    'Ⅱ. 기대 효과',
    '1.5배로 늘어난 참가 인원',
  ]

  it('gives each numbered level its style by the number it starts with', () => {
    const { plugin, doc } = open(blank(NUMBERED))
    const result = plugin.styleParagraphs({
      styles: [
        { name: '대제목', format: { size: 16, bold: true }, keepWithNext: true },
        { name: '중제목', format: { size: 14, bold: true, marginLeft: 10 } },
        { name: '소제목', format: { size: 13, marginLeft: 20 } },
        { name: '세목', format: { size: 12, marginLeft: 30 } },
        { name: '세세목', format: { size: 12, marginLeft: 40 } },
      ],
      apply: [
        { style: '대제목', numbered: 'Ⅰ' },
        { style: '중제목', numbered: '1.' },
        { style: '소제목', numbered: '가.' },
        { style: '세목', numbered: '1)' },
        { style: '세세목', numbered: '가)' },
      ],
    })
    expect(result).toMatchObject({
      ok: true,
      made: 5,
      rules: [
        { style: '대제목', paragraphs: 2 },
        { style: '중제목', paragraphs: 2 },
        { style: '소제목', paragraphs: 1 },
        { style: '세목', paragraphs: 1 },
        { style: '세세목', paragraphs: 1 },
      ],
    })
    expect(NUMBERED.map((_, para) => styleOf(doc(), para))).toEqual([
      '바탕글',
      '대제목',
      '중제목',
      '소제목',
      '세목',
      '세세목',
      '중제목',
      '대제목',
      // a decimal is not the number of a level
      '바탕글',
    ])
    // a heading of the top level stays with the paragraph after it, in both formats
    const keeps = (d: HwpDocument, para: number) =>
      (JSON.parse(d.getParaPropertiesAt(0, para)) as { keepWithNext: boolean }).keepWithNext
    expect(keeps(doc(), 1)).toBe(true)
    expect(keeps(doc(), 2)).toBe(false)
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const again = new HwpDocument(bytes)
      expect(keeps(again, 7)).toBe(true)
      expect(styleOf(again, 4)).toBe('세목')
    }
  })

  it('lets a style start from one made earlier in the same call', () => {
    const { plugin, doc, steps } = open()
    const before = steps()
    const result = plugin.styleParagraphs({
      styles: [
        { name: '계획 본문', format: { size: 10.5, lineSpacing: 155 } },
        { name: '계획 제목', basedOn: '계획 본문', format: { bold: true } },
      ],
      apply: [
        { style: '계획 본문', startsWith: '○' },
        { style: '계획 제목', startsWith: '□' },
      ],
    })
    expect(result).toMatchObject({ ok: true, made: 2 })
    expect(steps()).toBe(before + 1)
    // the heading has the size of the style it started from, and its own bold
    const heading = JSON.parse(doc().getCharPropertiesAt(0, 1, 0)) as {
      fontSize: number
      bold: boolean
    }
    expect(heading).toMatchObject({ fontSize: 1050, bold: true })
    const body = JSON.parse(doc().getCharPropertiesAt(0, 2, 0)) as { bold: boolean }
    expect(body.bold).toBe(false)
    // a style that comes later in the list, or is nowhere, is still refused
    expect(
      plugin.styleParagraphs({
        styles: [
          { name: '먼저', basedOn: '나중', format: { bold: true } },
          { name: '나중', format: { size: 12 } },
        ],
      }),
    ).toMatchObject({ ok: false, reason: 'no_such_style' })
    expect(steps()).toBe(before + 1)
  })

  it('refuses a level it does not know and a rule with two ways to name its paragraphs', () => {
    const { plugin, steps } = open(blank(NUMBERED))
    const before = steps()
    const style = { name: '중제목', format: { size: 14 } }
    expect(() =>
      plugin.styleParagraphs({
        styles: [style],
        apply: [{ style: '중제목', numbered: '2.' as never }],
      }),
    ).toThrow(/numbered must be one of/)
    expect(() =>
      plugin.styleParagraphs({
        styles: [style],
        apply: [{ style: '중제목', numbered: '1.', startsWith: '1.' }],
      }),
    ).toThrow(/one of the three/)
    expect(steps()).toBe(before)
  })
})

describe('columns and breaks', () => {
  const PAPER = ['2026학년도 1학기 중간고사', '국어 (2학년)']
  for (let n = 1; n <= 8; n++) {
    PAPER.push(`${n}. 다음 글을 읽고 물음에 답하시오.`, '① 첫째', '② 둘째', '③ 셋째', '')
  }
  const columnsOf = (doc: HwpDocument) =>
    JSON.parse(doc.getColumnDef(0)) as { columnCount: number; spacing: number }
  const tableProps = (doc: HwpDocument, para: number, control: number) =>
    JSON.parse(doc.getTableProperties(0, para, control)) as {
      treatAsChar: boolean
      tableWidth: number
      horzRelTo: string
      vertRelTo: string
    }

  it('lays the text out in columns, reads them back and takes them away again', () => {
    const { plugin, doc, steps } = open(blank(PAPER))
    const before = steps()
    expect(plugin.pageLayout().columns).toEqual({ count: 1, gapMm: 0 })
    expect(plugin.setColumns({ count: 2 })).toMatchObject({ ok: true, count: 2, gapMm: 8, was: 1 })
    expect(steps()).toBe(before + 1)
    expect(columnsOf(doc()).columnCount).toBe(2)
    expect(plugin.pageLayout()).toMatchObject({ columns: { count: 2, gapMm: 8 } })
    // through both formats
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      expect(columnsOf(new HwpDocument(bytes)).columnCount).toBe(2)
    }
    expect(plugin.setColumns({ count: 1 })).toMatchObject({ ok: true, count: 1, gapMm: 0, was: 2 })
    expect(columnsOf(doc()).columnCount).toBe(1)
    expect(() => plugin.setColumns({ count: 9 })).toThrow(/count must be/)
    expect(() => plugin.setColumns({ count: 2, gapMm: 99 })).toThrow(/gapMm must be/)
  })

  it('makes a table one column wide where the text runs in columns, or lays it across them', () => {
    const { plugin, doc } = open(blank(PAPER))
    plugin.setColumns({ count: 2 })
    const rows = [
      ['학년', '반', '번호', '이름'],
      ['2', '', '', ''],
    ]
    const paragraphs = doc().getParagraphCount(0)
    const head = plugin.insertTable(PAPER[0]!, null, 'before', rows, {
      header: true,
      acrossColumns: true,
    })
    expect(head).toMatchObject({ ok: true, acrossColumns: true, place: { para: 0 } })
    // the head shares the first paragraph with the first words: no paragraph was added
    expect(doc().getParagraphCount(0)).toBe(paragraphs)
    expect(doc().getTextRange(0, 0, 0, 40)).toContain(PAPER[0]!)
    const inColumn = plugin.insertTable('③ 셋째', 1, 'after', [['보기', '내용']], true)
    expect(inColumn).toMatchObject({ ok: true })
    expect(inColumn).not.toHaveProperty('acrossColumns')
    const wide = tableIn(doc(), 0)
    const narrow = tableIn(doc(), 6)
    const wideProps = tableProps(doc(), 0, wide.control)
    const narrowProps = tableProps(doc(), 6, narrow.control)
    // across: out of the line of text, hung from the top of the page's text area
    expect(wideProps).toMatchObject({ treatAsChar: false, horzRelTo: 'Page', vertRelTo: 'Page' })
    expect(narrowProps.treatAsChar).toBe(true)
    // the text is 425 pt wide and the gap 8 mm: a column is a little under half of it
    expect(wideProps.tableWidth).toBeGreaterThan(41000)
    expect(narrowProps.tableWidth).toBeLessThan(21000)
    expect(narrowProps.tableWidth).toBeGreaterThan(18000)
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const again = new HwpDocument(bytes)
      expect(tableProps(again, 0, tableIn(again, 0).control)).toMatchObject({
        treatAsChar: false,
        vertRelTo: 'Page',
      })
    }
    // a page number or a footer in the first paragraph does not move the head
    const top = () =>
      (JSON.parse(doc().getTableBBox(0, 0, tableIn(doc(), 0).control)) as { y: number }).y
    const before = top()
    plugin.setPageNumber({ position: 'bottom_center' })
    plugin.setHeaderFooter('footer', { text: '꼬리말' })
    expect(top()).toBe(before)
  })

  it('leaves 3 mm under a head table laid across the columns, over the first line of each column', () => {
    const { plugin, doc } = open(blank(PAPER))
    plugin.setColumns({ count: 2 })
    plugin.insertTable(PAPER[0]!, null, 'before', [['학년', '반']], {
      header: true,
      acrossColumns: true,
    })
    const outerBottom = (from: HwpDocument) =>
      (
        JSON.parse(from.getTableProperties(0, 0, tableIn(from, 0).control)) as {
          outerBottom: number
        }
      ).outerBottom
    expect(outerBottom(doc())).toBe(850)
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      expect(outerBottom(new HwpDocument(bytes))).toBe(850)
    }
    const box = JSON.parse(doc().getTableBBox(0, 0, tableIn(doc(), 0).control)) as {
      y: number
      height: number
    }
    const line = JSON.parse(doc().getCursorRect(0, 0, 0)) as { y: number }
    expect(line.y - (box.y + box.height)).toBeGreaterThan(11)
  })

  it('takes a table across the columns only as the head of the document', () => {
    const { plugin, steps } = open(blank(PAPER))
    plugin.setColumns({ count: 2 })
    const before = steps()
    const rows = [['학년', '반']]
    for (const [anchor, where] of [
      [PAPER[1]!, 'before'],
      [PAPER[0]!, 'after'],
      ['', 'end'],
    ] as const) {
      expect(plugin.insertTable(anchor, null, where, rows, { acrossColumns: true })).toEqual({
        ok: false,
        reason: 'not_at_start',
        count: 1,
      })
    }
    expect(steps()).toBe(before)
    // in one column the word means nothing: the table is made where it was asked for
    plugin.setColumns({ count: 1 })
    expect(
      plugin.insertTable(PAPER[1]!, null, 'after', rows, { acrossColumns: true }),
    ).toMatchObject({ ok: true })
  })

  it('makes a title box one column wide where the text runs in columns', () => {
    const { plugin, doc } = open(blank(PAPER))
    plugin.setColumns({ count: 2 })
    expect(plugin.insertTitleBox(PAPER[0]!, null, { look: 'lines' })).toMatchObject({ ok: true })
    const box = tableIn(doc(), 0)
    const props = tableProps(doc(), 0, box.control)
    expect(props.treatAsChar).toBe(true)
    expect(props.tableWidth).toBeLessThan(21000)
    expect(props.tableWidth).toBeGreaterThan(18000)
  })

  it('starts a paragraph on a new page or in the next column', () => {
    const { plugin, doc, steps } = open(blank(PAPER))
    plugin.setColumns({ count: 2 })
    const pages = doc().pageCount()
    const before = steps()
    const column = plugin.insertBreak('3. 다음 글을', null, 'column')
    expect(column).toMatchObject({ ok: true, kind: 'column', columns: 2 })
    const page = plugin.insertBreak('5. 다음 글을', null, 'page')
    expect(page).toMatchObject({ ok: true, kind: 'page' })
    expect(steps()).toBe(before + 2)
    expect(doc().pageCount()).toBe(pages + 1)
    // the first paragraph starts its page already
    expect(plugin.insertBreak(PAPER[0]!, null, 'page')).toMatchObject({
      ok: false,
      reason: 'at_start',
    })
    expect(() => plugin.insertBreak('3. 다음 글을', null, 'line' as never)).toThrow(/kind must be/)
    expect(plugin.insertBreak('없는 글', null, 'page')).toMatchObject({
      ok: false,
      reason: 'not_found',
    })
  })

  it('puts the break on the paragraph itself and says so when it starts its page or column already', () => {
    const { plugin, doc, steps } = open(blank(PAPER))
    const paragraphs = doc().getParagraphCount(0)
    expect(plugin.insertBreak('5. 다음 글을', null, 'page')).toMatchObject({
      ok: true,
      kind: 'page',
      place: { para: PAPER.indexOf('5. 다음 글을 읽고 물음에 답하시오.') },
    })
    expect(doc().getParagraphCount(0)).toBe(paragraphs)
    const pages = doc().pageCount()
    const before = steps()
    expect(plugin.insertBreak('5. 다음 글을', null, 'page')).toEqual({
      ok: true,
      kind: 'page',
      already: 'page',
    })
    expect(plugin.insertBreak('5. 다음 글을', null, 'column')).toEqual({
      ok: true,
      kind: 'column',
      already: 'page',
    })
    expect(doc().pageCount()).toBe(pages)
    expect(doc().getParagraphCount(0)).toBe(paragraphs)
    expect(steps()).toBe(before)

    plugin.setColumns({ count: 2 })
    expect(plugin.insertBreak('3. 다음 글을', null, 'column')).toMatchObject({ ok: true })
    const inColumns = doc().pageCount()
    const again = steps()
    expect(plugin.insertBreak('3. 다음 글을', null, 'column')).toEqual({
      ok: true,
      kind: 'column',
      already: 'column',
    })
    expect(doc().pageCount()).toBe(inColumns)
    expect(steps()).toBe(again)
    expect(plugin.insertBreak('3. 다음 글을', null, 'page')).toMatchObject({ ok: true })
    expect(doc().pageCount()).toBe(inColumns + 1)
    expect(doc().getParagraphCount(0)).toBe(paragraphs)
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const saved = new HwpDocument(bytes)
      expect(saved.getParagraphCount(0)).toBe(paragraphs)
      expect(saved.pageCount()).toBe(inColumns + 1)
    }
  })

  it('leaves a table on its page when it shrinks after a break was put behind it', () => {
    const LONG =
      '이 칸에는 여러 줄로 접히는 긴 설명이 들어갑니다. 조사 대상과 방법, 기간, 그리고 결과를 한 칸에 모두 적어 줄 수가 늘어나게 합니다. 한 줄로는 다 들어가지 않습니다. 세 줄이 넘도록 조금 더 적습니다. 마지막 문장입니다.'
    const ADDED = ['칸 안에 더한 줄 A', '칸 안에 더한 줄 B', '칸 안에 더한 줄 C']
    const LAST = 32
    const rows = Array.from({ length: LAST }, (_, row) => [`항목 ${row + 1}`, `값 ${row + 1}`])
    type Plugin = ReturnType<typeof open>['plugin']
    const fillLast = (text: string) => (plugin: Plugin) =>
      plugin.fillCells(1, [{ row: LAST, col: 2, text }], true)
    const changes: Array<{
      grow: (plugin: Plugin) => unknown
      shrink: (plugin: Plugin) => unknown
    }> = [
      { grow: fillLast(LONG), shrink: fillLast('짧은 값') },
      { grow: fillLast(LONG), shrink: (plugin) => plugin.removeTableLines(1, 'rows', LAST, 1) },
      { grow: fillLast(LONG), shrink: (plugin) => plugin.replaceText(LONG, '짧은 값', null) },
      {
        grow: (plugin) => plugin.insertParagraphs(`값 ${LAST}`, null, 'after', ADDED),
        shrink: (plugin) => ADDED.map((line) => plugin.deleteParagraph(line, null)),
      },
    ]
    for (const { grow, shrink } of changes) {
      const { plugin, doc } = open(
        blank(['보고서 제목', '표 앞 문단입니다.', '다음 장 제목', '다음 장 본문']),
      )
      plugin.insertTable('표 앞 문단입니다.', null, 'after', rows, true)
      const TABLE = 2
      const pageOf = (from: HwpDocument, para: number) =>
        (JSON.parse(from.getPageOfPosition(0, para)) as { page: number }).page
      expect(pageOf(doc(), TABLE)).toBe(0)
      grow(plugin)
      expect(plugin.insertBreak('다음 장 제목', null, 'page')).toMatchObject({ ok: true })
      shrink(plugin)
      expect([doc().pageCount(), pageOf(doc(), TABLE)]).toEqual([2, 0])
      for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
        const saved = new HwpDocument(bytes)
        expect([saved.pageCount(), pageOf(saved, TABLE)]).toEqual([2, 0])
      }
    }
  })

  it('leaves one empty paragraph behind a table, and keeps the start of a part with other columns', () => {
    const start = blank(['머리', '표 앞', '표 뒤 문단', '단이 바뀌는 문단 앞'])
    // a paragraph that starts a part of the document laid out in other columns, as Hangul
    // marks it: made through the engine's split, which takes the mark of the new paragraph
    start.splitParagraph(
      0,
      3,
      start.getParagraphLength(0, 3),
      JSON.stringify({
        para_shape_id: 0,
        style_id: 0,
        column_type: 'MultiColumn',
        raw_break_type: 2,
        numbering_restart: null,
        raw_header_extra: [],
        tab_extended: [],
      }),
    )
    start.insertText(0, 4, 0, '단이 바뀌는 문단')
    const { plugin, doc, steps } = open(start)
    plugin.insertTable('표 앞', null, 'after', [['a', 'b']], false)
    const paragraphs = doc().getParagraphCount(0) + 1
    expect(plugin.insertBreak('표 뒤 문단', null, 'page')).toMatchObject({
      ok: true,
      place: { para: 4 },
    })
    expect(doc().getParagraphCount(0)).toBe(paragraphs)
    expect(doc().getParagraphLength(0, 3)).toBe(0)
    expect(plugin.insertBreak('표 뒤 문단', null, 'page')).toEqual({
      ok: true,
      kind: 'page',
      already: 'page',
    })
    expect(doc().getParagraphCount(0)).toBe(paragraphs)
    expect(tableIn(doc(), 2).cols).toBe(2)
    expect(doc().pageCount()).toBe(2)
    const before = steps()
    expect(plugin.insertBreak('단이 바뀌는 문단', 2, 'page')).toEqual({
      ok: false,
      reason: 'layout_start',
      count: 1,
    })
    expect(steps()).toBe(before)
    expect(doc().getParagraphCount(0)).toBe(paragraphs)
    expect(doc().pageCount()).toBe(2)
  })

  it('keeps the numbering behind a table, and refuses a mark of the place there as elsewhere', () => {
    const { plugin, doc } = open(blank(['머리', '표 앞', '첫째 항목', '둘째 항목', '끝']))
    for (const item of ['첫째 항목', '둘째 항목']) {
      plugin.formatParagraph(item, null, { list: 'number' })
    }
    plugin.insertTable('표 앞', null, 'after', [['a', 'b']], false)
    doc().setNumberingRestart(0, 3, 2, 5)
    expect(drawnPages(doc())[0]).toContain('5.첫째항목6.둘째항목')
    expect(plugin.insertBreak('첫째 항목', null, 'page')).toMatchObject({
      ok: true,
      place: { para: 4 },
    })
    const pages = drawnPages(doc())
    expect(pages).toHaveLength(2)
    expect(pages[1]).toContain('5.첫째항목6.둘째항목')

    const marked = open(blank(['머리', '표 앞', '둘째 장', '끝']))
    marked.plugin.insertTable('표 앞', null, 'after', [['a', 'b']], false)
    marked.doc().addBookmark(0, 3, 0, 'ch2')
    const paragraphs = marked.doc().getParagraphCount(0)
    const before = marked.steps()
    expect(marked.plugin.insertBreak('둘째 장', null, 'page')).toEqual({
      ok: false,
      reason: 'holds_mark',
      count: 1,
    })
    expect(marked.steps()).toBe(before)
    expect(marked.doc().getParagraphCount(0)).toBe(paragraphs)
  })

  it('keeps the numbering of an item that starts its numbers anew', () => {
    const { plugin, doc } = open(
      blank(['머리', '첫째 항목', '둘째 항목', '셋째 항목', '넷째 항목', '끝']),
    )
    for (const item of ['첫째 항목', '둘째 항목', '셋째 항목', '넷째 항목']) {
      plugin.formatParagraph(item, null, { list: 'number' })
    }
    doc().setNumberingRestart(0, 3, 2, 5)
    const drawn = () => drawnPages(doc())
    expect(drawn()).toHaveLength(1)
    expect(drawn()[0]).toContain('2.둘째항목5.셋째항목6.넷째항목')
    const paragraphs = doc().getParagraphCount(0)
    expect(plugin.insertBreak('셋째 항목', null, 'page')).toMatchObject({ ok: true, kind: 'page' })
    expect(doc().getParagraphCount(0)).toBe(paragraphs)
    const pages = drawn()
    expect(pages).toHaveLength(2)
    expect(pages[0]).toContain('1.첫째항목2.둘째항목')
    expect(pages[0]).not.toContain('5.')
    expect(pages[1]).toContain('5.셋째항목6.넷째항목')

    doc().setNumberingRestart(0, 4, 1, 0)
    expect(plugin.insertBreak('넷째 항목', null, 'page')).toMatchObject({ ok: true })
    // the engine tells what a paragraph carries only in the answer of a join
    doc().insertPageBreak(0, 4, 0)
    expect(JSON.parse(doc().mergeParagraph(0, 4)).removedParaMeta.numbering_restart).toBe(
      'ContinuePrevious',
    )
  })

  it('leaves a paragraph that holds a mark of its place as it is', () => {
    const marks: Array<(doc: HwpDocument) => unknown> = [
      (doc) => doc.insertNewNumber(0, 2, 0, 7),
      (doc) => doc.setPageHide(0, 2, false, false, false, false, false, true),
      (doc) => doc.addBookmark(0, 2, 0, 'ch2'),
    ]
    for (const mark of marks) {
      const { plugin, doc, steps } = open(blank(['머리', '앞 문단', '둘째 장', '본문', '끝']))
      plugin.setPageNumber({ position: 'bottom_center', dashes: false })
      mark(doc())
      const controls = () => [1, 2].map((para) => doc().getControlTextPositions(0, para))
      const drawnBefore = drawnPages(doc())
      const controlsBefore = controls()
      const stepsBefore = steps()
      expect(plugin.insertBreak('둘째 장', null, 'page')).toEqual({
        ok: false,
        reason: 'holds_mark',
        count: 1,
      })
      expect(steps()).toBe(stepsBefore)
      expect(drawnPages(doc())).toEqual(drawnBefore)
      expect(controls()).toEqual(controlsBefore)
    }
  })
})

describe('writing into an empty document', () => {
  const empty = () => {
    const doc = HwpDocument.createEmpty()
    doc.createBlankDocument()
    return doc
  }

  it('puts the first words into its one empty paragraph, not under an empty line', () => {
    const { plugin, doc } = open(empty())
    const result = plugin.insertParagraphs('', null, 'end', ['제목', '첫 줄'])
    expect(result).toMatchObject({ ok: true, count: 2, place: { para: 0 } })
    expect(doc().getParagraphCount(0)).toBe(2)
    expect(doc().getTextRange(0, 0, 0, 2)).toBe('제목')
    expect(doc().getTextRange(0, 1, 0, 3)).toBe('첫 줄')
    // a document that has words keeps them where they are: more go after them
    expect(plugin.insertParagraphs('', null, 'end', ['둘째 줄'])).toMatchObject({
      ok: true,
      place: { para: 2 },
    })
    expect(doc().getParagraphCount(0)).toBe(3)
  })

  it('lets the head of a test paper lie at the very top, over both columns', () => {
    const { plugin, doc } = open(empty())
    plugin.setColumns({ count: 2 })
    plugin.insertParagraphs('', null, 'end', ['1. 첫 문제', '① 가', '② 나'])
    const head = plugin.insertTable('1. 첫 문제', null, 'before', [['학교', '과목']], {
      acrossColumns: true,
    })
    expect(head).toMatchObject({ ok: true, acrossColumns: true, place: { para: 0 } })
    // the table is in the first paragraph, with the first words: nothing stands above it
    expect(tableIn(doc(), 0).cols).toBe(2)
    expect(doc().getParagraphCount(0)).toBe(3)
    expect(doc().getTextRange(0, 0, 0, 40)).toContain('1. 첫 문제')
  })

  it('keeps the page setup in the first paragraph when words are put before it', () => {
    const { plugin, doc } = open(empty())
    plugin.insertParagraphs('', null, 'end', ['본문 첫 줄'])
    plugin.setPageNumber({ position: 'bottom_center' })
    plugin.setHeaderFooter('footer', { text: '꼬리말' })
    const setup = () =>
      (JSON.parse(doc().getControls()) as { ctrlId: string; list: number; para: number }[])
        .filter((control) => control.list === 0 && control.para === 0)
        .map((control) => control.ctrlId)
        .sort()
    const before = setup()
    expect(before).toEqual(expect.arrayContaining(['cold', 'secd']))
    expect(plugin.insertParagraphs('본문 첫 줄', null, 'before', ['제목'])).toMatchObject({
      ok: true,
      place: { para: 0 },
    })
    expect(setup()).toEqual(before)
    expect(doc().getTextRange(0, 0, 0, 2)).toBe('제목')
    expect(plugin.pageLayout()).toMatchObject({
      pageNumber: { position: 'bottom_center' },
      footer: { exists: true, text: '꼬리말' },
    })
  })
})

describe('more building blocks: borders of paragraphs, character width, cell text, small tables', () => {
  const paraOf = (doc: HwpDocument, para: number) =>
    JSON.parse(doc.getParaPropertiesAt(0, para)) as {
      borderLeft: Line
      borderRight: Line
      borderTop: Line
      borderBottom: Line
      fillType: string
      fillColor: string
      alignment: string
    }
  const widthOf = (doc: HwpDocument, para: number, offset: number) =>
    JSON.parse(doc.getCharPropertiesAt(0, para, offset)) as {
      ratios: number[]
      spacings: number[]
    }

  it('draws a box round paragraphs, a line under a heading and a band beside a note', () => {
    const { plugin, doc, steps } = open()
    const before = steps()
    const result = plugin.styleParagraphs({
      styles: [
        {
          name: '제목밑줄',
          format: { bold: true, border: { sides: 'bottom', width: 0.7, color: '#1F3864' } },
        },
        { name: '보기상자', format: { border: { sides: 'box' }, background: '#F2F2F2' } },
        {
          name: '참고',
          format: {
            border: { sides: 'left', width: 1.5, color: '#1F3864' },
            background: '#EEF3FB',
          },
        },
      ],
      apply: [
        { style: '제목밑줄', startsWith: '□' },
        { style: '보기상자', startsWith: '○' },
        { style: '참고', startsWith: '-' },
      ],
    })
    expect(result).toMatchObject({ ok: true, made: 3 })
    expect(steps()).toBe(before + 1)
    for (const d of [
      doc(),
      new HwpDocument(doc().exportHwpx()),
      new HwpDocument(doc().exportHwp()),
    ]) {
      const heading = paraOf(d, 1)
      // a line under it only: the other sides have none
      expect(heading.borderBottom).toMatchObject({ type: 1, color: '#1f3864' })
      expect(heading.borderTop.type).toBe(0)
      expect(heading.borderLeft.type).toBe(0)
      const boxed = paraOf(d, 2)
      expect(
        [boxed.borderLeft, boxed.borderRight, boxed.borderTop, boxed.borderBottom].map(
          (l) => l.type,
        ),
      ).toEqual([1, 1, 1, 1])
      expect(boxed).toMatchObject({ fillType: 'solid', fillColor: '#f2f2f2' })
      const note = paraOf(d, 3)
      expect(note.borderLeft.type).toBe(1)
      expect(note.borderRight.type).toBe(0)
      expect(note.fillColor).toBe('#eef3fb')
    }
  })

  it('takes a border and a background away again, and refuses what it cannot read', () => {
    const { plugin, doc } = open()
    plugin.formatParagraph('□ 추진 배경', null, { border: { sides: 'box' }, background: '#F2F2F2' })
    expect(paraOf(doc(), 1).borderTop.type).toBe(1)
    plugin.formatParagraph('□ 추진 배경', null, { border: { sides: 'none' }, background: 'none' })
    const cleared = paraOf(doc(), 1)
    expect(
      [cleared.borderLeft, cleared.borderTop, cleared.borderBottom].map((l) => l.type),
    ).toEqual([0, 0, 0])
    expect(cleared.fillType).toBe('none')
    expect(() =>
      plugin.formatParagraph('□ 추진 배경', null, { border: { sides: 'round' as never } }),
    ).toThrow(/border sides must be one of/)
    expect(() => plugin.formatParagraph('□ 추진 배경', null, { background: 'grey' })).toThrow(
      /background must look like/,
    )
    // a border belongs to a paragraph, not to a piece of its text
    expect(() =>
      plugin.formatText('추진', null, false, { border: { sides: 'box' } } as never),
    ).toThrow(/whole paragraph/)
  })

  it('narrows and spaces characters, as official documents do to fit a line', () => {
    const { plugin, doc } = open()
    plugin.formatText('학생의 진로 탐색', null, false, { charWidth: 95, letterSpacing: -5 })
    // the text found starts after the mark of the line
    const narrowed = widthOf(doc(), 2, 4)
    expect(narrowed.ratios).toEqual(Array(7).fill(95))
    expect(narrowed.spacings).toEqual(Array(7).fill(-5))
    const again = new HwpDocument(doc().exportHwp())
    expect(widthOf(again, 2, 4).ratios[0]).toBe(95)
    // the mark in front of it keeps its own width
    expect(widthOf(doc(), 2, 0).ratios[0]).toBe(100)
    expect(() => plugin.formatText('학생의', null, false, { charWidth: 10 })).toThrow(/charWidth/)
    expect(() => plugin.formatText('학생의', null, false, { letterSpacing: 90 })).toThrow(
      /letterSpacing/,
    )
  })

  it('formats the text of a block of cells and sets the height of rows', () => {
    const { plugin, doc, para, steps } = withTable(false)
    const before = steps()
    const result = plugin.formatCells(
      1,
      { fromRow: 1, fromCol: 1, toRow: 3, toCol: 1 },
      {
        text: { bold: true, align: 'center', size: 12 },
        heightMm: 12,
      },
    )
    expect(result).toMatchObject({ ok: true, count: 3 })
    expect(steps()).toBe(before + 1)
    const table = tableIn(doc(), para)
    for (const cell of [0, 3, 6]) {
      const chars = JSON.parse(
        doc().getCellCharPropertiesAt(0, para, table.control, cell, 0, 0),
      ) as {
        bold: boolean
        fontSize: number
      }
      expect(chars).toMatchObject({ bold: true, fontSize: 1200 })
      const paragraph = JSON.parse(
        doc().getCellParaPropertiesAt(0, para, table.control, cell, 0),
      ) as {
        alignment: string
      }
      expect(paragraph.alignment).toBe('center')
      // 12 mm, in the engine's units
      expect(Math.abs(table.cell(cell).height - 3402)).toBeLessThan(40)
    }
    // the cells beside the block keep their text as it was
    const other = JSON.parse(doc().getCellCharPropertiesAt(0, para, table.control, 1, 0, 0)) as {
      bold: boolean
    }
    expect(other.bold).toBe(false)
    // text alone counts the cells it reached
    expect(plugin.formatCells(1, null, { text: { align: 'right' } })).toMatchObject({
      ok: true,
      count: 9,
    })
    expect(() => plugin.formatCells(1, null, { heightMm: 900 })).toThrow(/heightMm/)
    expect(() => plugin.formatCells(1, null, { text: { style: '본문' } as never })).toThrow(
      /a style is not made of other styles/,
    )
  })

  it('makes a small table at the right, as an approval box stands', () => {
    const { plugin, doc } = open()
    const made = plugin.insertTable(
      TITLE,
      null,
      'after',
      [
        ['결재', '담당', '팀장', '교장'],
        ['', '', '', ''],
      ],
      {
        widthPercent: 40,
        place: 'right',
      },
    )
    expect(made).toMatchObject({ ok: true, rows: 2, cols: 4 })
    const table = tableIn(doc(), 1)
    const props = JSON.parse(doc().getTableProperties(0, 1, table.control)) as {
      tableWidth: number
    }
    // 40 percent of a text width of 425 pt
    expect(props.tableWidth).toBeGreaterThan(15500)
    expect(props.tableWidth).toBeLessThan(18500)
    expect(paraOf(doc(), 1).alignment).toBe('right')
    expect(() => plugin.insertTable(TITLE, null, 'after', [['가']], { widthPercent: 5 })).toThrow(
      /widthPercent/,
    )
    expect(() =>
      plugin.insertTable(TITLE, null, 'after', [['가']], { place: 'top' as never }),
    ).toThrow(/place must be one of/)
  })

  it('repeats the header row of a long table on every page', () => {
    const { plugin, doc } = open()
    plugin.insertTable(TITLE, null, 'after', ROWS, { header: true, repeatHeader: true })
    const table = tableIn(doc(), 1)
    const read = (d: HwpDocument) =>
      (JSON.parse(d.getTableProperties(0, 1, table.control)) as { repeatHeader: boolean })
        .repeatHeader
    expect(read(doc())).toBe(true)
    expect(read(new HwpDocument(doc().exportHwpx()))).toBe(true)
  })
})

describe('a title box and the colour of its words', () => {
  const titleColor = (doc: HwpDocument) => {
    const box = tableIn(doc, 0)
    const cell = box.cells === 3 ? 1 : 0
    return (
      JSON.parse(doc.getCellCharPropertiesAt(0, 0, box.control, cell, 0, 0)) as {
        textColor: string
      }
    ).textColor
  }

  it('leaves out a text colour that cannot be told from what is behind the title', () => {
    // white words between two bands stand on the white page
    const bands = open()
    expect(
      bands.plugin.insertTitleBox(TITLE, null, { look: 'bands', textColor: '#FFFFFF' }),
    ).toMatchObject({ ok: true, textColorDropped: true })
    expect(titleColor(bands.doc())).toBe('#000000')
    // and on a pale fill
    const pale = open()
    expect(
      pale.plugin.insertTitleBox(TITLE, null, { look: 'shaded', textColor: '#FFFFFF' }),
    ).toMatchObject({ ok: true, textColorDropped: true })
  })

  it('writes the title white on a dark fill when the call names no colour for it', () => {
    const dark = open()
    expect(
      dark.plugin.insertTitleBox(TITLE, null, { look: 'shaded', color: '#1F3864' }),
    ).toMatchObject({ ok: true, textColor: '#ffffff' })
    expect(titleColor(dark.doc())).toBe('#ffffff')
    for (const bytes of [dark.doc().exportHwpx(), dark.doc().exportHwp()]) {
      expect(titleColor(new HwpDocument(bytes))).toBe('#ffffff')
    }
    for (const box of [
      { look: 'shaded' as const, color: '#D9E2F3' },
      { look: 'shaded' as const },
      { look: 'bands' as const, color: '#1F3864' },
      { look: 'lines' as const, color: '#1F3864' },
    ]) {
      const light = open()
      const made = light.plugin.insertTitleBox(TITLE, null, box)
      expect(made, JSON.stringify(box)).not.toHaveProperty('textColor')
      expect(titleColor(light.doc()), JSON.stringify(box)).toBe('#000000')
    }
    const asked = open()
    const kept = asked.plugin.insertTitleBox(TITLE, null, {
      look: 'shaded',
      color: '#1F3864',
      textColor: '#FFC000',
    })
    expect(kept).not.toHaveProperty('textColor')
    expect(titleColor(asked.doc())).toBe('#ffc000')
  })

  it('says what color of a title box colours when it is not a colour', () => {
    const { plugin } = open()
    expect(() => plugin.insertTitleBox(TITLE, null, { color: '진한 초록' })).toThrow(
      /^color must look like #RRGGBB: the colour of the bands, lines, frame or fill; the words take textColor$/,
    )
  })

  it('writes the title white when the colour the call names would not show on the dark fill', () => {
    for (const [color, textColor] of [
      ['#1F3864', '#1F3864'],
      ['#1F3864', '#203A6A'],
      ['#000000', '#111111'],
    ]) {
      const { plugin, doc } = open()
      expect(
        plugin.insertTitleBox(TITLE, null, { look: 'shaded', color, textColor }),
        `${textColor} on ${color}`,
      ).toMatchObject({ ok: true, textColorDropped: true, textColor: '#ffffff' })
      expect(titleColor(doc())).toBe('#ffffff')
    }
    // on a pale fill black shows, so the title keeps the colour it has
    const pale = open()
    const made = pale.plugin.insertTitleBox(TITLE, null, {
      look: 'shaded',
      color: '#D9E2F3',
      textColor: '#DDE6F5',
    })
    expect(made).toMatchObject({ ok: true, textColorDropped: true })
    expect(made).not.toHaveProperty('textColor')
    expect(titleColor(pale.doc())).toBe('#000000')
  })

  it('names the text colour, not the colour of the box, when the text colour is no colour', () => {
    const { plugin, steps } = open()
    const before = steps()
    expect(() => plugin.insertTitleBox(TITLE, null, { look: 'lines', textColor: 'navy' })).toThrow(
      /textColor must look like #RRGGBB/,
    )
    expect(steps()).toBe(before)
  })

  it('takes white words on a dark fill, and a dark colour anywhere', () => {
    const dark = open()
    const made = dark.plugin.insertTitleBox(TITLE, null, {
      look: 'shaded',
      color: '#1F3864',
      textColor: '#FFFFFF',
    })
    expect(made).toMatchObject({ ok: true })
    expect(made).not.toHaveProperty('textColorDropped')
    expect(titleColor(dark.doc())).toBe('#ffffff')
    const blue = open()
    const lined = blue.plugin.insertTitleBox(TITLE, null, { look: 'lines', textColor: '#1F3864' })
    expect(lined).not.toHaveProperty('textColorDropped')
    expect(titleColor(blue.doc())).toBe('#1f3864')
  })
})

describe('equations, a diagonal, the page border, tab stops, the size of a picture', () => {
  const textOf = (doc: HwpDocument, para: number) =>
    doc.getTextRange(0, para, 0, doc.getParagraphLength(0, para))
  const equationsOf = (doc: HwpDocument) =>
    (
      JSON.parse(doc.getControls()) as { ctrlId: string; para: number; controlIndex: number }[]
    ).filter((control) => control.ctrlId === 'eqed')
  /** The width of the text of the first section, in the engine's units. */
  const textWidth = (doc: HwpDocument) => {
    const page = JSON.parse(doc.getPageDef(0)) as {
      width: number
      marginLeft: number
      marginRight: number
    }
    return page.width - page.marginLeft - page.marginRight
  }
  const tabsOf = (doc: HwpDocument, para: number) =>
    (
      JSON.parse(doc.getParaPropertiesAt(0, para)) as {
        tabStops: { position: number; type: number; fill: number }[]
      }
    ).tabStops

  /** A small PNG of one colour, made here. */
  function png(width: number, height: number): Uint8Array {
    const table = new Uint32Array(256).map((_, n) => {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      return c >>> 0
    })
    const crc = (bytes: Uint8Array) => {
      let c = 0xffffffff
      for (const byte of bytes) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8)
      return (c ^ 0xffffffff) >>> 0
    }
    const chunk = (type: string, body: Buffer) => {
      const head = Buffer.alloc(4)
      head.writeUInt32BE(body.length)
      const tail = Buffer.alloc(4)
      tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type), body])))
      return Buffer.concat([head, Buffer.from(type), body, tail])
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(width, 0)
    header.writeUInt32BE(height, 4)
    header.set([8, 2, 0, 0, 0], 8)
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x55)])
    const raw = Buffer.concat(Array<Buffer>(height).fill(row))
    return new Uint8Array(
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
      ]),
    )
  }

  it('draws a diagonal across a cell, crosses one out and takes the line away', () => {
    const { plugin, doc, para, steps } = withTable(false)
    const cellOf = (source: HwpDocument, cell: number) =>
      JSON.parse(source.getCellProperties(0, para, tableIn(source, para).control, cell)) as {
        diagonalSlash: number
        diagonalBackSlash: number
        diagonalLine: number
      }
    const before = steps()
    expect(plugin.formatCells(1, [{ row: 1, col: 1 }], { diagonal: 'down' })).toMatchObject({
      ok: true,
      count: 1,
    })
    expect(steps()).toBe(before + 1)
    // the corner cell holds a word, which the line runs through: the answer says so
    expect(plugin.formatCells(1, [{ row: 1, col: 1 }], { diagonal: 'down' })).toMatchObject({
      crossed: [{ row: 1, col: 1 }],
    })
    // from the top left to the bottom right, a solid line
    expect(cellOf(doc(), 0)).toMatchObject({
      diagonalBackSlash: 2,
      diagonalSlash: 0,
      diagonalLine: 1,
    })
    // the cell beside it has none
    expect(cellOf(doc(), 1)).toMatchObject({ diagonalBackSlash: 0, diagonalSlash: 0 })
    // both file formats keep it
    for (const saved of [doc().exportHwp(), doc().exportHwpx()]) {
      expect(cellOf(new HwpDocument(saved), 0).diagonalBackSlash).toBe(2)
    }
    plugin.formatCells(1, [{ row: 2, col: 2 }], { diagonal: 'both' })
    expect(cellOf(doc(), 4)).toMatchObject({ diagonalBackSlash: 2, diagonalSlash: 2 })
    plugin.formatCells(1, [{ row: 1, col: 1 }], { diagonal: 'up' })
    expect(cellOf(doc(), 0)).toMatchObject({ diagonalBackSlash: 0, diagonalSlash: 2 })
    // taking the line away crosses nothing
    expect(plugin.formatCells(1, null, { diagonal: 'none' })).not.toHaveProperty('crossed')
    expect(cellOf(doc(), 0)).toMatchObject({ diagonalBackSlash: 0, diagonalSlash: 0 })
    expect(cellOf(doc(), 4)).toMatchObject({ diagonalBackSlash: 0, diagonalSlash: 0 })
    expect(() => plugin.formatCells(1, null, { diagonal: 'zigzag' as never })).toThrow(/diagonal/)
  })

  it('draws a line round the pages, reads it back and takes it away', () => {
    const { plugin, doc, steps } = open()
    const sideOf = (source: HwpDocument, side: string) =>
      (JSON.parse(source.getPageBorderFill(0)) as Record<string, Line>)[side]!
    expect(plugin.pageLayout().pageBorder).toBeNull()
    const before = steps()
    expect(plugin.setPageBorder({ line: 'double', width: 0.7, color: '#1F3864' })).toEqual({
      ok: true,
      sections: 1,
      drawn: true,
    })
    expect(steps()).toBe(before + 1)
    for (const side of ['borderLeft', 'borderRight', 'borderTop', 'borderBottom']) {
      expect(sideOf(doc(), side).type).toBe(8)
      expect(sideOf(doc(), side).color.toLowerCase()).toBe('#1f3864')
    }
    expect(plugin.pageLayout().pageBorder).toMatchObject({ line: 'double' })
    for (const saved of [doc().exportHwp(), doc().exportHwpx()]) {
      expect(sideOf(new HwpDocument(saved), 'borderTop').type).toBe(8)
    }
    expect(plugin.setPageBorder({ line: 'none' })).toMatchObject({ ok: true, drawn: false })
    expect(sideOf(doc(), 'borderTop').type).toBe(0)
    expect(plugin.pageLayout().pageBorder).toBeNull()
    expect(() => plugin.setPageBorder({ line: 'wavy' as never })).toThrow(/line/)
    expect(() => plugin.setPageBorder({ line: 'solid', color: 'navy' })).toThrow(/color/)
  })

  it('stores every tab stop a whole unit doubled, as Hangul reads a .hwp stop', () => {
    const lines = ['① 다섯	②	③	④	⑤', '① 셋	②	③', '① 둘	②', '성명	(인)']
    const { plugin, doc } = open(blank(lines))
    const places = [...examChoiceStops(5), ...examChoiceStops(3), ...examChoiceStops(2)]
    expect(places).toContain(25.8)
    plugin.formatParagraph('① 다섯', null, {
      tabs: examChoiceStops(5).map((atMm) => ({ atMm })),
    })
    plugin.formatParagraph('① 셋', null, {
      tabs: [...examChoiceStops(3), 33.33, 0.7].map((atMm) => ({ atMm })),
    })
    plugin.formatParagraph('① 둘', null, { tabs: examChoiceStops(2).map((atMm) => ({ atMm })) })
    plugin.formatParagraph('성명', null, { marginRight: 10.125, tabs: [{ leader: 'dots' }] })
    for (const saved of [doc(), new HwpDocument(doc().exportHwp())]) {
      const stored = [0, 1, 2, 3].flatMap((para) => tabsOf(saved, para).map((tab) => tab.position))
      expect(stored).toHaveLength(places.length + 3)
      for (const position of stored) expect(position % 2).toBe(0)
    }
    expect(tabsOf(doc(), 0)[0]!.position).toBe(14626)
  })

  it('sets tab stops with a leader: the right edge of the text unless a place is given', () => {
    const lines = ['차례', '제1장 추진 배경\t3', '제2장 세부 계획\t12', '성명: 홍길동\t(인)', '끝']
    const { plugin, doc, steps } = open(blank(lines))
    const edge = textWidth(doc()) * 2
    const before = steps()
    expect(
      plugin.formatParagraph('제1장 추진 배경', null, { tabs: [{ leader: 'dots' }] }),
    ).toMatchObject({ ok: true })
    expect(steps()).toBe(before + 1)
    // a right tab at the right edge of the text, dots leading to it
    expect(tabsOf(doc(), 1)).toEqual([{ position: edge, type: 1, fill: 3 }])
    // the other paragraphs keep theirs
    expect(tabsOf(doc(), 2)).toEqual([])
    // with a right margin the edge is that much nearer: a stop is counted from the left
    // edge of the text, not from the margins of its paragraph
    plugin.formatParagraph('제2장 세부 계획', null, {
      marginRight: 20,
      tabs: [{ leader: 'dashes' }],
    })
    expect(tabsOf(doc(), 2)).toEqual([{ position: edge - 20 * 200, type: 1, fill: 2 }])
    // stops at places of their own, sorted from the left, the edge last
    plugin.formatParagraph('성명: 홍길동', null, {
      tabs: [{ leader: 'line' }, { atMm: 60, align: 'center' }, { atMm: 30.5, align: 'decimal' }],
    })
    expect(tabsOf(doc(), 3)).toEqual([
      { position: 2 * Math.round((30.5 * 7200) / 25.4), type: 3, fill: 0 },
      { position: 2 * Math.round((60 * 7200) / 25.4), type: 2, fill: 0 },
      { position: edge, type: 1, fill: 1 },
    ])
    for (const saved of [doc().exportHwp(), doc().exportHwpx()]) {
      expect(tabsOf(new HwpDocument(saved), 1)).toEqual([{ position: edge, type: 1, fill: 3 }])
    }
    // an empty list takes the stops away
    plugin.formatParagraph('제1장 추진 배경', null, { tabs: [] })
    expect(tabsOf(doc(), 1)).toEqual([])
    // a style carries them to every paragraph it is given to
    plugin.styleParagraphs({
      styles: [{ name: '차례 줄', format: { tabs: [{ leader: 'dots' }] } }],
      apply: [{ style: '차례 줄', startsWith: '제' }],
    })
    expect(tabsOf(doc(), 1)).toEqual([{ position: edge, type: 1, fill: 3 }])
    expect(tabsOf(doc(), 2)).toEqual([{ position: edge, type: 1, fill: 3 }])
    for (const bad of [
      { tabs: 'dots' },
      { tabs: [{ leader: 'stars' }] },
      { tabs: [{ align: 'middle' }] },
      { tabs: [{ atMm: 0 }] },
      { tabs: [{}, {}] },
    ]) {
      expect(() => plugin.formatParagraph('끝', null, bad as never)).toThrow(/tab/)
    }
    // tab stops belong to a paragraph, not to a piece of its text
    expect(() => plugin.formatText('끝', null, false, { tabs: [{}] })).toThrow(/whole paragraph/)
  })

  it('replaces text on a line that holds a tab, with a tab in find and in the new text', () => {
    const lines = ['식순', '개회 및 국민의례\t10:00', '연혁 보고\t10:10', '끝']
    const { plugin, doc } = open(blank(lines))
    plugin.formatParagraph('연혁 보고', null, { tabs: [{ leader: 'dots' }] })
    const line = (source: HwpDocument) =>
      source.getTextRange(0, 2, 0, source.getParagraphLength(0, 2))
    expect(plugin.replaceText('연혁 보고', '연혁 및 경과 보고', null)).toMatchObject({ ok: true })
    expect(
      plugin.replaceText('연혁 및 경과 보고\t10:10', '연혁 및 경과 보고\t10:15', null),
    ).toMatchObject({ ok: true })
    expect(line(doc())).toBe('연혁 및 경과 보고\t10:15')
    for (const saved of [doc().exportHwpx(), doc().exportHwp()]) {
      expect(line(new HwpDocument(saved))).toBe('연혁 및 경과 보고\t10:15')
    }
    expect(plugin.replaceAllText('10:00', '10:00\t(예정)')).toMatchObject({ ok: true })
    expect(doc().getTextRange(0, 1, 0, doc().getParagraphLength(0, 1))).toBe(
      '개회 및 국민의례\t10:00\t(예정)',
    )
    expect(() => plugin.replaceText('끝', '끝\n다음', null)).toThrow(/one line/)
  })

  it('writes a tab into a table cell in front of the head the engine replaces at once', () => {
    const { plugin, doc } = open()
    plugin.insertTable('□ 세부 일정', null, 'after', [['개회 10:00', '연혁 보고 10:10']])
    const cell = (index: number) => {
      const table = tableIn(doc(), 5)
      const length = doc().getCellParagraphLength(0, 5, table.control, index, 0)
      return doc().getTextInCell(0, 5, table.control, index, 0, 0, length)
    }
    expect(plugin.replaceText('개회 10:00', '개회\t10:05', null)).toMatchObject({ ok: true })
    expect(cell(0)).toBe('개회\t10:05')
    // a new text that starts with the tab
    expect(plugin.replaceText(' 10:10', '\t10:15', null)).toMatchObject({ ok: true })
    expect(cell(1)).toBe('연혁 보고\t10:15')
  })

  it('takes a tab in the text of a new paragraph, and no other control character', () => {
    const { plugin, doc } = open()
    expect(plugin.insertParagraphs('', null, 'end', ['부록 1\t21'])).toMatchObject({ ok: true })
    const last = doc().getParagraphCount(0) - 1
    expect(textOf(doc(), last)).toBe('부록 1\t21')
    expect(() => plugin.insertParagraphs('', null, 'end', ['종\u0007'])).toThrow()
  })

  it('gives a picture another width and keeps its shape', () => {
    const start = blank(['그림 자리', '끝'])
    start.insertPicture(0, 0, 0, '', png(120, 80), 9000, 6000, 120, 80, 'png', '')
    const { plugin, doc, steps } = open(start)
    expect(plugin.listPictures().count).toBe(1)
    const sizeOf = (source: HwpDocument) => {
      const picture = (
        JSON.parse(source.getControls()) as { ctrlId: string; para: number; controlIndex: number }[]
      ).find((control) => /pic|gso/.test(control.ctrlId))!
      return JSON.parse(source.getPictureProperties(0, picture.para, picture.controlIndex)) as {
        width: number
        height: number
      }
    }
    expect(sizeOf(doc())).toMatchObject({ width: 9000, height: 6000 })
    const before = steps()
    const result = plugin.resizePicture(1, { widthMm: 60 })
    expect(result).toMatchObject({ ok: true, widthMm: 60, heightMm: 40, fitted: false })
    expect(steps()).toBe(before + 1)
    // 60 mm in the engine's units, the height in the same proportion
    expect(sizeOf(doc())).toEqual(expect.objectContaining({ width: 17008, height: 11339 }))
    expect(sizeOf(new HwpDocument(doc().exportHwp())).width).toBe(17008)
    // never wider than the text of its page
    const wide = plugin.resizePicture(1, { widthMm: 300 })
    expect(wide).toMatchObject({ ok: true, fitted: true })
    expect(sizeOf(doc()).width).toBeLessThanOrEqual(textWidth(doc()) + 100)
    expect(sizeOf(doc()).height / sizeOf(doc()).width).toBeCloseTo(2 / 3, 2)
    expect(plugin.resizePicture(2, { widthMm: 50 })).toEqual({
      ok: false,
      reason: 'no_such_picture',
      count: 1,
    })
    expect(() => plugin.resizePicture(1, { widthMm: 1 })).toThrow(/widthMm/)
  })

  it('puts equations in the place of their placeholders, as large as the text there', () => {
    const lines = ['1. 다음을 계산하시오. [[1]]', '2. [[2]] 의 값은? 또 [[3]] 은?', '끝']
    const start = blank(lines)
    // the second line is 14 pt
    start.applyCharFormat(
      0,
      1,
      0,
      start.getParagraphLength(0, 1),
      JSON.stringify({ fontSize: 1400 }),
    )
    const { plugin, doc, steps } = open(start)
    const before = steps()
    const result = plugin.insertEquations([
      { find: '[[1]]', script: '{1} over {2} + {1} over {3}' },
      { find: '[[2]]', script: 'sqrt {16}' },
      { find: '[[3]]', script: 'x^2 + 2x + 1' },
    ])
    expect(result).toMatchObject({ ok: true, count: 3 })
    expect(steps()).toBe(before + 1)
    // the placeholders are gone, the words round them stay
    expect(textOf(doc(), 0)).not.toContain('[[')
    expect(textOf(doc(), 1)).not.toContain('[[')
    expect(textOf(doc(), 0)).toContain('1. 다음을 계산하시오.')
    expect(textOf(doc(), 1)).toContain('의 값은? 또')
    const made = equationsOf(doc())
    expect(made.map((equation) => equation.para)).toEqual([0, 1, 1])
    // each holds its script and is as large as the text it stands in
    const written = made.map(
      (equation) =>
        JSON.parse(
          doc().getEquationProperties(0, equation.para, equation.controlIndex, -1, -1),
        ) as { script: string; fontSize: number },
    )
    expect(written.map((equation) => equation.fontSize)).toEqual([1000, 1400, 1400])
    expect(written.map((equation) => equation.script)).toEqual([
      '{1} over {2} + {1} over {3}',
      'sqrt {16}',
      'x^2 + 2x + 1',
    ])
    // the text the model reads back does not show them
    expect(plugin.readText()).not.toContain('over')
    for (const saved of [doc().exportHwp(), doc().exportHwpx()]) {
      expect(equationsOf(new HwpDocument(saved))).toHaveLength(3)
    }
  })

  it('lists the equations with the words round them, changes one and removes another', () => {
    const lines = [
      '넓이는 [[1]] 이다.',
      '비는 [[2]] 이다.',
      '근은 [[3]] 이다.',
      '합은 [[4]] 이다.',
      '원의 넓이는 [[5]] 이다.',
    ]
    const { plugin, doc, steps } = open(blank(lines))
    expect(plugin.listEquations()).toEqual({ count: 0, elsewhere: 0, equations: [] })
    plugin.insertEquations(
      ['x^2', '{a} over {b}', 'sqrt {x}', 'x_1 + x_2', 'pi r^2'].map((script, index) => ({
        find: `[[${index + 1}]]`,
        script,
      })),
    )
    const listed = plugin.listEquations()
    expect(listed).toMatchObject({ count: 5, elsewhere: 0 })
    expect(listed.equations[0]).toEqual({
      equation: 1,
      before: '넓이는 ',
      after: ' 이다.',
      script: 'x^2',
    })
    expect(listed.equations.map((equation) => equation.script)).toEqual([
      'x^2',
      '{a} over {b}',
      'sqrt {x}',
      'x_1 + x_2',
      'pi r^2',
    ])
    const before = steps()
    expect(plugin.editEquation(2, '{1} over {2}')).toMatchObject({
      ok: true,
      removed: false,
      was: '{a} over {b}',
    })
    const second = equationsOf(doc())[1]
    expect(
      (
        JSON.parse(doc().getEquationProperties(0, second.para, second.controlIndex, -1, -1)) as {
          script: string
        }
      ).script,
    ).toBe('{1} over {2}')
    expect(plugin.editEquation(4, null)).toMatchObject({
      ok: true,
      removed: true,
      was: 'x_1 + x_2',
    })
    expect(steps()).toBe(before + 2)
    expect(textOf(doc(), 3)).toBe('합은  이다.')
    expect(plugin.listEquations().equations.map((equation) => equation.script)).toEqual([
      'x^2',
      '{1} over {2}',
      'sqrt {x}',
      'pi r^2',
    ])
    for (const saved of [doc().exportHwpx(), doc().exportHwp()]) {
      expect(equationsOf(new HwpDocument(saved))).toHaveLength(4)
    }
    // the line that held it holds no object now, so it can go
    expect(plugin.deleteParagraph('합은', null)).toMatchObject({ ok: true })
    expect(plugin.editEquation(9, 'x')).toEqual({ ok: false, reason: 'no_such_equation', count: 4 })
    expect(() => plugin.editEquation(1, 'x\ny')).toThrow(/one line/)
  })

  it('keeps the text when asked to, and leaves the document alone when one cannot be placed', () => {
    const { plugin, doc, steps } = withTable(false)
    const before = steps()
    // right after the text it names
    expect(
      plugin.insertEquations([{ find: '추진 배경', script: 'a^2 + b^2 = c^2', replace: false }]),
    ).toMatchObject({ ok: true, count: 1 })
    expect(textOf(doc(), 1)).toContain('□ 추진 배경')
    expect(equationsOf(doc())).toHaveLength(1)
    expect(steps()).toBe(before + 1)
    // the second item is not in the document: the first is not put in either
    expect(
      plugin.insertEquations([
        { find: '세부 일정', script: 'x' },
        { find: '없는 글', script: 'y' },
      ]),
    ).toMatchObject({ ok: false, reason: 'not_found', index: 1, find: '없는 글' })
    expect(equationsOf(doc())).toHaveLength(1)
    expect(steps()).toBe(before + 1)
    // text that occurs twice needs its occurrence
    expect(plugin.insertEquations([{ find: '○', script: 'x' }])).toMatchObject({
      ok: false,
      reason: 'ambiguous',
      index: 0,
      count: 2,
    })
    // text of a table cell
    expect(plugin.insertEquations([{ find: ROWS[1]![0]!, script: 'x' }])).toMatchObject({
      ok: false,
      reason: 'in_table',
      index: 0,
    })
    expect(() => plugin.insertEquations([])).toThrow(/equations/)
    expect(() => plugin.insertEquations([{ find: '세부 일정', script: '  ' }])).toThrow(/script/)
    expect(() => plugin.insertEquations([{ find: '', script: 'x' }])).toThrow(/find/)
  })
})

describe('where an equation of a choice is', () => {
  it('names the line above an equation that has only a circled number round it', () => {
    const lines = [
      '1. 다음 중 이차방정식의 근은?',
      '① [[1]]',
      '② [[2]]',
      '넓이는 [[3]] 이다. 둘레는 따로 구한다.',
    ]
    const { plugin } = open(blank(lines))
    plugin.insertEquations(
      ['x=1', 'x=2', 'pi r^2'].map((script, index) => ({ find: `[[${index + 1}]]`, script })),
    )
    const listed = plugin.listEquations().equations
    expect(listed[0]).toMatchObject({ before: '① ', previous: '1. 다음 중 이차방정식의 근은?' })
    expect(listed[1]).toMatchObject({ before: '② ', previous: '1. 다음 중 이차방정식의 근은?' })
    expect(listed[2]).not.toHaveProperty('previous')
  })

  it('names the question each short choice stands under, and none outside a question', () => {
    const lines = [
      '1. 다음 중 가장 큰 수를 고르시오.',
      '① [[1]]',
      '③ 3과 5의 최소공배수는 15이다.',
      '2) 계산하면?',
      '① [[2]]',
      '(3) [[3]]의 값은?',
      '문 4. 다음을 보고 답하시오.',
      '① [[4]] ② [[5]]',
    ]
    const { plugin } = open(blank(lines))
    plugin.insertEquations(
      ['{1} over {2}', '3 times 4', 'sqrt {16}', 'a', 'b'].map((script, index) => ({
        find: `[[${index + 1}]]`,
        script,
      })),
    )
    const previous = plugin.listEquations().equations.map((equation) => equation.previous ?? null)
    expect(previous).toEqual([
      '1. 다음 중 가장 큰 수를 고르시오…',
      '2) 계산하면?',
      null,
      '문 4. 다음을 보고 답하시오.',
      '문 4. 다음을 보고 답하시오.',
    ])
    const plain = open(blank(['○ 회의 안내를 적는 줄입니다.', '① [[1]]']))
    plain.plugin.insertEquations([{ find: '[[1]]', script: 'x' }])
    expect(plain.plugin.listEquations().equations[0]).not.toHaveProperty('previous')
  })

  const previousOf = (lines: string[], count: number) => {
    const { plugin } = open(blank(lines))
    plugin.insertEquations(
      Array.from({ length: count }, (_, index) => ({ find: `[[${index + 1}]]`, script: 'x' })),
    )
    return plugin.listEquations().equations.map((equation) => equation.previous ?? null)
  }

  it('takes 가. for questions, a question that names a circled mark, and 1) choices', () => {
    expect(
      previousOf(
        [
          'Ⅰ. 선택형',
          '1. 다음 식을 계산한 값은?',
          '① [[1]]',
          'Ⅱ. 서답형',
          '가. 다음 방정식의 해를 구하시오.',
          '① [[2]]',
          '(나) 다음 부등식을 푸시오.',
          '① [[3]]',
        ],
        3,
      ),
    ).toEqual([
      '1. 다음 식을 계산한 값은?',
      '가. 다음 방정식의 해를 구하시오.',
      '(나) 다음 부등식을 푸시오.',
    ])
    expect(
      previousOf(['1. 다음 식의 값은?', '① [[1]]', '2. 옳은 것을 ①~③에서 고르시오.', '① [[2]]'], 2),
    ).toEqual(['1. 다음 식의 값은?', '2. 옳은 것을 ①~③에서 고르시오.'])
    expect(
      previousOf(['1. 다음 중 옳은 식을 고르시오.', '1) [[1]]  2) [[2]]', '3) [[3]]'], 3),
    ).toEqual(Array(3).fill('1. 다음 중 옳은 식을 고르시오.'))
  })

  it('takes a line numbered like the question above for the next question', () => {
    expect(
      previousOf(
        ['[서답형] 각 2점', '1) [[1]]을 구하시오.', '2) [[2]]을 구하시오.', '3) [[3]]을 구하시오.'],
        3,
      ),
    ).toEqual([null, null, null])
    expect(
      previousOf(
        [
          '1) 다음 값을 구하시오.',
          '[[1]]',
          '2) 다음 식을 줄이시오.',
          '[[2]]',
          '3) 방정식을 푸시오.',
          '[[3]]',
        ],
        3,
      ),
    ).toEqual(['1) 다음 값을 구하시오.', '2) 다음 식을 줄이시오.', '3) 방정식을 푸시오.'])
    expect(
      previousOf(
        [
          '(1) 다음 값을 구하시오. [[1]]',
          '(2) 다음 값을 구하시오.',
          '① [[2]] ② [[3]]',
          '(3) 방정식을 푸시오.',
          '① [[4]]',
        ],
        4,
      ),
    ).toEqual([null, '(2) 다음 값을 구하시오.', '(2) 다음 값을 구하시오.', '(3) 방정식을 푸시오.'])
    expect(
      previousOf(
        [
          '1. 다음 글을 읽고 답하시오.',
          '글이 여기에 온다.',
          '(1) [[1]]의 값은?',
          '① [[2]]',
          '2. 다음 값은?',
          '1) [[3]]',
        ],
        3,
      ),
    ).toEqual([null, '(1) 의 값은?', '2. 다음 값은?'])
  })

  it('takes Ⅰ. and Ⅱ. for the start of a part, not a question', () => {
    expect(previousOf(['Ⅰ. 선택형', '[[1]]'], 1)).toEqual([null])
    expect(previousOf(['1. 다음 값은?', '① [[1]]', 'Ⅱ. 서답형', '[[2]]'], 2)).toEqual([
      '1. 다음 값은?',
      null,
    ])
  })
})

describe('a paragraph that holds an object of its line', () => {
  const textOf = (doc: HwpDocument, para: number) =>
    doc.getTextRange(0, para, 0, doc.getParagraphLength(0, para))
  const bodyText = (doc: HwpDocument) =>
    Array.from({ length: doc.getParagraphCount(0) }, (_, para) => textOf(doc, para))
  const controlsOf = (doc: HwpDocument, id: string) =>
    (JSON.parse(doc.getControls()) as { ctrlId: string; list: number; para: number }[])
      .filter((control) => control.list === 0 && control.ctrlId === id)
      .map((control) => control.para)
  const places = (doc: HwpDocument, para: number) =>
    JSON.parse(doc.getControlTextPositions(0, para)) as number[]

  it('adds paragraphs after a line with equations and leaves the line whole', () => {
    const { plugin, doc } = open(
      blank([
        '머리',
        '넓이는 [[1]] 이다.',
        '두 개: [[2]] 와 [[3]] 끝.',
        '끝자리 수식 [[4]]',
        '끝 문단.',
      ]),
    )
    plugin.insertEquations([
      { find: '[[1]]', script: 'x^2' },
      { find: '[[2]]', script: 'a' },
      { find: '[[3]]', script: 'b' },
      { find: '[[4]]', script: 'y^2' },
    ])
    expect(plugin.insertParagraphs('넓이는', null, 'after', ['가운데.'])).toMatchObject({
      ok: true,
    })
    expect(plugin.insertParagraphs('두 개:', null, 'after', ['둘째.'])).toMatchObject({ ok: true })
    expect(plugin.insertParagraphs('끝자리', null, 'after', ['셋째.'])).toMatchObject({ ok: true })
    expect(plugin.insertParagraphs('', null, 'end', ['맨 끝.'])).toMatchObject({ ok: true })
    expect(bodyText(doc())).toEqual([
      '머리',
      '넓이는  이다.',
      '가운데.',
      '두 개:  와  끝.',
      '둘째.',
      '끝자리 수식 ',
      '셋째.',
      '끝 문단.',
      '맨 끝.',
    ])
    expect(controlsOf(doc(), 'eqed')).toEqual([1, 3, 3, 5])
    expect(places(doc(), 1)).toEqual([4])
    expect(places(doc(), 3)).toEqual([5, 8])
  })

  it('adds a paragraph or a table after a line with a footnote mark or a picture in it', () => {
    const start = blank([
      '머리',
      '각주가 붙는 낱말 뒤의 글.',
      '그림 앞 글과 그림 뒤 글.',
      '표가 올 낱말 줄.',
      '끝',
    ])
    start.insertPicture(0, 2, 5, '', ONE_PIXEL, 2000, 2000, 1, 1, 'png', '')
    start.setPictureProperties(0, 2, 0, JSON.stringify({ treatAsChar: true }))
    const { plugin, doc } = open(start)
    plugin.insertNote('footnote', '붙는 낱말', null, '첫 각주')
    plugin.insertNote('footnote', '올 낱말', null, '둘째 각주')
    expect(plugin.insertParagraphs('각주가 붙는', null, 'after', ['각주 뒤.'])).toMatchObject({
      ok: true,
    })
    expect(plugin.insertParagraphs('그림 앞 글', null, 'after', ['그림 뒤.'])).toMatchObject({
      ok: true,
    })
    expect(plugin.insertTable('표가 올', null, 'after', [['a', 'b']], false)).toMatchObject({
      ok: true,
    })
    expect(bodyText(doc())).toEqual([
      '머리',
      '각주가 붙는 낱말 뒤의 글.',
      '각주 뒤.',
      '그림 앞 글과 그림 뒤 글.',
      '그림 뒤.',
      '표가 올 낱말 줄.',
      '',
      '끝',
    ])
    expect(controlsOf(doc(), 'fn')).toEqual([1, 5])
    expect(controlsOf(doc(), 'tbl')).toEqual([6])
    expect(places(doc(), 3)).toEqual([5])
  })

  it('adds a paragraph in a table cell after a line with an object, and refuses to split such a line in the middle', () => {
    const { plugin, doc, steps } = open(blank(['머리', '표 앞', '끝']))
    plugin.insertTable('표 앞', null, 'after', [['셀 글과 뒤 글.', 'b']], false)
    const cell = (paragraph: number) =>
      JSON.stringify([{ controlIndex: 0, cellIndex: 0, cellParaIndex: paragraph }])
    const cellText = (paragraph: number) => doc().getTextInCellByPath(0, 2, cell(paragraph), 0, 40)
    doc().insertCharOverlapByPath(
      0,
      2,
      cell(0),
      2,
      JSON.stringify({ text: '1', shape: 1, innerSize: 0, overlap: true }),
    )
    expect(plugin.insertParagraphs('셀 글과', null, 'after', ['칸 새 줄.'])).toMatchObject({
      ok: true,
      inTable: true,
    })
    expect(doc().getCellParagraphCountByPath(0, 2, cell(0))).toBe(2)
    expect(cellText(0)).toBe('셀 글과 뒤 글.')
    expect(cellText(1)).toBe('칸 새 줄.')
    const before = steps()
    const selected = {
      sec: 0,
      para: 2,
      path: JSON.parse(cell(0)),
      offset: 5,
      length: 1,
      text: '뒤',
    }
    expect(plugin.replaceSelection([selected], ['앞', '새 문단'])).toEqual({
      ok: false,
      reason: 'has_objects',
      count: 1,
    })
    expect(steps()).toBe(before)
    expect(doc().getCellParagraphCountByPath(0, 2, cell(0))).toBe(2)
    expect(cellText(0)).toBe('셀 글과 뒤 글.')
  })

  const savedLines = async (doc: HwpDocument, texts: string[]) => {
    const forms = [doc.exportHwpx(), new HwpDocument(doc.exportHwp()).exportHwpx()]
    return Promise.all(
      forms.map(async (bytes) => {
        const zip = await JSZip.loadAsync(bytes)
        const xml = await zip.file('Contents/section0.xml')!.async('string')
        const paragraphs = [...xml.matchAll(/<hp:p [^>]*>((?:(?!<hp:p ).)*?)<\/hp:p>/gs)].map(
          (match) => match[1]!.replace(/<hp:linesegarray>.*?<\/hp:linesegarray>/gs, ''),
        )
        return texts.map((text) => paragraphs.filter((inner) => inner.includes(text)))
      }),
    )
  }

  it('adds paragraphs and tables before and after a line with an equation and leaves the line as it was', async () => {
    const { plugin, doc } = open(
      blank(['머리', '1. 일차함수 [[1]]의 그래프의 기울기는?', '[[2]] 로 시작하는 줄', '끝']),
    )
    plugin.insertEquations([
      { find: '[[1]]', script: 'y=2x-3' },
      { find: '[[2]]', script: 'a over b' },
    ])
    const anchors = ['의 그래프의 기울기는?', ' 로 시작하는 줄']
    const kept = await savedLines(doc(), anchors)
    expect(kept.flat(2).filter((xml) => xml.includes('<hp:equation'))).toHaveLength(4)
    for (const anchor of anchors) {
      for (const where of ['before', 'after'] as const) {
        expect(plugin.insertParagraphs(anchor, null, where, [`${where} 글`])).toMatchObject({
          ok: true,
        })
        expect(plugin.insertTable(anchor, null, where, [[where, '표']], false)).toMatchObject({
          ok: true,
        })
      }
    }
    expect(bodyText(doc())).toEqual([
      '머리',
      'before 글',
      '',
      '1. 일차함수 의 그래프의 기울기는?',
      '',
      'after 글',
      'before 글',
      '',
      ' 로 시작하는 줄',
      '',
      'after 글',
      '끝',
    ])
    expect(controlsOf(doc(), 'eqed')).toEqual([3, 8])
    expect(places(doc(), 3)).toEqual([8])
    expect(places(doc(), 8)).toEqual([0])
    expect(await savedLines(doc(), anchors)).toEqual(kept)
  })

  it('lays a head table across the columns in front of a first line that holds an equation', () => {
    const { plugin, doc, steps } = open(
      blank(['1. 일차함수 [[1]]의 그래프의 기울기는?', '① -3', '끝']),
    )
    plugin.insertEquations([{ find: '[[1]]', script: 'y=2x-3' }])
    plugin.setColumns({ count: 2 })
    expect(
      plugin.insertTable('의 그래프의 기울기는?', null, 'before', [['학년', '반']], {
        header: true,
        acrossColumns: true,
      }),
    ).toMatchObject({ ok: true, acrossColumns: true, place: { para: 0 } })
    expect(textOf(doc(), 0)).toBe('1. 일차함수 의 그래프의 기울기는?')
    expect(controlsOf(doc(), 'eqed')).toEqual([0])
    expect(controlsOf(doc(), 'tbl')).toEqual([0])
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const again = new HwpDocument(bytes)
      expect(textOf(again, 0)).toBe('1. 일차함수 의 그래프의 기울기는?')
      expect(controlsOf(again, 'eqed')).toEqual([0])
    }
    const before = steps()
    const refused = { ok: false, reason: 'has_objects', count: 1, outOfLine: true }
    expect(plugin.insertParagraphs('의 그래프의 기울기는?', null, 'before', ['x'])).toEqual(refused)
    expect(
      plugin.insertTable('의 그래프의 기울기는?', null, 'before', [['a', 'b']], false),
    ).toEqual(refused)
    expect(steps()).toBe(before)
    expect(textOf(doc(), 0)).toBe('1. 일차함수 의 그래프의 기울기는?')
    expect(controlsOf(doc(), 'tbl')).toEqual([0])
  })

  it('adds a line in front of one with a picture set in it or a footnote, not of one with a floating picture', () => {
    const start = blank(['머리', '그림이 든 줄', '떠 있는 그림 줄', '각주가 붙는 줄', '끝'])
    start.insertPicture(0, 1, 2, '', ONE_PIXEL, 2000, 2000, 1, 1, 'png', '')
    start.setPictureProperties(0, 1, 0, JSON.stringify({ treatAsChar: true }))
    start.insertPicture(0, 2, 2, '', ONE_PIXEL, 2000, 2000, 1, 1, 'png', '')
    const { plugin, doc, steps } = open(start)
    plugin.insertNote('footnote', '붙는 줄', null, '각주')
    expect(plugin.insertParagraphs('그림이 든', null, 'before', ['앞 1'])).toMatchObject({
      ok: true,
    })
    expect(plugin.insertParagraphs('각주가 붙는', null, 'before', ['앞 2'])).toMatchObject({
      ok: true,
    })
    const before = steps()
    expect(plugin.insertParagraphs('떠 있는', null, 'before', ['앞 3'])).toEqual({
      ok: false,
      reason: 'has_objects',
      count: 1,
      outOfLine: true,
    })
    expect(steps()).toBe(before)
    expect(bodyText(doc())).toEqual([
      '머리',
      '앞 1',
      '그림이 든 줄',
      '떠 있는 그림 줄',
      '앞 2',
      '각주가 붙는 줄',
      '끝',
    ])
    expect(places(doc(), 2)).toEqual([2])
    expect(controlsOf(doc(), 'fn')).toEqual([5])
  })

  it('leaves the first line of a later section alone, whose section stays in front of a split', () => {
    const start = blank(['머리', '둘째 구역 첫 줄', '끝'])
    start.splitSection(0, 1, 0)
    const { plugin, doc, steps } = open(start)
    const before = steps()
    expect(plugin.insertParagraphs('둘째 구역 첫 줄', null, 'before', ['x'])).toEqual({
      ok: false,
      reason: 'has_objects',
      count: 1,
    })
    expect(steps()).toBe(before)
    expect(doc().getTextRange(1, 0, 0, doc().getParagraphLength(1, 0))).toBe('둘째 구역 첫 줄')
  })

  it('adds paragraphs before and after a cell line that holds an equation and leaves the line as it was', async () => {
    const made = open(blank(['머리', '수식 [[1]]', '표 앞', '끝']))
    made.plugin.insertEquations([{ find: '[[1]]', script: 'a over b' }])
    made.plugin.insertTable('표 앞', null, 'after', [['칸 끝말', '둘째 칸']], false)
    const zip = await JSZip.loadAsync(made.doc().exportHwpx())
    const xml = await zip.file('Contents/section0.xml')!.async('string')
    const equation = xml.match(/<hp:equation [\s\S]*?<\/hp:equation>/)![0]
    const numbered = (id: number) => equation.replace(/ id="\d+"/, ` id="${id}"`)
    zip.file(
      'Contents/section0.xml',
      xml
        .replace('<hp:t>칸 끝말</hp:t>', `<hp:t>칸 </hp:t>${numbered(7001)}<hp:t> 끝말</hp:t>`)
        .replace('<hp:t>둘째 칸</hp:t>', `${numbered(7002)}<hp:t>둘째 칸</hp:t>`),
    )
    const { plugin, doc } = open(new HwpDocument(await zip.generateAsync({ type: 'uint8array' })))
    const cell = (index: number, paragraph: number) =>
      JSON.stringify([{ controlIndex: 0, cellIndex: index, cellParaIndex: paragraph }])
    const cellLines = (index: number) =>
      Array.from({ length: doc().getCellParagraphCountByPath(0, 3, cell(index, 0)) }, (_, k) =>
        doc().getTextInCellByPath(0, 3, cell(index, k), 0, 40),
      )
    expect(cellLines(0)).toEqual(['칸  끝말'])
    expect(cellLines(1)).toEqual(['둘째 칸'])
    const anchors = [' 끝말', '둘째 칸']
    const kept = await savedLines(doc(), anchors)
    expect(kept.flat(2).filter((line) => line.includes('<hp:equation'))).toHaveLength(4)
    for (const anchor of anchors) {
      for (const where of ['before', 'after'] as const) {
        expect(plugin.insertParagraphs(anchor, null, where, [`${where} 글`])).toMatchObject({
          ok: true,
          inTable: true,
        })
      }
    }
    expect(cellLines(0)).toEqual(['before 글', '칸  끝말', 'after 글'])
    expect(cellLines(1)).toEqual(['before 글', '둘째 칸', 'after 글'])
    expect(await savedLines(doc(), anchors)).toEqual(kept)
  })

  it('replaces words beside an equation and leaves the equation where it stands', () => {
    const { plugin, doc } = open(
      blank(['머리', '가나[[1]]다라', '마바[[2]]사아', '7. [[3]]를 계산하면?', '끝']),
    )
    plugin.insertEquations([
      { find: '[[1]]', script: 'a' },
      { find: '[[2]]', script: 'b' },
      { find: '[[3]]', script: '12x^3 div 4x' },
    ])
    expect(plugin.replaceText('가나', 'AAAA', null)).toMatchObject({ ok: true })
    expect(textOf(doc(), 1)).toBe('AAAA다라')
    expect(places(doc(), 1)).toEqual([4])
    expect(plugin.replaceText('사아', 'BBBB', null)).toMatchObject({ ok: true })
    expect(textOf(doc(), 2)).toBe('마바BBBB')
    expect(places(doc(), 2)).toEqual([2])
    expect(plugin.replaceText('B', 'C', 1)).toMatchObject({ ok: true })
    expect(textOf(doc(), 2)).toBe('마바CBBB')
    expect(places(doc(), 2)).toEqual([2])
    expect(plugin.replaceText('CBBB', '', null)).toMatchObject({ ok: true })
    expect(textOf(doc(), 2)).toBe('마바')
    expect(places(doc(), 2)).toEqual([2])
    expect(plugin.replaceText('7. ', '8. ', null)).toMatchObject({ ok: true })
    expect(textOf(doc(), 3)).toBe('8. 를 계산하면?')
    expect(places(doc(), 3)).toEqual([3])
    expect(controlsOf(doc(), 'eqed')).toEqual([1, 2, 3])
  })

  it('refuses a replacement across an equation and changes nothing', () => {
    const { plugin, doc, steps } = open(
      blank(['머리', '7. [[1]]를 계산하면?', '파하[[2]]거너', '하거 하거', '끝']),
    )
    plugin.insertEquations([
      { find: '[[1]]', script: '12x^3 div 4x' },
      { find: '[[2]]', script: 'd' },
    ])
    const before = steps()
    expect(plugin.replaceText('7. 를 계산', '8. 를 계산', null)).toEqual({
      ok: false,
      reason: 'spans_object',
      count: 1,
    })
    expect(steps()).toBe(before)
    expect(textOf(doc(), 1)).toBe('7. 를 계산하면?')
    expect(places(doc(), 1)).toEqual([3])
    expect(plugin.replaceAllText('하거', 'DD')).toMatchObject({ ok: true, count: 2, skipped: 1 })
    expect(textOf(doc(), 2)).toBe('파하거너')
    expect(places(doc(), 2)).toEqual([2])
    expect(textOf(doc(), 3)).toBe('DD DD')
    const after = steps()
    expect(plugin.replaceAllText('하거', 'EE')).toEqual({
      ok: false,
      reason: 'spans_object',
      count: 1,
    })
    expect(steps()).toBe(after)
    const run = { sec: 0, para: 2, offset: 0, length: 4, text: '파하거너' }
    expect(plugin.replaceSelection([run], ['새 글'])).toEqual({
      ok: false,
      reason: 'spans_object',
      count: 1,
    })
    expect(steps()).toBe(after)
    expect(textOf(doc(), 2)).toBe('파하거너')
  })
})

describe('removing what follows a table', () => {
  const textOf = (doc: HwpDocument, para: number) =>
    doc.getTextRange(0, para, 0, doc.getParagraphLength(0, para))
  const bodyText = (doc: HwpDocument) =>
    Array.from({ length: doc.getParagraphCount(0) }, (_, para) => textOf(doc, para))
  const tableParagraphs = (doc: HwpDocument) =>
    (JSON.parse(doc.getControls()) as { ctrlId: string; list: number; para: number }[])
      .filter((control) => control.list === 0 && control.ctrlId === 'tbl')
      .map((control) => control.para)

  it('removes a body paragraph that follows a table, and a table that follows another', () => {
    const { plugin, doc, steps } = open(blank(['머리', '표 앞', '표 뒤 문단', '다음 글', '끝']))
    plugin.insertTable('표 앞', null, 'after', [['a', 'b']], false)
    plugin.insertTable('표 뒤 문단', null, 'before', [['c', 'd']], false)
    expect(bodyText(doc())).toEqual(['머리', '표 앞', '', '', '표 뒤 문단', '다음 글', '끝'])
    expect(tableParagraphs(doc())).toEqual([2, 3])
    const before = steps()
    expect(plugin.deleteParagraph('표 뒤 문단', null)).toMatchObject({
      ok: true,
      text: '표 뒤 문단',
      emptied: false,
    })
    expect(steps()).toBe(before + 1)
    expect(bodyText(doc())).toEqual(['머리', '표 앞', '', '', '다음 글', '끝'])
    expect(tableParagraphs(doc())).toEqual([2, 3])
    expect(plugin.deleteTable(2)).toMatchObject({ ok: true, table: 2, rows: 1, cols: 2 })
    expect(bodyText(doc())).toEqual(['머리', '표 앞', '', '다음 글', '끝'])
    expect(tableParagraphs(doc())).toEqual([2])
    expect(plugin.listTables().count).toBe(1)
    expect(plugin.readTable(1)).toMatchObject({ ok: true, cells: [{ text: 'a' }, { text: 'b' }] })
  })

  it('removes the title line of a table of contents once its table is gone', () => {
    const { plugin, doc } = open(
      blank(['보고서 제목', '1. 추진 배경', '배경 글입니다.', '2. 추진 계획', '계획 글입니다.']),
    )
    plugin.insertTitleBox('보고서 제목', null, { look: 'box' })
    plugin.insertToc('1. 추진 배경', null, 'before', '차 례', [
      { find: '1. 추진 배경', level: 1 },
      { find: '2. 추진 계획', level: 1 },
    ])
    expect(plugin.listTables().count).toBe(2)
    expect(bodyText(doc()).slice(0, 3)).toEqual(['', '차 례', ''])
    expect(plugin.deleteTable(2)).toMatchObject({ ok: true })
    expect(plugin.deleteParagraph('차 례', null)).toMatchObject({ ok: true, text: '차 례' })
    expect(bodyText(doc())).toEqual([
      '',
      '1. 추진 배경',
      '배경 글입니다.',
      '2. 추진 계획',
      '계획 글입니다.',
    ])
    expect(tableParagraphs(doc())).toEqual([0])
    expect(plugin.readText()).toContain('보고서 제목')
  })

  it('removes a selected paragraph behind a line that ends in a picture', () => {
    const start = blank(['머리', '그림이 끝에 놓인 줄', '지울 문단', '끝'])
    start.insertPicture(
      0,
      1,
      start.getParagraphLength(0, 1),
      '',
      ONE_PIXEL,
      2000,
      2000,
      1,
      1,
      'png',
      '',
    )
    const { plugin, doc } = open(start)
    const pictures = () =>
      (JSON.parse(doc().getControls()) as { ctrlId: string; list: number; para: number }[])
        .filter((control) => control.list === 0 && control.ctrlId === 'gso')
        .map((control) => control.para)
    expect(pictures()).toEqual([1])
    const selected = [
      { sec: 0, para: 1, offset: 0, length: 11, text: '그림이 끝에 놓인 줄' },
      { sec: 0, para: 2, offset: 0, length: 5, text: '지울 문단' },
    ]
    expect(plugin.replaceSelection(selected, ['그림이 끝에 놓인 줄'])).toMatchObject({ ok: true })
    expect(bodyText(doc())).toEqual(['머리', '그림이 끝에 놓인 줄', '끝'])
    expect(pictures()).toEqual([1])
    expect(plugin.deleteParagraph('끝', 2)).toMatchObject({ ok: true, text: '끝' })
    expect(bodyText(doc())).toEqual(['머리', '그림이 끝에 놓인 줄'])
    expect(pictures()).toEqual([1])
  })
})

describe('what a change leaves on the pages', () => {
  const lines = (count: number, word = '본문 줄') =>
    Array.from({ length: count }, (_, k) => `${word} ${k + 1}`)
  const rows = (count: number) => Array.from({ length: count }, (_, k) => [`${k + 1}행`, '값'])

  it('maps the pages: the words each starts and ends with, and a caption left at the foot', () => {
    const { plugin } = open(blank([...lines(36), '<표 1> 일정']))
    expect(plugin.insertTable('<표 1> 일정', null, 'after', rows(10), false)).toMatchObject({
      ok: true,
    })
    const { pages, map } = plugin.pageLayout()
    expect(pages).toBe(2)
    expect(map.pages).toEqual([
      { page: 1, first: { text: '본문 줄 1' }, last: { text: '<표 1> 일정' } },
      { page: 2, first: { table: 1 }, last: { table: 1 } },
    ])
    expect(map.alone).toEqual([
      { page: 1, kind: 'caption', text: '<표 1> 일정', style: '바탕글', nextPage: 2 },
    ])
    expect([map.spans, map.past]).toEqual([[], []])
  })

  it('names a heading that ends a page while its text starts the next one', () => {
    const { plugin } = open(blank(lines(70)))
    const foot = plugin.pageLayout().map.pages[0]
    if (!('last' in foot) || !('text' in foot.last)) throw new Error('page 1 ends with no text')
    expect(plugin.pageLayout().map.alone).toEqual([])
    plugin.styleParagraphs({
      styles: [{ name: '머리', format: {}, keepWithNext: true }],
      apply: [{ style: '머리', find: foot.last.text }],
    })
    expect(plugin.pageLayout().map.alone).toEqual([
      { page: 1, kind: 'line', text: foot.last.text, style: '머리', nextPage: 2, kept: true },
    ])
  })

  it('looks past empty lines after a lone line, and calls a caption only what is one', () => {
    const { plugin } = open(blank([...lines(40), '□ 머리 제목', '', ...lines(20, '다음 줄')]))
    plugin.styleParagraphs({
      styles: [{ name: '머리', format: {}, keepWithNext: true }],
      apply: [{ style: '머리', find: '□ 머리 제목' }],
    })
    const { map } = plugin.pageLayout()
    expect(map.pages[1]).toMatchObject({ first: { text: '다음 줄 1' } })
    expect(map.alone).toEqual([
      { page: 1, kind: 'line', text: '□ 머리 제목', style: '머리', nextPage: 2, kept: true },
    ])
    const before = open(blank([...lines(36), '이용자 수는 아래와 같다']))
    before.plugin.insertTable('이용자 수는 아래와 같다', null, 'after', rows(10), false)
    before.plugin.styleParagraphs({
      styles: [{ name: '앞줄', format: {}, keepWithNext: true }],
      apply: [{ style: '앞줄', find: '이용자 수는 아래와 같다' }],
    })
    expect(before.plugin.pageLayout().map.alone).toEqual([
      {
        page: 1,
        kind: 'line',
        text: '이용자 수는 아래와 같다',
        style: '앞줄',
        nextPage: 2,
        kept: true,
      },
    ])
  })

  it('keeps a kept line apart from its text only when the empty line after it stays on its page', () => {
    const { plugin } = open(blank([...lines(39), '□ 추진 배경', '', ...lines(10, '다음 줄')]))
    plugin.styleParagraphs({
      styles: [{ name: '소제목', format: {}, keepWithNext: true }],
      apply: [{ style: '소제목', find: '□ 추진 배경' }],
    })
    const { map } = plugin.pageLayout()
    expect(map.pages[0]).toMatchObject({ last: { text: '□ 추진 배경' } })
    expect(map.pages[1]).toMatchObject({ first: { text: '다음 줄 1' } })
    expect(map.alone).toEqual([
      {
        page: 1,
        kind: 'line',
        text: '□ 추진 배경',
        style: '소제목',
        nextPage: 2,
        kept: true,
        apart: true,
      },
    ])
  })

  it('takes a line of only spaces between a caption and its table for an empty line', () => {
    const { plugin } = open(blank([...lines(36), '<표 1> 일정', ' ', '표 뒤']))
    plugin.insertTable('표 뒤', null, 'before', rows(10), false)
    const { map } = plugin.pageLayout()
    expect(map.pages[1]).toMatchObject({ first: { table: 1 } })
    expect(map.alone).toEqual([
      {
        page: 1,
        kind: 'caption',
        text: '<표 1> 일정',
        style: '바탕글',
        nextPage: 2,
        apart: true,
      },
    ])
  })

  it('quotes the words a page starts with when its paragraph began on the page before', () => {
    const long = Array.from(
      { length: 30 },
      (_, k) => `긴 문단의 ${k + 1}번째 마디가 이어집니다.`,
    ).join(' ')
    const { plugin } = open(blank([...lines(36), long, '마지막 줄']))
    const { map } = plugin.pageLayout()
    expect(map.pages).toHaveLength(2)
    const [one, two] = map.pages as Extract<AgentMapPage, { first: unknown }>[]
    expect(one!.last).toEqual({ text: expect.stringMatching(/^긴 문단의 1번째/) })
    expect(two!.first).toEqual({
      text: expect.not.stringMatching(/^긴 문단의 1번째/),
      continues: true,
    })
    expect('text' in two!.first && long.includes(two!.first.text.replace(/…$/, ''))).toBe(true)
  })

  it('counts the start of a page in characters of the text, past an object before it', () => {
    const long = Array.from(
      { length: 30 },
      (_, k) => `긴 문단의 ${k + 1}번째 마디가 이어집니다.`,
    ).join(' ')
    const { plugin } = open(blank([...lines(36), long, '마지막 줄']))
    const startOf = () => (plugin.pageLayout().map.pages[1] as { first: AgentPageEnd }).first
    const plain = startOf()
    expect(plugin.insertNote('endnote', '긴 문단의 1번째', null, '미주 글')).toMatchObject({
      ok: true,
    })
    expect(startOf()).toEqual(plain)
  })

  it('takes a paragraph that starts with spaces for one that starts on its page', () => {
    const fixtureMap = (name: string) =>
      open(new HwpDocument(readFileSync(join(__dirname, 'fixtures', name)))).plugin.pageLayout().map
        .pages as Extract<AgentMapPage, { first: unknown }>[]
    expect(fixtureMap('page-number-cell-position.hwpx')[0]).toMatchObject({
      first: { text: 'Cover' },
      last: { text: 'Cover' },
    })
    const memo = fixtureMap('memo-source.hwp')
    expect(memo[2]!.first).toEqual({ text: expect.stringMatching(/^○ 연령대별/) })
    expect(memo[1]!.last).toEqual({ text: expect.stringMatching(/^○ 6월 말 기준/) })
  })

  it('tells a page with nothing on it', () => {
    const doc = blank(['앞 쪽', '', '뒤 쪽'])
    doc.insertPageBreak(0, 1, 0)
    doc.insertPageBreak(0, 3, 0)
    const { map } = open(doc).plugin.pageLayout()
    expect(map.pages.map((page) => ('empty' in page ? 'empty' : page.first))).toEqual([
      { text: '앞 쪽' },
      'empty',
      { text: '뒤 쪽' },
    ])
  })

  it('names a table that runs over pages, and one taller than a page that runs off it', () => {
    const { plugin, doc } = open(blank(lines(3)))
    plugin.insertTable('본문 줄 3', null, 'after', rows(70), false)
    const tall = plugin.pageLayout().map
    expect(tall.past).toEqual([{ table: 1, page: 2, row: expect.any(Number), taller: true }])
    expect(tall.spans).toEqual([])
    const cut = plugin.checkLayout(null, null)
    expect(cut.cells).toEqual([])
    expect(cut.past).toEqual([{ table: 1, page: 2, row: tall.past[0]!.row, taller: true }])
    for (const [from, to] of [
      [60, 62],
      [65, 65],
      [1, 1],
    ] as const) {
      expect(plugin.checkLayout(1, from, to).past).toEqual(cut.past)
    }
    const { control } = tableIn(doc(), 3)
    doc().setTableProperties(0, 3, control, JSON.stringify({ treatAsChar: false, pageBreak: 1 }))
    const split = plugin.pageLayout().map
    expect(split.spans).toEqual([{ table: 1, from: 1, to: 3 }])
    expect([split.past, plugin.checkLayout(null, null).past]).toEqual([[], []])
  })

  it('maps the body alone, not what the master page draws with the same numbers', () => {
    for (const name of ['master-page-duplex-both.hwpx', 'master-page-duplex-odd-even.hwpx']) {
      const doc = new HwpDocument(readFileSync(join(__dirname, 'fixtures', name)))
      const { plugin } = open(doc)
      const { map } = plugin.pageLayout()
      expect(map.pages).toEqual([
        { page: 1, first: { text: 'Body page one' }, last: { text: 'Body page one' } },
        { page: 2, first: { text: 'Body page 2' }, last: { text: 'Body page 2' } },
      ])
      expect([map.alone, map.spans, map.past]).toEqual([[], [], []])
      expect(plugin.checkLayout(null, null)).toMatchObject({ cells: [], past: [] })
    }
  })

  it('gives a title the height of the lines it takes, so that nothing of it is cut', () => {
    const long = '2026년 상반기 신규 직원 직무 역량 강화를 위한 연수 운영 계획 및 예산 집행 방안'
    for (const [title, size, lineCount] of [
      [TITLE, 22, 1],
      [long, 20, 2],
    ] as const) {
      const { plugin, doc } = open(blank([title, '□ 목적']))
      expect(plugin.insertTitleBox(title, null, { look: 'bands', size })).toMatchObject({
        ok: true,
        table: 1,
        tables: 1,
      })
      const box = tableIn(doc(), 0)
      const lines = JSON.parse(doc().getLineInfoInCell(0, 0, box.control, 1, 0, 0)) as {
        lineCount: number
      }
      expect(lines.lineCount).toBe(lineCount)
      const oneLine = Math.round(size * 100 * 1.9)
      expect(box.cell(1).height).toBe(
        lineCount === 1 ? oneLine : Math.round(size * 100 * (1.9 + 1.6 * (lineCount - 1))),
      )
      expect(plugin.checkLayout(null, null).cells).toEqual([])
    }
  })

  it('gives the number of the table it made and says how many there are', () => {
    const { plugin } = open()
    expect(plugin.insertTable('□ 세부 일정', null, 'after', ROWS, true)).toMatchObject({
      table: 1,
      tables: 1,
    })
    expect(plugin.insertTable('□ 추진 배경', null, 'after', ROWS, true)).toMatchObject({
      table: 1,
      tables: 2,
    })
    expect(
      plugin.insertToc('□ 추진 배경', null, 'before', '차 례', [{ find: '□ 세부 일정', level: 1 }]),
    ).toMatchObject({ ok: true, table: 1, tables: 3 })
    expect(plugin.insertTitleBox(TITLE, null, { look: 'box' })).toMatchObject({
      ok: true,
      table: 1,
      tables: 4,
    })
    expect(plugin.listTables().tables.map((table) => table.rows)).toEqual([1, 1, 3, 3])
  })

  it('names the tables wider than a column once the text runs in columns', () => {
    const { plugin } = open()
    plugin.insertTable('□ 추진 배경', null, 'after', ROWS, { header: true })
    plugin.insertTable('□ 세부 일정', null, 'after', ROWS, { header: true, widthPercent: 40 })
    expect(plugin.setColumns({ count: 2 })).toMatchObject({ ok: true, wide: [1] })
    expect(plugin.setColumns({ count: 1 })).not.toHaveProperty('wide')
  })

  it('names a wide table Hangul anchored to its paragraph, and not one laid across the page', () => {
    const form = new HwpDocument(
      readFileSync(join(__dirname, 'fixtures', 'generated-form-tables-hancom.hwpx')),
    )
    expect(open(form).plugin.setColumns({ count: 2 })).toMatchObject({ ok: true, wide: [1, 2, 3] })
    const { plugin } = open(blank(LINES))
    plugin.setColumns({ count: 2 })
    expect(
      plugin.insertTable(TITLE, null, 'before', ROWS, { header: true, acrossColumns: true }),
    ).toMatchObject({ ok: true, acrossColumns: true })
    expect(plugin.setColumns({ count: 3 })).not.toHaveProperty('wide')
  })

  it('measures one table from a row to a row, and counts cells that break inside a word', () => {
    const { plugin } = withTable()
    plugin.insertTable('□ 추진 배경', null, 'after', ROWS, true)
    const address = 'haneul.kim.planning-office@example.org'
    plugin.fillCells(2, [{ row: 2, col: 3, text: address }], true)
    const one = plugin.checkLayout(2, 2, 2)
    expect(one).toMatchObject({ tables: 2, from: { table: 2, row: 2 } })
    expect(one.wrapped).toEqual([
      { table: 2, row: 2, col: 3, page: 1, text: expect.stringContaining('haneul') },
    ])
    expect(plugin.checkLayout(2, 3, 3).wrapped).toEqual([])
    expect(plugin.checkLayout(1, 1, 3).wrapped).toEqual([])
    plugin.fillCells(2, [{ row: 3, col: 3, text: '국립중앙박물관어린이박물관체험학습실' }], true)
    expect(plugin.checkLayout(2, 3, 3).wrapped).toEqual([])
  })

  it.each([
    ['36.5|℃', true],
    ['1,|234', true],
    ['3.|14', true],
    ['12:|30', true],
    ['50|%', true],
    ['name@|example', true],
    ['example.|org', true],
    ['010-|1234', true],
    ['COVID-|19', true],
    ['examp|le.org', true],
    ['2026|년', true],
    ['체험비|(버스비', false],
    ['(입장료)|체험비', false],
    ['비용|(10,000원', false],
    ['서|명', false],
    ['name |example', false],
    ['name| example', false],
    ['said|“yes”', false],
    ['“yes”|said', false],
    ['‘A’|B', false],
    ['said|"yes"', false],
    ['"yes"|said', false],
    ["it|'s", false],
    ['“|yes', true],
    ['yes|”', true],
    ['"|yes', true],
    ['yes|"', true],
  ])('counts a line break at %s as inside a word: %s', (text, counts) => {
    const at = text.indexOf('|')
    expect(splitsWord(text.slice(0, at), text.slice(at + 1))).toBe(counts)
  })

  it('does not count a line that starts at a bracket or beside Hangul as a broken word', () => {
    const { plugin } = open()
    const made = plugin.insertTable(
      '□ 세부 일정',
      null,
      'after',
      [
        ['참가비(입장료)체험비(버스비)간식비(보험료)기념품비(교통비)'],
        ['도시락, 물, 편한 복장, 우비, 모자, 개인 상비약, 필기도구'],
      ],
      { widthPercent: 25 },
    )
    expect(made).toMatchObject({ ok: true })
    expect(plugin.checkLayout(null, null).wrapped).toEqual([])
  })
})

describe('a test paper in two columns', () => {
  const QUESTIONS = Array.from({ length: 100 }, (_, i) => `문항 ${i + 1} 본문 한 줄`)
  const HEAD = [
    ['시험 이름', '과목', '수학', '결재', '계', '부장', '교감', '교장'],
    ['일시', '학년', '2', '결재', '', '', '', ''],
    ['유의 사항', '쪽수', '2', '문항 수', '20', '만점', '100', ''],
  ]

  /** Where the first body line of each column of page 1 starts, and the foot of the head. */
  function columnStarts(doc: HwpDocument) {
    const info = JSON.parse(doc.getPageInfo(0)) as { columns: { x: number; width: number }[] }
    const runs = (
      JSON.parse(doc.getPageTextLayout(0)) as {
        runs: { x: number; y: number; text: string; cellPath?: unknown }[]
      }
    ).runs.filter((run) => !run.cellPath && run.text.trim() !== '')
    const head = (
      JSON.parse(doc.getPageControlLayout(0)) as {
        controls: { type: string; y: number; h: number }[]
      }
    ).controls.find((control) => control.type === 'table')!
    return {
      foot: head.y + head.h,
      starts: info.columns.map((column) =>
        Math.min(
          ...runs
            .filter((run) => run.x >= column.x - 1 && run.x < column.x + column.width)
            .map((run) => run.y),
        ),
      ),
    }
  }

  it.each([
    ['text, columns, head', ['text', 'columns', 'head']],
    ['columns, text, head', ['columns', 'text', 'head']],
    ['text, head, columns', ['text', 'head', 'columns']],
  ])('keeps every column below the head after its cell text grew (%s)', (_name, order) => {
    const { plugin, doc } = open(blank(['']))
    for (const step of order) {
      if (step === 'text') plugin.insertParagraphs('', null, 'end', QUESTIONS)
      if (step === 'columns') plugin.setColumns({ count: 2 })
      if (step === 'head') {
        expect(
          plugin.insertTable(QUESTIONS[0]!, null, 'before', HEAD, { acrossColumns: true }),
        ).toMatchObject({ ok: true, acrossColumns: true })
      }
    }
    const head = tableIn(doc(), 0)
    const before = columnStarts(doc())
    expect(
      plugin.formatCells(1, [{ row: 1, col: 1 }], { text: { size: 30, bold: true } }),
    ).toMatchObject({
      ok: true,
    })
    const grown = columnStarts(doc())
    expect(grown.foot).toBeGreaterThan(before.foot + 50)
    expect(grown.starts).toHaveLength(2)
    for (const start of grown.starts) expect(start).toBeGreaterThanOrEqual(grown.foot)
    expect(Math.abs(grown.starts[0]! - grown.starts[1]!)).toBeLessThan(1)
    expect(head.cell(8).height).toBe(tableIn(doc(), 0).cell(8).height)
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const again = columnStarts(new HwpDocument(bytes))
      for (const start of again.starts) expect(start).toBeGreaterThanOrEqual(again.foot)
    }
  })

  it('keeps every column below the head after new text grew one of its cells', () => {
    const { plugin, doc } = open(blank(['']))
    plugin.insertParagraphs('', null, 'end', QUESTIONS)
    plugin.setColumns({ count: 2 })
    plugin.insertTable(QUESTIONS[0]!, null, 'before', HEAD, { acrossColumns: true })
    plugin.fillCells(
      1,
      [{ row: 2, col: 5, text: '첫째 줄\n둘째 줄\n셋째 줄\n넷째 줄\n다섯째 줄' }],
      false,
    )
    const { foot, starts } = columnStarts(doc())
    for (const start of starts) expect(start).toBeGreaterThanOrEqual(foot)
  })

  /** The stored height of every cell of the document's first table. */
  function storedHeights(doc: HwpDocument) {
    const table = tableIn(doc, 0)
    return Array.from({ length: table.cells }, (_, index) => table.cell(index).height)
  }

  /** The highest stored height of each row of the document's first table, by its cells' rows. */
  function rowHeights(doc: HwpDocument) {
    const table = tableIn(doc, 0)
    const boxes = JSON.parse(doc.getTableCellBboxes(0, 0, table.control)) as {
      row: number
      rowSpan: number
      cellIdx: number
    }[]
    const rows: number[] = []
    for (const box of boxes) {
      if (box.rowSpan !== 1) continue
      rows[box.row] = Math.max(rows[box.row] ?? 0, table.cell(box.cellIdx).height)
    }
    return rows
  }

  const TALL = '첫째 줄\n둘째 줄\n셋째 줄\n넷째 줄\n다섯째 줄'

  /** A test paper in two columns under a head table whose second row was raised for its text. */
  function raisedHead() {
    const opened = open(blank(['']))
    opened.plugin.insertParagraphs('', null, 'end', QUESTIONS)
    opened.plugin.setColumns({ count: 2 })
    opened.plugin.insertTable(QUESTIONS[0]!, null, 'before', HEAD, { acrossColumns: true })
    opened.plugin.fillCells(1, [{ row: 2, col: 5, text: TALL }], true)
    return opened
  }

  it('keeps a head row raised once its text needs less, and says so', () => {
    const { plugin, doc } = raisedHead()
    const raised = rowHeights(doc())
    expect(raised[1]).toBeGreaterThan(raised[0]! * 3)
    const shrunk = plugin.fillCells(1, [{ row: 2, col: 5, text: '계' }], true)
    expect(rowHeights(doc())).toEqual(raised)
    expect(shrunk).toMatchObject({ ok: true, tallerRows: [{ table: 1, row: 2 }] })
    const [row] = (shrunk as { tallerRows: { heightMm: number; needsMm: number }[] }).tallerRows
    expect(row!.needsMm).toBeLessThan(row!.heightMm / 3)
    const { foot, starts } = columnStarts(doc())
    for (const start of starts) expect(start).toBeGreaterThanOrEqual(foot)
    expect(plugin.fillCells(1, [{ row: 2, col: 5, text: '부' }], true)).not.toHaveProperty(
      'tallerRows',
    )
    expect(plugin.fillCells(1, [{ row: 1, col: 3, text: '영어' }], true)).not.toHaveProperty(
      'tallerRows',
    )
  })

  it('keeps the height row_height_mm set on a row when a row above it is removed', () => {
    const raised = rowHeights(raisedHead().doc())[1]!
    const { plugin, doc } = open(blank(['']))
    plugin.insertParagraphs('', null, 'end', QUESTIONS)
    plugin.setColumns({ count: 2 })
    plugin.insertTable(QUESTIONS[0]!, null, 'before', HEAD, { acrossColumns: true })
    plugin.formatCells(
      1,
      { fromRow: 3, fromCol: 1, toRow: 3, toCol: 8 },
      { heightMm: (raised * 25.4) / 7200 },
    )
    plugin.fillCells(1, [{ row: 2, col: 5, text: TALL }], true)
    expect(rowHeights(doc()).slice(1)).toEqual([raised, raised])
    plugin.removeTableLines(1, 'rows', 1, 1)
    plugin.fillCells(1, [{ row: 1, col: 5, text: '계' }], true)
    expect(rowHeights(doc())).toEqual([raised, raised])
  })

  it('gives a row added next to a raised head row the height of the lowest row of the table', () => {
    const { plugin, doc } = raisedHead()
    const raised = rowHeights(doc())
    expect(plugin.addTableLines(1, 'rows', 2, 'after', 1)).toMatchObject({ ok: true })
    const now = rowHeights(doc())
    expect(now).toHaveLength(4)
    expect([now[0], now[1], now[3]]).toEqual(raised)
    expect(now[2]).toBe(Math.min(...raised))
    const head = tableIn(doc(), 0)
    const drawn = (
      JSON.parse(doc().getTableCellBboxes(0, 0, head.control)) as { row: number; h: number }[]
    ).find((box) => box.row === 2)!
    expect(Math.abs(drawn.h * 75 - now[2]!)).toBeLessThan(75)
    const { foot, starts } = columnStarts(doc())
    for (const start of starts) expect(start).toBeGreaterThanOrEqual(foot)
  })

  it('says when row_height_mm leaves a head row lower than its text', () => {
    const { plugin, doc } = raisedHead()
    expect(
      plugin.formatCells(1, { fromRow: 2, fromCol: 1, toRow: 2, toCol: 8 }, { heightMm: 8 }),
    ).toMatchObject({ ok: true, overflowingRows: [2] })
    expect(rowHeights(doc())[1]).toBe(Math.round((8 * 7200) / 25.4))
    expect(
      plugin.formatCells(1, { fromRow: 3, fromCol: 1, toRow: 3, toCol: 8 }, { heightMm: 15 }),
    ).not.toHaveProperty('overflowingRows')
  })

  /** The engine calls `fn` makes on `doc` that read the layout or write a cell. */
  function layoutCalls(doc: HwpDocument, fn: () => unknown) {
    const names = [
      'getTableCellBboxes',
      'getCursorRectByPathNear',
      'getCursorRectInCell',
      'setCellProperties',
    ]
    const calls: string[] = []
    const target = doc as unknown as Record<string, (...args: unknown[]) => unknown>
    const kept = names.map((name) => target[name]!)
    names.forEach((name, index) => {
      target[name] = (...args: unknown[]) => {
        calls.push(name)
        return kept[index]!.apply(doc, args)
      }
    })
    try {
      fn()
    } finally {
      names.forEach((name, index) => {
        target[name] = kept[index]!
      })
    }
    return calls
  }

  it('neither reads nor writes the head table on a change of the body', () => {
    const { plugin, doc } = raisedHead()
    const heights = storedHeights(doc())
    expect(
      layoutCalls(doc(), () =>
        expect(plugin.replaceText('문항 30 본문', '문항 30 본문 글')).toMatchObject({ ok: true }),
      ),
    ).toEqual([])
    expect(
      layoutCalls(doc(), () =>
        plugin.insertParagraphs(QUESTIONS[50]!, null, 'after', ['새 문항 한 줄']),
      ),
    ).toEqual([])
    expect(storedHeights(doc())).toEqual(heights)
  })

  it('gives a row added next to a plain head row the height of the lowest row of the table', () => {
    const { plugin, doc } = open(blank(['']))
    plugin.insertParagraphs('', null, 'end', QUESTIONS)
    plugin.setColumns({ count: 2 })
    plugin.insertTable(QUESTIONS[0]!, null, 'before', HEAD, { acrossColumns: true })
    const plain = rowHeights(doc())
    expect(plugin.addTableLines(1, 'rows', 2, 'after', 1)).toMatchObject({ ok: true })
    expect(rowHeights(doc())).toEqual([plain[0], plain[1], plain[1], plain[2]])
  })

  it('gives a row added under a merged head cell a height, never none', () => {
    const { plugin, doc } = raisedHead()
    plugin.mergeCells(1, { row: 2, col: 1 }, { row: 3, col: 1 })
    plugin.fillCells(1, [{ row: 2, col: 1, text: TALL }], true)
    const lowest = Math.min(...rowHeights(doc()).filter((height) => height > 0))
    expect(plugin.addTableLines(1, 'rows', 2, 'after', 1)).toMatchObject({ ok: true })
    const head = tableIn(doc(), 0)
    const added = (
      JSON.parse(doc().getTableCellBboxes(0, 0, head.control)) as {
        row: number
        rowSpan: number
        cellIdx: number
      }[]
    ).filter((box) => box.row === 2 && box.rowSpan === 1)
    expect(added.length).toBeGreaterThan(0)
    for (const box of added) expect(head.cell(box.cellIdx).height).toBeGreaterThanOrEqual(lowest)
    const { foot, starts } = columnStarts(doc())
    for (const start of starts) expect(start).toBeGreaterThanOrEqual(foot)
  })

  it('names no row the user set taller than its text when its text shrinks', () => {
    const { plugin } = raisedHead()
    plugin.formatCells(1, { fromRow: 3, fromCol: 1, toRow: 3, toCol: 8 }, { heightMm: 30 })
    plugin.fillCells(1, [{ row: 3, col: 1, text: '서명\n(인)' }], true)
    expect(plugin.fillCells(1, [{ row: 3, col: 1, text: '서명 (인)' }], true)).not.toHaveProperty(
      'tallerRows',
    )
  })

  it('names the row a merged head cell raised once its text needs less', () => {
    const { plugin, doc } = open(blank(['']))
    plugin.insertParagraphs('', null, 'end', QUESTIONS)
    plugin.setColumns({ count: 2 })
    plugin.insertTable(QUESTIONS[0]!, null, 'before', HEAD, { acrossColumns: true })
    plugin.mergeCells(1, { row: 2, col: 1 }, { row: 3, col: 1 })
    plugin.fillCells(1, [{ row: 2, col: 1, text: `${TALL}\n여섯째\n일곱째` }], true)
    const raised = rowHeights(doc())
    expect(raised[2]).toBeGreaterThan(raised[0]! * 3)
    const shrunk = plugin.fillCells(1, [{ row: 2, col: 1, text: '마' }], true) as {
      tallerRows?: { row: number }[]
    }
    expect(shrunk.tallerRows?.map((row) => row.row)).toContain(3)
    expect(rowHeights(doc())).toEqual(raised)
  })

  it('counts the spacing of the paragraphs of a head cell in what its text needs', () => {
    const { plugin, doc } = raisedHead()
    expect(plugin.formatParagraph('첫째 줄', null, { spacingBefore: 6 })).not.toHaveProperty(
      'tallerRows',
    )
    expect(plugin.formatParagraph('다섯째 줄', null, { spacingAfter: 6 })).not.toHaveProperty(
      'tallerRows',
    )
    const spaced = rowHeights(doc())[1]!
    const { foot, starts } = columnStarts(doc())
    for (const start of starts) expect(start).toBeGreaterThanOrEqual(foot)
    expect(
      plugin.formatCells(
        1,
        { fromRow: 2, fromCol: 1, toRow: 2, toCol: 8 },
        { heightMm: (spaced * 25.4) / 7200 },
      ),
    ).not.toHaveProperty('overflowingRows')
    expect(plugin.fillCells(1, [{ row: 2, col: 5, text: '계' }], true)).toMatchObject({
      ok: true,
      tallerRows: [{ table: 1, row: 2 }],
    })
  })

  it('names the only row of a head once its text needs less', () => {
    const { plugin } = open(blank(['']))
    plugin.insertParagraphs('', null, 'end', QUESTIONS)
    plugin.setColumns({ count: 2 })
    plugin.insertTable(QUESTIONS[0]!, null, 'before', [HEAD[0]!], { acrossColumns: true })
    plugin.fillCells(1, [{ row: 1, col: 1, text: TALL }], true)
    expect(plugin.fillCells(1, [{ row: 1, col: 1, text: '가' }], true)).toMatchObject({
      ok: true,
      tallerRows: [{ table: 1, row: 1 }],
    })
  })

  it('says a head row overflows only when its text runs past it once the change is done', () => {
    const tall = raisedHead()
    expect(
      tall.plugin.formatCells(
        1,
        { fromRow: 2, fromCol: 1, toRow: 2, toCol: 8 },
        { heightMm: 5, text: { size: 24 } },
      ),
    ).not.toHaveProperty('overflowingRows')
    for (const start of columnStarts(tall.doc()).starts)
      expect(start).toBeGreaterThanOrEqual(columnStarts(tall.doc()).foot)
    const { plugin } = raisedHead()
    expect(
      plugin.formatCells(1, { fromRow: 1, fromCol: 3, toRow: 1, toCol: 4 }, { heightMm: 14 }),
    ).not.toHaveProperty('overflowingRows')
    plugin.fillCells(
      1,
      [{ row: 2, col: 1, text: '가나다라마바사아자차카타파하 가나다라마바사' }],
      true,
    )
    expect(
      plugin.formatCells(
        1,
        { fromRow: 2, fromCol: 1, toRow: 2, toCol: 8 },
        { heightMm: 5, columnWidths: [5, 20, 20, 20, 20, 20, 20, 20] },
      ),
    ).not.toHaveProperty('overflowingRows')
  })

  type Step = {
    name: string
    run: (plugin: ReturnType<typeof open>['plugin']) => unknown
    /** for each row after the step, the row it was before it (null: new, or set by the step) */
    rows?: (row: number) => number | null
  }
  const short = (row: number): Step => ({
    name: `shorten row ${row}`,
    run: (plugin) => plugin.fillCells(1, [{ row, col: 1, text: '마' }], true),
  })
  const SEQUENCES: [string, Step[]][] = [
    [
      'a row added before the raised one',
      [
        {
          name: 'add before',
          run: (plugin) => plugin.addTableLines(1, 'rows', 2, 'before', 1),
          rows: (row) => (row < 1 ? row : row === 1 ? null : row - 1),
        },
        short(3),
        short(3),
      ],
    ],
    [
      'a row added after the raised one',
      [
        {
          name: 'add after',
          run: (plugin) => plugin.addTableLines(1, 'rows', 2, 'after', 1),
          rows: (row) => (row < 2 ? row : row === 2 ? null : row - 1),
        },
        short(2),
      ],
    ],
    [
      'a row removed above the raised one',
      [
        {
          name: 'remove row 1',
          run: (plugin) => plugin.removeTableLines(1, 'rows', 1, 1),
          rows: (row) => row + 1,
        },
        short(1),
      ],
    ],
    [
      'a cell of the first row split',
      [{ name: 'split', run: (plugin) => plugin.splitCell(1, 1, 1, 1, 2) }, short(2)],
    ],
    [
      'two cells of the first row merged',
      [
        {
          name: 'merge',
          run: (plugin) => plugin.mergeCells(1, { row: 1, col: 1 }, { row: 1, col: 2 }),
        },
        short(2),
      ],
    ],
    [
      'the raised row merged down',
      [
        {
          name: 'merge down',
          run: (plugin) => plugin.mergeCells(1, { row: 2, col: 1 }, { row: 3, col: 1 }),
        },
        short(2),
      ],
    ],
    [
      'row_height_mm on the raised row, then more text, then less',
      [
        {
          name: 'row_height_mm',
          run: (plugin) =>
            plugin.formatCells(1, { fromRow: 2, fromCol: 1, toRow: 2, toCol: 8 }, { heightMm: 12 }),
          rows: (row) => (row === 1 ? null : row),
        },
        {
          name: 'more text',
          run: (plugin) =>
            plugin.fillCells(1, [{ row: 2, col: 1, text: `${TALL}\n여섯째\n일곱째` }], true),
        },
        short(2),
      ],
    ],
    [
      'one column and two again',
      [
        { name: 'one column', run: (plugin) => plugin.setColumns({ count: 1 }) },
        { name: 'two columns', run: (plugin) => plugin.setColumns({ count: 2 }) },
        short(2),
      ],
    ],
  ]

  it.each(SEQUENCES)('lowers no head row: %s', (_name, steps) => {
    const { plugin, doc } = raisedHead()
    for (const step of steps) {
      const before = rowHeights(doc())
      expect(step.run(plugin), step.name).toMatchObject({ ok: true })
      const after = rowHeights(doc())
      after.forEach((height, row) => {
        const was = step.rows ? step.rows(row) : row
        if (was !== null && before[was] !== undefined)
          expect(height, `${step.name}: row ${row + 1}`).toBeGreaterThanOrEqual(before[was]!)
      })
    }
  })

  it('leaves the rows of a table laid across a page of one column as they are stored', () => {
    const { plugin, doc } = open(blank(['']))
    plugin.insertParagraphs('', null, 'end', QUESTIONS.slice(0, 8))
    plugin.insertTable(QUESTIONS[0]!, null, 'before', HEAD.slice(1), { acrossColumns: true })
    const heights = storedHeights(doc())
    const foot = () => {
      const head = tableIn(doc(), 0)
      return (JSON.parse(doc().getTableBBox(0, 0, head.control)) as { height: number }).height
    }
    const short = foot()
    plugin.fillCells(1, [{ row: 1, col: 5, text: '담당\n김교사\n(서명)\n2026. 11. 16.' }], true)
    expect(foot()).toBeGreaterThan(short + 20)
    expect(storedHeights(doc())).toEqual(heights)
    plugin.fillCells(1, [{ row: 1, col: 5, text: '담당' }], true)
    expect(Math.abs(foot() - short)).toBeLessThan(1)
  })

  it('keeps every column below a head whose text grew while it lay in one column', () => {
    const { plugin, doc } = open(blank(['']))
    plugin.insertParagraphs('', null, 'end', QUESTIONS)
    plugin.insertTable(QUESTIONS[0]!, null, 'before', HEAD, { acrossColumns: true })
    plugin.fillCells(
      1,
      [{ row: 2, col: 5, text: '첫째 줄\n둘째 줄\n셋째 줄\n넷째 줄\n다섯째 줄' }],
      true,
    )
    plugin.setColumns({ count: 2 })
    const { foot, starts } = columnStarts(doc())
    for (const start of starts) expect(start).toBeGreaterThanOrEqual(foot)
  })

  it('lays a head made in one column across the columns set after it', () => {
    const { plugin, doc } = open(blank(['']))
    plugin.insertParagraphs('', null, 'end', QUESTIONS)
    expect(
      plugin.insertTable(QUESTIONS[0]!, null, 'before', HEAD, { acrossColumns: true }),
    ).toMatchObject({ ok: true, acrossColumns: true })
    const head = tableIn(doc(), 0)
    const props = JSON.parse(doc().getTableProperties(0, 0, head.control)) as {
      treatAsChar: boolean
      horzRelTo: string
      tableWidth: number
    }
    expect(props).toMatchObject({ treatAsChar: false, horzRelTo: 'Page' })
    plugin.setColumns({ count: 2 })
    const page = JSON.parse(doc().getPageDef(0)) as {
      width: number
      marginLeft: number
      marginRight: number
    }
    expect(
      Math.abs(props.tableWidth - (page.width - page.marginLeft - page.marginRight)),
    ).toBeLessThan(7200 / 25.4)
    const { foot, starts } = columnStarts(doc())
    for (const start of starts) expect(start).toBeGreaterThanOrEqual(foot)
  })

  it('makes a one-cell box added after the columns one column wide, and names one made before', () => {
    const { plugin, doc } = open(blank(['']))
    plugin.insertParagraphs('', null, 'end', QUESTIONS.slice(0, 30))
    plugin.setColumns({ count: 2 })
    expect(
      plugin.insertTable(QUESTIONS[10]!, null, 'after', [['〈보기〉 ㄱ. ㄴ. ㄷ.']], false),
    ).toMatchObject({ ok: true })
    const column = JSON.parse(doc().getPageInfo(0)).columns[0].width as number
    const box = tableIn(doc(), 11)
    const width = JSON.parse(doc().getTableBBox(0, 11, box.control)).width as number
    expect(width).toBeLessThanOrEqual(column + 1)

    const before = open(blank(['']))
    before.plugin.insertParagraphs('', null, 'end', QUESTIONS.slice(0, 30))
    before.plugin.insertTable(QUESTIONS[10]!, null, 'after', [['〈보기〉 ㄱ. ㄴ. ㄷ.']], false)
    expect(before.plugin.setColumns({ count: 2 })).toMatchObject({ ok: true, wide: [1] })
  })

  it('draws a line between the columns, reads it back, keeps it through both formats and takes it away', () => {
    const { plugin, doc, steps } = open(blank(['']))
    plugin.insertParagraphs('', null, 'end', QUESTIONS)
    const before = steps()
    expect(plugin.setColumns({ count: 2, line: 'solid' })).toMatchObject({
      ok: true,
      count: 2,
      line: 'solid',
    })
    expect(steps()).toBe(before + 1)
    expect(plugin.pageLayout().columns).toEqual({ count: 2, gapMm: 8, line: 'solid' })
    expect(doc().renderPageSvgWithProfile(0, 'print')).toMatch(/<line /)
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const again = JSON.parse(new HwpDocument(bytes).getColumnDef(0)) as { separatorType: number }
      expect(again.separatorType).toBe(1)
    }
    // set again without the line: it stays, and the answer says so
    expect(plugin.setColumns({ count: 2, gapMm: 10 })).toMatchObject({
      line: 'solid',
      lineKept: true,
    })
    expect(plugin.pageLayout().columns).toEqual({ count: 2, gapMm: 10, line: 'solid' })
    expect(() => plugin.setColumns({ count: 1, line: 'solid' })).toThrow(/count 1 leaves none/)
    expect(plugin.pageLayout().columns).toEqual({ count: 2, gapMm: 10, line: 'solid' })
    expect(plugin.setColumns({ count: 1 })).toMatchObject({
      count: 1,
      line: 'solid',
      lineKept: true,
    })
    expect(plugin.setColumns({ count: 2 })).toMatchObject({ line: 'solid', lineKept: true })
    plugin.setColumns({ count: 2, line: 'none' })
    expect(plugin.pageLayout().columns).toEqual({ count: 2, gapMm: 8 })
    expect(() => plugin.setColumns({ count: 2, line: 'double' as never })).toThrow(/line must be/)
  })

  it('reads back every line a document may have between its columns', () => {
    const { plugin, doc } = open(blank(QUESTIONS.slice(0, 20)))
    plugin.setColumns({ count: 2 })
    const names = ['solid', 'dashed', 'dotted', 'dash-dot', 'dash-dot-dot', 'long-dash', 'circles']
    names.forEach((name, index) => {
      doc().setColumnSeparator(0, JSON.stringify({ type: index + 1 }))
      expect(plugin.pageLayout().columns).toEqual({ count: 2, gapMm: 8, line: name })
    })
  })

  it('says when a later part of the document runs in other columns, and not for a new section', async () => {
    // a head in one column over a body in two, as a test-paper form sets it in Hangul
    const zip = await JSZip.loadAsync(blank(QUESTIONS.slice(0, 6)).exportHwpx())
    const name = Object.keys(zip.files).find((file) => /section0.xml$/.test(file))!
    const xml = await zip.file(name)!.async('string')
    const at = xml.indexOf('<hp:t>문항 3 ')
    const run = xml.lastIndexOf('<hp:run ', at)
    const opened = xml.indexOf('>', run) + 1
    const zone =
      '<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="2" sameSz="1" sameGap="2268"/></hp:ctrl>'
    zip.file(name, xml.slice(0, opened) + zone + xml.slice(opened))
    const form = new HwpDocument(await zip.generateAsync({ type: 'uint8array' }))
    const { plugin, doc } = open(form)
    expect(plugin.pageLayout().columns).toEqual({
      count: 1,
      gapMm: 0,
      changesWithin: true,
    })
    const box = [['〈보기〉 ㄱ. ㄴ. ㄷ.']]
    expect(plugin.insertTable(QUESTIONS[4]!, null, 'after', box, false)).toMatchObject({
      ok: true,
    })
    const inColumn = drawnTable(doc(), 5)
    expect(inColumn.w).toBeLessThan(inColumn.columns[0]!.width * 0.55)
    expect(plugin.insertTable(QUESTIONS[0]!, null, 'after', box, false)).toMatchObject({
      ok: true,
    })
    expect(drawnTable(doc(), 1).w).toBeGreaterThan(inColumn.columns[0]!.width * 0.9)
    const sections = new HwpDocument(
      readFileSync(join(__dirname, 'fixtures', 'master-page-next-section.hwpx')),
    )
    expect(sections.getSectionCount()).toBe(2)
    expect(open(sections).plugin.pageLayout().columns).toEqual({ count: 1, gapMm: 0 })
  })

  const LONG = Array.from({ length: 200 }, (_, i) => `문항 ${i + 1} 본문 한 줄`)

  /** A blank document of `lines` whose columns change at the line starting `at` to `cols`. */
  async function zoned(lines: string[], zones: { at: string; cols: number }[]) {
    const zip = await JSZip.loadAsync(blank(lines).exportHwpx())
    const name = Object.keys(zip.files).find((file) => /section0.xml$/.test(file))!
    let xml = await zip.file(name)!.async('string')
    for (const { at, cols } of zones) {
      const run = xml.lastIndexOf('<hp:run ', xml.indexOf(`<hp:t>${at}`))
      const opened = xml.indexOf('>', run) + 1
      const zone = `<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="${cols}" sameSz="1" sameGap="2268"/></hp:ctrl>`
      xml = xml.slice(0, opened) + zone + xml.slice(opened)
    }
    zip.file(name, xml)
    return new HwpDocument(await zip.generateAsync({ type: 'uint8array' }))
  }

  /** The drawn width and left of the table a body paragraph holds, in pixels. */
  function drawnTable(doc: HwpDocument, para: number) {
    for (let page = 0; page < doc.pageCount(); page++) {
      const found = (
        JSON.parse(doc.getPageControlLayout(page)).controls as {
          type: string
          paraIdx: number
          x: number
          w: number
        }[]
      ).find((control) => control.type === 'table' && control.paraIdx === para)
      if (found) {
        const columns = (
          JSON.parse(doc.getPageInfo(page)) as { columns: { x: number; width: number }[] }
        ).columns
        return { ...found, page, columns }
      }
    }
    throw new Error(`no table in paragraph ${para}`)
  }

  it('makes a table and a title box one column wide in columns set part way, read from a page that starts in them', async () => {
    const { plugin, doc } = open(await zoned(LONG, [{ at: '문항 3 ', cols: 2 }]))
    expect(doc().pageCount()).toBeGreaterThan(1)
    expect(plugin.pageLayout().columns).toMatchObject({ changesWithin: true })
    expect(
      plugin.insertTable(QUESTIONS[4]!, null, 'after', [['〈보기〉 ㄱ. ㄴ. ㄷ.']], false),
    ).toMatchObject({
      ok: true,
    })
    const table = drawnTable(doc(), 5)
    expect(table.page).toBe(0)
    const column = JSON.parse(doc().getPageInfo(1)).columns[0] as { x: number; width: number }
    expect(Math.abs(table.w - column.width)).toBeLessThan(2)
    expect(plugin.insertTitleBox(QUESTIONS[10]!, null, { look: 'box' })).toMatchObject({ ok: true })
    const box = drawnTable(doc(), 11)
    expect(box.w).toBeGreaterThan(column.width - 10)
    expect(box.x + box.w).toBeLessThanOrEqual(column.x + column.width + 1)
  })

  it('makes a table as wide as the text where columns set part way go back to one', async () => {
    const { plugin, doc } = open(
      await zoned(LONG, [
        { at: '문항 3 ', cols: 2 },
        { at: '문항 100 ', cols: 1 },
      ]),
    )
    expect(plugin.insertTable(LONG[194]!, null, 'after', [['가', '나']], false)).toMatchObject({
      ok: true,
    })
    const table = drawnTable(doc(), 195)
    expect(table.w).toBeGreaterThan(table.columns[0]!.width * 0.9)
    expect(table.columns).toHaveLength(1)
  })

  it('reads the columns of a part no page starts in from where its lines are laid out', async () => {
    const { plugin, doc } = open(await zoned(QUESTIONS.slice(0, 6), [{ at: '문항 3 ', cols: 2 }]))
    const text = (JSON.parse(doc().getPageInfo(0)) as { columns: { width: number }[] }).columns[0]!
    expect(plugin.insertTitleBox(QUESTIONS[4]!, null, { look: 'box' })).toMatchObject({ ok: true })
    const box = drawnTable(doc(), 4)
    expect(box.w).toBeLessThan(text.width * 0.55)
    plugin.formatParagraph(QUESTIONS[1]!, null, { list: 'number' })
    expect(plugin.insertTitleBox(QUESTIONS[1]!, null, { look: 'box' })).toEqual({
      ok: false,
      reason: 'numbered',
      count: 1,
    })
    expect(() => tableIn(doc(), 1)).toThrow()
  })

  it('keeps a title box on an indented paragraph inside its column', async () => {
    const { plugin, doc } = open(await zoned(QUESTIONS.slice(0, 6), [{ at: '문항 3 ', cols: 2 }]))
    plugin.formatParagraph(QUESTIONS[4]!, null, { marginLeft: 40 })
    const text = (JSON.parse(doc().getPageInfo(0)) as { columns: { x: number; width: number }[] })
      .columns[0]!
    const column = (text.width - (8 * 96) / 25.4) / 2
    expect(plugin.insertTitleBox(QUESTIONS[4]!, null, { look: 'box' })).toMatchObject({ ok: true })
    const box = drawnTable(doc(), 4)
    expect(box.x).toBeGreaterThan(text.x + 40)
    expect(box.x + box.w).toBeLessThanOrEqual(text.x + column + 2)
  })

  it.each([
    ['a left margin', { marginLeft: 40 }],
    ['a first-line indent', { indent: 15 }],
  ])(
    'keeps a title box on a line with %s inside its column in columns the section starts with',
    (_name, look) => {
      const { plugin, doc } = open(blank(['']))
      plugin.insertParagraphs('', null, 'end', QUESTIONS.slice(0, 30))
      plugin.setColumns({ count: 2 })
      plugin.formatParagraph(QUESTIONS[4]!, null, look)
      expect(plugin.insertTitleBox(QUESTIONS[4]!, null, { look: 'box' })).toMatchObject({
        ok: true,
      })
      const box = drawnTable(doc(), 4)
      const column = box.columns.find((one) => box.x >= one.x - 2 && box.x <= one.x + one.width)!
      expect(box.x + box.w).toBeLessThanOrEqual(column.x + column.width + 1)
    },
  )

  it('takes a table as wide as the text in a part set back to one column no page starts in', async () => {
    const { plugin, doc } = open(
      await zoned(QUESTIONS.slice(0, 12), [
        { at: '문항 3 ', cols: 2 },
        { at: '문항 8 ', cols: 1 },
      ]),
    )
    expect(plugin.insertTable(QUESTIONS[9]!, null, 'after', [['가', '나']], false)).toMatchObject({
      ok: true,
    })
    const table = drawnTable(doc(), 10)
    expect(table.w).toBeGreaterThan(table.columns[0]!.width * 0.9)
  })

  it('gives the test-paper page the column width the skill names', () => {
    const { plugin, doc } = open(blank(['']))
    const { page, columns } = EXAM_PAPER
    plugin.setPageSetup(
      {
        paper: page.paper,
        margins: {
          left: page.marginLeft,
          right: page.marginRight,
          top: page.marginTop,
          bottom: page.marginBottom,
          header: page.marginHeader,
          footer: page.marginFooter,
        },
      } as never,
      null,
    )
    plugin.insertParagraphs('', null, 'end', QUESTIONS)
    plugin.setColumns({ count: columns.count, gapMm: columns.gapMm, line: 'solid' })
    const drawn = JSON.parse(doc().getPageInfo(0)).columns as { width: number }[]
    expect(drawn).toHaveLength(2)
    for (const column of drawn) {
      expect(Math.abs((column.width * 25.4) / 96 - examColumnWidthMm())).toBeLessThan(0.2)
    }
  })
})
