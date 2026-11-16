/**
 * The checks the shell puts in front of every editor's AI run (decision 0085).
 * The editors' main code asks once a request's provider is known; the shell
 * answers with a refusal to show, or null to let the run go. Each check has a
 * name, so the shell's parts set and clear their own without dropping the
 * others: today "drive" refuses a free connection for a tab whose document
 * is a copy of a Google Drive file (a free tier may train on what it gets),
 * and "ai-off" refuses every run while AI is turned off in Settings. With no
 * check set (an editor running on its own) every run goes.
 *
 * Only the editors' IPC handlers ask, so the sender is always an app screen;
 * work the terminal command or MCP starts does not pass through here.
 */

export interface AiRunGuardInput {
  /** the webContents that sent the request */
  senderId: number
  /** the provider the run would use */
  provider: string
  /** its model, '' when the provider's default */
  model: string
}

export type AiRunGuard = (input: AiRunGuardInput) => string | null

/** in the order they were first set; setting a name again keeps its place */
const guards = new Map<string, AiRunGuard>()

/** Set the check called `name`, or clear it with null */
export function setAiRunGuard(name: string, next: AiRunGuard | null): void {
  if (next) guards.set(name, next)
  else guards.delete(name)
}

/** The first refusal any check gives for this run, or null when it may go */
export function aiRunRefusal(input: AiRunGuardInput): string | null {
  for (const guard of guards.values()) {
    const refusal = guard(input)
    if (refusal) return refusal
  }
  return null
}
