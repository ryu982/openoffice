import { ancestorsOf, elementCovering, type ParseMap } from '../document/parse-map'

/**
 * Where the preview marks what the AI changed. The source pane marks source
 * ranges; the preview draws boxes over page elements, so each range becomes
 * the elements it wrote (the topmost ones wholly inside it) or, when it sits
 * inside one element (a text, an attribute, a style), that element.
 */

/** never drawn as a box of their own: the page itself, or things with no place on it */
const NOT_DRAWN = new Set([
  'html',
  'head',
  'body',
  'base',
  'link',
  'meta',
  'noscript',
  'script',
  'style',
  'template',
  'title',
])
/** nothing inside these has a place on the page */
const HIDDEN_INSIDE = new Set(['head', 'noscript', 'script', 'style', 'template'])

export interface ChangedElements {
  /** the elements to mark, none inside another */
  sids: number[]
  /** every range found an element to mark (no head or style edit, no whole-page rewrite) */
  complete: boolean
}

export function changedElements(
  map: ParseMap,
  source: string,
  ranges: ReadonlyArray<readonly [number, number]>,
): ChangedElements {
  const drawn = (sid: number): boolean => {
    const entry = map.bySid.get(sid)
    if (!entry || NOT_DRAWN.has(entry.tag)) return false
    return !ancestorsOf(map, sid).some((a) => HIDDEN_INSIDE.has(a.tag))
  }
  const textStart = source.search(/\S/)
  const textEnd = source.trimEnd().length
  const picked = new Set<number>()
  let complete = true
  for (const range of ranges) {
    let [from, to] = range
    // a range's edge whitespace belongs to no element
    while (from < to && /\s/.test(source[from]!)) from++
    while (to > from && /\s/.test(source[to - 1]!)) to--
    if (to <= from) continue
    // the whole page was written anew: a box over all of it would only hide what it looks like
    if (from <= textStart && to >= textEnd) {
      complete = false
      continue
    }
    const inside = map.elements.filter(
      (e) => e.range[0] >= from && e.range[1] <= to && drawn(e.sid),
    )
    if (inside.length > 0) {
      for (const e of inside) picked.add(e.sid)
      continue
    }
    const covering = elementCovering(map, from, to)
    if (covering && drawn(covering.sid)) picked.add(covering.sid)
    else complete = false
  }
  // a box inside another marked box would only darken it
  const sids = [...picked].filter(
    (sid) => !ancestorsOf(map, sid).some((ancestor) => picked.has(ancestor.sid)),
  )
  return { sids, complete }
}
