// Main-process / worker side: synchronous loader and error-classifying bridge
// for the prebuilt Rust WASM core (`packages/print-layout/wasm/pkg/`).
// Never imported from `./plan`.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  arrange_pdf,
  convert_bgrx_pixels,
  encode_bgrx_to_png,
  encode_png,
  GrayPdfBuilder,
  initSync,
  read_job_page_sizes,
  rotate_landscape_faces,
} from '../wasm/pkg/print_layout_wasm.js'
import type { PageSize } from './geometry'
import type { PlannedFace } from './sheet-plan'

const SEMANTIC_PREFIX = 'SEMANTIC:'

let wasmInitialized = false
let loadedWasmPath: string | null = null
let failedWasmPath: string | null = null

/** True when `GENOFFICE_PRINT_LAYOUT_RUST=0|off` disables the Rust WASM path. */
export function isPrintLayoutRustDisabled(): boolean {
  const flag = process.env.GENOFFICE_PRINT_LAYOUT_RUST?.trim().toLowerCase()
  return flag === '0' || flag === 'off'
}

/**
 * Resolves the prebuilt `print_layout_wasm_bg.wasm` binary:
 * 1. `GENOFFICE_PRINT_LAYOUT_WASM_PATH` (explicit override for dev/tests)
 * 2. `process.resourcesPath/wasm/print_layout_bg.wasm` (packaged Electron app)
 * 3. Next to a provided `pdfium.wasm` hint path (`<dir>/print_layout_bg.wasm`)
 * 4. Package-relative `../wasm/pkg/print_layout_wasm_bg.wasm` (dev / vitest)
 * 5. Module resolution `@genoffice/print-layout/wasm/pkg/print_layout_wasm_bg.wasm`
 */
export function resolvePrintLayoutWasmPath(hintPdfiumWasmPath?: string | undefined): string | null {
  const envPath = process.env.GENOFFICE_PRINT_LAYOUT_WASM_PATH?.trim()
  if (envPath) return envPath

  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    const packaged = join(resourcesPath, 'wasm', 'print_layout_bg.wasm')
    if (existsSync(packaged)) return packaged
  }

  if (hintPdfiumWasmPath) {
    const sibling = join(dirname(hintPdfiumWasmPath), 'print_layout_bg.wasm')
    if (existsSync(sibling)) return sibling
  }

  try {
    const local = fileURLToPath(new URL('../wasm/pkg/print_layout_wasm_bg.wasm', import.meta.url))
    if (existsSync(local)) return local
  } catch {
    // import.meta.url may not be a file URL inside a bundled chunk
  }

  try {
    return createRequire(import.meta.url).resolve(
      '@genoffice/print-layout/wasm/pkg/print_layout_wasm_bg.wasm',
    )
  } catch {
    return null
  }
}

/** Resets cached WASM initialization/path state between tests. */
export function resetPrintLayoutWasmForTests(): void {
  loadedWasmPath = null
  failedWasmPath = null
}

/**
 * Ensures the Rust WASM core is loaded synchronously. Returns false ONLY when
 * disabled by env (`GENOFFICE_PRINT_LAYOUT_RUST=0|off`) or on an infrastructure
 * failure (missing binary, unreadable file, invalid/uncompilable WASM).
 */
export function ensurePrintLayoutWasm(hintPdfiumWasmPath?: string | undefined): boolean {
  if (isPrintLayoutRustDisabled()) return false
  const targetPath = resolvePrintLayoutWasmPath(hintPdfiumWasmPath)
  if (!targetPath) return false
  if (loadedWasmPath === targetPath && wasmInitialized) return true
  if (failedWasmPath === targetPath) return false

  try {
    const bytes = readFileSync(targetPath)
    if (wasmInitialized) {
      // wasm-bindgen's initSync is a no-op once initialized; validate any new path explicitly.
      if (!WebAssembly.validate(bytes)) {
        failedWasmPath = targetPath
        return false
      }
    } else {
      initSync({ module: bytes })
      wasmInitialized = true
    }
    loadedWasmPath = targetPath
    failedWasmPath = null
    return true
  } catch {
    failedWasmPath = targetPath
    return false
  }
}

function extractSemanticMessage(err: unknown): string | null {
  if (typeof err === 'string' && err.startsWith(SEMANTIC_PREFIX)) {
    return err.slice(SEMANTIC_PREFIX.length)
  }
  if (err instanceof Error && err.message.startsWith(SEMANTIC_PREFIX)) {
    return err.message.slice(SEMANTIC_PREFIX.length)
  }
  return null
}

export type WasmCallResult<T> = { ok: true; value: T } | { ok: false }

/**
 * Runs a Rust WASM call. Semantic errors (`SEMANTIC:...`) are rethrown directly
 * without falling back; infrastructure failures (disabled env, missing/invalid
 * WASM, WebAssembly runtime traps / OOM) return `{ ok: false }` for JS fallback.
 */
export function runWasmOrFallback<T>(
  call: () => T,
  hintPdfiumWasmPath?: string | undefined,
): WasmCallResult<T> {
  if (!ensurePrintLayoutWasm(hintPdfiumWasmPath)) return { ok: false }
  try {
    return { ok: true, value: call() }
  } catch (err) {
    const semantic = extractSemanticMessage(err)
    if (semantic !== null) throw new Error(semantic, { cause: err })
    return { ok: false }
  }
}

export function wasmConvertBgrxPixels(
  bgrx: Uint8Array,
  stride: number,
  width: number,
  height: number,
  grayscale: boolean,
  hintPdfiumWasmPath?: string | undefined,
): WasmCallResult<Uint8Array> {
  return runWasmOrFallback(
    () => convert_bgrx_pixels(bgrx, stride, width, height, grayscale),
    hintPdfiumWasmPath,
  )
}

export function wasmEncodePng(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: 1 | 3,
): WasmCallResult<Uint8Array> {
  return runWasmOrFallback(() => encode_png(pixels, width, height, channels))
}

export function wasmEncodeBgrxToPng(
  bgrx: Uint8Array,
  stride: number,
  width: number,
  height: number,
  grayscale: boolean,
  hintPdfiumWasmPath?: string | undefined,
): WasmCallResult<Uint8Array> {
  return runWasmOrFallback(
    () => encode_bgrx_to_png(bgrx, stride, width, height, grayscale),
    hintPdfiumWasmPath,
  )
}

export function wasmReadJobPageSizes(pdfBytes: Uint8Array): WasmCallResult<PageSize[]> {
  return runWasmOrFallback(() => JSON.parse(read_job_page_sizes(pdfBytes)) as PageSize[])
}

export function wasmArrangePdf(
  pdfBytes: Uint8Array,
  faces: readonly PlannedFace[],
): WasmCallResult<Uint8Array> {
  return runWasmOrFallback(() => arrange_pdf(pdfBytes, JSON.stringify(faces)))
}

export function wasmRotateLandscapeFaces(
  pdfBytes: Uint8Array,
): WasmCallResult<{ pdf: Uint8Array; rotated: number }> {
  return runWasmOrFallback(() => {
    const res = rotate_landscape_faces(pdfBytes)
    try {
      const rotated = res.rotated
      if (rotated === 0) return { pdf: pdfBytes, rotated: 0 }
      const out = res.take_pdf()
      if (!out) throw new Error('SEMANTIC:rotated PDF missing')
      return { pdf: out, rotated }
    } finally {
      res.free()
    }
  })
}

export interface WasmGrayPdfBuilder {
  addBgrxFace(
    bgrx: Uint8Array,
    stride: number,
    widthPx: number,
    heightPx: number,
    widthPt: number,
    heightPt: number,
  ): void
  finish(): Uint8Array
  free(): void
}

export function createWasmGrayPdfBuilder(
  hintPdfiumWasmPath?: string | undefined,
): WasmGrayPdfBuilder | null {
  if (!ensurePrintLayoutWasm(hintPdfiumWasmPath)) return null
  try {
    const inner = new GrayPdfBuilder()
    let freed = false
    const freeOnce = () => {
      if (!freed) {
        freed = true
        inner.free()
      }
    }
    return {
      addBgrxFace(bgrx, stride, widthPx, heightPx, widthPt, heightPt) {
        try {
          inner.add_bgrx_face(bgrx, stride, widthPx, heightPx, widthPt, heightPt)
        } catch (err) {
          const semantic = extractSemanticMessage(err)
          if (semantic !== null) throw new Error(semantic, { cause: err })
          throw err
        }
      },
      finish() {
        try {
          return inner.finish()
        } catch (err) {
          const semantic = extractSemanticMessage(err)
          if (semantic !== null) throw new Error(semantic, { cause: err })
          throw err
        } finally {
          freeOnce()
        }
      },
      free: freeOnce,
    }
  } catch {
    return null
  }
}
