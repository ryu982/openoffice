/**
 * What an AI run changed in the diagram, cell by cell, and the colours of the
 * marks the bridge draws around those cells (decision 0103 keeps draw.io's
 * files as they are: the marks are draw.io highlights on its overlay layer,
 * never cells, so the model, the saved file, the exports and the undo
 * history do not see them).
 *
 * Free of the DOM and of draw.io: the screen, the bridge and the tests share it.
 */
import type { DiagramPrimitive } from '@genoffice/drawio-model'
import type { DiagramApplyStep } from './bridge-protocol'

/** One cell of one page. */
export interface DiagramCellRef {
  page: string
  id: string
}

/** What one applied call did to cells: the ones it added, changed and removed. */
export interface DiagramCellChanges {
  added: DiagramCellRef[]
  updated: DiagramCellRef[]
  removed: DiagramCellRef[]
  /** pages the call removed, with every cell on them */
  removedPages: string[]
}

/**
 * The cells a call changed, from the steps it sent and the ids each step made
 * (`applyBatch`'s `steps`): a new cell has the id draw.io gave it, a drawing
 * is every cell it added, an update names its cell.
 */
export function cellChangesOf(
  steps: readonly DiagramApplyStep[],
  made: readonly (readonly string[])[],
): DiagramCellChanges {
  const changes: DiagramCellChanges = { added: [], updated: [], removed: [], removedPages: [] }
  steps.forEach((step, index) => {
    const ids = made[index] ?? []
    if (step.kind === 'mermaid') {
      for (const id of ids) changes.added.push({ page: step.page, id })
      return
    }
    let next = 0
    for (const primitive of step.primitives as readonly DiagramPrimitive[]) {
      switch (primitive.kind) {
        case 'add_page':
          // a new page's id is among the ids made, in order
          next++
          break
        case 'add_cell': {
          const id = ids[next++]
          if (id !== undefined) changes.added.push({ page: primitive.page, id })
          break
        }
        case 'update_cell':
          changes.updated.push({ page: primitive.page, id: primitive.id })
          break
        case 'remove_cells':
          for (const id of primitive.ids) changes.removed.push({ page: primitive.page, id })
          break
        case 'remove_page':
          changes.removedPages.push(primitive.page)
          break
        case 'rename_page':
          break
      }
    }
  })
  return changes
}

const keyOf = (cell: DiagramCellRef): string => `${cell.page}\n${cell.id}`

/**
 * The cells one AI run changed, call after call. A cell the run added and
 * removed again is neither marked nor counted; one it changed and then
 * removed counts as removed.
 */
export class RunCellChanges {
  readonly #touched = new Map<string, { cell: DiagramCellRef; added: boolean }>()
  readonly #removed = new Set<string>()

  add(changes: DiagramCellChanges): void {
    const touch = (cell: DiagramCellRef, added: boolean): void => {
      const key = keyOf(cell)
      if (this.#touched.has(key)) return
      // a cell put back under an id the run removed is a change of that cell
      const wasRemoved = this.#removed.delete(key)
      this.#touched.set(key, { cell, added: added && !wasRemoved })
    }
    for (const cell of changes.added) touch(cell, true)
    for (const cell of changes.updated) touch(cell, false)
    const remove = (key: string): void => {
      const known = this.#touched.get(key)
      this.#touched.delete(key)
      if (!known?.added) this.#removed.add(key)
    }
    for (const cell of changes.removed) remove(keyOf(cell))
    for (const page of changes.removedPages) {
      for (const [key, known] of [...this.#touched]) if (known.cell.page === page) remove(key)
    }
  }

  /** the cells to mark: added or changed, still there */
  marked(): DiagramCellRef[] {
    return [...this.#touched.values()].map((known) => known.cell)
  }

  /** how many cells the run added, changed or removed */
  get count(): number {
    return this.#touched.size + this.#removed.size
  }
}

/** A colour the bridge can hand to draw.io: `#rrggbb` and an opacity from 0 to 100. */
export interface MarkColor {
  color: string
  opacity: number
}

const hex2 = (value: number): string =>
  Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0')

/**
 * A CSS colour as the mark tokens write them (`rgb(255 193 7 / 24%)`,
 * `rgba(255, 193, 7, 0.24)`, `#ffc107`, `#ffc1073d`) in draw.io's terms; null
 * for anything else.
 */
export function parseMarkColor(css: string): MarkColor | null {
  const text = css.trim().toLowerCase()
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(text)
  if (hex) {
    const alpha = hex[2] ? parseInt(hex[2], 16) / 255 : 1
    return { color: `#${hex[1]}`, opacity: Math.round(alpha * 100) }
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/.exec(text)
  if (!rgb) return null
  const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number) as [number, number, number]
  let alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1)
  if (![r, g, b, alpha].every(Number.isFinite)) return null
  alpha = Math.max(0, Math.min(1, alpha))
  return { color: `#${hex2(r)}${hex2(g)}${hex2(b)}`, opacity: Math.round(alpha * 100) }
}
