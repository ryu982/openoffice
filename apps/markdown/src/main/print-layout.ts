import {
  registerPrintLayoutIpc,
  type PrintLayoutInvokeEvent,
  type PrintLayoutIpcHandlers,
  type PrintLayoutIpcMain,
  type PrintLayoutWindow,
} from '@genoffice/electron-utils/print-arranged'
import {
  MAX_PRINT_HTML_CHARS,
  normalizeMarkdownPrintOptions,
  type MarkdownPageRange,
  type MarkdownPrintOptions,
} from '../shared/print-options'
import type { MarkdownPrintLayoutJob } from '../shared/ipc'
import { printMarkdownPdf } from './print-pdf'

/**
 * Advanced print layout for Markdown notes (decision 0141). The print job PDF is
 * the print preview's: the same print HTML and paper through `printMarkdownPdf`,
 * kept to the dialog's page range when it chose one. The shared module arranges
 * it and prints or saves the result.
 */

export type MarkdownPdfMaker = (
  html: string,
  options: MarkdownPrintOptions,
  pages?: MarkdownPageRange,
) => Promise<Uint8Array>

/** Why `editor` is not a print job, or null; checked before any window opens. */
function badJob(editor: unknown): string | null {
  if (typeof editor !== 'object' || editor === null) return 'not a print job'
  const job = editor as Partial<MarkdownPrintLayoutJob>
  if (typeof job.html !== 'string' || !job.html || job.html.length > MAX_PRINT_HTML_CHARS) {
    return 'bad print HTML'
  }
  const pages = job.pages
  if (pages === null) return null
  if (
    typeof pages !== 'object' ||
    !Number.isInteger(pages?.from) ||
    !Number.isInteger(pages?.to) ||
    pages.from < 1 ||
    pages.to < pages.from
  ) {
    return 'bad print range'
  }
  return null
}

/** The job as the print preview's PDF; a request that is not a print job is refused. */
export async function markdownJobPdf(
  editor: unknown,
  makePdf: MarkdownPdfMaker = printMarkdownPdf,
): Promise<Uint8Array> {
  const bad = badJob(editor)
  if (bad) throw new Error(`markdown: ${bad}`)
  const job = editor as MarkdownPrintLayoutJob
  // the margins are the print options' own, as on the preview channel
  const options = normalizeMarkdownPrintOptions(job.options)
  const pdf = job.pages
    ? await makePdf(job.html, options, { from: job.pages.from, to: job.pages.to })
    : await makePdf(job.html, options)
  return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength)
}

export interface MarkdownPrintLayoutSetup {
  ipcMain: PrintLayoutIpcMain
  /** the hidden window the arranged faces print from (scripts on, for the readiness check) */
  createPrintWindow: (event: PrintLayoutInvokeEvent) => PrintLayoutWindow
  /** the PDF export's save dialog for the job's document; null when the user cancels */
  pickSavePath: (
    event: PrintLayoutInvokeEvent,
    job: MarkdownPrintLayoutJob | undefined,
  ) => Promise<string | null>
  /** tests only: stands in for `printMarkdownPdf` */
  makePdf?: MarkdownPdfMaker
  runner?: PrintLayoutIpcHandlers<MarkdownPrintLayoutJob>['runner']
  platform?: NodeJS.Platform
}

/** `markdown:print-layout-preview|print|save|cancel`. */
export function registerMarkdownPrintLayout(setup: MarkdownPrintLayoutSetup): () => void {
  return registerPrintLayoutIpc<MarkdownPrintLayoutJob>('markdown', {
    ipcMain: setup.ipcMain,
    buildJobPdf: (_event, editor) => markdownJobPdf(editor, setup.makePdf),
    createPrintWindow: setup.createPrintWindow,
    pickSavePath: (event, editor) => setup.pickSavePath(event, editor),
    ...(setup.runner ? { runner: setup.runner } : {}),
    ...(setup.platform ? { platform: setup.platform } : {}),
  })
}
