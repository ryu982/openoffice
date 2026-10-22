/**
 * Hangul's formatting chords in the Word editor: ⌥⇧Z / ⌥⇧A line spacing,
 * ⌥⇧W / ⌥⇧N character spacing, ⌥⇧E / ⌥⇧R font size — which key maps to
 * which step, the step sizes, and the burst coalescing a held chord relies on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { StyleInfo } from '@genoffice/docx-engine'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { inlineToRuns } from '../src/renderer/editor/convert'
import { setParaAttrs } from '../src/renderer/components/ribbon-tabs'
import {
  STEP_COALESCE_MS,
  burstStep,
  charSpacingAt,
  effectiveLineSpacing,
  formatStepForKey,
  newStepBurst,
  paragraphStyleDisplay,
  sameLineSpacing,
  stepCharSpacingTwips,
  stepLineSpacing,
  type LineSpacingValue,
} from '../src/renderer/components/format-step'

const chord = (code: string, mods: Partial<KeyboardEventInit> = {}) =>
  formatStepForKey({
    code,
    altKey: true,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    ...mods,
  } as KeyboardEvent)

const multiple = (lineSpacing: number): LineSpacingValue => ({
  lineSpacing,
  lineRule: null,
  lineRawTwips: null,
})

function makeEditor(content: unknown[]): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: { type: 'doc', content } as never,
  })
}

const para = (text: string, attrs: Record<string, unknown> = {}, marks?: unknown[]) => ({
  type: 'docParagraph',
  attrs,
  content: [{ type: 'text', text, ...(marks ? { marks } : {}) }],
})

const select = (editor: Editor, from: number, to: number) =>
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
  )

const styleMap = (...infos: StyleInfo[]) => new Map(infos.map((s) => [s.styleId, s]))

describe('formatStepForKey', () => {
  it('maps the six Hangul letters', () => {
    expect(chord('KeyZ')).toEqual({ action: 'stepLineSpacing', dir: 1 })
    expect(chord('KeyA')).toEqual({ action: 'stepLineSpacing', dir: -1 })
    expect(chord('KeyW')).toEqual({ action: 'stepCharSpacing', dir: 1 })
    expect(chord('KeyN')).toEqual({ action: 'stepCharSpacing', dir: -1 })
    expect(chord('KeyE')).toEqual({ action: 'nudgeFontSize', dir: 1 })
    expect(chord('KeyR')).toEqual({ action: 'nudgeFontSize', dir: -1 })
  })

  it('reads the physical key, so Option on the Mac and a Korean layout still match', () => {
    // ⌥⇧A types "Å" on a Mac and "ㅁ" under the Korean 2-set layout; e.code stays KeyA
    const mac = new KeyboardEvent('keydown', {
      key: 'Å',
      code: 'KeyA',
      altKey: true,
      shiftKey: true,
    })
    const ko = new KeyboardEvent('keydown', {
      key: 'ㅁ',
      code: 'KeyA',
      altKey: true,
      shiftKey: true,
    })
    expect(formatStepForKey(mac)).toEqual({ action: 'stepLineSpacing', dir: -1 })
    expect(formatStepForKey(ko)).toEqual({ action: 'stepLineSpacing', dir: -1 })
  })

  it('needs exactly Alt+Shift', () => {
    expect(chord('KeyE', { shiftKey: false })).toBeNull()
    expect(chord('KeyE', { altKey: false })).toBeNull()
    expect(chord('KeyE', { ctrlKey: true })).toBeNull()
    expect(chord('KeyE', { metaKey: true })).toBeNull()
  })

  it('leaves the other Alt+Shift chords alone', () => {
    // date / time fields and the paragraph moves
    for (const code of ['KeyD', 'KeyT', 'ArrowUp', 'ArrowDown']) expect(chord(code)).toBeNull()
  })
})

describe('line spacing step', () => {
  it('reads the direct value, then the style, the document default, single', () => {
    expect(effectiveLineSpacing({ lineSpacing: 1.5 })).toEqual(multiple(1.5))
    expect(effectiveLineSpacing({ lineRule: 'auto', lineRawTwips: 360 })).toEqual(multiple(1.5))
    expect(effectiveLineSpacing({ lineRule: 'exact', lineRawTwips: 300 })).toEqual({
      lineSpacing: null,
      lineRule: 'exact',
      lineRawTwips: 300,
    })
    expect(effectiveLineSpacing({}, { lineSpacing: 1.15 })).toEqual(multiple(1.15))
    expect(effectiveLineSpacing({}, {}, { lineRule: 'auto', lineRawTwips: 259 })).toEqual(
      multiple(259 / 240),
    )
    expect(effectiveLineSpacing({})).toEqual(multiple(1))
  })

  it('falls back to the default paragraph style', () => {
    const styles = styleMap(
      {
        styleId: 'Normal',
        name: 'Normal',
        type: 'paragraph',
        isDefault: true,
        display: { lineSpacing: 1.15 },
      },
      { styleId: 'Quote', name: 'Quote', type: 'paragraph', display: { lineSpacing: 2 } },
    )
    expect(paragraphStyleDisplay(styles, 'Quote')?.lineSpacing).toBe(2)
    expect(paragraphStyleDisplay(styles, null)?.lineSpacing).toBe(1.15)
    expect(paragraphStyleDisplay(undefined, 'Quote')).toBeUndefined()
  })

  it('moves a multiple by 0.1 line', () => {
    expect(stepLineSpacing(multiple(1), 1)).toEqual(multiple(1.1))
    expect(stepLineSpacing(multiple(1), -1)).toEqual(multiple(0.9))
    expect(stepLineSpacing(multiple(259 / 240), 1)).toEqual(multiple(1.18))
    // no floating-point drift over a long burst
    let v = multiple(1)
    for (let i = 0; i < 7; i += 1) v = stepLineSpacing(v, 1)
    expect(v).toEqual(multiple(1.7))
  })

  it('keeps an At least / Exactly rule and moves it by 1 pt', () => {
    const exact: LineSpacingValue = { lineSpacing: null, lineRule: 'exact', lineRawTwips: 300 }
    expect(stepLineSpacing(exact, 1)).toEqual({ ...exact, lineRawTwips: 320 })
    expect(stepLineSpacing({ ...exact, lineRule: 'atLeast' }, -1)).toEqual({
      ...exact,
      lineRule: 'atLeast',
      lineRawTwips: 280,
    })
  })

  it('stays inside the Paragraph dialog ranges', () => {
    expect(stepLineSpacing(multiple(0.1), -1)).toEqual(multiple(0.06))
    expect(stepLineSpacing(multiple(132), 1)).toEqual(multiple(132))
    const exact: LineSpacingValue = { lineSpacing: null, lineRule: 'exact', lineRawTwips: 20 }
    expect(stepLineSpacing(exact, -1)).toEqual(exact)
  })

  it('lands on every selected paragraph as a direct multiple', () => {
    const editor = makeEditor([para('one', { lineRule: 'exact', lineRawTwips: 400 }), para('two')])
    select(editor, 1, editor.state.doc.content.size - 1)
    setParaAttrs(editor, { ...stepLineSpacing(multiple(1), 1) })
    const attrs: Record<string, unknown>[] = []
    editor.state.doc.forEach((node) => attrs.push(node.attrs))
    for (const a of attrs) {
      expect(a.lineSpacing).toBe(1.1)
      expect(a.lineRule ?? null).toBeNull()
      expect(a.lineRawTwips ?? null).toBeNull()
    }
    editor.destroy()
  })
})

describe('character spacing step', () => {
  it('moves by 1% of the font size', () => {
    // 10 pt: 1% is 2 twips (0.1 pt)
    expect(stepCharSpacingTwips(0, 10, 1)).toBe(2)
    expect(stepCharSpacingTwips(2, 10, 1)).toBe(4)
    expect(stepCharSpacingTwips(0, 10, -1)).toBe(-2)
    // 20 pt: 4 twips
    expect(stepCharSpacingTwips(0, 20, 1)).toBe(4)
  })

  it('keeps moving at sizes where a percent is not a whole twip', () => {
    let v = 0
    const seen = [v]
    for (let i = 0; i < 5; i += 1) seen.push((v = stepCharSpacingTwips(v, 11, 1)))
    expect(seen).toEqual([0, 2, 4, 7, 9, 11])
    for (let i = 0; i < 5; i += 1) v = stepCharSpacingTwips(v, 11, -1)
    expect(v).toBe(0)
    // below 5 pt one percent is under a twip: still one twip per press
    expect(stepCharSpacingTwips(0, 2, 1)).toBe(1)
  })

  it('stops at Hangul’s ±50% but walks back from spacing set wider', () => {
    expect(stepCharSpacingTwips(100, 10, 1)).toBe(100)
    expect(stepCharSpacingTwips(-100, 10, -1)).toBe(-100)
    expect(stepCharSpacingTwips(100, 10, -1)).toBe(98)
    expect(stepCharSpacingTwips(160, 10, -1)).toBe(158)
    expect(stepCharSpacingTwips(160, 10, 1)).toBe(160)
  })

  it('reads the run, then its character style, then its paragraph style', () => {
    const styles = styleMap(
      { styleId: 'Spaced', name: 'Spaced', type: 'paragraph', display: { charSpacingTwips: 40 } },
      { styleId: 'Tight', name: 'Tight', type: 'character', display: { charSpacingTwips: -10 } },
    )
    const editor = makeEditor([
      para('own', {}, [{ type: 'docTextStyle', attrs: { charSpacingTwips: 6 } }]),
      para('para style', { styleId: 'Spaced' }),
      para('char style', { styleId: 'Spaced' }, [
        { type: 'docTextStyle', attrs: { styleId: 'Tight' } },
      ]),
      para('plain'),
    ])
    const at = (n: number) => {
      let pos = 0
      editor.state.doc.forEach((_node, offset, index) => {
        if (index === n) pos = offset + 2
      })
      select(editor, pos, pos)
      return charSpacingAt(editor, styles)
    }
    expect(at(0)).toEqual({ current: 6, inherited: 0 })
    expect(at(1)).toEqual({ current: 40, inherited: 40 })
    expect(at(2)).toEqual({ current: -10, inherited: -10 })
    expect(at(3)).toEqual({ current: 0, inherited: 0 })
    editor.destroy()
  })

  it('saves as the run’s w:spacing', () => {
    const editor = makeEditor([para('Spaced')])
    select(editor, 1, 7)
    editor
      .chain()
      .setMark('docTextStyle', { charSpacingTwips: stepCharSpacingTwips(0, 10, 1) })
      .run()
    const inline = editor.state.doc.firstChild!.toJSON().content
    expect(inlineToRuns(inline)[0].charSpacingTwips).toBe(2)
    editor.destroy()
  })
})

describe('burst coalescing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const run = (editor: Editor, burst = newStepBurst<number>()) => {
    const applied: Array<[number, boolean]> = []
    const press = () =>
      burstStep(
        burst,
        editor,
        0,
        (base) => base + 1,
        (value, deferred) => applied.push([value, deferred]),
        Object.is,
      )
    return { applied, press }
  }

  it('applies the first press at once and the rest of a held chord once at the end', () => {
    const editor = makeEditor([para('text')])
    const { applied, press } = run(editor)
    press()
    expect(applied).toEqual([[1, false]])
    for (let i = 0; i < 4; i += 1) {
      vi.advanceTimersByTime(STEP_COALESCE_MS / 2)
      press()
    }
    expect(applied).toEqual([[1, false]])
    vi.advanceTimersByTime(STEP_COALESCE_MS)
    expect(applied).toEqual([
      [1, false],
      [5, true],
    ])
    editor.destroy()
  })

  it('skips the trailing apply when nothing moved past the first press', () => {
    const editor = makeEditor([para('text')])
    const { applied, press } = run(editor)
    press()
    vi.advanceTimersByTime(STEP_COALESCE_MS)
    expect(applied).toEqual([[1, false]])
    // a later press starts a new burst from the editor's value again
    press()
    expect(applied).toEqual([
      [1, false],
      [1, false],
    ])
    editor.destroy()
  })

  it('drops the trailing apply when the document or selection changed meanwhile', () => {
    const editor = makeEditor([para('text')])
    const { applied, press } = run(editor)
    press()
    press()
    editor.commands.insertContentAt(1, 'x')
    vi.advanceTimersByTime(STEP_COALESCE_MS)
    expect(applied).toEqual([[1, false]])

    const second = run(editor)
    second.press()
    second.press()
    select(editor, 1, 3)
    vi.advanceTimersByTime(STEP_COALESCE_MS)
    expect(second.applied).toEqual([[1, false]])
    editor.destroy()
  })

  it('compares structured values with the given equality', () => {
    const a = stepLineSpacing(multiple(1), 1)
    expect(sameLineSpacing(a, multiple(1.1))).toBe(true)
    expect(sameLineSpacing(a, multiple(1.2))).toBe(false)
  })
})
