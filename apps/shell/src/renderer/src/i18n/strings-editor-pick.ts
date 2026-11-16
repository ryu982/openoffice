import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'
import type { EditorItemId } from '../../../shared/editor-choice'
import { zh } from './editor-pick/zh'
import { en } from './editor-pick/en'
import { ja } from './editor-pick/ja'
import { ko } from './editor-pick/ko'
import { fr } from './editor-pick/fr'
import { de } from './editor-pick/de'
import { es } from './editor-pick/es'
import { th } from './editor-pick/th'
import { id } from './editor-pick/id'
import { ru } from './editor-pick/ru'
import { ar } from './editor-pick/ar'
import { pt } from './editor-pick/pt'
import { it } from './editor-pick/it'
import { pl } from './editor-pick/pl'
import { cs } from './editor-pick/cs'
import { nl } from './editor-pick/nl'
import { ms } from './editor-pick/ms'
import { he } from './editor-pick/he'
import { hi } from './editor-pick/hi'
import { zhTW } from './editor-pick/zh-TW'
import { vi } from './editor-pick/vi'
import { tr } from './editor-pick/tr'

/**
 * The editor picker (first-run step, one-time picker on Home) and the names
 * of the eleven items, which Settings → Editors and AI reuses.
 * Sharded per language; `zh` defines the key set.
 */
export const editorPickStrings = defineStrings({
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

export type EditorPickStringKey = keyof typeof zh

const translate = createI18n(editorPickStrings)

export function editorPickText(lang: Lang, key: EditorPickStringKey, params?: Params): string {
  return translate(lang, key, params)
}

/** the string key of each item's name */
export const EDITOR_ITEM_NAME_KEYS: Readonly<Record<EditorItemId, EditorPickStringKey>> = {
  docs: 'itemDocs',
  sheets: 'itemSheets',
  slides: 'itemSlides',
  pdf: 'itemPdf',
  pdfTools: 'itemPdfTools',
  markdown: 'itemMarkdown',
  html: 'itemHtml',
  mindmap: 'itemMindmap',
  diagram: 'itemDiagram',
  hwp: 'itemHwp',
  epub: 'itemEpub',
}

/** an item's name as the picker and Settings show it */
export function editorItemName(lang: Lang, item: EditorItemId): string {
  return editorPickText(lang, EDITOR_ITEM_NAME_KEYS[item])
}
