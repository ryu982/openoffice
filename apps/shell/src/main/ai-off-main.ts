import type { Lang } from '@genoffice/i18n'
import type { AppChoice } from '@genoffice/electron-utils/app-choice'
import { aiOffText } from '../renderer/src/i18n/strings-ai-off'

/**
 * The shell's side of turning AI features off and back on (editor choice
 * spec 8). The choice itself, the "ai-off" run check and stopping the running
 * jobs live in editor-choice-main.ts; this answers what changes beyond that:
 * the windows that only show AI close when it goes off, and the background
 * work held back meanwhile catches up once when it comes back (spec 8.5: one
 * subscription status check). Electron-free, so tests drive it directly.
 */

export interface AiFeaturesWatchDeps {
  /** the choice as the shell keeps it (registerEditorChoiceIpc's service) */
  choice: {
    effective(): AppChoice
    onChange(listener: (choice: AppChoice) => void): () => void
  }
  /** AI went off: close what shows AI outside the editors (the agent window) */
  turnedOff(): void
  /** AI came back on: check the subscriptions once and catch up on the rest */
  turnedOn(): void
}

/** Act on every switch of AI features, once per switch; returns the unsubscribe */
export function watchAiFeatures(deps: AiFeaturesWatchDeps): () => void {
  let on = deps.choice.effective().aiFeatures
  return deps.choice.onChange((choice) => {
    if (choice.aiFeatures === on) return
    on = choice.aiFeatures
    if (on) deps.turnedOn()
    else deps.turnedOff()
  })
}

/** What an AI run a screen starts gets while AI features are off, in the screen language */
export function aiOffRefusalText(lang: Lang): string {
  return aiOffText(lang, 'refusal')
}
