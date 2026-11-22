/**
 * Browser-safe TypeScript entry point for `@genoffice/whiteboard-engine`.
 * Uses only standard Web APIs and Uint8Array so Vite / Electron renderers
 * can bundle and run the Rust WASM engine directly.
 */
import init, {
  initSync,
  WasmArchive,
  wasm_apply_template,
  wasm_board_to_markdown,
  wasm_check_excalidraw,
  wasm_check_whiteboard,
  wasm_compute_page_bounds,
  wasm_compute_stroke_outline,
  wasm_create_new_board,
  wasm_extract_markdown,
  wasm_extract_thumbnail,
  wasm_import_excalidraw,
  wasm_order_between,
  wasm_plan_board_edit,
  wasm_read_board_table,
  wasm_sniff_image,
  wasm_validate_board,
} from '../pkg/whiteboard_engine.js'
import type { InitInput, InitOutput, SyncInitInput } from '../pkg/whiteboard_engine.js'
import {
  WhiteboardOpenError,
  type BatchMode,
  type BoardDocument,
  type BoardTableView,
  type CheckExcalidrawResult,
  type CheckWhiteboardResult,
  type EditError,
  type EditPlanResult,
  type ExcalidrawImportSummary,
  type ExtractMarkdownResult,
  type ImageHeader,
  type OpenError,
  type Rect,
  type ResourceMeta,
  type TemplateApplyResult,
} from './types'

export * from './types'
export type { InitInput, InitOutput, SyncInitInput }

let initialized = false

/** Initializes the Whiteboard WASM engine asynchronously (browser / Vite / Electron renderer). */
export async function initWhiteboardEngine(
  moduleOrPath?: InitInput | Promise<InitInput>,
): Promise<InitOutput> {
  const output =
    moduleOrPath === undefined ? await init() : await init({ module_or_path: moduleOrPath })
  initialized = true
  return output
}

/** Initializes the Whiteboard WASM engine synchronously from raw WASM bytes or a compiled module. */
export function initWhiteboardEngineSync(module: SyncInitInput): InitOutput {
  const output = initSync({ module })
  initialized = true
  return output
}

export function isWhiteboardEngineReady(): boolean {
  return initialized
}

function parseOpenError(thrown: unknown): WhiteboardOpenError {
  if (thrown instanceof WhiteboardOpenError) return thrown
  const text =
    typeof thrown === 'string' ? thrown : thrown instanceof Error ? thrown.message : String(thrown)
  try {
    const parsed = JSON.parse(text) as Partial<OpenError>
    if (parsed && typeof parsed.code === 'string' && typeof parsed.message === 'string') {
      return new WhiteboardOpenError(parsed as OpenError)
    }
  } catch {
    // Fall through to generic schema error.
  }
  return new WhiteboardOpenError({ code: 'invalid_schema', message: text })
}

/** Stateful wrapper over a Rust `WhiteboardArchive` with byte-identical no-op save & preservation. */
export class WhiteboardArchiveHandle {
  private inner: WasmArchive | null

  constructor(inner: WasmArchive) {
    this.inner = inner
  }

  private raw(): WasmArchive {
    if (!this.inner) {
      throw new Error('WhiteboardArchiveHandle has already been disposed')
    }
    return this.inner
  }

  getDocument(): BoardDocument {
    return JSON.parse(this.raw().get_doc_json()) as BoardDocument
  }

  setDocument(doc: BoardDocument): void {
    try {
      this.raw().set_doc_json(JSON.stringify(doc))
    } catch (err) {
      throw parseOpenError(err)
    }
  }

  getResource(resourceId: string): Uint8Array | null {
    return this.raw().get_resource(resourceId) ?? null
  }

  addImageResource(resourceId: string, bytes: Uint8Array): ResourceMeta {
    try {
      return JSON.parse(this.raw().add_image_resource(resourceId, bytes)) as ResourceMeta
    } catch (err) {
      throw parseOpenError(err)
    }
  }

  getThumbnail(): Uint8Array | null {
    return this.raw().get_thumbnail() ?? null
  }

  setThumbnail(pngBytes: Uint8Array | null): void {
    try {
      this.raw().set_thumbnail(pngBytes ?? undefined)
    } catch (err) {
      throw parseOpenError(err)
    }
  }

  isChanged(): boolean {
    return this.raw().is_changed()
  }

  save(): Uint8Array {
    try {
      return this.raw().save()
    } catch (err) {
      throw parseOpenError(err)
    }
  }

  dispose(): void {
    if (this.inner) {
      this.inner.free()
      this.inner = null
    }
  }
}

export function createNewBoard(id: string, pageId: string, title = ''): BoardDocument {
  return JSON.parse(wasm_create_new_board(id, pageId, title)) as BoardDocument
}

export function createNewArchive(doc: BoardDocument): WhiteboardArchiveHandle {
  try {
    return new WhiteboardArchiveHandle(new WasmArchive(JSON.stringify(doc)))
  } catch (err) {
    throw parseOpenError(err)
  }
}

export function openWhiteboardArchive(bytes: Uint8Array): WhiteboardArchiveHandle {
  try {
    return new WhiteboardArchiveHandle(WasmArchive.open(bytes))
  } catch (err) {
    throw parseOpenError(err)
  }
}

export function validateBoard(doc: BoardDocument): { ok: true } | { ok: false; error: OpenError } {
  return JSON.parse(wasm_validate_board(JSON.stringify(doc))) as
    { ok: true } | { ok: false; error: OpenError }
}

export function checkWhiteboard(bytes: Uint8Array): CheckWhiteboardResult {
  return JSON.parse(wasm_check_whiteboard(bytes)) as CheckWhiteboardResult
}

export function checkExcalidraw(bytes: Uint8Array, filenameHint?: string): CheckExcalidrawResult {
  return JSON.parse(wasm_check_excalidraw(bytes, filenameHint)) as CheckExcalidrawResult
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
  let rawImport
  try {
    rawImport = wasm_import_excalidraw(
      bytes,
      options.filenameHint,
      options.boardId,
      options.pageId,
      options.title ?? '',
    )
  } catch (err) {
    throw parseOpenError(err)
  }
  try {
    const summary = JSON.parse(rawImport.summary_json()) as ExcalidrawImportSummary
    const rawArchive = rawImport.take_archive()
    if (!rawArchive) {
      throw new WhiteboardOpenError({
        code: 'invalid_excalidraw',
        message: 'failed to retrieve imported whiteboard archive',
      })
    }
    return { archive: new WhiteboardArchiveHandle(rawArchive), summary }
  } finally {
    rawImport.free()
  }
}

export function extractMarkdown(bytes: Uint8Array, pageFilter?: string): ExtractMarkdownResult {
  return JSON.parse(wasm_extract_markdown(bytes, pageFilter)) as ExtractMarkdownResult
}

export function extractThumbnail(bytes: Uint8Array): Uint8Array | null {
  return wasm_extract_thumbnail(bytes) ?? null
}

export function boardToMarkdown(doc: BoardDocument, pageFilter?: string): string | null {
  return wasm_board_to_markdown(JSON.stringify(doc), pageFilter) ?? null
}

export function readBoardTable(
  doc: BoardDocument,
  pageFilter?: string,
  selectedIds: readonly string[] = [],
): BoardTableView | null {
  const json = wasm_read_board_table(JSON.stringify(doc), pageFilter, JSON.stringify(selectedIds))
  return json === undefined ? null : (JSON.parse(json) as BoardTableView)
}

export function planBoardEdit(
  doc: BoardDocument,
  ops: readonly Record<string, unknown>[],
  options: { defaultPageId?: string; mode?: BatchMode } = {},
): EditPlanResult {
  const mode = options.mode ?? 'all_or_nothing'
  return JSON.parse(
    wasm_plan_board_edit(JSON.stringify(doc), JSON.stringify(ops), options.defaultPageId, mode),
  ) as EditPlanResult
}

export function applyTemplate(
  doc: BoardDocument,
  template: Record<string, unknown>,
  activePageId?: string,
): { ok: true; result: TemplateApplyResult } | { ok: false; error: EditError } {
  return JSON.parse(
    wasm_apply_template(JSON.stringify(doc), JSON.stringify(template), activePageId),
  ) as { ok: true; result: TemplateApplyResult } | { ok: false; error: EditError }
}

export function computePageBounds(doc: BoardDocument, pageId: string, margin = 48): Rect | null {
  const json = wasm_compute_page_bounds(JSON.stringify(doc), pageId, margin)
  return json === undefined ? null : (JSON.parse(json) as Rect)
}

export function computeStrokeOutline(
  points: ReadonlyArray<readonly [number, number, number]>,
  width: number,
  tool: 'pen' | 'highlighter' = 'pen',
): string {
  return wasm_compute_stroke_outline(JSON.stringify(points), width, tool)
}

export function orderBetween(before?: string | null, after?: string | null): string {
  return wasm_order_between(before ?? undefined, after ?? undefined)
}

export function sniffImage(bytes: Uint8Array): ImageHeader | null {
  const json = wasm_sniff_image(bytes)
  return json === undefined ? null : (JSON.parse(json) as ImageHeader)
}
