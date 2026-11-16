import type { AgentRunStop, ToolInputFault } from '@genoffice/agent-core'
import type { Lang } from '@genoffice/i18n'
import { AI_RUN_STOP_LABELS } from './strings-run-stop'

/**
 * A run the loop stopped by its own rule (AgentRunStop), as the AI panel shows
 * it: why, in the screen language; what the person can do next; and one line of
 * plain words and counts that tells a report which rule and which fault it was.
 */
export interface RunStopNotice {
  readonly reason: string
  /** tool-input only: what was wrong with what the model sent */
  readonly cause?: string
  readonly next: string
  /** the run had changed the document: going on from there is offered */
  readonly canContinue: boolean
  /** not translated: 'tool-input: truncated 2, missing 1 (insert_table); 4 calls ran' */
  readonly code: string
}

const FAULT_ORDER: readonly ToolInputFault[] = ['truncated', 'unparseable', 'missing', 'invalid']

export function runStopNotice(stop: AgentRunStop, lang: Lang): RunStopNotice {
  const labels = AI_RUN_STOP_LABELS[lang] ?? AI_RUN_STOP_LABELS.en
  const faults = stop.faults ?? {}
  const causes =
    stop.kind === 'tool-input'
      ? [
          ...(faults.truncated ? [labels.truncated] : []),
          ...(faults.unparseable || faults.missing || faults.invalid ? [labels.malformed] : []),
        ]
      : []
  return {
    reason:
      stop.kind === 'tool-input'
        ? labels.toolInput
        : stop.kind === 'tool-errors'
          ? labels.toolErrors
          : labels.repeating,
    ...(causes.length > 0 ? { cause: causes.join(' ') } : {}),
    next: stop.mutated ? labels.keptChanges : labels.unchanged,
    canContinue: stop.mutated,
    code: runStopCode(stop),
  }
}

/** The stop in words and counts only; safe to show, copy and keep. */
export function runStopCode(stop: AgentRunStop): string {
  const faults = FAULT_ORDER.flatMap((fault) =>
    stop.faults?.[fault] ? [`${fault} ${stop.faults[fault]}`] : [],
  )
  const tools = stop.tools && stop.tools.length > 0 ? ` (${stop.tools.join(', ')})` : ''
  return `${stop.kind}${faults.length > 0 ? `: ${faults.join(', ')}` : ''}${tools}; ${stop.executed} ${
    stop.executed === 1 ? 'call' : 'calls'
  } ran`
}

/** The notice as one text, for a panel that shows an error as a single message. */
export function runStopText(stop: AgentRunStop, lang: Lang): string {
  const notice = runStopNotice(stop, lang)
  return [notice.reason, notice.cause, notice.next, `(${notice.code})`]
    .filter((line): line is string => !!line)
    .join('\n\n')
}

/**
 * What the app tells the model when the person presses Continue: the request
 * goes again, word for word, and this goes with it. The model's earlier turns
 * were dropped with the stopped run, so without it the model would start over
 * and write a second copy of what is already in the document.
 */
export function runContinueNote(stop: AgentRunStop): string {
  const faults = stop.faults ?? {}
  return [
    '[Note from the app, not written by the person] An earlier run of this same request was stopped part-way, after it had already changed the document. Those changes are still in the document.',
    'Read the document as it is now, work out which parts of the request are already done, and do only what is left. Do not add again what is already there.',
    ...(faults.truncated
      ? [
          'That run was stopped because the arguments of a tool call were cut off by the output length limit. Keep every tool call small: a few paragraphs or one table per call.',
        ]
      : []),
    ...(faults.unparseable || faults.missing || faults.invalid
      ? [
          'That run was stopped because tool arguments were malformed or incomplete. Put every required argument in the tool call itself, as valid JSON.',
        ]
      : []),
  ].join(' ')
}
