/**
 * Advanced print for the PDF editor (spec 5, "PDF"). The print job PDF is made
 * from the view's saved document: the chosen pages on a copy, annotations
 * baked into the page when "include annotations" is on (arranging re-places
 * page content and does not carry annotation objects), or left out entirely
 * when it is off, form fields included, as the current print draws them with
 * pdf.js annotations disabled. The file on disk is never written. A file with
 * permission restrictions prints and previews, but its arranged result is not
 * saved as a PDF: that copy would carry none of the restrictions.
 *
 * Kept free of Electron imports: `pdf-main.ts` hands in the window, dialog and
 * file access.
 */
import { PDFDocument, PDFName } from 'pdf-lib'
import {
  ensurePrintLayoutIpc,
  registerPrintLayoutIpc,
  type PrintLayoutInvokeEvent,
  type PrintLayoutIpcMain,
  type PrintLayoutRunner,
  type PrintLayoutWindow,
} from '@genoffice/electron-utils/print-arranged'
import { PDF_PRINT_SAVE_RESTRICTED, type PdfPrintLayoutEditor } from '../shared/ipc'
import { flattenAnnotsBytes } from './annot-flatten'
import { decryptDocument } from './pdf-crypt'
import { pdfLooksEncrypted } from './pdf-recovery'

/** Channel prefix of the PDF editor's advanced print (`pdf:print-layout-*`). */
export const PDF_PRINT_LAYOUT_PREFIX = 'pdf'

export interface PrintJobRequest {
  /** 1-based pages of the saved file; null is the whole document */
  pages: readonly number[] | null
  includeAnnotations: boolean
}

/** The editor part of a print layout request, or null when it is malformed. */
export function parsePrintLayoutEditor(raw: unknown): PdfPrintLayoutEditor | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.path !== 'string' || r.path === '') return null
  if (typeof r.includeAnnotations !== 'boolean') return null
  let pages: number[] | null = null
  if (r.pages !== null && r.pages !== undefined) {
    if (!Array.isArray(r.pages) || !r.pages.every((n) => typeof n === 'number')) return null
    pages = r.pages as number[]
  }
  return { path: r.path, pages, includeAnnotations: r.includeAnnotations }
}

/** Valid 0-based page indices of the request in document order, each once. */
function jobPageIndices(pages: readonly number[] | null, pageCount: number): number[] {
  if (pages === null) return Array.from({ length: pageCount }, (_, i) => i)
  const indices = [...new Set(pages)]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= pageCount)
    .sort((a, b) => a - b)
    .map((n) => n - 1)
  if (indices.length === 0) {
    throw new Error(
      `none of the requested pages (${pages.join(', ')}) exist in this ${pageCount}-page document`,
    )
  }
  return indices
}

/**
 * The print job PDF for `bytes` (the saved document). A file protected only by
 * an owner password opens like it does for the current print; one that needs
 * a password to open fails the same way.
 */
export async function buildPrintJobPdf(
  bytes: Uint8Array,
  request: PrintJobRequest,
): Promise<Uint8Array> {
  const plain = pdfLooksEncrypted(bytes) ? (await decryptDocument(bytes, '')).bytes : bytes
  // the parsed document is this job's own copy; the bytes are only read
  const src = await PDFDocument.load(plain, { updateMetadata: false })
  const indices = jobPageIndices(request.pages, src.getPageCount())
  if (!request.includeAnnotations) {
    // Before copying, so no annotation, widget or field object reaches the job
    for (const i of indices) src.getPage(i).node.delete(PDFName.of('Annots'))
  }
  const out = await PDFDocument.create({ updateMetadata: false })
  for (const page of await out.copyPages(src, indices)) out.addPage(page)
  const job = await out.save({ useObjectStreams: false })
  return request.includeAnnotations ? flattenAnnotsBytes(job) : job
}

/**
 * Whether `bytes` carry permission restrictions: a real /Encrypt entry. One the
 * empty password cannot open (or a certificate-encrypted one) counts as
 * restricted too; a stray "/Encrypt" outside the trailer does not.
 */
export async function printSourceRestricted(bytes: Uint8Array): Promise<boolean> {
  if (!pdfLooksEncrypted(bytes)) return false
  try {
    return (await decryptDocument(bytes, '')).protection !== undefined
  } catch {
    return true
  }
}

export interface PdfPrintLayoutSetup {
  ipcMain: PrintLayoutIpcMain
  /** the app-wide label grid store, e.g. join(app.getPath('userData'), LABEL_SPEC_FILE_NAME) */
  labelSpecPath: string | (() => string)
  /** the view's own saved document; throws when `path` is not granted to that view */
  readViewBytes(viewId: number, path: string): Promise<Uint8Array>
  /** a hidden window with scripting on, for the face images */
  createPrintWindow(event: PrintLayoutInvokeEvent): PrintLayoutWindow
  /** where to save the arranged PDF; null when the user cancels */
  pickSavePath(event: PrintLayoutInvokeEvent, editor: PdfPrintLayoutEditor): Promise<string | null>
  runner?: PrintLayoutRunner
}

function editorOf(raw: unknown): PdfPrintLayoutEditor {
  const editor = parsePrintLayoutEditor(raw)
  if (!editor) throw new Error('pdf: malformed print request')
  return editor
}

async function refuseRestrictedSave(bytes: Uint8Array): Promise<void> {
  if (await printSourceRestricted(bytes)) throw new Error(PDF_PRINT_SAVE_RESTRICTED)
}

/**
 * Registers `pdf:print-layout-*` and the app-wide label channels. A save of a
 * restricted file is refused before the save dialog, and again on the bytes
 * the job is built from (the file may change while the dialog is open).
 */
export function registerPdfPrintLayout(setup: PdfPrintLayoutSetup): () => void {
  ensurePrintLayoutIpc({ ipcMain: setup.ipcMain, labelSpecPath: setup.labelSpecPath })
  // the save handler asks for a path, then builds the job with the same event
  const saving = new WeakSet<PrintLayoutInvokeEvent>()
  return registerPrintLayoutIpc<unknown>(PDF_PRINT_LAYOUT_PREFIX, {
    ipcMain: setup.ipcMain,
    runner: setup.runner,
    async buildJobPdf(event, raw) {
      const editor = editorOf(raw)
      const bytes = await setup.readViewBytes(event.sender.id, editor.path)
      if (saving.has(event)) await refuseRestrictedSave(bytes)
      return buildPrintJobPdf(bytes, editor)
    },
    createPrintWindow: (event) => setup.createPrintWindow(event),
    async pickSavePath(event, raw) {
      const editor = editorOf(raw)
      await refuseRestrictedSave(await setup.readViewBytes(event.sender.id, editor.path))
      saving.add(event)
      return setup.pickSavePath(event, editor)
    },
  })
}
