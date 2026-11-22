import {
  createIpcTransport,
  type AgentTransport,
  type IpcStreamError,
  type IpcSubscriptionUsage,
} from '@genoffice/agent-core'
import type { AiSettings } from '@genoffice/ai-provider'
import type { Lang } from '@genoffice/i18n'
import { localContextLimit } from '@genoffice/ai-provider/browser'
import { aiContextConfirmText, aiRunErrorText } from '@genoffice/ui'
import { t } from '../i18n/locale'

export interface ElectronTransportHooks {
  getLang(): Lang
  onStreamError(error: IpcStreamError): void
  onSubscriptionUsage(usage: IpcSubscriptionUsage[]): void
  onInputTruncated(): void
}

/** Shared IPC transport wired to `window.whiteboardApi.ai`. */
export function createElectronTransport(
  getSettings: () => AiSettings,
  hooks: ElectronTransportHooks,
): AgentTransport {
  return createIpcTransport<AiSettings>({
    onStream: (listener) => window.whiteboardApi.ai.onAiStream(listener),
    start: (request) => window.whiteboardApi.ai.aiStream(request),
    cancel: (requestId) => void window.whiteboardApi.ai.aiStreamCancel(requestId),
    getSettings,
    unknownErrorText: () => t('aiUnknownError'),
    timeoutErrorText: () => t('aiTimeoutError'),
    creditsErrorText: () => t('aiCreditsExhausted'),
    networkErrorText: () => t('aiNetworkError'),
    overloadedErrorText: () => t('aiOverloadedError'),
    errorText: (cause) => aiRunErrorText(hooks.getLang(), cause),
    contextLimit: (settings) => localContextLimit(settings),
    confirmContext: (warning) => window.confirm(aiContextConfirmText(hooks.getLang(), warning)),
    onStreamError: (error) => hooks.onStreamError(error),
    onSubscriptionUsage: (usage) => hooks.onSubscriptionUsage(usage),
    onInputTruncated: () => hooks.onInputTruncated(),
  })
}
