/**
 * One generate_image call a tab's AI run asked for. Such a call can run a
 * subscription program, so it goes by the same rules as the run itself:
 * refused while AI is turned off in Settings, and counted as running AI work
 * (one step of the tab's chat turn) so that turning AI off stops it. The
 * stop is the existing one, the tab's media calls ending (`abortMediaCalls`).
 */
import { abortMediaCalls, withMediaCallSignal, type MediaCallSender } from '@genoffice/ai-search'
import { registerAiJob } from '@genoffice/electron-utils/ai-activity'
import { aiRunRefusal } from '@genoffice/electron-utils/ai-run-guard'

export function screenMediaCall<T>(
  sender: MediaCallSender,
  run: (signal: AbortSignal) => T | Promise<T>,
  refused: (error: string) => T,
): Promise<T> {
  // no chat provider here: only the checks that refuse every run (AI turned off) can answer
  const refusal = aiRunRefusal({ senderId: sender.id, provider: '', model: '' })
  if (refusal) return Promise.resolve(refused(refusal))
  const unregister = registerAiJob({ kind: 'chat', stop: () => abortMediaCalls(sender.id) })
  return withMediaCallSignal(sender, run).finally(unregister)
}
