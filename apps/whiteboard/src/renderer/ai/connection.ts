import type { IpcStreamError, IpcStreamErrorCause } from '@genoffice/agent-core'
import type { AiSubscriptionUsage } from '@genoffice/ai-provider/browser'
import { isAiBlockedRunKind } from '@genoffice/ui'

export interface BlockedRun extends IpcStreamErrorCause {
  message: string
}

export function blockedRunOf(error: IpcStreamError | null | undefined): BlockedRun | null {
  if (!error || !isAiBlockedRunKind(error.kind)) return null
  return {
    kind: error.kind,
    ...(error.provider ? { provider: error.provider } : {}),
    ...(error.resetsAt !== undefined ? { resetsAt: error.resetsAt } : {}),
    message: error.message,
  }
}

export function blockedRunFor(
  message: string,
  error: IpcStreamError | null | undefined,
): BlockedRun | null {
  return error?.message === message ? blockedRunOf(error) : null
}

export function mergeSubscriptionUsage(
  current: readonly AiSubscriptionUsage[],
  reported: readonly AiSubscriptionUsage[],
  now: number = Date.now(),
): AiSubscriptionUsage[] {
  const latest = new Map<string, AiSubscriptionUsage>()
  for (const entry of [...current, ...reported]) {
    latest.set(`${entry.provider}:${entry.window}`, entry)
  }
  return [...latest.values()].filter((entry) => entry.resetsAt > now)
}
