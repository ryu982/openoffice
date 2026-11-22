import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'
import { zh } from './strings-ai-panel/zh'
import { en } from './strings-ai-panel/en'
import { ja } from './strings-ai-panel/ja'
import { ko } from './strings-ai-panel/ko'
import { fr } from './strings-ai-panel/fr'
import { de } from './strings-ai-panel/de'
import { es } from './strings-ai-panel/es'
import { th } from './strings-ai-panel/th'
import { id } from './strings-ai-panel/id'
import { ru } from './strings-ai-panel/ru'
import { ar } from './strings-ai-panel/ar'
import { pt } from './strings-ai-panel/pt'
import { it } from './strings-ai-panel/it'
import { pl } from './strings-ai-panel/pl'
import { cs } from './strings-ai-panel/cs'
import { nl } from './strings-ai-panel/nl'
import { ms } from './strings-ai-panel/ms'
import { he } from './strings-ai-panel/he'
import { hi } from './strings-ai-panel/hi'
import { zhTW } from './strings-ai-panel/zh-TW'
import { vi } from './strings-ai-panel/vi'
import { tr } from './strings-ai-panel/tr'

/**
 * Shared AI assistant panel chrome wording (unified attach menu, skill button,
 * work steps summary, reply footer, scroll-to-bottom, and empty-state hints).
 * `zh` defines the canonical key set.
 */
export const AI_PANEL_STRINGS = defineStrings({
  zh,
  en,
  ja,
  ko,
  fr,
  de,
  es,
  th,
  id,
  ru,
  ar,
  pt,
  it,
  pl,
  cs,
  nl,
  ms,
  he,
  hi,
  'zh-TW': zhTW,
  vi,
  tr,
})

export type AiPanelStringKey = keyof typeof zh

/** `aiPanelText(lang, key, params)`: localized string with branding and placeholders applied */
export const aiPanelText: (lang: Lang, key: AiPanelStringKey, params?: Params) => string =
  createI18n(AI_PANEL_STRINGS)
