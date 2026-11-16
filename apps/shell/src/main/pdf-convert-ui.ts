/**
 * Shell side of the pdf editor's Markdown / EPUB conversion screen: the File
 * menu items open the editor's dialog, and the dialog's requests around a job
 * (free the target, open the result, show it in the folder) are answered here.
 * The rules live in pdf-convert-ui-handlers.ts.
 */
import { existsSync } from 'node:fs'
import { ipcMain, shell } from 'electron'
import type { WebContents } from 'electron'
import { PDF_CHANNELS } from '../../../pdf/src/shared/ipc'
import type { PdfReflowFormat } from '../../../pdf/src/shared/ipc'
import { pdfPathGranted } from '../../../pdf/src/main/pdf-main'
import { createPdfConvertUiHandlers, type PdfConvertUiTabs } from './pdf-convert-ui-handlers'

/** File menu › Markdown / EPUB, or Save As › Markdown (with the picked target):
    the pdf tab opens its conversion dialog */
export function requestPdfConvertDialog(
  contents: WebContents | undefined,
  format: PdfReflowFormat,
  outPath?: string,
): void {
  if (!contents || contents.isDestroyed()) return
  contents.send(PDF_CHANNELS.convertDialogRequest, {
    format,
    ...(outPath !== undefined ? { outPath } : {}),
  })
}

/**
 * File menu › Markdown: asks first while the editor the result opens in is
 * off (editor choice spec 7.3), then opens the dialog. "Create the file only"
 * opens it as well: the result is shown in its folder instead of a tab.
 */
export async function askThenRequestPdfConvertDialog(
  tab: { webContents: WebContents; filePath?: string } | undefined,
  format: PdfReflowFormat,
): Promise<void> {
  if (!tab?.filePath || !askBeforeConvert) return
  if ((await askBeforeConvert(format, tab.filePath)) === 'cancel') return
  requestPdfConvertDialog(tab.webContents, format)
}

let registered = false
let askBeforeConvert: PdfConvertUiTabs['askBeforeConvert'] | null = null

export function registerPdfConvertUiIpc(tabs: PdfConvertUiTabs): void {
  if (registered) return
  registered = true
  askBeforeConvert = tabs.askBeforeConvert
  const h = createPdfConvertUiHandlers({
    ...tabs,
    ownsSource: (viewId, path) => pdfPathGranted(viewId, path),
    exists: (path) => existsSync(path),
    showInFolder: (path) => shell.showItemInFolder(path),
  })
  ipcMain.handle(PDF_CHANNELS.convertReleaseTarget, (e, req) => h.releaseTarget(e.sender.id, req))
  ipcMain.handle(PDF_CHANNELS.convertOpenResult, (e, req) => h.openResult(e.sender.id, req))
  ipcMain.handle(PDF_CHANNELS.convertAskBeforeOpen, (e, req) =>
    h.askBeforeConvert(e.sender.id, req),
  )
  ipcMain.handle(PDF_CHANNELS.convertRevealResult, (e, req) => h.revealResult(e.sender.id, req))
}
