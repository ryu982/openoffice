/// Channels an editor uses to ask the shell for direct attachments from
/// registered Obsidian vaults, connected Notion accounts, and Canva accounts.
export const CONNECTOR_ATTACH_CHANNELS = {
  availableSources: 'connector:attach-sources',
  sourcesChanged: 'connector:attach-sources-changed',
  pickObsidian: 'connector:pick-obsidian',
  pickNotion: 'connector:pick-notion',
  pickCanva: 'connector:pick-canva',
} as const

/** Renderer-exposed bridge key shared by all attach-capable editors */
export const CONNECTOR_ATTACH_BRIDGE_KEY = 'aiOfficeConnectorAttach'

export interface ConnectorAttachSources {
  obsidian: boolean
  notion: boolean
  canva: boolean
}

export type ConnectorAttachFailReason =
  'cancelled' | 'busy' | 'unavailable' | 'not-connected' | 'failed'

export type ConnectorAttachWireResult =
  | {
      ok: true
      paths: string[]
      skipped?: number
      failed?: number
      omittedNonText?: number
    }
  | {
      ok: false
      reason: ConnectorAttachFailReason
    }
