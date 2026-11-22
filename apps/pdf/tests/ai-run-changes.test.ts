/**
 * What an AI run changed in the PDF: when its changes card may take it back,
 * what the stacks look like after, which places get a mark, and which edit
 * batches count as the run's.
 */
import { describe, expect, it } from 'vitest'

import {
  remapMarks,
  revertedStacks,
  runChangeLines,
  runMarks,
  runRevertVerdict,
  textInsertRect,
  withAiEditScope,
} from '../src/renderer/ai/ai-run-changes'
import { pdfRectToCss, viewToPdf, type PageGeom } from '../src/renderer/annotations'
import type { EditSnapshot } from '../src/renderer/edit-state'
import { textInsertPreviewStyle, type LocalTextInsert } from '../src/renderer/text-edit-preview'

const empty = (): EditSnapshot => ({
  markups: [],
  annotDeletes: [],
  noteEdits: [],
  drawings: [],
  textEdits: [],
  textInserts: [],
  imageEdits: [],
  stampCfg: null,
  formEdits: new Map(),
  formFields: [],
  blankPages: [],
  formWidgetEdits: new Map(),
  rotations: new Map(),
  deleted: new Set(),
  order: null,
  metadata: null,
})

const snaps = (count: number) => Array.from({ length: count }, empty)

describe('runRevertVerdict', () => {
  const user = snaps(2)
  const run = snaps(2)

  it('lets the card undo while the run’s snapshots are the newest, in order', () => {
    expect(runRevertVerdict(run, [...user, ...run])).toBe('ok')
  })

  it('refuses after a user edit, or when the run’s batches are not one block', () => {
    expect(runRevertVerdict(run, [...user, ...run, empty()])).toBe('refused')
    expect(runRevertVerdict(run, [user[0]!, run[0]!, user[1]!, run[1]!])).toBe('refused')
  })

  it('has expired once the oldest snapshot left the ring of 50, or a save cleared the stack', () => {
    expect(runRevertVerdict(run, [run[1]!])).toBe('expired')
    expect(runRevertVerdict(run, [])).toBe('expired')
    expect(runRevertVerdict([], [...user])).toBe('expired')
  })
})

describe('revertedStacks', () => {
  it('ends where Undo pressed once per batch ends', () => {
    const before = snaps(1)
    const run = snaps(3)
    const current = empty()
    const redo = snaps(1)
    // Undo as App.tsx does it: the current state onto redo, the top snapshot back
    let undoStack = [...before, ...run]
    let redoStack = [...redo]
    let state = current
    for (let i = 0; i < run.length; i++) {
      const top = undoStack.at(-1)!
      redoStack = [...redoStack, state]
      undoStack = undoStack.slice(0, -1)
      state = top
    }
    const next = revertedStacks(run, [...before, ...run], redo, current)
    expect(next.restore).toBe(state)
    expect(next.undo).toEqual(undoStack)
    expect(next.redo).toHaveLength(redoStack.length)
    next.redo.forEach((snap, i) => expect(snap).toBe(redoStack[i]))
  })
})

const measure = (line: string, fontSize: number) => line.length * fontSize * 0.5
const flat: PageGeom = { pw: 600, ph: 800, rot: 0 }
const geomOf = () => flat

describe('runMarks', () => {
  it('marks what the run added or changed, not what was there before or what it removed', () => {
    const kept = {
      id: 'old',
      pageIndex: 0,
      type: 'highlight' as const,
      color: [1, 1, 0] as [number, number, number],
      quads: [[0, 10, 5, 10, 0, 0, 5, 0]],
    }
    const before: EditSnapshot = { ...empty(), markups: [kept] }
    const after: EditSnapshot = {
      ...before,
      markups: [
        kept,
        {
          id: 'new',
          pageIndex: 1,
          type: 'highlight',
          color: [1, 1, 0],
          quads: [[10, 30, 50, 30, 10, 20, 50, 20]],
        },
      ],
      textEdits: [
        {
          id: 't',
          input: { pageIndex: 0, rect: [100, 100, 200, 120], oldText: 'a', newText: 'b' } as never,
          cover: [98, 99, 201, 121],
        },
        {
          id: 'moved',
          input: { pageIndex: 0, rect: [0, 0, 10, 10], oldText: 'a', newText: 'a' } as never,
          moveBy: [5, 5],
        },
      ],
      imageEdits: [
        {
          id: 'i',
          input: {
            kind: 'insertImage',
            pageIndex: 2,
            image: '',
            rect: [0, 0, 40, 40],
            layer: 'above',
          } as never,
        },
        { id: 'd', input: { kind: 'deleteImage', pageIndex: 2, oldRect: [0, 0, 9, 9] } },
      ],
      drawings: [
        {
          id: 'ink',
          input: { kind: 'ink', pageIndex: 3, color: [0, 0, 0], width: 2, paths: [[0, 0, 10, 20]] },
        },
        {
          id: 'note',
          input: { kind: 'note', pageIndex: 3, color: [0, 0, 0], at: [50, 50], contents: 'x' },
        },
      ],
      rotations: new Map([[0, 90]]),
      deleted: new Set([4]),
    }
    expect(runMarks(before, after, measure, geomOf)).toEqual([
      { pageIndex: 1, rect: [10, 20, 50, 30] },
      { pageIndex: 0, rect: [98, 99, 201, 121] },
      { pageIndex: 0, rect: [5, 5, 15, 15] },
      { pageIndex: 2, rect: [0, 0, 40, 40] },
      { pageIndex: 3, rect: [-1, -1, 11, 21] },
      { pageIndex: 3, rect: [42, 42, 58, 58] },
    ])
  })

  const insert = (input: Partial<LocalTextInsert['input']>): LocalTextInsert => ({
    id: 'x',
    input: {
      pageIndex: 0,
      origin: [100, 500],
      text: 'abcd\nab',
      fontSize: 10,
      color: [0, 0, 0],
      ...input,
    },
  })

  it('boxes a text insert like its preview: one size above the baseline, preview line height', () => {
    // widest line 20 pt; two lines of 1.2 × the 0.92 preview size
    expect(textInsertRect(insert({}), flat, measure)).toEqual([100, 500 - 2 * 11.04 + 10, 120, 510])
    expect(textInsertRect(insert({ lineLeading: 12 }), flat, measure)).toEqual([100, 486, 120, 510])
    expect(textInsertRect(insert({ align: 'right' }), flat, measure)?.[0]).toBe(80)
    expect(textInsertRect(insert({ align: 'center' }), flat, measure)?.[0]).toBe(90)
    expect(textInsertRect(insert({ text: '' }), flat, measure)).toBeNull()
  })

  it.each([0, 90, 180, 270])(
    'puts the mark on the preview of text inserted on a %i° page',
    (rot) => {
      const geom: PageGeom = { pw: 600, ph: 800, rot, x0: 5, y0: 7 }
      // as insert_text records it: the origin from a display point, the page's turn in rotate
      const placed = insert({ origin: viewToPdf(geom, 100, 200), rotate: rot, lineLeading: 12 })
      const rect = textInsertRect(placed, geom, measure)!
      const box = pdfRectToCss(geom, rect, 2)
      expect(box.left).toBeCloseTo(200)
      expect(box.top).toBeCloseTo(380)
      expect(box.width).toBeCloseTo(40)
      expect(box.height).toBeCloseTo(48)
      const preview = textInsertPreviewStyle(placed, geom, 2)
      expect(box.left).toBeCloseTo(preview.left as number)
      expect(box.top).toBeCloseTo(preview.top as number)
      // centered lines hang left of the origin by half the widest line on every turn
      const centered = textInsertRect(
        { ...placed, input: { ...placed.input, align: 'center' } },
        geom,
        measure,
      )!
      expect(pdfRectToCss(geom, centered, 1).left).toBeCloseTo(90)
    },
  )

  it('leaves invisible OCR text and pages without a known size out', () => {
    const after = { ...empty(), textInserts: [insert({ invisible: true })] }
    expect(runMarks(empty(), after, measure, geomOf)).toEqual([])
    const visible = { ...empty(), textInserts: [insert({ rotate: 90 })] }
    expect(runMarks(empty(), visible, measure, () => null)).toEqual([])
    expect(runMarks(empty(), visible, measure, () => ({ ...flat, rot: 90 }))).toHaveLength(1)
  })
})

describe('remapMarks', () => {
  it('follows the pages a save moved and drops the ones it removed', () => {
    const marks = [
      { pageIndex: 0, rect: [0, 0, 1, 1] as [number, number, number, number] },
      { pageIndex: 1, rect: [0, 0, 1, 1] as [number, number, number, number] },
    ]
    expect(remapMarks(marks, new Map([[1, 0]]))).toEqual([{ pageIndex: 0, rect: [0, 0, 1, 1] }])
  })
})

describe('withAiEditScope', () => {
  it('counts a call as the AI’s until it returns, an async one until it settles', async () => {
    const depth = { current: 0 }
    const seen: number[] = []
    let finish = (): void => undefined
    const api = withAiEditScope(
      {
        sync: () => seen.push(depth.current),
        later: () =>
          new Promise<void>((resolve) => {
            finish = resolve
          }).then(() => {
            seen.push(depth.current)
          }),
        fails: () => {
          throw new Error('no')
        },
        value: 3,
      },
      depth,
    )
    api.sync()
    expect(depth.current).toBe(0)
    const pending = api.later()
    expect(depth.current).toBe(1)
    finish()
    await pending
    expect(depth.current).toBe(0)
    expect(() => api.fails()).toThrow('no')
    expect(depth.current).toBe(0)
    expect(seen).toEqual([1, 1])
    expect(api.value).toBe(3)
  })
})

describe('runChangeLines', () => {
  it('describes text edits, inserts, markups, and non-jumpable document ops', () => {
    const before = empty()
    const after: EditSnapshot = {
      ...before,
      textEdits: [
        {
          id: 't1',
          input: { pageIndex: 1, rect: [0, 0, 10, 10], oldText: 'old', newText: 'new' } as never,
        },
      ],
      textInserts: [
        {
          id: 'ins1',
          input: {
            pageIndex: 0,
            origin: [10, 20],
            text: 'Added note',
            fontSize: 12,
            color: [0, 0, 0],
          },
        },
      ],
      deleted: new Set([2]),
      metadata: { title: 'Updated' },
    }
    const lines = runChangeLines(before, after)
    expect(lines).toEqual([
      { kind: 'named', from: 'p.2', to: 'new', showable: true, page: 2 },
      { kind: 'insert', to: 'p.1 Added note', showable: true, page: 1 },
      { kind: 'delete', from: 'p.3', showable: false },
      { kind: 'named', to: 'Metadata', showable: false },
    ])
  })
})
