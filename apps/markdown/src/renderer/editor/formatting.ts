import type { Editor } from '@tiptap/core'
import type { StringKey } from '../i18n/locale'
import { uiOp, type BlockType, type ListKind, type StylableMark } from './ops'

export const BLOCK_STYLE_LABEL = {
  paragraph: 'styleParagraph',
  h1: 'styleH1',
  h2: 'styleH2',
  h3: 'styleH3',
  h4: 'styleH4',
  h5: 'styleH5',
  h6: 'styleH6',
  quote: 'styleQuote',
  codeBlock: 'styleCodeBlock',
} as const satisfies Record<string, StringKey>

export type BlockStyle = keyof typeof BLOCK_STYLE_LABEL
export const BLOCK_STYLES = Object.keys(BLOCK_STYLE_LABEL) as BlockStyle[]

export const INLINE_SHORTCUTS = {
  bold: 'Mod-b',
  italic: 'Mod-i',
  strike: 'Mod-Shift-x',
  highlight: 'Mod-Shift-m',
  code: 'Mod-Shift-e',
  link: 'Mod-k',
} as const

export const LIST_SHORTCUTS = {
  bullet: 'Mod-Shift-8',
  ordered: 'Mod-Shift-7',
  task: 'Mod-Shift-9',
} as const

export const QUOTE_SHORTCUT = 'Mod-Alt-q'
export const OPEN_SELECTION_LINK = 'markdown:open-selection-link'

export function blockStyleShortcut(style: BlockStyle): string {
  if (style === 'quote') return QUOTE_SHORTCUT
  if (style === 'codeBlock') return 'Mod-Alt-c'
  return `Mod-Alt-${style === 'paragraph' ? 0 : style.slice(1)}`
}

export function currentBlockStyle(editor: Editor): BlockStyle {
  if (editor.isActive('codeBlock')) return 'codeBlock'
  if (editor.isActive('blockquote')) return 'quote'
  if (editor.isActive('heading')) return `h${editor.getAttributes('heading').level}` as BlockStyle
  return 'paragraph'
}

export function applyBlockStyle(editor: Editor, style: BlockStyle): boolean {
  const type: BlockType =
    style === 'quote'
      ? 'blockquote'
      : style === 'paragraph' || style === 'codeBlock'
        ? style
        : 'heading'
  const level = type === 'heading' ? Number(style.slice(1)) : undefined
  return uiOp(editor, {
    op: 'setBlockType',
    target: 'selection',
    type,
    ...(level ? { level } : {}),
  })
}

export const toggleStyle = (editor: Editor | null, style: StylableMark) =>
  editor !== null && uiOp(editor, { op: 'setStyle', target: 'selection', style, mode: 'toggle' })

export const toggleList = (editor: Editor | null, list: ListKind) =>
  editor !== null && uiOp(editor, { op: 'toggleList', target: 'selection', list })
