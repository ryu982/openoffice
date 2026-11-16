import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'
import { zh } from './editor-settings/zh'
import { en } from './editor-settings/en'
import { ja } from './editor-settings/ja'
import { ko } from './editor-settings/ko'
import { fr } from './editor-settings/fr'
import { de } from './editor-settings/de'
import { es } from './editor-settings/es'
import { th } from './editor-settings/th'
import { id } from './editor-settings/id'
import { ru } from './editor-settings/ru'
import { ar } from './editor-settings/ar'
import { pt } from './editor-settings/pt'
import { it } from './editor-settings/it'
import { pl } from './editor-settings/pl'
import { cs } from './editor-settings/cs'
import { nl } from './editor-settings/nl'
import { ms } from './editor-settings/ms'
import { he } from './editor-settings/he'
import { hi } from './editor-settings/hi'
import { zhTW } from './editor-settings/zh-TW'
import { vi } from './editor-settings/vi'
import { tr } from './editor-settings/tr'

/**
 * Settings → Editors and AI: the section note, what turning AI off keeps,
 * and the question asked before running AI jobs are stopped.
 * Sharded per language; `zh` defines the key set.
 */
export const editorSettingsStrings = defineStrings({
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

export type EditorSettingsStringKey = keyof typeof zh

const translate = createI18n(editorSettingsStrings)

export function editorSettingsText(
  lang: Lang,
  key: EditorSettingsStringKey,
  params?: Params,
): string {
  return translate(lang, key, params)
}
