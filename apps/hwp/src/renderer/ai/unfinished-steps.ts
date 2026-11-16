/**
 * Which edits of a run were left undone. A model may answer "done" after a tool refused,
 * so the panel decides from the tool results themselves and says so under the reply.
 */
import { HWP_EDIT_TOOLS } from './hwp-skill'

/** One tool call of a run, as the panel saw it executed. */
export interface RunStep {
  name: string
  input: Record<string, unknown>
  isError?: boolean
  /** the step's label in the activity list */
  summary: string
}

/**
 * The arguments that say what an edit was about. A later call with the same ones did that
 * edit; the others (occurrence, the new text, overwrite) are how it was finally done.
 */
const TARGET_ARGS = [
  'find',
  'anchor',
  'after',
  'from',
  'table',
  'field',
  'note',
  'equation',
  'picture',
  'name',
  'title',
  'look',
  'kind',
] as const

/** What an edit was about: its tool and the target arguments it was called with. */
function targetOf(step: RunStep): string {
  return JSON.stringify([step.name, ...TARGET_ARGS.map((key) => step.input[key] ?? null)])
}

/**
 * The failed edits of a run that no later call made good: a refused edit is made good when
 * the same tool succeeded afterwards on the same target (an ambiguous find answered with an
 * occurrence, a refusal repeated on purpose). Read-only tools and other skills' tools are
 * left out. In run order, one entry for each target.
 */
export function unfinishedSteps(steps: readonly RunStep[]): RunStep[] {
  const left = new Map<string, RunStep>()
  for (const step of steps) {
    if (!HWP_EDIT_TOOLS.has(step.name)) continue
    const target = targetOf(step)
    if (step.isError) {
      if (!left.has(target)) left.set(target, step)
    } else {
      left.delete(target)
    }
  }
  return [...left.values()]
}
