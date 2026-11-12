// Ctrl+wheel in Sheets: a mouse notch steps five percentage points through the
// worksheet zoom API whatever the OS scroll setting, a trackpad pinch moves in
// the same steps, Univer sees neither; nothing zooms while a cell is edited.
import { describe, expect, it } from 'vitest'
import { SHEET_ZOOM_MAX, SHEET_ZOOM_MIN, createWheelZoomStepper } from '../src/renderer/wheel-zoom'

function harness(zoom: number, editing = false) {
  const set: number[] = []
  let prevented = 0
  let stopped = 0
  const step = createWheelZoomStepper({
    getZoom: () => zoom,
    setZoom: (z) => {
      set.push(z)
      zoom = z
    },
    isCellEditing: () => editing,
  })
  const wheel = (deltaY: number, timeStamp: number, extra: Partial<WheelEvent> = {}) =>
    step({
      deltaY,
      deltaMode: 0,
      ctrlKey: true,
      metaKey: false,
      timeStamp,
      preventDefault: () => void prevented++,
      stopPropagation: () => void stopped++,
      ...extra,
    })
  return { set, wheel, prevented: () => prevented, stopped: () => stopped }
}

describe('createWheelZoomStepper', () => {
  it('50% plus one Windows notch is 55%, not the cap, at any lines-per-notch', () => {
    const h = harness(0.5)
    h.wheel(-100, 0)
    expect(h.set).toEqual([0.55])
    expect(h.stopped()).toBe(1)
    h.wheel(-100, 150)
    h.wheel(100, 300)
    expect(h.set).toEqual([0.55, 0.6, 0.55])
    const oneLine = harness(0.5)
    oneLine.wheel(-100 / 3, 0)
    oneLine.wheel(-100 / 3, 150)
    expect(oneLine.set).toEqual([0.55, 0.6])
  })

  it('clamps to the slider range and skips a no-op set', () => {
    expect(SHEET_ZOOM_MIN).toBe(0.1)
    const lo = harness(SHEET_ZOOM_MIN)
    lo.wheel(100, 0)
    expect(lo.set).toEqual([])
    const below = harness(0.5)
    below.wheel(100, 0)
    expect(below.set).toEqual([0.45])
    const hi = harness(3.98)
    hi.wheel(-100, 0)
    expect(hi.set).toEqual([SHEET_ZOOM_MAX])
  })

  it('steps a trackpad pinch in the same five points, kept from Univer', () => {
    const h = harness(1)
    h.wheel(-3.4, 0)
    h.wheel(-3.4, 16)
    h.wheel(-7.25, 32)
    expect(h.set).toEqual([1.05, 1.1])
    expect(h.prevented()).toBe(3)
    expect(h.stopped()).toBe(3)
  })

  it('steps once per event of a Cmd+two-finger stream, however large', () => {
    const h = harness(1)
    const cmd = { ctrlKey: false, metaKey: true }
    h.wheel(-4, 0, cmd)
    h.wheel(-4, 16, cmd)
    h.wheel(-120, 32, cmd)
    expect(h.set).toEqual([1.05, 1.1])
    expect(h.stopped()).toBe(3)
  })

  it('ignores plain scrolling and wheel events during cell editing', () => {
    const plain = harness(1)
    plain.wheel(-100, 0, { ctrlKey: false })
    expect(plain.set).toEqual([])
    expect(plain.prevented()).toBe(0)
    const editing = harness(1, true)
    editing.wheel(-100, 0)
    expect(editing.set).toEqual([])
    expect(editing.prevented()).toBe(0)
  })
})
