/**
 * Export (PNG, SVG, PDF) and print (plain + `@genoffice/print-layout` arranged print)
 * for the whiteboard editor. All outputs are rendered in invariant light colors
 * with zero external network requests.
 */
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, type WebContents } from 'electron'
import { configuredDefaultSaveDir, showSaveDialogWithMemory } from '@genoffice/electron-utils'
import { atomicWriteFile } from '@genoffice/electron-utils/atomic-write'
import {
  registerPrintLayoutIpc,
  type PrintLayoutInvokeEvent,
} from '@genoffice/electron-utils/print-arranged'
import { PRINT_READY_SCRIPT } from '@genoffice/electron-utils/print-window'
import { safeFileNameBase } from '../shared/formats'
import { WHITEBOARD_CHANNELS } from '../shared/ipc'
import type {
  ExportImagesRequest,
  ExportPdfRequest,
  ExportResult,
  PrintPage,
  PrintResult,
  PrintWhiteboardRequest,
  WhiteboardPrintJob,
} from '../shared/ipc'
import { pageFilePaths } from './export-paths'
import { tm } from './i18n-main'
import { buildPrintHtml, isPrintCancel, isPrintPage } from './print-document'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]

function bytesOf(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  return null
}

const asBuffer = (bytes: Uint8Array): Buffer =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

export function looksLikeImage(format: 'png' | 'svg', bytes: Uint8Array): boolean {
  if (format === 'png') return PNG_SIGNATURE.every((b, i) => bytes[i] === b)
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart()
  return head.startsWith('<svg') || head.startsWith('<?xml') || head.startsWith('<!DOCTYPE svg')
}

function parentOf(contents: WebContents): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(contents) ?? BrowserWindow.getFocusedWindow() ?? undefined
}

async function confirmReplace(contents: WebContents, paths: readonly string[]): Promise<boolean> {
  const existing = paths.filter((p) => existsSync(p))
  if (existing.length === 0) return true
  const options = {
    type: 'warning' as const,
    message: tm('exportReplaceMsg', { count: existing.length }),
    detail: [tm('exportReplaceDetail'), ...existing.slice(0, 5).map((p) => basename(p))].join('\n'),
    buttons: [tm('btnReplace'), tm('btnCancel')],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  const parent = parentOf(contents)
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  return response === 0
}

function defaultExportPath(
  filePathOf: (wcId: number) => string | undefined,
  wcId: number,
  name: string,
  ext: string,
): string {
  const file = filePathOf(wcId)
  const dir = file ? dirname(file) : configuredDefaultSaveDir(app)
  return join(dir, `${safeFileNameBase(name) || tm('untitled')}.${ext}`)
}

async function pickPdfPath(
  filePathOf: (wcId: number) => string | undefined,
  contents: WebContents,
  suggestedName: string,
): Promise<string | null> {
  const picked = await showSaveDialogWithMemory(dialog, parentOf(contents), {
    title: tm('dlgExportTitle'),
    defaultPath: defaultExportPath(filePathOf, contents.id, suggestedName, 'pdf'),
    filters: [{ name: tm('filterPdf'), extensions: ['pdf'] }],
  })
  if (picked.canceled || !picked.filePath) return null
  return extname(picked.filePath).toLowerCase() === '.pdf'
    ? picked.filePath
    : `${picked.filePath}.pdf`
}

function createIsolatedPrintWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1280,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  return win
}

/** Renders whiteboard light-mode print pages to a multi-page PDF via hidden BrowserWindow. */
export async function renderWhiteboardPdf(
  pages: readonly PrintPage[],
  title: string,
): Promise<Uint8Array> {
  const html = buildPrintHtml(pages, title)
  const win = createIsolatedPrintWindow()
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await win.webContents.executeJavaScript(PRINT_READY_SCRIPT).catch(() => {})
    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })
    return new Uint8Array(pdfBuffer)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

function printJobOf(editor: unknown): { pages: PrintPage[]; title: string } | null {
  if (typeof editor !== 'object' || editor === null) return null
  const job = editor as Partial<WhiteboardPrintJob>
  if (!Array.isArray(job.pages) || job.pages.length === 0 || !job.pages.every(isPrintPage)) {
    return null
  }
  return { pages: job.pages, title: typeof job.title === 'string' ? job.title : '' }
}

export function registerWhiteboardExportIpc(
  filePathOf: (wcId: number) => string | undefined,
): void {
  ipcMain.handle(
    WHITEBOARD_CHANNELS.exportImages,
    async (e, req: ExportImagesRequest): Promise<ExportResult> => {
      if (!req || (req.format !== 'png' && req.format !== 'svg') || !Array.isArray(req.pages)) {
        return { ok: false, error: 'invalid export request' }
      }
      if (req.pages.length === 0) return { ok: false, error: 'no pages to export' }

      const validated = req.pages.map((p) => ({
        number: p.number,
        bytes: bytesOf(p.bytes),
      }))
      if (validated.some((v) => !v.bytes || !looksLikeImage(req.format, v.bytes))) {
        return { ok: false, error: `invalid ${req.format} page data` }
      }

      const picked = await showSaveDialogWithMemory(dialog, parentOf(e.sender), {
        title: tm('dlgExportTitle'),
        defaultPath: defaultExportPath(filePathOf, e.sender.id, req.suggestedName, req.format),
        filters: [
          {
            name: req.format === 'png' ? tm('filterPng') : tm('filterSvg'),
            extensions: [req.format],
          },
        ],
      })
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }

      const perPage = !req.singlePage && validated.length > 1
      const targetPaths = pageFilePaths(
        picked.filePath,
        req.format,
        validated.map((v) => v.number),
        perPage,
      )

      if (perPage) {
        const ok = await confirmReplace(e.sender, targetPaths)
        if (!ok) return { ok: false, canceled: true }
      }

      try {
        for (let i = 0; i < validated.length; i++) {
          await atomicWriteFile(targetPaths[i]!, asBuffer(validated[i]!.bytes!))
        }
        return { ok: true, paths: targetPaths }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    WHITEBOARD_CHANNELS.exportPdf,
    async (e, req: ExportPdfRequest): Promise<ExportResult> => {
      if (
        !req ||
        !Array.isArray(req.pages) ||
        req.pages.length === 0 ||
        !req.pages.every(isPrintPage)
      ) {
        return { ok: false, error: 'invalid PDF export pages' }
      }
      const outPath = await pickPdfPath(filePathOf, e.sender, req.suggestedName)
      if (!outPath) return { ok: false, canceled: true }
      try {
        const pdf = await renderWhiteboardPdf(req.pages, req.suggestedName)
        await atomicWriteFile(outPath, asBuffer(pdf))
        return { ok: true, paths: [outPath] }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    WHITEBOARD_CHANNELS.print,
    async (_e, req: PrintWhiteboardRequest): Promise<PrintResult> => {
      if (
        !req ||
        !Array.isArray(req.pages) ||
        req.pages.length === 0 ||
        !req.pages.every(isPrintPage)
      ) {
        return { ok: false, error: 'invalid print pages' }
      }
      const html = buildPrintHtml(req.pages, req.title)
      const win = createIsolatedPrintWindow()
      try {
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
        await win.webContents.executeJavaScript(PRINT_READY_SCRIPT).catch(() => {})
        return await new Promise<PrintResult>((resolve) => {
          win.webContents.print({ printBackground: true }, (success, failureReason) => {
            if (success) resolve({ ok: true })
            else if (isPrintCancel(failureReason)) resolve({ ok: false, canceled: true })
            else resolve({ ok: false, error: failureReason || 'print failed' })
          })
        })
      } finally {
        if (!win.isDestroyed()) win.destroy()
      }
    },
  )

  registerPrintLayoutIpc<WhiteboardPrintJob>('whiteboard', {
    ipcMain,
    buildJobPdf: async (_event, editor) => {
      const job = printJobOf(editor)
      if (!job) throw new Error('whiteboard: bad print pages')
      return renderWhiteboardPdf(job.pages, job.title)
    },
    createPrintWindow: (_event: PrintLayoutInvokeEvent) => createIsolatedPrintWindow(),
    pickSavePath: (event, editor) =>
      pickPdfPath(
        filePathOf,
        event.sender as unknown as WebContents,
        printJobOf(editor)?.title ?? '',
      ),
  })
}
