// Ctrl+wheel in the PDF viewer: a mouse-wheel notch moves ten percentage
// points (one Windows notch used to jump sixty), a trackpad pinch stays continuous.
import { describe, expect, it } from 'vitest'
import { createZoomWheelClassifier } from '@genoffice/ui'
import { nextWheelScale } from '../src/renderer/wheel-zoom'

const MIN = 0.1
const MAX = 8

describe('nextWheelScale', () => {
  it('steps ten points per notch', () => {
    expect(nextWheelScale(1, 'zoom-in', -100, MIN, MAX)).toBeCloseTo(1.1, 10)
    expect(nextWheelScale(1, 'zoom-out', 100, MIN, MAX)).toBeCloseTo(0.9, 10)
    expect(nextWheelScale(1.1, 'zoom-in', -300, MIN, MAX)).toBeCloseTo(1.2, 10)
  })

  it('snaps a fit-width fraction to whole percents and stops at the range ends', () => {
    expect(nextWheelScale(0.8734, 'zoom-in', -100, MIN, MAX)).toBe(0.97)
    expect(nextWheelScale(7.95, 'zoom-in', -100, MIN, MAX)).toBe(MAX)
    expect(nextWheelScale(0.15, 'zoom-out', 100, MIN, MAX)).toBe(MIN)
    expect(nextWheelScale(MIN, 'zoom-out', 100, MIN, MAX)).toBe(MIN)
  })

  it('keeps a pinch continuous with the delta-scaled factor', () => {
    expect(nextWheelScale(1, 'pinch', -3.4, MIN, MAX)).toBeCloseTo(1.0204, 10)
    expect(nextWheelScale(1, 'pinch', 7.25, MIN, MAX)).toBeCloseTo(0.9565, 10)
    expect(nextWheelScale(7.99, 'pinch', -50, MIN, MAX)).toBe(MAX)
  })

  it('three Windows wheel notches end at 130%, not at 280%', () => {
    const classifier = createZoomWheelClassifier()
    let scale = 1
    for (const now of [0, 120, 240]) {
      const wheel = { deltaY: -100, deltaMode: 0, ctrlKey: true, metaKey: false }
      const intent = classifier.feed(wheel, now)
      if (intent) scale = nextWheelScale(scale, intent, wheel.deltaY, MIN, MAX)
    }
    expect(scale).toBeCloseTo(1.3, 10)
  })
})
