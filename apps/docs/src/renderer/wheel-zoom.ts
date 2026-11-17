import { clampZoom, wheelZoomStepPercent, type ZoomWheelIntent } from '@genoffice/ui'

export const DOCS_ZOOM_MIN = 10
export const DOCS_ZOOM_MAX = 500

export function clampDocsZoom(zoom: number): number {
  return clampZoom(zoom, DOCS_ZOOM_MIN, DOCS_ZOOM_MAX)
}

/** Word's Zoom In / Zoom Out buttons and shortcuts: ten whole points per press. */
export function stepDocsZoom(zoom: number, dir: 1 | -1): number {
  return clampDocsZoom(Math.round(zoom) + dir * 10)
}

/** A Ctrl+wheel step: five points, onto the 5% grid (a pinch too, in the same steps). */
export function nextDocsZoom(zoom: number, intent: Exclude<ZoomWheelIntent, null>): number {
  return wheelZoomStepPercent(zoom, intent === 'zoom-in' ? 1 : -1, DOCS_ZOOM_MIN, DOCS_ZOOM_MAX)
}

export type ZoomFitMode = 'width' | 'text' | 'page' | 'multi'
