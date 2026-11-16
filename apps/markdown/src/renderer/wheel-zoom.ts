import { clampZoom, notchStep, type ZoomWheelIntent } from '@genoffice/ui'

/**
 * Ctrl/Cmd+wheel zoom in percent: a mouse-wheel notch steps ten points, the
 * same as the +/- buttons, while a trackpad pinch stays continuous.
 */
export function nextWheelZoom(
  zoom: number,
  intent: Exclude<ZoomWheelIntent, null>,
  deltaY: number,
  min: number,
  max: number,
): number {
  if (intent === 'pinch') return clampZoom(zoom - deltaY * 0.6, min, max)
  const dir = intent === 'zoom-in' ? 1 : -1
  return Math.round(notchStep(zoom / 100, dir, min / 100, max / 100) * 100)
}
