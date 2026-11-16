/**
 * A run of an editor's AI that the app stopped by its own rule (the model's
 * edits were unusable turn after turn, they kept failing, or it went in
 * circles), as one line of the crash record on this PC. The stopped run is
 * dropped from the conversation, so without this line nothing tells later
 * which rule and which fault it was. What arrives comes from a renderer and is
 * read as unknown: only the known kinds, the known fault words with their
 * counts, one tool name of identifier shape, and two small numbers go through.
 */
import type { CrashEntry } from './crash-log'

const KINDS = ['tool-input', 'tool-errors', 'repeating'] as const
const FAULTS = ['truncated', 'unparseable', 'missing', 'invalid'] as const
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
const MOST = 999

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? Math.min(value, MOST)
    : null
}

/** the crash-record entry for `stop`, or null for anything that is not one */
export function runStopEntry(editor: string, stop: unknown): CrashEntry | null {
  if (typeof stop !== 'object' || stop === null) return null
  const raw = stop as Record<string, unknown>
  const kind = KINDS.find((known) => known === raw.kind)
  if (!kind) return null
  const faults =
    typeof raw.faults === 'object' && raw.faults !== null
      ? (raw.faults as Record<string, unknown>)
      : {}
  const cause = FAULTS.flatMap((fault) => {
    const n = count(faults[fault])
    return n ? [`${fault}:${n}`] : []
  }).join(' ')
  const tool = Array.isArray(raw.tools)
    ? raw.tools.find((name): name is string => typeof name === 'string' && TOOL_NAME.test(name))
    : undefined
  const executed = count(raw.executed)
  return {
    kind: 'ai-run-stop',
    reason: kind,
    editor,
    ...(cause ? { cause } : {}),
    ...(tool ? { tool } : {}),
    ...(executed !== null ? { executed } : {}),
    changed: raw.mutated === true ? 1 : 0,
  }
}
