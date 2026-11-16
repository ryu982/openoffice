import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { executeTool } from '../src/renderer/ai/tools'

// a 1x1 PNG, so the picture passes the format sniff
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const NUM_IDS = { bullet: null, ordered: null }

type DesktopStub = { desktop?: unknown }
const editors = new Set<Editor>()
let realImage: typeof Image
let savedDesktop: unknown

beforeEach(() => {
  // jsdom never decodes images: stand in for <img> with a fixed size
  realImage = globalThis.Image
  class FakeImage {
    naturalWidth = 4
    naturalHeight = 2
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_v: string) {
      queueMicrotask(() => this.onload?.())
    }
  }
  globalThis.Image = FakeImage as unknown as typeof Image
  const w = window as unknown as DesktopStub
  savedDesktop = w.desktop
  w.desktop = {
    aiGenerateImage: () => Promise.resolve({ url: 'file:///generated/a.png' }),
    fetchImage: () => Promise.resolve({ base64: PNG, mime: 'image/png' }),
  }
})

afterEach(() => {
  globalThis.Image = realImage
  ;(window as unknown as DesktopStub).desktop = savedDesktop
  for (const editor of editors) editor.destroy()
  editors.clear()
})

function createEditor(text: string): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'docParagraph',
          attrs: { docxIndex: null },
          content: text ? [{ type: 'text', text }] : [],
        },
      ],
    },
  })
  editors.add(editor)
  return editor
}

function pictures(editor: Editor): number {
  let n = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'docProtected' && node.attrs.blockType === 'image') n++
  })
  return n
}

function textOf(editor: Editor): string {
  return editor.state.doc.textContent
}

async function draw(editor: Editor, prompt: string) {
  return executeTool(editor, { id: prompt, name: 'generate_image', input: { prompt } }, NUM_IDS)
}

describe('an AI picture never replaces what is selected', () => {
  it('keeps the first picture when a second one is asked for right after it', async () => {
    const editor = createEditor('')
    expect((await draw(editor, 'a red apple')).isError).toBeFalsy()
    expect(pictures(editor)).toBe(1)
    // the picture just placed is left selected, as the editor does after an insert
    expect(editor.state.selection.empty).toBe(false)
    expect((await draw(editor, 'a blue circle')).isError).toBeFalsy()
    expect(pictures(editor)).toBe(2)
  })

  it('keeps text the user has selected and puts the picture after it', async () => {
    const editor = createEditor('keep this sentence')
    editor.commands.setTextSelection({ from: 1, to: 10 })
    expect((await draw(editor, 'a red apple')).isError).toBeFalsy()
    expect(pictures(editor)).toBe(1)
    expect(textOf(editor)).toContain('keep this sentence')
  })
})
