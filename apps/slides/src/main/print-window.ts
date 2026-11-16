import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PRINT_READY_SCRIPT,
  printHtmlDocument,
  type PrintDialogWindow,
} from '@genoffice/electron-utils'
import type { PrintSlidesOp } from '../shared/ipc'
import { buildPrintDocumentHtml } from '../shared/print-html'

export type PrintWindow = PrintDialogWindow

/** Cancel comes back as a bare `{ ok: false }` so the renderer keeps its print dialog open. */
export async function printSlidesHtml(
  html: string,
  win: PrintWindow,
  platform: NodeJS.Platform = process.platform,
): Promise<{ ok: boolean; error?: string }> {
  const outcome = await printHtmlDocument({
    html,
    window: win,
    fileName: 'slides.html',
    dirPrefix: 'genoffice-slides-print-',
    platform,
  })
  if (!outcome.ok) return { ok: false, error: outcome.error }
  if ('canceled' in outcome) return { ok: false }
  return { ok: true }
}

/** The print document of a print op; page assembly is shared with the dialog's preview. */
export function slidesPrintHtml(op: PrintSlidesOp): string {
  return buildPrintDocumentHtml({
    srcs: op.pngsBase64.map((b64) => `data:image/png;base64,${b64}`),
    ratio: op.widthPx / op.heightPx,
    layout: op.layout ?? 'full',
    ...(op.notes ? { notes: op.notes } : {}),
    ...(op.orientation ? { orientation: op.orientation } : {}),
    ...(op.frame ? { frame: true } : {}),
  })
}

const PRINT_LAYOUTS = new Set(['full', 'handout2', 'handout3', 'handout6', 'notes'])
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

/** The print op the dialog sends with an advanced print request. */
export function isPrintSlidesOp(v: unknown): v is PrintSlidesOp {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    isStringArray(o.pngsBase64) &&
    o.pngsBase64.length > 0 &&
    typeof o.widthPx === 'number' &&
    Number.isFinite(o.widthPx) &&
    typeof o.heightPx === 'number' &&
    Number.isFinite(o.heightPx) &&
    (o.layout === undefined || (typeof o.layout === 'string' && PRINT_LAYOUTS.has(o.layout))) &&
    (o.notes === undefined || isStringArray(o.notes)) &&
    (o.orientation === undefined ||
      o.orientation === 'portrait' ||
      o.orientation === 'landscape') &&
    (o.frame === undefined || typeof o.frame === 'boolean')
  )
}

/** Hidden window the job PDF is printed in; the caller owns its webPreferences. */
export interface PrintJobPdfWindow {
  loadFile(path: string): Promise<void>
  webContents: {
    executeJavaScript(script: string, userGesture?: boolean): Promise<unknown>
    printToPDF(options: Electron.PrintToPDFOptions): Promise<Buffer>
  }
  destroy(): void
}

/** A renderer that never settles must fail the job, not hold it (same budget as PDF export). */
const JOB_PDF_TIMEOUT_MS = 300_000

/**
 * The advanced print job PDF: the same print document `slides:print` sends to
 * the system dialog (range, hidden slides, layout and frame applied), printed
 * to PDF at its own @page size. The window and the temp folder go on every path.
 */
export async function slidesPrintJobPdf(
  op: unknown,
  createWindow: () => PrintJobPdfWindow,
  timeoutMs: number = JOB_PDF_TIMEOUT_MS,
): Promise<Uint8Array> {
  if (!isPrintSlidesOp(op)) throw new Error('invalid slides print request')
  const html = slidesPrintHtml(op)
  let tempDir: string | null = null
  let win: PrintJobPdfWindow | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // a temp file, not a data: URL: long documents truncate the URL
    tempDir = await mkdtemp(join(tmpdir(), 'genoffice-slides-print-job-'))
    const htmlPath = join(tempDir, 'slides.html')
    await writeFile(htmlPath, html, 'utf8')
    const opened = createWindow()
    win = opened
    const pdf = await Promise.race([
      (async () => {
        await opened.loadFile(htmlPath)
        await opened.webContents.executeJavaScript(PRINT_READY_SCRIPT, true)
        return opened.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        })
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`slides print job timed out after ${timeoutMs}ms`)),
          timeoutMs,
        )
      }),
    ])
    return new Uint8Array(pdf)
  } finally {
    if (timer) clearTimeout(timer)
    try {
      win?.destroy()
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true, force: true })
    }
  }
}
