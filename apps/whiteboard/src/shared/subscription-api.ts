import type {
  AiSubscriptionProviderId,
  AiSubscriptionUsage,
  SubscriptionConnectHelpPath,
  SubscriptionLaunchResult,
  SubscriptionLoginMode,
  SubscriptionMeteredResult,
  SubscriptionStatusMap,
} from '@genoffice/ai-provider/browser'

export {
  checkingSubscriptionStatuses,
  isSubscriptionProviderId,
  subscriptionLaunchResultOf,
  subscriptionMeteredResultOf,
  subscriptionStatusMapOf,
} from '@genoffice/ai-provider/browser'

/** Exposed as `window.whiteboardApi.subscription` by the whiteboard preload (never logout/off). */
export interface WhiteboardSubscriptionApi {
  statuses(): Promise<SubscriptionStatusMap>
  recheck(providers?: AiSubscriptionProviderId[]): Promise<SubscriptionStatusMap>
  login(
    provider: AiSubscriptionProviderId,
    mode?: SubscriptionLoginMode,
  ): Promise<SubscriptionLaunchResult>
  install(provider: AiSubscriptionProviderId): Promise<SubscriptionLaunchResult>
  update(provider: AiSubscriptionProviderId): Promise<SubscriptionLaunchResult>
  cancelLogin(provider: AiSubscriptionProviderId): Promise<SubscriptionLaunchResult>
  setMeteredAccepted(
    provider: AiSubscriptionProviderId,
    accepted: boolean,
  ): Promise<SubscriptionMeteredResult>
  onChanged(handler: (statuses: SubscriptionStatusMap) => void): () => void
  onUsage(handler: (usage: AiSubscriptionUsage[]) => void): () => void
  openInstallHelp(provider: AiSubscriptionProviderId): Promise<void>
  openConnectHelp(path: SubscriptionConnectHelpPath | null): Promise<void>
}

export const SUBSCRIPTION_INSTALL_HELP_CHANNEL = 'home:open-subscription-install-help'
export const SUBSCRIPTION_CONNECT_HELP_CHANNEL = 'home:open-connect-help'
export const SUBSCRIPTION_USAGE_CHANNEL = 'ai:subscription-usage-update'
