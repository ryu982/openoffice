import { AI_SUBSCRIPTION_PROVIDERS, type AiSubscriptionProviderId } from '@genoffice/ai-provider'
import type { KeyModelRefresher } from '@genoffice/ai-provider/key-models'
import {
  subscriptionStatusErrorText,
  type SubscriptionDetection,
  type SubscriptionDetector,
  type SubscriptionIpcDeps,
  type SubscriptionLaunchResult,
  type SubscriptionModelLister,
} from '@genoffice/ai-provider/subscription'

/**
 * The AI work the main process does on its own, held back while AI features
 * are turned off in Settings (editor choice spec 8.3): the subscription
 * programs are neither checked (status, version, login) nor started from a
 * screen, and the key providers' model lists are not asked for. Turned back
 * on, the shell calls `resumeAiBackgroundWork` and each start point catches
 * up once (spec 8.5); turned off, it calls `stopAiBackgroundWork`, which ends
 * the logins still running. Nothing stored is touched either way (spec 8.4).
 *
 * Electron-free: `aiOn` is the shell's choice as the editor mains read it
 * (`aiFeaturesOn` in @genoffice/electron-utils/app-choice).
 */

const resumers = new Set<() => void>()

/** Hear AI features coming back on; returns the unsubscribe */
export function onAiFeaturesBack(listener: () => void): () => void {
  resumers.add(listener)
  return () => {
    resumers.delete(listener)
  }
}

/** AI features came back on: every start point catches up once */
export function resumeAiBackgroundWork(): void {
  for (const resume of [...resumers]) {
    try {
      resume()
    } catch {
      // one start point failing does not keep the others back
    }
  }
}

const stoppers = new Set<() => void>()

/** Hear AI features going off; returns the unsubscribe */
export function onAiFeaturesOff(listener: () => void): () => void {
  stoppers.add(listener)
  return () => {
    stoppers.delete(listener)
  }
}

/** AI features went off: every start point ends what it still has running */
export function stopAiBackgroundWork(): void {
  for (const stop of [...stoppers]) {
    try {
      stop()
    } catch {
      // one start point failing does not keep the others running
    }
  }
}

/**
 * End every login the app started when AI features go off (spec 6.2, 9): the
 * login's program and its child processes end through `cancelLogin`, the path
 * a press on "cancel" takes. Returns the unsubscribe.
 */
export function endSubscriptionLoginsWhenAiOff(
  deps: Pick<SubscriptionIpcDeps, 'cancelLogin'>,
): () => void {
  return onAiFeaturesOff(() => {
    for (const provider of AI_SUBSCRIPTION_PROVIDERS) {
      void deps.cancelLogin(provider).catch(() => undefined)
    }
  })
}

/**
 * The subscription status check as the status service runs it, asking no
 * program while AI is off. Every check goes through it, the ones the service
 * starts on its own included (a login that ended or was cancelled, a ChatGPT
 * session that changed), so none of them starts a program (spec 8.3, 9). It
 * answers the last detection it saw instead, which leaves the status and the
 * stored acceptance as they are; with none seen yet, an error detection, which
 * keeps the stored acceptance too. Turned back on, checks ask the programs again.
 */
export function aiGatedDetect(
  detect: SubscriptionDetector,
  aiOn: () => boolean,
): SubscriptionDetector {
  const last = new Map<AiSubscriptionProviderId, SubscriptionDetection>()
  return async (provider, options) => {
    if (!aiOn()) {
      return (
        last.get(provider) ?? {
          provider,
          state: 'error',
          error: subscriptionStatusErrorText('failed', 'AI features are turned off'),
        }
      )
    }
    const detection = await detect(provider, options)
    last.set(provider, detection)
    return detection
  }
}

/** The subscription model listing, which asks the program: no list while AI is off */
export function aiGatedModelLister(
  list: SubscriptionModelLister,
  aiOn: () => boolean,
): SubscriptionModelLister {
  return (provider, options) => (aiOn() ? list(provider, options) : Promise.resolve(undefined))
}

/**
 * The subscription channels' dependencies with every check and program start
 * held back while AI is off: a check answers the statuses as last known
 * without asking the programs, and a login, logout, install, update or
 * turning a program back on (which checks it) is refused as `invalid`, the
 * answer a program turned off in this app already gets. Ending a login the
 * app started still goes through.
 */
export function aiGatedSubscriptionDeps(
  deps: SubscriptionIpcDeps,
  aiOn: () => boolean,
): SubscriptionIpcDeps {
  const { service } = deps
  const refused = async (): Promise<SubscriptionLaunchResult> => ({ ok: false, reason: 'invalid' })
  return {
    ...deps,
    service: {
      ...service,
      check: (providers, options) =>
        aiOn() ? service.check(providers, options) : Promise.resolve(service.getStatuses()),
      setOff: (provider, off) =>
        aiOn()
          ? service.setOff(provider, off)
          : Promise.resolve({ ok: false, statuses: service.getStatuses() }),
    },
    launchLogin: (provider, mode) => (aiOn() ? deps.launchLogin(provider, mode) : refused()),
    launchLogout: (provider) => (aiOn() ? deps.launchLogout(provider) : refused()),
    launchInstall: (provider) => (aiOn() ? deps.launchInstall(provider) : refused()),
    launchUpdate: (provider) => (aiOn() ? deps.launchUpdate(provider) : refused()),
  }
}

/** The key providers' model listing (decisions 0087, 0138), asked nothing while AI is off */
export function aiGatedKeyModelRefresher(
  refresher: KeyModelRefresher,
  aiOn: () => boolean,
): KeyModelRefresher {
  return {
    refreshChanged: () => {
      if (aiOn()) refresher.refreshChanged()
    },
    idle: () => refresher.idle(),
  }
}
