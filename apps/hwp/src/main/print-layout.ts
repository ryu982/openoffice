import {
  registerPrintLayoutIpc,
  type PrintLayoutInvokeEvent,
  type PrintLayoutIpcHandlers,
  type PrintLayoutIpcMain,
  type PrintLayoutWindow,
} from '@genoffice/electron-utils/print-arranged'
import { badJob, printJobToPdf, type PrintWindow } from './print-document'
import type { PrintJob } from '../shared/ipc'

/**
 * Advanced print layout for Hangul documents (decision 0141). The print job PDF is the
 * one "Export as PDF" makes: the pages the renderer gathered for print, in the same
 * printable HTML, through printToPDF in a hidden window with scripts off. The shared
 * module arranges it and prints or saves the result.
 */

/** The renderer's pages as the print job PDF; a request that is not a print job is refused. */
export async function hwpJobPdf(
  editor: unknown,
  createWindow: () => PrintWindow,
): Promise<Uint8Array> {
  const bad = badJob(editor)
  if (bad) throw new Error(`hwp: ${bad}`)
  const { pages, images } = editor as PrintJob
  const pdf = await printJobToPdf({ mode: 'pdf', pages, images }, createWindow)
  return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength)
}

export interface HwpPrintLayoutSetup {
  ipcMain: PrintLayoutIpcMain
  /** the hidden window the job PDF is made in: the PDF export's (scripts off) */
  createJobWindow: () => PrintWindow
  /** the hidden window the arranged faces print from (scripts on, for the readiness check) */
  createPrintWindow: (event: PrintLayoutInvokeEvent) => PrintLayoutWindow
  /** the PDF export's save dialog; null when the user cancels */
  pickSavePath: (event: PrintLayoutInvokeEvent) => Promise<string | null>
  runner?: PrintLayoutIpcHandlers<PrintJob>['runner']
  platform?: NodeJS.Platform
}

/** `hwp:print-layout-preview|print|save|cancel`. */
export function registerHwpPrintLayout(setup: HwpPrintLayoutSetup): () => void {
  return registerPrintLayoutIpc<PrintJob>('hwp', {
    ipcMain: setup.ipcMain,
    buildJobPdf: (_event, editor) => hwpJobPdf(editor, setup.createJobWindow),
    createPrintWindow: setup.createPrintWindow,
    pickSavePath: (event) => setup.pickSavePath(event),
    ...(setup.runner ? { runner: setup.runner } : {}),
    ...(setup.platform ? { platform: setup.platform } : {}),
  })
}
