/**
 * Pre-open validation gate for `.whiteboard` and Excalidraw import formats
 * (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`).
 * Called by the shell before creating a tab so damaged or non-Excalidraw files
 * show a clear reason and never leave an empty tab or recent-files entry.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { checkExcalidraw, checkWhiteboard } from '@genoffice/whiteboard-engine/node'
import { detectWhiteboardFormat, isExcalidrawFormat } from '../shared/formats'
import { OPEN_FAILURE_KEYS, type OpenFailureReason } from '../shared/open-failure'
import { tm, type MainStringKey } from './i18n-main'

export interface WhiteboardOpenCheckOptions {
  /** When a recovery copy exists for this path, allow opening the tab so recovery can be offered. */
  hasRecoveryCopy?: (filePath: string) => boolean
}

function refusalMessage(reason: OpenFailureReason): string {
  return tm(OPEN_FAILURE_KEYS[reason] as MainStringKey)
}

/**
 * Returns the localized refusal message if `filePath` cannot open as a `.whiteboard`,
 * or null if valid. Returns null for `.excalidraw*` (handled by `excalidrawOpenRefusal`).
 */
export function whiteboardOpenRefusal(
  filePath: string,
  options: WhiteboardOpenCheckOptions = {},
): string | null {
  const kind = detectWhiteboardFormat(filePath)
  if (isExcalidrawFormat(kind)) return null
  if (kind !== 'whiteboard') return refusalMessage('unsupported')

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(readFileSync(filePath))
  } catch {
    return refusalMessage('unreadable')
  }

  const checked = checkWhiteboard(bytes)
  if (checked.ok) return null
  if (options.hasRecoveryCopy?.(filePath)) return null
  return refusalMessage(checked.error.code)
}

/**
 * Returns the localized refusal message if `filePath` is not a valid Excalidraw
 * scene (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`), or null if valid.
 * Ordinary PNG/SVG files without embedded scenes are rejected with `no_excalidraw_scene`.
 */
export function excalidrawOpenRefusal(filePath: string): string | null {
  const kind = detectWhiteboardFormat(filePath)
  if (!isExcalidrawFormat(kind)) return refusalMessage('unsupported')

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(readFileSync(filePath))
  } catch {
    return refusalMessage('unreadable')
  }

  const checked = checkExcalidraw(bytes, basename(filePath))
  if (checked.ok) return null
  return refusalMessage(checked.error.code)
}
