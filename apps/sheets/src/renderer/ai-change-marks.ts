/**
 * Marks over the cells the last AI run changed, in the one mark look every
 * editor shares (`--color-ai-changed-bg` with a `--color-ai-changed-line`
 * underline, @genoffice/ui tokens). Like the cross highlight, a canvas
 * extension paints them inside the grid: nothing is written to the workbook
 * model (no style, no conditional format, no undo entry), so the marks never
 * reach the saved file, the edit journal, the clipboard copy, print/PDF
 * (built from the model as HTML) or what the AI reads. Univer's own printing
 * pass skips them too.
 *
 * The marks stay until the next run starts, "Hide marks", the run is taken
 * back, a new chat, another workbook, or an edit that moves cells under them
 * (rows/columns inserted, removed or moved) or undo/redo, after which the
 * marked coordinates no longer name the changed cells.
 */
import type { IRange, IScale } from '@univerjs/core'
import {
  IRenderManagerService,
  SheetExtension,
  SpreadsheetExtensionRegistry,
  type IDrawInfo,
  type SpreadsheetSkeleton,
  type UniverRenderingContext,
} from '@univerjs/engine-render'
import type { ChangePlan } from '@genoffice/xlsx-gateway/domain/workbook.types'
import { parseAddress, parseRange } from '@genoffice/xlsx-gateway/domain/cell-address'

import { journalSuppression, type UniverRuntime } from './univer-state'

export type AiMarkRanges = ReadonlyMap<string, readonly IRange[]>

/** Structural ops whose target range holds the cells they wrote */
const RANGE_WRITING_OPS = new Set(['fill_range', 'sort_range'])

/**
 * The places a plan changed, per sheet: written cells (not cleared ones, a
 * deletion needs no mark), formatted ranges, filled and sorted ranges. Cells
 * are joined into row runs and runs into blocks so a written column is one
 * rectangle.
 */
export function planMarkRanges(
  plan: Pick<ChangePlan, 'cellChanges' | 'formatChanges' | 'structuralChanges'>,
): Map<string, IRange[]> {
  const cells = new Map<string, { row: number; column: number }[]>()
  const ranges = new Map<string, IRange[]>()
  const addRange = (sheetId: string, a1: string): void => {
    try {
      const bounds = parseRange(a1)
      const list = ranges.get(sheetId) ?? []
      list.push({ ...bounds })
      ranges.set(sheetId, list)
    } catch {
      // an address the parser does not read gets no mark
    }
  }
  for (const change of plan.cellChanges) {
    const { value, formula } = change.after
    if ((value === null || value === undefined || value === '') && !formula) continue
    try {
      const cell = parseAddress(change.address)
      const list = cells.get(change.sheetId) ?? []
      list.push(cell)
      cells.set(change.sheetId, list)
    } catch {
      // see addRange
    }
  }
  for (const change of plan.formatChanges) addRange(change.sheetId, change.range)
  for (const change of plan.structuralChanges) {
    const op = change.op as { op: string; sheetId?: string; range?: string; target?: string }
    if (!RANGE_WRITING_OPS.has(op.op) || !op.sheetId) continue
    const a1 = op.op === 'fill_range' ? op.target : op.range
    if (a1) addRange(op.sheetId, a1)
  }
  for (const [sheetId, list] of cells) {
    const joined = joinCells(list)
    ranges.set(sheetId, [...(ranges.get(sheetId) ?? []), ...joined])
  }
  return ranges
}

/** Cells as few rectangles: runs along a row, then equal runs on rows one under another. */
export function joinCells(cells: readonly { row: number; column: number }[]): IRange[] {
  const sorted = [...cells].sort((a, b) => a.row - b.row || a.column - b.column)
  const runs: IRange[] = []
  for (const cell of sorted) {
    const last = runs.at(-1)
    if (last && last.startRow === cell.row && cell.column <= last.endColumn + 1) {
      last.endColumn = Math.max(last.endColumn, cell.column)
    } else {
      runs.push({
        startRow: cell.row,
        endRow: cell.row,
        startColumn: cell.column,
        endColumn: cell.column,
      })
    }
  }
  const blocks: IRange[] = []
  const open = new Map<string, IRange>()
  for (const run of runs) {
    const key = `${run.startColumn}:${run.endColumn}`
    const block = open.get(key)
    if (block && block.endRow === run.startRow - 1) {
      block.endRow = run.endRow
    } else {
      const next = { ...run }
      blocks.push(next)
      open.set(key, next)
    }
  }
  return blocks
}

/** Two mark sets as one (a run that applied several plans) */
export function mergeMarkRanges(a: AiMarkRanges, b: AiMarkRanges): Map<string, IRange[]> {
  const out = new Map<string, IRange[]>()
  for (const source of [a, b]) {
    for (const [sheetId, list] of source) out.set(sheetId, [...(out.get(sheetId) ?? []), ...list])
  }
  return out
}

export interface MarkRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** The visible parts of the marked ranges as canvas rectangles. */
export function markRects(
  ranges: readonly IRange[],
  viewRanges: readonly IRange[],
  cellAt: (
    row: number,
    column: number,
  ) => { startX: number; startY: number; endX: number; endY: number } | null,
): MarkRect[] {
  const rects: MarkRect[] = []
  const seen = new Set<string>()
  for (const view of viewRanges) {
    for (const range of ranges) {
      const startRow = Math.max(range.startRow, view.startRow)
      const endRow = Math.min(range.endRow, view.endRow)
      const startColumn = Math.max(range.startColumn, view.startColumn)
      const endColumn = Math.min(range.endColumn, view.endColumn)
      if (startRow > endRow || startColumn > endColumn) continue
      const first = cellAt(startRow, startColumn)
      const last = cellAt(endRow, endColumn)
      if (!first || !last) continue
      const rect = {
        left: first.startX,
        top: first.startY,
        width: last.endX - first.startX,
        height: last.endY - first.startY,
      }
      if (!(rect.width > 0) || !(rect.height > 0)) continue
      const key = `${rect.left}:${rect.top}:${rect.width}:${rect.height}`
      if (seen.has(key)) continue
      seen.add(key)
      rects.push(rect)
    }
  }
  return rects
}

interface MarkColors {
  readonly fill: string
  readonly line: string
}

/** The shared mark tokens as the canvas needs them (theme-aware via the token sheet). */
export function readMarkColors(): MarkColors | null {
  try {
    const style = getComputedStyle(document.documentElement)
    const fill = style.getPropertyValue('--color-ai-changed-bg').trim()
    const line = style.getPropertyValue('--color-ai-changed-line').trim()
    return fill && line ? { fill, line } : null
  } catch {
    return null
  }
}

let markState: { ranges: AiMarkRanges; colors: MarkColors | null } = {
  ranges: new Map(),
  colors: null,
}

/** what the grid marks now (for tests and the panel) */
export function currentMarkRanges(): AiMarkRanges {
  return markState.ranges
}

/**
 * Grid extension above authored cell backgrounds and below fonts and
 * borders, like the cross highlight. It renders no document content and is
 * left out of Univer's printing pass.
 */
export class AiChangeMarksExtension extends SheetExtension {
  readonly uKey = 'GenOfficeAiChangeMarksExtension'
  protected Z_INDEX = 23

  override draw(
    ctx: UniverRenderingContext,
    _parentScale: IScale,
    skeleton: SpreadsheetSkeleton,
    _diffRanges: IRange[] | undefined,
    drawInfo?: IDrawInfo,
  ): void {
    const { ranges, colors } = markState
    if (ranges.size === 0 || !colors || ctx.__mode === 'printing') return
    const worksheet = skeleton.worksheet
    const marked = worksheet ? ranges.get(worksheet.getSheetId()) : undefined
    if (!marked || marked.length === 0) return
    const viewRanges = drawInfo?.viewRanges?.length
      ? drawInfo.viewRanges
      : [skeleton.rowColumnSegment]
    const rects = markRects(marked, viewRanges, (row, column) =>
      skeleton.getCellWithCoordByIndex(row, column, false),
    )
    if (rects.length === 0) return
    const { scaleX, scaleY } = ctx.getScale()
    // the inset 2px underline of .ai-changed-mark, in canvas units
    const line = 2 / Math.max(scaleX, scaleY, 1)
    ctx.save()
    ctx.fillStyle = colors.fill
    for (const rect of rects) ctx.fillRect(rect.left, rect.top, rect.width, rect.height)
    ctx.fillStyle = colors.line
    for (const rect of rects) {
      ctx.fillRect(rect.left, rect.top + rect.height - line, rect.width, line)
    }
    ctx.restore()
  }
}

SpreadsheetExtensionRegistry.add(AiChangeMarksExtension)

function repaint(runtime: UniverRuntime): void {
  try {
    const workbookId = runtime.univerAPI.getActiveWorkbook()?.getId()
    if (!workbookId) return
    const render = runtime.univer
      .__getInjector()
      .get(IRenderManagerService)
      .getRenderById(workbookId)
    render?.mainComponent?.makeDirty(true)
    render?.scene?.makeDirty(true)
  } catch {
    // Render modules may not exist yet during workbook replacement.
  }
}

/** Edits after which the marked coordinates no longer name the changed cells */
const MARK_MOVING_COMMANDS = new Set([
  'univer.command.undo',
  'univer.command.redo',
  'sheet.mutation.insert-row',
  'sheet.mutation.remove-rows',
  'sheet.mutation.insert-col',
  'sheet.mutation.remove-col',
  'sheet.mutation.move-rows',
  'sheet.mutation.move-columns',
])

export interface AiChangeMarksHandle {
  /** mark these places (replacing what was marked) */
  show(ranges: AiMarkRanges): void
  clear(): void
  /** the theme changed: read the mark colours again */
  refresh(): void
  /** while an AI apply runs, its own row/column edits keep the marks */
  holdDuring<T>(apply: Promise<T>): Promise<T>
  dispose(): void
}

export function installAiChangeMarks(
  runtime: UniverRuntime,
  options: { readonly onCleared: () => void },
): AiChangeMarksHandle {
  let held = 0
  const clear = (): void => {
    if (markState.ranges.size === 0) return
    markState = { ranges: new Map(), colors: markState.colors }
    repaint(runtime)
    options.onCleared()
  }
  const listener = runtime.univerAPI.addEvent(runtime.univerAPI.Event.CommandExecuted, (event) => {
    if (markState.ranges.size === 0 || held > 0 || journalSuppression.active) return
    if (MARK_MOVING_COMMANDS.has(event.id)) clear()
  })
  return {
    show(ranges): void {
      const kept = new Map<string, readonly IRange[]>()
      for (const [sheetId, list] of ranges) if (list.length > 0) kept.set(sheetId, list)
      markState = { ranges: kept, colors: markState.colors ?? readMarkColors() }
      repaint(runtime)
    },
    clear,
    refresh(): void {
      markState = { ranges: markState.ranges, colors: readMarkColors() }
      if (markState.ranges.size > 0) repaint(runtime)
    },
    holdDuring<T>(apply: Promise<T>): Promise<T> {
      held += 1
      return apply.finally(() => {
        held -= 1
      })
    },
    dispose(): void {
      listener.dispose()
      markState = { ranges: new Map(), colors: null }
    },
  }
}
