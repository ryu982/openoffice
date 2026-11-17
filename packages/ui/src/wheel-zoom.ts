// Wheel-stream intent for paging (Slides) and Ctrl/⌘+wheel zoom (every editor
// with a view zoom; the HWP editor's build patch imports this file too).
//
// The hard part is telling one user intent apart from a stream of WheelEvents:
//  - a mouse wheel emits one large delta per notch, with real time between
//    notches → flip per notch;
//  - a trackpad swipe is a continuous ~8-16ms stream: it ramps up from small
//    deltas (or opens notch-sized when flicked hard / frame-coalesced) and then
//    coasts on a decaying momentum tail that itself contains notch-sized
//    deltas → the whole gesture must produce exactly one flip.
// Chromium exposes no momentum phase, so intent is reconstructed from the
// stream itself, with three independent signals:
//  - gesture density: wheel gestures are sparse (nearly every event arrives
//    ≥ DISCRETE_MS after the previous one), trackpad gestures are dense. A
//    notch-sized delta flips per-notch only while its gesture stays sparse —
//    one rapid interloper is tolerated (wheel jitter), a second reclassifies
//    the gesture as touch and swallows the rest;
//  - a quiet gap or a sign change starts a new gesture;
//  - once a gesture has flipped and is being swallowed, only a *rising per-ms
//    velocity* (a fresh touch — real momentum only ever decays) gets events
//    considered again. Spacing alone can't reopen it: the flip itself
//    re-renders the slide, and that jank coalesces the very next momentum
//    frames into notch-sized deltas spaced past DISCRETE_MS. Velocity is
//    immune to coalescing (delta and interval grow together).

/** A single event at/above this is a notch; smaller deltas accumulate toward
 * it before the first flip of a trackpad gesture. */
export const NOTCH = 60
/** Silence longer than this ends the current gesture (momentum events arrive
 * well under this apart, deliberate consecutive swipes well over it). */
const GAP_MS = 200
/** Events closer together than this are a continuous (touch) stream; events
 * at/above it are discrete (wheel-like). */
const DISCRETE_MS = 40
/** Right after a flip the very swipe that flipped is often still accelerating,
 * which would pass the rising-velocity test below — ignore that window. */
const REFRACTORY_MS = 200
/** Velocity growth factor that counts as a fresh touch during the tail. */
const RISE = 1.5

type Flip = -1 | 0 | 1

export function createWheelPager(): { feed: (deltaY: number, now: number) => Flip } {
  /** accum: pre-flip, summing toward the first flip of a trackpad gesture
   *  notch: flipped on a discrete notch — more discrete notches keep flipping
   *  swallow: post-flip, eating the same gesture's remaining stream */
  let mode: 'accum' | 'notch' | 'swallow' = 'accum'
  let acc = 0
  let lastTime = -Infinity
  let lastSign = 0
  /** rapid (< DISCRETE_MS) events seen since the last reset/notch flip — the
   * gesture-density signal; 0..1 = sparse enough to still be a wheel */
  let rapidSeen = 0
  // rolling last-two velocities: comparing against their max keeps a single
  // stretched inter-event gap (timing jitter) from reading as a fresh touch
  let vel1 = 0
  let vel2 = 0
  let flipTime = -Infinity

  const feed = (deltaY: number, now: number): Flip => {
    if (deltaY === 0) return 0
    const sign = deltaY > 0 ? 1 : -1
    const dt = now - lastTime
    const vel = Math.abs(deltaY) / Math.max(dt, 1)
    if (dt > GAP_MS || sign !== lastSign) {
      mode = 'accum'
      acc = 0
      rapidSeen = 0
    }
    lastTime = now
    lastSign = sign

    if (
      mode === 'swallow' &&
      now - flipTime > REFRACTORY_MS &&
      Math.max(vel1, vel2) > 0 &&
      vel >= Math.max(vel1, vel2) * RISE
    ) {
      mode = 'accum'
      acc = 0
      rapidSeen = 0
    }
    vel2 = vel1
    vel1 = vel
    if (mode === 'swallow') return 0

    const rapid = dt < DISCRETE_MS
    if (!rapid && Math.abs(deltaY) >= NOTCH && rapidSeen <= 1) {
      // discrete notch in a sparse gesture: flip per notch, and the notch
      // re-asserts wheelness (forgives the tolerated jitter event)
      mode = 'notch'
      acc = 0
      rapidSeen = 0
      flipTime = now
      return sign
    }
    if (mode === 'notch') {
      if (rapid && ++rapidSeen >= 2) {
        // a continuous stream trailing a "notch" means it was a hard flick's
        // opening frame, not a wheel — swallow the rest of the gesture
        mode = 'swallow'
      }
      // isolated jitter or a small slow remnant: eat it, keep paging per notch
      return 0
    }
    if (rapid) rapidSeen++
    acc += deltaY
    if (Math.abs(acc) >= NOTCH) {
      mode = 'swallow'
      acc = 0
      flipTime = now
      return sign
    }
    return 0
  }

  return { feed }
}

export type ZoomWheelIntent = 'zoom-in' | 'zoom-out' | null

/** Percentage points one Ctrl/⌘+wheel step moves the view zoom, in every editor. */
export const WHEEL_ZOOM_STEP = 5
/** In a continuous stream (trackpad pinch or two-finger scroll, a fast spin),
 * the delta that adds up to one step. Chromium sends a pinch as
 * -100·ln(scale) per frame, so this is about a tenth of finger spread per step. */
const STREAM_STEP_PX = 10

/**
 * Ctrl/⌘+wheel intent for the zoom handlers. Each event moves the zoom at most
 * one step, and how far the OS says the wheel went never matters: Windows
 * scales a notch's pixel delta by the "lines per notch" setting (33px at one
 * line, 100px at three, a whole page at "one screen"), macOS by its scroll
 * speed, and Chromium hands a trackpad pinch over as ctrlKey wheel events.
 *  - line/page deltas are one notch each;
 *  - a sparse event (≥ DISCRETE_MS after the last, outside a running stream)
 *    is a notch: one step, whatever its size;
 *  - a dense stream (pinch, two-finger scroll, a fast spin) adds its signed
 *    deltas up and steps each time they reach STREAM_STEP_PX, then starts over,
 *    so a large coalesced frame is still one step. A frame delayed past
 *    DISCRETE_MS by the re-render of the last step stays part of the stream.
 */
export function createZoomWheelClassifier(): {
  feed: (ev: Pick<WheelEvent, 'deltaY' | 'deltaMode'>, now: number) => ZoomWheelIntent
} {
  let lastTime = -Infinity
  let streaming = false
  let acc = 0
  const intent = (delta: number): ZoomWheelIntent => (delta > 0 ? 'zoom-out' : 'zoom-in')
  const feed = (ev: Pick<WheelEvent, 'deltaY' | 'deltaMode'>, now: number): ZoomWheelIntent => {
    if (!ev.deltaY) return null
    const dt = now - lastTime
    lastTime = now
    if (ev.deltaMode !== 0) {
      streaming = false
      acc = 0
      return intent(ev.deltaY)
    }
    if (dt >= DISCRETE_MS && !(streaming && dt <= GAP_MS)) {
      streaming = false
      acc = 0
      return intent(ev.deltaY)
    }
    if (!streaming) {
      // the notch that opened this stream already stepped: count from zero
      streaming = true
      acc = 0
    }
    acc += ev.deltaY
    if (Math.abs(acc) < STREAM_STEP_PX) return null
    const step = intent(acc)
    acc = 0
    return step
  }
  return { feed }
}

export function clampZoom(z: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, z))
}

/**
 * One Ctrl/⌘+wheel step on a percent zoom: to the next multiple of
 * WHEEL_ZOOM_STEP in that direction, so a fit-landed 87% goes to 90% or 85%
 * and every value the wheel leaves is on the 5% grid.
 */
export function wheelZoomStepPercent(pct: number, dir: 1 | -1, min: number, max: number): number {
  // hundredths first: 0.85 * 100 is 85.00000000000001, which must not count as past 85
  const p = Math.round(pct * 100) / 100
  const next =
    dir > 0
      ? Math.floor(p / WHEEL_ZOOM_STEP) * WHEEL_ZOOM_STEP + WHEEL_ZOOM_STEP
      : Math.ceil(p / WHEEL_ZOOM_STEP) * WHEEL_ZOOM_STEP - WHEEL_ZOOM_STEP
  return clampZoom(next, min, max)
}

/** wheelZoomStepPercent on a ratio zoom (1 = 100%); clamped as a ratio, since 0.1 * 100 is not 10. */
export function wheelZoomStep(z: number, dir: 1 | -1, min: number, max: number): number {
  return clampZoom(wheelZoomStepPercent(z * 100, dir, -Infinity, Infinity) / 100, min, max)
}

/** One status-bar button click: whole percents so repeated steps never drift. */
export function notchStep(z: number, dir: 1 | -1, min: number, max: number): number {
  return clampZoom(Math.round(z * 100 + dir * 10) / 100, min, max)
}
