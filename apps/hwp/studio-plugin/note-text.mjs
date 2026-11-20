/**
 * Clipboard and 문자표 in a footnote or endnote being edited.
 *
 * While a note is open, the studio keeps the body caret where it was when the note opened and
 * tracks the note's own place apart (fnInnerParaIdx, fnCharOffset). Typing and Enter know that;
 * its paste, copy and cut and the 문자표 dialog do not. A paste went into the body at the note's
 * mark, Ctrl+C and Ctrl+X saw no selection, and 문자표 put the symbol into the body too
 * (2026-11-17 feedback: "각주에 복사 붙여넣기가 안 되고 「」 기호가 입력되지 않는다"). The
 * studio's note keys also let only undo, redo, go-to and select-all through, so Ctrl+F10 did
 * nothing at all there.
 *
 * Here a paste into a note goes in as plain text, a line per note paragraph, in place of the
 * note's selection; the rich parts of the clipboard (tables, pictures, a Hangul document model)
 * have no place in a note's text. Copy and cut take the note's selected text. A 문자표 symbol goes
 * in at the note's caret, or the header's or footer's, through the same calls. Each change is
 * one undo step that brings the caret back into the note.
 *
 * A click in a note leaves a selection anchor the studio never clears, so text typed after the
 * click read as selected and the next paste replaced it. Typing, composing and the note's keys
 * ask here first: a real selection is taken out (typing replaces it, Backspace and Delete remove
 * it, a caret move leaves it) and an empty anchor is dropped.
 *
 * The engine calls are the studio's own note calls (insertTextInFootnote and the like); nothing
 * is written that typing into the note would not write.
 */

/** Module specifier the studio-note-* and studio-submode-symbols patches import; build-studio.mjs aliases it. */
export const NOTE_TEXT_MODULE = '@ieum/note-text'

/** Characters the engine counts: one per code point. */
function charCount(text) {
  return Array.from(text).length
}

function sliceChars(text, from, to) {
  return Array.from(text).slice(from, to).join('')
}

/** The note being edited, as the studio's note commands name it. */
function noteTarget(cursor) {
  return {
    sectionIdx: cursor.fnSectionIdx,
    paraIdx: cursor.fnParaIdx,
    controlIdx: cursor.fnControlIdx,
    footnoteIndex: cursor.fnFootnoteIndex,
    pageNum: cursor.fnPageNum,
  }
}

function noteContext(target, place) {
  return {
    mode: 'footnote',
    ...target,
    innerParaIdx: place.fnParaIdx,
    charOffset: place.charOffset,
  }
}

function inNote(handler) {
  try {
    return handler?.cursor?.isInFootnote?.() === true && handler.isFormMode?.() !== true
  } catch {
    return false
  }
}

/** The number and the space after it at the head of a note's first paragraph. */
const NOTE_NUMBER_CHARS = 2

/**
 * Where the text of the note's first paragraph starts. The places before it hold the note's
 * automatic number; they are not text, and taking them out loses the number. A note without a
 * number slot (its number typed as text by a document generator) is text from its first place.
 * The AI's note tools read the note the same way (agent-plugin.mjs, notesOf).
 */
function noteTextStart(wasm, target) {
  try {
    const { sectionIdx: sec, paraIdx: para, controlIdx: ctrl } = target
    if (wasm.getFootnoteInfo(sec, para, ctrl)?.numberSlot === -1) return 0
    const edit = wasm.getNoteEditInfo?.(sec, para, ctrl)
    return Number.isInteger(edit?.charOffset) ? edit.charOffset : NOTE_NUMBER_CHARS
  } catch {
    return NOTE_NUMBER_CHARS
  }
}

/** A place moved off the note's number, to where its text starts. */
function pastNumber(place, textStart) {
  return place.fnParaIdx === 0 && place.charOffset < textStart
    ? { fnParaIdx: 0, charOffset: textStart }
    : place
}

/**
 * The note's selection when it holds any text, start before end. A selection that reaches into
 * the note's number (a whole first paragraph picked by a triple click, a drag from the number)
 * starts after it.
 */
function noteSelection(handler) {
  const ordered = handler.cursor.getFootnoteSelectionOrdered?.() ?? null
  if (!ordered) return null
  const textStart = noteTextStart(handler.wasm, noteTarget(handler.cursor))
  const start = pastNumber(ordered.start, textStart)
  const end = pastNumber(ordered.end, textStart)
  if (start.fnParaIdx === end.fnParaIdx && start.charOffset === end.charOffset) return null
  return { start, end }
}

/** The note's paragraphs' text. */
function noteParagraphs(wasm, target) {
  const info = wasm.getFootnoteInfo(target.sectionIdx, target.paraIdx, target.controlIdx)
  if (!info?.ok) throw new Error('the note cannot be read')
  return info.texts ?? []
}

/** The text between two places of a note, a line per paragraph. */
export function noteRangeText(paragraphs, start, end) {
  if (start.fnParaIdx === end.fnParaIdx) {
    return sliceChars(paragraphs[start.fnParaIdx] ?? '', start.charOffset, end.charOffset)
  }
  const lines = [sliceChars(paragraphs[start.fnParaIdx] ?? '', start.charOffset)]
  for (let p = start.fnParaIdx + 1; p < end.fnParaIdx; p++) lines.push(paragraphs[p] ?? '')
  lines.push(sliceChars(paragraphs[end.fnParaIdx] ?? '', 0, end.charOffset))
  return lines.join('\n')
}

/**
 * Puts `text` in the place of the note's range [start, end) and gives the place after it. A line
 * break in `text` splits the note's paragraph, as Enter does.
 */
export function replaceNoteRange(wasm, target, start, end, text) {
  const { sectionIdx: sec, paraIdx: para, controlIdx: ctrl } = target
  if (end && (end.fnParaIdx !== start.fnParaIdx || end.charOffset !== start.charOffset)) {
    const paragraphs = noteParagraphs(wasm, target)
    const count =
      charCount(noteRangeText(paragraphs, start, end)) - (end.fnParaIdx - start.fnParaIdx)
    // the paragraphs after the first come up into it, then the range is one stretch of text
    for (let p = end.fnParaIdx; p > start.fnParaIdx; p--) {
      wasm.mergeParagraphInFootnote(sec, para, ctrl, start.fnParaIdx + 1)
    }
    if (count > 0)
      wasm.deleteTextInFootnote(sec, para, ctrl, start.fnParaIdx, start.charOffset, count)
  }
  let place = { fnParaIdx: start.fnParaIdx, charOffset: start.charOffset }
  const lines = text.split(/\r\n|\r|\n/)
  lines.forEach((line, i) => {
    if (i > 0) {
      const split = wasm.splitParagraphInFootnote(
        sec,
        para,
        ctrl,
        place.fnParaIdx,
        place.charOffset,
      )
      if (!split?.ok) throw new Error('the note paragraph cannot be split')
      place = { fnParaIdx: split.fnParaIndex, charOffset: 0 }
    }
    if (line) {
      const done = wasm.insertTextInFootnote(
        sec,
        para,
        ctrl,
        place.fnParaIdx,
        place.charOffset,
        line,
      )
      if (!done?.ok) throw new Error('the note text cannot be inserted')
      place = { fnParaIdx: place.fnParaIdx, charOffset: place.charOffset + charCount(line) }
    }
  })
  return place
}

/**
 * Replaces the note's selection, or puts `text` at its caret, as one undo step. False when there
 * is nothing to do or the engine refused (the note is then as it was).
 */
function replaceNoteSelection(handler, text, operationType) {
  const cursor = handler.cursor
  const selection = noteSelection(handler)
  if (!selection && !text) return false
  const target = noteTarget(cursor)
  const caret = { fnParaIdx: cursor.fnInnerParaIdx, charOffset: cursor.fnCharOffset }
  const start = selection?.start ?? pastNumber(caret, noteTextStart(handler.wasm, target))
  const bodyPosition = cursor.getPosition()
  let after = null
  cursor.clearSelection()
  try {
    handler.executeOperation({
      kind: 'snapshot',
      operationType,
      editContext: noteContext(target, caret),
      editContextAfter: () => {
        if (!after) throw new Error('the note was not changed')
        return noteContext(target, after)
      },
      operation: (wasm) => {
        after = replaceNoteRange(wasm, target, start, selection?.end ?? null, text)
        return { ...bodyPosition }
      },
    })
  } catch (error) {
    console.warn('[note-text] the note was not changed:', error)
    return false
  }
  return after !== null
}

/**
 * The studio's paste event, before it pastes at the body caret: in a note, the clipboard's text
 * goes into the note. True when it was handled here.
 */
export function ieumNotePaste(handler, event) {
  if (!inNote(handler)) return false
  event.preventDefault?.()
  const text = event.clipboardData?.getData('text/plain') ?? ''
  replaceNoteSelection(handler, text, 'pasteInFootnote')
  return true
}

/** The note's selected text, or null when nothing in a note is selected. */
function selectedNoteText(handler) {
  if (!inNote(handler)) return null
  const selection = noteSelection(handler)
  if (!selection) return null
  try {
    const target = noteTarget(handler.cursor)
    return noteRangeText(noteParagraphs(handler.wasm, target), selection.start, selection.end)
  } catch (error) {
    console.warn('[note-text] the note selection cannot be read:', error)
    return null
  }
}

/** The studio's copy event: a note's selection is copied as text. True when handled here. */
export function ieumNoteCopy(handler, event) {
  const text = selectedNoteText(handler)
  if (text === null) return false
  event.preventDefault?.()
  event.clipboardData?.setData('text/plain', text)
  return true
}

/** The studio's cut event: copy a note's selection, then take it out. True when handled here. */
export function ieumNoteCut(handler, event) {
  if (!inNote(handler)) return false
  if (ieumNoteCopy(handler, event)) replaceNoteSelection(handler, '', 'cutInFootnote')
  else event.preventDefault?.()
  return true
}

/**
 * Before text goes into a note (a typed key, an IME composition, Enter): a selection in the note
 * goes, as typing over a selection does everywhere else. With nothing selected, the anchor a
 * click leaves behind is dropped: the studio sets it on every click in a note and never clears
 * it, so the text typed after the click would otherwise read as selected and the next paste
 * would replace it.
 */
export function ieumNoteBeforeEdit(handler) {
  if (!inNote(handler)) return
  try {
    if (noteSelection(handler)) replaceNoteSelection(handler, '', 'deleteSelectionInFootnote')
    else handler.cursor.clearSelection()
  } catch (error) {
    console.warn('[note-text] the note selection was not cleared:', error)
  }
}

/** Keys that move the caret in a note; the studio does not extend a note selection with them. */
const NOTE_MOVE_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'Escape',
])

/**
 * The studio's keys in a note, before it handles them. Backspace and Delete take a selection out
 * (handled here); Enter replaces it; a caret move leaves it. Shortcuts (Ctrl+C, Ctrl+V…) keep it.
 */
export function ieumNoteKey(handler, event) {
  if (!inNote(handler) || event.ctrlKey || event.metaKey || event.altKey) return false
  const key = event.key
  if (key === 'Backspace' || key === 'Delete') {
    if (!noteSelection(handler)) {
      handler.cursor.clearSelection()
      return false
    }
    event.preventDefault?.()
    replaceNoteSelection(handler, '', 'deleteSelectionInFootnote')
    return true
  }
  if (key === 'Enter') ieumNoteBeforeEdit(handler)
  else if (NOTE_MOVE_KEYS.has(key)) handler.cursor.clearSelection()
  return false
}

/**
 * Text from the 문자표 dialog into a note or a header or footer being edited, where the dialog put
 * it at the body caret. True when it went in here; false leaves it to the dialog's body insert.
 */
export function ieumInsertAtSubmodeCaret(handler, text) {
  if (!text) return false
  if (inNote(handler)) {
    replaceNoteSelection(handler, text, 'insertSymbolInFootnote')
    return true
  }
  try {
    if (handler?.cursor?.isInHeaderFooter?.() === true && handler.isFormMode?.() !== true) {
      handler.replaceHeaderFooterSelection(text, {
        operationType: 'insertSymbolInHeaderFooter',
        allowCollapsed: true,
      })
      return true
    }
  } catch (error) {
    console.warn('[note-text] the header or footer was not changed:', error)
    return true
  }
  return false
}
