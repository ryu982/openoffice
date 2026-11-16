/**
 * The docs main process's side of the AI-off switch (Settings › Editors and
 * AI) for the AI calls a screen starts outside a chat stream: picture
 * generation and media analysis, which can start a subscription program.
 * Electron-free: the abort helper is passed in.
 */
import { registerAiJob } from '@genoffice/electron-utils/ai-activity'
import { aiFeaturesOn } from '@genoffice/electron-utils/app-choice'

/** what a refused call answers; a tool result the model reads, so it stays English */
export const AI_OFF_ERROR = 'AI features are turned off in Settings.'

/**
 * Run a screen's media call (generate_image, analyze_media) as one running AI
 * job, or refuse it while AI is off. `stop` is the tab's existing stop path
 * (ending its media calls ends the subscription program the call started).
 */
export async function aiMediaCall<T>(
  stop: () => void,
  run: () => Promise<T>,
): Promise<T | { error: string }> {
  if (!aiFeaturesOn()) return { error: AI_OFF_ERROR }
  const end = registerAiJob({ kind: 'chat', stop })
  try {
    return await run()
  } finally {
    end()
  }
}
