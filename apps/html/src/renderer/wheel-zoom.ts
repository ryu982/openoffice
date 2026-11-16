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

/** What the zoom classifier reads off a wheel event. */
export type ZoomWheel = Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey' | 'metaKey'>

/**
 * The wheel behind a gx:zoom relay, in the shape the zoom classifier reads.
 * Any script in the previewed page can post that message, so every field is
 * checked and a relay without a usable delta is dropped (null).
 */
export function frameWheelOf(msg: {
  delta?: unknown
  mode?: unknown
  ctrl?: unknown
  meta?: unknown
}): ZoomWheel | null {
  if (typeof msg.delta !== 'number' || !Number.isFinite(msg.delta) || msg.delta === 0) return null
  const metaKey = msg.meta === true
  return {
    deltaY: msg.delta,
    deltaMode: msg.mode === 1 || msg.mode === 2 ? msg.mode : 0,
    // the frame relays only ctrl/meta wheels: one without meta was ctrl, as a pinch always is
    ctrlKey: msg.ctrl === true || !metaKey,
    metaKey,
  }
}
