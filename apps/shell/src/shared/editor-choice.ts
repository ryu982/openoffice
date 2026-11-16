// Which editors are on and whether AI features are on (Settings, the
// first-run picker). The item ids, the read rules and the IPC channels live
// in @genoffice/electron-utils/app-choice so the editor mains can use them
// without depending on the shell; this module re-exports them and adds what
// only the shell needs: the mapping to its tab and new-document kinds, the
// value to store, and the first-run rules. Pure, no Electron.
//
// Which file belongs to which item is decided by the editor the shell opens
// it with (`routeDocumentPath` → TabKind), so an item maps to a tab kind,
// never to an extension list of its own.

import {
  allEditorsOff,
  editorOffList,
  normalizeEditorOff,
  type EditorItemId,
} from '@genoffice/electron-utils/app-choice'
import type { HomeKind, HomeKindsSettings } from './home-kinds'
import type { TabKind } from './tabs-api'

export {
  ALL_ON_APP_CHOICE,
  APP_CHOICE_BRIDGE_KEY,
  APP_CHOICE_CHANNELS,
  APP_CHOICE_KEYS,
  EDITOR_ITEM_IDS,
  EDITOR_ONLY_ITEM_IDS,
  allEditorsOff,
  appChoiceFromSettings,
  editorOffList,
  isEditorItemId,
  isToolItem,
  normalizeAiFeatures,
  normalizeAppChoice,
  normalizeEditorOff,
  type AppChoice,
  type AppChoicePatch,
  type EditorItemId,
  type EditorOnlyItemId,
  type ToolItemId,
} from '@genoffice/electron-utils/app-choice'
// a type only: the bridge module itself is Electron-bound (preloads)
export type { AppChoiceBridge as EditorChoiceApi } from '@genoffice/electron-utils/app-choice-bridge'

/** the tab kind that shows an item's files; the PDF tools have none */
export const EDITOR_ITEM_TAB_KIND: Readonly<Record<EditorItemId, TabKind | null>> = {
  docs: 'docs',
  sheets: 'sheets',
  slides: 'slides',
  pdf: 'pdf',
  pdfTools: null,
  markdown: 'markdown',
  html: 'html',
  mindmap: 'mindmap',
  diagram: 'diagram',
  hwp: 'hwp',
  epub: 'epub',
}

/** the item's entry on home's new-document lists; EPUB has none */
export const EDITOR_ITEM_HOME_KIND: Readonly<Record<EditorItemId, HomeKind | null>> = {
  docs: 'docx',
  sheets: 'xlsx',
  slides: 'pptx',
  pdf: 'pdf',
  pdfTools: 'pdfTools',
  markdown: 'md',
  html: 'html',
  mindmap: 'xmind',
  diagram: 'drawio',
  hwp: 'hwp',
  epub: null,
}

function itemWhere(match: (id: EditorItemId) => boolean): EditorItemId | null {
  for (const id of Object.keys(EDITOR_ITEM_TAB_KIND) as EditorItemId[]) if (match(id)) return id
  return null
}

/** the item a tab belongs to; null for home and the manual */
export function editorItemOfTabKind(kind: TabKind): EditorItemId | null {
  return itemWhere((id) => EDITOR_ITEM_TAB_KIND[id] === kind)
}

export function editorItemOfHomeKind(kind: HomeKind): EditorItemId | null {
  return itemWhere((id) => EDITOR_ITEM_HOME_KIND[id] === kind)
}

/** `editors` in userData/app-settings.json, as read */
export interface EditorChoice {
  off: EditorItemId[]
}

/** Read a stored or sent `editors` value: unknown ids dropped, all editors off = all on */
export function normalizeEditorChoice(raw: unknown): EditorChoice {
  return { off: normalizeEditorOff(raw) }
}

/** the `editors` value to store: only what differs from everything on */
export function storedEditorChoice(choice: EditorChoice): { off?: EditorItemId[] } {
  const off = normalizeEditorOff(choice)
  return off.length > 0 ? { off } : {}
}

/** the `aiFeatures` value to store: false when off, nothing (key removed) when on */
export function storedAiFeatures(on: boolean): false | undefined {
  return on ? undefined : false
}

/**
 * Whether `item` is the only editor still on, so its switch must not turn it
 * off. The PDF tools are not an editor and never count.
 */
export function isLastEditorOn(choice: EditorChoice, item: EditorItemId): boolean {
  if (item === 'pdfTools' || choice.off.includes(item)) return false
  return allEditorsOff(editorOffList({ off: [...choice.off, item] }))
}

/** Turn one item on or off; turning off the last editor leaves the choice as it is */
export function setEditorItemOn(
  choice: EditorChoice,
  item: EditorItemId,
  on: boolean,
): EditorChoice {
  if (!on) {
    if (isLastEditorOn(choice, item)) return { off: [...choice.off] }
    return { off: editorOffList({ off: [...choice.off, item] }) }
  }
  return { off: editorOffList({ off: choice.off.filter((id) => id !== item) }) }
}

/**
 * The new-document kinds home leaves out: the ones hidden in Settings →
 * General and the ones whose item is turned off, in home's order.
 */
export function hiddenNewDocumentKinds(
  homeKinds: HomeKindsSettings,
  choice: EditorChoice,
): HomeKind[] {
  const offKinds = new Set<HomeKind>()
  for (const item of choice.off) {
    const kind = EDITOR_ITEM_HOME_KIND[item]
    if (kind) offKinds.add(kind)
  }
  return homeKinds.order.filter((kind) => homeKinds.hidden.includes(kind) || offKinds.has(kind))
}

export type OnboardingStep = 'welcome' | 'pick' | 'connect' | 'done'

/** the first-run steps; with AI off there is nothing to connect */
export function onboardingSteps(aiFeatures: boolean): OnboardingStep[] {
  return aiFeatures ? ['welcome', 'pick', 'connect', 'done'] : ['welcome', 'pick', 'done']
}

/**
 * Whether to show the one-time editor picker: to someone who passed the
 * first-run guide before the picker existed and has not seen it yet. A new
 * person meets the picker inside the guide instead.
 */
export function editorPickDue(settings: {
  onboardingSeen?: unknown
  editorPickSeen?: unknown
}): boolean {
  return settings.onboardingSeen === true && settings.editorPickSeen !== true
}
