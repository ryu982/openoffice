import { describe, expect, it } from 'vitest'
import { LANGS, type Lang } from '@genoffice/i18n'
import {
  PRINT_LAYOUT_STRINGS,
  printLayoutText,
  type PrintLayoutStringKey,
} from '../src/strings-print-layout'

const KEYS = Object.keys(PRINT_LAYOUT_STRINGS.zh) as PrintLayoutStringKey[]

/** Technical tokens that may read the same as English in any language */
const TECHNICAL = new Set<PrintLayoutStringKey>(['dpiValue', 'paperLetter', 'paperLegal'])
/** Words a language shares with English for real */
const COGNATES: Partial<Record<Lang, readonly PrintLayoutStringKey[]>> = {
  id: ['modePoster'],
  ms: ['modePoster'],
}

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()

describe('PRINT_LAYOUT_STRINGS', () => {
  it('has every key, non-empty, in every UI language', () => {
    expect(Object.keys(PRINT_LAYOUT_STRINGS).sort()).toEqual([...LANGS].sort())
    for (const lang of LANGS) {
      const dict = PRINT_LAYOUT_STRINGS[lang] as Record<string, string>
      expect(Object.keys(dict).sort(), lang).toEqual([...KEYS].sort())
      for (const key of KEYS) expect(dict[key]?.trim().length, `${lang}.${key}`).toBeGreaterThan(0)
    }
  })

  it('keeps the same placeholders in every language', () => {
    for (const key of KEYS) {
      const expected = placeholders(PRINT_LAYOUT_STRINGS.zh[key])
      for (const lang of LANGS) {
        expect(placeholders(PRINT_LAYOUT_STRINGS[lang][key]), `${lang}.${key}`).toEqual(expected)
      }
    }
  })

  it('is translated, not copied from English', () => {
    for (const lang of LANGS) {
      if (lang === 'en') continue
      const allowed = new Set([...TECHNICAL, ...(COGNATES[lang] ?? [])])
      for (const key of KEYS) {
        if (allowed.has(key)) continue
        expect(PRINT_LAYOUT_STRINGS[lang][key], `${lang}.${key}`).not.toBe(
          PRINT_LAYOUT_STRINGS.en[key],
        )
      }
    }
  })

  it('names no company, brand or product', () => {
    for (const lang of LANGS) {
      for (const key of KEYS) {
        expect(PRINT_LAYOUT_STRINGS[lang][key], `${lang}.${key}`).not.toMatch(
          /Avery|Herma|Formtec|Brother|Dymo|Microsoft|Windows|Apple|macOS|Adobe|Acrobat|Chrome|Electron|Hancom|GenOffice|IeumOffice|이음오피스/i,
        )
      }
    }
  })

  it('says the spec sentences in Korean', () => {
    expect(printLayoutText('ko', 'modeSingle')).toBe('한 장에 한 쪽')
    expect(printLayoutText('ko', 'modeNup')).toBe('한 장에 여러 쪽')
    expect(printLayoutText('ko', 'modeBooklet')).toBe('소책자')
    expect(printLayoutText('ko', 'modePoster')).toBe('포스터')
    expect(printLayoutText('ko', 'modeLabels')).toBe('라벨')
    expect(printLayoutText('ko', 'bookletHint')).toBe('양면 인쇄를 짧은 쪽으로 넘기기로 고르세요.')
    expect(printLayoutText('ko', 'paperSource')).toBe('문서 쪽 크기 그대로')
    expect(printLayoutText('ko', 'fitToPaper')).toBe('용지에 맞춰 줄이기')
    expect(printLayoutText('ko', 'savePdf')).toBe('배치한 결과를 PDF로 저장')
    expect(printLayoutText('ko', 'progress', { done: 3, total: 10 })).toBe('10쪽 중 3쪽')
  })
})
