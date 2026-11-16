// Renderer-safe entry: option model and sheet planning. No Node, Electron or PDF
// library imports here or in anything this file pulls in (a test walks the graph).
export { PrintLayoutError, type PrintLayoutErrorCode, type PrintLayoutIssue } from './errors'
export { mmToPt, PT_PER_MM, type LineSegment, type PageSize, type Rect } from './geometry'
export { isPaperName, PAPER_NAMES, PAPER_SIZES_MM, paperSizePt, type PaperName } from './paper'
export * from './labels'
export * from './options'
export * from './sheet-plan'
