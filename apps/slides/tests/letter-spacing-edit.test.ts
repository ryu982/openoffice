/**
 * Character spacing while editing (Hangul's ⌥⇧W / ⌥⇧N): the selection steps 1% of
 * its font size per press, the new value rides a marked span, and only marked
 * text commits a letterSpacing — the layout's display spacing is never read back.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { extractParagraphs, stepSelectionLetterSpacing } from '../src/renderer/TextEditOverlay'

// jsdom has no execCommand: emulate the browser product — wrap the selection in <font size="7">
// (an element-only selection wraps that element's contents, as Chromium nests it).
beforeAll(() => {
  document.execCommand = (cmd: string) => {
    if (cmd !== 'fontSize') return true
    const sel = window.getSelection()
    if (!sel?.rangeCount || sel.getRangeAt(0).collapsed) return false
    const range = sel.getRangeAt(0)
    const onlyChild =
      range.startContainer === range.endContainer &&
      range.endOffset - range.startOffset === 1 &&
      range.startContainer.childNodes[range.startOffset]
    const wrap = document.createRange()
    if (onlyChild instanceof HTMLElement) wrap.selectNodeContents(onlyChild)
    else wrap.setStart(range.startContainer, range.startOffset)
    if (!(onlyChild instanceof HTMLElement)) wrap.setEnd(range.endContainer, range.endOffset)
    const font = document.createElement('font')
    font.setAttribute('size', '7')
    wrap.surroundContents(font)
    return true
  }
})

// jsdom computes no inherited styles; a browser inherits font-size and letter-spacing
beforeAll(() => {
  const own = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
    const inherited = (prop: 'fontSize' | 'letterSpacing') => {
      for (let e: HTMLElement | null = el as HTMLElement; e; e = e.parentElement)
        if (e.style[prop]) return e.style[prop]
      return ''
    }
    return new Proxy(own(el), {
      get: (target, key) =>
        key === 'fontSize' || key === 'letterSpacing' ? inherited(key) : Reflect.get(target, key),
    })
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
})

const PX_20PT = (20 * 96) / 72

/** One 20 pt paragraph "Annual timeline"; the layout spaced it 3px for display */
function setupEditor(): { root: HTMLElement; text: Text } {
  const root = document.createElement('div')
  root.className = 'slide-text-editor'
  root.tabIndex = 0
  root.dataset.norm = '1'
  Object.defineProperty(root, 'isContentEditable', { value: true })
  const para = document.createElement('div')
  para.dataset.srcPara = '0'
  const run = document.createElement('span')
  run.dataset.srcRun = '0'
  run.style.fontSize = `${PX_20PT}px`
  const fragment = document.createElement('span')
  fragment.dataset.layoutFragment = 'true'
  fragment.style.letterSpacing = '3px'
  fragment.textContent = 'Annual timeline'
  run.appendChild(fragment)
  para.appendChild(run)
  root.appendChild(para)
  document.body.appendChild(root)
  root.focus()
  return { root, text: fragment.firstChild as Text }
}

const select = (node: Node, from: number, to: number) => {
  const range = document.createRange()
  range.setStart(node, from)
  range.setEnd(node, to)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
}

const marks = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('[data-letter-spacing-pt]')].map(
    (el) => el.dataset.letterSpacingPt,
  )

describe('stepSelectionLetterSpacing', () => {
  it('steps 1% of the size per press from the layout’s spacing, and keeps the selection', () => {
    const { root, text } = setupEditor()
    select(text, 0, 6) // "Annual"
    stepSelectionLetterSpacing(1)
    // the layout's 3px is 2.25 pt; 1% of 20 pt is 0.2 pt
    expect(marks(root)).toEqual(['2.4'])
    stepSelectionLetterSpacing(1)
    expect(marks(root)).toEqual(['2.6'])
    stepSelectionLetterSpacing(-1)
    // one marked span: each press restyles it instead of nesting a new one inside
    expect(marks(root)).toEqual(['2.4'])
    expect(window.getSelection()!.toString()).toBe('Annual')
    const span = root.querySelector<HTMLElement>('[data-letter-spacing-pt]')!
    expect(span.style.letterSpacing).toBe(`${(2.4 * 96) / 72}px`)
  })

  it('commits the marked text only; the rest keeps its source run’s spacing', () => {
    const { root, text } = setupEditor()
    select(text, 7, 15) // "timeline"
    stepSelectionLetterSpacing(-1)
    const runs = extractParagraphs(root, 1)[0]!.runs
    expect(runs.map((r) => [r.text, r.letterSpacing])).toEqual([
      ['Annual ', undefined],
      // 2.25 pt is 11.25% of 20 pt: one step narrower lands on the 10% grid line
      ['timeline', 2],
    ])
  })

  it('does nothing without a ranged selection', () => {
    const { root, text } = setupEditor()
    select(text, 3, 3)
    stepSelectionLetterSpacing(1)
    expect(marks(root)).toEqual([])
    expect(extractParagraphs(root, 1)[0]!.runs[0]!.letterSpacing).toBeUndefined()
  })
})
