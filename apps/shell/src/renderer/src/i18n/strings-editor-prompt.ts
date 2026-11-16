import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'
import { zh } from './editor-prompt/zh'
import { en } from './editor-prompt/en'
import { ja } from './editor-prompt/ja'
import { ko } from './editor-prompt/ko'
import { fr } from './editor-prompt/fr'
import { de } from './editor-prompt/de'
import { es } from './editor-prompt/es'
import { th } from './editor-prompt/th'
import { id } from './editor-prompt/id'
import { ru } from './editor-prompt/ru'
import { ar } from './editor-prompt/ar'
import { pt } from './editor-prompt/pt'
import { it } from './editor-prompt/it'
import { pl } from './editor-prompt/pl'
import { cs } from './editor-prompt/cs'
import { nl } from './editor-prompt/nl'
import { ms } from './editor-prompt/ms'
import { he } from './editor-prompt/he'
import { hi } from './editor-prompt/hi'
import { zhTW } from './editor-prompt/zh-TW'
import { vi } from './editor-prompt/vi'
import { tr } from './editor-prompt/tr'

/**
 * The questions the main process asks before opening a file with an editor
 * that is turned off, or importing a skill while AI is off (native dialogs).
 * Sharded per language; `zh` defines the key set.
 */
export const editorPromptStrings = defineStrings({
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

export type EditorPromptStringKey = keyof typeof zh

const translate = createI18n(editorPromptStrings)

export function editorPromptText(lang: Lang, key: EditorPromptStringKey, params?: Params): string {
  return translate(lang, key, params)
}
