/**
 * The Hangul-key commands on a table inside a cell or a text box, run on the real engine through
 * the services nestedTableCommand hands them (studio-plugin/hancom-keys.mjs): Ctrl+Enter's row,
 * Tab in the last cell, Ctrl+Backspace's row deletion and W (equal widths) change the inner table
 * only. The tables above keep their grid, sizes and text, and the edited file saves as .hwp and
 * .hwpx and opens again with the edited grid. A body table still takes the flat calls.
 *
 * The bridge here stands in for the studio's WasmBridge (core/wasm-bridge.ts): the engine's calls
 * with object arguments as JSON and JSON answers parsed, as the bridge does.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import {
  equalizeTableCells,
  hancomCommands,
  innerTableTabRow,
  insertRowBelow,
  nestedTableCommand,
} from '../studio-plugin/hancom-keys.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
  hancomCommands('en', { showToast: vi.fn() })
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

interface Target {
  name: string
  file: string
  para: number
  /** The path to the inner table's last cell, as the caret holds it. */
  last: Step[]
  textBox?: boolean
  /** Paths to the tables above it, outermost first. */
  above: Step[][]
}

const TARGETS: Target[] = [
  {
    name: 'a table in a form cell (Hangul file)',
    file: 'nested-form.hwp',
    para: 2,
    last: [step(0, 9, 11), step(0, 11)],
    above: [[step(0)]],
  },
  {
    name: 'a table two levels down',
    file: 'nested-depth2.hwp',
    para: 1,
    last: [step(0), step(0), step(0, 3)],
    above: [[step(0)], [step(0), step(0)]],
  },
  {
    name: 'a table in a text box',
    file: 'textbox-table.hwp',
    para: 0,
    last: [step(2), step(0, 3)],
    textBox: true,
    above: [],
  },
]

const OBJECT_ARGS = /^(set|apply|resize).*/

/** The studio's bridge over an engine document, close enough for the plugin's calls. */
function bridgeOf(doc: HwpDocument): Record<string, (...args: unknown[]) => unknown> {
  const engine = doc as unknown as Record<string, (...args: unknown[]) => unknown>
  return new Proxy({} as Record<string, (...args: unknown[]) => unknown>, {
    get(_, prop: string) {
      if (prop === 'runInBatch') return (fn: () => unknown) => fn()
      if (prop === 'then') return undefined
      return (...args: unknown[]) => {
        let list = args
        if (prop === 'setCellZoneProperties' || prop === 'setCellZonePropertiesByPath') {
          const [a, b, c, range, props] = args as [
            unknown,
            unknown,
            unknown,
            Record<string, number>,
            unknown,
          ]
          list = [a, b, c, range.startRow, range.startCol, range.endRow, range.endCol, props]
        }
        if (OBJECT_ARGS.test(prop)) {
          list = list.map((arg) =>
            arg !== null && typeof arg === 'object' ? JSON.stringify(arg) : arg,
          )
        }
        const answer = engine[prop].apply(doc, list)
        return typeof answer === 'string' && /^[[{]/.test(answer) ? JSON.parse(answer) : answer
      }
    },
  })
}

/** An input handler with the caret at a cell path, running snapshots straight on the engine. */
function editorAt(doc: HwpDocument, para: number, cellPath: Step[], textBox = false) {
  const wasm = bridgeOf(doc)
  const last = cellPath[cellPath.length - 1]
  let position: Record<string, unknown> = {
    sectionIndex: 0,
    paragraphIndex: last.cellParaIndex,
    charOffset: 0,
    parentParaIndex: para,
    controlIndex: cellPath[0].controlIndex,
    cellIndex: last.cellIndex,
    cellParaIndex: last.cellParaIndex,
    cellPath,
    ...(textBox ? { isTextBox: true } : {}),
  }
  const cursor = {
    getPosition: () => position,
    isInCell: () => true,
    isInTextBox: () => textBox,
    isInHeaderFooter: () => false,
    isInFootnote: () => false,
    isInCellSelectionMode: () => false,
    isInTableObjectSelection: () => false,
    getCellTableContext: () => ({
      sec: 0,
      ppi: para,
      ci: cellPath[0].controlIndex,
      cellPath: position.cellPath,
    }),
    getSelectedTableRef: () => null,
  }
  const ih = {
    cursor,
    wasm,
    getCursorPosition: () => position,
    executeOperation(desc: {
      kind: string
      operation(w: unknown): Record<string, unknown> | null
    }) {
      if (desc.kind !== 'snapshot') throw new Error('snapshots only')
      const next = desc.operation(wasm)
      if (next) position = next
    },
    updateCellSelection: () => {},
  }
  const services = { wasm, getInputHandler: () => ih }
  return { ih, services, position: () => position }
}

const fixture = (file: string) => new HwpDocument(readFileSync(join(__dirname, 'fixtures', file)))

const tablePath = (cellPath: Step[]): Step[] => [
  ...cellPath.slice(0, -1),
  step(cellPath[cellPath.length - 1].controlIndex),
]
const cellOf = (table: Step[], cell: number): Step[] => [
  ...table.slice(0, -1),
  step(table[table.length - 1].controlIndex, cell),
]

interface Dims {
  rowCount: number
  colCount: number
  cellCount: number
}
const dims = (doc: HwpDocument, para: number, table: Step[]): Dims =>
  JSON.parse(doc.getTableDimensionsByPath(0, para, JSON.stringify(table)))

/** Grid, cell sizes and text of every table above the target. */
function surroundings(doc: HwpDocument, t: Target): unknown[] {
  return t.above.map((table) => {
    const size = dims(doc, t.para, table)
    const cells = []
    for (let cell = 0; cell < size.cellCount; cell += 1) {
      const props = JSON.parse(
        doc.getCellPropertiesByPath(0, t.para, JSON.stringify(table), cell),
      ) as { width: number }
      // the cell the inner table sits in may grow in height with it, as in Hangul
      cells.push([
        props.width,
        doc.getTextInCellByPath(0, t.para, JSON.stringify(cellOf(table, cell)), 0, 400),
      ])
    }
    return [size, cells]
  })
}

function expectSavedAs(doc: HwpDocument, t: Target, want: Dims): void {
  const inner = tablePath(t.last)
  for (const bytes of [doc.exportHwp(), doc.exportHwpx()]) {
    const again = new HwpDocument(bytes)
    expect(dims(again, t.para, inner)).toEqual(want)
    expect(surroundings(again, t)).toEqual(surroundings(doc, t))
  }
}

describe.each(TARGETS)('$name', (t) => {
  const inner = tablePath(t.last)

  it('takes Ctrl+Enter’s row in the inner table only, the caret staying in it', () => {
    const doc = fixture(t.file)
    const before = dims(doc, t.para, inner)
    const around = surroundings(doc, t)
    const { services, position } = editorAt(doc, t.para, t.last, t.textBox)
    const scoped = nestedTableCommand('ieum:table-insert-row-below', services)
    expect(scoped).toBeTruthy()
    expect(insertRowBelow(scoped)).toBe(true)
    const after = dims(doc, t.para, inner)
    expect(after).toEqual({
      ...before,
      rowCount: before.rowCount + 1,
      cellCount: before.cellCount + before.colCount,
    })
    expect(surroundings(doc, t)).toEqual(around)
    expect((position().cellPath as Step[]).slice(0, -1)).toEqual(t.last.slice(0, -1))
    expectSavedAs(doc, t, after)
  })

  it('adds a row on Tab in the last cell and goes to its first cell, as Hangul does', () => {
    const doc = fixture(t.file)
    const before = dims(doc, t.para, inner)
    const around = surroundings(doc, t)
    const { ih, position } = editorAt(doc, t.para, t.last, t.textBox)
    expect(innerTableTabRow(ih)).toBe(true)
    expect(dims(doc, t.para, inner).rowCount).toBe(before.rowCount + 1)
    expect(surroundings(doc, t)).toEqual(around)
    const caret = position()
    const cell = (caret.cellPath as Step[])[t.last.length - 1]
    const info = JSON.parse(doc.getCellInfoByPath(0, t.para, JSON.stringify(caret.cellPath))) as {
      row: number
      col: number
    }
    expect(info).toMatchObject({ row: before.rowCount, col: 0 })
    expect(caret.cellIndex).toBe(cell.cellIndex)
  })

  it('leaves Tab to the studio in a cell that is not the last', () => {
    const doc = fixture(t.file)
    const first = [...t.last.slice(0, -1), step(t.last[t.last.length - 1].controlIndex, 0)]
    const { ih } = editorAt(doc, t.para, first, t.textBox)
    expect(innerTableTabRow(ih)).toBe(false)
    expect(dims(doc, t.para, inner)).toEqual(dims(fixture(t.file), t.para, inner))
  })

  it('deletes the caret’s row of the inner table, and keeps its last row', () => {
    const doc = fixture(t.file)
    const before = dims(doc, t.para, inner)
    const around = surroundings(doc, t)
    const { services } = editorAt(doc, t.para, t.last, t.textBox)
    const scoped = nestedTableCommand('table:delete-row', services) as typeof services
    const view = scoped.wasm as unknown as {
      deleteTableRow(...a: number[]): { rowCount: number }
    }
    const pos = scoped.getInputHandler().getCursorPosition() as Record<string, number>
    for (let left = before.rowCount; left > 1; left -= 1) {
      expect(view.deleteTableRow(0, t.para, pos.controlIndex, 0).rowCount).toBe(left - 1)
    }
    expect(() => view.deleteTableRow(0, t.para, pos.controlIndex, 0)).toThrow()
    expect(dims(doc, t.para, inner).rowCount).toBe(1)
    expect(surroundings(doc, t)).toEqual(around)
  })

  it('makes the inner table’s columns equally wide (W) and leaves the outer cells alone', () => {
    const doc = fixture(t.file)
    const around = surroundings(doc, t)
    const { services } = editorAt(doc, t.para, t.last, t.textBox)
    const scoped = nestedTableCommand('table:cell-width-equal', services)
    // widen the first column first, so W has something to even out
    const view = (scoped as typeof services).wasm as unknown as {
      resizeTableCells(...a: unknown[]): { ok: boolean }
    }
    expect(
      view.resizeTableCells(0, t.para, t.last[0].controlIndex, [{ cellIdx: 0, widthDelta: 900 }])
        .ok,
    ).toBe(true)
    expect(equalizeTableCells(scoped, 'width', false)).toBe(true)
    const widths = new Set<number>()
    const size = dims(doc, t.para, inner)
    for (let cell = 0; cell < size.cellCount; cell += 1) {
      widths.add(
        (
          JSON.parse(doc.getCellPropertiesByPath(0, t.para, JSON.stringify(inner), cell)) as {
            width: number
          }
        ).width,
      )
    }
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1)
    expect(surroundings(doc, t)).toEqual(around)
    expectSavedAs(doc, t, size)
  })
})

describe('a table in the body', () => {
  it('still takes Ctrl+Enter’s row through the flat call', () => {
    const doc = fixture('nested-form.hwp')
    const { services } = editorAt(doc, 2, [step(0, 9, 0)])
    expect(nestedTableCommand('ieum:table-insert-row-below', services)).toBeNull()
    expect(insertRowBelow(services)).toBe(true)
    expect(dims(doc, 2, [step(0)]).rowCount).toBe(6)
    expect(dims(doc, 2, [step(0, 9, 11), step(0)]).rowCount).toBe(6)
  })

  it('cannot reach an inner table without the services that do', () => {
    const doc = fixture('nested-form.hwp')
    const { services } = editorAt(doc, 2, TARGETS[0].last)
    expect(insertRowBelow(services)).toBe(false)
    expect(dims(doc, 2, [step(0)]).rowCount).toBe(5)
    expect(dims(doc, 2, [step(0, 9, 11), step(0)]).rowCount).toBe(6)
  })
})
