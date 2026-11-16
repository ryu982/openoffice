import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { runOps, uiOp, type MdOp } from '../src/renderer/editor/ops'
import { aiMarks, clearAiHighlights } from '../src/renderer/editor/aiHighlight'
import { buildPrintHtml } from '../src/renderer/export/printHtml'

// the print builder inlines the KaTeX stylesheet through Vite's ?inline query
vi.mock('katex/dist/katex.min.css?inline', () => ({ default: '' }))

/**
 * The marks over what the AI changed: they outlive the run, count the blocks
 * they sit in, say when a change left nothing to mark, and never reach the
 * markdown, the clipboard serializer or the print/export clone.
 */

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
})

function createEditor(md: string): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: '',
  })
  editor.commands.setContent(md, { contentType: 'markdown' })
  editors.push(editor)
  return editor
}

const ai = (editor: Editor, ...ops: MdOp[]) => runOps(editor, ops, { source: 'ai' })
const marked = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll('.ai-changed-mark')].map((el) => el.textContent)

describe('AI change marks', () => {
  it('stay over every AI change until cleared, and count the blocks they sit in', () => {
    const editor = createEditor('one\n\ntwo\n\nthree')
    ai(editor, { op: 'replaceText', target: { start: 0 }, find: 'one', replace: 'ONE' })
    ai(editor, { op: 'replaceText', target: { start: 2 }, find: 'three', replace: 'THREE' })
    expect(marked(editor)).toEqual(['ONE', 'THREE'])
    expect(aiMarks(editor.state)).toEqual({ shown: true, blocks: 2, unmarked: false })

    // a person's edit elsewhere leaves them where they are
    uiOp(editor, { op: 'setStyle', target: { start: 1 }, style: 'bold' })
    expect(marked(editor)).toEqual(['ONE', 'THREE'])

    clearAiHighlights(editor)
    expect(marked(editor)).toEqual([])
    expect(aiMarks(editor.state)).toEqual({ shown: false, blocks: 0, unmarked: false })
  })

  it('note a deletion, which has nothing to mark, so the block count is not the whole run', () => {
    const editor = createEditor('keep\n\ndrop\n\nedit')
    ai(editor, { op: 'deleteBlocks', target: { start: 1 } })
    ai(editor, { op: 'replaceText', target: { start: 1 }, find: 'edit', replace: 'edited' })
    expect(marked(editor)).toEqual(['edited'])
    expect(aiMarks(editor.state)).toMatchObject({ shown: true, blocks: 1, unmarked: true })
    clearAiHighlights(editor)
    expect(aiMarks(editor.state).unmarked).toBe(false)
  })

  it('never reach the markdown or the print and export clone', () => {
    const editor = createEditor('**bold** text\n\nplain')
    ai(editor, { op: 'replaceText', target: { start: 0 }, find: 'text', replace: 'words' })
    ai(editor, { op: 'replaceText', target: { start: 1 }, find: 'plain', replace: 'new' })
    expect(marked(editor)).toEqual(['words', 'new'])
    expect(editor.getMarkdown()).not.toContain('ai-changed')
    expect(editor.getHTML()).not.toContain('ai-changed')

    const html = buildPrintHtml(editor.view.dom, 'note')
    expect(html).not.toContain('ai-changed')
    // the text the marks covered is printed, in its place
    const body = new DOMParser().parseFromString(html, 'text/html').body
    expect(body.querySelector('p')!.textContent).toBe('bold words')
    expect(body.querySelectorAll('p')[1]!.textContent).toBe('new')
    expect(body.querySelector('strong')!.textContent).toBe('bold')
  })
})
