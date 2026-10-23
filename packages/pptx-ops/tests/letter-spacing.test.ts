/**
 * Character spacing through the op layer: setFont's font.letterSpacing sets
 * <a:rPr spc> on every run and is range-checked, and an edit session's run
 * letterSpacing lands on the model (absent keeps the original run's).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  addElement,
  createBlankPptx,
  openPptx,
  parseSlide,
  type OpenedPptx,
  type TextElement,
} from '@genoffice/pptx-engine'
import { runTxn } from '../src/ops/executor'
import { applyEditParagraphs } from '../src/edit-text'
import '../src/ops/index'

let opened: OpenedPptx
let textId: string

const runsOf = () =>
  (opened.deck.slides[0]!.elements.find((e) => e.id === textId) as TextElement).text!.paragraphs[0]!
    .runs

beforeEach(async () => {
  opened = await openPptx(await createBlankPptx())
  textId = addElement(opened.deck.slides[0]!, {
    kind: 'textbox',
    offset: { x: 0, y: 0, cx: 1828800, cy: 914400 },
    paragraphs: [{ runs: [{ text: 'Hello ' }, { text: 'world', letterSpacing: -0.5 }] }],
  }).id
})

const setFont = (font: Record<string, unknown>) =>
  runTxn(opened, { ops: [{ op: 'setFont', target: { slide: 0, el: textId }, font }] })

describe('setFont letterSpacing', () => {
  it('sets the same spacing on every run', () => {
    expect(setFont({ letterSpacing: 1.2 }).applied).toBe(true)
    expect(runsOf().map((r) => r.letterSpacing)).toEqual([1.2, 1.2])
  })

  it('takes 0 as normal spacing', () => {
    expect(setFont({ letterSpacing: 0 }).applied).toBe(true)
    expect(runsOf().map((r) => r.letterSpacing)).toEqual([0, 0])
  })

  it('leaves it alone when the patch does not name it', () => {
    setFont({ bold: true })
    expect(runsOf().map((r) => r.letterSpacing)).toEqual([undefined, -0.5])
  })

  it('rejects values outside ST_TextPoint and non-numbers, leaving the deck as it was', () => {
    for (const letterSpacing of [4000.5, -4001, Number.NaN, '2pt', null]) {
      const r = setFont({ letterSpacing })
      expect(r.applied).toBe(false)
      expect(JSON.stringify(r)).toMatch(/letterSpacing/)
    }
    expect(runsOf().map((r) => r.letterSpacing)).toEqual([undefined, -0.5])
  })
})

describe('edit session letterSpacing', () => {
  const before = (
    parseSlide({
      path: 'ppt/slides/slide1.xml',
      slideXml:
        '<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>' +
        '<p:sp><p:spPr/><p:txBody><a:bodyPr/><a:p>' +
        '<a:r><a:rPr spc="-30"/><a:t>tight</a:t></a:r><a:r><a:rPr/><a:t>plain</a:t></a:r>' +
        '</a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
      ctx: {},
    }).elements[0] as TextElement
  ).text!.paragraphs

  it('keeps the original run’s spacing unless the edit set it', () => {
    const after = applyEditParagraphs(before, [
      {
        srcPara: 0,
        runs: [
          { text: 'tight', srcRun: 0 },
          { text: 'plain', srcRun: 1, letterSpacing: 0.4 },
        ],
      },
    ])
    expect(after[0]!.runs.map((r) => r.letterSpacing)).toEqual([-0.3, 0.4])
  })
})
