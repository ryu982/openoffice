/**
 * What one AI run changed in the PDF, for the changes card under its reply
 * (AiChangesCard of @genoffice/ui) and the marks over the pages.
 *
 * Every edit batch the AI applies is one undo snapshot (`applyEditOps` →
 * `pushUndo`, a ring of 50). A run is the list of snapshots its batches
 * pushed. The card takes the run back only while those snapshots are still
 * the newest on the undo stack, in order (nothing done since); after a user
 * edit or undo it refuses, and once the oldest of them is gone (pushed out of
 * the ring, or a save that cleared the stack) the card has expired.
 *
 * The marks are boxes in PDF user space over what the run added or changed
 * (markups, text edits and inserts, images, drawings, new form fields). They
 * are drawn as a screen layer over the page like the search hits: the pending
 * edits and the saved file never hold them, and print, export, page copies and
 * what the AI reads come from the document, not from the screen.
 */
import type { EditSnapshot } from '../edit-state'
import { quadToRect } from '../annotations'
import { shiftRect, unionCover, type LocalTextInsert } from '../text-edit-preview'

export type PdfRect = [number, number, number, number]

/** one run as its card knows it */
export interface PdfAiRun {
  readonly id: number
  /** the undo snapshots the run's batches pushed, oldest first */
  readonly snaps: readonly EditSnapshot[]
  /** edit ops the run applied */
  readonly ops: number
}

/** one box over a place the run changed (original page index, PDF user space) */
export interface PdfAiMark {
  readonly pageIndex: number
  readonly rect: PdfRect
}

export type PdfRevertVerdict = 'ok' | 'refused' | 'expired'

/** May the card take the run back now? */
export function runRevertVerdict(
  snaps: readonly EditSnapshot[],
  undoStack: readonly EditSnapshot[],
): PdfRevertVerdict {
  const n = snaps.length
  if (n === 0) return 'expired'
  const tail = undoStack.slice(-n)
  if (tail.length === n && tail.every((snap, i) => snap === snaps[i])) return 'ok'
  // still there but something sits on them, or they are no longer one block: edited since
  return snaps.every((snap) => undoStack.includes(snap)) ? 'refused' : 'expired'
}

/**
 * The stacks after taking the run back, as if Undo were pressed once per
 * batch: the state before the run comes back, and Redo can replay the run.
 */
export function revertedStacks(
  snaps: readonly EditSnapshot[],
  undoStack: readonly EditSnapshot[],
  redoStack: readonly EditSnapshot[],
  current: EditSnapshot,
): { undo: EditSnapshot[]; redo: EditSnapshot[]; restore: EditSnapshot } {
  return {
    undo: undoStack.slice(0, undoStack.length - snaps.length),
    redo: [...redoStack, current, ...snaps.slice(1).reverse()],
    restore: snaps[0]!,
  }
}

/** a point-only change (a note pin, a caret) gets a small box around it, in pt */
const POINT_BOX = 8

function boxOf(points: readonly (readonly [number, number])[], pad = 0): PdfRect | null {
  if (points.length === 0) return null
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) + pad,
    Math.max(...ys) + pad,
  ]
}

/** the box a drawing covers, from whatever geometry its kind carries */
function drawingRect(input: Record<string, unknown>): PdfRect | null {
  const rect = input.rect as PdfRect | undefined
  if (rect) return rect
  const width = typeof input.width === 'number' ? input.width / 2 : 0
  const paths = input.paths as number[][] | undefined
  if (paths) {
    const points: [number, number][] = []
    for (const path of paths) {
      for (let i = 0; i + 1 < path.length; i += 2) points.push([path[i]!, path[i + 1]!])
    }
    return boxOf(points, width)
  }
  const vertices = input.vertices as [number, number][] | undefined
  if (vertices) return boxOf(vertices, width)
  const from = input.from as [number, number] | undefined
  const to = input.to as [number, number] | undefined
  if (from && to) return boxOf([from, to], Math.max(width, 2))
  const point = (input.at ?? input.point) as [number, number] | undefined
  return point ? boxOf([point], POINT_BOX) : null
}

/**
 * The box a pending text insert covers on the page, from its origin, size and
 * measured lines. Null on a rotated page, where the text runs across the box
 * this would give.
 */
export function textInsertRect(
  insert: LocalTextInsert,
  measure: (line: string, fontSize: number, insert: LocalTextInsert) => number,
): PdfRect | null {
  const { origin, fontSize, text, lineLeading, align, rotate } = insert.input
  if (rotate) return null
  const lines = text.split('\n')
  const width = Math.max(0, ...lines.map((line) => measure(line, fontSize, insert)))
  if (!(width > 0)) return null
  const leading = lineLeading ?? fontSize * 1.2
  const left =
    align === 'center' ? origin[0] - width / 2 : align === 'right' ? origin[0] - width : origin[0]
  const top = origin[1] + fontSize
  const bottom = origin[1] - (lines.length - 1) * leading - fontSize * 0.25
  return [left, bottom, left + width, top]
}

/**
 * The places the run added or changed: items of the pending edits that are
 * new since the state before the run (reducers keep untouched items as the
 * same objects). Removals and page-level changes (rotation, order, deleted
 * pages, stamps, properties, form values) have no box and get no mark.
 */
export function runMarks(
  before: EditSnapshot,
  after: EditSnapshot,
  measure: (line: string, fontSize: number, insert: LocalTextInsert) => number,
): PdfAiMark[] {
  const fresh = <T>(list: readonly T[], old: readonly T[]): T[] => {
    const known = new Set(old)
    return list.filter((item) => !known.has(item))
  }
  const marks: PdfAiMark[] = []
  const add = (pageIndex: number, rect: PdfRect | null): void => {
    if (rect && rect[2] > rect[0] && rect[3] > rect[1]) marks.push({ pageIndex, rect })
  }
  for (const markup of fresh(after.markups, before.markups)) {
    for (const quad of markup.quads) add(markup.pageIndex, quadToRect(quad))
  }
  for (const edit of fresh(after.textEdits, before.textEdits)) {
    // a moved block is drawn at rect + moveBy; the validated ink bounds belong to where it was
    add(
      edit.input.pageIndex,
      edit.moveBy
        ? shiftRect(edit.input.rect, edit.moveBy)
        : unionCover(edit.input.rect, edit.cover),
    )
  }
  for (const insert of fresh(after.textInserts, before.textInserts)) {
    if (!insert.input.invisible) add(insert.input.pageIndex, textInsertRect(insert, measure))
  }
  for (const image of fresh(after.imageEdits, before.imageEdits)) {
    if (image.input.kind !== 'deleteImage') add(image.input.pageIndex, image.input.rect)
  }
  for (const drawing of fresh(after.drawings, before.drawings)) {
    add(drawing.input.pageIndex, drawingRect(drawing.input as unknown as Record<string, unknown>))
  }
  for (const field of fresh(after.formFields, before.formFields)) {
    add(field.input.pageIndex, field.input.rect)
  }
  return marks
}

/** The marks after a save: pages the save moved keep theirs, pages it removed lose them. */
export function remapMarks(
  marks: readonly PdfAiMark[],
  remap: ReadonlyMap<number, number>,
): PdfAiMark[] {
  return marks.flatMap((mark) => {
    const pageIndex = remap.get(mark.pageIndex)
    return pageIndex === undefined ? [] : [{ ...mark, pageIndex }]
  })
}

/**
 * Calls of the AI's capability surface run inside this scope, so the edit
 * batches they apply count as the run's (a batch the user applies meanwhile
 * does not). An async call stays inside until it settles.
 */
export function withAiEditScope<T extends object>(api: T, depth: { current: number }): T {
  const scoped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(api)) {
    scoped[key] =
      typeof value === 'function'
        ? (...args: unknown[]) => {
            depth.current += 1
            let result: unknown
            try {
              result = (value as (...a: unknown[]) => unknown)(...args)
            } catch (error) {
              depth.current -= 1
              throw error
            }
            if (result instanceof Promise) {
              return result.finally(() => {
                depth.current -= 1
              })
            }
            depth.current -= 1
            return result
          }
        : value
  }
  return scoped as T
}
