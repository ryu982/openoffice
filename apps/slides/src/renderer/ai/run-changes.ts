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
import type { AiChangeLine, AiChangesState } from '@genoffice/ui'

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

/** One detailed change line in the Slides changes card, pointing at a slide/element when jumpable. */
export interface SlideChangeLine extends AiChangeLine {
  slideIndex?: number
  nodeKeyId?: string
}

export interface DeckChanges {
  marks: DeckMarks
  /** changed, added and removed elements, plus removed slides; 0 when only the order moved */
  count: number
  /** detailed rows rendered in AiChangesCard */
  lines: SlideChangeLine[]
}

const MAX_SLIDE_CHANGE_LINES = 50
const SLIDE_TEXT_MAX = 56

function nodeSummary(node: RenderNode): string {
  const n = node as unknown as {
    paragraphs?: Array<{ runs?: Array<{ text?: string }> }>
    text?: string
    type?: string
  }
  const paraText = n.paragraphs
    ?.flatMap((p) => p.runs?.map((r) => r.text ?? '') ?? [])
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const raw = paraText || (typeof n.text === 'string' ? n.text.replace(/\s+/g, ' ').trim() : '')
  if (raw) return raw.length > SLIDE_TEXT_MAX ? `${raw.slice(0, SLIDE_TEXT_MAX - 1)}…` : raw
  return n.type ?? 'element'
}

export function deckChanges(before: DeckFingerprint, after: readonly RenderSlide[]): DeckChanges {
  const marks = new Map<string, Set<string>>()
  const lines: SlideChangeLine[] = []
  const pushLine = (line: SlideChangeLine) => {
    if (lines.length < MAX_SLIDE_CHANGE_LINES) lines.push(line)
  }
  let count = 0
  const seen = new Set<string>()
  after.forEach((slide, index) => {
    const key = slideKey(slide, index)
    seen.add(key)
    const now = deckFingerprint([slide]).get(slideKey(slide, 0))!
    const was = before.get(key)
    const changed = new Set<string>()
    let slideChanged = !was || was.own !== now.own
    const added: Array<{ id: string; print: NodePrint; node: RenderNode | undefined }> = []
    const edited: Array<{ id: string; node: RenderNode | undefined }> = []
    const nodeByKey = new Map<string, RenderNode>()
    for (const n of slide.nodes) {
      if (!n.decoration) nodeByKey.set(nodeKey(n), n)
    }
    for (const [id, print] of now.nodes) {
      const old = was?.nodes.get(id)
      if (old?.print === print.print) continue
      changed.add(id)
      if (!old) added.push({ id, print, node: nodeByKey.get(id) })
      else edited.push({ id, node: nodeByKey.get(id) })
    }
    let removed = 0
    const removedTypes: string[] = []
    if (was) {
      for (const [id, print] of was.nodes) {
        if (now.nodes.has(id)) continue
        // the same element under a reissued id is already counted as changed
        const same = added.findIndex((a) => sameElement(a.print, print))
        if (same >= 0) {
          const matched = added.splice(same, 1)[0]!
          edited.push({ id: matched.id, node: matched.node })
        } else {
          removed++
          removedTypes.push(print.type)
        }
      }
    }
    count += changed.size + removed
    if (changed.size > 0 || removed > 0) slideChanged = true
    if (slideChanged) {
      marks.set(key, changed)
      const slideTag = `#${index + 1}`
      for (const item of added) {
        pushLine({
          kind: 'insert',
          to: `${slideTag} ${item.node ? nodeSummary(item.node) : item.print.type}`,
          showable: true,
          slideIndex: index,
          nodeKeyId: item.id,
        })
      }
      for (const item of edited) {
        pushLine({
          kind: 'named',
          from: slideTag,
          to: item.node ? nodeSummary(item.node) : 'element',
          showable: true,
          slideIndex: index,
          nodeKeyId: item.id,
        })
      }
      for (const rType of removedTypes) {
        pushLine({
          kind: 'delete',
          from: `${slideTag} ${rType}`,
          showable: false,
        })
      }
      if (added.length === 0 && edited.length === 0 && removedTypes.length === 0) {
        pushLine({
          kind: !was ? 'insert' : 'named',
          ...(was ? { from: slideTag } : {}),
          to: slideTag,
          showable: true,
          slideIndex: index,
        })
      }
    }
  })
  for (const key of before.keys()) {
    if (!seen.has(key)) {
      count++
      pushLine({
        kind: 'delete',
        from: key,
        showable: false,
      })
    }
  }
  return { marks, count, lines }
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
  lines?: SlideChangeLine[]
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
