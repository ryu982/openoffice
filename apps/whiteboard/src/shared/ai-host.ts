/**
 * Shared contract between the whiteboard canvas renderer (T6) and AI panel (T7).
 * Allows AI tools to inspect pages, capture a light-theme PNG snapshot for
 * vision-capable models, apply atomic edit batches or declarative templates as
 * one undo step, insert embedded images, undo AI turns, and toggle non-destructive
 * highlight overlays.
 */
import type {
  BoardTableView,
  EditError,
  EditPlanResult,
  TemplateApplyResult,
} from '@genoffice/whiteboard-engine'

export interface CapturedPagePng {
  base64: string
  mime: 'image/png'
  width: number
  height: number
}

export interface InsertImageInput {
  bytes: Uint8Array
  alt?: string
  x?: number
  y?: number
  width?: number
  height?: number
}

export type InsertImageResult =
  { ok: true; objectId: string; resourceId: string } | { ok: false; error: string }

export interface WhiteboardAiHost {
  /** Reads the full board structured table (every page) with selection flags. */
  readBoard(): Promise<BoardTableView>
  /** Reads one page by id, title, or 1-based index; defaults to the active page. */
  readPage(pageRef?: string): Promise<BoardTableView | null>
  /** Renders the active page in invariant light document colors as a PNG snapshot (<= maxEdge px). */
  captureCurrentPagePng(maxEdge?: number): Promise<CapturedPagePng | null>
  /** Validates and applies a batch of ops all-or-nothing as a single undo step. */
  applyOps(
    ops: readonly Record<string, unknown>[],
    options?: { defaultPageId?: string },
  ): Promise<EditPlanResult>
  /** Validates and applies a declarative JSON template as a single undo step. */
  applyTemplate(
    template: Record<string, unknown>,
  ): Promise<{ ok: true; result: TemplateApplyResult } | { ok: false; error: EditError }>
  /** Validates raster bytes, embeds them into `.whiteboard` resources, and inserts an image object as 1 undo step. */
  insertImage(input: InsertImageInput): Promise<InsertImageResult>
  /** Undoes the last `count` AI undo steps if no user edit intervened; returns false if user edited since. */
  undoBatches(count: number): Promise<boolean>
  /** Shows or clears non-destructive highlight overlays on the given object IDs. */
  setHighlights(objectIds: readonly string[]): void
  /** Currently selected object IDs on the active page. */
  getSelection(): string[]
  /** Subscribes to any document or active-page change; returns unsubscribe. */
  onDocumentChange(listener: () => void): () => void
  /** Current document file path on disk, or null if untitled. */
  getFilePath(): string | null
  /** Monotonic revision counter bumped on every document edit (used to guard AI turn undo). */
  getRevision(): number
}
