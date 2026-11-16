import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readJobPageSizes } from '@genoffice/print-layout'
import type { PageSize } from '@genoffice/print-layout/plan'
import {
  registerPrintLayoutIpc,
  type PrintLayoutInvokeEvent,
  type PrintLayoutIpcMain,
  type PrintLayoutRunner,
  type PrintLayoutWindow,
} from '@genoffice/electron-utils/print-arranged'
import { PRINT_READY_SCRIPT } from '@genoffice/electron-utils/print-window'
import { HTML_CHANNELS, type HtmlPrintJob, type PrintJobPagesResult } from '../shared/ipc'
import {
  pickPrintPages,
  printPagesText,
  readPrintPageRanges,
  type HtmlPrintPageRange,
} from '../shared/print-range'

/**
 * Advanced print layout for HTML pages (decision 0141). The print job PDF is
 * made from the page loaded the way the print loads it (a temp file in a hidden
 * window with scripting on, then the fonts/images readiness probe), not in the
 * script-free window of the PDF export: script-built content prints as the
 * print shows it. The shared module arranges that PDF and prints or saves it.
 */

/** The PDF export's paper and margins (`renderPrintPdf`); a page's own `@page` rule wins. */
export const HTML_JOB_PDF_OPTIONS = {
  pageSize: 'A4',
  printBackground: true,
  margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
} as const

export interface HtmlJobPdfOptions {
  pageSize: 'A4'
  printBackground: boolean
  margins: { top: number; bottom: number; left: number; right: number }
  /** Chromium's page range text, "1-3, 5" */
  pageRanges?: string
}

/** The hidden window a job PDF is made in; the caller owns its webPreferences (scripting on). */
export interface HtmlJobWindow {
  loadFile(path: string): Promise<void>
  webContents: {
    executeJavaScript(script: string, userGesture?: boolean): Promise<unknown>
    printToPDF(options: HtmlJobPdfOptions): Promise<Uint8Array>
  }
  isDestroyed(): boolean
  destroy(): void
}

// the same wait the print gives the probe (printHtmlDocument): a page script
// that never yields must not hold the job
const PRINT_READY_TIMEOUT_MS = 5_000

export interface HtmlJobPdfRequest {
  /** the final page, assets already resolved (`buildPreviewDocument`) */
  document: string
  /** absent = every page */
  ranges?: readonly HtmlPrintPageRange[] | undefined
  createWindow: () => HtmlJobWindow
  dirPrefix?: string
}

export interface HtmlJobPdf {
  pdf: Uint8Array
  /** the job's pages, in points */
  pages: PageSize[]
}

const bytesOf = (pdf: Uint8Array): Uint8Array =>
  new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength)

/**
 * The print job PDF of a page. A range prints the whole page once to count its
 * pages, then only the range's pages (document order, each once, past-the-end
 * pages left out); a range that leaves no page is refused. The window and the
 * temp folder go on every path.
 */
export async function renderHtmlJobPdf(req: HtmlJobPdfRequest): Promise<HtmlJobPdf> {
  let tempDir: string | null = null
  let win: HtmlJobWindow | null = null
  try {
    // a temp file, not a data: URL, as the print loads it: long pages truncate the URL
    tempDir = await mkdtemp(join(tmpdir(), req.dirPrefix ?? 'genoffice-html-print-job-'))
    const htmlPath = join(tempDir, 'print.html')
    await writeFile(htmlPath, req.document, 'utf8')
    win = req.createWindow()
    await win.loadFile(htmlPath)
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      win.webContents.executeJavaScript(PRINT_READY_SCRIPT, true),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, PRINT_READY_TIMEOUT_MS)
      }),
    ]).catch((err: unknown) => {
      console.error('[html] print readiness probe failed:', err)
    })
    clearTimeout(timer)

    const whole = bytesOf(await win.webContents.printToPDF({ ...HTML_JOB_PDF_OPTIONS }))
    const pages = await readJobPageSizes(whole)
    if (!req.ranges) return { pdf: whole, pages }
    const picked = pickPrintPages(req.ranges, pages.length)
    if (picked.length === 0) {
      throw new Error(`the page range has none of the document's ${pages.length} pages`)
    }
    if (picked.length === pages.length) return { pdf: whole, pages }
    const pdf = bytesOf(
      await win.webContents.printToPDF({
        ...HTML_JOB_PDF_OPTIONS,
        pageRanges: printPagesText(picked),
      }),
    )
    return { pdf, pages: await readJobPageSizes(pdf) }
  } finally {
    try {
      if (win && !win.isDestroyed()) win.destroy()
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

/** A request's print job, checked; throws for anything else. */
export function readHtmlPrintJob(editor: unknown): HtmlPrintJob {
  if (typeof editor !== 'object' || editor === null) throw new Error('html: bad print job')
  const r = editor as Record<string, unknown>
  if (typeof r.html !== 'string') throw new Error('html: bad print job')
  const job: HtmlPrintJob = { html: r.html }
  if (typeof r.suggestedName === 'string') job.suggestedName = r.suggestedName
  if (r.ranges !== undefined) {
    const ranges = readPrintPageRanges(r.ranges)
    if (!ranges) throw new Error('html: bad print range')
    job.ranges = ranges
  }
  return job
}

export interface HtmlPrintLayoutSetup {
  ipcMain: PrintLayoutIpcMain
  /** the asking view's page as the print loads it: `buildPreviewDocument` with its asset base */
  documentOf: (event: PrintLayoutInvokeEvent, html: string) => string
  /** the print's hidden window: scripting on, sandboxed */
  createJobWindow: () => HtmlJobWindow
  /** the hidden window the arranged faces print from (scripting on, for the readiness check) */
  createPrintWindow: (event: PrintLayoutInvokeEvent) => PrintLayoutWindow
  /** the PDF export's save dialog; null when the user cancels */
  pickSavePath: (
    event: PrintLayoutInvokeEvent,
    suggestedName: string | undefined,
  ) => Promise<string | null>
  runner?: PrintLayoutRunner
  platform?: NodeJS.Platform
}

/** `html:print-layout-preview|print|save|cancel` and `html:print-job-pages`. */
export function registerHtmlPrintLayout(setup: HtmlPrintLayoutSetup): () => void {
  const removeLayout = registerPrintLayoutIpc<HtmlPrintJob>('html', {
    ipcMain: setup.ipcMain,
    buildJobPdf: async (event, editor) => {
      const job = readHtmlPrintJob(editor)
      const { pdf } = await renderHtmlJobPdf({
        document: setup.documentOf(event, job.html),
        ranges: job.ranges,
        createWindow: setup.createJobWindow,
      })
      return pdf
    },
    createPrintWindow: setup.createPrintWindow,
    pickSavePath: (event, editor) => {
      const name =
        typeof editor === 'object' && editor !== null
          ? (editor as { suggestedName?: unknown }).suggestedName
          : undefined
      return setup.pickSavePath(event, typeof name === 'string' ? name : undefined)
    },
    ...(setup.runner ? { runner: setup.runner } : {}),
    ...(setup.platform ? { platform: setup.platform } : {}),
  })
  // The dialog's layout diagram: every page's size, counted once per dialog.
  setup.ipcMain.handle(
    HTML_CHANNELS.printJobPages,
    async (event: PrintLayoutInvokeEvent, raw: unknown): Promise<PrintJobPagesResult> => {
      const html =
        typeof raw === 'object' && raw !== null ? (raw as { html?: unknown }).html : undefined
      if (typeof html !== 'string') return { ok: false, error: 'html: bad print request' }
      try {
        const { pages } = await renderHtmlJobPdf({
          document: setup.documentOf(event, html),
          createWindow: setup.createJobWindow,
        })
        return { ok: true, pages }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )
  return () => {
    removeLayout()
    setup.ipcMain.removeHandler?.(HTML_CHANNELS.printJobPages)
  }
}
