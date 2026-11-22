import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import {
  CONNECTOR_PICKER_CHANNELS,
  CONNECTOR_PICKER_PAGE_KEY,
  type ConnectorPickerApi,
  type ConnectorPickerChooseResult,
  type ConnectorPickerInit,
  type ConnectorPickerListResult,
  type ConnectorPickerTheme,
} from '../shared/connector-picker-api'

function themeOf(value: unknown): ConnectorPickerTheme {
  return value === 'light' || value === 'dark' ? value : 'system'
}

// Standalone sandboxed preload for the Obsidian / Notion / Canva attachment picker window.
const api: ConnectorPickerApi = {
  async getInit() {
    const init = (await ipcRenderer.invoke(
      CONNECTOR_PICKER_CHANNELS.getInit,
    )) as ConnectorPickerInit | null
    const kind = init?.kind === 'notion' || init?.kind === 'canva' ? init.kind : 'obsidian'
    return {
      kind,
      lang: init?.lang ?? 'en',
      theme: themeOf(init?.theme),
      vaults: Array.isArray(init?.vaults) ? init.vaults : [],
    }
  },
  onThemeChanged(handler) {
    const listener = (_event: IpcRendererEvent, theme: unknown) => handler(themeOf(theme))
    ipcRenderer.on('app:theme-changed', listener)
    return () => ipcRenderer.removeListener('app:theme-changed', listener)
  },
  list: (query) =>
    ipcRenderer.invoke(CONNECTOR_PICKER_CHANNELS.list, query) as Promise<ConnectorPickerListResult>,
  choose: (ids) =>
    ipcRenderer.invoke(
      CONNECTOR_PICKER_CHANNELS.choose,
      ids,
    ) as Promise<ConnectorPickerChooseResult>,
  openInTab: (id) =>
    ipcRenderer.invoke(
      CONNECTOR_PICKER_CHANNELS.openInTab,
      id,
    ) as Promise<ConnectorPickerChooseResult>,
  async cancel() {
    await ipcRenderer.invoke(CONNECTOR_PICKER_CHANNELS.cancel)
  },
  async openSettings() {
    await ipcRenderer.invoke(CONNECTOR_PICKER_CHANNELS.openSettings)
  },
}

contextBridge.exposeInMainWorld(CONNECTOR_PICKER_PAGE_KEY, api)
