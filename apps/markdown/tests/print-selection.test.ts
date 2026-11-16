/**
 * Printing only the selection: the selected part of the note goes through the
 * same print HTML builder as the whole note, as a document of its own (so it is
 * paginated again from page 1). In source mode the selected characters print in
 * the same source form as the whole text.
 */
import { EditorSelection, EditorState } from '@codemirror/state'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { buildPrintHtml } from '../src/renderer/export/printHtml'
import {
  selectedSourceText,
  selectionPrintRoot,
  sourcePrintRoot,
} from '../src/renderer/print/print-content'

vi.mock('katex/dist/katex.min.css?inline', () => ({ default: '' }))

const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

function editorWith(content: string): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content,
  })
  editors.push(editor)
  return editor
}

/** Selects from the start of `from` to the end of `to`, both found in the document text. */
function select(editor: Editor, from: string, to: string): void {
  let start = -1
  let end = -1
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const text = node.text ?? ''
    if (start < 0 && text.includes(from)) start = pos + text.indexOf(from)
    if (text.includes(to)) end = pos + text.indexOf(to) + to.length
  })
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start, end)),
  )
}

/** The `<body>` of a print document. */
function body(html: string): string {
  return /<body>([\s\S]*)<\/body>/.exec(html)![1]!
}

describe('the selection print root', () => {
  it('is null without a selection', () => {
    const editor = editorWith('<p>Alpha</p>')
    expect(editor.state.selection.empty).toBe(true)
    expect(selectionPrintRoot(editor.view)).toBeNull()
  })

  it('prints only the selected text, across blocks, in the print HTML', () => {
    const editor = editorWith(
      '<h1>Title</h1><p>Alpha beta</p><p>Gamma <strong>delta</strong> epsilon</p><p>Omega</p>',
    )
    select(editor, 'beta', 'delta')
    const root = selectionPrintRoot(editor.view)!
    const html = buildPrintHtml(root, 'Notes')
    const printed = body(html)
    expect(printed).toContain('beta')
    expect(printed).toContain('Gamma')
    expect(printed).toContain('<strong>delta</strong>')
    for (const outside of ['Title', 'Alpha', 'epsilon', 'Omega']) {
      expect(printed, outside).not.toContain(outside)
    }
    // the same builder: the title and the print styles of the whole-note print
    expect(html).toContain('<title>Notes</title>')
    expect(html.split(/<body>/)[0]).toBe(
      buildPrintHtml(editor.view.dom, 'Notes').split(/<body>/)[0],
    )
  })

  it('keeps the block a selection inside one heading belongs to', () => {
    const editor = editorWith('<h2>Plan for spring</h2><p>body</p>')
    select(editor, 'for', 'for')
    const printed = body(buildPrintHtml(selectionPrintRoot(editor.view)!, 'x'))
    expect(printed).toMatch(/<h2[^>]*>for<\/h2>/)
    expect(printed).not.toContain('Plan')
    expect(printed).not.toContain('body')
  })

  it('keeps the list and table a selection lies in', () => {
    const editor = editorWith(
      '<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ul>' +
        '<table><tbody><tr><td><p>cell A</p></td><td><p>cell B</p></td></tr></tbody></table>',
    )
    select(editor, 'two', 'three')
    const list = body(buildPrintHtml(selectionPrintRoot(editor.view)!, 'x'))
    expect(list).toMatch(/<ul[^>]*>/)
    expect(list).toContain('two')
    expect(list).toContain('three')
    expect(list).not.toContain('one')

    select(editor, 'cell B', 'cell B')
    const table = body(buildPrintHtml(selectionPrintRoot(editor.view)!, 'x'))
    expect(table).toContain('<table')
    expect(table).toContain('cell B')
    expect(table).not.toContain('cell A')
  })

  it('is the whole note when everything is selected', () => {
    const editor = editorWith('<h1>Title</h1><p>Alpha</p>')
    editor.commands.selectAll()
    const printed = body(buildPrintHtml(selectionPrintRoot(editor.view)!, 'x'))
    expect(printed).toContain('Title')
    expect(printed).toContain('Alpha')
  })
})

describe('the source-mode selection', () => {
  it('is the selected characters, byte for byte, and empty without a selection', () => {
    const doc = 'line one\n  {"a": 1}\nline three'
    const none = EditorState.create({ doc })
    expect(selectedSourceText(none)).toBe('')
    const picked = EditorState.create({
      doc,
      selection: EditorSelection.single(5, 20),
    })
    expect(selectedSourceText(picked)).toBe(doc.slice(5, 20))
  })

  it('joins several selected ranges by lines', () => {
    const doc = 'alpha\nbeta\ngamma'
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create([
        EditorSelection.range(0, 5),
        EditorSelection.cursor(7),
        EditorSelection.range(11, 16),
      ]),
      extensions: EditorState.allowMultipleSelections.of(true),
    })
    expect(selectedSourceText(state)).toBe('alpha\ngamma')
  })

  it('prints in the same source form as the whole text', () => {
    const whole = sourcePrintRoot('a < b\n  c')
    expect(whole.outerHTML).toBe('<div><pre>a &lt; b\n  c</pre></div>')
    const html = buildPrintHtml(sourcePrintRoot('  c'), 'x')
    expect(body(html)).toBe('<pre>  c</pre>')
  })
})
