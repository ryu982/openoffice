import { createZoomWheelClassifier, wheelZoomStep } from '@genoffice/ui'

import { SHEET_ZOOM_MAX as MAX_PERCENT, SHEET_ZOOM_MIN as MIN_PERCENT } from './zoom-range'

/// Same range as the status-bar slider and +/- buttons, as a ratio.
export const SHEET_ZOOM_MIN = MIN_PERCENT / 100
export const SHEET_ZOOM_MAX = MAX_PERCENT / 100

export interface WheelZoomTarget {
  readonly getZoom: () => number | undefined
  readonly setZoom: (zoom: number) => void
  readonly isCellEditing: () => boolean
}

type WheelLike = Pick<
  WheelEvent,
  | 'deltaY'
  | 'deltaMode'
  | 'ctrlKey'
  | 'metaKey'
  | 'timeStamp'
  | 'preventDefault'
  | 'stopPropagation'
>

/// Runs ahead of Univer's own Ctrl+wheel zoom (which scales by pixel delta, so
/// the step would follow the OS scroll setting): every Ctrl/⌘+wheel event is
/// stopped before Univer sees it, and a notch, or a trackpad pinch's travel,
/// steps five points onto the 5% grid.
export function createWheelZoomStepper(target: WheelZoomTarget): (event: WheelLike) => void {
  const classifier = createZoomWheelClassifier()
  return (event) => {
    if (!event.ctrlKey && !event.metaKey) return
    if (target.isCellEditing()) return
    const intent = classifier.feed(event, event.timeStamp)
    event.preventDefault()
    event.stopPropagation()
    if (!intent) return
    const zoom = target.getZoom()
    if (zoom === undefined) return
    const next = wheelZoomStep(zoom, intent === 'zoom-in' ? 1 : -1, SHEET_ZOOM_MIN, SHEET_ZOOM_MAX)
    if (next !== zoom) target.setZoom(next)
  }
}

export function installWheelZoomSteps(host: HTMLElement, target: WheelZoomTarget): () => void {
  const step = createWheelZoomStepper(target)
  const onWheel = (event: WheelEvent) => {
    if ((event.target as HTMLElement | null)?.closest?.('.chart-editor')) return
    step(event)
  }
  host.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => host.removeEventListener('wheel', onWheel, { capture: true })
}
