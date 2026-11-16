import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it } from 'vitest'
import rawInspector from '../src/renderer/preview/inspector.js?raw'
import { changedElements } from '../src/renderer/ai/change-marks'
import { buildParseMap, type ParseMap } from '../src/renderer/document/parse-map'
import { compileOps, type HtmlOp } from '../src/renderer/document/ops'
import { applyPatches } from '../src/renderer/document/patch'
import { instrumentForPreview } from '../src/renderer/preview/instrument'

/**
 * The preview's marks of the AI's changes: which page elements a changed
 * source range becomes, and the frame's boxes over them, which stay out of
 * the page the source describes.
 */

const PAGE = `<!doctype html>
<html><head><title>T</title><style>h1 { color: red }</style></head>
<body>
  <header><h1>Title</h1><p class="lead">Intro <strong>text</strong></p></header>
  <main><section><h2>One</h2><p>First</p></section></main>
  <p hidden>Secret</p>
</body></html>`

/** the sid of the nth element with this tag, in document order */
const sidOf = (map: ParseMap, tag: string, nth = 0) =>
  map.elements.filter((e) => e.tag === tag)[nth]!.sid
const tagsOf = (map: ParseMap, sids: number[]) => sids.map((sid) => map.bySid.get(sid)!.tag)

/** apply a batch the way the app does and return the new source, its map and the patch ranges */
function edit(source: string, ops: (map: ParseMap) => HtmlOp[]) {
  const map = buildParseMap(source, 1, null)
  const compiled = compileOps(source, map, ops(map))
  expect(compiled.errors).toEqual([])
  const sorted = [...compiled.patches].sort((a, b) => a.from - b.from)
  const ranges: Array<[number, number]> = []
  let delta = 0
  for (const p of sorted) {
    ranges.push([p.from + delta, p.from + delta + p.text.length])
    delta += p.text.length - (p.to - p.from)
  }
  const next = applyPatches(source, compiled.patches)
  return { next, map: buildParseMap(next, 2, map), ranges }
}

describe('the elements a change marks', () => {
  it('marks the element whose text or attribute changed', () => {
    const { next, map, ranges } = edit(PAGE, (m) => [
      { op: 'set_text', sid: sidOf(m, 'h1'), text: 'New title' },
      { op: 'set_attr', sid: sidOf(m, 'p', 1), name: 'title', value: 'x' },
    ])
    const result = changedElements(map, next, ranges)
    expect(tagsOf(map, result.sids).sort()).toEqual(['h1', 'p'])
    expect(result.complete).toBe(true)
  })

  it('marks an inserted element itself, and nothing inside a marked one twice', () => {
    const { next, map, ranges } = edit(PAGE, (m) => [
      {
        op: 'insert_html',
        sid: sidOf(m, 'main'),
        position: 'append',
        html: '<section><h2>Two</h2><p>Second</p></section>',
      },
    ])
    const result = changedElements(map, next, ranges)
    expect(result.sids).toHaveLength(1)
    expect(result.sids).toEqual([sidOf(map, 'section', 1)])
    expect(result.complete).toBe(true)
  })

  it('marks nothing it cannot show: a style in the head, a hidden element, a whole new page', () => {
    const styleFrom = PAGE.indexOf('color: red')
    const map = buildParseMap(PAGE, 1, null)
    const head = changedElements(map, PAGE, [[styleFrom, styleFrom + 10]])
    expect(head).toEqual({ sids: [], complete: false })

    // the hidden paragraph is drawn by the frame as no box; the host still names it
    const secret = PAGE.indexOf('Secret')
    expect(tagsOf(map, changedElements(map, PAGE, [[secret, secret + 6]]).sids)).toEqual(['p'])

    const whole = changedElements(map, PAGE, [[0, PAGE.length]])
    expect(whole).toEqual({ sids: [], complete: false })
  })
})

describe('the frame boxes over the changed elements', () => {
  let dom: JSDOM | null = null
  afterEach(() => {
    dom?.window.close()
    dom = null
  })

  function openPreview(source: string) {
    const map = buildParseMap(source, 1, null)
    const inspector = rawInspector.replace('__GX_VERSION__', '1')
    dom = new JSDOM(instrumentForPreview(source, map, inspector), {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
    })
    const { window } = dom
    // jsdom lays nothing out: every shown element gets a box, a hidden one none
    window.Element.prototype.getClientRects = function (this: Element) {
      const hidden = this.closest('[hidden]') !== null
      return (hidden ? [] : [{}]) as unknown as DOMRectList
    }
    window.Element.prototype.getBoundingClientRect = function () {
      return {
        x: 0,
        y: 0,
        top: 10,
        left: 20,
        right: 120,
        bottom: 40,
        width: 100,
        height: 30,
      } as DOMRect
    }
    const send = (data: unknown) =>
      window.dispatchEvent(new window.MessageEvent('message', { data }))
    const boxes = () => [
      ...window.document.querySelectorAll<HTMLElement>('[data-gx-inspector-overlay="highlight"]'),
    ]
    /** the page as its own elements describe it, without the inspector's nodes */
    const page = () => {
      const clone = window.document.documentElement.cloneNode(true) as HTMLElement
      for (const own of clone.querySelectorAll('[data-gx-inspector]')) own.remove()
      return clone.outerHTML
    }
    return { map, window, send, boxes, page }
  }

  it('draws one box per shown element in the colours the app sends, and takes them off again', () => {
    const { map, send, boxes, page } = openPreview(PAGE)
    const before = page()
    const sids = [sidOf(map, 'h1'), sidOf(map, 'p', 2)]
    send({ type: 'gx:highlight', sids, fill: 'rgb(1 2 3 / 20%)', line: 'rgb(4 5 6)' })

    expect(boxes()).toHaveLength(2)
    const [shown, hidden] = boxes()
    expect(shown!.style.display).toBe('block')
    expect(shown!.style.getPropertyValue('--gx-ai-bg')).toBe('rgb(1 2 3 / 20%)')
    expect(shown!.style.getPropertyValue('--gx-ai-line')).toBe('rgb(4 5 6)')
    // the hidden paragraph has no place on the page: no stray box in a corner
    expect(hidden!.style.display).toBe('none')
    // the page's own elements carry nothing of the marks
    expect(page()).toBe(before)

    send({ type: 'gx:clearHighlight' })
    expect(boxes()).toHaveLength(0)
  })
})
