/**
 * The marks of the last AI run (the `aiChanged` attr of its blocks) and the
 * changes card of the Word AI panel: the marks stay after the run, taking
 * them off is no edit and no undo step, and they never reach the saved file,
 * the HTML export or the clipboard. The card's state follows the run's
 * roll-back point.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Editor } from '@tiptap/core'
import { undoDepth } from '@tiptap/pm/history'
import type { Transaction } from '@tiptap/pm/state'
import { DOMSerializer, type Slice } from '@tiptap/pm/model'
import { parseDocx } from '@genoffice/docx-engine'
import { describe, expect, it, vi } from 'vitest'
import { buildDocx } from '../../../packages/docx-engine/tests/helpers/build-docx'
import { blocksToPmDoc, pmDocToSavePlan, type PmNode } from '../src/renderer/editor/convert'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { TRACK_IGNORE } from '../src/renderer/editor/revisions'
import { buildStandaloneHtml } from '../src/renderer/html-export'
import {
  afterRollback,
  clearAiMarksTransaction,
  countAiMarkedBlocks,
  docWithoutAiMarks,
  hasLaterAppliedRun,
  isAiMarksClear,
  runChangesState,
  sliceWithoutAiMarks,
} from '../src/renderer/ai/run-changes'

const para = (text: string, aiChanged = false) => ({
  type: 'docParagraph',
  attrs: { aiChanged },
  content: [{ type: 'text', text }],
})

function editorOf(content: unknown[], editorProps: Record<string, unknown> = {}): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: { type: 'doc', content } as never,
    editorProps,
  })
}

/** what an AI edit does to block `index`: new text, and the mark on it (one undo step) */
function aiEdit(editor: Editor, index: number, text: string): void {
  let pos = 0
  for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize
  const block = editor.state.doc.child(index)
  const tr = editor.state.tr.insertText(text, pos + 1, pos + 1 + block.content.size)
  tr.setNodeMarkup(pos, undefined, { ...block.attrs, aiChanged: true })
  editor.view.dispatch(tr)
}

const texts = (editor: Editor) => editor.state.doc.content.content.map((n) => n.textContent)

describe('the marks of the last AI run', () => {
  it('counts the blocks a run marked', () => {
    const editor = editorOf([para('one', true), para('two'), para('three', true)])
    expect(countAiMarkedBlocks(editor.state.doc)).toBe(2)
    editor.destroy()
  })

  it('takes the marks off without an undo step, a tracked revision or an edit', () => {
    const editor = editorOf([para('one'), para('two')])
    aiEdit(editor, 1, 'changed')
    const depth = undoDepth(editor.state)
    expect(countAiMarkedBlocks(editor.state.doc)).toBe(1)
    const seen: Transaction[] = []
    editor.on('update', ({ transaction }) => seen.push(transaction))

    const tr = clearAiMarksTransaction(editor.view.state)!
    expect(tr.getMeta('addToHistory')).toBe(false)
    expect(tr.getMeta(TRACK_IGNORE)).toBe(true)
    editor.view.dispatch(tr)

    expect(countAiMarkedBlocks(editor.state.doc)).toBe(0)
    expect(undoDepth(editor.state)).toBe(depth)
    // the app's update handler sees it and does not count it as an edit
    expect(seen).toHaveLength(1)
    expect(isAiMarksClear(seen[0]!)).toBe(true)
    // undo still takes the AI's edit back, and leaves no mark behind
    editor.commands.undo()
    expect(texts(editor)).toEqual(['one', 'two'])
    expect(countAiMarkedBlocks(editor.state.doc)).toBe(0)
    editor.destroy()
  })

  it('has nothing to dispatch when no block carries a mark', () => {
    const editor = editorOf([para('one')])
    expect(clearAiMarksTransaction(editor.view.state)).toBeNull()
    editor.destroy()
  })

  it('keeps the marks off the saved file', async () => {
    const parsed = await parseDocx(
      await buildDocx({
        bodyXml:
          '<w:p><w:r><w:t>Alpha</w:t></w:r></w:p><w:p><w:r><w:t>Beta</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Gamma</w:t></w:r></w:p>',
      }),
    )
    const marked = editorOf(blocksToPmDoc(parsed.blocks).content as unknown[])
    aiEdit(marked, 1, 'Beta, rewritten')
    // a block the run only marked, its text the same
    const first = marked.state.doc.child(0)
    marked.view.dispatch(
      marked.state.tr.setNodeMarkup(0, undefined, { ...first.attrs, aiChanged: true }),
    )
    expect(countAiMarkedBlocks(marked.state.doc)).toBe(2)
    const plain = editorOf(marked.getJSON().content as unknown[])
    plain.view.dispatch(clearAiMarksTransaction(plain.view.state)!)

    const markedPlan = pmDocToSavePlan(marked.getJSON() as PmNode, parsed.blocks)
    const plainPlan = pmDocToSavePlan(plain.getJSON() as PmNode, parsed.blocks)
    expect(JSON.stringify(markedPlan.saveBlocks)).toBe(JSON.stringify(plainPlan.saveBlocks))
    expect(JSON.stringify(markedPlan.saveBlocks)).not.toContain('aiChanged')
    // after the save the reloaded file equals the marked document: no rewrite, the undo
    // history and the marks stay
    const reloaded = marked.schema.nodeFromJSON(plain.getJSON())
    expect(marked.state.doc.eq(reloaded)).toBe(false)
    expect(docWithoutAiMarks(marked.state.doc).eq(reloaded)).toBe(true)
    expect(docWithoutAiMarks(plain.state.doc)).toBe(plain.state.doc)
    marked.destroy()
    plain.destroy()
  })

  it('copies the blocks without their marks', () => {
    const editor = editorOf([para('one', true), para('two', true)], {
      transformCopied: sliceWithoutAiMarks,
    })
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size)
    expect(countAiMarkedBlocks(sliceWithoutAiMarks(slice).content as never)).toBe(0)
    // what the view's copy puts on the clipboard: the slice after transformCopied, as HTML
    const copied =
      editor.view.someProp('transformCopied', (f: (s: Slice, v: typeof editor.view) => Slice) =>
        f(slice, editor.view),
      ) ?? slice
    const dom = document.createElement('div')
    dom.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(copied.content))
    expect(dom.innerHTML).toContain('two')
    expect(dom.innerHTML).not.toContain('ai-changed')
    // the same slice without the prop would carry them
    const raw = document.createElement('div')
    raw.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content))
    expect(raw.innerHTML).toContain('ai-changed')
    editor.destroy()
  })

  it('lifts .ai-marks while the HTML export reads the computed styles', () => {
    const wrapper = document.createElement('div')
    wrapper.className = 'doc-zoom ai-marks'
    const root = document.createElement('div')
    root.className = 'doc-page ProseMirror'
    root.innerHTML = '<p class="doc-p ai-changed">Changed</p>'
    wrapper.appendChild(root)
    document.body.appendChild(wrapper)
    const real = window.getComputedStyle.bind(window)
    const markedWhileRead: boolean[] = []
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      markedWhileRead.push(wrapper.classList.contains('ai-marks'))
      return real(el, pseudo)
    })
    try {
      const out = buildStandaloneHtml(root, { title: 'T' })
      expect(out).toContain('Changed')
      expect(out).not.toContain('ai-changed')
    } finally {
      spy.mockRestore()
      wrapper.remove()
    }
    expect(markedWhileRead.length).toBeGreaterThan(0)
    expect(markedWhileRead.every((shown) => !shown)).toBe(true)
    expect(wrapper.classList.contains('ai-marks')).toBe(true)
  })
})

describe('the changes card of a run', () => {
  const snap = {}

  it('is expired once the roll-back point was released', () => {
    expect(runChangesState({ state: 'applied', count: 2 }, snap)).toBe('applied')
    expect(runChangesState({ state: 'applied' }, undefined)).toBe('expired')
    expect(runChangesState({ state: 'reverted' }, undefined)).toBe('reverted')
  })

  it('tells that rolling back an older run takes the later ones too, and marks them taken back', () => {
    const chat = [
      { role: 'user' },
      { role: 'assistant', changes: { state: 'applied' as const }, snapshot: snap },
      { role: 'user' },
      { role: 'assistant' },
      { role: 'user' },
      { role: 'assistant', changes: { state: 'applied' as const }, snapshot: snap },
    ]
    expect(hasLaterAppliedRun(chat, 1)).toBe(true)
    expect(hasLaterAppliedRun(chat, 5)).toBe(false)

    const after = afterRollback(chat, 1)
    expect(after.map((e) => e.changes?.state)).toEqual([
      undefined,
      'reverted',
      undefined,
      undefined,
      undefined,
      'reverted',
    ])
    expect(after.every((e) => e.snapshot === undefined)).toBe(true)
    // rolling back the newest leaves the older one as it was
    const newest = afterRollback(chat, 5)
    expect(newest[1]).toBe(chat[1])
    expect(newest[5]!.changes!.state).toBe('reverted')
  })
})

describe('the card in the Word AI panel', () => {
  const read = (rel: string) =>
    readFileSync(join(__dirname, '..', rel), 'utf8')
      .replace(/\r\n/g, '\n')
      .replace(/\s+/g, ' ')
  const panel = read('src/renderer/ai/AiPanel.tsx')

  it('keeps the marks after the run instead of taking them off in the same tick', () => {
    expect(panel).not.toContain('clearAiHighlights(true)')
    expect(panel).toContain('const runChanges = takeRunChanges()')
    // a new run and a new chat start without them
    expect(panel).toContain('runUsageRef.current = undefined dropRunMarks()')
    expect(panel).toContain('sentAttachmentsRef.current = [] dropRunMarks() }')
  })

  it('shows the shared card under the reply and no roll-back button in the toolbar', () => {
    expect(panel).toContain(
      '<AiChangesCard lang={lang} state={runChangesState(entry.changes, entry.snapshot)}',
    )
    expect(panel).toContain('onClearMarks={marksShown && i === lastChangesIdx ? clearMarks : null}')
    expect(panel).not.toContain('RollbackButton')
    expect(panel).not.toContain('ai-rollback')
  })

  it('does not count taking the marks off as an edit, and copies without them', () => {
    const app = read('src/renderer/App.tsx')
    expect(app).toContain('if (!isAiMarksClear(transaction)) dirtyRef.current = true')
    expect(app).toContain('transformCopied: sliceWithoutAiMarks,')
    expect(read('src/renderer/file-actions.ts')).toContain(
      'unchanged = docWithoutAiMarks(editor.state.doc).eq(editor.schema.nodeFromJSON(rebasedPm))',
    )
    expect(app).toContain(
      "'doc-zoom', // the AI's marks show here, and the HTML export lifts the class to leave them out 'ai-marks',",
    )
  })

  it('draws the marks on screen only, in the shared look, with no stripe at the side', () => {
    const css = read('src/renderer/styles.css')
    expect(css).toContain(
      '@media screen { .ai-marks .doc-page .ai-changed { border-radius: 2px; background: var(--color-ai-changed-bg); box-shadow: inset 0 -2px 0 var(--color-ai-changed-line); } }',
    )
    expect(css).not.toContain('--ai-highlight')
  })
})
