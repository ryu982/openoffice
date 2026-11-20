import { describe, expect, it, vi } from 'vitest'
import {
  ieumInsertAtSubmodeCaret,
  ieumNoteBeforeEdit,
  ieumNoteCopy,
  ieumNoteCut,
  ieumNoteKey,
  ieumNotePaste,
  noteRangeText,
  replaceNoteRange,
} from '../studio-plugin/note-text.mjs'

interface Place {
  fnParaIdx: number
  charOffset: number
}

const chars = (text: string) => Array.from(text)

/** A note's paragraphs behind the engine's note calls, counting code points as the engine does. */
/**
 * `numbered`: the first paragraph starts with the note's number (two places, as a note the editor
 * inserts); the engine reports the slot and where the text starts. Without it the note has no
 * number slot and is text from its first place.
 */
function fakeWasm(paragraphs: string[], numbered = false) {
  const paras = [...paragraphs]
  return {
    paras,
    getFootnoteInfo: () => ({
      ok: true,
      paraCount: paras.length,
      numberSlot: numbered ? 0 : -1,
      texts: [...paras],
    }),
    getNoteEditInfo: () => ({ ok: true, kind: 'footnote', fnParaIndex: 0, charOffset: 2 }),
    insertTextInFootnote: (
      _s: number,
      _p: number,
      _c: number,
      i: number,
      at: number,
      text: string,
    ) => {
      const c = chars(paras[i]!)
      paras[i] = [...c.slice(0, at), text, ...c.slice(at)].join('')
      return { ok: true, charOffset: at + chars(text).length }
    },
    deleteTextInFootnote: (
      _s: number,
      _p: number,
      _c: number,
      i: number,
      at: number,
      n: number,
    ) => {
      const c = chars(paras[i]!)
      const deletedText = c.slice(at, at + n).join('')
      paras[i] = [...c.slice(0, at), ...c.slice(at + n)].join('')
      return { ok: true, charOffset: at, deletedText }
    },
    splitParagraphInFootnote: (_s: number, _p: number, _c: number, i: number, at: number) => {
      const c = chars(paras[i]!)
      paras.splice(i, 1, c.slice(0, at).join(''), c.slice(at).join(''))
      return { ok: true, fnParaIndex: i + 1, charOffset: 0 }
    },
    mergeParagraphInFootnote: (_s: number, _p: number, _c: number, i: number) => {
      const offset = chars(paras[i - 1]!).length
      paras.splice(i - 1, 2, paras[i - 1]! + paras[i]!)
      return { ok: true, fnParaIndex: i - 1, charOffset: offset }
    },
  }
}

type Wasm = ReturnType<typeof fakeWasm>

interface Options {
  caret?: Place
  anchor?: Place | null
  mode?: 'footnote' | 'header' | 'body'
  form?: boolean
}

/** The studio's input handler as the module sees it: its cursor, engine bridge and history. */
function fakeHandler(wasm: Wasm, options: Options = {}) {
  const mode = options.mode ?? 'footnote'
  let caret = options.caret ?? { fnParaIdx: 0, charOffset: 0 }
  let anchor = options.anchor ?? null
  const steps: Array<{ operationType: string; editContext: unknown; after: unknown }> = []
  const cursor = {
    isInFootnote: () => mode === 'footnote',
    isInHeaderFooter: () => mode === 'header',
    fnSectionIdx: 0,
    fnParaIdx: 3,
    fnControlIdx: 1,
    fnFootnoteIndex: 0,
    fnPageNum: 0,
    get fnInnerParaIdx() {
      return caret.fnParaIdx
    },
    get fnCharOffset() {
      return caret.charOffset
    },
    getFootnoteSelectionOrdered: () => {
      if (!anchor) return null
      const before =
        anchor.fnParaIdx < caret.fnParaIdx ||
        (anchor.fnParaIdx === caret.fnParaIdx && anchor.charOffset <= caret.charOffset)
      return before ? { start: anchor, end: caret } : { start: caret, end: anchor }
    },
    clearSelection: () => {
      anchor = null
    },
    getPosition: () => ({ sectionIndex: 0, paragraphIndex: 3, charOffset: 7 }),
  }
  return {
    cursor,
    wasm,
    steps,
    isFormMode: () => options.form === true,
    replaceHeaderFooterSelection: vi.fn(() => true),
    executeOperation(desc: {
      operationType: string
      editContext: unknown
      editContextAfter: () => { innerParaIdx: number; charOffset: number }
      operation: (w: Wasm) => unknown
    }) {
      desc.operation(wasm)
      const after = desc.editContextAfter()
      steps.push({ operationType: desc.operationType, editContext: desc.editContext, after })
      caret = { fnParaIdx: after.innerParaIdx, charOffset: after.charOffset }
    },
  }
}

function clipboardEvent(data: Record<string, string>) {
  const written: Record<string, string> = {}
  return {
    written,
    event: {
      preventDefault: vi.fn(),
      clipboardData: {
        getData: (type: string) => data[type] ?? '',
        setData: (type: string, value: string) => {
          written[type] = value
        },
      },
    },
  }
}

describe('pasting into a note', () => {
  it('puts the text at the note caret, a note paragraph per line, as one step', () => {
    const wasm = fakeWasm(['see '])
    const handler = fakeHandler(wasm, { caret: { fnParaIdx: 0, charOffset: 4 } })
    const { event } = clipboardEvent({ 'text/plain': 'Act 1\r\nAct 2' })
    expect(ieumNotePaste(handler, event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(wasm.paras).toEqual(['see Act 1', 'Act 2'])
    expect(handler.steps).toHaveLength(1)
    expect(handler.steps[0]).toMatchObject({
      operationType: 'pasteInFootnote',
      editContext: { mode: 'footnote', paraIdx: 3, controlIdx: 1, innerParaIdx: 0, charOffset: 4 },
      after: { mode: 'footnote', innerParaIdx: 1, charOffset: 5 },
    })
  })

  it('takes the plain text of a rich clipboard', () => {
    const wasm = fakeWasm([''])
    const handler = fakeHandler(wasm)
    const { event } = clipboardEvent({
      'text/plain': '「법」 제1조',
      'text/html': '<b>「법」 제1조</b>',
    })
    ieumNotePaste(handler, event)
    expect(wasm.paras).toEqual(['「법」 제1조'])
  })

  it('replaces a selection that spans note paragraphs', () => {
    const wasm = fakeWasm(['one two', 'three', 'four five'])
    const handler = fakeHandler(wasm, {
      anchor: { fnParaIdx: 0, charOffset: 4 },
      caret: { fnParaIdx: 2, charOffset: 4 },
    })
    const { event } = clipboardEvent({ 'text/plain': 'X' })
    ieumNotePaste(handler, event)
    expect(wasm.paras).toEqual(['one X five'])
    expect(handler.steps[0]!.after).toMatchObject({ innerParaIdx: 0, charOffset: 5 })
  })

  it('counts a character outside the basic plane as one, as the engine does', () => {
    const wasm = fakeWasm(['a😀b'])
    const handler = fakeHandler(wasm, {
      anchor: { fnParaIdx: 0, charOffset: 1 },
      caret: { fnParaIdx: 0, charOffset: 2 },
    })
    const { event } = clipboardEvent({ 'text/plain': '𝐱y' })
    ieumNotePaste(handler, event)
    expect(wasm.paras).toEqual(['a𝐱yb'])
    expect(handler.steps[0]!.after).toMatchObject({ charOffset: 3 })
  })

  it('leaves a paste outside a note, and in a form, to the studio', () => {
    const { event } = clipboardEvent({ 'text/plain': 'x' })
    expect(ieumNotePaste(fakeHandler(fakeWasm(['']), { mode: 'body' }), event)).toBe(false)
    expect(ieumNotePaste(fakeHandler(fakeWasm(['']), { form: true }), event)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('records nothing for an empty clipboard with nothing selected', () => {
    const wasm = fakeWasm(['abc'])
    const handler = fakeHandler(wasm)
    const { event } = clipboardEvent({})
    expect(ieumNotePaste(handler, event)).toBe(true)
    expect(handler.steps).toEqual([])
    expect(wasm.paras).toEqual(['abc'])
  })
})

describe('copying and cutting in a note', () => {
  it('copies the selected note text, a line per paragraph', () => {
    const wasm = fakeWasm(['one two', 'three', 'four five'])
    const handler = fakeHandler(wasm, {
      anchor: { fnParaIdx: 2, charOffset: 4 },
      caret: { fnParaIdx: 0, charOffset: 4 },
    })
    const { event, written } = clipboardEvent({})
    expect(ieumNoteCopy(handler, event)).toBe(true)
    expect(written['text/plain']).toBe('two\nthree\nfour')
    expect(wasm.paras).toEqual(['one two', 'three', 'four five'])
  })

  it('leaves copy to the studio when nothing in a note is selected', () => {
    const { event } = clipboardEvent({})
    expect(ieumNoteCopy(fakeHandler(fakeWasm(['abc'])), event)).toBe(false)
    expect(ieumNoteCopy(fakeHandler(fakeWasm(['abc']), { mode: 'body' }), event)).toBe(false)
  })

  it('cuts: copies the selection and takes it out in one step', () => {
    const wasm = fakeWasm(['「법」 제1조'])
    const handler = fakeHandler(wasm, {
      anchor: { fnParaIdx: 0, charOffset: 0 },
      caret: { fnParaIdx: 0, charOffset: 3 },
    })
    const { event, written } = clipboardEvent({})
    expect(ieumNoteCut(handler, event)).toBe(true)
    expect(written['text/plain']).toBe('「법」')
    expect(wasm.paras).toEqual([' 제1조'])
    expect(handler.steps.map((step) => step.operationType)).toEqual(['cutInFootnote'])
  })

  it('cuts nothing out of the body when nothing in the note is selected', () => {
    const wasm = fakeWasm(['abc'])
    const handler = fakeHandler(wasm)
    const { event } = clipboardEvent({})
    expect(ieumNoteCut(handler, event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(handler.steps).toEqual([])
  })
})

describe('문자표 while a note, header or footer is open', () => {
  it('puts the symbol at the note caret', () => {
    const wasm = fakeWasm(['ab'])
    const handler = fakeHandler(wasm, { caret: { fnParaIdx: 0, charOffset: 1 } })
    expect(ieumInsertAtSubmodeCaret(handler, '「')).toBe(true)
    expect(wasm.paras).toEqual(['a「b'])
    expect(handler.steps[0]!.after).toMatchObject({ innerParaIdx: 0, charOffset: 2 })
  })

  it("hands it to the studio's header and footer replace", () => {
    const handler = fakeHandler(fakeWasm(['']), { mode: 'header' })
    expect(ieumInsertAtSubmodeCaret(handler, '」')).toBe(true)
    expect(handler.replaceHeaderFooterSelection).toHaveBeenCalledWith('」', {
      operationType: 'insertSymbolInHeaderFooter',
      allowCollapsed: true,
    })
  })

  it('leaves the body to the dialog', () => {
    expect(ieumInsertAtSubmodeCaret(fakeHandler(fakeWasm(['']), { mode: 'body' }), '「')).toBe(
      false,
    )
  })
})

describe('typing and keys in a note', () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...mods,
  })

  it('drops the anchor a click left, so typed text never reads as selected', () => {
    // a click at offset 2, then "ZZ" typed: the studio's anchor stays at 2, the caret at 4
    const wasm = fakeWasm(['seZZe'])
    const handler = fakeHandler(wasm, {
      anchor: { fnParaIdx: 0, charOffset: 2 },
      caret: { fnParaIdx: 0, charOffset: 2 },
    })
    ieumNoteBeforeEdit(handler)
    expect(handler.cursor.getFootnoteSelectionOrdered()).toBeNull()
    expect(handler.steps).toEqual([])
  })

  it('takes a selection out before typed text goes in', () => {
    const wasm = fakeWasm(['one two'])
    const handler = fakeHandler(wasm, {
      anchor: { fnParaIdx: 0, charOffset: 0 },
      caret: { fnParaIdx: 0, charOffset: 4 },
    })
    ieumNoteBeforeEdit(handler)
    expect(wasm.paras).toEqual(['two'])
    expect(handler.steps[0]).toMatchObject({
      operationType: 'deleteSelectionInFootnote',
      after: { innerParaIdx: 0, charOffset: 0 },
    })
  })

  it('Backspace and Delete take a selection out, as one step, instead of one character', () => {
    for (const k of ['Backspace', 'Delete']) {
      const wasm = fakeWasm(['abc', 'def'])
      const handler = fakeHandler(wasm, {
        anchor: { fnParaIdx: 0, charOffset: 1 },
        caret: { fnParaIdx: 1, charOffset: 1 },
      })
      const event = key(k)
      expect(ieumNoteKey(handler, event)).toBe(true)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(wasm.paras).toEqual(['aef'])
    }
  })

  it('leaves Backspace with nothing selected to the studio', () => {
    const handler = fakeHandler(fakeWasm(['abc']), {
      anchor: { fnParaIdx: 0, charOffset: 1 },
      caret: { fnParaIdx: 0, charOffset: 1 },
    })
    expect(ieumNoteKey(handler, key('Backspace'))).toBe(false)
    expect(handler.cursor.getFootnoteSelectionOrdered()).toBeNull()
  })

  it('a caret move leaves the selection; shortcuts keep it for copy and paste', () => {
    const select = () =>
      fakeHandler(fakeWasm(['abc']), {
        anchor: { fnParaIdx: 0, charOffset: 0 },
        caret: { fnParaIdx: 0, charOffset: 2 },
      })
    const moved = select()
    expect(ieumNoteKey(moved, key('ArrowLeft'))).toBe(false)
    expect(moved.cursor.getFootnoteSelectionOrdered()).toBeNull()
    const copied = select()
    expect(ieumNoteKey(copied, key('c', { ctrlKey: true }))).toBe(false)
    expect(copied.cursor.getFootnoteSelectionOrdered()).not.toBeNull()
  })

  it('does nothing outside a note', () => {
    const handler = fakeHandler(fakeWasm(['abc']), {
      mode: 'body',
      anchor: { fnParaIdx: 0, charOffset: 0 },
      caret: { fnParaIdx: 0, charOffset: 2 },
    })
    expect(ieumNoteKey(handler, key('Backspace'))).toBe(false)
    ieumNoteBeforeEdit(handler)
    expect(handler.steps).toEqual([])
  })
})

describe("a note's number at the head of its first paragraph", () => {
  // what the editor holds for a new note "1) see more": two places of number, then the text
  const numbered = () => fakeWasm(['  see more', 'next'], true)

  it('a paste over the whole first paragraph (a triple click selects from 0) keeps the number', () => {
    const wasm = numbered()
    const handler = fakeHandler(wasm, {
      anchor: { fnParaIdx: 0, charOffset: 0 },
      caret: { fnParaIdx: 0, charOffset: 10 },
    })
    ieumNotePaste(handler, clipboardEvent({ 'text/plain': '「법」' }).event)
    expect(wasm.paras).toEqual(['  「법」', 'next'])
    expect(handler.steps[0]!.after).toMatchObject({ innerParaIdx: 0, charOffset: 5 })
  })

  it('copy and cut leave the number out', () => {
    const wasm = numbered()
    const handler = fakeHandler(wasm, {
      anchor: { fnParaIdx: 0, charOffset: 1 },
      caret: { fnParaIdx: 1, charOffset: 2 },
    })
    const { event, written } = clipboardEvent({})
    expect(ieumNoteCut(handler, event)).toBe(true)
    expect(written['text/plain']).toBe('see more\nne')
    expect(wasm.paras).toEqual(['  xt'])
  })

  it('typing over a selection of the number alone takes nothing out', () => {
    const wasm = numbered()
    const handler = fakeHandler(wasm, {
      anchor: { fnParaIdx: 0, charOffset: 0 },
      caret: { fnParaIdx: 0, charOffset: 2 },
    })
    ieumNoteBeforeEdit(handler)
    expect(wasm.paras).toEqual(['  see more', 'next'])
    expect(handler.steps).toEqual([])
    expect(handler.cursor.getFootnoteSelectionOrdered()).toBeNull()
  })

  it('a paste with the caret in the number goes in after it', () => {
    const wasm = numbered()
    const handler = fakeHandler(wasm, { caret: { fnParaIdx: 0, charOffset: 0 } })
    ieumNotePaste(handler, clipboardEvent({ 'text/plain': 'X' }).event)
    expect(wasm.paras).toEqual(['  Xsee more', 'next'])
  })

  it('a note without a number slot is text from its first place', () => {
    const wasm = fakeWasm(['23) typed'], false)
    const handler = fakeHandler(wasm, {
      anchor: { fnParaIdx: 0, charOffset: 0 },
      caret: { fnParaIdx: 0, charOffset: 3 },
    })
    const { event, written } = clipboardEvent({})
    ieumNoteCopy(handler, event)
    expect(written['text/plain']).toBe('23)')
  })
})

describe('noteRangeText', () => {
  it('reads one paragraph or several', () => {
    const paras = ['abc', 'def', 'ghi']
    const at = (fnParaIdx: number, charOffset: number) => ({ fnParaIdx, charOffset })
    expect(noteRangeText(paras, at(0, 1), at(0, 2))).toBe('b')
    expect(noteRangeText(paras, at(0, 2), at(2, 1))).toBe('c\ndef\ng')
  })

  it('replaceNoteRange with an empty range only inserts', () => {
    const wasm = fakeWasm(['ab'])
    const place = replaceNoteRange(
      wasm,
      { sectionIdx: 0, paraIdx: 0, controlIdx: 0 },
      { fnParaIdx: 0, charOffset: 1 },
      { fnParaIdx: 0, charOffset: 1 },
      'x\n',
    )
    expect(wasm.paras).toEqual(['ax', 'b'])
    expect(place).toEqual({ fnParaIdx: 1, charOffset: 0 })
  })
})
