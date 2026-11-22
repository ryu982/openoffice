import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { AiChangeLine, AiChangesState } from '@genoffice/ui'
import { TRACK_IGNORE } from '../editor/revisions'

/**
 * The yellow marks over what the last AI run changed are the `aiChanged` attr
 * of its blocks: screen only. They are never written (the save plan does not
 * read the attr), never printed (the rule is screen media) and never exported
 * (the HTML export lifts `.ai-marks`), and copying takes them off the slice.
 */

/** Meta of the transaction that takes the marks off: not an edit, so not dirty. */
export const AI_MARKS_CLEAR = 'aiMarksClear'

/** Whether a transaction only took the AI marks off (the app does not count it as an edit). */
export function isAiMarksClear(tr: Transaction): boolean {
  return tr.getMeta(AI_MARKS_CLEAR) === true
}

/** How many top-level blocks carry a mark of the run, in themselves or inside them. */
export function countAiMarkedBlocks(doc: ProseMirrorNode): number {
  let count = 0
  doc.forEach((block) => {
    let marked = block.attrs.aiChanged === true
    if (!marked) {
      block.descendants((node) => {
        if (marked) return false
        if (node.attrs.aiChanged === true) marked = true
        return !marked
      })
    }
    if (marked) count++
  })
  return count
}

/**
 * The transaction that takes every AI mark off the document, or null when there
 * is none. It is no step of the undo history, no tracked revision and no edit.
 */
export function clearAiMarksTransaction(state: EditorState): Transaction | null {
  let tr = state.tr
  let touched = false
  state.doc.descendants((node, pos) => {
    if (node.attrs.aiChanged === true) {
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, aiChanged: false })
      touched = true
    }
  })
  if (!touched) return null
  return tr.setMeta('addToHistory', false).setMeta(TRACK_IGNORE, true).setMeta(AI_MARKS_CLEAR, true)
}

function unmarkedFragment(fragment: Fragment): Fragment {
  let changed = false
  const nodes: ProseMirrorNode[] = []
  fragment.forEach((node) => {
    const content = unmarkedFragment(node.content)
    const marked = node.attrs.aiChanged === true
    if (!marked && content === node.content) {
      nodes.push(node)
      return
    }
    changed = true
    nodes.push(
      node.type.create(
        marked ? { ...node.attrs, aiChanged: false } : node.attrs,
        content,
        node.marks,
      ),
    )
  })
  return changed ? Fragment.fromArray(nodes) : fragment
}

/** The document without the AI marks: what a save compares with the file it wrote. */
export function docWithoutAiMarks(doc: ProseMirrorNode): ProseMirrorNode {
  const content = unmarkedFragment(doc.content)
  return content === doc.content ? doc : doc.type.create(doc.attrs, content, doc.marks)
}

/** A copied slice without the AI marks: the clipboard carries the text, not the screen. */
export function sliceWithoutAiMarks(slice: Slice): Slice {
  const content = unmarkedFragment(slice.content)
  return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd)
}

/** One detailed line inside the Word AI changes card, carrying a target block index when jumpable. */
export interface DocsChangeLine extends AiChangeLine {
  readonly blockIndex?: number
}

/** What one run's card says: the run's changes and where they stand. */
export interface DocsRunChanges {
  state: 'applied' | 'reverted'
  /** blocks the run marked; absent where the marks do not count them (tracked changes) */
  count?: number
  /** per-block or per-edit rows shown in the card */
  lines?: DocsChangeLine[]
}

const MAX_CHANGE_LINES = 50
const SUMMARY_MAX_CHARS = 64

function clipLineSummary(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return '—'
  return clean.length > SUMMARY_MAX_CHARS ? `${clean.slice(0, SUMMARY_MAX_CHARS - 1)}…` : clean
}

/** Collect jumpable change lines for every top-level block carrying an `aiChanged` mark. */
export function collectAiMarkedChangeLines(doc: ProseMirrorNode): DocsChangeLine[] {
  const lines: DocsChangeLine[] = []
  let idx = 0
  doc.forEach((block) => {
    const blockIndex = idx++
    if (lines.length >= MAX_CHANGE_LINES) return
    let marked = block.attrs.aiChanged === true
    if (!marked) {
      block.descendants((node) => {
        if (marked) return false
        if (node.attrs.aiChanged === true) marked = true
        return !marked
      })
    }
    if (!marked) return
    lines.push({
      kind: 'named',
      from: `#${blockIndex + 1}`,
      to: clipLineSummary(block.textContent),
      showable: true,
      blockIndex,
    })
  })
  return lines
}

/** Build a fallback change line from a mutating Docs tool call (used under tracked changes or non-block edits). */
export function docChangeLineFromTool(
  name: string,
  input: Record<string, unknown>,
  summary: string,
): DocsChangeLine {
  let blockIndex: number | undefined
  if (
    typeof input.blockIndex === 'number' &&
    Number.isInteger(input.blockIndex) &&
    input.blockIndex >= 0
  ) {
    blockIndex = input.blockIndex
  } else if (
    typeof input.startBlockIndex === 'number' &&
    Number.isInteger(input.startBlockIndex) &&
    input.startBlockIndex >= 0
  ) {
    blockIndex = input.startBlockIndex
  } else if (
    typeof input.afterBlockIndex === 'number' &&
    Number.isInteger(input.afterBlockIndex)
  ) {
    blockIndex = Math.max(0, input.afterBlockIndex + 1)
  }
  const clipped = clipLineSummary(summary)
  const isInsert = name.startsWith('insert_') || name.startsWith('add_') || name === 'write_document'
  const isDelete = name.startsWith('delete_')
  if (isInsert) {
    return {
      kind: 'insert',
      to: blockIndex !== undefined ? `#${blockIndex + 1} ${clipped}` : clipped,
      showable: blockIndex !== undefined,
      ...(blockIndex !== undefined ? { blockIndex } : {}),
    }
  }
  if (isDelete) {
    return {
      kind: 'delete',
      from: blockIndex !== undefined ? `#${blockIndex + 1} ${clipped}` : clipped,
      showable: blockIndex !== undefined,
      ...(blockIndex !== undefined ? { blockIndex } : {}),
    }
  }
  return {
    kind: 'named',
    from: blockIndex !== undefined ? `#${blockIndex + 1}` : name,
    to: clipped,
    showable: blockIndex !== undefined,
    ...(blockIndex !== undefined ? { blockIndex } : {}),
  }
}

/** The card's state: an applied run whose roll-back point was released can no longer be taken back. */
export function runChangesState(changes: DocsRunChanges, snapshot: unknown): AiChangesState {
  return changes.state === 'applied' && snapshot === undefined ? 'expired' : changes.state
}

interface RunEntry {
  changes?: DocsRunChanges
  snapshot?: unknown
}

/** Whether a run after this entry is still in the document: rolling this one back takes it too. */
export function hasLaterAppliedRun(entries: readonly RunEntry[], index: number): boolean {
  for (let i = index + 1; i < entries.length; i++) {
    const entry = entries[i]!
    if (entry.changes?.state === 'applied' && entry.snapshot !== undefined) return true
  }
  return false
}

/**
 * The transcript after the document went back to before the run at `index`:
 * that run and every later one are taken back, and their roll-back points now
 * describe discarded futures.
 */
export function afterRollback<T extends RunEntry>(entries: readonly T[], index: number): T[] {
  return entries.map((entry, i) => {
    if (i < index || (!entry.snapshot && entry.changes?.state !== 'applied')) return entry
    return {
      ...entry,
      snapshot: undefined,
      ...(entry.changes?.state === 'applied'
        ? { changes: { ...entry.changes, state: 'reverted' as const } }
        : {}),
    }
  })
}
