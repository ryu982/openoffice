import { describe, expect, it } from 'vitest'
import { strings } from '../src/renderer/src/strings'

/**
 * Home-screen locale tables (src/renderer/src/strings.ts): zh defines the key
 * set; every other locale must cover exactly the same keys with real content.
 */

const locales = Object.keys(strings) as Array<keyof typeof strings>
const referenceKeys = Object.keys(strings.zh).sort()

/** placeholders like {n}, {name}, {v} embedded in a template */
function placeholdersOf(template: string): string[] {
  return (template.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort()
}

describe('home-screen locale tables', () => {
  it('includes the expected UI languages', () => {
    expect(locales).toContain('zh')
    expect(locales).toContain('en')
    expect(locales).toContain('zh-TW')
    expect(locales.length).toBeGreaterThanOrEqual(19)
  })

  it.each(locales)('locale %s has exactly the zh key set', (locale) => {
    expect(Object.keys(strings[locale]).sort()).toEqual(referenceKeys)
  })

  it.each(locales)('locale %s has no empty or whitespace-only values', (locale) => {
    const empty = Object.entries(strings[locale])
      .filter(([, value]) => typeof value !== 'string' || value.trim().length === 0)
      .map(([key]) => key)
    expect(empty).toEqual([])
  })

  it.each(locales)('locale %s keeps the zh placeholder set for each key', (locale) => {
    const table = strings[locale] as Record<string, string>
    const mismatched = referenceKeys.filter((key) => {
      const localePlaceholders = placeholdersOf(table[key])
      const zhPlaceholders = placeholdersOf((strings.zh as Record<string, string>)[key])
      // Singular-count keys ("...One") may drop the numeral entirely in
      // languages that express "one" grammatically (e.g. ar/he), so a
      // missing placeholder is fine there — an extra one is not.
      if (key.endsWith('One')) {
        return localePlaceholders.some((p) => !zhPlaceholders.includes(p))
      }
      return localePlaceholders.join(',') !== zhPlaceholders.join(',')
    })
    expect(mismatched).toEqual([])
  })

  it('has no duplicate values that suggest an untranslated copy-paste between zh and en', () => {
    // sanity check that en is actually translated, not a zh copy
    const zh = strings.zh as Record<string, string>
    const en = strings.en as Record<string, string>
    const identical = referenceKeys.filter((key) => zh[key] === en[key])
    // a few shared strings (brand names, "PDF", "OK"-style tokens) are fine
    expect(identical.length).toBeLessThan(referenceKeys.length / 4)
  })

  /**
   * The app is still called AI Markdown. A rename of the app's name was started
   * in this branch and then dropped: the naming is the maintainers' call, not
   * this PR's, and README and the docs still say Markdown. Pinned so a stray
   * locale cannot quietly reintroduce a second name — the quick-create card,
   * the File > New menu and a new tab's title all have to agree.
   */
  it.each(locales)('locale %s calls the app AI Markdown on the quick-create card', (locale) => {
    expect(strings[locale].newMarkdown).toBe('AI Markdown')
  })
})

/**
 * Image generation through the ChatGPT plan: the app's direct ChatGPT
 * connection cannot make images (OpenAI does not allow it), so the Settings
 * choice is named after the plan, and the line under it says to connect the
 * Codex program with the same account. Every language names both, and OpenAI.
 */
describe('image generation through the ChatGPT plan', () => {
  const others = locales.filter((locale) => locale !== 'en')

  it.each(locales)('locale %s names the ChatGPT plan and the Codex program', (locale) => {
    const table = strings[locale]
    for (const key of ['setAiImageCodex', 'setAiImageCodexHint', 'setAiImageCodexConnect'] as const)
      expect(table[key], key).toMatch(/ChatGPT[\s\S]*Codex|Codex[\s\S]*ChatGPT/)
    expect(table.setAiImageCodexHint).toContain('Plus')
    expect(table.setAiImageCodexHint).toContain('OpenAI')
    expect(table.setAiImageCodexConnect).toContain('OpenAI')
    expect(table.setAiImageCodexConnectAction).toContain('Codex')
  })

  it.each(others)('locale %s translates the new lines rather than copying English', (locale) => {
    for (const key of [
      'setAiImageCodex',
      'setAiImageCodexHint',
      'setAiImageCodexConnect',
      'setAiImageCodexConnectAction',
      'setAiHeadlessWarning',
    ] as const)
      expect(strings[locale][key], key).not.toBe(strings.en[key])
  })

  /** the words each language uses for image generation in the automatic-requests warning */
  const imageGenerationIn: Record<(typeof locales)[number], string> = {
    zh: '生图',
    en: 'image generation',
    vi: 'tạo hình ảnh',
    tr: 'görüntü oluşturma',
    ja: '画像生成',
    ko: '이미지 생성',
    fr: 'génération d’images',
    de: 'Bildgenerierung',
    es: 'generación de imágenes',
    th: 'สร้างภาพ',
    id: 'pembuatan gambar',
    ru: 'генерацию изображений',
    ar: 'توليد الصور',
    pt: 'geração de imagens',
    it: 'generazione di immagini',
    pl: 'generowania obrazów',
    cs: 'generování obrázků',
    nl: 'afbeeldingen te genereren',
    ms: 'penjanaan imej',
    he: 'יצירת תמונות',
    hi: 'इमेज जनरेशन',
    'zh-TW': '生圖',
  }

  it.each(locales)(
    'locale %s names image generation in the automatic-requests warning',
    (locale) => {
      expect(strings[locale].setAiHeadlessWarning).toContain(imageGenerationIn[locale])
    },
  )
})
