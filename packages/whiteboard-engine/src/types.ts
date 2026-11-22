/**
 * Shared TypeScript types for `.whiteboard` documents, errors, edit planning,
 * declarative templates, outlines, and Excalidraw imports.
 */

export type OpenErrorCode =
  | 'not_zip'
  | 'zip_rejected'
  | 'missing_board_json'
  | 'invalid_utf8'
  | 'invalid_json'
  | 'unsupported_schema_version'
  | 'invalid_schema'
  | 'no_excalidraw_scene'
  | 'invalid_excalidraw'

export interface OpenError {
  code: OpenErrorCode
  message: string
}

export type EditErrorCode =
  | 'unknown_op'
  | 'target_not_found'
  | 'page_not_found'
  | 'last_page_delete'
  | 'invalid_argument'
  | 'resource_not_found'
  | 'invalid_template'

export interface EditError {
  code: EditErrorCode
  message: string
  path?: string
}

export type PageFormat = 'freeform' | 'wide_16_9' | 'a4_portrait' | 'a4_landscape' | 'custom'

export type PageBackground =
  | { kind: 'solid'; color: string }
  | { kind: 'grid'; color: string; pattern: 'dot' | 'line' }
  | { kind: 'image'; resourceId: string; width: number; height: number }

export type ObjectKind =
  'sticky' | 'text' | 'shape' | 'connector' | 'stroke' | 'image' | 'table' | 'sticker' | 'link'

export type ShapeKind =
  | 'rectangle'
  | 'rounded_rectangle'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'star'
  | 'speech_bubble'
  | 'block_arrow'

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

export type TextAlign = 'left' | 'center' | 'right'
export type LineStyle = 'solid' | 'dashed' | 'dotted'
export type ConnectorRouting = 'straight' | 'elbow' | 'curved'
export type ConnectorHead = 'none' | 'arrow' | 'triangle' | 'circle'
export type StrokeTool = 'pen' | 'highlighter'

export interface TextRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  code?: boolean
}

export interface TextParagraph {
  align?: TextAlign
  runs: TextRun[]
}

export interface RichText {
  paragraphs: TextParagraph[]
}

export interface Point {
  x: number
  y: number
}

export type ConnectorEnd =
  { objectId: string; anchorX?: number; anchorY?: number } | { x: number; y: number }

export interface StickyProps {
  color: string
  text: RichText
  fontSize?: number
  align?: TextAlign
}

export interface TextProps {
  text: RichText
  fontSize?: number
  color?: string
  align?: TextAlign
  background?: string
  borderColor?: string
}

export interface ShapeProps {
  shape: ShapeKind
  fill: string
  stroke: string
  strokeWidth: number
  lineStyle?: LineStyle
  text: RichText
  fontSize?: number
  align?: TextAlign
}

export interface ConnectorProps {
  start: ConnectorEnd
  end: ConnectorEnd
  routing: ConnectorRouting
  startHead: ConnectorHead
  endHead: ConnectorHead
  color: string
  strokeWidth: number
  lineStyle: LineStyle
  label?: RichText
  waypoints?: Point[]
}

export interface StrokeProps {
  tool: StrokeTool
  color: string
  width: number
  opacity: number
  points: Array<[number, number, number]>
}

export interface ImageProps {
  resourceId: string
  alt?: string
}

export interface TableProps {
  rowIds: string[]
  colIds: string[]
  colWidths?: number[]
  headerRow: boolean
  cells: Record<string, RichText>
  fontSize?: number
}

export interface StickerProps {
  stickerId: string
  tint?: string
}

export interface LinkProps {
  url: string
  title: string
  description?: string
  previewResourceId?: string
}

export interface ResourceMeta {
  path: string
  mime: ImageMime
  width: number
  height: number
  byteLength: number
}

export interface ImageHeader {
  mime: ImageMime
  width: number
  height: number
}

export interface Page {
  id: string
  title: string
  orderKey: string
  format: PageFormat
  width: number
  height: number
  background: PageBackground
  [extra: string]: unknown
}

export interface BoardObject {
  id: string
  pageId: string
  kind: ObjectKind
  orderKey: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  groupId?: string
  props: Record<string, unknown>
  [extra: string]: unknown
}

export interface BoardDocument {
  schemaVersion: number
  id: string
  title: string
  pages: Page[]
  objects: BoardObject[]
  resources: Record<string, ResourceMeta>
  [extra: string]: unknown
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type BatchMode = 'all_or_nothing' | 'best_effort' | 'stop_on_error'

export interface OpResult {
  index: number
  op: string
  status: 'ok' | 'error'
  created?: string
  target?: string
  error?: EditError
}

export interface EditPlanResult {
  ok: boolean
  changed: boolean
  doc: BoardDocument
  results: OpResult[]
  created: string[]
  updated: string[]
  deleted: string[]
  batch: BatchMode
  failures?: OpResult[]
}

export interface TemplateApplyResult {
  doc: BoardDocument
  createdPageIds: string[]
  createdObjectIds: string[]
}

export interface ObjectSummary {
  id: string
  kind: ObjectKind
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  groupId?: string
  text?: string
  shape?: string
  url?: string
  from?: string
  to?: string
  selected?: boolean
}

export interface PageTableView {
  id: string
  title: string
  format: PageFormat
  width: number
  height: number
  objectCount: number
  objects: ObjectSummary[]
}

export interface BoardTableView {
  id: string
  title: string
  pages: PageTableView[]
  text: string
}

export interface ExcalidrawImportSummary {
  importedCount: number
  skippedCount: number
  skippedByKind: Record<string, number>
}

export type CheckWhiteboardResult =
  | { ok: true; title: string; pageCount: number; objectCount: number }
  | { ok: false; error: OpenError }

export type CheckExcalidrawResult =
  { ok: true; summary: ExcalidrawImportSummary } | { ok: false; error: OpenError }

export type ExtractMarkdownResult =
  | { ok: true; markdown: string; title: string; pageCount: number }
  | { ok: false; error: OpenError | EditError }

export class WhiteboardOpenError extends Error {
  readonly code: OpenErrorCode

  constructor(err: OpenError) {
    super(err.message)
    this.name = 'WhiteboardOpenError'
    this.code = err.code
  }
}
