import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LANGS, productName } from '@genoffice/i18n'
import { AI_PANEL_STRINGS, aiPanelText, type AiPanelStringKey } from '../src/strings-ai-panel'
import {
  IconArrowUpRight,
  IconCloudDrive,
  IconCopy,
  IconFileDoc,
  IconPaperclip,
  IconPlus,
  IconRetry,
  IconSlash,
  IconStepDone,
  IconStepError,
  IconStepRunning,
} from '../src/icons'

const NON_LATIN_LANGS = ['zh', 'ja', 'ko', 'th', 'ru', 'ar', 'he', 'hi', 'zh-TW'] as const

function placeholdersOf(text: string): string[] {
  return Array.from(text.matchAll(/\{([a-zA-Z0-9_]+)\}/g), (m) => m[1]!).sort()
}

describe('AI_PANEL_STRINGS (22 languages)', () => {
  const keys = Object.keys(AI_PANEL_STRINGS.zh) as AiPanelStringKey[]

  it('covers every language in LANGS with non-empty values and matching placeholders', () => {
    expect(Object.keys(AI_PANEL_STRINGS).length).toBe(LANGS.length)
    for (const lang of LANGS) {
      const table = AI_PANEL_STRINGS[lang]
      expect(table, lang).toBeDefined()
      for (const key of keys) {
        const val = table[key]
        expect(val.trim().length, `${lang}.${key}`).toBeGreaterThan(0)
        expect(placeholdersOf(val), `${lang}.${key} placeholders`).toEqual(
          placeholdersOf(AI_PANEL_STRINGS.zh[key]),
        )
      }
    }
  })

  it('does not copy English values verbatim into non-Latin languages', () => {
    for (const lang of NON_LATIN_LANGS) {
      for (const key of keys) {
        expect(AI_PANEL_STRINGS[lang][key], `${lang}.${key}`).not.toBe(AI_PANEL_STRINGS.en[key])
      }
    }
  })

  it('brands GenOffice automatically through aiPanelText', () => {
    expect(aiPanelText('ko', 'attachFromDocs')).toContain(productName('ko'))
    expect(aiPanelText('en', 'attachFromDocs')).toContain(productName('en'))
    expect(aiPanelText('ko', 'workedSteps', { n: 3 })).toContain('3')
  })
})

describe('new monochrome AI panel icons', () => {
  it('renders valid svg elements for every added icon', () => {
    const icons = [
      IconPlus,
      IconSlash,
      IconCopy,
      IconRetry,
      IconArrowUpRight,
      IconPaperclip,
      IconFileDoc,
      IconCloudDrive,
      IconStepDone,
      IconStepError,
      IconStepRunning,
    ]
    for (const Icon of icons) {
      const html = renderToStaticMarkup(React.createElement(Icon, { size: 16 }))
      expect(html).toContain('<svg')
      expect(html).toContain('aria-hidden="true"')
    }
  })
})
