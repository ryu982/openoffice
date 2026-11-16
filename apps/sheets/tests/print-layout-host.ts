// A sheets Print dialog host over a fake 6x4 sheet, for the print layout tests.
import { vi } from 'vitest'

import {
  createPrintPreviewHost,
  type PageLayoutContext,
  type PrintPreviewHost,
} from '../src/renderer/page-layout-actions'
import type { UniverRuntime } from '../src/renderer/univer-state'

export interface FakeRange {
  readonly row: number
  readonly column: number
  readonly width: number
  readonly height: number
}

/// A 6×4 sheet whose cells read `R<row>C<column>` (0-based), so the printed
/// HTML shows which cells a job took.
export function fakeWorksheet() {
  const cell = (row: number, column: number) => `R${row}C${column}`
  return {
    getSheetId: () => 'sheet-1',
    getSheetName: () => 'Sheet1',
    getLastRow: () => 5,
    getLastColumn: () => 3,
    getRowHeight: () => 20,
    getColumnWidth: () => 80,
    getMergedRanges: () => [],
    getRange: (row: number, column: number, numRows = 1, numColumns = 1) => {
      const grid = Array.from({ length: numRows }, (_, r) =>
        Array.from({ length: numColumns }, (_, c) => cell(row + r, column + c)),
      )
      return {
        getValues: () => grid,
        getDisplayValues: () => grid,
        getCellStyleData: () => null,
      }
    },
    getMaxRows: () => 100,
    getMaxColumns: () => 26,
    isSheetHidden: () => false,
  }
}

export function hostFor(selection: FakeRange | null, messages: string[] = []): PrintPreviewHost {
  const worksheet = fakeWorksheet()
  const active = selection
    ? {
        getRow: () => selection.row,
        getColumn: () => selection.column,
        getWidth: () => selection.width,
        getHeight: () => selection.height,
      }
    : null
  const workbook = {
    getActiveSheet: () => worksheet,
    getActiveRange: () => active,
    getSheets: () => [worksheet],
    getSheetBySheetId: () => worksheet,
  }
  const runtime = { univerAPI: { getActiveWorkbook: () => workbook } } as unknown as UniverRuntime
  const ctx: PageLayoutContext = {
    univerRef: { current: runtime },
    lazyWorkbookRef: { current: null },
    setMessage: (message) => {
      messages.push(message)
    },
    setPendingEdits: vi.fn(),
    requestVisualInstall: vi.fn(),
    runOps: () => Promise.reject(new Error('page layout ops are not used here')),
  }
  const host = createPrintPreviewHost(ctx)
  if (!host) throw new Error('the print host did not open')
  return host
}
