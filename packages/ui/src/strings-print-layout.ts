import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'
import { zh } from './strings-print-layout/zh'
import { en } from './strings-print-layout/en'
import { ja } from './strings-print-layout/ja'
import { ko } from './strings-print-layout/ko'
import { fr } from './strings-print-layout/fr'
import { de } from './strings-print-layout/de'
import { es } from './strings-print-layout/es'
import { th } from './strings-print-layout/th'
import { id } from './strings-print-layout/id'
import { ru } from './strings-print-layout/ru'
import { ar } from './strings-print-layout/ar'
import { pt } from './strings-print-layout/pt'
import { it } from './strings-print-layout/it'
import { pl } from './strings-print-layout/pl'
import { cs } from './strings-print-layout/cs'
import { nl } from './strings-print-layout/nl'
import { ms } from './strings-print-layout/ms'
import { he } from './strings-print-layout/he'
import { hi } from './strings-print-layout/hi'
import { zhTW } from './strings-print-layout/zh-TW'
import { vi } from './strings-print-layout/vi'
import { tr } from './strings-print-layout/tr'

/**
 * Wording of the shared advanced print parts (decision 0141): the page layout
 * panel, its layout diagram, the arranged-result preview and the small print
 * dialog. `zh` defines the key set.
 */
export const PRINT_LAYOUT_STRINGS = defineStrings({
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

export type PrintLayoutStringKey = keyof typeof zh

/** `printLayoutText(lang, key, params)`: the string in that language with its `{name}` placeholders filled */
export const printLayoutText: (lang: Lang, key: PrintLayoutStringKey, params?: Params) => string =
  createI18n(PRINT_LAYOUT_STRINGS)
