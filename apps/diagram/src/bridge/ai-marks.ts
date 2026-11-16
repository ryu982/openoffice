/**
 * The marks around the cells the last AI run changed, inside the draw.io
 * frame. They are draw.io highlights (`mxCellHighlight`) on the graph's
 * overlay layer: not cells, so the model, the undo history, the saved file,
 * the exports and print (all made from the model) never hold them. draw.io
 * draws only the page on screen, so the marks of a page are drawn when it
 * comes on screen.
 */
import { parseMarkColor, type DiagramCellRef, type MarkColor } from '../shared/ai-marks'

export interface MarkPaint {
  fill: MarkColor
  line: MarkColor
}

/** What the marks need from draw.io; `drawio-adapter`-like, so the tests can stand in for it. */
export interface CellMarkHost {
  currentPageId(): string | null
  /** the drawn state of a cell of the page on screen; null when it is not drawn or has no size */
  stateOf(id: string): unknown
  /** draws the mark around one drawn cell; answers how to take it off */
  draw(state: unknown, paint: MarkPaint): () => void
}

export interface CellMarks {
  /** the cells to mark and the CSS colours of the marks; an empty list takes them off */
  set(cells: readonly DiagramCellRef[], fill: string, line: string): void
  /** draws the marks of the page on screen again (another page came on screen) */
  redraw(): void
}

export function createCellMarks(host: CellMarkHost): CellMarks {
  let cells: readonly DiagramCellRef[] = []
  let paint: MarkPaint | null = null
  let drawn: Array<() => void> = []

  const takeOff = (): void => {
    for (const remove of drawn) {
      try {
        remove()
      } catch {
        // a highlight draw.io already let go of
      }
    }
    drawn = []
  }

  const redraw = (): void => {
    takeOff()
    if (!paint || cells.length === 0) return
    const page = host.currentPageId()
    for (const cell of cells) {
      if (cell.page !== page) continue
      const state = host.stateOf(cell.id)
      if (state) drawn.push(host.draw(state, paint))
    }
  }

  return {
    set(next, fill, line) {
      const fillColor = parseMarkColor(fill)
      const lineColor = parseMarkColor(line)
      paint = fillColor && lineColor ? { fill: fillColor, line: lineColor } : null
      cells = paint ? [...next] : []
      redraw()
    },
    redraw,
  }
}
