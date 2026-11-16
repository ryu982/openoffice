/**
 * Advanced print layout for diagrams (decision 0141). The print job PDF is
 * the print document of the pages the renderer gathered (light SVGs, one
 * sheet per page at its own page format) made by printToPDF in a hidden
 * window of the diagram's session: the same document the plain print and the
 * PDF export show. The shared module arranges it and prints or saves the
 * result.
 */
import {
  registerPrintLayoutIpc,
  type PrintLayoutInvokeEvent,
  type PrintLayoutIpcHandlers,
  type PrintLayoutIpcMain,
  type PrintLayoutWindow,
} from '@genoffice/electron-utils/print-arranged'
import type { DiagramPrintJob, PrintPage } from '../shared/ipc'
import { isPrintPage } from './print-document'

/** The pages and name of a job, or null when the request is not a print job. */
export function diagramPrintJobOf(editor: unknown): { pages: PrintPage[]; title: string } | null {
  if (typeof editor !== 'object' || editor === null) return null
  const job = editor as Partial<DiagramPrintJob>
  const pages = job.pages
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every(isPrintPage)) return null
  return { pages, title: typeof job.title === 'string' ? job.title : '' }
}

/** Makes the job PDF from the print document of these pages (the diagram's hidden window). */
export type DiagramJobPdfRenderer = (
  pages: readonly PrintPage[],
  title: string,
) => Promise<Uint8Array>

/** The renderer's pages as the print job PDF; a request that is not a print job is refused. */
export async function diagramJobPdf(
  editor: unknown,
  render: DiagramJobPdfRenderer,
): Promise<Uint8Array> {
  const job = diagramPrintJobOf(editor)
  if (!job) throw new Error('diagram: bad print pages')
  return render(job.pages, job.title)
}

export interface DiagramPrintLayoutSetup {
  ipcMain: PrintLayoutIpcMain
  /** the print document through printToPDF, in a hidden window of the diagram's session */
  renderJobPdf: DiagramJobPdfRenderer
  /** the hidden window the arranged faces print from (scripts on, for the readiness check) */
  createPrintWindow: (event: PrintLayoutInvokeEvent) => PrintLayoutWindow
  /** the PDF export's save dialog for this job's name; null when the user cancels */
  pickSavePath: (event: PrintLayoutInvokeEvent, title: string) => Promise<string | null>
  runner?: PrintLayoutIpcHandlers<DiagramPrintJob>['runner']
  platform?: NodeJS.Platform
}

/** `diagram:print-layout-preview|print|save|cancel`. */
export function registerDiagramPrintLayout(setup: DiagramPrintLayoutSetup): () => void {
  return registerPrintLayoutIpc<DiagramPrintJob>('diagram', {
    ipcMain: setup.ipcMain,
    buildJobPdf: (_event, editor) => diagramJobPdf(editor, setup.renderJobPdf),
    createPrintWindow: setup.createPrintWindow,
    pickSavePath: (event, editor) =>
      setup.pickSavePath(event, diagramPrintJobOf(editor)?.title ?? ''),
    ...(setup.runner ? { runner: setup.runner } : {}),
    ...(setup.platform ? { platform: setup.platform } : {}),
  })
}
