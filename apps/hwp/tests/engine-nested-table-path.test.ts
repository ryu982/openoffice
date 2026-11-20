/**
 * The cell-path table calls (rhwp patch 0055) edit a table inside a table or a text box.
 *
 * The flat calls (`insertTableRow` and the rest) reach only a body table, so the editor's table
 * commands changed the outer table when the cursor stood in an inner one. Each `…ByPath` call
 * takes the cell path of the other path calls and edits the table its last entry names: the
 * tables above and their other cells stay as they were, a wrong path changes nothing, and the
 * file saved as .hwp or .hwpx opens again with the edited grid and page count.
 *
 * Fixtures: `nested-form.hwp` (Hangul, a 6×2 treat-as-char table in a cell of a body table);
 * `nested-depth2.hwp` and `nested-depth3.hwp` (made with the engine: a 2×2 body table and two or
 * three 2×2 tables, each in the first cell of the one above, created with
 * `createTableInCellByPath`; cells 1–3 of the table at level L hold "L-cell"); and
 * `textbox-table.hwp` (a 2×2 table pasted with `pasteInternalInCellByPath` into a text box in
 * the first body paragraph, cells "상자-0" to "상자-3"). A table whose borders are drawn by
 * objects cannot be made as a file this way; the engine's Rust tests cover its refusal.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'

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

interface Target {
  name: string
  file: string
  para: number
  /** Path whose last entry names the table. */
  path: Step[]
  /** Paths of the tables above it, outermost first. */
  above: Step[][]
}

const step = (controlIndex: number, cellIndex = 0, cellParaIndex = 0): Step => ({
  controlIndex,
  cellIndex,
  cellParaIndex,
})

const TARGETS: Target[] = [
  {
    name: 'one level down (Hangul file)',
    file: 'nested-form.hwp',
    para: 2,
    path: [step(0, 9, 11), step(0)],
    above: [[step(0)]],
  },
  {
    name: 'two levels down',
    file: 'nested-depth2.hwp',
    para: 1,
    path: [step(0), step(0), step(0)],
    above: [[step(0)], [step(0), step(0)]],
  },
  {
    name: 'three levels down',
    file: 'nested-depth3.hwp',
    para: 1,
    path: [step(0), step(0), step(0), step(0)],
    above: [[step(0)], [step(0), step(0)], [step(0), step(0), step(0)]],
  },
  {
    name: 'in a text box',
    file: 'textbox-table.hwp',
    para: 0,
    path: [step(2), step(0)],
    above: [],
  },
]

const fixture = (file: string): HwpDocument =>
  new HwpDocument(readFileSync(join(__dirname, 'fixtures', file)))

const json = (path: Step[]): string => JSON.stringify(path)

/** The path to one cell of the table `path` names. */
const cellOf = (path: Step[], cell: number): Step[] => [
  ...path.slice(0, -1),
  step(path[path.length - 1].controlIndex, cell),
]

interface Dims {
  rowCount: number
  colCount: number
  cellCount: number
}

const dims = (doc: HwpDocument, para: number, path: Step[]): Dims =>
  JSON.parse(doc.getTableDimensionsByPath(0, para, json(path)))

/** Text of every cell of a table but the one the path below goes through. */
function neighbours(doc: HwpDocument, para: number, table: Step[], through: number): string[] {
  const { cellCount } = dims(doc, para, table)
  const out: string[] = []
  for (let cell = 0; cell < cellCount; cell++) {
    if (cell !== through)
      out.push(doc.getTextInCellByPath(0, para, json(cellOf(table, cell)), 0, 200))
  }
  return out
}

/** Grid and cell text of every table above the target, except the cells on the path. */
function surroundings(doc: HwpDocument, t: Target): unknown[] {
  return t.above.map((table, i) => {
    const below = t.above[i + 1] ?? t.path
    return [
      dims(doc, t.para, table),
      neighbours(doc, t.para, table, below[table.length - 1].cellIndex),
    ]
  })
}

function verify(doc: HwpDocument): { pageCountBefore: number; pageCountAfter: number } {
  return JSON.parse(doc.exportHwpVerify())
}

/** Saved as .hwp and .hwpx and opened again, the table keeps its grid and the pages their count. */
function expectSurvivesSaving(doc: HwpDocument, t: Target): void {
  const want = dims(doc, t.para, t.path)
  const pages = doc.pageCount()
  const check = verify(doc)
  expect(check.pageCountAfter).toBe(check.pageCountBefore)
  for (const bytes of [doc.exportHwp(), doc.exportHwpx()]) {
    const again = new HwpDocument(bytes)
    expect(dims(again, t.para, t.path)).toEqual(want)
    expect(again.pageCount()).toBe(pages)
  }
}

describe.each(TARGETS)('a table $name', (t) => {
  it('takes row and column edits, and the tables above stay', () => {
    const doc = fixture(t.file)
    const p = json(t.path)
    const before = dims(doc, t.para, t.path)
    const around = surroundings(doc, t)

    expect(JSON.parse(doc.insertTableRowByPath(0, t.para, p, 0, true))).toEqual({
      ok: true,
      rowCount: before.rowCount + 1,
      colCount: before.colCount,
    })
    expect(JSON.parse(doc.insertTableColumnByPath(0, t.para, p, 0, true))).toMatchObject({
      ok: true,
      colCount: before.colCount + 1,
    })
    expect(surroundings(doc, t)).toEqual(around)
    expectSurvivesSaving(doc, t)

    expect(JSON.parse(doc.deleteTableColumnByPath(0, t.para, p, 1))).toMatchObject({
      colCount: before.colCount,
    })
    expect(JSON.parse(doc.deleteTableRowByPath(0, t.para, p, 1))).toMatchObject({
      rowCount: before.rowCount,
    })
    expect(dims(doc, t.para, t.path)).toEqual(before)
    expect(surroundings(doc, t)).toEqual(around)
    expectSurvivesSaving(doc, t)
  })

  it('merges and splits cells', () => {
    const doc = fixture(t.file)
    const p = json(t.path)
    const { cellCount } = dims(doc, t.para, t.path)
    const around = surroundings(doc, t)
    expect(JSON.parse(doc.mergeTableCellsByPath(0, t.para, p, 0, 0, 0, 1))).toEqual({
      ok: true,
      cellCount: cellCount - 1,
    })
    expectSurvivesSaving(doc, t)
    expect(JSON.parse(doc.splitTableCellByPath(0, t.para, p, 0, 0))).toMatchObject({ cellCount })
    expect(
      JSON.parse(doc.splitTableCellIntoByPath(0, t.para, p, 1, 0, 2, 1, true, false)),
    ).toMatchObject({
      cellCount: cellCount + 1,
    })
    expect(
      JSON.parse(doc.splitTableCellsInRangeByPath(0, t.para, p, 0, 0, 0, 1, 1, 2, false)),
    ).toMatchObject({ cellCount: cellCount + 3 })
    expect(surroundings(doc, t)).toEqual(around)
    expectSurvivesSaving(doc, t)
  })

  it('reads and writes cell and table properties of that table', () => {
    const doc = fixture(t.file)
    const p = json(t.path)
    const around = surroundings(doc, t)
    const outerLooks = t.above.map((a) => doc.getTablePropertiesByPath(0, t.para, json(a)))

    doc.setCellPropertiesByPath(0, t.para, p, 1, JSON.stringify({ verticalAlign: 2 }))
    expect(JSON.parse(doc.getCellOwnPropertiesByPath(0, t.para, p, 1))).toMatchObject({
      verticalAlign: 2,
    })
    expect(JSON.parse(doc.getCellPropertiesByPath(0, t.para, p, 1))).toMatchObject({
      verticalAlign: 2,
    })

    const zone = JSON.parse(
      doc.setCellZonePropertiesByPath(
        0,
        t.para,
        p,
        0,
        0,
        1,
        1,
        JSON.stringify({ fillType: 'solid', fillColor: '#ffcc00' }),
      ),
    )
    expect(zone).toMatchObject({ ok: true, startRow: 0, endRow: 1 })
    const undo = {
      zones: [{ startRow: 0, startCol: 0, endRow: 1, endCol: 1, id: zone.zoneBeforeId }],
    }
    expect(
      JSON.parse(doc.applyCellBorderFillIdsByPath(0, t.para, p, JSON.stringify(undo))),
    ).toEqual({ ok: true })

    const props = JSON.parse(doc.getTablePropertiesByPath(0, t.para, p))
    expect(props).toHaveProperty('treatAsChar', true)
    doc.setTablePropertiesByPath(
      0,
      t.para,
      p,
      JSON.stringify({ ...props, cellSpacing: 40, paddingLeft: 300 }),
    )
    expect(JSON.parse(doc.getTablePropertiesByPath(0, t.para, p))).toMatchObject({
      cellSpacing: 40,
      paddingLeft: 300,
    })

    expect(t.above.map((a) => doc.getTablePropertiesByPath(0, t.para, json(a)))).toEqual(outerLooks)
    expect(surroundings(doc, t)).toEqual(around)
    expectSurvivesSaving(doc, t)
  })

  it('resizes one cell and sets cell extents', () => {
    const doc = fixture(t.file)
    const p = json(t.path)
    const widthOf = (cell: number): number =>
      JSON.parse(doc.getCellPropertiesByPath(0, t.para, p, cell)).width
    const outerWidths = t.above.map((a) => {
      const { cellCount } = dims(doc, t.para, a)
      return Array.from(
        { length: cellCount },
        (_, c) => JSON.parse(doc.getCellPropertiesByPath(0, t.para, json(a), c)).width,
      )
    })
    const [a, b] = [widthOf(0), widthOf(1)]
    expect(JSON.parse(doc.resizeTableCellByPath(0, t.para, p, 0, 0, false, false))).toEqual({
      ok: true,
      moved: true,
    })
    expect([widthOf(0), widthOf(1)]).toEqual([a - 283, b + 283])

    const half = Math.floor((a + b) / 2)
    const extents = [
      { cellIdx: 0, start: 0, end: half },
      { cellIdx: 1, start: half, end: a + b },
    ]
    expect(
      JSON.parse(doc.setTableCellExtentsByPath(0, t.para, p, false, JSON.stringify(extents))),
    ).toEqual({ ok: true })
    expect([widthOf(0), widthOf(1)]).toEqual([half, a + b - half])

    t.above.forEach((above, i) => {
      const { cellCount } = dims(doc, t.para, above)
      const now = Array.from(
        { length: cellCount },
        (_, c) => JSON.parse(doc.getCellPropertiesByPath(0, t.para, json(above), c)).width,
      )
      expect(now).toEqual(outerWidths[i])
    })
    expectSurvivesSaving(doc, t)
  })
})

/** Every writing call with arguments that would succeed on the fixtures' tables. */
const WRITES: [string, (doc: HwpDocument, para: number, path: string) => string][] = [
  ['insertTableRowByPath', (d, para, p) => d.insertTableRowByPath(0, para, p, 0, true)],
  ['insertTableColumnByPath', (d, para, p) => d.insertTableColumnByPath(0, para, p, 0, true)],
  ['deleteTableRowByPath', (d, para, p) => d.deleteTableRowByPath(0, para, p, 0)],
  ['deleteTableColumnByPath', (d, para, p) => d.deleteTableColumnByPath(0, para, p, 0)],
  ['mergeTableCellsByPath', (d, para, p) => d.mergeTableCellsByPath(0, para, p, 0, 0, 0, 1)],
  ['splitTableCellByPath', (d, para, p) => d.splitTableCellByPath(0, para, p, 0, 0)],
  [
    'splitTableCellIntoByPath',
    (d, para, p) => d.splitTableCellIntoByPath(0, para, p, 0, 0, 2, 1, false, false),
  ],
  [
    'splitTableCellsInRangeByPath',
    (d, para, p) => d.splitTableCellsInRangeByPath(0, para, p, 0, 0, 1, 1, 2, 1, false),
  ],
  [
    'setCellPropertiesByPath',
    (d, para, p) => d.setCellPropertiesByPath(0, para, p, 0, '{"verticalAlign":1}'),
  ],
  [
    'setCellZonePropertiesByPath',
    (d, para, p) => d.setCellZonePropertiesByPath(0, para, p, 0, 0, 1, 1, '{"fillType":"none"}'),
  ],
  [
    'applyCellBorderFillIdsByPath',
    (d, para, p) => d.applyCellBorderFillIdsByPath(0, para, p, '{"cells":[{"cellIdx":0,"id":1}]}'),
  ],
  [
    'setTablePropertiesByPath',
    (d, para, p) => d.setTablePropertiesByPath(0, para, p, '{"cellSpacing":5}'),
  ],
  ['resizeTableCellByPath', (d, para, p) => d.resizeTableCellByPath(0, para, p, 0, 0, false, true)],
  [
    'setTableCellExtentsByPath',
    (d, para, p) =>
      d.setTableCellExtentsByPath(0, para, p, false, '[{"cellIdx":0,"start":0,"end":3000}]'),
  ],
]

/** Each write throws and the saved bytes stay the same. */
function expectRefused(doc: HwpDocument, para: number, path: Step[]): void {
  const before = doc.exportHwp()
  for (const [name, call] of WRITES) {
    expect(() => call(doc, para, json(path)), name).toThrow()
    expect(Buffer.from(doc.exportHwp()).equals(Buffer.from(before)), name).toBe(true)
  }
}

describe('a wrong path', () => {
  const z = step(0)
  it.each([
    ['empty', 1, []],
    ['a cell out of range', 1, [z, step(0, 9), z]],
    ['a paragraph out of range', 1, [step(0, 0, 9), z, z]],
    ['a control out of range', 1, [z, z, step(7)]],
    ['a body paragraph out of range', 8, [z, z, z]],
    ['a step into an empty cell paragraph', 1, [z, step(0, 1), z]],
  ] as [string, number, Step[]][])('%s changes nothing', (_, para, path) => {
    const doc = fixture('nested-depth2.hwp')
    expectRefused(doc, para, path)
    expect(() => doc.getTablePropertiesByPath(0, para, json(path))).toThrow()
    expect(() => doc.getCellOwnPropertiesByPath(0, para, json(path), 0)).toThrow()
  })

  it('never falls back to the table above', () => {
    const doc = fixture('nested-depth2.hwp')
    const outer = dims(doc, 1, [step(0)])
    const middle = dims(doc, 1, [z, z])
    expect(() => doc.insertTableRowByPath(0, 1, json([z, step(0, 9), z]), 0, true)).toThrow()
    expect(dims(doc, 1, [step(0)])).toEqual(outer)
    expect(dims(doc, 1, [z, z])).toEqual(middle)
  })
})

describe('the rules of the flat calls hold for a nested table', () => {
  const path = [step(0), step(0), step(0)]
  it('keeps the last row and column', () => {
    const doc = fixture('nested-depth2.hwp')
    doc.deleteTableRowByPath(0, 1, json(path), 0)
    doc.deleteTableColumnByPath(0, 1, json(path), 0)
    const before = doc.exportHwp()
    expect(() => doc.deleteTableRowByPath(0, 1, json(path), 0)).toThrow()
    expect(() => doc.deleteTableColumnByPath(0, 1, json(path), 0)).toThrow()
    expect(Buffer.from(doc.exportHwp()).equals(Buffer.from(before))).toBe(true)
  })

  it('refuses a merge that cuts through a merged cell', () => {
    const doc = fixture('nested-depth2.hwp')
    doc.insertTableRowByPath(0, 1, json(path), 1, true)
    doc.mergeTableCellsByPath(0, 1, json(path), 0, 0, 1, 0)
    const before = doc.exportHwp()
    expect(() => doc.mergeTableCellsByPath(0, 1, json(path), 1, 0, 2, 0)).toThrow()
    expect(Buffer.from(doc.exportHwp()).equals(Buffer.from(before))).toBe(true)
  })

  it('leaves the caption of a nested table alone', () => {
    const doc = fixture('nested-depth2.hwp')
    const before = doc.exportHwp()
    expect(() => doc.setTablePropertiesByPath(0, 1, json(path), '{"hasCaption":true}')).toThrow()
    expect(Buffer.from(doc.exportHwp()).equals(Buffer.from(before))).toBe(true)
  })
})

describe('a path of one step', () => {
  it('is the flat call', () => {
    const flat = fixture('nested-form.hwp')
    const byPath = fixture('nested-form.hwp')
    const outer = json([step(0)])
    flat.insertTableRow(0, 2, 0, 1, true)
    byPath.insertTableRowByPath(0, 2, outer, 1, true)
    flat.setTableProperties(0, 2, 0, '{"cellSpacing":10}')
    byPath.setTablePropertiesByPath(0, 2, outer, '{"cellSpacing":10}')
    expect(byPath.getTablePropertiesByPath(0, 2, outer)).toBe(flat.getTableProperties(0, 2, 0))
    expect(byPath.getCellOwnPropertiesByPath(0, 2, outer, 3)).toBe(
      flat.getCellOwnProperties(0, 2, 0, 3),
    )
    expect(Buffer.from(byPath.exportHwp()).equals(Buffer.from(flat.exportHwp()))).toBe(true)
  })
})

describe('a taller treat-as-char table in a cell (0042 for a nested table)', () => {
  it('keeps the .hwp save check and the reopened pages with the edit', () => {
    const t = TARGETS[0]
    const doc = fixture(t.file)
    const p = json(t.path)
    for (let i = 0; i < 12; i++) doc.insertTableRowByPath(0, t.para, p, 0, true)
    const pages = doc.pageCount()
    expect(verify(doc)).toMatchObject({ pageCountBefore: pages, pageCountAfter: pages })
    const again = new HwpDocument(doc.exportHwp())
    expect(again.pageCount()).toBe(pages)
    expect(dims(again, t.para, t.path).rowCount).toBe(18)
    for (let i = 0; i < 12; i++) doc.deleteTableRowByPath(0, t.para, p, 0)
    expect(verify(doc)).toMatchObject({ pageCountBefore: 2, pageCountAfter: 2 })
  })
})
