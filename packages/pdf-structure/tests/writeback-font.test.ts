// The translated-PDF writer embeds TrueType faces only. On a Linux PC whose only CJK
// face is Noto Sans CJK (CFF), the regional list finds nothing usable and the writer
// falls back to scanning every installed face; that scan must pass over the CFF face
// to a TrueType one that also draws the text, or every Korean block is skipped.
// The installed-font index is replaced by two shipped Korean faces, CFF one first.
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import type { FaceRef, FontIndex } from '../../font-metrics/src/sfnt'

const FOLDER = resolve(import.meta.dirname, '../../ui/template-fonts')
const faces = vi.hoisted(() => ({ list: [] as FaceRef[] }))

vi.mock('../../font-metrics/src/sfnt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../font-metrics/src/sfnt')>()
  return {
    ...actual,
    getFontIndex: (): FontIndex => ({
      byPs: new Map(faces.list.map((f, i) => [`face${i}`, f])),
      byFamily: new Map(),
    }),
  }
})

import { isTruetype } from '../../font-metrics/src/font-locate'
import { defaultWritebackFontLocator } from '../src/writeback/font'

const face = (file: string): FaceRef => ({
  path: resolve(FOLDER, file),
  offset: 0,
  style: 'regular',
})
const TEXT = '빠른 갈색 여우가 강둑 근처에서 게으른 개를 뛰어넘습니다.'

describe('defaultWritebackFontLocator on a PC without the regional faces', () => {
  it('takes a TrueType face that covers the text even when a CFF one comes first', () => {
    faces.list = [face('Pretendard-Regular.otf'), face('GowunDodum-Regular.ttf')]
    const bytes = defaultWritebackFontLocator(TEXT, 'ko')
    expect(bytes).not.toBeNull()
    expect(isTruetype(Buffer.from(bytes!))).toBe(true)
  })

  it('finds nothing when only CFF faces cover the text', () => {
    faces.list = [face('Pretendard-Regular.otf')]
    expect(defaultWritebackFontLocator(TEXT, 'ko')).toBeNull()
  })
})
