/**
 * Character spacing (<a:rPr spc>) through the font patch: setElementFont sets it
 * on every run, the in-place run patch writes it, and runs whose spacing did not
 * change — or whose model holds none — keep their bytes.
 */
import { describe, it, expect } from 'vitest'
import { parseSlide } from '../src/parse'
import { patchTextElementXml, setElementFont } from '../src/index'
import type { TextElement } from '../src/types'

const slideWith = (sp: string) =>
  '<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld>' +
  `<p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${sp}</p:spTree></p:cSld></p:sld>`
const spWith = (runs: string) =>
  '<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>' +
  `<p:txBody><a:bodyPr/><a:p>${runs}</a:p></p:txBody></p:sp>`

const parse = (runs: string) => {
  const slide = parseSlide({
    path: 'ppt/slides/slide1.xml',
    slideXml: slideWith(spWith(runs)),
    ctx: {},
  })
  return { slide, el: slide.elements[0] as TextElement }
}

const RUNS =
  '<a:r><a:rPr lang="ko-KR" sz="2000" spc="-20"/><a:t>tight</a:t></a:r>' +
  '<a:r><a:rPr lang="ko-KR" sz="2000"/><a:t>plain</a:t></a:r>' +
  '<a:r><a:rPr lang="ko-KR" sz="2000" spc="0"/><a:t>zero</a:t></a:r>'

describe('character spacing patch', () => {
  it('reads each run’s own spc in points', () => {
    const runs = parse(RUNS).el.text!.paragraphs[0]!.runs
    expect(runs.map((r) => r.letterSpacing)).toEqual([-0.2, undefined, 0])
  })

  it('keeps every run’s spc bytes when another property changes', () => {
    const { slide, el } = parse(RUNS)
    expect(setElementFont(slide, el.id, { bold: true })).toBe(true)
    const out = patchTextElementXml(el, el.anchor.originalXml)
    expect(out).toContain('sz="2000" spc="-20"')
    expect(out).toContain('sz="2000" spc="0"')
    expect(out.match(/spc=/g)).toHaveLength(2)
  })

  it('sets the same spacing on every run', () => {
    const { slide, el } = parse(RUNS)
    expect(setElementFont(slide, el.id, { letterSpacing: 1.5 })).toBe(true)
    expect(el.text!.paragraphs[0]!.runs.map((r) => r.letterSpacing)).toEqual([1.5, 1.5, 1.5])
    const out = patchTextElementXml(el, el.anchor.originalXml)
    expect(out.match(/ spc="150"/g)).toHaveLength(3)
    expect(out).not.toContain('spc="-20"')
    // nothing else on the rPr moved
    expect(out.match(/lang="ko-KR" sz="2000"/g)).toHaveLength(3)
  })

  it('writes normal spacing as an explicit 0, which overrides inherited spacing', () => {
    const { slide, el } = parse(RUNS)
    setElementFont(slide, el.id, { letterSpacing: 0 })
    const out = patchTextElementXml(el, el.anchor.originalXml)
    expect(out.match(/ spc="0"/g)).toHaveLength(3)
  })

  it('leaves the bytes alone where the model holds no spacing of its own', () => {
    const { el } = parse(RUNS)
    delete el.text!.paragraphs[0]!.runs[0]!.letterSpacing
    el.text!.paragraphs[0]!.runs[0]!.text = 'edited'
    const out = patchTextElementXml(el, el.anchor.originalXml)
    expect(out).toContain('spc="-20"')
  })

  it('reparses to the value it wrote', () => {
    const { slide, el } = parse(RUNS)
    setElementFont(slide, el.id, { letterSpacing: -0.35 })
    const out = patchTextElementXml(el, el.anchor.originalXml)!
    const again = parseSlide({ path: 'ppt/slides/slide1.xml', slideXml: slideWith(out), ctx: {} })
    const runs = (again.elements[0] as TextElement).text!.paragraphs[0]!.runs
    expect(runs.map((r) => r.letterSpacing)).toEqual([-0.35, -0.35, -0.35])
  })
})
