/**
 * AI panel attachment picking/parsing, pasted images, web search/fetch, and
 * provisional tab title hook for the whiteboard editor.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, type WebContents } from 'electron'
import {
  abortMediaCalls,
  readUrlTool,
  webSearchTool,
  withMediaCallSignal,
} from '@genoffice/ai-search'
import { assertFileSaved, showOpenDialogWithMemory } from '@genoffice/electron-utils'
import { registerAiJob } from '@genoffice/electron-utils/ai-activity'
import { aiRunRefusal } from '@genoffice/electron-utils/ai-run-guard'
import { aiFeaturesOn } from '@genoffice/electron-utils/app-choice'
import {
  ATTACHABLE_EXTS,
  ATTACHABLE_IMAGE_EXTS,
  ATTACHABLE_IMAGE_MAX_BYTES,
  attachableMaxBytes,
  diagramPictureExtOf,
  diagramPictureExtOfName,
  parseFileToText,
} from '@genoffice/file-parse'
import { WHITEBOARD_CHANNELS } from '../shared/ipc'
import type {
  AttachmentAddResult,
  AttachmentImageResult,
  AttachmentMeta,
  AttachmentReadResult,
} from '../shared/ipc'

const MAX_READ_CHARS = 48_000
const IMAGE_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

let provisionalTitleHook: ((wcId: number, title: string) => void) | null = null

export function setWhiteboardProvisionalTitleHook(
  hook: ((wcId: number, title: string) => void) | null,
): void {
  provisionalTitleHook = hook
}

function parentOf(contents: WebContents): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(contents) ?? BrowserWindow.getFocusedWindow() ?? undefined
}

async function classifyPaths(paths: readonly string[]): Promise<AttachmentAddResult> {
  const added: AttachmentMeta[] = []
  const rejected: Array<{ name: string; reason: string }> = []
  for (const filePath of paths) {
    const name = basename(filePath)
    let st
    try {
      st = statSync(filePath)
    } catch {
      rejected.push({ name, reason: 'cannot be read' })
      continue
    }
    if (!st.isFile()) {
      rejected.push({ name, reason: 'not a file' })
      continue
    }
    const doubleExt = diagramPictureExtOfName(name)
    let ext = extname(name).slice(1).toLowerCase()
    if (doubleExt) {
      const confirmed = await diagramPictureExtOf(filePath)
      if (confirmed) ext = confirmed
    }
    if (!ATTACHABLE_EXTS.has(ext)) {
      rejected.push({ name, reason: `.${ext || 'unknown'} files are not supported` })
      continue
    }
    const maxBytes = attachableMaxBytes(ext)
    if (st.size > maxBytes) {
      const mb = Math.round(maxBytes / (1024 * 1024))
      rejected.push({ name, reason: `exceeds the ${mb}MB limit` })
      continue
    }
    added.push({
      id: randomUUID(),
      name,
      path: filePath,
      size: st.size,
      ext,
      isImage: ATTACHABLE_IMAGE_EXTS.has(ext),
    })
  }
  return { added, rejected }
}

const SETTINGS_PATH = (): string => join(app.getPath('userData'), 'ai-settings.json')

export function whiteboardPastedImageDir(): string {
  const dir = join(app.getPath('userData'), 'whiteboard-ai-pasted')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function registerWhiteboardAiIpc(): void {
  const pastedDir = whiteboardPastedImageDir()

  ipcMain.on(WHITEBOARD_CHANNELS.provisionalTitle, (e, rawTitle: unknown) => {
    if (typeof rawTitle === 'string') {
      provisionalTitleHook?.(e.sender.id, rawTitle.trim().slice(0, 120))
    }
  })

  ipcMain.handle(WHITEBOARD_CHANNELS.aiAddAttachments, async (e): Promise<AttachmentAddResult> => {
    const picked = await showOpenDialogWithMemory(dialog, parentOf(e.sender), {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Supported Files', extensions: [...ATTACHABLE_EXTS] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (picked.canceled || picked.filePaths.length === 0) return { added: [], rejected: [] }
    return classifyPaths(picked.filePaths)
  })

  ipcMain.handle(
    WHITEBOARD_CHANNELS.aiAddAttachmentPaths,
    async (_e, rawPaths: unknown): Promise<AttachmentAddResult> => {
      if (!Array.isArray(rawPaths)) return { added: [], rejected: [] }
      const paths = rawPaths.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
      return classifyPaths(paths)
    },
  )

  ipcMain.handle(
    WHITEBOARD_CHANNELS.aiReadAttachment,
    async (
      _e,
      rawPath: unknown,
      rawOffset?: unknown,
      rawMaxChars?: unknown,
    ): Promise<AttachmentReadResult> => {
      if (typeof rawPath !== 'string' || !rawPath.trim()) {
        return { ok: false, error: 'missing attachment path' }
      }
      try {
        assertFileSaved(rawPath)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      const parsed = await parseFileToText(rawPath)
      if (!parsed.ok) return { ok: false, error: parsed.error ?? 'failed to parse file' }
      if (parsed.kind === 'image') {
        return {
          ok: false,
          error: 'Image attachments have no text; the image is sent along with the user message',
        }
      }
      const full = parsed.text ?? ''
      const offset = typeof rawOffset === 'number' && rawOffset > 0 ? Math.floor(rawOffset) : 0
      const cap =
        typeof rawMaxChars === 'number' && rawMaxChars > 0
          ? Math.min(Math.floor(rawMaxChars), MAX_READ_CHARS)
          : 24_000
      const slice = full.slice(offset, offset + cap)
      return {
        ok: true,
        text: slice,
        truncated: offset + slice.length < full.length,
        totalChars: full.length,
      }
    },
  )

  ipcMain.handle(
    WHITEBOARD_CHANNELS.aiReadAttachmentImage,
    async (_e, rawPath: unknown): Promise<AttachmentImageResult> => {
      if (typeof rawPath !== 'string' || !rawPath.trim()) {
        return { ok: false, error: 'missing image path' }
      }
      const ext = extname(rawPath).slice(1).toLowerCase()
      const mime = IMAGE_MIMES[ext]
      if (!mime) return { ok: false, error: 'unsupported image type' }
      try {
        const st = statSync(rawPath)
        if (st.size > ATTACHABLE_IMAGE_MAX_BYTES) {
          return { ok: false, error: 'image exceeds the 5MB limit' }
        }
        const bytes = readFileSync(rawPath)
        return { ok: true, base64: bytes.toString('base64'), mime }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    WHITEBOARD_CHANNELS.aiSavePastedImage,
    async (_e, rawBytes: unknown, rawMime: unknown): Promise<AttachmentMeta | null> => {
      const bytes =
        rawBytes instanceof Uint8Array
          ? rawBytes
          : rawBytes instanceof ArrayBuffer
            ? new Uint8Array(rawBytes)
            : null
      if (!bytes || bytes.byteLength === 0 || bytes.byteLength > ATTACHABLE_IMAGE_MAX_BYTES) {
        return null
      }
      const mime = typeof rawMime === 'string' ? rawMime.toLowerCase() : 'image/png'
      const ext =
        mime.includes('jpeg') || mime.includes('jpg')
          ? 'jpg'
          : mime.includes('webp')
            ? 'webp'
            : mime.includes('gif')
              ? 'gif'
              : 'png'
      const id = randomUUID()
      const name = `pasted-${id.slice(0, 8)}.${ext}`
      const target = join(pastedDir, name)
      writeFileSync(target, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
      return {
        id,
        name,
        path: target,
        size: bytes.byteLength,
        ext,
        isImage: true,
      }
    },
  )

  ipcMain.handle(WHITEBOARD_CHANNELS.aiWebSearch, (e, query: unknown) => {
    if (!aiFeaturesOn()) {
      return {
        error:
          aiRunRefusal({ senderId: e.sender.id, provider: '', model: '' }) ??
          'AI features are turned off in Settings.',
      }
    }
    const done = registerAiJob({ kind: 'chat', stop: () => abortMediaCalls(e.sender.id) })
    return withMediaCallSignal(e.sender, () =>
      webSearchTool(SETTINGS_PATH(), String(query ?? '')),
    ).finally(done)
  })

  ipcMain.handle(WHITEBOARD_CHANNELS.aiWebFetch, (e, url: unknown) => {
    if (!aiFeaturesOn()) {
      return {
        error:
          aiRunRefusal({ senderId: e.sender.id, provider: '', model: '' }) ??
          'AI features are turned off in Settings.',
      }
    }
    const done = registerAiJob({ kind: 'chat', stop: () => abortMediaCalls(e.sender.id) })
    return withMediaCallSignal(e.sender, (signal) =>
      readUrlTool(SETTINGS_PATH(), String(url ?? ''), 0, { signal }),
    ).finally(done)
  })
}
