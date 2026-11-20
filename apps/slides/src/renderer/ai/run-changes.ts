/**
 * What one AI run changed in the deck, read by comparing the deck before the
 * run with the deck after it. The panel takes a fingerprint when a run starts
 * and diffs the rendered deck when it ends, so every tool path (ops, edit
 * scripts, generated pages, the layout check) is covered without the tools
 * reporting anything. The result drives the changes card's count and the
 * screen-only marks on the canvas and the thumbnails; nothing here touches the
 * file, an export or what the model is sent.
 */
import type { RenderNode, RenderSlide } from '@genoffice/pptx-render'
import type { AiChangesState } from '@genoffice/ui'

/** A slide as the diff knows it: its part path, which survives insert/delete/reorder */
export function slideKey(slide: RenderSlide, index: number): string {
  return slide.partPath ?? `#${index}`
}

/** An element as the diff knows it: its durable id, which survives reparse and save */
export function nodeKey(node: RenderNode): string {
  return node.durableId ?? node.sourceId
}

/** Strings longer than this (picture data URLs) are fingerprinted by length and ends */
const LONG_STRING = 512

/** Parse ids change on every reparse of a slide; they are not content */
const VOLATILE_KEYS = new Set(['id', 'sourceId'])

function fingerprint(value: unknown): string {
  return JSON.stringify(value, (key, v: unknown) => {
    if (VOLATILE_KEYS.has(key)) return undefined
    if (typeof v === 'string' && v.length > LONG_STRING) {
      return `${v.length}:${v.slice(0, 96)}…${v.slice(-96)}`
    }
    return v
  })
}

interface NodePrint {
  print: string
  /** what tells the same element apart when its durable id was reissued */
  type: string
  sourceId: string
}

interface SlidePrint {
  /** the slide without its elements: background, hidden, size */
  own: string
  nodes: Map<string, NodePrint>
}

function nodePrint(node: RenderNode): NodePrint {
  return { print: fingerprint(node), type: node.type, sourceId: node.sourceId }
}

/**
 * An element's first edit gives it a creation id, and with it a new durable id
 * (`e_3` becomes `e_5ef01f3a`) while its parse id stays, so the diff sees one
 * element leave and another arrive. A removed and an added element of one kind
 * under one parse id are the same element, counted once.
 */
function sameElement(a: NodePrint, b: NodePrint): boolean {
  return a.type === b.type && a.sourceId === b.sourceId
}

/** The deck at one moment, small enough to keep for the length of a run */
export type DeckFingerprint = ReadonlyMap<string, SlidePrint>

export function deckFingerprint(slides: readonly RenderSlide[]): DeckFingerprint {
  const out = new Map<string, SlidePrint>()
  slides.forEach((slide, index) => {
    const { nodes, ...own } = slide
    const prints = new Map<string, NodePrint>()
    for (const node of nodes) {
      // master/layout decoration is not the slide's own content
      if (node.decoration) continue
      prints.set(nodeKey(node), nodePrint(node))
    }
    out.set(slideKey(slide, index), { own: fingerprint(own), nodes: prints })
  })
  return out
}

/**
 * Where a run's changes are marked: slide key → the keys of its elements that
 * were changed or added. A slide in the map was changed itself (its thumbnail
 * gets the marker) even when the set is empty (a new background, a removed
 * element). Deletions leave nothing to mark.
 */
export type DeckMarks = ReadonlyMap<string, ReadonlySet<string>>

export interface DeckChanges {
  marks: DeckMarks
  /** changed, added and removed elements, plus removed slides; 0 when only the order moved */
  count: number
}

export function deckChanges(before: DeckFingerprint, after: readonly RenderSlide[]): DeckChanges {
  const marks = new Map<string, Set<string>>()
  let count = 0
  const seen = new Set<string>()
  after.forEach((slide, index) => {
    const key = slideKey(slide, index)
    seen.add(key)
    const now = deckFingerprint([slide]).get(slideKey(slide, 0))!
    const was = before.get(key)
    const changed = new Set<string>()
    let slideChanged = !was || was.own !== now.own
    const added: NodePrint[] = []
    for (const [id, print] of now.nodes) {
      const old = was?.nodes.get(id)
      if (old?.print === print.print) continue
      changed.add(id)
      if (!old) added.push(print)
    }
    let removed = 0
    if (was) {
      for (const [id, print] of was.nodes) {
        if (now.nodes.has(id)) continue
        // the same element under a reissued id is already counted as changed
        const same = added.findIndex((a) => sameElement(a, print))
        if (same >= 0) added.splice(same, 1)
        else removed++
      }
    }
    count += changed.size + removed
    if (changed.size > 0 || removed > 0) slideChanged = true
    if (slideChanged) marks.set(key, changed)
  })
  for (const key of before.keys()) if (!seen.has(key)) count++
  return { marks, count }
}

/** The ids of the canvas nodes to mark on this slide (none when the slide is not marked) */
export function markedNodeIds(
  slide: RenderSlide | undefined,
  index: number,
  marks: DeckMarks | null,
): string[] {
  if (!slide || !marks) return []
  const keys = marks.get(slideKey(slide, index))
  if (!keys || keys.size === 0) return []
  return slide.nodes.filter((n) => !n.decoration && keys.has(nodeKey(n))).map((n) => n.sourceId)
}

/** The run's receipt on its chat entry */
export interface RunChanges {
  /** the main-process rollback point registered for the run */
  snapshotId: number
  state: AiChangesState
  count?: number
}

/**
 * A rollback to `snapshotId` worked: the deck went back to before that run, so
 * that run and every applied run after it (snapshot ids only grow) are undone.
 */
export function markRolledBack<E extends { changes?: RunChanges }>(
  entries: readonly E[],
  snapshotId: number,
): E[] {
  return entries.map((e) =>
    e.changes && e.changes.state === 'applied' && e.changes.snapshotId >= snapshotId
      ? { ...e, changes: { ...e.changes, state: 'reverted' } }
      : e,
  )
}

/** A rollback point is gone from the main-process ring (or could not be used now) */
export function markUnrevertable<E extends { changes?: RunChanges }>(
  entries: readonly E[],
  snapshotIds: ReadonlySet<number>,
  state: 'expired' | 'refused',
): E[] {
  return entries.map((e) =>
    e.changes && e.changes.state === 'applied' && snapshotIds.has(e.changes.snapshotId)
      ? { ...e, changes: { ...e.changes, state } }
      : e,
  )
}

/** Taking this run back also takes back applied AI runs after it */
export function revertsLater(
  entries: readonly { changes?: RunChanges }[],
  snapshotId: number,
): boolean {
  return entries.some(
    (e) => e.changes && e.changes.state === 'applied' && e.changes.snapshotId > snapshotId,
  )
}
