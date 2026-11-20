/**
 * Editing cells in a CellBreak (pageBreak=1) or None (pageBreak=0) table past
 * one full page preserves pagination and passes .hwp save verification
 * (rhwp patch 0056).
 *
 * Previously, saving wrote vpos=0 resets back into the unavoidable mid-row cuts
 * of an atomic table that had no prior saved resets. On reopen, those resets
 * flipped `rowbreak_table_has_internal_saved_vpos_reset` to true and disabled
 * row-atomic pagination for the entire table, changing the page count (e.g.
 * 11 -> 7) and causing `exportHwpVerify` to reject the save. At the 2-page row
 * boundary, the live edit session also omitted `stored_plain_cut_closing_advance`
 * while reopen applied it, shifting one line per page.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

/** Build a saved .hwp with lead paragraphs and a 6x3 floating table. */
function savedTableDoc(pageBreak: 0 | 1 | 2): { doc: HwpDocument; at: [number, number, number] } {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  const leadCount = 12
  for (let i = 0; i < leadCount; i++) {
    if (i > 0) doc.splitParagraph(0, i - 1, doc.getParagraphLength(0, i - 1))
    doc.insertText(0, i, 0, `가상 문단 ${i + 1}: 표 앞 본문 위치를 맞추기 위한 예시 문장입니다.`)
  }
  doc.splitParagraph(0, leadCount - 1, doc.getParagraphLength(0, leadCount - 1))
  const made = JSON.parse(
    doc.createTableEx(
      JSON.stringify({
        sectionIdx: 0,
        paraIdx: leadCount,
        charOffset: 0,
        rowCount: 6,
        colCount: 3,
        treatAsChar: false,
      }),
    ),
  )
  expect(made).toMatchObject({ ok: true })
  const at: [number, number, number] = [0, made.paraIdx, made.controlIdx]
  doc.setTableProperties(...at, JSON.stringify({ pageBreak, repeatHeader: true }))
  doc.splitParagraph(0, made.paraIdx, doc.getParagraphLength(0, made.paraIdx))
  doc.insertText(0, made.paraIdx + 1, 0, '표 뒤 마무리 문단입니다.')
  for (let row = 0; row < 6; row++) {
    doc.insertTextInCell(...at, row * 3, 0, 0, row === 0 ? '구분' : `항목 ${row}`)
  }
  const bytes = doc.exportHwp()
  doc.free()
  return { doc: new HwpDocument(bytes), at }
}

function fillBodyCells(doc: HwpDocument, at: [number, number, number], text: string): void {
  for (let row = 1; row <= 5; row++) {
    for (const col of [1, 2]) {
      const cellIdx = row * 3 + col
      const len = doc.getCellParagraphLength(...at, cellIdx, 0)
      if (len > 0) doc.deleteTextInCell(...at, cellIdx, 0, 0, len)
      doc.insertTextInCell(...at, cellIdx, 0, 0, text)
    }
  }
}

function verify(doc: HwpDocument): {
  pageCountBefore: number
  pageCountAfter: number
  recovered: boolean
} {
  return JSON.parse(doc.exportHwpVerify())
}

function pageLayouts(doc: HwpDocument): string[] {
  return Array.from({ length: doc.pageCount() }, (_, p) => doc.getPageControlLayout(p))
}

const SAMPLE_SENTENCE =
  '가상 표 셀에 들어가는 반복 문장입니다. 표 행 높이가 한 쪽을 넘겨 불가피하게 나뉘더라도 저장 후 다시 열었을 때 쪽 수와 행 분할이 그대로 유지되어야 합니다. '

describe('atomic table edits pass .hwp save verification', () => {
  it('preserves pagination and exact layout when editing 10 cells in a CellBreak table past 1 page', () => {
    const { doc, at } = savedTableDoc(1)
    const text = SAMPLE_SENTENCE.repeat(8) // > 1 full page per row
    fillBodyCells(doc, at, text)

    const beforePages = doc.pageCount()
    expect(beforePages).toBeGreaterThanOrEqual(10)
    const liveLayout = pageLayouts(doc)

    const result = verify(doc)
    expect(result).toMatchObject({
      pageCountBefore: beforePages,
      pageCountAfter: beforePages,
      recovered: true,
    })

    const saved = doc.exportHwp()
    doc.free()

    const reopened = new HwpDocument(saved)
    expect(reopened.pageCount()).toBe(beforePages)
    expect(pageLayouts(reopened)).toEqual(liveLayout)

    // Second edit on the reopened file also verifies cleanly
    reopened.insertTextInCell(...at, 4, 0, 0, '추가 편집. ')
    expect(verify(reopened)).toMatchObject({ recovered: true })

    // Editing a body paragraph outside the table also stays consistent
    const afterSecond = reopened.exportHwp()
    reopened.free()
    const third = new HwpDocument(afterSecond)
    third.insertText(0, 0, 0, '머리말 앞 추가 ')
    expect(verify(third)).toMatchObject({ recovered: true })
    third.free()
  })

  it('preserves pagination at the 2-page row boundary in a CellBreak table', () => {
    const { doc, at } = savedTableDoc(1)
    const text = SAMPLE_SENTENCE.repeat(14) // ~2 full pages per row
    fillBodyCells(doc, at, text)

    const beforePages = doc.pageCount()
    const liveLayout = pageLayouts(doc)
    expect(verify(doc)).toMatchObject({
      pageCountBefore: beforePages,
      pageCountAfter: beforePages,
      recovered: true,
    })

    const reopened = new HwpDocument(doc.exportHwp())
    doc.free()
    expect(reopened.pageCount()).toBe(beforePages)
    expect(pageLayouts(reopened)).toEqual(liveLayout)
    reopened.free()
  })

  it('preserves pagination for a None (pageBreak=0) table with oversized rows', () => {
    const { doc, at } = savedTableDoc(0)
    fillBodyCells(doc, at, SAMPLE_SENTENCE.repeat(8))
    const beforePages = doc.pageCount()
    expect(verify(doc)).toMatchObject({
      pageCountBefore: beforePages,
      pageCountAfter: beforePages,
      recovered: true,
    })
    doc.free()
  })

  it('keeps RowBreak (pageBreak=2) table edits passing save verification', () => {
    const { doc, at } = savedTableDoc(2)
    fillBodyCells(doc, at, SAMPLE_SENTENCE.repeat(8))
    const beforePages = doc.pageCount()
    expect(verify(doc)).toMatchObject({
      pageCountBefore: beforePages,
      pageCountAfter: beforePages,
      recovered: true,
    })
    doc.free()
  })
})
