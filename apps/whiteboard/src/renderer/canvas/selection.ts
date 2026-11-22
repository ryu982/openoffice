/**
 * Multi-object selection on the whiteboard canvas: area (marquee) hit testing, modifier-click
 * toggling, and the edit ops that move, copy or restack a whole selection as one undo step.
 * Pure functions over board objects, so they run without a DOM.
 */
import type { BoardObject, ConnectorEnd, ConnectorProps, Point } from '@genoffice/whiteboard-engine'
import { resolveConnectorEnd } from './paper-style'

export interface BoardRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Rectangle spanned by two corner points, whichever way the drag went. */
export function rectFromPoints(a: Point, b: Point): BoardRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

function boundsOfPoints(points: readonly Point[]): BoardRect {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }
}

/**
 * Exact extent of an object on the board. A connector spans its resolved ends and waypoints; a
 * turned box spans its turned corners.
 */
export function objectExtent(obj: BoardObject, byId: ReadonlyMap<string, BoardObject>): BoardRect {
  if (obj.kind === 'connector') {
    const p = obj.props as unknown as ConnectorProps
    return boundsOfPoints([
      resolveConnectorEnd(p.start, byId),
      ...(p.waypoints ?? []),
      resolveConnectorEnd(p.end, byId),
    ])
  }
  if (!obj.rotation) return { x: obj.x, y: obj.y, width: obj.width, height: obj.height }
  const cx = obj.x + obj.width / 2
  const cy = obj.y + obj.height / 2
  const turn = (obj.rotation * Math.PI) / 180
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  const corners: Point[] = [
    { x: obj.x, y: obj.y },
    { x: obj.x + obj.width, y: obj.y },
    { x: obj.x + obj.width, y: obj.y + obj.height },
    { x: obj.x, y: obj.y + obj.height },
  ]
  return boundsOfPoints(
    corners.map(({ x, y }) => ({
      x: cx + (x - cx) * cos - (y - cy) * sin,
      y: cy + (x - cx) * sin + (y - cy) * cos,
    })),
  )
}

/** Smallest rectangle holding every given object, or null when there are none. */
export function unionExtent(
  objects: readonly BoardObject[],
  byId: ReadonlyMap<string, BoardObject>,
): BoardRect | null {
  if (objects.length === 0) return null
  const boxes = objects.map((o) => objectExtent(o, byId))
  return boundsOfPoints(
    boxes.flatMap((b) => [
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: b.y + b.height },
    ]),
  )
}

/**
 * Ids of the objects that lie wholly inside `area`, in the order given. An object the area only
 * touches is left out, so a drag inside a large zone shape picks the notes on it, not the zone.
 */
export function objectsInArea(
  objects: readonly BoardObject[],
  area: BoardRect,
  byId: ReadonlyMap<string, BoardObject>,
): string[] {
  const right = area.x + area.width
  const bottom = area.y + area.height
  return objects
    .filter((o) => {
      const e = objectExtent(o, byId)
      return e.x >= area.x && e.y >= area.y && e.x + e.width <= right && e.y + e.height <= bottom
    })
    .map((o) => o.id)
}

/** Adds `id` to the selection, or takes it out when it is already there. */
export function toggleInSelection(selection: readonly string[], id: string): string[] {
  return selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]
}

/** The first selection followed by whatever the second adds to it. */
export function mergeSelections(base: readonly string[], added: readonly string[]): string[] {
  return [...new Set([...base, ...added])]
}

function shiftEnd(end: ConnectorEnd, dx: number, dy: number): ConnectorEnd {
  return 'objectId' in end ? end : { x: end.x + dx, y: end.y + dy }
}

/**
 * The object moved by (dx, dy). A connector moves its free ends and waypoints; an end attached
 * to an object stays attached and follows that object instead.
 */
export function shiftedObject(obj: BoardObject, dx: number, dy: number): BoardObject {
  if (obj.kind !== 'connector') return { ...obj, x: obj.x + dx, y: obj.y + dy }
  const p = obj.props as unknown as ConnectorProps
  return {
    ...obj,
    props: {
      ...obj.props,
      start: shiftEnd(p.start, dx, dy),
      end: shiftEnd(p.end, dx, dy),
      ...(p.waypoints ? { waypoints: p.waypoints.map((w) => ({ x: w.x + dx, y: w.y + dy })) } : {}),
    },
  }
}

/** Update ops that move every object in `ids` by (dx, dy). */
export function moveSelectionOps(
  objects: readonly BoardObject[],
  ids: readonly string[],
  dx: number,
  dy: number,
): Record<string, unknown>[] {
  const wanted = new Set(ids)
  const ops: Record<string, unknown>[] = []
  for (const obj of objects) {
    if (!wanted.has(obj.id)) continue
    if (obj.kind !== 'connector') {
      ops.push({ op: 'update', id: obj.id, x: obj.x + dx, y: obj.y + dy })
      continue
    }
    const before = obj.props as unknown as ConnectorProps
    const after = shiftedObject(obj, dx, dy).props as unknown as ConnectorProps
    const props: Record<string, unknown> = {}
    if (!('objectId' in before.start)) props.start = after.start
    if (!('objectId' in before.end)) props.end = after.end
    if (before.waypoints && before.waypoints.length > 0) props.waypoints = after.waypoints
    if (Object.keys(props).length > 0) ops.push({ op: 'update', id: obj.id, props })
  }
  return ops
}

/**
 * Add ops that copy the objects in `ids`, offset by (dx, dy), under ids from `newId`. A copied
 * connector attaches to the copy of an object copied with it; an end attached to an object left
 * behind becomes a free end at the same offset. Boxes come first so that every attached end
 * names an object that already exists when its connector is added.
 */
export function duplicateSelectionOps(
  objects: readonly BoardObject[],
  ids: readonly string[],
  dx: number,
  dy: number,
  byId: ReadonlyMap<string, BoardObject>,
  newId: () => string,
): Record<string, unknown>[] {
  const wanted = new Set(ids)
  const picked = objects.filter((o) => wanted.has(o.id))
  const copyIds = new Map(picked.map((o) => [o.id, newId()]))
  const copyEnd = (end: ConnectorEnd): ConnectorEnd => {
    if (!('objectId' in end)) return { x: end.x + dx, y: end.y + dy }
    const twin = copyIds.get(end.objectId)
    if (twin) return { ...end, objectId: twin }
    const at = resolveConnectorEnd(end, byId)
    return { x: at.x + dx, y: at.y + dy }
  }
  const ordered = [
    ...picked.filter((o) => o.kind !== 'connector'),
    ...picked.filter((o) => o.kind === 'connector'),
  ]
  return ordered.map((obj) => {
    const props = structuredClone(obj.props)
    if (obj.kind === 'connector') {
      const p = obj.props as unknown as ConnectorProps
      props.start = copyEnd(p.start)
      props.end = copyEnd(p.end)
      if (p.waypoints) props.waypoints = p.waypoints.map((w) => ({ x: w.x + dx, y: w.y + dy }))
    }
    return {
      op: 'add',
      id: copyIds.get(obj.id)!,
      kind: obj.kind,
      x: obj.x + dx,
      y: obj.y + dy,
      width: obj.width,
      height: obj.height,
      ...(obj.rotation ? { rotation: obj.rotation } : {}),
      props,
    }
  })
}

/** Id maker for copies: each id clashes with none in `taken` and with no other id it made. */
export function freshIdMaker(taken: Iterable<string>, random: () => string): () => string {
  const used = new Set(taken)
  return () => {
    let id = random()
    while (used.has(id)) id = random()
    used.add(id)
    return id
  }
}

/**
 * Move ops that bring the objects in `ids` to the front or send them to the back while keeping
 * their stacking order among themselves. `objects` must be in stacking order, bottom first.
 */
export function layerOrderOps(
  objects: readonly BoardObject[],
  ids: readonly string[],
  direction: 'front' | 'back',
): Record<string, unknown>[] {
  const wanted = new Set(ids)
  const picked = objects.filter((o) => wanted.has(o.id))
  const sequence = direction === 'front' ? picked : [...picked].reverse()
  return sequence.map((o) => ({
    op: 'move',
    id: o.id,
    ...(direction === 'front' ? { toFront: true } : { toBack: true }),
  }))
}
