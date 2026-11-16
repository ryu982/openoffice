import { basename } from 'node:path'
import type { Lang } from '@genoffice/i18n'
import type {
  EditorEntranceAsker,
  EntranceOptions,
  MakeAndOpenAnswer,
} from '@genoffice/electron-utils/editor-entrance'
import type { EditorItemId } from '../shared/editor-choice'
import type { EditorGate } from './editor-gate'
import {
  editorPromptText,
  type EditorPromptStringKey,
} from '../renderer/src/i18n/strings-editor-prompt'

/**
 * Entrances inside other features while editors can be turned off (editor
 * choice spec 7.3). They stay visible; pressing one asks BEFORE any work:
 * - a feature that makes a file of a turned-off editor's kind and opens it
 *   (a PDF conversion, the generate window's conversion without AI, Markdown
 *   to Hangul…): [Turn on and open] [Create the file only] [Cancel]
 * - an entrance that needs the editor itself (the generate window's AI
 *   "make", a PDF's note, the PDF tools window from the PDF editor):
 *   [Turn on and open] [Cancel]
 * Save As and exports never ask; when their result would open in a tab of a
 * turned-off editor, the file is shown in its folder instead.
 *
 * The questions are the editor gate's (editor-gate.ts); this module adds the
 * lines under them and the "open or show in folder" rule. Electron-free:
 * index.ts hands in the gate, the choice and the file manager.
 */

export interface EditorEntrancesDeps {
  /** the shell's gate (installed before anything asks) */
  gate(): Pick<EditorGate, 'askTurnOn' | 'askTurnOnOrFileOnly'>
  /** whether the item is turned off now */
  isOff(item: EditorItemId): boolean
  /** the item whose editor opens this file (the router's own answer); null = none */
  itemOfPath(path: string): EditorItemId | null
  /** the file is in a tab or a detached window now */
  isOpen(path: string): boolean
  /** show the file in the file manager */
  reveal(path: string): void
  lang(): Lang
}

export interface EditorEntrances extends EditorEntranceAsker {
  /**
   * Whether a just-made file may open in a tab now: false when its editor is
   * off and the file is not open already (the caller shows its folder).
   */
  opensInTab(path: string): boolean
  /**
   * A made or exported file: opened through `open`, or shown in its folder
   * when its editor is off (no question). True = it was shown either way.
   */
  openOrReveal(path: string, open: (path: string) => boolean): boolean
  /**
   * A file that already exists (a PDF tools result) and its "open" was
   * pressed: asks when its editor is off; "create the file only" shows it in
   * its folder. True = it was opened or shown.
   */
  openExisting(path: string, open: (path: string) => boolean): Promise<boolean>
}

export function createEditorEntrances(deps: EditorEntrancesDeps): EditorEntrances {
  const text = (key: EditorPromptStringKey, params?: Record<string, string | number>): string =>
    editorPromptText(deps.lang(), key, params)

  const nameOf = (options: EntranceOptions | undefined): string | undefined => {
    if (options?.path) return basename(options.path)
    return options?.fileName ? basename(options.fileName) : undefined
  }

  /** no question for an editor that is on, or for a file that is open already (spec 7.2) */
  const asks = (item: EditorItemId, options: EntranceOptions | undefined): boolean =>
    deps.isOff(item) && !(options?.path && deps.isOpen(options.path))

  const makeAndOpen = async (
    item: EditorItemId,
    options?: EntranceOptions,
  ): Promise<MakeAndOpenAnswer> => {
    if (!asks(item, options)) return 'open'
    const name = nameOf(options)
    const detail = [name, text('fileOnlyDetail')].filter(Boolean).join('\n')
    const answer = await deps.gate().askTurnOnOrFileOnly(item, { detail })
    return answer === 'turn-on' ? 'open' : answer
  }

  const editorEntrance = async (item: EditorItemId, options?: EntranceOptions) => {
    if (!asks(item, options)) return true
    const name = nameOf(options)
    const detail = [name, text('entranceDetail', { item: text(`item_${item}`) })]
      .filter(Boolean)
      .join('\n')
    return (await deps.gate().askTurnOn(item, { detail })) === 'turn-on'
  }

  const opensInTab = (path: string): boolean => {
    const item = deps.itemOfPath(path)
    return !item || !deps.isOff(item) || deps.isOpen(path)
  }

  return {
    makeAndOpen,
    editorEntrance,
    opensInTab,

    openOrReveal(path, open) {
      if (opensInTab(path)) return open(path)
      deps.reveal(path)
      return true
    },

    async openExisting(path, open) {
      const item = deps.itemOfPath(path)
      if (!item) return open(path)
      const answer = await makeAndOpen(item, { path })
      if (answer === 'cancel') return false
      if (answer === 'open') return open(path)
      deps.reveal(path)
      return true
    },
  }
}
