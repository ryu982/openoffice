import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'
import { zh } from './ai-off/zh'
import { en } from './ai-off/en'
import { ja } from './ai-off/ja'
import { ko } from './ai-off/ko'
import { fr } from './ai-off/fr'
import { de } from './ai-off/de'
import { es } from './ai-off/es'
import { th } from './ai-off/th'
import { id } from './ai-off/id'
import { ru } from './ai-off/ru'
import { ar } from './ai-off/ar'
import { pt } from './ai-off/pt'
import { it } from './ai-off/it'
import { pl } from './ai-off/pl'
import { cs } from './ai-off/cs'
import { nl } from './ai-off/nl'
import { ms } from './ai-off/ms'
import { he } from './ai-off/he'
import { hi } from './ai-off/hi'
import { zhTW } from './ai-off/zh-TW'
import { vi } from './ai-off/vi'
import { tr } from './ai-off/tr'

/**
 * The shell's AI-off text: the refusal an AI run started from a screen gets
 * while AI features are turned off. Sharded per language; `zh` defines the
 * key set.
 */
export const aiOffStrings = defineStrings({
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

export type AiOffStringKey = keyof typeof zh

const translate = createI18n(aiOffStrings)

export function aiOffText(lang: Lang, key: AiOffStringKey, params?: Params): string {
  return translate(lang, key, params)
}
