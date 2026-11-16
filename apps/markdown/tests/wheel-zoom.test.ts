// Ctrl+wheel in the Markdown editor: a mouse-wheel notch moves ten percentage
// points (one Windows notch used to jump sixty), a trackpad pinch stays continuous.
import { describe, expect, it } from 'vitest'
import { createZoomWheelClassifier } from '@genoffice/ui'
import { nextWheelZoom } from '../src/renderer/wheel-zoom'

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

  it('three Windows wheel notches end at 130%, not at the 200% cap', () => {
    const classifier = createZoomWheelClassifier()
    let zoom = 100
    for (const now of [0, 120, 240]) {
      const wheel = { deltaY: -100, deltaMode: 0, ctrlKey: true, metaKey: false }
      const intent = classifier.feed(wheel, now)
      if (intent) zoom = nextWheelZoom(zoom, intent, wheel.deltaY, MIN, MAX)
    }
    expect(zoom).toBe(130)
  })
})
