/**
 * Modal attachment picker window for Obsidian vault notes and Notion pages.
 * Mirrors `doc-picker-window.ts`: one modal window at a time over the asking
 * editor, validating selected IDs strictly against the last listing.
 *
 * User-initiated direct attachment does NOT trip `keepResultsInside` or Drive
 * outbound guards — it hands file paths to the editor's normal attachment flow.
 */
import { join } from 'node:path'
import { BrowserWindow, ipcMain, shell, webContents } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { productName, type Lang } from '@genoffice/i18n'
import { safeExternalUrl } from '@genoffice/electron-utils'
import {
  CONNECTOR_ATTACH_CHANNELS,
  type ConnectorAttachSources,
  type ConnectorAttachWireResult,
} from '@genoffice/electron-utils/connector-attach-channels'
import {
  CONNECTOR_PICKER_CHANNELS,
  type ConnectorPickerChooseResult,
  type ConnectorPickerInit,
  type ConnectorPickerItem,
  type ConnectorPickerKind,
  type ConnectorPickerListResult,
  type ConnectorPickerTheme,
} from '../../shared/connector-picker-api'
import { connectorPickerText } from '../../renderer/src/i18n/strings-connector-picker'
import type { McpHub } from '../mcp-client/hub'
import {
  buildCanvaSearchInput,
  CANVA_ATTACH_SUBDIR,
  cleanupOldCanvaFiles,
  exportCanvaDesignToTemp,
  fetchCanvaDesignsToTemp,
  findCanvaTools,
  parseCanvaSearchResults,
  type CanvaToolSet,
} from './canva-picker'
import {
  cleanupOldNotionSnapshots,
  fetchNotionPagesToTemp,
  findNotionTools,
  NOTION_ATTACH_SUBDIR,
  parseNotionSearchResults,
  type NotionToolPair,
} from './notion-picker'
import { listObsidianPickerItems, resolveObsidianSelection } from './obsidian-picker'

export interface ConnectorPickerDeps {
  hub: McpHub
  openIntegrations: () => void
  lang: () => Lang
  theme: () => ConnectorPickerTheme
  tempDir: string
  isUnsaved: (absPath: string) => Promise<boolean> | boolean
  /** Open an exported Canva PPTX/PDF file directly in a new editor tab */
  openGeneratedPath?: (path: string) => boolean
  /** Download bytes from an HTTPS Canva export URL (via Electron net.fetch) */
  fetchUrlBytes?: (url: string, signal?: AbortSignal) => Promise<Uint8Array>
}

export function createConnectorPicker(deps: ConnectorPickerDeps) {
  let win: BrowserWindow | null = null
  let activeKind: ConnectorPickerKind = 'obsidian'
  let settle: ((result: ConnectorAttachWireResult) => void) | null = null
  let lastItems: ConnectorPickerItem[] | null = null
  let knownRemoteItems = new Map<string, ConnectorPickerItem>()
  let cachedNotionTools: { serverId: string; pair: NotionToolPair } | null = null
  let cachedCanvaTools: { serverId: string; tools: CanvaToolSet } | null = null
  let listController: AbortController | null = null
  let chooseController: AbortController | null = null

  const notionAttachDir = join(deps.tempDir, NOTION_ATTACH_SUBDIR)
  const canvaAttachDir = join(deps.tempDir, CANVA_ATTACH_SUBDIR)

  const currentSources = (): ConnectorAttachSources => ({
    obsidian: deps.hub.registeredVaults().length > 0,
    notion: deps.hub.notionPickerStatus().available,
    canva: deps.hub.canvaPickerStatus().available,
  })

  let lastSources = currentSources()
  const broadcastSources = () => {
    const next = currentSources()
    if (
      next.obsidian === lastSources.obsidian &&
      next.notion === lastSources.notion &&
      next.canva === lastSources.canva
    ) {
      return
    }
    lastSources = next
    for (const wc of webContents.getAllWebContents()) {
      if (!wc.isDestroyed()) {
        wc.send(CONNECTOR_ATTACH_CHANNELS.sourcesChanged, next)
      }
    }
  }
  const unsubscribeHub = deps.hub.onChanged(broadcastSources)

  const fromWindow = (event: IpcMainInvokeEvent) =>
    !!win && !win.isDestroyed() && event.sender === win.webContents

  const finish = (result: ConnectorAttachWireResult) => {
    listController?.abort('closed')
    chooseController?.abort('closed')
    const done = settle
    settle = null
    done?.(result)
    if (win && !win.isDestroyed()) win.close()
  }

  async function resolveNotionPair(
    signal?: AbortSignal,
  ): Promise<{ ok: true; serverId: string; pair: NotionToolPair } | { ok: false; error: string }> {
    const status = deps.hub.notionPickerStatus()
    if (!status.available || !status.serverId) {
      return { ok: false, error: 'Notion is not connected or needs sign-in.' }
    }
    if (cachedNotionTools && cachedNotionTools.serverId === status.serverId) {
      return { ok: true, serverId: status.serverId, pair: cachedNotionTools.pair }
    }
    const listed = await deps.hub.listToolsForUserPicker(status.serverId, signal)
    if (!listed.ok) return { ok: false, error: listed.error }
    const pair = findNotionTools(listed.tools)
    if (!pair) {
      return {
        ok: false,
        error: 'Notion search and page fetch tools were not found on the connected server.',
      }
    }
    cachedNotionTools = { serverId: status.serverId, pair }
    return { ok: true, serverId: status.serverId, pair }
  }

  async function resolveCanvaTools(
    signal?: AbortSignal,
  ): Promise<{ ok: true; serverId: string; tools: CanvaToolSet } | { ok: false; error: string }> {
    const status = deps.hub.canvaPickerStatus()
    if (!status.available || !status.serverId) {
      return { ok: false, error: 'Canva is not connected or needs sign-in.' }
    }
    if (cachedCanvaTools && cachedCanvaTools.serverId === status.serverId) {
      return { ok: true, serverId: status.serverId, tools: cachedCanvaTools.tools }
    }
    const listed = await deps.hub.listToolsForUserPicker(status.serverId, signal)
    if (!listed.ok) return { ok: false, error: listed.error }
    const tools = findCanvaTools(listed.tools)
    if (!tools) {
      return {
        ok: false,
        error: 'Canva search and read tools were not found on the connected server.',
      }
    }
    cachedCanvaTools = { serverId: status.serverId, tools }
    return { ok: true, serverId: status.serverId, tools }
  }

  // ---- picker window IPC ---------------------------------------------------

  ipcMain.handle(CONNECTOR_PICKER_CHANNELS.getInit, (event): ConnectorPickerInit | null => {
    if (!fromWindow(event)) return null
    return {
      kind: activeKind,
      lang: deps.lang(),
      theme: deps.theme(),
      vaults:
        activeKind === 'obsidian'
          ? deps.hub.registeredVaults().map((v) => ({ id: v.id, name: v.name }))
          : [],
    }
  })

  ipcMain.handle(
    CONNECTOR_PICKER_CHANNELS.list,
    async (event, rawQuery?: unknown): Promise<ConnectorPickerListResult> => {
      if (!fromWindow(event)) return { ok: false, error: 'Unavailable' }
      listController?.abort('superseded')
      const controller = new AbortController()
      listController = controller

      if (activeKind === 'obsidian') {
        const vaults = deps.hub.registeredVaults()
        const listed = await listObsidianPickerItems(vaults, deps.isUnsaved)
        if (controller.signal.aborted) return { ok: false, error: 'Cancelled' }
        lastItems = listed.items
        return { ok: true, items: listed.items }
      }

      if (activeKind === 'canva') {
        const query = typeof rawQuery === 'string' ? rawQuery.trim() : ''
        const resolved = await resolveCanvaTools(controller.signal)
        if (!resolved.ok) return { ok: false, error: resolved.error }
        const answer = await deps.hub.callForUserPicker(
          resolved.serverId,
          resolved.tools.searchTool.name,
          buildCanvaSearchInput(query),
          controller.signal,
        )
        if (controller.signal.aborted) return { ok: false, error: 'Cancelled' }
        if (!answer.ok) {
          return { ok: false, error: answer.error || 'Canva search failed.' }
        }
        if (answer.isError) {
          return { ok: false, error: answer.output || 'Canva search failed.' }
        }
        const items = parseCanvaSearchResults(answer.output)
        lastItems = items
        for (const item of items) knownRemoteItems.set(item.id, item)
        return { ok: true, items }
      }

      // Notion live search
      const query = typeof rawQuery === 'string' ? rawQuery.trim() : ''
      const resolved = await resolveNotionPair(controller.signal)
      if (!resolved.ok) return { ok: false, error: resolved.error }
      const answer = await deps.hub.callForUserPicker(
        resolved.serverId,
        resolved.pair.searchTool.name,
        { [resolved.pair.searchQueryParam]: query },
        controller.signal,
      )
      if (controller.signal.aborted) return { ok: false, error: 'Cancelled' }
      if (!answer.ok) {
        return { ok: false, error: answer.error || 'Notion search failed.' }
      }
      if (answer.isError) {
        return { ok: false, error: answer.output || 'Notion search failed.' }
      }
      const items = parseNotionSearchResults(answer.output)
      lastItems = items
      for (const item of items) knownRemoteItems.set(item.id, item)
      return { ok: true, items }
    },
  )

  ipcMain.handle(
    CONNECTOR_PICKER_CHANNELS.choose,
    async (event, rawIds: unknown): Promise<ConnectorPickerChooseResult> => {
      if (!fromWindow(event)) return { ok: false, error: 'Unavailable' }

      if (activeKind === 'obsidian') {
        const { paths, skipped } = resolveObsidianSelection(rawIds, lastItems)
        if (paths.length === 0) {
          finish({ ok: false, reason: 'cancelled' })
          return { ok: true }
        }
        finish({ ok: true, paths, ...(skipped > 0 ? { skipped } : {}) })
        return { ok: true }
      }

      const ids = Array.isArray(rawIds)
        ? rawIds.filter((x): x is string => typeof x === 'string')
        : []
      const selectedItems: ConnectorPickerItem[] = []
      const seen = new Set<string>()
      for (const id of ids) {
        if (seen.has(id)) continue
        seen.add(id)
        const item = knownRemoteItems.get(id)
        if (item) selectedItems.push(item)
      }
      if (selectedItems.length === 0) {
        finish({ ok: false, reason: 'cancelled' })
        return { ok: true }
      }

      chooseController?.abort('superseded')
      const controller = new AbortController()
      chooseController = controller

      if (activeKind === 'canva') {
        const resolved = await resolveCanvaTools(controller.signal)
        if (!resolved.ok) return { ok: false, error: resolved.error }

        await cleanupOldCanvaFiles(canvaAttachDir).catch(() => {})
        const fetched = await fetchCanvaDesignsToTemp({
          serverId: resolved.serverId,
          selectedItems,
          readTool: resolved.tools.readTool,
          callForUserPicker: deps.hub.callForUserPicker,
          attachDir: canvaAttachDir,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return { ok: false, error: 'Cancelled' }
        if (!fetched.ok) {
          return { ok: false, error: 'Could not read selected Canva designs.' }
        }
        finish(fetched)
        return { ok: true }
      }

      // Notion page fetch -> temporary markdown snapshots
      const resolved = await resolveNotionPair(controller.signal)
      if (!resolved.ok) return { ok: false, error: resolved.error }

      await cleanupOldNotionSnapshots(notionAttachDir).catch(() => {})
      const fetched = await fetchNotionPagesToTemp({
        serverId: resolved.serverId,
        selectedItems,
        fetchTool: resolved.pair.fetchTool,
        fetchIdParam: resolved.pair.fetchIdParam,
        callForUserPicker: deps.hub.callForUserPicker,
        attachDir: notionAttachDir,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return { ok: false, error: 'Cancelled' }
      if (!fetched.ok) {
        return { ok: false, error: 'Could not download selected Notion pages.' }
      }
      finish(fetched)
      return { ok: true }
    },
  )

  ipcMain.handle(
    CONNECTOR_PICKER_CHANNELS.openInTab,
    async (event, rawId: unknown): Promise<ConnectorPickerChooseResult> => {
      if (!fromWindow(event)) return { ok: false, error: 'Unavailable' }
      if (activeKind !== 'canva' || typeof rawId !== 'string') {
        return { ok: false, error: 'Unsupported action.' }
      }
      if (!deps.openGeneratedPath || !deps.fetchUrlBytes) {
        return { ok: false, error: 'Opening exported Canva files is not available.' }
      }
      const item = knownRemoteItems.get(rawId)
      if (!item) return { ok: false, error: 'Design not found in current listing.' }

      chooseController?.abort('superseded')
      const controller = new AbortController()
      chooseController = controller

      const resolved = await resolveCanvaTools(controller.signal)
      if (!resolved.ok) return { ok: false, error: resolved.error }

      await cleanupOldCanvaFiles(canvaAttachDir).catch(() => {})
      const exported = await exportCanvaDesignToTemp({
        serverId: resolved.serverId,
        item,
        tools: resolved.tools,
        callForUserPicker: deps.hub.callForUserPicker,
        fetchBytes: deps.fetchUrlBytes,
        attachDir: canvaAttachDir,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return { ok: false, error: 'Cancelled' }
      if (!exported.ok) return { ok: false, error: exported.error }

      const opened = deps.openGeneratedPath(exported.path)
      if (!opened) {
        return { ok: false, error: 'Could not open the exported file in an editor tab.' }
      }
      // Close the modal cleanly without returning attachment paths to the caller chat
      finish({ ok: false, reason: 'cancelled' })
      return { ok: true }
    },
  )

  ipcMain.handle(CONNECTOR_PICKER_CHANNELS.cancel, (event) => {
    if (fromWindow(event)) finish({ ok: false, reason: 'cancelled' })
  })

  ipcMain.handle(CONNECTOR_PICKER_CHANNELS.openSettings, (event) => {
    if (!fromWindow(event)) return
    finish({ ok: false, reason: 'cancelled' })
    deps.openIntegrations()
  })

  // ---- editor AI panel bridge IPC ------------------------------------------

  ipcMain.handle(CONNECTOR_ATTACH_CHANNELS.availableSources, (): ConnectorAttachSources => {
    lastSources = currentSources()
    return lastSources
  })

  ipcMain.handle(
    CONNECTOR_ATTACH_CHANNELS.pickObsidian,
    (event): Promise<ConnectorAttachWireResult> => {
      if (deps.hub.registeredVaults().length === 0) {
        return Promise.resolve({ ok: false, reason: 'not-connected' })
      }
      const parent = BrowserWindow.fromWebContents(event.sender)
      if (!parent || parent.isDestroyed()) {
        return Promise.resolve({ ok: false, reason: 'unavailable' })
      }
      return open('obsidian', parent)
    },
  )

  ipcMain.handle(
    CONNECTOR_ATTACH_CHANNELS.pickNotion,
    (event): Promise<ConnectorAttachWireResult> => {
      if (!deps.hub.notionPickerStatus().available) {
        return Promise.resolve({ ok: false, reason: 'not-connected' })
      }
      const parent = BrowserWindow.fromWebContents(event.sender)
      if (!parent || parent.isDestroyed()) {
        return Promise.resolve({ ok: false, reason: 'unavailable' })
      }
      return open('notion', parent)
    },
  )

  ipcMain.handle(
    CONNECTOR_ATTACH_CHANNELS.pickCanva,
    (event): Promise<ConnectorAttachWireResult> => {
      if (!deps.hub.canvaPickerStatus().available) {
        return Promise.resolve({ ok: false, reason: 'not-connected' })
      }
      const parent = BrowserWindow.fromWebContents(event.sender)
      if (!parent || parent.isDestroyed()) {
        return Promise.resolve({ ok: false, reason: 'unavailable' })
      }
      return open('canva', parent)
    },
  )

  function open(
    kind: ConnectorPickerKind,
    parent: BrowserWindow | null,
  ): Promise<ConnectorAttachWireResult> {
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
      return Promise.resolve({ ok: false, reason: 'busy' })
    }
    const lang = deps.lang()
    const titleKey =
      kind === 'obsidian' ? 'obsidianTitle' : kind === 'notion' ? 'notionTitle' : 'canvaTitle'
    const next = new BrowserWindow({
      width: 720,
      height: 620,
      minWidth: 480,
      minHeight: 420,
      ...(parent && !parent.isDestroyed() ? { parent, modal: true } : {}),
      show: false,
      center: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      title: `${connectorPickerText(lang, titleKey)} - ${productName(lang)}`,
      webPreferences: {
        preload: join(__dirname, '../preload/connector-picker.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    win = next
    activeKind = kind
    lastItems = null
    knownRemoteItems = new Map()
    cachedNotionTools = null
    cachedCanvaTools = null
    next.removeMenu()
    next.webContents.setWindowOpenHandler(({ url }) => {
      const target = safeExternalUrl(url)
      if (target) void shell.openExternal(target)
      return { action: 'deny' }
    })
    const result = new Promise<ConnectorAttachWireResult>((resolve) => {
      settle = resolve
    })
    next.once('ready-to-show', () => next.show())
    next.on('closed', () => {
      listController?.abort('closed')
      chooseController?.abort('closed')
      if (win === next) win = null
      lastItems = null
      const done = settle
      settle = null
      done?.({ ok: false, reason: 'cancelled' })
    })
    if (process.env.ELECTRON_RENDERER_URL) {
      void next.loadURL(`${process.env.ELECTRON_RENDERER_URL}/connector-picker.html`)
    } else {
      void next.loadFile(join(__dirname, '../renderer/connector-picker.html'))
    }
    return result
  }

  return {
    open,
    close: () => win?.close(),
    dispose: () => {
      unsubscribeHub()
      win?.close()
    },
  }
}
