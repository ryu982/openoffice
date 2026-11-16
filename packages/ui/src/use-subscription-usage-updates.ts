/**
 * Subscription usage that arrives outside the chat stream. A picture request
 * is not a stream, so the app main sends the usage Codex reported for it to
 * every window (`ai:subscription-usage-update`, the chat chunk's
 * `subscription-usage` shape). Usage belongs to the account, so a window that
 * did not ask for the picture takes it in too.
 *
 * Each editor's preload exposes the listener on its subscription bridge
 * (`onUsage`); the AI panel calls this hook with the same getter it gives
 * `useSubscriptionConnection`, its usage state setter and its own merge.
 * No IPC name lives here.
 */
import { useEffect, useRef } from 'react'
import type { AiSubscriptionUsage, AiUsageWindow } from '@genoffice/ai-provider/browser'
import { isSubscriptionProviderId } from '@genoffice/ai-provider/browser'

/** The part of a preload's subscription bridge this hook calls */
export interface SubscriptionUsageSource {
  /** usage reported outside the chat stream, sent to every window; returns an unsubscribe */
  onUsage?(handler: (usage: AiSubscriptionUsage[]) => void): () => void
}

/** How a panel folds a new report into the windows it already knows */
export type SubscriptionUsageMerge = (
  known: readonly AiSubscriptionUsage[],
  reported: readonly AiSubscriptionUsage[],
) => AiSubscriptionUsage[]

const USAGE_WINDOWS: readonly AiUsageWindow[] = ['five_hour', 'seven_day']

/**
 * The newest report per provider and window, the windows a report does not
 * name kept. For a panel that has no merge of its own: its chat path replaces
 * the list with each turn's report, but a picture's report names Codex only
 * and must not wipe the other provider's windows.
 */
export function mergeLatestSubscriptionUsage(
  known: readonly AiSubscriptionUsage[],
  reported: readonly AiSubscriptionUsage[],
): AiSubscriptionUsage[] {
  const latest = new Map<string, AiSubscriptionUsage>()
  for (const entry of [...known, ...reported])
    latest.set(`${entry.provider}:${entry.window}`, entry)
  return [...latest.values()]
}

/** the well-formed entries of a payload from the main process; anything else is dropped */
export function subscriptionUsageOf(value: unknown): AiSubscriptionUsage[] {
  if (!Array.isArray(value)) return []
  const usage: AiSubscriptionUsage[] = []
  for (const item of value as unknown[]) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    if (
      isSubscriptionProviderId(entry.provider) &&
      USAGE_WINDOWS.includes(entry.window as AiUsageWindow) &&
      typeof entry.utilization === 'number' &&
      Number.isFinite(entry.utilization) &&
      typeof entry.resetsAt === 'number' &&
      Number.isFinite(entry.resetsAt)
    ) {
      usage.push({
        provider: entry.provider,
        window: entry.window as AiUsageWindow,
        utilization: entry.utilization,
        resetsAt: entry.resetsAt,
      })
    }
  }
  return usage
}

/**
 * Listens for usage reported outside the chat stream while the calling
 * component is mounted, and folds each report into the panel's usage state
 * with `merge`. A missing bridge or listener (a standalone run, an older
 * preload) leaves the state as the chat stream sets it.
 */
export function useSubscriptionUsageUpdates(
  api: () => SubscriptionUsageSource | undefined,
  setUsage: (update: (known: readonly AiSubscriptionUsage[]) => AiSubscriptionUsage[]) => void,
  merge: SubscriptionUsageMerge = mergeLatestSubscriptionUsage,
): void {
  const latest = useRef({ api, setUsage, merge })
  latest.current = { api, setUsage, merge }

  useEffect(() => {
    let bridge: SubscriptionUsageSource | undefined
    try {
      bridge = latest.current.api()
    } catch {
      bridge = undefined
    }
    if (typeof bridge?.onUsage !== 'function') return
    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = bridge.onUsage((payload: unknown) => {
        const reported = subscriptionUsageOf(payload)
        if (reported.length === 0) return
        const { setUsage: set, merge: fold } = latest.current
        set((known) => fold(known, reported))
      })
    } catch {
      return
    }
    return () => {
      try {
        unsubscribe?.()
      } catch {
        // the window is going away; a listener that cannot be removed goes with it
      }
    }
  }, [])
}
