/**
 * The AI's table tools on a table inside a cell of another table, against the real rhwp engine.
 * The engine's cell-path calls (patch 0055) edit such a table without touching the tables above
 * it, so adding and removing rows and columns, merging and splitting cells and the looks of
 * format_cells work there as on a body table, with the same refusals. Tables keep the numbers
 * listTables gives them: an inner table right after the table it sits in.
 *
 * Fixtures: `nested-form.hwp` (Hancom Hangul: a 5×2 table in body paragraph 2 whose last cell
 * holds an 8×9 table, a 6×2 and a 4×2 table) and `nested-depth2.hwp` (made with the engine: a
 * 2×2 body table in paragraph 1, a 2×2 table in its first cell and another in that one's first
 * cell; cells 1–3 of the table at level L hold "L-1" to "L-3"). The editor's history is
 * modelled by snapshots, as in agent-plugin-delete-table.test.ts.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { agentPlugin, type AgentPluginHost } from '../studio-plugin/agent-plugin.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

interface Step {
  controlIndex: number
  cellIndex: number
  cellParaIndex: number
}

const step = (controlIndex: number, cellIndex = 0, cellParaIndex = 0): Step => ({
  controlIndex,
  cellIndex,
  cellParaIndex,
})

interface Fixture {
  name: string
  file: string
  /** the body paragraph the outermost table stands in */
  para: number
  /** listTables number of the inner table the tools edit */
  table: number
  /** its cell path */
  path: Step[]
  /** the paths of the tables above it, outermost first */
  above: Step[][]
}

const FIXTURES: Fixture[] = [
  {
    name: 'one level down (Hangul file)',
    file: 'nested-form.hwp',
    para: 2,
    table: 3,
    path: [step(0, 9, 11), step(0)],
    above: [[step(0)]],
  },
  {
    name: 'two levels down',
    file: 'nested-depth2.hwp',
    para: 1,
    table: 3,
    path: [step(0), step(0), step(0)],
    above: [[step(0)], [step(0), step(0)]],
  },
]

const bytesOf = (file: string) => readFileSync(join(__dirname, 'fixtures', file))

function open(bytes: Uint8Array) {
  let doc = new HwpDocument(new Uint8Array(bytes))
  const history: Uint8Array[] = []
  const host = {
    read: (fn: (d: HwpDocument) => unknown) => fn(doc),
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
    automation: {
      registerCommand: () => {},
      execute: (id: string) => {
        if (id !== 'edit:undo') return { ok: false }
        const before = history.pop()
        if (!before) return { ok: false }
        doc = new HwpDocument(before)
        return { ok: true }
      },
    },
  } as unknown as AgentPluginHost
  const plugin = agentPlugin.activate(host)
  return { plugin, steps: () => history.length, doc: () => doc }
}

const json = (path: Step[]) => JSON.stringify(path)

/** The path to paragraph k of cell `cell` of the table `path` names. */
const cellPara = (path: Step[], cell: number, k = 0): Step[] => [
  ...path.slice(0, -1),
  step(path[path.length - 1].controlIndex, cell, k),
]

/** Grid, table properties, cell properties and text of one table: what must not change. */
function tableState(doc: HwpDocument, para: number, path: Step[]) {
  const dims = JSON.parse(doc.getTableDimensionsByPath(0, para, json(path)))
  const cells = []
  for (let cell = 0; cell < dims.cellCount; cell++) {
    const props = JSON.parse(doc.getCellPropertiesByPath(0, para, json(path), cell))
    const count = doc.getCellParagraphCountByPath(0, para, json(cellPara(path, cell)))
    const texts: string[] = []
    for (let k = 0; k < count; k++) {
      const at = json(cellPara(path, cell, k))
      const length = doc.getCellParagraphLengthByPath(0, para, at)
      texts.push(length > 0 ? doc.getTextInCellByPath(0, para, at, 0, length) : '')
    }
    cells.push({ props, texts })
  }
  return { dims, cells, table: JSON.parse(doc.getTablePropertiesByPath(0, para, json(path))) }
}

const aboveState = (doc: HwpDocument, f: Fixture) =>
  f.above.map((path) => tableState(doc, f.para, path))

const cellProps = (doc: HwpDocument, f: Fixture, cell: number) =>
  JSON.parse(doc.getCellPropertiesByPath(0, f.para, json(f.path), cell))

/** The tables as listTables shows them: "rows×cols", with "<n" for the table they sit in. */
const shapes = (plugin: ReturnType<typeof open>['plugin']) =>
  plugin
    .listTables()
    .tables.map((table) => `${table.rows}×${table.cols}${table.inTable ? `<${table.inTable}` : ''}`)

const texts = (plugin: ReturnType<typeof open>['plugin'], table: number) => {
  const read = plugin.readTable(table)
  if (!read.ok) throw new Error('the table cannot be read')
  return read.cells.map((cell) => `${cell.row}.${cell.col}:${cell.text}`)
}

/** Saved as .hwp and .hwpx and opened again, the tables and their text are the same. */
function expectSurvivesSaving(doc: HwpDocument, plugin: ReturnType<typeof open>['plugin']) {
  const want = shapes(plugin)
  const wantTexts = want.map((_, index) => texts(plugin, index + 1))
  for (const bytes of [doc.exportHwp(), doc.exportHwpx()]) {
    const again = open(bytes)
    expect(shapes(again.plugin)).toEqual(want)
    expect(want.map((_, index) => texts(again.plugin, index + 1))).toEqual(wantTexts)
  }
}

describe.each(FIXTURES)('a table $name', (f) => {
  it('takes rows added after and before a row, in one undo step, the tables above unchanged', () => {
    const { plugin, steps, doc } = open(bytesOf(f.file))
    const above = aboveState(doc(), f)
    const before = plugin.readTable(f.table)
    if (!before.ok) throw new Error('unreadable')
    const result = plugin.addTableLines(f.table, 'rows', 1, 'after', 2)
    expect(result).toMatchObject({
      ok: true,
      table: f.table,
      rows: before.rows + 2,
      cols: before.cols,
      first: 2,
      count: 2,
    })
    expect(steps()).toBe(1)
    expect(plugin.addTableLines(f.table, 'rows', 1, 'before', 1)).toMatchObject({
      ok: true,
      rows: before.rows + 3,
      first: 1,
    })
    expect(aboveState(doc(), f)).toEqual(above)
    // the new rows are empty; the old ones are where they were, moved down
    const after = plugin.readTable(f.table)
    if (!after.ok) throw new Error('unreadable')
    expect(
      after.cells.filter((cell) => cell.row <= 1 || (cell.row >= 3 && cell.row <= 4)),
    ).toSatisfy((cells: { text: string }[]) => cells.every((cell) => cell.text === ''))
    expectSurvivesSaving(doc(), plugin)
  })

  it('takes columns added, and new cells keep the alignment of the column they copy', () => {
    const { plugin, doc } = open(bytesOf(f.file))
    const above = aboveState(doc(), f)
    // the copied column is centred: so is the new one
    expect(
      plugin.formatCells(
        f.table,
        { fromRow: 1, fromCol: 2, toRow: 2, toCol: 2 },
        {
          text: { align: 'center' },
        },
      ),
    ).toMatchObject({ ok: true })
    const result = plugin.addTableLines(f.table, 'columns', 2, 'after', 1)
    expect(result).toMatchObject({ ok: true, cols: 3, first: 3 })
    const added = JSON.parse(
      doc().getCellParaPropertiesAtByPath(0, f.para, json(cellPara(f.path, 2))),
    )
    expect(added.alignment).toBe('center')
    expect(aboveState(doc(), f)).toEqual(above)
    expectSurvivesSaving(doc(), plugin)
  })

  it('removes rows and columns, says what text went, and keeps the last one', () => {
    const { plugin, steps, doc } = open(bytesOf(f.file))
    const above = aboveState(doc(), f)
    const before = plugin.readTable(f.table)
    if (!before.ok) throw new Error('unreadable')
    const second = before.cells.filter((cell) => cell.row === 2).map((cell) => cell.text)
    const result = plugin.removeTableLines(f.table, 'rows', 2, 1)
    expect(result).toMatchObject({ ok: true, table: f.table, rows: before.rows - 1, count: 1 })
    if (!result.ok) return
    for (const text of second.filter(Boolean)) expect(result.text).toContain(text)
    expect(steps()).toBe(1)
    expect(plugin.removeTableLines(f.table, 'columns', 2, 1)).toMatchObject({
      ok: true,
      cols: before.cols - 1,
    })
    expect(aboveState(doc(), f)).toEqual(above)
    expect(plugin.removeTableLines(f.table, 'columns', 1, 1)).toEqual({
      ok: false,
      reason: 'would_empty',
      rows: before.rows - 1,
      cols: 1,
    })
    expect(plugin.removeTableLines(f.table, 'rows', 1, 9)).toMatchObject({
      ok: false,
      reason: 'no_such_line',
    })
    expect(steps()).toBe(2)
    expectSurvivesSaving(doc(), plugin)
  })

  it('merges cells and splits them again, in one undo step each', () => {
    const { plugin, steps, doc } = open(bytesOf(f.file))
    const above = aboveState(doc(), f)
    const cells = shapes(plugin)
    expect(plugin.mergeCells(f.table, { row: 1, col: 2 }, { row: 2, col: 2 })).toMatchObject({
      ok: true,
      merged: 2,
    })
    expect(steps()).toBe(1)
    const merged = plugin.readTable(f.table)
    if (!merged.ok) throw new Error('unreadable')
    expect(merged.cells.find((cell) => cell.row === 1 && cell.col === 2)).toMatchObject({
      rowSpan: 2,
    })
    expect(aboveState(doc(), f)).toEqual(above)
    expectSurvivesSaving(doc(), plugin)
    // by any place the merged cell covers
    expect(plugin.splitCell(f.table, 2, 2)).toMatchObject({ ok: true, unmerged: true })
    expect(steps()).toBe(2)
    expect(shapes(plugin)).toEqual(cells)
    expect(plugin.splitCell(f.table, 2, 2, 1, 3)).toMatchObject({ ok: true, unmerged: false })
    const split = JSON.parse(doc().getTableDimensionsByPath(0, f.para, json(f.path)))
    expect(split.colCount).toBeGreaterThan(2)
    expect(aboveState(doc(), f)).toEqual(above)
    expectSurvivesSaving(doc(), plugin)
  })

  it('refuses what it refuses on a body table', () => {
    const { plugin, steps, doc } = open(bytesOf(f.file))
    // a cell with a name (row 2, column 2), as a form fills it
    doc().setCellPropertiesByPath(0, f.para, json(f.path), 3, JSON.stringify({ fieldName: '성명' }))
    expect(cellProps(doc(), f, 3).fieldName).toBe('성명')
    // a cell that is not merged
    expect(plugin.splitCell(f.table, 1, 2)).toEqual({ ok: false, reason: 'not_merged' })
    // a merge through a merged cell
    expect(plugin.mergeCells(f.table, { row: 1, col: 1 }, { row: 1, col: 2 })).toMatchObject({
      ok: true,
    })
    expect(plugin.mergeCells(f.table, { row: 1, col: 2 }, { row: 2, col: 2 })).toEqual({
      ok: false,
      reason: 'crosses_merged',
      cells: [{ row: 1, col: 1 }],
    })
    // a cell outside
    expect(plugin.mergeCells(f.table, { row: 1, col: 1 }, { row: 9, col: 1 })).toMatchObject({
      ok: false,
      reason: 'no_such_cell',
    })
    // a merge that would lose a cell's name
    expect(plugin.mergeCells(f.table, { row: 2, col: 1 }, { row: 2, col: 2 })).toEqual({
      ok: false,
      reason: 'named_cells',
      cells: [{ row: 2, col: 2 }],
    })
    expect(steps()).toBe(1)
  })

  it('changes the look of its cells: background, lines, vertical alignment, diagonal', () => {
    const { plugin, steps, doc } = open(bytesOf(f.file))
    const above = aboveState(doc(), f)
    const untouched = cellProps(doc(), f, 3)
    const result = plugin.formatCells(
      f.table,
      { fromRow: 1, fromCol: 1, toRow: 1, toCol: 2 },
      {
        background: '#FFCC00',
        verticalAlign: 'bottom',
        borders: [{ sides: 'outer', line: 'double', width: 0.5, color: '#FF0000' }],
      },
    )
    expect(result).toMatchObject({ ok: true, count: 2 })
    expect(steps()).toBe(1)
    for (const cell of [0, 1]) {
      const props = cellProps(doc(), f, cell)
      expect(props).toMatchObject({ fillColor: '#ffcc00', verticalAlign: 2 })
      expect(props.borderTop.color).toBe('#ff0000')
    }
    // the cell below takes the line between them, as on a body table; nothing else of it changes
    expect(cellProps(doc(), f, 3)).toMatchObject({
      fillColor: untouched.fillColor,
      verticalAlign: untouched.verticalAlign,
      borderBottom: untouched.borderBottom,
    })
    expect(aboveState(doc(), f)).toEqual(above)
    // a diagonal through words is named
    const crossed = plugin.formatCells(f.table, [{ row: 2, col: 2 }], { diagonal: 'down' })
    expect(crossed).toMatchObject({ ok: true, count: 1, crossed: [{ row: 2, col: 2 }] })
    expect(aboveState(doc(), f)).toEqual(above)
    expectSurvivesSaving(doc(), plugin)
  })

  it('formats the text of its cells, alignment included', () => {
    const { plugin, doc } = open(bytesOf(f.file))
    const above = aboveState(doc(), f)
    const result = plugin.formatCells(f.table, [{ row: 2, col: 2 }], {
      text: { bold: true, align: 'right', color: '#0000FF' },
    })
    expect(result).toMatchObject({ ok: true, count: 1 })
    const at = json(cellPara(f.path, 3))
    expect(JSON.parse(doc().getCellCharPropertiesAtByPath(0, f.para, at, 0))).toMatchObject({
      bold: true,
      textColor: '#0000ff',
    })
    expect(JSON.parse(doc().getCellParaPropertiesAtByPath(0, f.para, at)).alignment).toBe('right')
    expect(aboveState(doc(), f)).toEqual(above)
    expectSurvivesSaving(doc(), plugin)
  })

  it('sets the height of its rows and the widths of its columns', () => {
    const { plugin, doc } = open(bytesOf(f.file))
    const above = aboveState(doc(), f)
    const height = plugin.formatCells(f.table, [{ row: 2, col: 1 }], { heightMm: 20 })
    expect(height).toMatchObject({ ok: true })
    expect(cellProps(doc(), f, 2).height).toBe(Math.round((20 * 7200) / 25.4))
    const width = (cell: number) => cellProps(doc(), f, cell).width as number
    const total = width(0) + width(1)
    const widths = plugin.formatCells(f.table, null, { columnWidths: [1, 3] })
    expect(widths).toMatchObject({ ok: true })
    if (!widths.ok) return
    expect(widths.columnWidthsMm).toHaveLength(2)
    expect(width(0) + width(1)).toBe(total)
    expect(width(1)).toBeGreaterThan(width(0) * 2)
    expect(aboveState(doc(), f).map((state) => state.dims)).toEqual(above.map((s) => s.dims))
    expect(aboveState(doc(), f).map((state) => state.cells.map((cell) => cell.texts))).toEqual(
      above.map((s) => s.cells.map((cell) => cell.texts)),
    )
    expectSurvivesSaving(doc(), plugin)
  })
})

describe('the rules of a body table hold for a table inside a cell', () => {
  it('does not remove or split a cell that holds a table', () => {
    // table 2 of nested-depth2 holds table 3 in its first cell
    const { plugin, steps } = open(bytesOf('nested-depth2.hwp'))
    expect(plugin.removeTableLines(2, 'rows', 1, 1)).toEqual({
      ok: false,
      reason: 'holds_object',
      cells: [{ row: 1, col: 1 }],
      rows: 2,
      cols: 2,
    })
    expect(plugin.removeTableLines(2, 'columns', 1, 1)).toMatchObject({
      ok: false,
      reason: 'holds_object',
    })
    expect(plugin.splitCell(2, 1, 1, 2, 1)).toEqual({ ok: false, reason: 'holds_object' })
    expect(steps()).toBe(0)
    // the row without it goes
    expect(plugin.removeTableLines(2, 'rows', 2, 1)).toMatchObject({ ok: true, rows: 1 })
    expect(shapes(plugin)).toEqual(['2×2', '1×2<1', '2×2<2'])
  })

  it('refuses a merge through a merged cell of the Hangul form', () => {
    // row 1 of the 8×9 table: 평가 종류 | 정기시험 (4 columns) | 수행평가 (3) | 합계
    const { plugin, steps } = open(bytesOf('nested-form.hwp'))
    expect(plugin.mergeCells(2, { row: 1, col: 1 }, { row: 1, col: 3 })).toEqual({
      ok: false,
      reason: 'crosses_merged',
      cells: [{ row: 1, col: 2 }],
    })
    expect(plugin.formatCells(2, [{ row: 1, col: 3 }], { background: '#eeeeee' })).toMatchObject({
      ok: true,
      count: 1,
    })
    expect(steps()).toBe(1)
  })

  it('numbers the tables as before, an inner one after the table it sits in', () => {
    const { plugin } = open(bytesOf('nested-form.hwp'))
    expect(plugin.addTableLines(3, 'rows', 6, 'after', 1)).toMatchObject({ ok: true, rows: 7 })
    expect(shapes(plugin)).toEqual(['5×2', '8×9<1', '7×2<1', '4×2<1'])
  })
})

/** What the engine says of an inner table whose cell borders are drawn by objects. */
const DRAWN = '칸 테두리를 개체로 그린 안쪽 표는 아직 고칠 수 없습니다'

describe('an inner table the engine cannot change yet', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Open nested-form with the engine's path calls `names` refusing as for drawn borders (on
   * every copy of the document: a change rolled back opens a new one).
   */
  function refusing(...names: (keyof HwpDocument)[]) {
    for (const name of names) {
      vi.spyOn(HwpDocument.prototype, name).mockImplementation(() => {
        throw DRAWN
      })
    }
    return open(bytesOf('nested-form.hwp'))
  }

  it('answers nested for rows and columns, and leaves the document alone', () => {
    const { plugin, steps } = refusing('insertTableRowByPath', 'deleteTableColumnByPath')
    expect(plugin.addTableLines(3, 'rows', 1, 'after', 1)).toEqual({
      ok: false,
      reason: 'nested',
      rows: 6,
      cols: 2,
    })
    expect(plugin.removeTableLines(3, 'columns', 1, 1)).toEqual({
      ok: false,
      reason: 'nested',
      rows: 6,
      cols: 2,
    })
    expect(steps()).toBe(0)
    expect(shapes(plugin)).toEqual(['5×2', '8×9<1', '6×2<1', '4×2<1'])
  })

  it('answers unsupported_place for merging, splitting and the look of cells', () => {
    const { plugin, steps } = refusing(
      'mergeTableCellsByPath',
      'splitTableCellIntoByPath',
      'setCellPropertiesByPath',
    )
    expect(plugin.mergeCells(3, { row: 1, col: 1 }, { row: 1, col: 2 })).toEqual({
      ok: false,
      reason: 'unsupported_place',
    })
    expect(plugin.splitCell(3, 1, 1, 2, 2)).toEqual({ ok: false, reason: 'unsupported_place' })
    expect(plugin.formatCells(3, null, { background: '#eeeeee' })).toEqual({
      ok: false,
      reason: 'unsupported_place',
      count: 4,
    })
    expect(steps()).toBe(0)
  })
})
