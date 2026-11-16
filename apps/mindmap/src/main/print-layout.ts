/**
 * Advanced print layout for the mind map (decision 0141), the main-process
 * side. The print job PDF is the one page Print prints: the renderer's page
 * HTML (`snapshotPage`, the sheet on screen fitted to landscape A4) made into a
 * PDF the way the PDF export makes it. The shared print layout arranges it and
 * previews, prints or saves the result.
 */
import {
  registerPrintLayoutIpc,
  type PrintLayoutInvokeEvent,
  type PrintLayoutIpcHandlers,
  type PrintLayoutIpcMain,
  type PrintLayoutWindow,
} from '@genoffice/electron-utils/print-arranged'
import { MINDMAP_PRINT_LAYOUT_PREFIX, type MindmapPrintJob } from '../shared/ipc'

/** A page larger than this is no map page this editor wrote (as the print channel refuses). */
export const MAX_PRINT_PAGE_CHARS = 200 * 1024 * 1024

/** The job a request carries, or why it is no print job of this editor. */
export function printJobOf(editor: unknown): MindmapPrintJob | string {
  if (typeof editor !== 'object' || editor === null) return 'not a print job'
  const { html, suggestedName } = editor as Record<string, unknown>
  if (typeof html !== 'string' || html === '' || html.length > MAX_PRINT_PAGE_CHARS) {
    return 'bad print page'
  }
  return { html, suggestedName: typeof suggestedName === 'string' ? suggestedName : '' }
}

/** The page as the print job PDF; a request that is not a print job is refused before any window. */
export async function mindmapJobPdf(
  editor: unknown,
  pageToPdf: (html: string) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const job = printJobOf(editor)
  if (typeof job === 'string') throw new Error(`mindmap: ${job}`)
  const pdf = await pageToPdf(job.html)
  return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength)
}

export interface MindmapPrintLayoutSetup {
  ipcMain: PrintLayoutIpcMain
  /** the PDF export's page to PDF: landscape A4, no margin, in the export session */
  pageToPdf: (html: string) => Promise<Uint8Array>
  /** the hidden window the arranged faces print from (scripts on, for the readiness check) */
  createPrintWindow: (event: PrintLayoutInvokeEvent) => PrintLayoutWindow
  /** the PDF export's save dialog, offering this name; null when the user cancels */
  pickSavePath: (event: PrintLayoutInvokeEvent, suggestedName: string) => Promise<string | null>
  runner?: PrintLayoutIpcHandlers<MindmapPrintJob>['runner']
  platform?: NodeJS.Platform
}

/** `mindmap:print-layout-preview|print|save|cancel`. */
export function registerMindmapPrintLayout(setup: MindmapPrintLayoutSetup): () => void {
  return registerPrintLayoutIpc<MindmapPrintJob>(MINDMAP_PRINT_LAYOUT_PREFIX, {
    ipcMain: setup.ipcMain,
    buildJobPdf: (_event, editor) => mindmapJobPdf(editor, setup.pageToPdf),
    createPrintWindow: setup.createPrintWindow,
    pickSavePath: async (event, editor) => {
      const job = printJobOf(editor)
      // a request that is no print job is refused before the dialog opens
      if (typeof job === 'string') throw new Error(`mindmap: ${job}`)
      return setup.pickSavePath(event, job.suggestedName)
    },
    ...(setup.runner ? { runner: setup.runner } : {}),
    ...(setup.platform ? { platform: setup.platform } : {}),
  })
}
