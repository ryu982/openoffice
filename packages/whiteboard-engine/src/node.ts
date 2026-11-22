/**
 * Node.js / Electron main-process entry point for `@genoffice/whiteboard-engine`.
 * Automatically loads and instantiates the committed WASM binary once synchronously.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyTemplate as applyTemplateRaw,
  boardToMarkdown as boardToMarkdownRaw,
  checkExcalidraw as checkExcalidrawRaw,
  checkWhiteboard as checkWhiteboardRaw,
  computePageBounds as computePageBoundsRaw,
  computeStrokeOutline as computeStrokeOutlineRaw,
  createNewArchive as createNewArchiveRaw,
  createNewBoard as createNewBoardRaw,
  extractMarkdown as extractMarkdownRaw,
  extractThumbnail as extractThumbnailRaw,
  importExcalidraw as importExcalidrawRaw,
  initWhiteboardEngineSync,
  isWhiteboardEngineReady,
  openWhiteboardArchive as openWhiteboardArchiveRaw,
  orderBetween as orderBetweenRaw,
  planBoardEdit as planBoardEditRaw,
  readBoardTable as readBoardTableRaw,
  sniffImage as sniffImageRaw,
  validateBoard as validateBoardRaw,
  WhiteboardArchiveHandle,
  WhiteboardOpenError,
} from './index'
import type {
  BatchMode,
  BoardDocument,
  BoardTableView,
  CheckExcalidrawResult,
  CheckWhiteboardResult,
  EditError,
  EditPlanResult,
  ExcalidrawImportSummary,
  ExtractMarkdownResult,
  ImageHeader,
  OpenError,
  Rect,
  TemplateApplyResult,
} from './types'

export * from './types'
export { WhiteboardArchiveHandle, WhiteboardOpenError }

function computeModuleDir(): string {
  try {
    if (typeof import.meta?.url === 'string' && import.meta.url.startsWith('file:')) {
      return dirname(fileURLToPath(import.meta.url))
    }
  } catch {
    // Non-file URL (e.g., jsdom or bundled CJS); fall through to runtime resolution.
  }
  return typeof __dirname === 'string' ? __dirname : ''
}

const MODULE_DIR = computeModuleDir()
const PKG_WASM_PATH = MODULE_DIR ? join(MODULE_DIR, '../pkg/whiteboard_engine_bg.wasm') : ''

function walkUpForWasm(startDir: string): string | null {
  let cur = startDir
  for (let i = 0; i < 8; i++) {
    const candidate = join(cur, 'packages', 'whiteboard-engine', 'pkg', 'whiteboard_engine_bg.wasm')
    if (existsSync(candidate)) return candidate
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return null
}

function resolveWasmPath(): string {
  const envOverride = process.env.GENOFFICE_WHITEBOARD_WASM_PATH
  if (envOverride && existsSync(envOverride)) return envOverride
  if (PKG_WASM_PATH && existsSync(PKG_WASM_PATH)) return PKG_WASM_PATH
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    const packaged = join(resourcesPath, 'wasm', 'whiteboard_engine_bg.wasm')
    if (existsSync(packaged)) return packaged
  }
  if (MODULE_DIR) {
    const sibling = join(MODULE_DIR, '../wasm/whiteboard_engine_bg.wasm')
    if (existsSync(sibling)) return sibling
    const foundFromModule = walkUpForWasm(MODULE_DIR)
    if (foundFromModule) return foundFromModule
  }
  const foundFromCwd = walkUpForWasm(process.cwd())
  if (foundFromCwd) return foundFromCwd
  return PKG_WASM_PATH
}

export const WASM_PATH = PKG_WASM_PATH

/** Loads and instantiates the committed WASM binary once synchronously in Node / Electron main. */
export function ensureWhiteboardEngineSync(): void {
  if (isWhiteboardEngineReady()) return
  const wasmBytes = readFileSync(resolveWasmPath())
  initWhiteboardEngineSync(wasmBytes)
}

export function createNewBoard(id: string, pageId: string, title = ''): BoardDocument {
  ensureWhiteboardEngineSync()
  return createNewBoardRaw(id, pageId, title)
}

export function createNewArchive(doc: BoardDocument): WhiteboardArchiveHandle {
  ensureWhiteboardEngineSync()
  return createNewArchiveRaw(doc)
}

export function openWhiteboardArchive(bytes: Uint8Array): WhiteboardArchiveHandle {
  ensureWhiteboardEngineSync()
  return openWhiteboardArchiveRaw(bytes)
}

export function validateBoard(doc: BoardDocument): { ok: true } | { ok: false; error: OpenError } {
  ensureWhiteboardEngineSync()
  return validateBoardRaw(doc)
}

export function checkWhiteboard(bytes: Uint8Array): CheckWhiteboardResult {
  ensureWhiteboardEngineSync()
  return checkWhiteboardRaw(bytes)
}

export function checkExcalidraw(bytes: Uint8Array, filenameHint?: string): CheckExcalidrawResult {
  ensureWhiteboardEngineSync()
  return checkExcalidrawRaw(bytes, filenameHint)
}

export function importExcalidraw(
  bytes: Uint8Array,
  options: {
    filenameHint?: string
    boardId: string
    pageId: string
    title?: string
  },
): { archive: WhiteboardArchiveHandle; summary: ExcalidrawImportSummary } {
  ensureWhiteboardEngineSync()
  return importExcalidrawRaw(bytes, options)
}

export function extractMarkdown(bytes: Uint8Array, pageFilter?: string): ExtractMarkdownResult {
  ensureWhiteboardEngineSync()
  return extractMarkdownRaw(bytes, pageFilter)
}

export function extractThumbnail(bytes: Uint8Array): Uint8Array | null {
  ensureWhiteboardEngineSync()
  return extractThumbnailRaw(bytes)
}

export function boardToMarkdown(doc: BoardDocument, pageFilter?: string): string | null {
  ensureWhiteboardEngineSync()
  return boardToMarkdownRaw(doc, pageFilter)
}

export function readBoardTable(
  doc: BoardDocument,
  pageFilter?: string,
  selectedIds: readonly string[] = [],
): BoardTableView | null {
  ensureWhiteboardEngineSync()
  return readBoardTableRaw(doc, pageFilter, selectedIds)
}

export function planBoardEdit(
  doc: BoardDocument,
  ops: readonly Record<string, unknown>[],
  options: { defaultPageId?: string; mode?: BatchMode } = {},
): EditPlanResult {
  ensureWhiteboardEngineSync()
  return planBoardEditRaw(doc, ops, options)
}

export function applyTemplate(
  doc: BoardDocument,
  template: Record<string, unknown>,
  activePageId?: string,
): { ok: true; result: TemplateApplyResult } | { ok: false; error: EditError } {
  ensureWhiteboardEngineSync()
  return applyTemplateRaw(doc, template, activePageId)
}

export function computePageBounds(doc: BoardDocument, pageId: string, margin = 48): Rect | null {
  ensureWhiteboardEngineSync()
  return computePageBoundsRaw(doc, pageId, margin)
}

export function computeStrokeOutline(
  points: ReadonlyArray<readonly [number, number, number]>,
  width: number,
  tool: 'pen' | 'highlighter' = 'pen',
): string {
  ensureWhiteboardEngineSync()
  return computeStrokeOutlineRaw(points, width, tool)
}

export function orderBetween(before?: string | null, after?: string | null): string {
  ensureWhiteboardEngineSync()
  return orderBetweenRaw(before, after)
}

export function sniffImage(bytes: Uint8Array): ImageHeader | null {
  ensureWhiteboardEngineSync()
  return sniffImageRaw(bytes)
}
