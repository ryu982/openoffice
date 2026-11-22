import {
  useSubscriptionConnection as useSharedSubscriptionConnection,
  type SubscriptionConnection,
} from '@genoffice/ui'

export type { SubscriptionConnection }

export function useSubscriptionConnection(): SubscriptionConnection {
  return useSharedSubscriptionConnection({
    api: () => window.whiteboardApi?.subscription,
    help: 'api',
  })
}
