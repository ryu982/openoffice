/** What a plain (no-modifier) navigation key should do in the viewer */
export type NavAction =
  | { type: 'scrollBy'; delta: number }
  | { type: 'scrollViewport'; dir: 1 | -1 }
  | { type: 'scrollEdge'; edge: 'top' | 'bottom' }
  | { type: 'stepPage'; dir: 1 | -1 }

const TEXT_INPUT_TYPES = new Set(['email', 'password', 'search', 'tel', 'text', 'url'])

function usesNativeTextUndo(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  if (element.tagName === 'INPUT') {
    const input = element as HTMLInputElement
    return !input.disabled && !input.readOnly && TEXT_INPUT_TYPES.has(input.type.toLowerCase())
  }
  if (element.tagName === 'TEXTAREA') {
    const textarea = element as HTMLTextAreaElement
    return !textarea.disabled && !textarea.readOnly
  }
  return element.isContentEditable
}

export function shouldHandleDocumentUndo(
  target: EventTarget | null,
  key: string,
  modifier: boolean,
): boolean {
  if (!modifier || key.toLowerCase() !== 'z') return true
  return !usesNativeTextUndo(target)
}

/** Vertical arrows step whole pages while focus sits in the thumbnail sidebar,
    and scroll the document otherwise */
export function navAction(key: string, focusInThumbs: boolean): NavAction | null {
  switch (key) {
    case 'PageDown':
    case ' ':
      return { type: 'scrollViewport', dir: 1 }
    case 'PageUp':
      return { type: 'scrollViewport', dir: -1 }
    case 'Home':
      return { type: 'scrollEdge', edge: 'top' }
    case 'End':
      return { type: 'scrollEdge', edge: 'bottom' }
    case 'ArrowDown':
      return focusInThumbs ? { type: 'stepPage', dir: 1 } : { type: 'scrollBy', delta: 60 }
    case 'ArrowUp':
      return focusInThumbs ? { type: 'stepPage', dir: -1 } : { type: 'scrollBy', delta: -60 }
    case 'ArrowRight':
      return { type: 'stepPage', dir: 1 }
    case 'ArrowLeft':
      return { type: 'stepPage', dir: -1 }
    default:
      return null
  }
}

/** the fields of a keydown the hand-tool judgement reads */
export interface HandToolKeyEvent {
  code: string
  key?: string
  isComposing?: boolean
  repeat?: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  shiftKey: boolean
  target: EventTarget | null
}

/**
 * Whether a keydown toggles the hand tool: a plain H, judged by the physical
 * key (`code`) so it works under a Korean or any other input method. The
 * caller has already left focused fields alone and skips the key while the
 * selection bar is up (there H means highlight). Ignored while an input method
 * composes, with a modifier, on a held-down repeat, and inside a dialog.
 */
export function isHandToolKey(e: HandToolKeyEvent): boolean {
  if (e.code !== 'KeyH') return false
  if (e.isComposing || e.key === 'Process') return false
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.repeat) return false
  const el = e.target as (Element & { closest?: (s: string) => Element | null }) | null
  return !el?.closest?.('[role="dialog"], [aria-modal="true"]')
}
