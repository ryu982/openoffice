// Ctrl+wheel in the HTML editor: a mouse-wheel notch moves ten percentage
// points (one Windows notch used to jump sixty), a trackpad pinch stays
// continuous, and a wheel inside the preview frame reads the same once relayed.
import { describe, expect, it } from 'vitest'
import { createZoomWheelClassifier } from '@genoffice/ui'
import { frameWheelOf, nextWheelZoom } from '../src/renderer/wheel-zoom'

const MIN = 50
const MAX = 200

describe('nextWheelZoom', () => {
  it('steps ten points per notch', () => {
    expect(nextWheelZoom(100, 'zoom-in', -100, MIN, MAX)).toBe(110)
    expect(nextWheelZoom(100, 'zoom-out', 100, MIN, MAX)).toBe(90)
    expect(nextWheelZoom(110, 'zoom-in', -300, MIN, MAX)).toBe(120)
  })

  it('snaps a pinch-landed fraction to whole percents and stops at the range ends', () => {
    expect(nextWheelZoom(104.6, 'zoom-in', -100, MIN, MAX)).toBe(115)
    expect(nextWheelZoom(195, 'zoom-in', -100, MIN, MAX)).toBe(MAX)
    expect(nextWheelZoom(55, 'zoom-out', 100, MIN, MAX)).toBe(MIN)
    expect(nextWheelZoom(MIN, 'zoom-out', 100, MIN, MAX)).toBe(MIN)
  })

  it('keeps a pinch continuous with the delta-scaled factor', () => {
    expect(nextWheelZoom(100, 'pinch', -3.4, MIN, MAX)).toBeCloseTo(102.04, 10)
    expect(nextWheelZoom(100, 'pinch', 7.25, MIN, MAX)).toBeCloseTo(95.65, 10)
    expect(nextWheelZoom(199, 'pinch', -50, MIN, MAX)).toBe(MAX)
  })
})

describe('frameWheelOf', () => {
  it('reads a relayed ctrl+wheel notch as the classifier expects it', () => {
    expect(frameWheelOf({ delta: -100, mode: 0, ctrl: true, meta: false })).toEqual({
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: true,
      metaKey: false,
    })
  })

  it('keeps the line unit and the meta key', () => {
    expect(frameWheelOf({ delta: 3, mode: 1, ctrl: false, meta: true })).toEqual({
      deltaY: 3,
      deltaMode: 1,
      ctrlKey: false,
      metaKey: true,
    })
  })

  it('a relay that carries only the delta counts as a ctrl wheel in pixels', () => {
    expect(frameWheelOf({ delta: -2.5 })).toEqual({
      deltaY: -2.5,
      deltaMode: 0,
      ctrlKey: true,
      metaKey: false,
    })
  })

  it('drops a relay without a usable delta and ignores fields of the wrong kind', () => {
    expect(frameWheelOf({})).toBeNull()
    expect(frameWheelOf({ delta: '100' })).toBeNull()
    expect(frameWheelOf({ delta: Number.NaN })).toBeNull()
    expect(frameWheelOf({ delta: Number.POSITIVE_INFINITY })).toBeNull()
    expect(frameWheelOf({ delta: 0 })).toBeNull()
    expect(frameWheelOf({ delta: 5, mode: 'x', ctrl: 1, meta: 'yes' })).toEqual({
      deltaY: 5,
      deltaMode: 0,
      ctrlKey: true,
      metaKey: false,
    })
  })

  it('three relayed Windows wheel notches end at 130%, not at the 200% cap', () => {
    const classifier = createZoomWheelClassifier()
    let zoom = 100
    for (const now of [0, 120, 240]) {
      const wheel = frameWheelOf({ delta: -100, mode: 0, ctrl: true, meta: false })
      if (!wheel) throw new Error('the relay was dropped')
      const intent = classifier.feed(wheel, now)
      if (intent) zoom = nextWheelZoom(zoom, intent, wheel.deltaY, MIN, MAX)
    }
    expect(zoom).toBe(130)
  })

  it('a relayed pinch stays a pinch', () => {
    const wheel = frameWheelOf({ delta: -3.4, mode: 0, ctrl: true, meta: false })
    if (!wheel) throw new Error('the relay was dropped')
    expect(createZoomWheelClassifier().feed(wheel, 0)).toBe('pinch')
  })
})
