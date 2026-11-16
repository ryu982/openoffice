/**
 * The questions an editor's main process asks before a feature that needs an
 * editor which may be turned off (editor choice spec 7.3): a conversion that
 * makes a file and opens it in another editor ([Turn on and open] [Create the
 * file only] [Cancel]), or an entrance that needs that editor itself ([Turn on
 * and open] [Cancel]). The shell installs the asker, which shows its native
 * questions; an editor running on its own has none, and then every entrance
 * goes ahead as before. No Electron import.
 */
import { isEditorItemOff, type EditorItemId } from './app-choice'

/**
 * - `open`: the editor is on (or was just turned on): make the file and open it
 * - `file-only`: make the file where the feature puts it, show it in its folder
 * - `cancel`: do nothing, leave no file
 */
export type MakeAndOpenAnswer = 'open' | 'file-only' | 'cancel'

export interface EntranceOptions {
  /** the file the question is about, when it is known; its name is shown */
  path?: string
  /** a name to show when there is no file yet (the source of a conversion, say) */
  fileName?: string
}

export interface EditorEntranceAsker {
  /** [Turn on and open] [Create the file only] [Cancel] */
  makeAndOpen(item: EditorItemId, options?: EntranceOptions): Promise<MakeAndOpenAnswer>
  /** [Turn on and open] [Cancel]; true = the editor is on now */
  editorEntrance(item: EditorItemId, options?: EntranceOptions): Promise<boolean>
}

let asker: EditorEntranceAsker | null = null

/** The shell sets this once; null clears it (tests) */
export function setEditorEntranceAsker(next: EditorEntranceAsker | null): void {
  asker = next
}

/**
 * Before a feature makes a file of `item`'s kind and opens it. An editor that
 * is on answers `open` at once; with no shell answering, `open` as well.
 */
export async function askBeforeMakeAndOpen(
  item: EditorItemId,
  options?: EntranceOptions,
): Promise<MakeAndOpenAnswer> {
  if (!asker || !isEditorItemOff(item)) return 'open'
  return asker.makeAndOpen(item, options)
}

/** Before an entrance that needs `item`'s editor itself; true = go ahead */
export async function askBeforeEditorEntrance(
  item: EditorItemId,
  options?: EntranceOptions,
): Promise<boolean> {
  if (!asker || !isEditorItemOff(item)) return true
  return asker.editorEntrance(item, options)
}
