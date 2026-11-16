import { clampZoom, notchStep, type ZoomWheelIntent } from '@genoffice/ui'

/**
 * Ctrl/Cmd+wheel zoom as a page scale (1 = 100%): a mouse-wheel notch steps
 * ten percentage points, while a trackpad pinch stays continuous.
 */
export function nextWheelScale(
  scale: number,
  intent: Exclude<ZoomWheelIntent, null>,
  deltaY: number,
  min: number,
  max: number,
): number {
  if (intent === 'pinch') return clampZoom(scale - deltaY * 0.006, min, max)
  return notchStep(scale, intent === 'zoom-in' ? 1 : -1, min, max)
}
