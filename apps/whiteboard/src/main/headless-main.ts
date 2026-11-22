/**
 * Windowless `--headless-export` runner for `.whiteboard` -> `pdf | png | svg`.
 * Opens the file in a hidden renderer window (`?headless=1`) without prompting for
 * recovery copies and with zero external network requests.
 */
import { ipcMain, type BrowserWindow } from 'electron'
import type { HeadlessExportProduct, HeadlessExportRequest } from '@genoffice/electron-utils'
import { atomicWriteFile } from '@genoffice/electron-utils/atomic-write'
import { whiteboardBaseName } from '../shared/formats'
import {
  WHITEBOARD_CHANNELS,
  type ExportFormat,
  type WhiteboardHeadlessJob,
  type WhiteboardHeadlessReport,
} from '../shared/ipc'
import { looksLikeImage, renderWhiteboardPdf } from './export-main'
import { pageFilePaths } from './export-paths'
import { isPrintPage } from './print-document'
import { createWhiteboardHiddenWindow } from './whiteboard-main'

const JOB_TIMEOUT_MS = 170_000

interface RunningJob {
  job: WhiteboardHeadlessJob
  done: (report: WhiteboardHeadlessReport) => void
}

const running = new Map<number, RunningJob>()
let channelsRegistered = false

function registerHeadlessChannels(): void {
  if (channelsRegistered) return
  channelsRegistered = true
  ipcMain.handle(WHITEBOARD_CHANNELS.headlessJob, (e) => running.get(e.sender.id)?.job ?? null)
  ipcMain.on(WHITEBOARD_CHANNELS.headlessDone, (e, report: unknown) => {
    const valid: WhiteboardHeadlessReport =
      report && typeof report === 'object' && 'ok' in report
        ? (report as WhiteboardHeadlessReport)
        : { ok: false, error: 'whiteboard page sent no report' }
    running.get(e.sender.id)?.done(valid)
  })
}

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

function runInHiddenWindow(
  input: string,
  job: WhiteboardHeadlessJob,
): Promise<WhiteboardHeadlessReport> {
  registerHeadlessChannels()
  const win: BrowserWindow = createWhiteboardHiddenWindow(input)
  const id = win.webContents.id
  return new Promise<WhiteboardHeadlessReport>((resolve) => {
    let settled = false
    const finish = (report: WhiteboardHeadlessReport): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      running.delete(id)
      if (!win.isDestroyed()) win.destroy()
      resolve(report)
    }
    const timer = setTimeout(
      () => finish({ ok: false, error: 'whiteboard editor did not finish in time' }),
      JOB_TIMEOUT_MS,
    )
    running.set(id, { job, done: finish })
    win.webContents.once('render-process-gone', (_e, details) =>
      finish({ ok: false, error: `whiteboard renderer stopped (${details.reason})` }),
    )
    win.webContents.once('did-fail-load', (_e, code, description, _url, isMainFrame) => {
      if (isMainFrame) {
        finish({ ok: false, error: `whiteboard page failed to load (${description || code})` })
      }
    })
  })
}

export async function exportWhiteboardHeadless(
  request: HeadlessExportRequest,
): Promise<HeadlessExportProduct> {
  const format = request.targetFormat as ExportFormat
  if (format !== 'pdf' && format !== 'png' && format !== 'svg') {
    throw new Error(`whiteboard headless export does not support target '${request.targetFormat}'`)
  }
  const report = await runInHiddenWindow(request.input, {
    kind: 'export',
    format,
    ...(request.page !== undefined ? { page: request.page } : {}),
  })
  if (!report.ok) throw new Error(report.error)

  if (format === 'pdf') {
    if (report.kind !== 'pdf' || report.pages.length === 0 || !report.pages.every(isPrintPage)) {
      throw new Error('whiteboard headless export produced invalid PDF pages')
    }
    const pdf = await renderWhiteboardPdf(report.pages, whiteboardBaseName(request.input))
    await atomicWriteFile(request.outPath, asBuffer(pdf))
    return { paths: [request.outPath], detail: { pages: report.pages.length } }
  }

  if (report.kind !== 'images' || report.format !== format || report.pages.length === 0) {
    throw new Error(`whiteboard headless export produced invalid ${format} pages`)
  }
  const files = report.pages.map((p) => {
    const bytes = bytesOf(p.bytes)
    if (!bytes || !looksLikeImage(format, bytes)) {
      throw new Error(`page ${p.number} is not a valid ${format} image`)
    }
    return { number: p.number, bytes }
  })
  const perPage = request.page === undefined
  const paths = pageFilePaths(
    request.outPath,
    format,
    files.map((f) => f.number),
    perPage,
  )
  for (let i = 0; i < files.length; i++) {
    await atomicWriteFile(paths[i]!, asBuffer(files[i]!.bytes))
  }
  return {
    paths,
    detail: {
      pages: files.length,
      ...(paths.length > 1 ? { output_paths: paths } : {}),
    },
  }
}
