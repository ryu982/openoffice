import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { AddMarkStep, RemoveMarkStep } from '@tiptap/pm/transform'
import { OP_META, blockIndexRange, blockRange, type OpMeta } from './ops'

/** the shared look of a mark over what the AI changed (@genoffice/ui ai-changes.css) */
export const AI_MARK_CLASS = 'ai-changed-mark'

interface MarksState {
  set: DecorationSet
  /** an AI change since the last clear left nothing to mark (a deletion) */
  unmarked: boolean
}

const key = new PluginKey<MarksState>('aiHighlight')
const EMPTY: MarksState = { set: DecorationSet.empty, unmarked: false }

type Range = { from: number; to: number }

/**
 * Ranges (in tr.doc coordinates) an AI op transaction rewrote, read off its
 * step maps, and whether a step only took something out. A structural step
 * (heading conversion, wrap) only touches node boundary tokens where an inline
 * decoration paints nothing, so text-less ranges widen to the top-level
 * block(s) they sit in.
 */
function changedRanges(tr: Transaction): { ranges: Range[]; deleted: boolean } {
  const ranges: Range[] = []
  let deleted = false
  const push = (from: number, to: number) => {
    if (to <= from) return
    let inline = false
    tr.doc.nodesBetween(from, to, (node) => {
      if (node.isInline) inline = true
      return !inline
    })
    if (inline) return ranges.push({ from, to })
    const { startIndex, endIndex } = blockIndexRange(tr.doc, from, to)
    ranges.push(blockRange(tr.doc, startIndex, endIndex))
  }
  tr.steps.forEach((step, i) => {
    const rest = tr.mapping.slice(i + 1)
    // mark steps do not move positions, so their step map is empty — use the step's own range
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      push(rest.map(step.from, 1), rest.map(step.to, -1))
      return
    }
    step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (newEnd === newStart && oldEnd > oldStart) deleted = true
      push(rest.map(newStart, 1), rest.map(newEnd, -1))
    })
  })
  return { ranges, deleted }
}

/** Take every mark of the AI's changes off the document */
export function clearAiHighlights(editor: Editor): void {
  if (editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta('aiHighlightClear', true))
}

/** What the marks show now */
export interface AiMarks {
  /** something is marked */
  shown: boolean
  /** top-level blocks a mark sits in */
  blocks: number
  /** an AI change since the last clear has no mark (a deletion), so `blocks` undercounts */
  unmarked: boolean
}

export function aiMarks(state: EditorState): AiMarks {
  const marks = key.getState(state) ?? EMPTY
  const blocks = new Set<number>()
  for (const deco of marks.set.find()) {
    blocks.add(state.doc.resolve(Math.min(deco.from, state.doc.content.size)).index(0))
  }
  return { shown: blocks.size > 0, blocks: blocks.size, unmarked: marks.unmarked }
}

/**
 * The wash over content the AI wrote (every transaction an AI-sourced runOps
 * dispatches). It stays after the run, until the panel clears it: the next
 * run starts, the person takes the marks off or the run back, or a new chat
 * begins. Display-only: decorations never touch the document, the serialized
 * markdown or the clipboard, and the print/export clone drops their spans.
 */
export const AiHighlight = Extension.create({
  name: 'aiHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<MarksState>({
        key,
        state: {
          init: () => EMPTY,
          apply(tr, marks) {
            if (tr.getMeta('aiHighlightClear')) return EMPTY
            let next = marks.set.map(tr.mapping, tr.doc)
            let unmarked = marks.unmarked
            const meta = tr.getMeta(OP_META) as OpMeta | undefined
            if (meta?.source === 'ai' && !meta.rollback && tr.docChanged) {
              const { ranges, deleted } = changedRanges(tr)
              if (deleted) unmarked = true
              for (const range of ranges) {
                const from = Math.max(0, Math.min(range.from, tr.doc.content.size))
                const to = Math.max(from, Math.min(range.to, tr.doc.content.size))
                if (to > from) {
                  next = next.add(tr.doc, [Decoration.inline(from, to, { class: AI_MARK_CLASS })])
                }
              }
            }
            return next === marks.set && unmarked === marks.unmarked
              ? marks
              : { set: next, unmarked }
          },
        },
        props: {
          decorations(state) {
            return key.getState(state)?.set
          },
        },
      }),
    ]
  },
})
