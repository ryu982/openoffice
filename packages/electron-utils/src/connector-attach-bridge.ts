/// Preload bridge for Obsidian note & Notion page direct attachment pickers.
/// Answers cross contextBridge as plain data; a standalone editor without the
/// shell gets `{ obsidian: false, notion: false }` / `unavailable` safely.
import { ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import {
  CONNECTOR_ATTACH_CHANNELS,
  type ConnectorAttachSources,
  type ConnectorAttachWireResult,
} from './connector-attach-channels'

export interface ConnectorAttachBridge {
  availableSources(): Promise<ConnectorAttachSources>
  onSourcesChanged(listener: (sources: ConnectorAttachSources) => void): () => void
  pickObsidianNotes(): Promise<ConnectorAttachWireResult>
  pickNotionPages(): Promise<ConnectorAttachWireResult>
  pickCanvaDesigns(): Promise<ConnectorAttachWireResult>
}

const EMPTY_SOURCES: ConnectorAttachSources = { obsidian: false, notion: false, canva: false }

function normalizeSources(raw: unknown): ConnectorAttachSources {
  if (!raw || typeof raw !== 'object') return EMPTY_SOURCES
  const r = raw as { obsidian?: unknown; notion?: unknown; canva?: unknown }
  return { obsidian: r.obsidian === true, notion: r.notion === true, canva: r.canva === true }
}

export function connectorAttachBridge(): ConnectorAttachBridge {
  return {
    availableSources: () =>
      ipcRenderer
        .invoke(CONNECTOR_ATTACH_CHANNELS.availableSources)
        .then(normalizeSources, () => EMPTY_SOURCES),
    onSourcesChanged: (listener) => {
      const wrapped = (_event: IpcRendererEvent, raw: unknown) => listener(normalizeSources(raw))
      ipcRenderer.on(CONNECTOR_ATTACH_CHANNELS.sourcesChanged, wrapped)
      return () => {
        ipcRenderer.removeListener(CONNECTOR_ATTACH_CHANNELS.sourcesChanged, wrapped)
      }
    },
    pickObsidianNotes: () =>
      ipcRenderer
        .invoke(CONNECTOR_ATTACH_CHANNELS.pickObsidian)
        .catch((): ConnectorAttachWireResult => ({ ok: false, reason: 'unavailable' })),
    pickNotionPages: () =>
      ipcRenderer
        .invoke(CONNECTOR_ATTACH_CHANNELS.pickNotion)
        .catch((): ConnectorAttachWireResult => ({ ok: false, reason: 'unavailable' })),
    pickCanvaDesigns: () =>
      ipcRenderer
        .invoke(CONNECTOR_ATTACH_CHANNELS.pickCanva)
        .catch((): ConnectorAttachWireResult => ({ ok: false, reason: 'unavailable' })),
  }
}
