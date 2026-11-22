import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import type { BoardObject, ConnectorProps } from '@genoffice/whiteboard-engine'
import { ensureWhiteboardEngineSync } from '@genoffice/whiteboard-engine/node'
import {
  duplicateSelectionOps,
  freshIdMaker,
  layerOrderOps,
  mergeSelections,
  moveSelectionOps,
  objectExtent,
  objectsInArea,
  rectFromPoints,
  shiftedObject,
  toggleInSelection,
  unionExtent,
} from '../src/renderer/canvas/selection'
import { WhiteboardSession } from '../src/renderer/document/session'
import { appStrings } from '../src/renderer/i18n/strings-app'

const ONE_BY_ONE_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
])

function box(id: string, x: number, y: number, width: number, height: number): BoardObject {
  return {
    id,
    pageId: 'p1',
    kind: 'sticky',
    orderKey: id,
    x,
    y,
    width,
    height,
    rotation: 0,
    props: {},
  }
}

function connector(id: string, start: ConnectorProps['start'], end: ConnectorProps['end']) {
  return {
    ...box(id, 0, 0, 0, 0),
    kind: 'connector',
    props: { start, end, waypoints: [{ x: 150, y: 40 }] },
  } as BoardObject
}

function byId(objects: readonly BoardObject[]): Map<string, BoardObject> {
  return new Map(objects.map((o) => [o.id, o]))
}

/** Session with two notes joined by an attached connector and one free connector. */
function boardWithLinkedNotes(): WhiteboardSession {
  const session = WhiteboardSession.createBlank('Selection')
  session.applyEditorOps([
    { op: 'add', id: 'a', kind: 'sticky', x: 0, y: 0, width: 100, height: 100 },
    { op: 'add', id: 'b', kind: 'sticky', x: 300, y: 0, width: 100, height: 100 },
    {
      op: 'add',
      id: 'link',
      kind: 'connector',
      start: { objectId: 'a', anchorX: 1, anchorY: 0.5 },
      end: { objectId: 'b', anchorX: 0, anchorY: 0.5 },
    },
    { op: 'add', id: 'free', kind: 'connector', start: { x: 0, y: 200 }, end: { x: 120, y: 200 } },
  ])
  return session
}

function objectOf(session: WhiteboardSession, id: string): BoardObject {
  const found = session.getDocument().objects.find((o) => o.id === id)
  if (!found) throw new Error(`no object ${id}`)
  return found
}

describe('area selection', () => {
  it('spans a rectangle from either drag direction', () => {
    expect(rectFromPoints({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    })
  })

  it('picks only objects wholly inside the area', () => {
    const objects = [
      box('in', 10, 10, 50, 50),
      box('edge', 0, 0, 100, 100),
      box('out', 90, 90, 40, 40),
    ]
    const area = { x: 0, y: 0, width: 100, height: 100 }
    expect(objectsInArea(objects, area, byId(objects))).toEqual(['in', 'edge'])
    expect(objectsInArea(objects, { x: 5, y: 5, width: 60, height: 60 }, byId(objects))).toEqual([
      'in',
    ])
  })

  it('measures turned boxes by their turned corners and connectors by their points', () => {
    const turned = { ...box('t', 0, 0, 100, 20), rotation: 90 }
    const e = objectExtent(turned, byId([turned]))
    expect(e.x).toBeCloseTo(40)
    expect(e.y).toBeCloseTo(-40)
    expect(e.width).toBeCloseTo(20)
    expect(e.height).toBeCloseTo(100)

    const note = box('n', 200, 0, 100, 80)
    const line = connector('c', { x: 10, y: 20 }, { objectId: 'n', anchorX: 0, anchorY: 0.5 })
    expect(objectExtent(line, byId([note, line]))).toEqual({ x: 10, y: 20, width: 190, height: 20 })
    expect(unionExtent([note, line], byId([note, line]))).toEqual({
      x: 10,
      y: 0,
      width: 290,
      height: 80,
    })
    expect(unionExtent([], new Map())).toBeNull()
  })

  it('toggles and merges selections in order', () => {
    expect(toggleInSelection(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
    expect(toggleInSelection(['a', 'b'], 'a')).toEqual(['b'])
    expect(mergeSelections(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('moves free connector ends with the group and leaves attached ends attached', () => {
    const note = box('n', 0, 0, 10, 10)
    const line = connector('c', { x: 5, y: 5 }, { objectId: 'n' })
    const moved = shiftedObject(line, 10, 20).props as unknown as ConnectorProps
    expect(moved.start).toEqual({ x: 15, y: 25 })
    expect(moved.end).toEqual({ objectId: 'n' })
    expect(moved.waypoints).toEqual([{ x: 160, y: 60 }])
    expect(shiftedObject(note, 10, 20)).toMatchObject({ x: 10, y: 20 })
    expect(moveSelectionOps([note, line], ['c'], 10, 20)).toEqual([
      { op: 'update', id: 'c', props: { start: { x: 15, y: 25 }, waypoints: [{ x: 160, y: 60 }] } },
    ])
  })

  it('makes fresh ids that clash with nothing taken', () => {
    const rolls = ['a', 'b', 'b', 'c']
    const next = freshIdMaker(['a'], () => rolls.shift()!)
    expect([next(), next()]).toEqual(['b', 'c'])
  })
})

describe('selection edits on a board', () => {
  it('moves a selection as one user undo step', () => {
    ensureWhiteboardEngineSync()
    const session = boardWithLinkedNotes()
    const before = session.getDocument().objects
    expect(session.applyEditorOps(moveSelectionOps(before, ['a', 'b', 'free'], 40, 25))).toBe(true)
    expect(objectOf(session, 'a')).toMatchObject({ x: 40, y: 25 })
    expect(objectOf(session, 'b')).toMatchObject({ x: 340, y: 25 })
    const link = objectOf(session, 'link').props as unknown as ConnectorProps
    expect(link.start).toMatchObject({ objectId: 'a' })
    const free = objectOf(session, 'free').props as unknown as ConnectorProps
    expect(free.start).toEqual({ x: 40, y: 225 })
    expect(free.end).toEqual({ x: 160, y: 225 })

    expect(session.undo()).toBe(true)
    expect(objectOf(session, 'a')).toMatchObject({ x: 0, y: 0 })
    expect(objectOf(session, 'free').props).toMatchObject({ start: { x: 0, y: 200 } })
    session.dispose()
  })

  it('duplicates a selection with its connector attached to the copies', () => {
    ensureWhiteboardEngineSync()
    const session = boardWithLinkedNotes()
    const objects = session.getDocument().objects
    let n = 0
    const ops = duplicateSelectionOps(
      objects,
      ['link', 'a', 'b'],
      28,
      28,
      byId(objects),
      () => `copy-${++n}`,
    )
    expect(ops.map((op) => op.kind)).toEqual(['sticky', 'sticky', 'connector'])
    expect(session.applyEditorOps(ops)).toBe(true)
    expect(session.getDocument().objects).toHaveLength(7)
    expect(session.getSelection().sort()).toEqual(['copy-1', 'copy-2', 'copy-3'])
    expect(objectOf(session, 'copy-1')).toMatchObject({ x: 28, y: 28, width: 100, height: 100 })
    const copied = objectOf(session, 'copy-3').props as unknown as ConnectorProps
    expect(copied.start).toMatchObject({ objectId: 'copy-1', anchorX: 1, anchorY: 0.5 })
    expect(copied.end).toMatchObject({ objectId: 'copy-2', anchorX: 0, anchorY: 0.5 })
    expect(session.undo()).toBe(true)
    expect(session.getDocument().objects).toHaveLength(4)
    session.dispose()
  })

  it('frees a copied connector end whose object stays behind', () => {
    const note = box('n', 100, 100, 50, 50)
    const line = connector('c', { x: 0, y: 0 }, { objectId: 'n', anchorX: 0, anchorY: 0 })
    const [op] = duplicateSelectionOps([note, line], ['c'], 10, 10, byId([note, line]), () => 'c2')
    expect(op).toMatchObject({
      id: 'c2',
      props: { start: { x: 10, y: 10 }, end: { x: 110, y: 110 } },
    })
  })

  it('restacks a selection to the front or back keeping its own order', () => {
    ensureWhiteboardEngineSync()
    const session = boardWithLinkedNotes()
    const ordered = () =>
      [...session.getDocument().objects].sort((p, q) =>
        p.orderKey < q.orderKey ? -1 : p.orderKey > q.orderKey ? 1 : 0,
      )
    const stacked = () => ordered().map((o) => o.id)
    expect(stacked()).toEqual(['a', 'b', 'link', 'free'])

    session.applyEditorOps(layerOrderOps(ordered(), ['a', 'b'], 'front'))
    expect(stacked()).toEqual(['link', 'free', 'a', 'b'])
    session.applyEditorOps(layerOrderOps(ordered(), ['free', 'b'], 'back'))
    expect(stacked()).toEqual(['free', 'b', 'link', 'a'])
    session.dispose()
  })

  it('keeps a user edit after an AI turn from being undone with that turn', async () => {
    ensureWhiteboardEngineSync()
    const session = boardWithLinkedNotes()
    await session.applyOps([{ op: 'update', id: 'a', x: 500 }])
    expect(
      session.applyEditorOps(moveSelectionOps(session.getDocument().objects, ['b'], 5, 0)),
    ).toBe(true)
    expect(await session.undoBatches(1)).toBe(false)
    expect(objectOf(session, 'a')).toMatchObject({ x: 500 })
    session.dispose()
  })

  it('keeps a user image insert after an AI turn from being undone with that turn', async () => {
    ensureWhiteboardEngineSync()
    const session = boardWithLinkedNotes()
    await session.applyOps([{ op: 'update', id: 'a', x: 500 }])
    const inserted = await session.insertEditorImage({ bytes: ONE_BY_ONE_PNG, alt: 'photo.png' })
    if (!inserted.ok) throw new Error(inserted.error)
    const board = structuredClone(session.getDocument())
    expect(await session.undoBatches(1)).toBe(false)
    expect(session.getDocument()).toEqual(board)
    expect(objectOf(session, inserted.objectId)).toMatchObject({ kind: 'image' })
    expect(objectOf(session, 'a')).toMatchObject({ x: 500 })
    session.dispose()
  })

  it('does nothing for an empty edit', () => {
    ensureWhiteboardEngineSync()
    const session = WhiteboardSession.createBlank('Empty')
    expect(session.applyEditorOps([])).toBe(false)
    expect(session.canUndo()).toBe(false)
    session.dispose()
  })
})

describe('selection strings', () => {
  it('name the area tool and count the selection in every language', () => {
    for (const lang of LANGS) {
      expect(appStrings[lang].toolAreaSelect.trim()).not.toBe('')
      expect(appStrings[lang].selectionCount).toContain('{count}')
      if (lang !== 'en')
        expect(appStrings[lang].toolAreaSelect).not.toBe(appStrings.en.toolAreaSelect)
    }
  })
})
