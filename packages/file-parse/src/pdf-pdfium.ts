import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// FPDF_ERR_* error codes returned by FPDF_GetLastError() (fpdf_view.h).
export const FPDF_ERR_UNKNOWN = 1
export const FPDF_ERR_FILE = 2
export const FPDF_ERR_FORMAT = 3
export const FPDF_ERR_PASSWORD = 4
export const FPDF_ERR_SECURITY = 5

/** Minimal PDFium WASM surface needed for plain-text extraction. */
export interface TextPdfiumModule {
  HEAPU8: Uint8Array
  _malloc(size: number): number
  _free(ptr: number): void
  _PDFiumExt_Init(): void
  _FPDF_LoadMemDocument(ptr: number, size: number, password: number): number
  _FPDF_GetLastError(): number
  _FPDF_CloseDocument(doc: number): void
  _FPDF_GetPageCount(doc: number): number
  _FPDF_LoadPage(doc: number, index: number): number
  _FPDF_ClosePage(page: number): void
  _FPDFText_LoadPage(page: number): number
  _FPDFText_ClosePage(textPage: number): void
  _FPDFText_CountChars(textPage: number): number
  _FPDFText_GetText(textPage: number, startIndex: number, count: number, result: number): number
}

export type PdfDocumentErrorCode = 'password-required' | 'corrupt' | 'unsupported'

/**
 * Semantic PDF rejection (password-protected, unsupported encryption, corrupt
 * structure). Callers must NOT fall back to pdfjs-dist on this error.
 */
export class PdfDocumentError extends Error {
  readonly code: PdfDocumentErrorCode
  readonly fpdfError: number

  constructor(code: PdfDocumentErrorCode, fpdfError: number, message?: string) {
    super(message ?? defaultDocumentErrorMessage(code, fpdfError))
    this.name = 'PdfDocumentError'
    this.code = code
    this.fpdfError = fpdfError
  }
}

/**
 * Infrastructure failure in the PDFium WASM path (missing wasm binary, failed
 * module initialization, WASM trap or OOM). Callers may safely fall back to
 * the pure-JS pdfjs-dist extractor on this error.
 */
export class PdfiumInfraError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined)
    this.name = 'PdfiumInfraError'
  }
}

function defaultDocumentErrorMessage(code: PdfDocumentErrorCode, fpdfError: number): string {
  switch (code) {
    case 'password-required':
      // Contains "Password-protected" so Quick Look classifies the file as encrypted.
      return 'Password-protected PDF: open it with its password, or remove the password and attach it again'
    case 'corrupt':
      return `Invalid or corrupted PDF structure (FPDF error ${fpdfError})`
    case 'unsupported':
      if (fpdfError === FPDF_ERR_SECURITY) {
        // Contains "Encrypted" so Quick Look classifies certificate-encrypted PDFs as encrypted.
        return `Encrypted PDF uses an unsupported security handler (FPDF error ${fpdfError})`
      }
      return `Unable to load PDF document (FPDF error ${fpdfError})`
  }
}

export function classifyPdfiumLoadError(fpdfError: number): PdfDocumentErrorCode {
  if (fpdfError === FPDF_ERR_PASSWORD) return 'password-required'
  if (
    fpdfError === FPDF_ERR_FILE ||
    fpdfError === FPDF_ERR_FORMAT ||
    fpdfError === FPDF_ERR_UNKNOWN
  ) {
    return 'corrupt'
  }
  return 'unsupported'
}

/**
 * True when `GENOFFICE_PDF_PDFIUM=0` or `GENOFFICE_PDF_PDFIUM=off` (trimmed,
 * case-insensitive) disables the PDFium path and forces pdfjs-dist.
 */
export function isPdfPdfiumDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.GENOFFICE_PDF_PDFIUM?.trim().toLowerCase()
  return raw === '0' || raw === 'off'
}

export interface ResolvePdfiumWasmPathOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly resourcesPath?: string | undefined
  readonly exists?: (path: string) => boolean
  readonly resolveModule?: (specifier: string) => string
  readonly moduleUrl?: string
}

/**
 * Resolves `pdfium.wasm` across dev, tests, packaged Electron app, and bundled CLI:
 * 1. `GENOFFICE_PDFIUM_WASM_PATH` (explicit override; returned as-is so invalid overrides fail over cleanly)
 * 2. `GENOFFICE_PDFIUM_WASM` (existing CLI override compatibility)
 * 3. Module resolution (`@embedpdf/pdfium/dist/pdfium.wasm`, then `@embedpdf/pdfium/pdfium.wasm`)
 * 4. Packaged Electron app (`<process.resourcesPath>/wasm/pdfium.wasm`)
 * 5. Packaged CLI bundle (`<bundleDir>/../wasm/pdfium.wasm` when `process.resourcesPath` is unset)
 */
export function resolvePdfiumWasmPath(options: ResolvePdfiumWasmPathOptions = {}): string | null {
  const env = options.env ?? process.env
  const exists = options.exists ?? existsSync

  const fromOverride = env.GENOFFICE_PDFIUM_WASM_PATH?.trim()
  if (fromOverride) return fromOverride

  const fromCliEnv = env.GENOFFICE_PDFIUM_WASM?.trim()
  if (fromCliEnv) return fromCliEnv

  const resolveModule =
    options.resolveModule ??
    ((specifier: string) => createRequire(import.meta.url).resolve(specifier))

  for (const specifier of ['@embedpdf/pdfium/dist/pdfium.wasm', '@embedpdf/pdfium/pdfium.wasm']) {
    try {
      const resolved = resolveModule(specifier)
      if (resolved && exists(resolved)) return resolved
    } catch {
      // Try the next resolution candidate.
    }
  }

  const resourcesPath =
    'resourcesPath' in options
      ? options.resourcesPath
      : (process as { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    const packaged = join(resourcesPath, 'wasm', 'pdfium.wasm')
    if (exists(packaged)) return packaged
  }

  try {
    const here = dirname(fileURLToPath(options.moduleUrl ?? import.meta.url))
    const cliPackaged = resolve(here, '..', 'wasm', 'pdfium.wasm')
    if (exists(cliPackaged)) return cliPackaged
  } catch {
    // import.meta.url may not be a file URL in some bundled contexts.
  }

  return null
}

const loadedModules = new Map<string, Promise<TextPdfiumModule>>()

/** Loads and initializes one PDFium WASM instance per wasm path and thread. */
export function loadTextPdfium(wasmPath: string): Promise<TextPdfiumModule> {
  let pending = loadedModules.get(wasmPath)
  if (!pending) {
    pending = (async () => {
      try {
        const raw = readFileSync(wasmPath)
        // Exact slice: Node Buffer may view a shared pool larger than the file.
        const wasmBinary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
        const { init } = (await import('@embedpdf/pdfium')) as unknown as {
          init(overrides: object): Promise<object>
        }
        // ASCII thisProgram prevents Emscripten's environ init from aborting when
        // argv[1] holds a non-ASCII document path (e.g. Korean Windows paths).
        const wrapped = (await init({ wasmBinary, thisProgram: 'genoffice-pdf' })) as {
          pdfium?: unknown
        }
        const mod = (wrapped.pdfium ?? wrapped) as TextPdfiumModule
        if (typeof mod?._PDFiumExt_Init !== 'function') {
          throw new PdfiumInfraError('PDFium WASM module is missing _PDFiumExt_Init')
        }
        mod._PDFiumExt_Init()
        return mod
      } catch (err) {
        if (err instanceof PdfiumInfraError) throw err
        throw new PdfiumInfraError(
          `Failed to initialize PDFium WASM from ${wasmPath}: ${err instanceof Error ? err.message : String(err)}`,
          err,
        )
      }
    })()
    pending.catch(() => {
      if (loadedModules.get(wasmPath) === pending) loadedModules.delete(wasmPath)
    })
    loadedModules.set(wasmPath, pending)
  }
  return pending
}

/** Clears cached WASM instances (test helper only). */
export function resetPdfiumCacheForTests(): void {
  loadedModules.clear()
}

/** Returns the current WASM linear memory byte length for a loaded path, or null (test helper). */
export async function getPdfiumHeapSizeForTests(
  wasmPath: string | null = resolvePdfiumWasmPath(),
): Promise<number | null> {
  if (!wasmPath) return null
  const pending = loadedModules.get(wasmPath)
  if (!pending) return null
  const mod = await pending
  return mod.HEAPU8.byteLength
}

const UTF16LE_DECODER = new TextDecoder('utf-16le')

/**
 * Normalizes a single PDFium page's raw UTF-16LE text:
 * - Unifies CRLF/CR line breaks to LF to match the existing extractor contract.
 * - Strips PDFium's line-end soft-hyphen markers (U+FFFE from FPDFText_GetText,
 *   U+0002 from FPDFText_GetUnicode) while preserving regular U+002D hyphens.
 */
export function normalizePdfiumPageText(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replaceAll('\u0002', '').replaceAll('\ufffe', '').trim()
}

export interface PdfiumExtractOptions {
  readonly pathOptions?: ResolvePdfiumWasmPathOptions
}

/**
 * Extracts plain text from PDF bytes using PDFium WASM, one section per page
 * joined by `\n\n`. Never mutates or transfers the caller's `Uint8Array`.
 *
 * Throws:
 * - `PdfDocumentError` for semantic document failures (password, security handler, corrupt PDF)
 * - `PdfiumInfraError` for WASM loading, allocation, or runtime trap failures
 */
export async function extractPdfTextWithPdfium(
  bytes: Uint8Array,
  options: PdfiumExtractOptions = {},
): Promise<string> {
  if (bytes.byteLength === 0) {
    throw new PdfDocumentError('corrupt', FPDF_ERR_FORMAT)
  }

  const wasmPath = resolvePdfiumWasmPath(options.pathOptions)
  if (!wasmPath) {
    throw new PdfiumInfraError('pdfium.wasm not found')
  }

  const m = await loadTextPdfium(wasmPath)

  let ptr = 0
  let doc = 0
  try {
    ptr = m._malloc(bytes.byteLength)
    if (!ptr) {
      throw new PdfiumInfraError(`PDFium WASM malloc failed for ${bytes.byteLength} bytes`)
    }
    // Copy input bytes into WASM linear memory without mutating or detaching caller's buffer.
    m.HEAPU8.set(bytes, ptr)

    doc = m._FPDF_LoadMemDocument(ptr, bytes.byteLength, 0)
    if (!doc) {
      const fpdfError = m._FPDF_GetLastError()
      throw new PdfDocumentError(classifyPdfiumLoadError(fpdfError), fpdfError)
    }

    const pageCount = m._FPDF_GetPageCount(doc)
    const pages: string[] = []
    for (let i = 0; i < pageCount; i++) {
      const page = m._FPDF_LoadPage(doc, i)
      if (!page) {
        pages.push('')
        continue
      }
      try {
        const textPage = m._FPDFText_LoadPage(page)
        if (!textPage) {
          pages.push('')
          continue
        }
        try {
          const count = m._FPDFText_CountChars(textPage)
          if (count <= 0) {
            pages.push('')
            continue
          }
          const bufBytes = (count + 1) * 2
          const buf = m._malloc(bufBytes)
          if (!buf) {
            throw new PdfiumInfraError(`PDFium WASM malloc failed for ${bufBytes} text bytes`)
          }
          try {
            const written = m._FPDFText_GetText(textPage, 0, count, buf)
            const units = written > 0 ? Math.min(written - 1, count) : 0
            const raw =
              units > 0 ? UTF16LE_DECODER.decode(m.HEAPU8.subarray(buf, buf + units * 2)) : ''
            pages.push(normalizePdfiumPageText(raw))
          } finally {
            m._free(buf)
          }
        } finally {
          m._FPDFText_ClosePage(textPage)
        }
      } finally {
        m._FPDF_ClosePage(page)
      }
    }

    return pages.join('\n\n')
  } catch (err) {
    if (err instanceof PdfDocumentError || err instanceof PdfiumInfraError) throw err
    throw new PdfiumInfraError(
      `PDFium WASM runtime failure: ${err instanceof Error ? err.message : String(err)}`,
      err,
    )
  } finally {
    if (doc) m._FPDF_CloseDocument(doc)
    if (ptr) m._free(ptr)
  }
}
