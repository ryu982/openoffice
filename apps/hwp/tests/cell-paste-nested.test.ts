// @vitest-environment jsdom
/**
 * 셀 붙이기 → 셀 안에 표로 넣기 (hancom-keys.mjs pasteCellsAsTable): copied cells go into the
 * caret's cell as a table of their own. The expectations are Hancom Hangul 2024's, measured
 * through its automation (2026-11-17, F:/ieum-scratch/nested-table-edit/T5): a 2×2 block copied
 * from a table whose first column is wider, with a bold cell, a cell of two paragraphs, a red
 * filled cell and blue text, pasted with the caret in the middle cell of another 3×3 table.
 *
 * - The new table goes in at the caret, inside the caret's paragraph: text before and after
 *   the caret stays around it in that paragraph, and no paragraph is added.
 * - It is treat-as-char, with a 141 HWPUNIT (0.5 mm) outer margin on every side.
 * - Its columns keep the copied widths (not fitted to the cell), its cells keep their text with
 *   its paragraphs and character shapes, and their lines and fills.
 * - The host table keeps its grid and its other cells; one undo step takes it all back.
 *
 * The writes run on the real engine; the editor's cursor and history are stand-ins.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import {
  cellBlockCopy,
  cellTableFromHtml,
  pasteCellsAsTable,
  pasteCellsAt,
  cellGridFromHtml,
} from '../studio-plugin/hancom-keys.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

const J = JSON.stringify
const parse = (value: string) => JSON.parse(value)

/** The studio's WasmBridge for the calls used here: it parses these answers. */
function bridgeOf(doc: HwpDocument) {
  return {
    getTableDimensions: (s: number, p: number, c: number) => parse(doc.getTableDimensions(s, p, c)),
    getCellInfo: (s: number, p: number, c: number, i: number) => parse(doc.getCellInfo(s, p, c, i)),
    getCellParagraphCount: (...a: [number, number, number, number]) =>
      doc.getCellParagraphCount(...a),
    getCellParagraphLength: (...a: [number, number, number, number, number]) =>
      doc.getCellParagraphLength(...a),
    getTextInCell: (...a: [number, number, number, number, number, number, number]) =>
      doc.getTextInCell(...a),
    getCellProperties: (s: number, p: number, c: number, i: number) =>
      parse(doc.getCellProperties(s, p, c, i)),
    exportControlHtml: (s: number, p: number, c: number, path = '') =>
      doc.exportControlHtml(s, p, path, c),
    deleteRangeInCell: (...a: [number, number, number, number, number, number, number, number]) =>
      parse(doc.deleteRangeInCell(...a)),
    splitParagraphInCell: (s: number, p: number, c: number, i: number, cp: number, o: number) =>
      doc.splitParagraphInCell(s, p, c, i, cp, o),
    insertTextInCell: (...a: [number, number, number, number, number, number, string]) =>
      doc.insertTextInCell(...a),
    insertTableRow: (s: number, p: number, c: number, row: number, below: boolean) =>
      parse(doc.insertTableRow(s, p, c, row, below)),
    insertTableColumn: (s: number, p: number, c: number, col: number, right: boolean) =>
      parse(doc.insertTableColumn(s, p, c, col, right)),
    mergeTableCells: (...a: [number, number, number, number, number, number, number]) =>
      parse(doc.mergeTableCells(...a)),
    createTableInCellByPath: (
      s: number,
      p: number,
      path: unknown[],
      offset: number,
      options: Record<string, unknown>,
    ) => parse(doc.createTableInCellByPath(s, p, J(path), offset, J(options))),
    getTableDimensionsByPath: (s: number, p: number, path: string) =>
      parse(doc.getTableDimensionsByPath(s, p, path)),
    getCellInfoByPath: (s: number, p: number, path: string) =>
      parse(doc.getCellInfoByPath(s, p, path)),
    mergeTableCellsByPath: (...a: [number, number, string, number, number, number, number]) =>
      parse(doc.mergeTableCellsByPath(...a)),
    setCellPropertiesByPath: (s: number, p: number, path: string, i: number, props: object) =>
      parse(doc.setCellPropertiesByPath(s, p, path, i, J(props))),
    setTablePropertiesByPath: (s: number, p: number, path: string, props: object) =>
      parse(doc.setTablePropertiesByPath(s, p, path, J(props))),
    pasteHtmlInCellByPath: (s: number, p: number, path: string, offset: number, html: string) =>
      doc.pasteHtmlInCellByPath(s, p, path, offset, html),
    mergeParagraphInCellByPath: (s: number, p: number, path: string) =>
      doc.mergeParagraphInCellByPath(s, p, path),
  }
}

/** A blank document whose second paragraph holds a table made from `html`. */
function tableDoc(html: string): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.splitParagraph(0, 0, 0)
  doc.pasteHtml(0, 1, 0, html)
  return doc
}

/**
 * The source of the copy, as in the Hancom measurement: column 0 wider (7820 / 4424 HWPUNIT),
 * (0,0) bold, (0,1) two paragraphs, (1,0) filled red, (1,1) blue text.
 */
function sourceDoc(): HwpDocument {
  const doc = tableDoc(
    '<table>' +
      '<tr><td style="width:78.2pt">a00</td><td style="width:44.24pt">a01</td></tr>' +
      '<tr><td style="width:78.2pt">a10</td><td style="width:44.24pt">a11</td></tr>' +
      '</table>',
  )
  doc.applyCharFormatInCell(0, 1, 0, 0, 0, 0, 3, J({ bold: true }))
  doc.splitParagraphInCell(0, 1, 0, 1, 0, 3)
  doc.insertTextInCell(0, 1, 0, 1, 1, 0, 'line2')
  doc.setCellProperties(0, 1, 0, 2, J({ fillType: 'solid', fillColor: '#ff0000' }))
  doc.applyCharFormatInCell(0, 1, 0, 3, 0, 0, 3, J({ textColor: '#0000ff' }))
  for (let i = 0; i < 4; i += 1) doc.setCellProperties(0, 1, 0, i, J(SOURCE_LINES))
  // a line HTML cannot say exactly: dashed, 0.4 mm, blue
  doc.setCellProperties(0, 1, 0, 3, J({ borderBottom: DASHED }))
  return doc
}

const LINE = { type: 1, width: 1, color: '#000000' }
const DASHED = { type: 2, width: 6, color: '#0000ff' }
const SOURCE_LINES = { borderLeft: LINE, borderRight: LINE, borderTop: LINE, borderBottom: LINE }

/** The copied cells' clipboard HTML, from this editor's own cell copy. */
function copiedHtml(): string {
  const doc = sourceDoc()
  const bridge = bridgeOf(doc)
  const range = { startRow: 0, startCol: 0, endRow: 1, endCol: 1 }
  const copied = cellBlockCopy({
    cursor: {
      getCellTableContext: () => ({ sec: 0, ppi: 1, ci: 0 }),
      getSelectedCellRange: () => range,
    },
    wasm: bridge,
  })
  if (!copied) throw new Error('nothing copied')
  return copied.html
}

const EMPTY_3X3 = '<table>' + '<tr><td></td><td></td><td></td></tr>'.repeat(3) + '</table>'

/** The host: a 3×3 table, every cell but the middle one holding its place ("h00"…). */
function hostDoc(middle: string[] = ['']): HwpDocument {
  const doc = tableDoc(EMPTY_3X3)
  for (let i = 0; i < 9; i += 1) {
    if (i === 4) continue
    doc.insertTextInCell(0, 1, 0, i, 0, 0, `h${Math.floor(i / 3)}${i % 3}`)
  }
  middle.forEach((line, p) => {
    if (p > 0) doc.splitParagraphInCell(0, 1, 0, 4, p - 1, middle[p - 1]!.length)
    if (line) doc.insertTextInCell(0, 1, 0, 4, p, 0, line)
  })
  return doc
}

function caretAt(cellParaIndex: number, charOffset: number) {
  return {
    sectionIndex: 0,
    paragraphIndex: 1,
    parentParaIndex: 1,
    controlIndex: 0,
    cellIndex: 4,
    cellParaIndex,
    charOffset,
    cellPath: [{ controlIndex: 0, cellIndex: 4, cellParaIndex }],
  }
}

function handler(doc: HwpDocument) {
  const bridge = bridgeOf(doc)
  const executeOperation = vi.fn((desc: { operation: (b: unknown) => unknown }) =>
    desc.operation(bridge),
  )
  return { wasm: bridge, executeOperation, updateCaret: vi.fn(), cursor: {} }
}

function paste(doc: HwpDocument, html: string, caret = caretAt(0, 0)) {
  const ih = handler(doc)
  const table = cellTableFromHtml(html)
  if (!table) throw new Error('not a table')
  const cell = parse(doc.getCellInfo(0, 1, 0, 4))
  expect(pasteCellsAsTable(ih, { sec: 0, ppi: 1, ci: 0 }, cell, table, caret)).toBe(true)
  return ih
}

/** The path the engine's table calls take to the table in the host cell's paragraph. */
const inner = (para = 0, cell = 0) =>
  J([
    { controlIndex: 0, cellIndex: 4, cellParaIndex: para },
    { controlIndex: 0, cellIndex: cell, cellParaIndex: 0 },
  ])

function cellText(doc: HwpDocument, path: string): string {
  const steps = parse(path) as { controlIndex: number; cellIndex: number; cellParaIndex: number }[]
  const count = doc.getCellParagraphCountByPath(0, 1, path)
  const lines = []
  for (let p = 0; p < count; p += 1) {
    const at = J([...steps.slice(0, -1), { ...steps[steps.length - 1]!, cellParaIndex: p }])
    lines.push(doc.getTextInCellByPath(0, 1, at, 0, 200))
  }
  return lines.join('\n')
}

function hostTexts(doc: HwpDocument): string[] {
  return Array.from({ length: 9 }, (_, i) =>
    cellText(doc, J([{ controlIndex: 0, cellIndex: i, cellParaIndex: 0 }])),
  )
}

/** The host cell's paragraphs from the saved HWPX: its text and where the table stands. */
async function hostParagraphs(doc: HwpDocument): Promise<string[]> {
  const zip = await JSZip.loadAsync(doc.exportHwpx())
  const xml = await zip.file('Contents/section0.xml')!.async('string')
  const outer = xml.indexOf('<hp:tbl')
  const tcs = [...xml.slice(outer).matchAll(/<hp:tc\b/g)].map((m) => m.index! + outer)
  // the host's fifth cell: its sub-list holds the inner table, so cut at the next host cell
  const start = tcs[4]!
  const rest = xml.slice(start)
  const tableEnd = rest.indexOf('</hp:tbl>')
  const innerOpen = rest.indexOf('<hp:tbl')
  const end =
    innerOpen >= 0 && innerOpen < tableEnd
      ? rest.indexOf('</hp:tc>', rest.indexOf('</hp:tbl>') + 9)
      : rest.indexOf('</hp:tc>')
  const cellXml = rest.slice(0, end)
  const flat = cellXml.replace(/<hp:tbl\b[\s\S]*<\/hp:tbl>/, '<hp:t>[TABLE]</hp:t>')
  return [...flat.matchAll(/<hp:p\b[\s\S]*?<\/hp:p>/g)].map((m) =>
    [...m[0].matchAll(/<hp:t>([^<]*)<\/hp:t>/g)].map((t) => t[1]).join(''),
  )
}

describe('reading copied cells as a table', () => {
  it('keeps their spans, widths, contents and looks', () => {
    const table = cellTableFromHtml(copiedHtml())
    expect(table).toMatchObject({ rows: 2, cols: 2, colWidths: [7820, 4424] })
    expect(table!.cells.map((c: { row: number; col: number }) => [c.row, c.col])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ])
    // this editor's copy carries each cell's own lines and fill exactly
    expect(table!.cells[2].look).toMatchObject({ fillType: 'solid', fillColor: '#ff0000' })
    expect(table!.cells[0].look.borderLeft).toEqual(LINE)
    expect(table!.cells[3].look.borderBottom).toEqual(DASHED)
  })

  it('reads lines and fills from Hangul and spreadsheet styles', () => {
    const table = cellTableFromHtml(
      '<table><tr>' +
        '<td style="width:78.20pt;height:2.82pt;border-top:solid #000000 0.28pt;border-left:solid #000000 0.28pt;border-bottom:solid #000000 0.28pt;border-right:solid #000000 0.28pt;background:#ff0000;" valign="middle"><p>x</p></td>' +
        '<td colspan="2" style="border:1.0px dashed rgb(0, 0, 255)">y</td>' +
        '</tr><tr><td>1</td><td>2</td><td style="border:none">3</td></tr></table>',
    )
    expect(table).toMatchObject({ rows: 2, cols: 3 })
    expect(table!.colWidths).toEqual([7820, 0, 0])
    expect(table!.rowHeights).toEqual([282, 0])
    expect(table!.cells[0].look).toMatchObject({
      fillType: 'solid',
      fillColor: '#ff0000',
      verticalAlign: 1,
      borderTop: { type: 1, width: 0, color: '#000000' },
    })
    expect(table!.cells[1]).toMatchObject({ row: 0, col: 1, colSpan: 2 })
    expect(table!.cells[1].look.borderLeft).toEqual({ type: 2, width: 4, color: '#0000ff' })
    expect(table!.cells[4].look.borderTop).toEqual({ type: 0, width: 0, color: '#000000' })
  })

  it('reads only what the 셀 붙이기 dialog takes: a lone table', () => {
    expect(cellTableFromHtml('<p>before</p><table><tr><td>1</td></tr></table>')).toBeNull()
    expect(cellTableFromHtml('<p>no table</p>')).toBeNull()
  })
})

describe('a cell look attribute from elsewhere', () => {
  it('passes on only the keys this editor writes', () => {
    const look = JSON.stringify({
      verticalAlign: 'Bottom',
      fillType: 'gradation',
      fieldName: 'name',
      width: 99999,
    }).replace(/"/g, '&quot;')
    const html =
      `<table><tr><td data-ieum-cell="${look}">a</td><td>b</td></tr>` +
      '<tr><td>c</td><td>d</td></tr></table>'
    const table = cellTableFromHtml(html)
    expect(table!.cells[0].look.verticalAlign).toBe('Bottom')
    expect(table!.cells[0].look).not.toHaveProperty('fieldName')
    expect(table!.cells[0].look).not.toHaveProperty('width')
    expect(table!.cells[0].look.fillType).not.toBe('gradation')
  })
})

describe('the engine refusal the plugins recognise', () => {
  it('names drawn borders in words both plugins look for', () => {
    const patch = readFileSync(
      join(dirname(require.resolve('@rhwp/core')), 'patches', '0055-nested-table-path-calls.patch'),
      'utf8',
    )
    const message = /const DRAWN_BORDERS: &str = "([^"]+)"/.exec(patch)?.[1] ?? ''
    expect(message).toContain('칸 테두리를 개체로 그린') // agent-plugin's DRAWN_BORDERS_REFUSAL
    expect(/경로\[|개체로 그린|캡션/.test(message)).toBe(true) // hancom-keys' INNER_TABLE_REFUSAL
  })
})

describe('셀 안에 표로 넣기', () => {
  it('puts the copied cells into the empty caret cell as a table, as Hangul does', async () => {
    const doc = hostDoc()
    const before = hostTexts(doc)
    const ih = paste(doc, copiedHtml())
    expect(ih.executeOperation).toHaveBeenCalledTimes(1)
    // the host keeps its grid and its other cells
    expect(parse(doc.getTableDimensions(0, 1, 0))).toMatchObject({ rowCount: 3, colCount: 3 })
    expect(hostTexts(doc).filter((_, i) => i !== 4)).toEqual(before.filter((_, i) => i !== 4))
    // one paragraph in the host cell, holding the table and nothing else
    expect(await hostParagraphs(doc)).toEqual(['[TABLE]'])
    expect(parse(doc.getTableDimensionsByPath(0, 1, inner()))).toMatchObject({
      rowCount: 2,
      colCount: 2,
      cellCount: 4,
    })
    const props = parse(doc.getTablePropertiesByPath(0, 1, inner()))
    expect(props).toMatchObject({
      treatAsChar: true,
      outerLeft: 141,
      outerRight: 141,
      outerTop: 141,
      outerBottom: 141,
      tableWidth: 12244,
    })
    const cells = [0, 1, 2, 3].map((i) => parse(doc.getCellPropertiesByPath(0, 1, inner(), i)))
    expect(cells.map((c) => c.width)).toEqual([7820, 4424, 7820, 4424])
    expect([0, 1, 2, 3].map((i) => cellText(doc, inner(0, i)))).toEqual([
      'a00',
      'a01\nline2',
      'a10',
      'a11',
    ])
    expect(cells[2]).toMatchObject({ fillType: 'solid', fillColor: '#ff0000' })
    expect(cells[0]).toMatchObject({ fillType: 'none' })
    for (const cell of cells) {
      for (const side of ['borderLeft', 'borderRight', 'borderTop'])
        expect(cell[side]).toEqual(LINE)
    }
    expect(cells.map((c) => c.borderBottom)).toEqual([LINE, LINE, LINE, DASHED])
    expect(parse(doc.getCellCharPropertiesAtByPath(0, 1, inner(0, 0), 1)).bold).toBe(true)
    expect(parse(doc.getCellCharPropertiesAtByPath(0, 1, inner(0, 1), 1)).bold).toBe(false)
    expect(parse(doc.getCellCharPropertiesAtByPath(0, 1, inner(0, 3), 1)).textColor).toBe('#0000ff')
  })

  it('puts the table at the caret between the text of its paragraph', async () => {
    const doc = hostDoc(['XY'])
    paste(doc, copiedHtml(), caretAt(0, 1))
    expect(await hostParagraphs(doc)).toEqual(['X[TABLE]Y'])
    const end = hostDoc(['XY'])
    paste(end, copiedHtml(), caretAt(0, 2))
    expect(await hostParagraphs(end)).toEqual(['XY[TABLE]'])
    const start = hostDoc(['XY'])
    paste(start, copiedHtml(), caretAt(0, 0))
    expect(await hostParagraphs(start)).toEqual(['[TABLE]XY'])
  })

  it('puts the table in the caret paragraph of a cell of several', async () => {
    const doc = hostDoc(['P1', 'P2'])
    paste(doc, copiedHtml(), caretAt(1, 0))
    expect(await hostParagraphs(doc)).toEqual(['P1', '[TABLE]P2'])
    expect(parse(doc.getTableDimensionsByPath(0, 1, inner(1)))).toMatchObject({ cellCount: 4 })
  })

  it('makes merged copied cells merged again', () => {
    const doc = hostDoc()
    paste(
      doc,
      '<table><tr><td colspan="2" style="width:100pt">wide</td></tr>' +
        '<tr><td style="width:40pt">a</td><td style="width:60pt">b</td></tr></table>',
    )
    const dims = parse(doc.getTableDimensionsByPath(0, 1, inner()))
    expect(dims).toMatchObject({ rowCount: 2, colCount: 2, cellCount: 3 })
    const info = parse(doc.getCellInfoByPath(0, 1, inner(0, 0)))
    expect(info).toMatchObject({ row: 0, col: 0, colSpan: 2 })
    expect([0, 1, 2].map((i) => cellText(doc, inner(0, i)))).toEqual(['wide', 'a', 'b'])
    expect([1, 2].map((i) => parse(doc.getCellPropertiesByPath(0, 1, inner(), i)).width)).toEqual([
      4000, 6000,
    ])
  })

  it('saves as .hwp and .hwpx and opens again with the table in the cell', () => {
    const doc = hostDoc(['XY'])
    paste(doc, copiedHtml(), caretAt(0, 1))
    for (const bytes of [doc.exportHwp(), doc.exportHwpx()]) {
      const again = new HwpDocument(bytes)
      expect(parse(again.getTableDimensions(0, 1, 0))).toMatchObject({ rowCount: 3, colCount: 3 })
      expect(parse(again.getTableDimensionsByPath(0, 1, inner()))).toMatchObject({
        rowCount: 2,
        colCount: 2,
      })
      expect(cellText(again, inner(0, 1))).toBe('a01\nline2')
      expect(
        again.getTextInCellByPath(
          0,
          1,
          J([{ controlIndex: 0, cellIndex: 4, cellParaIndex: 0 }]),
          0,
          10,
        ),
      ).toBe('XY')
    }
  })

  it('leaves the other choices as they were', () => {
    const doc = tableDoc(EMPTY_3X3)
    const ih = handler(doc)
    const grid = cellGridFromHtml(copiedHtml())!
    pasteCellsAt(
      ih,
      { sec: 0, ppi: 1, ci: 0 },
      parse(doc.getCellInfo(0, 1, 0, 4)),
      grid,
      'overwrite',
      caretAt(0, 0),
    )
    expect(cellText(doc, J([{ controlIndex: 0, cellIndex: 4, cellParaIndex: 0 }]))).toBe('a00')
    expect(() => doc.getTableDimensionsByPath(0, 1, inner())).toThrow()
  })
})
