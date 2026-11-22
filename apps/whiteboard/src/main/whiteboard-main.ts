/**
 * Main-process host for the Whiteboard editor (`@genoffice/whiteboard`).
 *
 * Security & persistence invariants:
 * - Files that did not pass Rust WASM validation (`checkWhiteboard`) are never written.
 * - Unchanged saves write nothing to disk (`skipped: true`).
 * - Excalidraw imports (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`) start as
 *   untitled tabs (`dirty: false`), propose `<same-folder>/<name>.whiteboard` on first
 *   save, and never overwrite the source `.excalidraw*` file.
 * - Saves use atomic replacement (`atomicWriteFile`) + split-view conflict checks.
 * - `whiteboard:open-link` re-validates through `safeExternalUrl` (`http:`/`https:`/`mailto:`).
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import {
  BrowserWindow,
  WebContentsView,
  app,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
  type WebContents,
} from 'electron'
import {
  configuredDefaultSaveDir,
  confirmOverwriteIfConflicted,
  recordDiskState,
  registerRecoveryEditor,
  shouldDeferAutoSave,
  showOpenDialogWithMemory,
  showSaveDialogWithMemory,
  type RecoveryOpenFileRequest,
  type RecoveryOpenUntitledRequest,
  type SaveDiskState,
} from '@genoffice/electron-utils'
import { atomicWriteFile } from '@genoffice/electron-utils/atomic-write'
import { rendererUrl } from '@genoffice/electron-utils/renderer-scheme'
import { getUiLang } from '@genoffice/i18n'
import { checkWhiteboard, importExcalidraw } from '@genoffice/whiteboard-engine/node'
import {
  detectWhiteboardFormat,
  isExcalidrawFormat,
  safeFileNameBase,
  whiteboardBaseName,
  withWhiteboardExtension,
} from '../shared/formats'
import {
  WHITEBOARD_CHANNELS,
  type ExportFormat,
  type LocalFileBytesResult,
  type OpenFileResult,
  type RecoveryCopyRequest,
  type RecoveryCopyResult,
  type SaveIntoProjectResult,
  type SaveRequestMode,
  type SaveTargetRequest,
  type SaveTargetResult,
  type SaveWhiteboardRequest,
  type SaveWhiteboardResult,
  type WhiteboardMenuCommand,
} from '../shared/ipc'
import { openableLink } from '../shared/links'
import { registerWhiteboardAiIpc, whiteboardPastedImageDir } from './ai-attachments'
import { registerWhiteboardImageIpc } from './ai-image'
import { registerWhiteboardExportIpc } from './export-main'
import { registerWhiteboardHandoffIpc } from './handoff-main'
import { tm } from './i18n-main'
import { registerWhiteboardLinkPreviewIpc } from './link-preview'
import { whiteboardReadBytes } from './mcp-queries'
import {
  ensureViewIdentity,
  getViewOriginalPath,
  setRestoredCopyForView,
  setViewOriginalPath,
  takeRestoredCopyForView,
  viewClosedClean,
  viewDontSave,
  viewFileRenamed,
  viewGone,
  viewRecoveryIdentity,
  viewSaved,
  whiteboardRecoveryStore,
  writeViewCopy,
} from './recovery-main'

export { setWhiteboardProvisionalTitleHook } from './ai-attachments'
export { exportWhiteboardHeadless } from './headless-main'
export {
  whiteboardApplyOps,
  whiteboardReadBytes,
  whiteboardReadPage,
  whiteboardReadText,
} from './mcp-queries'
export { excalidrawOpenRefusal, whiteboardOpenRefusal } from './open-check'
export { DONT_SAVE_HOLD_MS as WHITEBOARD_DONT_SAVE_HOLD_MS } from './recovery-main'

export interface WhiteboardRuntime {
  preloadPath: string
  rendererUrl?: string
  rendererFile?: string
  packaged?: boolean
  newDocumentDir?: (webContentsId: number) => Promise<string | null>
  writeNewDocument?: (
    webContentsId: number,
    fileName: string,
    bytes: Uint8Array,
  ) => Promise<string | null>
}

let runtime: WhiteboardRuntime = { preloadPath: '' }

export function configureWhiteboardRuntime(paths: WhiteboardRuntime): void {
  runtime = paths
}

interface ViewState {
  wcId: number
  contents: WebContents
  /** Saved `.whiteboard` path on disk (null for untitled or imported Excalidraw tabs). */
  filePath: string | null
  /** Original `.excalidraw*` path for imported tabs (never overwritten). */
  importSourcePath: string | null
  /** Path queued for `consumePending` on initial mount. */
  pendingPath: string | null
  dirty: boolean
  diskState: SaveDiskState | null
  onDirty?: (dirty: boolean) => void
  onTitle?: (title: string) => void
  onFilePath?: (filePath: string) => void
  onOpenFailed?: (message: string) => void
  onOpenHelp?: () => void
}

const views = new Map<number, ViewState>()
const saveTokens = new Map<string, { wcId: number; filePath: string }>()
const saveAckWaiters = new Map<number, Array<(ok: boolean) => void>>()
const closeSaveWaiters = new Map<number, Array<(ok: boolean) => void>>()
const recoveryNowWaiters = new Map<number, Array<() => void>>()
let ipcRegistered = false

function bytesOf(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  return null
}

function parentOf(contents: WebContents): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(contents) ?? BrowserWindow.getFocusedWindow() ?? undefined
}

async function openPathAsResult(filePath: string, wcId?: number): Promise<OpenFileResult> {
  const fmt = detectWhiteboardFormat(filePath)
  if (!fmt) return { ok: false, error: tm('failUnsupported') }

  let raw: Uint8Array
  try {
    raw = new Uint8Array(await readFile(filePath))
  } catch {
    return { ok: false, error: tm('failUnreadable') }
  }

  if (isExcalidrawFormat(fmt)) {
    try {
      const { archive, summary } = importExcalidraw(raw, {
        filenameHint: basename(filePath),
        boardId: randomUUID(),
        pageId: randomUUID(),
        title: whiteboardBaseName(filePath),
      })
      try {
        const bytes = archive.save()
        if (wcId !== undefined) {
          const st = views.get(wcId)
          if (st) {
            st.filePath = null
            st.importSourcePath = filePath
            st.diskState = null
            setViewOriginalPath(wcId, filePath)
          }
        }
        return {
          ok: true,
          kind: 'excalidraw',
          sourcePath: filePath,
          format: fmt,
          bytes,
          summary,
        }
      } finally {
        archive.dispose()
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : tm('failInvalidExcalidraw') }
    }
  }

  const checked = checkWhiteboard(raw)
  if (!checked.ok) {
    return { ok: false, error: checked.error.message || tm('failCorrupt') }
  }

  if (wcId !== undefined) {
    const st = views.get(wcId)
    if (st) {
      st.filePath = filePath
      st.importSourcePath = null
      st.diskState = await recordDiskState(filePath, raw)
      ensureViewIdentity(wcId, filePath)
    }
  }
  return { ok: true, kind: 'whiteboard', filePath, bytes: raw }
}

export function registerWhiteboardIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  registerWhiteboardExportIpc((wcId) => views.get(wcId)?.filePath ?? undefined)
  registerWhiteboardLinkPreviewIpc()
  registerWhiteboardAiIpc()
  registerWhiteboardImageIpc({
    filePathOf: (wcId) => views.get(wcId)?.filePath ?? null,
    pastedImageDir: whiteboardPastedImageDir(),
  })
  registerWhiteboardHandoffIpc({
    opensFile: (wcId) => {
      const st = views.get(wcId)
      return Boolean(st?.filePath || st?.pendingPath || st?.importSourcePath)
    },
  })

  ipcMain.handle(WHITEBOARD_CHANNELS.consumePending, async (e): Promise<OpenFileResult> => {
    const st = views.get(e.sender.id)
    if (!st) return { ok: true, kind: 'new' }

    const restored = takeRestoredCopyForView(e.sender.id)
    if (restored) {
      if (st.filePath) {
        return {
          ok: true,
          kind: 'whiteboard',
          filePath: st.filePath,
          bytes: restored.copyBytes,
          restoredFromRecovery: true,
        }
      }
      return {
        ok: true,
        kind: 'new',
        restoredFromRecovery: true,
        bytes: restored.copyBytes,
        suggestedSavePath: restored.originalPath,
      }
    }

    const pending = st.pendingPath
    st.pendingPath = null
    if (!pending) return { ok: true, kind: 'new' }
    return openPathAsResult(pending, e.sender.id)
  })

  ipcMain.handle(
    WHITEBOARD_CHANNELS.openFile,
    async (e, filePath: unknown): Promise<OpenFileResult> => {
      if (typeof filePath !== 'string' || !filePath.trim()) {
        return { ok: false, error: tm('failUnreadable') }
      }
      return openPathAsResult(filePath, e.sender.id)
    },
  )

  ipcMain.handle(
    WHITEBOARD_CHANNELS.saveTarget,
    async (e, req: SaveTargetRequest): Promise<SaveTargetResult> => {
      const st = views.get(e.sender.id)
      if (!st) return { ok: false, error: 'view not found' }

      if (req.mode !== 'save-as' && st.filePath) {
        const token = randomBytes(16).toString('hex')
        saveTokens.set(token, { wcId: e.sender.id, filePath: st.filePath })
        return { ok: true, token, filePath: st.filePath }
      }

      if (req.mode === 'autosave') {
        return { ok: false, canceled: true }
      }

      const sourcePath = req.sourcePath ?? st.importSourcePath ?? getViewOriginalPath(e.sender.id)
      const baseName =
        safeFileNameBase(req.suggestedName || (sourcePath ? whiteboardBaseName(sourcePath) : '')) ||
        tm('untitled')
      let defaultDir: string
      if (st.filePath) {
        defaultDir = dirname(st.filePath)
      } else if (sourcePath) {
        defaultDir = dirname(sourcePath)
      } else {
        const projectDir = await runtime.newDocumentDir?.(e.sender.id).catch(() => null)
        defaultDir = projectDir || configuredDefaultSaveDir(app)
      }

      const picked = await showSaveDialogWithMemory(dialog, parentOf(e.sender), {
        title: tm('dlgSaveTitle'),
        defaultPath: join(defaultDir, `${baseName}.whiteboard`),
        filters: [{ name: tm('filterWhiteboard'), extensions: ['whiteboard'] }],
      })
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }

      const targetPath = withWhiteboardExtension(picked.filePath)
      const token = randomBytes(16).toString('hex')
      saveTokens.set(token, { wcId: e.sender.id, filePath: targetPath })
      return { ok: true, token, filePath: targetPath }
    },
  )

  ipcMain.handle(
    WHITEBOARD_CHANNELS.save,
    async (e, req: SaveWhiteboardRequest): Promise<SaveWhiteboardResult> => {
      const st = views.get(e.sender.id)
      if (!st) return { ok: false, error: 'view not found' }

      let targetPath: string | null = null
      if (req.token) {
        const entry = saveTokens.get(req.token)
        saveTokens.delete(req.token)
        if (!entry || entry.wcId !== e.sender.id) {
          return { ok: false, error: 'invalid save token' }
        }
        targetPath = entry.filePath
      } else if (st.filePath) {
        targetPath = st.filePath
      }
      if (!targetPath) return { ok: false, error: 'no target path for save' }

      // Never overwrite an Excalidraw source file under any circumstance.
      if (isExcalidrawFormat(detectWhiteboardFormat(targetPath))) {
        return { ok: false, error: 'cannot overwrite Excalidraw source file' }
      }

      // Skip disk write when saving back to the same unchanged file.
      if (req.unchanged && st.filePath === targetPath && req.mode !== 'save-as') {
        return { ok: true, filePath: targetPath, skipped: true }
      }

      const bytes = bytesOf(req.bytes)
      if (!bytes) return { ok: false, error: 'invalid whiteboard bytes' }
      const checked = checkWhiteboard(bytes)
      if (!checked.ok) {
        return { ok: false, error: `refused to write invalid whiteboard: ${checked.error.message}` }
      }

      // Conflict check against disk mtime / split-view siblings.
      if (st.filePath === targetPath && st.diskState) {
        if (req.mode === 'autosave') {
          if (await shouldDeferAutoSave(targetPath, st.diskState)) {
            return { ok: false, conflicted: true }
          }
        } else {
          const decision = await confirmOverwriteIfConflicted({
            path: targetPath,
            recorded: st.diskState,
            parent: parentOf(e.sender) ?? null,
            lang: getUiLang(),
          })
          if (decision !== 'proceed') return { ok: false, canceled: true }
        }
      }

      try {
        await atomicWriteFile(
          targetPath,
          Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        )
        const wasDifferent = st.filePath !== targetPath
        st.filePath = targetPath
        st.importSourcePath = null
        st.diskState = await recordDiskState(targetPath, bytes)
        st.dirty = false
        viewSaved(e.sender.id, targetPath)
        st.onDirty?.(false)
        if (wasDifferent) st.onFilePath?.(targetPath)
        fileSavedHook?.(e.sender, targetPath)
        return { ok: true, filePath: targetPath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    WHITEBOARD_CHANNELS.saveIntoProject,
    async (e, req: { fileName?: unknown; bytes?: unknown }): Promise<SaveIntoProjectResult> => {
      const st = views.get(e.sender.id)
      const bytes = bytesOf(req?.bytes)
      if (!st || !bytes || !runtime.writeNewDocument) return { ok: false, error: 'unavailable' }
      const checked = checkWhiteboard(bytes)
      if (!checked.ok) return { ok: false, error: checked.error.message }
      const rawName = typeof req.fileName === 'string' ? req.fileName : tm('untitled')
      const fileName = withWhiteboardExtension(safeFileNameBase(rawName) || tm('untitled'))
      try {
        const writtenPath = await runtime.writeNewDocument(e.sender.id, fileName, bytes)
        if (!writtenPath) return { ok: false }
        st.filePath = writtenPath
        st.importSourcePath = null
        st.diskState = await recordDiskState(writtenPath, bytes)
        st.dirty = false
        viewSaved(e.sender.id, writtenPath)
        st.onDirty?.(false)
        st.onFilePath?.(writtenPath)
        fileSavedHook?.(e.sender, writtenPath)
        return { ok: true, filePath: writtenPath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.on(WHITEBOARD_CHANNELS.dirtyChanged, (e, dirty: unknown) => {
    const st = views.get(e.sender.id)
    if (!st) return
    const next = Boolean(dirty)
    st.dirty = next
    st.onDirty?.(next)
  })

  ipcMain.on(WHITEBOARD_CHANNELS.saveRequestAck, (e, ok: unknown) => {
    const waiters = saveAckWaiters.get(e.sender.id)
    if (!waiters || waiters.length === 0) return
    const next = waiters.shift()!
    if (waiters.length === 0) saveAckWaiters.delete(e.sender.id)
    next(Boolean(ok))
  })

  ipcMain.on(WHITEBOARD_CHANNELS.closeSaveResult, (e, ok: unknown) => {
    const waiters = closeSaveWaiters.get(e.sender.id)
    if (!waiters || waiters.length === 0) return
    const next = waiters.shift()!
    if (waiters.length === 0) closeSaveWaiters.delete(e.sender.id)
    next(Boolean(ok))
  })

  ipcMain.handle(WHITEBOARD_CHANNELS.openLink, async (_e, rawUrl: unknown): Promise<boolean> => {
    const safe = openableLink(rawUrl)
    if (!safe) return false
    await shell.openExternal(safe)
    return true
  })

  ipcMain.on(WHITEBOARD_CHANNELS.openHelp, (e) => {
    views.get(e.sender.id)?.onOpenHelp?.()
  })

  ipcMain.handle(WHITEBOARD_CHANNELS.openFailed, (e, message: unknown) => {
    views
      .get(e.sender.id)
      ?.onOpenFailed?.(typeof message === 'string' ? message : tm('failCorrupt'))
  })

  ipcMain.handle(
    WHITEBOARD_CHANNELS.recoveryCopy,
    async (e, req: RecoveryCopyRequest): Promise<RecoveryCopyResult> => {
      const st = views.get(e.sender.id)
      const bytes = bytesOf(req?.bytes)
      if (!st || !bytes) return { ok: false, error: 'invalid recovery copy' }
      try {
        const written = await writeViewCopy(
          e.sender.id,
          st.filePath,
          bytes,
          typeof req.title === 'string' ? req.title : tm('untitled'),
          req.originalPath ?? st.importSourcePath,
        )
        return { ok: written }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.on(WHITEBOARD_CHANNELS.recoveryCopyNowDone, (e) => {
    const waiters = recoveryNowWaiters.get(e.sender.id)
    if (!waiters || waiters.length === 0) return
    const next = waiters.shift()!
    if (waiters.length === 0) recoveryNowWaiters.delete(e.sender.id)
    next()
  })

  ipcMain.handle(WHITEBOARD_CHANNELS.pickPdfFile, async (e): Promise<LocalFileBytesResult> => {
    const picked = await showOpenDialogWithMemory(dialog, parentOf(e.sender), {
      title: tm('dlgPickPdf'),
      properties: ['openFile'],
      filters: [{ name: tm('filterPdf'), extensions: ['pdf'] }],
    })
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false }
    const p = picked.filePaths[0]!
    try {
      const bytes = new Uint8Array(await readFile(p))
      return { ok: true, path: p, name: basename(p), bytes }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(WHITEBOARD_CHANNELS.pickImageFile, async (e): Promise<LocalFileBytesResult> => {
    const picked = await showOpenDialogWithMemory(dialog, parentOf(e.sender), {
      title: tm('dlgPickImage'),
      properties: ['openFile'],
      filters: [{ name: tm('filterImages'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    })
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false }
    const p = picked.filePaths[0]!
    try {
      const bytes = new Uint8Array(await readFile(p))
      return { ok: true, path: p, name: basename(p), bytes }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Only reads dropped PDF or image files whose extension is explicitly permitted for canvas import.
  ipcMain.handle(
    WHITEBOARD_CHANNELS.readDroppedFile,
    async (_e, rawPath: unknown): Promise<LocalFileBytesResult> => {
      if (typeof rawPath !== 'string' || !rawPath.trim()) {
        return { ok: false, error: 'missing path' }
      }
      const ext = extname(rawPath).slice(1).toLowerCase()
      if (!['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
        return { ok: false, error: 'unsupported drop import extension' }
      }
      try {
        const bytes = new Uint8Array(await readFile(rawPath))
        return { ok: true, path: rawPath, name: basename(rawPath), bytes }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  registerRecoveryEditor({
    kind: 'whiteboard',
    writeCopiesNow: async () => {
      const dirtyViews = [...views.values()].filter((v) => v.dirty && !v.contents.isDestroyed())
      await Promise.allSettled(dirtyViews.map((v) => whiteboardFlushRecoveryCopy(v.contents)))
    },
    openFileWithDecision: async (contents: WebContents, req: RecoveryOpenFileRequest) => {
      const st = views.get(contents.id)
      if (!st) return
      if (req.decision === 'restore') {
        const id = ensureViewIdentity(contents.id, req.filePath)
        const copy = await whiteboardRecoveryStore().readCopy(id)
        if (copy) {
          whiteboardRecoveryStore().markCopyLoaded(id)
          setRestoredCopyForView(contents.id, id, new Uint8Array(copy), null)
          return
        }
      }
      st.pendingPath = req.filePath
    },
    openUntitledCopy: async (contents: WebContents, req: RecoveryOpenUntitledRequest) => {
      const copy = await whiteboardRecoveryStore().readCopy(req.copy)
      if (!copy) return
      whiteboardRecoveryStore().markCopyLoaded(req.copy)
      setRestoredCopyForView(
        contents.id,
        req.copy,
        new Uint8Array(copy),
        req.saveAsDefaultPath ?? null,
      )
    },
    isUnprotectable: () => false,
  })
}

export interface CreateWhiteboardViewOptions {
  filePath?: string | null
  restoredCopy?: { bytes: Uint8Array; originalPath?: string | null }
  onDirty?: (dirty: boolean) => void
  onTitle?: (title: string) => void
  onFilePath?: (filePath: string) => void
  onOpenFailed?: (message: string) => void
  onOpenHelp?: () => void
}

export function createWhiteboardView(options: CreateWhiteboardViewOptions = {}): WebContentsView {
  registerWhiteboardIpc()
  const view = new WebContentsView({
    webPreferences: {
      preload: runtime.preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const wc = view.webContents
  const wcId = wc.id

  wc.setWindowOpenHandler(() => ({ action: 'deny' }))

  const isExcalidraw = options.filePath
    ? isExcalidrawFormat(detectWhiteboardFormat(options.filePath))
    : false

  const state: ViewState = {
    wcId,
    contents: wc,
    filePath: options.filePath && !isExcalidraw ? options.filePath : null,
    importSourcePath: options.filePath && isExcalidraw ? options.filePath : null,
    pendingPath: options.filePath ?? null,
    dirty: false,
    diskState: null,
    onDirty: options.onDirty,
    onTitle: options.onTitle,
    onFilePath: options.onFilePath,
    onOpenFailed: options.onOpenFailed,
    onOpenHelp: options.onOpenHelp,
  }
  views.set(wcId, state)

  if (options.restoredCopy) {
    const id = ensureViewIdentity(wcId, state.filePath)
    setRestoredCopyForView(
      wcId,
      id,
      options.restoredCopy.bytes,
      options.restoredCopy.originalPath ?? null,
    )
  }

  wc.once('destroyed', () => {
    const current = views.get(wcId)
    if (current && !current.dirty) {
      viewClosedClean(wcId)
    } else {
      viewGone(wcId)
    }
    views.delete(wcId)
    saveAckWaiters.delete(wcId)
    closeSaveWaiters.delete(wcId)
    recoveryNowWaiters.delete(wcId)
  })

  const url = rendererUrl(runtime.rendererUrl ?? process.env.WHITEBOARD_RENDERER_URL, 'whiteboard')
  void wc.loadURL(url)
  return view
}

export function createWhiteboardHiddenWindow(inputPath: string): BrowserWindow {
  registerWhiteboardIpc()
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      preload: runtime.preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const wc = win.webContents
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  const state: ViewState = {
    wcId: wc.id,
    contents: wc,
    filePath: inputPath,
    importSourcePath: null,
    pendingPath: inputPath,
    dirty: false,
    diskState: null,
  }
  views.set(wc.id, state)
  wc.once('destroyed', () => views.delete(wc.id))

  const url = rendererUrl(
    runtime.rendererUrl ?? process.env.WHITEBOARD_RENDERER_URL,
    'whiteboard',
    { headless: '1' },
  )
  void wc.loadURL(url)
  return win
}

export function whiteboardTriggerSave(
  contents: WebContents,
  mode: SaveRequestMode = 'save',
): Promise<boolean> {
  if (contents.isDestroyed()) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    const queue = saveAckWaiters.get(contents.id) ?? []
    saveAckWaiters.set(contents.id, queue)
    const timer = setTimeout(() => resolve(false), 30_000)
    queue.push((ok) => {
      clearTimeout(timer)
      resolve(ok)
    })
    contents.send(WHITEBOARD_CHANNELS.saveRequest, mode)
  })
}

export function whiteboardTriggerCloseSave(contents: WebContents): Promise<boolean> {
  if (contents.isDestroyed()) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    const queue = closeSaveWaiters.get(contents.id) ?? []
    closeSaveWaiters.set(contents.id, queue)
    const timer = setTimeout(() => resolve(false), 60_000)
    queue.push((ok) => {
      clearTimeout(timer)
      resolve(ok)
    })
    contents.send(WHITEBOARD_CHANNELS.closeSaveRequest)
  })
}

export async function whiteboardSaveToPath(
  contents: WebContents,
  targetPath: string,
): Promise<boolean> {
  if (contents.isDestroyed()) return false
  if (isExcalidrawFormat(detectWhiteboardFormat(targetPath))) return false
  const bytes = await whiteboardReadBytes(contents)
  const checked = checkWhiteboard(bytes)
  if (!checked.ok) return false
  await atomicWriteFile(targetPath, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  const st = views.get(contents.id)
  if (st) {
    st.filePath = targetPath
    st.importSourcePath = null
    st.diskState = await recordDiskState(targetPath, bytes)
    st.dirty = false
    viewSaved(contents.id, targetPath)
    st.onDirty?.(false)
    st.onFilePath?.(targetPath)
    fileSavedHook?.(contents, targetPath)
  }
  return true
}

export function whiteboardSendMenuCommand(contents: WebContents, cmd: WhiteboardMenuCommand): void {
  if (!contents.isDestroyed()) {
    contents.send(WHITEBOARD_CHANNELS.menuCommand, cmd)
  }
}

export function whiteboardTriggerExport(contents: WebContents, format: ExportFormat): void {
  if (!contents.isDestroyed()) {
    contents.send(WHITEBOARD_CHANNELS.exportRequest, format)
  }
}

export function whiteboardTriggerPrint(contents: WebContents): void {
  if (!contents.isDestroyed()) {
    contents.send(WHITEBOARD_CHANNELS.printRequest)
  }
}

export function whiteboardNotifyFileRenamed(contents: WebContents, newPath: string): void {
  const st = views.get(contents.id)
  if (st) {
    st.filePath = newPath
    void recordDiskState(newPath).then((ds) => {
      if (st.filePath === newPath) st.diskState = ds
    })
    viewFileRenamed(contents.id, newPath)
  }
  if (!contents.isDestroyed()) {
    contents.send(WHITEBOARD_CHANNELS.fileRenamed, newPath)
  }
}

export function whiteboardMarkDontSave(contents: WebContents): void {
  viewDontSave(contents.id)
}

export function whiteboardFlushRecoveryCopy(contents: WebContents): Promise<void> {
  if (contents.isDestroyed()) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const queue = recoveryNowWaiters.get(contents.id) ?? []
    recoveryNowWaiters.set(contents.id, queue)
    const timer = setTimeout(resolve, 5_000)
    queue.push(() => {
      clearTimeout(timer)
      resolve()
    })
    contents.send(WHITEBOARD_CHANNELS.recoveryCopyNow)
  })
}

export function whiteboardViewIdentity(wcId: number) {
  return viewRecoveryIdentity(wcId)
}

export function whiteboardRecoveryAvailable(filePath: string): boolean {
  return whiteboardRecoveryStore().copyInfo({ kind: 'whiteboard', filePath }) !== null
}

export function whiteboardUiTheme(): 'light' | 'dark' {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

export function whiteboardIsDirty(wcId: number): boolean {
  return views.get(wcId)?.dirty === true
}

export function whiteboardTabIdentity(wcId: number): {
  filePath: string | null
  title: string
  untitled: boolean
  imported?: 'excalidraw'
  sourcePath?: string
  dirty: boolean
} | null {
  const st = views.get(wcId)
  if (!st) return null
  if (st.importSourcePath) {
    const stem = basename(st.importSourcePath).replace(/\.excalidraw(\.(png|svg))?$/i, '')
    return {
      filePath: null,
      title: stem || tm('untitled'),
      untitled: true,
      imported: 'excalidraw',
      sourcePath: st.importSourcePath,
      dirty: st.dirty,
    }
  }
  return {
    filePath: st.filePath,
    title: st.filePath ? basename(st.filePath) : tm('untitled'),
    untitled: st.filePath === null,
    dirty: st.dirty,
  }
}

export async function requestWhiteboardClose(
  contents: WebContents,
  parent?: BrowserWindow | null,
): Promise<boolean> {
  if (contents.isDestroyed()) return true
  const st = views.get(contents.id)
  if (!st || !st.dirty) return true
  const owner = parent ?? parentOf(contents)
  const opts = {
    type: 'question' as const,
    buttons: [tm('btnSave'), tm('btnDontSave'), tm('btnCancel')],
    defaultId: 0,
    cancelId: 2,
    message: tm('closeUnsavedMsg'),
    detail: tm('closeUnsavedDetail'),
  }
  const { response } = owner
    ? await dialog.showMessageBox(owner, opts)
    : await dialog.showMessageBox(opts)
  if (response === 2) return false
  if (response === 1) {
    whiteboardMarkDontSave(contents)
    return true
  }
  return whiteboardTriggerCloseSave(contents)
}

let fileSavedHook: ((contents: WebContents, filePath: string) => void) | null = null
export function setWhiteboardFileSavedHook(
  hook: (contents: WebContents, filePath: string) => void,
): void {
  fileSavedHook = hook
}

let recoveryTitleHook: ((contents: WebContents) => string | undefined) | null = null
export function setWhiteboardRecoveryTitleHook(
  hook: (contents: WebContents) => string | undefined,
): void {
  recoveryTitleHook = hook
}

export function whiteboardRecoveryTitleOf(contents: WebContents): string | undefined {
  return recoveryTitleHook?.(contents)
}
