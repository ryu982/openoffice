/// Advanced print layout for the sheets editor (spec 5): the Print dialog's
/// shared layout panel sends the request its plain print would send; the job
/// PDF is that HTML through printToPDF (pdf-export.ts), and the shared module
/// arranges it and prints, previews or saves the result.
import { join } from 'node:path'

import { app, BrowserWindow, dialog } from 'electron'

import { showSaveDialogWithMemory } from '@genoffice/electron-utils'
import {
  ensurePrintLayoutIpc,
  LABEL_SPEC_FILE_NAME,
  registerPrintLayoutIpc,
  type PrintLayoutInvokeEvent,
  type PrintLayoutIpcMain,
  type PrintLayoutRunner,
} from '@genoffice/electron-utils/print-arranged'

import {
  workbookExportPdfRequestSchema,
  type WorkbookExportPdfRequest,
} from '../shared/desktop-api'
import { buildPrintJobPdf } from './pdf-export'

import type { WebContents } from 'electron'

/// Channel prefix: `sheets:print-layout-*`.
export const SHEETS_PRINT_LAYOUT_PREFIX = 'sheets'

export interface SheetsPrintLayoutSetup {
  readonly ipcMain: PrintLayoutIpcMain
  /// Throws unless the sender is a sheets tab; runs before anything is built.
  readonly assertSender: (event: PrintLayoutInvokeEvent) => void
  readonly runner?: PrintLayoutRunner
  readonly platform?: NodeJS.Platform
}

function ownerOf(event: PrintLayoutInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender as unknown as WebContents)
}

function jobRequest(editor: unknown): WorkbookExportPdfRequest {
  return workbookExportPdfRequestSchema.parse(editor)
}

/// The face images print from this window. Same shape as printWorkbook's: on
/// Windows the system dialog attaches to the printed window, which the shared
/// module shows for it.
function createLayoutPrintWindow(owner: BrowserWindow | null, platform: NodeJS.Platform) {
  return new BrowserWindow({
    show: false,
    ...(owner && !owner.isDestroyed() ? { parent: owner } : {}),
    ...(platform === 'win32'
      ? { width: 900, height: 700, autoHideMenuBar: true, closable: false, skipTaskbar: true }
      : {}),
    // scripting on for the shared module's readiness check of the face images
    webPreferences: { sandbox: true, javascript: true },
  })
}

export function registerSheetsPrintLayoutIpc(setup: SheetsPrintLayoutSetup): () => void {
  ensurePrintLayoutIpc({
    ipcMain: setup.ipcMain,
    labelSpecPath: () => join(app.getPath('userData'), LABEL_SPEC_FILE_NAME),
  })
  const platform = setup.platform ?? process.platform
  return registerPrintLayoutIpc<WorkbookExportPdfRequest>(SHEETS_PRINT_LAYOUT_PREFIX, {
    ipcMain: setup.ipcMain,
    async buildJobPdf(event, editor) {
      setup.assertSender(event)
      return buildPrintJobPdf(jobRequest(editor))
    },
    createPrintWindow: (event) => createLayoutPrintWindow(ownerOf(event), platform),
    async pickSavePath(event, editor) {
      setup.assertSender(event)
      const request = jobRequest(editor)
      const selection = await showSaveDialogWithMemory(dialog, ownerOf(event), {
        defaultPath: request.fileName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      return selection.canceled || !selection.filePath ? null : selection.filePath
    },
    ...(setup.runner ? { runner: setup.runner } : {}),
    platform,
  })
}
