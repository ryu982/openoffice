import React from 'react'
import type { Lang } from '@genoffice/i18n'
import { AI_CHANGES_LABELS, type AiChangesLabels } from './strings-ai-changes'
import './ai-changes.css'

/**
 * Where a run that changed the document stands:
 * - `applied`: the changes are in the document and can be taken back from the card
 * - `reverted`: the card took them back
 * - `partial`: the card took them back, but not all of them
 * - `refused`: the editor could not take them back in one step (edited since, history moved)
 * - `expired`: the run's undo point is gone (saved over, pushed out by newer runs)
 */
export type AiChangesState = 'applied' | 'reverted' | 'partial' | 'refused' | 'expired'

/**
 * One change as a line of the card. `insert` and `delete` show one text,
 * `replace` strikes the old text through before the new one, and `named` names
 * what the change was done to (a field, a format, a cell range) before its new
 * value, without striking it, because that thing stays.
 */
export interface AiChangeLine {
  readonly kind: 'insert' | 'delete' | 'replace' | 'named'
  readonly from?: string
  readonly to?: string
  /** how many places this line stands for, shown as ×n above one */
  readonly count?: number
  /** a sign after the + of an insert, e.g. ▦ for a table */
  readonly glyph?: string
  /** the editor can show this place in the document */
  readonly showable?: boolean
}

/** The labels for one language, with the undo key of this platform in the notes. */
export function aiChangesLabels(lang: Lang, mac = isMac()): AiChangesLabels {
  const labels = AI_CHANGES_LABELS[lang] ?? AI_CHANGES_LABELS.en
  if (!mac) return labels
  const key = (text: string): string => text.replace('Ctrl+Z', '⌘Z')
  return {
    ...labels,
    refused: key(labels.refused),
    expired: key(labels.expired),
  }
}

/** the title of the card: how many places, or that it was taken back */
export function aiChangesTitle(
  labels: AiChangesLabels,
  state: AiChangesState,
  count: number | undefined,
): string {
  if (state === 'reverted' || state === 'partial') return labels.reverted
  return count !== undefined && count > 0 ? labels.changedCount(count) : labels.changed
}

/** the note under the card, if its state needs one */
export function aiChangesNote(labels: AiChangesLabels, state: AiChangesState): string | null {
  if (state === 'refused') return labels.refused
  if (state === 'expired') return labels.expired
  if (state === 'partial') return labels.partial
  return null
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform ?? '')
}

/**
 * The card under the AI reply of a run that changed the document. Every
 * editor shows the same one: how many places the run changed, a button that
 * takes the marks off the document while they are shown, a button that takes
 * the whole run back, and, where the editor lists the changes, one line per
 * change that shows its place when clicked.
 */
export function AiChangesCard({
  lang,
  state,
  count,
  lines,
  canRevert,
  revertsLater = false,
  onRevert,
  onClearMarks,
  onShowLine,
}: {
  readonly lang: Lang
  readonly state: AiChangesState
  /** how many places the run changed; absent where the editor cannot count them */
  readonly count?: number | undefined
  /** the changes, one per line; absent where the editor does not list them */
  readonly lines?: readonly AiChangeLine[] | undefined
  /** the revert button works now (not busy, still the run's undo point) */
  readonly canRevert: boolean
  /** taking this run back also takes back the AI runs after it */
  readonly revertsLater?: boolean
  readonly onRevert?: (() => void) | undefined
  /** set while the editor marks these changes on the document */
  readonly onClearMarks?: (() => void) | null | undefined
  /** shows the place of the line at this index */
  readonly onShowLine?: ((index: number) => void) | undefined
}): React.JSX.Element {
  const labels = aiChangesLabels(lang)
  const note = aiChangesNote(labels, state)
  const undone = state === 'reverted' || state === 'partial'
  return (
    <div className="ai-run-changes" data-state={state} role="group">
      <div className="ai-run-changes-head">
        <span className="ai-run-changes-title">{aiChangesTitle(labels, state, count)}</span>
        {onClearMarks && state === 'applied' && (
          <button
            type="button"
            className="ai-run-changes-unmark"
            data-action="ai-changes-unmark"
            onClick={onClearMarks}
          >
            {labels.clearMarks}
          </button>
        )}
        {state === 'applied' && onRevert && (
          <button
            type="button"
            className="ai-run-changes-revert"
            data-action="ai-changes-revert"
            title={revertsLater ? labels.revertLaterTitle : labels.revertTitle}
            disabled={!canRevert}
            onClick={onRevert}
          >
            {labels.revert}
          </button>
        )}
      </div>
      {lines && lines.length > 0 && (
        <ul className="ai-run-changes-list">
          {lines.map((line, index) => (
            <li key={index} className="ai-run-change" dir="auto">
              {line.showable && !undone && onShowLine ? (
                // a place that was taken back is no longer there to show
                <button
                  type="button"
                  className="ai-run-change-go"
                  title={labels.showChange}
                  onClick={() => onShowLine(index)}
                >
                  <AiChangeLineText line={line} />
                </button>
              ) : (
                <AiChangeLineText line={line} />
              )}
            </li>
          ))}
        </ul>
      )}
      {note && (
        <div className="ai-run-changes-note" role="status">
          {note}
        </div>
      )}
    </div>
  )
}

/** One change as a line: what went (struck through), what came, marked the same in every language. */
function AiChangeLineText({ line }: { readonly line: AiChangeLine }): React.JSX.Element {
  if (line.kind === 'insert') {
    return (
      <>
        <span className="ai-run-change-mark" aria-hidden>
          {line.glyph ? `+ ${line.glyph}` : '+'}
        </span>
        <ins className="ai-run-change-to">{line.to}</ins>
        <Times count={line.count} />
      </>
    )
  }
  if (line.kind === 'delete') {
    return (
      <>
        <span className="ai-run-change-mark" aria-hidden>
          −
        </span>
        <del className="ai-run-change-from">{line.from}</del>
        <Times count={line.count} />
      </>
    )
  }
  return (
    <>
      {line.kind === 'named' ? (
        // named, not struck through: this stays, it is what the change was done to
        <span className="ai-run-change-name">{line.from}</span>
      ) : (
        <del className="ai-run-change-from">{line.from}</del>
      )}
      <span className="ai-run-change-arrow" aria-hidden>
        →
      </span>
      <ins className="ai-run-change-to">{line.to}</ins>
      <Times count={line.count} />
    </>
  )
}

function Times({ count }: { readonly count: number | undefined }): React.JSX.Element | null {
  return count !== undefined && count > 1 ? (
    <span className="ai-run-change-count">×{count}</span>
  ) : null
}
