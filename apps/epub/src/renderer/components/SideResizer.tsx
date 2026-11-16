/**
 * The handle on the inner edge of the left pane (contents or find): dragging
 * it, or the arrow keys on it, set the pane's width. Both panes share the one
 * width, kept for the next time in this view's local storage. A double click
 * brings the default width back.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

const SIDE_WIDTH_KEY = 'epub-side-width'
export const SIDE_WIDTH_DEFAULT = 260
export const SIDE_WIDTH_MIN = 180
const SIDE_WIDTH_MAX = 640
const KEY_STEP = 16

/** The width that fits the window now: at most half of it, never under the minimum. */
export function clampSideWidth(w: number, windowWidth: number): number {
  // the window can be tiny for a moment (a view is 0×0 until the shell lays it out)
  const max = Math.max(SIDE_WIDTH_MIN, Math.min(SIDE_WIDTH_MAX, Math.round(windowWidth * 0.5)))
  return Math.round(Math.min(Math.max(w, SIDE_WIDTH_MIN), max))
}

function loadSideWidth(): number {
  try {
    const saved = Number(localStorage.getItem(SIDE_WIDTH_KEY))
    if (Number.isFinite(saved) && saved > 0) {
      return Math.min(Math.max(saved, SIDE_WIDTH_MIN), SIDE_WIDTH_MAX)
    }
  } catch {
    // no storage: the default
  }
  return SIDE_WIDTH_DEFAULT
}

function storeSideWidth(w: number): void {
  try {
    localStorage.setItem(SIDE_WIDTH_KEY, String(Math.round(w)))
  } catch {
    // the width is only a convenience
  }
}

/** The pane width: the one the user chose, fitted to the window. */
export function useSideWidth(): {
  width: number
  resizing: boolean
  /** set the width; it is kept unless `keep` is false (a drag keeps it once, at the end) */
  choose(w: number, keep?: boolean): void
  setResizing(on: boolean): void
} {
  // preferred = the width the user chose (the one value kept); width = what fits the window now
  const preferredRef = useRef(loadSideWidth())
  const [width, setWidth] = useState(() => clampSideWidth(preferredRef.current, window.innerWidth))
  const [resizing, setResizing] = useState(false)
  useEffect(() => {
    const onResize = (): void => setWidth(clampSideWidth(preferredRef.current, window.innerWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const choose = useCallback((w: number, keep = true) => {
    const fitted = clampSideWidth(w, window.innerWidth)
    preferredRef.current = fitted
    setWidth(fitted)
    if (keep) storeSideWidth(fitted)
  }, [])
  return { width, resizing, choose, setResizing }
}

export function SideResizer(p: {
  width: number
  label: string
  choose(w: number, keep?: boolean): void
  setResizing(on: boolean): void
}) {
  const { choose, setResizing } = p
  const cleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanupRef.current?.(), [])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    const pane = handle.previousElementSibling as HTMLElement | null
    const rect = (pane ?? handle).getBoundingClientRect()
    // the pane is on the left, or on the right in a right-to-left view
    const rtl = getComputedStyle(handle).direction === 'rtl'
    setResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    let last: number | null = null
    const onMove = (ev: PointerEvent): void => {
      last = rtl ? rect.right - ev.clientX : ev.clientX - rect.left
      choose(last, false)
    }
    let done = false
    const cleanup = (): void => {
      if (done) return
      done = true
      cleanupRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      handle.removeEventListener('lostpointercapture', cleanup)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setResizing(false)
      if (last !== null) choose(last)
    }
    cleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
    handle.addEventListener('lostpointercapture', cleanup)
    handle.setPointerCapture?.(e.pointerId)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
    let next: number | null = null
    if (e.key === 'ArrowLeft') next = p.width + (rtl ? KEY_STEP : -KEY_STEP)
    else if (e.key === 'ArrowRight') next = p.width + (rtl ? -KEY_STEP : KEY_STEP)
    else if (e.key === 'Home') next = SIDE_WIDTH_MIN
    else if (e.key === 'End') next = Number.MAX_SAFE_INTEGER
    if (next === null) return
    e.preventDefault()
    choose(next)
  }

  return (
    <div
      className="epub-side-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={p.label}
      aria-valuenow={p.width}
      aria-valuemin={SIDE_WIDTH_MIN}
      tabIndex={0}
      title={p.label}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => choose(SIDE_WIDTH_DEFAULT)}
    />
  )
}
