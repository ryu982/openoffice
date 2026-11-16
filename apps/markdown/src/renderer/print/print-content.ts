import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@tiptap/pm/view'

/**
 * What the print HTML builder (`buildPrintHtml`) is given: the whole note, or
 * only its selection. The selection becomes a document of its own, so the
 * printer paginates it again from page 1 with the same print styles.
 */

/** Source mode prints the text as it is, in one preformatted block. */
export function sourcePrintRoot(text: string): HTMLElement {
  const root = document.createElement('div')
  const pre = document.createElement('pre')
  pre.textContent = text
  root.appendChild(pre)
  return root
}

/** The selected characters of the source editor; several ranges go one per line. */
export function selectedSourceText(state: EditorState): string {
  return state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => state.sliceDoc(range.from, range.to))
    .join('\n')
}

/**
 * The part of the rendered note the ProseMirror selection covers, or null
 * without one. It is cut from the editor's own DOM, so math, diagrams and
 * pictures print as they are drawn; the blocks the selection lies in (heading,
 * list, table) are kept around it so it prints with their styles.
 */
export function selectionPrintRoot(view: EditorView): HTMLElement | null {
  const { selection } = view.state
  if (selection.empty || selection.content().content.size === 0) return null
  const start = view.domAtPos(selection.from)
  const end = view.domAtPos(selection.to)
  const range = view.dom.ownerDocument.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  let part: Node = range.cloneContents()
  // cloneContents keeps the elements below the common ancestor; the ones from
  // there up to the editor root are put back empty, around the cut
  for (
    let node: Node | null = range.commonAncestorContainer;
    node && node !== view.dom;
    node = node.parentNode
  ) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const shell = node.cloneNode(false)
    shell.appendChild(part)
    part = shell
  }
  const root = view.dom.ownerDocument.createElement('div')
  root.appendChild(part)
  return root
}
