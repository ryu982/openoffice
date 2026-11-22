/**
 * The editor's table commands point at a table by the outermost table's numbers (the caret's
 * parentParaIndex/controlIndex/cellIndex, a cell block's or a selected table's sec/ppi/ci). In a
 * table inside a cell or a text box those numbers name the outer table, so the commands changed
 * the outer form table. The studio's dispatcher now asks studio-plugin/hancom-keys.mjs
 * (nestedTableCommand, hooked in by the studio-nested-table-dispatch patch): there the editing
 * commands run with services whose bridge sends a flat table call named with those numbers to the
 * path call for the inner table, as one snapshot; the commands that cannot yet are refused with
 * the reason. A table in the body takes every command as before.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  HANCOM_KEYS_MODULE,
  NESTED_TABLE_EDITS,
  NESTED_TABLE_LATER,
  hancomCommands,
  hancomTableObjectKey,
  innerTableBridge,
  innerTableOf,
  innerTableServices,
  innerTableTarget,
  nestedTableAt,
  nestedTableCommand,
} from '../studio-plugin/hancom-keys.mjs'
import { STUDIO_PATCHES, applyPatch, patchTargets } from '../scripts/rhwp-patches.mjs'

interface Step {
  controlIndex: number
  cellIndex: number
  cellParaIndex: number
}

interface Where {
  /** The caret's cell path; one step is a table in the body (or a text box itself). */
  path?: Step[]
  textBox?: boolean
  block?: boolean
  object?: boolean
  header?: boolean
  footnote?: boolean
}

const step = (controlIndex: number, cellIndex = 0, cellParaIndex = 0): Step => ({
  controlIndex,
  cellIndex,
  cellParaIndex,
})
const BODY = [step(0, 3)]
const NESTED = [step(0, 3), step(0, 5)]
const DEEPER = [step(0, 3), step(1, 2), step(0, 1)]
const IN_BOX = [step(1), step(0, 2)]

/** An input handler with the caret, a cell block or a selected table at `where`. */
function handler(where: Where, wasm: Record<string, unknown> = {}) {
  const path = where.path
  const position = {
    sectionIndex: 0,
    paragraphIndex: 0,
    charOffset: 0,
    parentParaIndex: path ? 4 : undefined,
    controlIndex: path ? path[0].controlIndex : undefined,
    cellIndex: path ? path[path.length - 1].cellIndex : undefined,
    cellParaIndex: path ? 0 : undefined,
    cellPath: path,
    isTextBox: where.textBox ? true : undefined,
  }
  const ci = path ? path[0].controlIndex : 0
  const ref = { sec: 0, ppi: 4, ci, ...(path && path.length > 1 ? { cellPath: path } : {}) }
  const cursor = {
    getPosition: () => position,
    isInCell: () => path !== undefined,
    isInTextBox: () => where.textBox === true,
    isInHeaderFooter: () => where.header === true,
    isInFootnote: () => where.footnote === true,
    isInCellSelectionMode: () => where.block === true,
    isInTableObjectSelection: () => where.object === true,
    getCellTableContext: () => (path ? { sec: 0, ppi: 4, ci, cellPath: path } : null),
    getSelectedTableRef: () => (where.object ? ref : null),
  }
  const operations: unknown[] = []
  return {
    cursor,
    wasm,
    operations,
    getCursorPosition: () => position,
    getSelectedTableRef: cursor.getSelectedTableRef,
    executeOperation: (desc: unknown) => operations.push(desc),
  }
}

const servicesAt = (where: Where, wasm: Record<string, unknown> = {}) => {
  const ih = handler(where, wasm)
  return { wasm, getInputHandler: () => ih }
}

const REFUSED = [...NESTED_TABLE_EDITS, ...NESTED_TABLE_LATER]

describe('where a table command would reach the outer table', () => {
  it('is nowhere for a table in the body', () => {
    expect(nestedTableAt(handler({ path: BODY }))).toBeNull()
    expect(nestedTableAt(handler({ path: BODY, block: true }))).toBeNull()
    expect(nestedTableAt(handler({ path: BODY, object: true }))).toBeNull()
    // a caret outside any table, and a depth-1 caret written without a path
    expect(nestedTableAt(handler({}))).toBeNull()
    const flat = handler({ path: BODY })
    flat.cursor.getPosition().cellPath = undefined
    expect(nestedTableAt(flat)).toBeNull()
  })

  it('is a table inside a cell, at any depth', () => {
    expect(nestedTableAt(handler({ path: NESTED }))).toBe('cell')
    expect(nestedTableAt(handler({ path: DEEPER }))).toBe('cell')
    expect(nestedTableAt(handler({ path: NESTED, block: true }))).toBe('cell')
    expect(nestedTableAt(handler({ path: NESTED, object: true }))).toBe('cell')
  })

  it('is a table inside a text box, but not the text box itself', () => {
    expect(nestedTableAt(handler({ path: [step(1)], textBox: true }))).toBeNull()
    expect(nestedTableAt(handler({ path: IN_BOX, textBox: true }))).toBe('textBox')
    expect(nestedTableAt(handler({ path: IN_BOX, textBox: true, object: true }))).toBe('textBox')
  })

  it('leaves the tables of headers, footers and notes as they were', () => {
    expect(nestedTableAt(handler({ path: NESTED, header: true }))).toBeNull()
    expect(nestedTableAt(handler({ path: NESTED, footnote: true }))).toBeNull()
  })

  it('names the inner table by the outer numbers and the path that ends at it', () => {
    expect(innerTableTarget(handler({ path: DEEPER }))).toMatchObject({
      sec: 0,
      ppi: 4,
      ci: 0,
      // the steps down, and the table's own control with no cell
      path: [step(0, 3), step(1, 2), step(0)],
      where: 'cell',
    })
    expect(innerTableTarget(handler({ path: IN_BOX, textBox: true }))).toMatchObject({
      ci: 1,
      path: [step(1), step(0)],
      where: 'textBox',
    })
    expect(innerTableTarget(handler({ path: BODY }))).toBeNull()
  })
})

describe('a table command in a table inside a cell or a text box', () => {
  it('runs an editing command with services that reach the inner table, without a word', () => {
    const showToast = vi.fn()
    hancomCommands('en', { showToast })
    for (const id of NESTED_TABLE_EDITS) {
      const where = id === 'format:object-properties' ? { object: true } : {}
      for (const at of [
        { path: NESTED, ...where },
        { path: NESTED, block: true, ...where },
        { path: IN_BOX, textBox: true, ...where },
      ]) {
        const scoped = nestedTableCommand(id, servicesAt(at))
        expect(scoped, id).toBeTruthy()
        const target = innerTableOf((scoped as { wasm: unknown }).wasm)
        expect(target?.path, id).toEqual([...at.path.slice(0, -1), step(0)])
        expect(innerTableOf((scoped as { getInputHandler(): unknown }).getInputHandler())).toBe(
          target,
        )
      }
    }
    expect(showToast).not.toHaveBeenCalled()
  })

  it('refuses the commands that cannot reach it yet, with the reason', () => {
    const showToast = vi.fn()
    hancomCommands('en', { showToast })
    for (const id of NESTED_TABLE_LATER) {
      showToast.mockClear()
      expect(nestedTableCommand(id, servicesAt({ path: NESTED })), id).toBe(false)
      expect(showToast, id).toHaveBeenCalledWith({
        message: 'This cannot be done in a table inside a table yet.',
      })
    }
  })

  it('names a table inside a text box as such, in Korean too', () => {
    const showToast = vi.fn()
    hancomCommands('ko', { showToast })
    const inBox = servicesAt({ path: IN_BOX, textBox: true })
    expect(nestedTableCommand('table:split', inBox)).toBe(false)
    expect(showToast).toHaveBeenCalledWith({
      message: '글상자 안의 표에서는 아직 할 수 없습니다.',
    })
    showToast.mockClear()
    expect(nestedTableCommand('table:formula', servicesAt({ path: NESTED }))).toBe(false)
    expect(showToast).toHaveBeenCalledWith({ message: '표 안의 표에서는 아직 할 수 없습니다.' })
    hancomCommands('en', { showToast: vi.fn() })
  })

  it('lets a table in the body take every command as before', () => {
    const showToast = vi.fn()
    hancomCommands('en', { showToast })
    for (const id of REFUSED) {
      expect(nestedTableCommand(id, servicesAt({ path: BODY })), id).toBeNull()
      expect(nestedTableCommand(id, servicesAt({ path: BODY, block: true })), id).toBeNull()
      expect(nestedTableCommand(id, servicesAt({ path: BODY, object: true })), id).toBeNull()
    }
    expect(showToast).not.toHaveBeenCalled()
  })

  it('keeps out of what already works or refuses on its own', () => {
    for (const id of [
      'table:delete',
      'table:create',
      'table:block-sum',
      'ieum:table-auto-fill',
      'edit:paste',
      'edit:copy',
      'format:bold',
    ]) {
      expect(nestedTableCommand(id, servicesAt({ path: NESTED })), id).toBeNull()
    }
    // object properties of a picture in an inner cell are the picture's
    expect(nestedTableCommand('format:object-properties', servicesAt({ path: NESTED }))).toBeNull()
  })

  it('lists every 4.2 input among the editing commands and the rest apart', () => {
    for (const id of [
      'table:insert-row-col',
      'table:delete-row-col',
      'table:insert-row-above',
      'table:insert-row-below',
      'table:insert-col-left',
      'table:insert-col-right',
      'table:delete-row',
      'table:delete-col',
      'ieum:table-insert-row-below',
      'table:cell-merge',
      'table:cell-split',
      'ieum:cell-border-each',
      'ieum:cell-background-each',
      'ieum:cell-border-one',
      'ieum:cell-background-one',
      'table:cell-props',
      'format:object-properties',
      'ieum:table-border-each',
      'ieum:table-border-background',
      'table:cell-height-equal',
      'table:cell-width-equal',
      'ieum:table-block-resize',
      'ieum:table-row-column-resize',
      'ieum:table-cell-resize',
      'ieum:table-resize',
    ]) {
      expect(NESTED_TABLE_EDITS, id).toContain(id)
    }
    for (const id of [
      'table:split',
      'table:attach',
      'table:caption-toggle',
      'table:formula',
      'table:block-formula',
      'table:thousand-sep',
      'table:decimal-add',
      'table:decimal-remove',
      'table:transpose-copy',
      'table:transpose-paste',
      'ieum:table-transpose',
      'ieum:table-order',
      'ieum:table-wrap',
    ]) {
      expect(NESTED_TABLE_LATER, id).toContain(id)
    }
    expect(NESTED_TABLE_EDITS.filter((id) => NESTED_TABLE_LATER.includes(id))).toEqual([])
  })

  it('names only commands the app registers', () => {
    const own = new Set(hancomCommands('en').map((command) => command.id))
    for (const id of REFUSED.filter((id) => id.startsWith('ieum:'))) {
      expect(own.has(id), id).toBe(true)
    }
  })
})

/** A bridge that records its calls and answers with what `answers` says. */
function recordingBridge(answers: Record<string, (...args: unknown[]) => unknown> = {}) {
  const calls: [string, ...unknown[]][] = []
  const bridge = new Proxy({} as Record<string, unknown>, {
    get(_, prop) {
      if (typeof prop !== 'string') return undefined
      return (...args: unknown[]) => {
        calls.push([prop, ...args])
        return answers[prop]?.(...args) ?? { ok: true }
      }
    },
  })
  return { bridge, calls }
}

const TARGET = () => ({
  sec: 0,
  ppi: 4,
  ci: 0,
  path: [step(0, 3, 1), step(2)],
  where: 'cell',
  told: false,
})
const TABLE_JSON = JSON.stringify([step(0, 3, 1), step(2)])
const cellJson = (cell: number, para = 0) => JSON.stringify([step(0, 3, 1), step(2, cell, para)])

describe('the bridge for a table inside a cell', () => {
  it('sends flat table calls named by the outer numbers to the inner table’s path calls', () => {
    const { bridge, calls } = recordingBridge({
      getTableDimensionsByPath: () => ({ rowCount: 3, colCount: 2, cellCount: 6 }),
    })
    const view = innerTableBridge(bridge, TARGET())
    view.insertTableRow(0, 4, 0, 1, true)
    view.insertTableColumn(0, 4, 0, 1, false)
    view.deleteTableRow(0, 4, 0, 2)
    view.deleteTableColumn(0, 4, 0, 0)
    view.mergeTableCells(0, 4, 0, 0, 0, 1, 1)
    view.splitTableCellInto(0, 4, 0, 1, 1, 2, 3, true, false)
    view.splitTableCellsInRange(0, 4, 0, 0, 0, 1, 1, 2, 2, false)
    view.getCellInfo(0, 4, 0, 5)
    view.getCellProperties(0, 4, 0, 5)
    view.getCellOwnProperties(0, 4, 0, 5)
    view.setCellProperties(0, 4, 0, 5, { fillType: 'none' })
    view.setCellZoneProperties(0, 4, 0, { startRow: 0 }, { fillType: 'none' })
    view.getTableProperties(0, 4, 0)
    view.setTableProperties(0, 4, 0, { cellSpacing: 0 })
    view.resizeTableCells(0, 4, 0, [{ cellIdx: 1, widthDelta: 300 }])
    view.resizeTableCell(0, 4, 0, 1, 1, false, true)
    view.setTableCellExtents(0, 4, 0, true, [{ cellIdx: 0, start: 0, end: 10 }])
    view.getCellParagraphLength(0, 4, 0, 5, 2)
    view.getTextInCell(0, 4, 0, 5, 2, 0, 9)
    expect(calls.filter(([name]) => !name.startsWith('getTableDimensions'))).toEqual([
      ['insertTableRowByPath', 0, 4, TABLE_JSON, 1, true],
      ['insertTableColumnByPath', 0, 4, TABLE_JSON, 1, false],
      ['deleteTableRowByPath', 0, 4, TABLE_JSON, 2],
      ['deleteTableColumnByPath', 0, 4, TABLE_JSON, 0],
      ['mergeTableCellsByPath', 0, 4, TABLE_JSON, 0, 0, 1, 1],
      ['splitTableCellIntoByPath', 0, 4, TABLE_JSON, 1, 1, 2, 3, true, false],
      ['splitTableCellsInRangeByPath', 0, 4, TABLE_JSON, 0, 0, 1, 1, 2, 2, false],
      ['getCellInfoByPath', 0, 4, cellJson(5)],
      ['getCellPropertiesByPath', 0, 4, TABLE_JSON, 5],
      ['getCellOwnPropertiesByPath', 0, 4, TABLE_JSON, 5],
      ['setCellPropertiesByPath', 0, 4, TABLE_JSON, 5, { fillType: 'none' }],
      ['setCellZonePropertiesByPath', 0, 4, TABLE_JSON, { startRow: 0 }, { fillType: 'none' }],
      ['getTablePropertiesByPath', 0, 4, TABLE_JSON],
      ['setTablePropertiesByPath', 0, 4, TABLE_JSON, { cellSpacing: 0 }],
      ['resizeTableCellsByPath', 0, 4, TABLE_JSON, [{ cellIdx: 1, widthDelta: 300 }]],
      ['resizeTableCellByPath', 0, 4, TABLE_JSON, 1, 1, false, true],
      ['setTableCellExtentsByPath', 0, 4, TABLE_JSON, true, [{ cellIdx: 0, start: 0, end: 10 }]],
      ['getCellParagraphLengthByPath', 0, 4, cellJson(5, 2)],
      ['getTextInCellByPath', 0, 4, cellJson(5, 2), 0, 9],
    ])
    expect(innerTableOf(view)).toMatchObject({ path: TARGET().path })
  })

  it('leaves calls on other tables, and calls that name no table, to the bridge', () => {
    const { bridge, calls } = recordingBridge()
    const view = innerTableBridge(bridge, TARGET())
    view.insertTableRow(0, 7, 0, 1, true)
    view.getCellInfo(0, 4, 1, 0)
    view.getParagraphCount(0)
    view.runInBatch(() => 1)
    expect(calls).toEqual([
      ['insertTableRow', 0, 7, 0, 1, true],
      ['getCellInfo', 0, 4, 1, 0],
      ['getParagraphCount', 0],
      ['runInBatch', expect.any(Function)],
    ])
    expect(innerTableOf(bridge)).toBeNull()
  })

  it('refuses a flat edit that has no path call, with the reason, where it would hit the outer table', () => {
    const showToast = vi.fn()
    hancomCommands('en', { showToast })
    const { bridge, calls } = recordingBridge()
    const view = innerTableBridge(bridge, TARGET())
    for (const name of [
      'splitTable',
      'evaluateTableFormula',
      'insertTextInCell',
      'moveTableOffset',
    ]) {
      expect(() => view[name](0, 4, 0, 0), name).toThrow()
    }
    expect(calls).toEqual([])
    // told once per command
    expect(showToast).toHaveBeenCalledTimes(1)
    view.splitTable(0, 9, 0, 1)
    expect(calls).toEqual([['splitTable', 0, 9, 0, 1]])
  })

  it('keeps the last row and column quietly, as in a body table', () => {
    const showToast = vi.fn()
    hancomCommands('en', { showToast })
    const { bridge, calls } = recordingBridge({
      getTableDimensionsByPath: () => ({ rowCount: 1, colCount: 1, cellCount: 1 }),
    })
    const view = innerTableBridge(bridge, TARGET())
    expect(() => view.deleteTableRow(0, 4, 0, 0)).toThrow()
    expect(() => view.deleteTableColumn(0, 4, 0, 0)).toThrow()
    expect(calls.map(([name]) => name)).toEqual([
      'getTableDimensionsByPath',
      'getTableDimensionsByPath',
    ])
    expect(showToast).not.toHaveBeenCalled()
  })

  it('tells why when the engine refuses the inner table, and only then', () => {
    const showToast = vi.fn()
    hancomCommands('ko', { showToast })
    const refuse = (message: string) => () => {
      throw `렌더링 오류: ${message}`
    }
    const { bridge } = recordingBridge({
      insertTableRowByPath: refuse('칸 테두리를 개체로 그린 안쪽 표는 아직 고칠 수 없습니다'),
      mergeTableCellsByPath: refuse('셀 (0,0) span (2,2)이 병합 범위를 벗어납니다'),
    })
    const target = TARGET()
    const view = innerTableBridge(bridge, target)
    expect(() => view.mergeTableCells(0, 4, 0, 0, 0, 0, 1)).toThrow()
    expect(showToast).not.toHaveBeenCalled()
    expect(() => view.insertTableRow(0, 4, 0, 0, true)).toThrow()
    expect(showToast).toHaveBeenCalledWith({ message: '표 안의 표에서는 아직 할 수 없습니다.' })
    hancomCommands('en', { showToast: vi.fn() })
  })
})

describe('an edit through the services for an inner table', () => {
  /** Services at the caret in cell 5 of the inner table of NESTED, over a recording bridge. */
  function scoped(dims = { rowCount: 3, colCount: 2, cellCount: 6 }) {
    const { bridge, calls } = recordingBridge({
      getTableDimensionsByPath: () => dims,
      getCellInfoByPath: () => ({ row: 2, col: 1, rowSpan: 1, colSpan: 1 }),
      getCellParagraphCountByPath: () => 1,
      getCellParagraphLengthByPath: () => 4,
      getTableCellBboxesByPath: () => [
        { cellIdx: 0, row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        { cellIdx: 1, row: 0, col: 1, rowSpan: 1, colSpan: 1 },
        { cellIdx: 2, row: 1, col: 0, rowSpan: 1, colSpan: 2 },
      ],
    })
    const services = servicesAt({ path: NESTED }, bridge)
    const ih = services.getInputHandler()
    const target = innerTableTarget(ih)!
    return { inner: innerTableServices(services, target), ih, calls }
  }

  it('reads the caret as a cell of the inner table', () => {
    const { inner } = scoped()
    const pos = inner.getInputHandler().getCursorPosition()
    expect(pos).toMatchObject({
      parentParaIndex: 4,
      controlIndex: 0,
      cellIndex: 5,
      cellPath: NESTED,
    })
  })

  it('makes an edit one snapshot on the inner table, and settles the caret in it', () => {
    const { inner, ih, calls } = scoped()
    const sih = inner.getInputHandler()
    sih.executeOperation({
      kind: 'snapshot',
      operationType: 'insertTableRow',
      operation: (wasm: { insertTableRow(...a: unknown[]): unknown }) => {
        wasm.insertTableRow(0, 4, 0, 2, true)
        // a command that moves the caret by its cell number only
        return { ...sih.getCursorPosition(), cellIndex: 1 }
      },
    })
    expect(ih.operations).toHaveLength(1)
    const desc = ih.operations[0] as { kind: string; operation(b: unknown): unknown }
    expect(desc.kind).toBe('snapshot')
    const raw = recordingBridge({
      getTableDimensionsByPath: () => ({ rowCount: 4, colCount: 2, cellCount: 8 }),
      getCellInfoByPath: () => ({ row: 2, col: 1, rowSpan: 1, colSpan: 1 }),
      getCellParagraphCountByPath: () => 1,
      getCellParagraphLengthByPath: () => 0,
    })
    const after = desc.operation(raw.bridge) as { cellIndex: number; cellPath: Step[] }
    expect(raw.calls.map(([name]) => name)).toContain('insertTableRowByPath')
    expect(raw.calls.map(([name]) => name)).not.toContain('insertTableRow')
    // the path follows the cell number the command gave
    expect(after.cellIndex).toBe(1)
    expect(after.cellPath).toEqual([step(0, 3), step(0, 1)])
    expect(calls).toEqual([])
  })

  it('puts a caret whose cell is gone into the cell now at its row and column', () => {
    const { inner, ih } = scoped()
    inner.getInputHandler().executeOperation({
      kind: 'snapshot',
      operationType: 'deleteTableRow',
      operation: (wasm: unknown) => {
        void wasm
        return inner.getInputHandler().getCursorPosition()
      },
    })
    const desc = ih.operations[0] as { operation(b: unknown): unknown }
    const raw = recordingBridge({
      getTableDimensionsByPath: () => ({ rowCount: 2, colCount: 2, cellCount: 3 }),
      // before the edit the caret's cell 5 was at row 2, column 1
      getCellInfoByPath: () => ({ row: 2, col: 1, rowSpan: 1, colSpan: 1 }),
      getCellParagraphCountByPath: () => 1,
      getCellParagraphLengthByPath: () => 0,
      getTableCellBboxesByPath: () => [
        { cellIdx: 0, row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        { cellIdx: 1, row: 0, col: 1, rowSpan: 1, colSpan: 1 },
        { cellIdx: 2, row: 1, col: 0, rowSpan: 1, colSpan: 2 },
      ],
    })
    const after = desc.operation(raw.bridge) as { cellIndex: number; cellPath: Step[] }
    expect(after.cellIndex).toBe(2)
    expect(after.cellPath).toEqual([step(0, 3), step(0, 2)])
  })

  it('runs a command object inside one snapshot, and lets it drop its own undo record', () => {
    const { inner, ih } = scoped()
    const command = {
      type: 'setCellBorderFill',
      execute: vi.fn((wasm: { setCellProperties(...a: unknown[]): unknown }) => {
        wasm.setCellProperties(0, 4, 0, 5, { fillType: 'solid' })
        return inner.getInputHandler().getCursorPosition()
      }),
      discard: vi.fn(),
      isNoOp: () => false,
    }
    inner.getInputHandler().executeOperation({ kind: 'command', command })
    const desc = ih.operations[0] as {
      kind: string
      operationType: string
      operation(b: unknown): unknown
    }
    expect(desc).toMatchObject({ kind: 'snapshot', operationType: 'setCellBorderFill' })
    const raw = recordingBridge({
      getTableDimensionsByPath: () => ({ rowCount: 3, colCount: 2, cellCount: 6 }),
      getCellInfoByPath: () => ({ row: 2, col: 1, rowSpan: 1, colSpan: 1 }),
      getCellParagraphCountByPath: () => 1,
      getCellParagraphLengthByPath: () => 0,
    })
    desc.operation(raw.bridge)
    expect(raw.calls.map(([name]) => name)).toContain('setCellPropertiesByPath')
    expect(command.discard).toHaveBeenCalledTimes(1)
  })
})

describe('moving a selected table inside a cell', () => {
  const arrow = (key: string, init: Partial<KeyboardEvent> = {}) => ({
    key,
    code: key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    preventDefault: vi.fn(),
    ...init,
  })

  it('stops the arrow with the reason, where the studio would move the outer table', () => {
    const showToast = vi.fn()
    hancomCommands('en', { showToast })
    const ih = { ...handler({ path: NESTED, object: true }), dispatcher: { dispatch: vi.fn() } }
    const e = arrow('ArrowLeft')
    expect(hancomTableObjectKey(ih, e)).toBe(true)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(ih.dispatcher.dispatch).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith({
      message: 'This cannot be done in a table inside a table yet.',
    })
  })

  it('leaves the arrow to the studio for a table in the body', () => {
    const showToast = vi.fn()
    hancomCommands('en', { showToast })
    const ih = { ...handler({ path: BODY, object: true }), dispatcher: { dispatch: vi.fn() } }
    expect(hancomTableObjectKey(ih, arrow('ArrowLeft'))).toBe(false)
    expect(showToast).not.toHaveBeenCalled()
  })
})

describe('the inner-table patches', () => {
  const dispatcher = [
    "import type { CommandResult, CommandServices, EditorContext } from './types';",
    '',
    '    const ctx = this.services.getContext();',
    '    if (isBlockedInFormMode(commandId, ctx)) {',
    "      return { ok: false, reason: 'blocked-in-form-mode' };",
    '    }',
    '    if (def.canExecute && !def.canExecute(ctx)) {',
    '      // canExecute 실패 — 비활성 상태',
    "      return { ok: false, reason: 'disabled' };",
    '    }',
    '',
    '    try {',
    '      def.execute(this.services, params);',
    '',
  ].join('\n')

  it('ask the module before a command runs, and run it with what the module hands back', () => {
    const patched = applyPatch('studio-nested-table-dispatch', dispatcher)
    expect(patched).toContain(`import { nestedTableCommand } from '${HANCOM_KEYS_MODULE}';`)
    const asked = patched.indexOf('nestedTableCommand(commandId, this.services)')
    expect(asked).toBeGreaterThan(patched.indexOf('def.canExecute(ctx)'))
    expect(asked).toBeLessThan(patched.indexOf('def.execute(nested ?? this.services, params)'))
    expect(patched).not.toContain('def.execute(this.services, params)')
  })

  it('give the bridge the path calls of engine patch 0055', () => {
    const bridge = [
      '  getTableDimensionsByPath(sec: number, parentPara: number, pathJson: string): TableDimensions {',
      '    return {};',
      '  }',
    ].join('\n')
    const patched = applyPatch('studio-nested-table-path-calls', bridge)
    for (const name of [
      'insertTableRowByPath',
      'insertTableColumnByPath',
      'deleteTableRowByPath',
      'deleteTableColumnByPath',
      'mergeTableCellsByPath',
      'splitTableCellByPath',
      'splitTableCellIntoByPath',
      'splitTableCellsInRangeByPath',
      'getCellOwnPropertiesByPath',
      'setCellPropertiesByPath',
      'setCellZonePropertiesByPath',
      'applyCellBorderFillIdsByPath',
      'getTablePropertiesByPath',
      'setTablePropertiesByPath',
      'resizeTableCellByPath',
      'setTableCellExtentsByPath',
    ]) {
      expect(patched, name).toContain(`  ${name}(`)
      expect(patched, name).toContain(`this.doc.${name}(`)
    }
    expect(patched.endsWith(bridge)).toBe(true)
  })

  it('send Tab in an inner table’s last cell to the module, and treat a table in a text box as a table', () => {
    const keyboard = [
      'function insertRowAfterLastTableCellByTab(this: any): boolean {',
      '  if (isNestedCellPosition(pos)) return false;',
      '}',
      '    if (this.cursor.isInCell() && !this.cursor.isInTextBox()) {',
      '      if (this.cursor.isInCellSelectionMode()) {',
      '      if (this.cursor.isInCell() && !this.cursor.isInTextBox()) {',
      '        if (e.shiftKey) {',
      '          this.cursor.moveToCellPrev();',
    ].join('\n')
    const patched = applyPatch('studio-nested-table-keys', keyboard)
    expect(patched).toContain(`import { innerTableTabRow } from '${HANCOM_KEYS_MODULE}';`)
    expect(patched).toContain('if (isNestedCellPosition(pos)) return innerTableTabRow(this);')
    expect(patched.split('this.cursor.nestingDepth() > 1')).toHaveLength(3)
    const cursor = applyPatch(
      'studio-textbox-table-cell-block',
      [
        "  enterCellSelectionMode(reason: CellSelectionReason = 'manual'): boolean {",
        '    if (!this.isInCell() || this.isInTextBox()) return false;',
      ].join('\n'),
    )
    expect(cursor).toContain('(this.isInTextBox() && this.nestingDepth() < 2)')
    const mouse = applyPatch(
      'studio-textbox-table-context-menu',
      '    inTable = hit.parentParaIndex !== undefined && !hit.isTextBox;',
    )
    expect(mouse).toContain('(!hit.isTextBox || (hit.cellPath?.length ?? 0) > 1)')
  })

  it('keep a selected table inside a cell from being dragged by the outer numbers', () => {
    const mouse = [
      '    const ref = this.cursor.getSelectedTableRef();',
      '    if (ref && e.button === 0) {',
      '      const zoom = this.viewportManager.getZoom();',
      '',
    ].join('\n')
    const patched = applyPatch('studio-nested-table-move-drag', mouse)
    expect(patched).toContain('if (ref && e.button === 0 && (ref.cellPath?.length ?? 0) < 2) {')
  })

  it('fail when their text is gone, and are all in the studio build', () => {
    for (const name of [
      'studio-nested-table-dispatch',
      'studio-nested-table-path-calls',
      'studio-nested-table-keys',
      'studio-textbox-table-cell-block',
      'studio-textbox-table-context-menu',
      'studio-nested-table-move-drag',
    ] as const) {
      expect(() => applyPatch(name, 'export class X {}'), name).toThrow(/rhwp patch/)
      expect(STUDIO_PATCHES, name).toContain(name)
    }
  })
})

describe('the patched studio dispatcher, from the source the build fetched', () => {
  const core = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'vendor', 'rhwp-core', 'package.json'), 'utf8'),
  )
  const studio = join(
    __dirname,
    '..',
    'node_modules',
    '.cache',
    'rhwp-studio',
    core.rhwp.tag,
    'rhwp-studio',
  )
  const source = join(studio, 'src', 'command', 'dispatcher.ts')
  const scratch = existsSync(source) ? mkdtempSync(join(tmpdir(), 'ieum-dispatcher-')) : null
  afterAll(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  })

  /** The studio's dispatcher with the build's patches, importing the app's module from its file. */
  async function patchedDispatcher() {
    let code = readFileSync(source, 'utf8')
    for (const name of STUDIO_PATCHES) {
      if (patchTargets(name, source)) code = applyPatch(name, code)
    }
    const module = pathToFileURL(join(__dirname, '..', 'studio-plugin', 'hancom-keys.mjs')).href
    code = code.replaceAll(`'${HANCOM_KEYS_MODULE}'`, `'${module}'`)
    const file = join(scratch!, `dispatcher-${Date.now()}.ts`)
    writeFileSync(file, code)
    return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
      CommandDispatcher: new (
        registry: { get(id: string): unknown },
        services: unknown,
        eventBus: { emit(name: string): void },
      ) => {
        dispatchWithResult(id: string): { ok: boolean; reason?: string }
      }
    }
  }

  interface StudioLikeServices {
    wasm: { insertTableRow(...args: unknown[]): unknown }
    getInputHandler(): {
      getCursorPosition(): { sectionIndex: number; parentParaIndex?: number; controlIndex?: number }
    }
  }

  /** Every listed command, each adding a row to the table its numbers name through the bridge. */
  function commands() {
    const defs = new Map(
      REFUSED.map((id) => [
        id,
        {
          id,
          canExecute: () => true,
          execute: (services: StudioLikeServices) => {
            const at = services.getInputHandler().getCursorPosition()
            services.wasm.insertTableRow(
              at.sectionIndex,
              at.parentParaIndex,
              at.controlIndex,
              0,
              true,
            )
          },
        },
      ]),
    )
    return { get: (id: string) => defs.get(id) }
  }

  it.skipIf(!existsSync(source))(
    'runs the editing commands on the inner table, refuses the rest there, and runs all on a body table',
    async () => {
      const { CommandDispatcher } = await patchedDispatcher()
      hancomCommands('en', { showToast: vi.fn() })
      for (const id of REFUSED) {
        const edit = NESTED_TABLE_EDITS.includes(id)
        const object = id === 'format:object-properties'
        for (const [where, expected] of [
          [{ path: NESTED, object }, edit ? 'inner' : 'none'],
          [{ path: IN_BOX, textBox: true, object }, edit ? 'inner' : 'none'],
          [{ path: NESTED, block: true, object }, edit ? 'inner' : 'none'],
          [{ path: BODY, object }, 'flat'],
        ] as [Where, string][]) {
          const { bridge, calls } = recordingBridge()
          const services = {
            ...servicesAt(where, bridge),
            getContext: () => ({ isFormMode: false }),
          }
          const result = new CommandDispatcher(commands(), services, {
            emit: () => {},
          }).dispatchWithResult(id)
          const label = `${id} ${JSON.stringify(where)}`
          expect(result.ok, label).toBe(expected !== 'none')
          expect(
            calls.map(([name]) => name),
            label,
          ).toEqual(
            expected === 'inner'
              ? ['insertTableRowByPath']
              : expected === 'flat'
                ? ['insertTableRow']
                : [],
          )
        }
      }
    },
    60_000,
  )

  it.skipIf(!existsSync(source))('names only commands the studio has', () => {
    const sources = ['table.ts', 'format.ts']
      .map((file) => readFileSync(join(studio, 'src', 'command', 'commands', file), 'utf8'))
      .join('\n')
    for (const id of REFUSED.filter((id) => !id.startsWith('ieum:'))) {
      expect(sources, id).toContain(`'${id}'`)
    }
  })
})
