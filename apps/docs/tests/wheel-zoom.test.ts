// Ctrl+wheel in Docs: every notch moves five percentage points onto the 5%
// grid (10% + one notch is 15%, not the 500% cap); the buttons keep ten.
import { describe, expect, it } from 'vitest'
import {
  DOCS_ZOOM_MAX,
  DOCS_ZOOM_MIN,
  nextDocsZoom,
  stepDocsZoom,
} from '../src/renderer/wheel-zoom'

describe('nextDocsZoom', () => {
  it('steps five points per notch from 10%', () => {
    expect(nextDocsZoom(10, 'zoom-in')).toBe(15)
    expect(nextDocsZoom(60, 'zoom-in')).toBe(65)
    expect(nextDocsZoom(60, 'zoom-out')).toBe(55)
  })

  it('lands an off-grid zoom on the 5% grid and clamps to 10-500', () => {
    expect(nextDocsZoom(64.37, 'zoom-in')).toBe(65)
    expect(nextDocsZoom(64.37, 'zoom-out')).toBe(60)
    expect(nextDocsZoom(DOCS_ZOOM_MIN, 'zoom-out')).toBe(DOCS_ZOOM_MIN)
    expect(nextDocsZoom(498, 'zoom-in')).toBe(DOCS_ZOOM_MAX)
    expect(nextDocsZoom(12, 'zoom-out')).toBe(DOCS_ZOOM_MIN)
  })
})

describe('stepDocsZoom', () => {
  it('moves ten whole points and stops at the Word range ends', () => {
    expect(stepDocsZoom(100, 1)).toBe(110)
    expect(stepDocsZoom(104.6, -1)).toBe(95)
    expect(stepDocsZoom(495, 1)).toBe(DOCS_ZOOM_MAX)
    expect(stepDocsZoom(15, -1)).toBe(DOCS_ZOOM_MIN)
  })
})
