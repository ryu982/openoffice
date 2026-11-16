import { describe, expect, it } from 'vitest'

import {
  createBufferedRange,
  scrollNeedsWindow,
  viewportLeadRange,
} from '../src/renderer/univer-sync'

const ROWS = 20_000
const COLUMNS = 60

function viewportAt(startRow: number, startColumn = 10) {
  return { startRow, endRow: startRow + 34, startColumn, endColumn: startColumn + 14 }
}

function scrollFrom(loadedAt: number, to: ReturnType<typeof viewportAt>) {
  return scrollNeedsWindow({
    viewport: to,
    resident: createBufferedRange(viewportAt(loadedAt), ROWS, COLUMNS),
    arriving: undefined,
    decorationsNeedPostIndexingRead: false,
    rowCount: ROWS,
    columnCount: COLUMNS,
  })
}

describe('scroll window', () => {
  it('keeps the loaded window while the viewport travels up to 60 rows either way', () => {
    expect(scrollFrom(1000, viewportAt(1003))).toBe(false)
    expect(scrollFrom(1000, viewportAt(1060))).toBe(false)
    expect(scrollFrom(1000, viewportAt(940))).toBe(false)
  })

  it('asks for a new window once the viewport has travelled past that', () => {
    expect(scrollFrom(1000, viewportAt(1061))).toBe(true)
    expect(scrollFrom(1000, viewportAt(939))).toBe(true)
  })

  it('keeps one more viewport of rows resident for a page-down at the travel limit', () => {
    const window = createBufferedRange(viewportAt(1000), ROWS, COLUMNS)
    const pagedDown = viewportAt(1060 + 35)
    expect(window.endRow).toBeGreaterThanOrEqual(pagedDown.endRow)
  })

  it('travels 6 columns sideways before asking', () => {
    expect(scrollFrom(1000, viewportAt(1000, 16))).toBe(false)
    expect(scrollFrom(1000, viewportAt(1000, 17))).toBe(true)
  })

  it('does not ask again while the arriving window will cover the viewport', () => {
    const input = {
      viewport: viewportAt(5003),
      resident: createBufferedRange(viewportAt(1000), ROWS, COLUMNS),
      decorationsNeedPostIndexingRead: false,
      rowCount: ROWS,
      columnCount: COLUMNS,
    }
    expect(scrollNeedsWindow({ ...input, arriving: undefined })).toBe(true)
    expect(
      scrollNeedsWindow({
        ...input,
        arriving: createBufferedRange(viewportAt(5000), ROWS, COLUMNS),
      }),
    ).toBe(false)
  })

  it('keeps reading while the sheet still waits for its decorations', () => {
    expect(
      scrollNeedsWindow({
        viewport: viewportAt(1000),
        resident: createBufferedRange(viewportAt(1000), ROWS, COLUMNS),
        arriving: undefined,
        decorationsNeedPostIndexingRead: true,
        rowCount: ROWS,
        columnCount: COLUMNS,
      }),
    ).toBe(true)
  })

  it('loads when nothing is resident yet', () => {
    expect(
      scrollNeedsWindow({
        viewport: viewportAt(0),
        resident: undefined,
        arriving: undefined,
        decorationsNeedPostIndexingRead: false,
        rowCount: ROWS,
        columnCount: COLUMNS,
      }),
    ).toBe(true)
  })

  it('never loads a narrower window than 80 rows and 8 columns around the viewport', () => {
    for (const rows of [5, 20, 35, 80, 200]) {
      const viewport = { startRow: 1000, endRow: 1000 + rows - 1, startColumn: 20, endColumn: 30 }
      const window = createBufferedRange(viewport, ROWS, COLUMNS)
      expect(viewport.startRow - window.startRow).toBeGreaterThanOrEqual(80)
      expect(window.endRow - viewport.endRow).toBeGreaterThanOrEqual(80)
      expect(viewport.startColumn - window.startColumn).toBe(8)
      expect(window.endColumn - viewport.endColumn).toBe(8)
    }
  })

  it('bounds the window on a viewport taller than the lead cap', () => {
    const viewport = { startRow: 1000, endRow: 1299, startColumn: 0, endColumn: 10 }
    const window = createBufferedRange(viewport, ROWS, COLUMNS)
    expect(viewport.startRow - window.startRow).toBe(140)
    expect(window.endRow - viewport.endRow).toBe(140)
  })

  it('clamps the lead and the window to the sheet', () => {
    const top = viewportAt(0, 0)
    expect(viewportLeadRange(top, ROWS, COLUMNS)).toMatchObject({ startRow: 0, startColumn: 0 })
    const bottom = { startRow: ROWS - 35, endRow: ROWS - 1, startColumn: 45, endColumn: 59 }
    const window = createBufferedRange(bottom, ROWS, COLUMNS)
    expect(window).toMatchObject({ endRow: ROWS - 1, endColumn: COLUMNS - 1 })
    expect(
      scrollNeedsWindow({
        viewport: bottom,
        resident: window,
        arriving: undefined,
        decorationsNeedPostIndexingRead: false,
        rowCount: ROWS,
        columnCount: COLUMNS,
      }),
    ).toBe(false)
  })
})
