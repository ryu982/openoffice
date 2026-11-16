/**
 * What one AI run changed in the book: the history entries its edit_blocks
 * calls became (what the changes card takes back) and the blocks they
 * changed (what the card counts and the reader marks). The panel records
 * them by wrapping the edit controller the tools see; nothing here touches
 * the book or what the model is sent.
 */
import type { AiChangesState } from '@genoffice/ui'
import type { EditGroup, EditGroupsOutcome, UndoEntriesOutcome } from '../edit/controller'
import type { BookAiEditor, BookAiHost } from './book-tools'

/** The blocks to mark, by chapter (spine index): replaced and inserted ones (deleted ones are gone). */
export type BookMarks = ReadonlyMap<number, ReadonlySet<string>>

/** One run's changes while it runs */
export interface RunRecord {
  /** history entries in the order they were made */
  entries: number[]
  marks: Map<number, Set<string>>
  /** changed blocks, keyed `<spine>:<id>` for replaced ones; inserted and deleted ones each count */
  changed: Set<string>
}

export function emptyRunRecord(): RunRecord {
  return { entries: [], marks: new Map(), changed: new Set() }
}

/** Notes one applyEditGroups answer in the run's record. */
export function recordOutcome(
  record: RunRecord,
  groups: readonly EditGroup[],
  outcome: EditGroupsOutcome,
): void {
  if (outcome.entry !== undefined) record.entries.push(outcome.entry)
  const unused = [...groups]
  for (const result of outcome.results) {
    // the group each result answers: the first one left for its chapter
    const at = unused.findIndex((g) => g.spineIndex === result.spineIndex)
    if (at < 0 || result.replacements.length === 0) continue
    const group = unused.splice(at, 1)[0]!
    const alive = new Set(result.blocks.map((b) => b.id))
    let marks = record.marks.get(result.spineIndex)
    if (!marks) record.marks.set(result.spineIndex, (marks = new Set()))
    for (const edit of group.edits) {
      const key = `${result.spineIndex}:${edit.blockId}`
      if (edit.op === 'delete') {
        marks.delete(edit.blockId)
        record.changed.add(`${key}:deleted`)
      } else if (edit.op === 'replace') {
        record.changed.add(key)
        if (alive.has(edit.blockId)) marks.add(edit.blockId)
      }
    }
    for (const id of result.created) {
      record.changed.add(`${result.spineIndex}:${id}:created`)
      if (alive.has(id)) marks.add(id)
    }
    if (marks.size === 0) record.marks.delete(result.spineIndex)
  }
}

/** The editor the tools see, noting every edit they make into the current run's record. */
export function recordingHost(host: BookAiHost, record: () => RunRecord): BookAiHost {
  return {
    ...host,
    editor: (): BookAiEditor => {
      const editor = host.editor()
      return {
        get isLocked() {
          return editor.isLocked
        },
        flush: () => editor.flush(),
        applyEditGroups: async (groups, options) => {
          const outcome = await editor.applyEditGroups(groups, options)
          recordOutcome(record(), groups, outcome)
          return outcome
        },
      }
    },
  }
}

/** The run's receipt on its chat entry */
export interface RunChanges {
  entries: readonly number[]
  state: AiChangesState
  count?: number
}

/** The receipt of a finished run; null when it changed nothing. */
export function runChangesOf(record: RunRecord): RunChanges | null {
  if (record.entries.length === 0) return null
  const count = record.changed.size
  return { entries: [...record.entries], state: 'applied', ...(count > 0 ? { count } : {}) }
}

/** The card's state after a revert; null keeps it as it was (not now: the book is being translated). */
export function stateAfterUndo(outcome: UndoEntriesOutcome): AiChangesState | null {
  return outcome === 'locked' ? null : outcome
}
