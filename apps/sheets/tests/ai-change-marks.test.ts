/**
 * The grid marks over what the last AI run changed: which places a plan
 * marks, how they become canvas rectangles, when they go, and that they stay
 * a screen-only paint (no model write, no printing pass).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChangePlan } from '@genoffice/xlsx-gateway/domain/workbook.types'

import {
  AiChangeMarksExtension,
  currentMarkRanges,
  installAiChangeMarks,
  joinCells,
  markRects,
  mergeMarkRanges,
  planMarkRanges,
} from '../src/renderer/ai-change-marks'
import { journalSuppression } from '../src/renderer/univer-state'

const cell = (sheetId: string, address: string, value: string | null) => ({
  sheetId,
  address,
  before: { value: 'old' },
  after: { value },
})

const plan = (parts: Partial<ChangePlan>): ChangePlan => ({
  transactionId: 't',
  baseRevision: 0,
  cellChanges: [],
  sheetRenames: [],
  structuralChanges: [],
  formatChanges: [],
  warnings: [],
  ...parts,
})

const cellAt = (row: number, column: number) => ({
  startX: column * 10,
  endX: (column + 1) * 10,
  startY: row * 20,
  endY: (row + 1) * 20,
})

describe('planMarkRanges', () => {
  it('marks written cells as blocks, formatted ranges, and filled or sorted ranges', () => {
    const ranges = planMarkRanges(
      plan({
        cellChanges: [
          cell('sheet-1', 'B2', 'x'),
          cell('sheet-1', 'B3', 'y'),
          cell('sheet-1', 'C2', 'z'),
          cell('sheet-1', 'C3', 'w'),
          cell('sheet-2', 'A1', '1'),
        ],
        formatChanges: [{ sheetId: 'sheet-1', range: 'E1:F4', format: {}, label: 'bold' }],
        structuralChanges: [
          {
            op: { op: 'fill_range', sheetId: 'sheet-1', source: 'A1', target: 'A1:A9' },
            label: 'fill',
          },
          { op: { op: 'insert_rows', sheetId: 'sheet-1', row: 3, count: 1 }, label: 'rows' },
        ] as ChangePlan['structuralChanges'],
      }),
    )
    expect(ranges.get('sheet-1')).toEqual([
      { startRow: 0, endRow: 3, startColumn: 4, endColumn: 5 },
      { startRow: 0, endRow: 8, startColumn: 0, endColumn: 0 },
      { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 },
    ])
    expect(ranges.get('sheet-2')).toEqual([
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
    ])
  })

  it('leaves cleared cells unmarked: a deletion needs no mark', () => {
    const ranges = planMarkRanges(
      plan({ cellChanges: [cell('sheet-1', 'A1', null), cell('sheet-1', 'A2', '')] }),
    )
    expect(ranges.size).toBe(0)
    const formula = planMarkRanges(
      plan({
        cellChanges: [
          {
            sheetId: 's',
            address: 'A1',
            before: { value: 1 },
            after: { value: '', formula: '=1' },
          },
        ],
      }),
    )
    expect(formula.get('s')).toHaveLength(1)
  })

  it('joins row runs and equal runs on following rows', () => {
    expect(
      joinCells([
        { row: 0, column: 0 },
        { row: 0, column: 1 },
        { row: 1, column: 0 },
        { row: 1, column: 1 },
        { row: 3, column: 0 },
      ]),
    ).toEqual([
      { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 },
      { startRow: 3, endRow: 3, startColumn: 0, endColumn: 0 },
    ])
  })

  it('adds the places of several plans of one run', () => {
    const a = new Map([['s', [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }]]])
    const b = new Map([['s', [{ startRow: 1, endRow: 1, startColumn: 0, endColumn: 0 }]]])
    expect(mergeMarkRanges(a, b).get('s')).toHaveLength(2)
  })
})

describe('markRects', () => {
  it('draws only the visible part of each range, once per viewport', () => {
    const rects = markRects(
      [
        { startRow: 0, endRow: 99, startColumn: 1, endColumn: 1 },
        { startRow: 500, endRow: 500, startColumn: 0, endColumn: 0 },
      ],
      [{ startRow: 10, endRow: 19, startColumn: 0, endColumn: 5 }],
      cellAt,
    )
    expect(rects).toEqual([{ left: 10, top: 200, width: 10, height: 200 }])
  })
})

function fakeRuntime() {
  const handlers: ((event: { id: string }) => void)[] = []
  const makeDirty = vi.fn()
  const executeCommand = vi.fn()
  const runtime = {
    univerAPI: {
      Event: { CommandExecuted: 'command-executed' },
      getActiveWorkbook: () => ({ getId: () => 'file-abc' }),
      addEvent: vi.fn((_event: string, handler: (event: { id: string }) => void) => {
        handlers.push(handler)
        return { dispose: vi.fn() }
      }),
      executeCommand,
    },
    univer: {
      __getInjector: () => ({
        get: () => ({
          getRenderById: () => ({ mainComponent: { makeDirty }, scene: { makeDirty } }),
        }),
      }),
    },
  } as unknown as Parameters<typeof installAiChangeMarks>[0]
  const fire = (id: string) => {
    for (const handler of handlers) handler({ id })
  }
  return { runtime, fire, makeDirty, executeCommand }
}

const tokens = { '--color-ai-changed-bg': 'rgb(1 2 3)', '--color-ai-changed-line': 'rgb(4 5 6)' }

function stubTokens(): void {
  vi.stubGlobal('document', { documentElement: {} })
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => tokens[name as keyof typeof tokens] ?? '',
  }))
}

function drawOn(mode: string) {
  const fills: { style: string; rect: number[] }[] = []
  const canvas = {
    __mode: mode,
    fillStyle: '',
    save: vi.fn(),
    restore: vi.fn(),
    getScale: () => ({ scaleX: 1, scaleY: 1 }),
    fillRect(...rect: number[]) {
      fills.push({ style: this.fillStyle, rect })
    },
  }
  const skeleton = {
    worksheet: { getSheetId: () => 'sheet-1' },
    rowColumnSegment: { startRow: 0, endRow: 20, startColumn: 0, endColumn: 10 },
    getCellWithCoordByIndex: cellAt,
  }
  new AiChangeMarksExtension().draw(
    canvas as never,
    { scaleX: 1, scaleY: 1 },
    skeleton as never,
    undefined,
    {
      viewRanges: [{ startRow: 0, endRow: 20, startColumn: 0, endColumn: 10 }],
      viewportKey: 'VIEW_MAIN',
    },
  )
  return fills
}

const B2 = new Map([['sheet-1', [{ startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 }]]])

describe('installAiChangeMarks', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    journalSuppression.active = false
  })

  it('paints the shared mark tokens on screen and nothing in the printing pass', () => {
    stubTokens()
    const { runtime, makeDirty, executeCommand } = fakeRuntime()
    const handle = installAiChangeMarks(runtime, { onCleared: vi.fn() })
    handle.show(B2)
    expect(makeDirty).toHaveBeenCalled()
    // screen only: no command reaches the workbook (no style, no format, no undo entry)
    expect(executeCommand).not.toHaveBeenCalled()
    const fills = drawOn('normal')
    expect(fills[0]).toEqual({ style: 'rgb(1 2 3)', rect: [10, 20, 10, 20] })
    // the underline of .ai-changed-mark: 2px at the bottom of the place
    expect(fills[1]).toEqual({ style: 'rgb(4 5 6)', rect: [10, 38, 10, 2] })
    expect(drawOn('printing')).toEqual([])
    handle.dispose()
  })

  it('goes on clear, and tells the cards so', () => {
    stubTokens()
    const { runtime } = fakeRuntime()
    const onCleared = vi.fn()
    const handle = installAiChangeMarks(runtime, { onCleared })
    handle.show(B2)
    handle.clear()
    expect(currentMarkRanges().size).toBe(0)
    expect(drawOn('normal')).toEqual([])
    expect(onCleared).toHaveBeenCalledTimes(1)
    handle.clear()
    expect(onCleared).toHaveBeenCalledTimes(1)
    handle.dispose()
  })

  it('goes on undo, redo and rows or columns moving under it, but not on a value edit', () => {
    stubTokens()
    const { runtime, fire } = fakeRuntime()
    const onCleared = vi.fn()
    const handle = installAiChangeMarks(runtime, { onCleared })
    for (const id of [
      'univer.command.undo',
      'univer.command.redo',
      'sheet.mutation.insert-row',
      'sheet.mutation.remove-col',
    ]) {
      handle.show(B2)
      fire('sheet.mutation.set-range-values')
      expect(currentMarkRanges().size).toBe(1)
      fire(id)
      expect(currentMarkRanges().size, id).toBe(0)
    }
    expect(onCleared).toHaveBeenCalledTimes(4)
    handle.dispose()
  })

  it('keeps the marks through the AI’s own row edits and the app’s own installs', async () => {
    stubTokens()
    const { runtime, fire } = fakeRuntime()
    const handle = installAiChangeMarks(runtime, { onCleared: vi.fn() })
    handle.show(B2)
    let finish = (): void => undefined
    const applying = handle.holdDuring(new Promise<void>((resolve) => (finish = resolve)))
    fire('sheet.mutation.insert-row')
    expect(currentMarkRanges().size).toBe(1)
    finish()
    await applying
    journalSuppression.active = true
    fire('sheet.mutation.insert-row')
    expect(currentMarkRanges().size).toBe(1)
    journalSuppression.active = false
    fire('sheet.mutation.insert-row')
    expect(currentMarkRanges().size).toBe(0)
    handle.dispose()
  })
})
