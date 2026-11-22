import { Extension } from '@tiptap/core'
import {
  applyBlockStyle,
  blockStyleShortcut,
  INLINE_SHORTCUTS,
  OPEN_SELECTION_LINK,
  QUOTE_SHORTCUT,
  toggleStyle,
} from './formatting'
import { moveSelectedBlocks, uiOp } from './ops'

/**
 * SecondBrain-parity block shortcuts: ⌘D duplicate, ⌘⇧⌫ delete,
 * ⌘⇧↑/↓ move the current top-level block, ⌘K link.
 */
export const BlockKeymap = Extension.create({
  name: 'blockKeymap',

  addKeyboardShortcuts() {
    return {
      [INLINE_SHORTCUTS.strike]: () => this.editor.isEditable && toggleStyle(this.editor, 'strike'),
      [INLINE_SHORTCUTS.highlight]: () =>
        this.editor.isEditable && toggleStyle(this.editor, 'highlight'),
      [INLINE_SHORTCUTS.code]: () => this.editor.isEditable && toggleStyle(this.editor, 'code'),
      [QUOTE_SHORTCUT]: () => this.editor.isEditable && applyBlockStyle(this.editor, 'quote'),
      [blockStyleShortcut('paragraph')]: () =>
        this.editor.isEditable && applyBlockStyle(this.editor, 'paragraph'),
      'Mod-d': () => uiOp(this.editor, { op: 'duplicateBlocks', target: 'selection' }),
      'Mod-D': () => uiOp(this.editor, { op: 'duplicateBlocks', target: 'selection' }),
      'Mod-Shift-Backspace': () => uiOp(this.editor, { op: 'deleteBlocks', target: 'selection' }),
      'Mod-Shift-ArrowUp': () => moveSelectedBlocks(this.editor, -1),
      'Mod-Shift-ArrowDown': () => moveSelectedBlocks(this.editor, 1),
      [INLINE_SHORTCUTS.link]: () => {
        const editor = this.editor
        if (!editor.isEditable) return false
        if (!editor.view.dom.dispatchEvent(new Event(OPEN_SELECTION_LINK, { cancelable: true }))) {
          return true
        }
        if (editor.isActive('link')) {
          return uiOp(editor, { op: 'setLink', target: 'selection', href: null })
        }
        const href = window.prompt('URL:')
        if (!href?.trim()) return true
        return uiOp(editor, { op: 'setLink', target: 'selection', href: href.trim() })
      },
    }
  },
})
