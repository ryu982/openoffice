// A caller that can only embed TrueType (glyf) faces asks findFontCovering to skip CFF
// ones. Without that, a CFF face covering the text (Noto Sans CJK on Linux) is returned
// first and the caller drops it, never reaching a TrueType face that also covers it.
// The installed-font index is replaced by two shipped Korean faces, CFF one first.
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import type { FaceRef, FontIndex } from '../src/sfnt'

const FOLDER = resolve(import.meta.dirname, '../../ui/template-fonts')
const CFF: FaceRef = {
  path: resolve(FOLDER, 'Pretendard-Regular.otf'),
  offset: 0,
  style: 'regular',
}
const TTF: FaceRef = {
  path: resolve(FOLDER, 'GowunDodum-Regular.ttf'),
  offset: 0,
  style: 'regular',
}

const faces = vi.hoisted(() => ({ list: [] as FaceRef[] }))

vi.mock('../src/sfnt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sfnt')>()
  return {
    ...actual,
    getFontIndex: (): FontIndex => ({
      byPs: new Map(faces.list.map((f, i) => [`face${i}`, f])),
      byFamily: new Map(),
    }),
  }
})

import { findFontCovering, isTruetype } from '../src/font-locate'

const KOREAN = '연례 보고서'

describe('findFontCovering truetypeOnly', () => {
  it('still answers with the first covering face, CFF included, when not asked to skip', () => {
    faces.list = [CFF, TTF]
    const bytes = findFontCovering(KOREAN)
    expect(bytes).not.toBeNull()
    expect(isTruetype(bytes!)).toBe(false)
  })

  it('passes over a covering CFF face to the TrueType one after it', () => {
    faces.list = [CFF, TTF]
    const bytes = findFontCovering(KOREAN, { truetypeOnly: true })
    expect(bytes).not.toBeNull()
    expect(isTruetype(bytes!)).toBe(true)
  })

  it('is null when only CFF faces cover the text', () => {
    faces.list = [CFF]
    expect(findFontCovering(KOREAN, { truetypeOnly: true })).toBeNull()
    expect(findFontCovering(KOREAN)).not.toBeNull()
  })
})
