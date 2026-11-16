/**
 * rhwp patch 0051: `setColumnSeparator(section, json)` and the three separator fields of
 * `getColumnDef`.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

const EIGHT_MM_COLUMN_GAP = 2268
const LINE = { type: 1, width: 1, color: '#112233' }

function twoColumns(): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  for (let index = 0; index < 60; index += 1) {
    if (index > 0) doc.splitParagraph(0, index - 1, doc.getParagraphLength(0, index - 1))
    doc.insertText(0, index, 0, `문항 ${index + 1} 본문 한 줄`)
  }
  doc.setColumnDef(0, 2, 0, 1, EIGHT_MM_COLUMN_GAP)
  return doc
}

const separator = (doc: HwpDocument) => {
  const { separatorType, separatorWidth, separatorColor } = JSON.parse(doc.getColumnDef(0))
  return { type: separatorType, width: separatorWidth, color: separatorColor }
}

/** A test paper's head: a table hung from the top of the page body over both columns. */
function shortQuizWithHeadTable(): { doc: HwpDocument; headBottom: number } {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  const { paraIdx, controlIdx } = JSON.parse(doc.createTable(0, 0, 0, 3, 8))
  doc.setTableProperties(
    0,
    paraIdx,
    controlIdx,
    JSON.stringify({
      treatAsChar: false,
      textWrap: 'TopAndBottom',
      vertRelTo: 'Page',
      horzRelTo: 'Page',
      vertAlign: 'Top',
      horzAlign: 'Left',
      vertOffset: 0,
      horzOffset: 0,
    }),
  )
  for (let index = 0; index < 4; index += 1) {
    const para = paraIdx + 1 + index
    if (index > 0) doc.splitParagraph(0, para - 1, doc.getParagraphLength(0, para - 1))
    doc.insertText(0, para, 0, `${index + 1}. 짧은 문항`)
  }
  doc.setColumnDef(0, 2, 0, 1, EIGHT_MM_COLUMN_GAP)
  doc.setColumnSeparator(0, JSON.stringify(LINE))
  const box = JSON.parse(doc.getTableBBox(0, paraIdx, controlIdx))
  const { outerBottom } = JSON.parse(doc.getTableProperties(0, paraIdx, controlIdx))
  return { doc, headBottom: box.y + box.height + (outerBottom * 96) / 7200 }
}

/**
 * The name Hancom Hangul writes in `<hp:colLine type>` when it saves a .hwp holding each
 * separator code as HWPX. It draws code 2 dashed and code 3 dotted in both files.
 */
const HANCOM_COL_LINE_NAMES: [number, string][] = [
  [1, 'SOLID'],
  [2, 'DOT'],
  [3, 'DASH'],
  [4, 'DASH_DOT'],
  [5, 'DASH_DOT_DOT'],
  [6, 'LONG_DASH'],
  [7, 'CIRCLE'],
]

const hancomColLine = (name: string) =>
  `<hp:colLine type="${name}" width="0.2 mm" color="#000000"/>`

async function sectionXml(hwpx: Uint8Array): Promise<string> {
  return (await JSZip.loadAsync(hwpx)).file('Contents/section0.xml')!.async('string')
}

async function withSectionXml(hwpx: Uint8Array, edit: (xml: string) => string) {
  const zip = await JSZip.loadAsync(hwpx)
  zip.file('Contents/section0.xml', edit(await sectionXml(hwpx)))
  return zip.generateAsync({ type: 'uint8array' })
}

/** Vertical lines of the page picture drawn in the separator's colour. */
function separatorLines(doc: HwpDocument): { x: number; y1: number; y2: number }[] {
  const svg = doc.renderPageSvg(0)
  return [
    ...svg.matchAll(
      /<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="#112233"/g,
    ),
  ]
    .filter((m) => m[1] === m[3])
    .map((m) => ({ x: Number(m[1]), y1: Number(m[2]), y2: Number(m[4]) }))
}

describe('the line between the columns (patch 0051)', () => {
  it('is set, reported, and drawn between the two columns', () => {
    const doc = twoColumns()
    expect(separator(doc).type).toBe(0)
    expect(separatorLines(doc)).toEqual([])

    expect(JSON.parse(doc.setColumnSeparator(0, JSON.stringify(LINE)))).toEqual({ ok: true })
    expect(separator(doc)).toEqual(LINE)
    const lines = separatorLines(doc)
    expect(lines).toHaveLength(1)
    const [{ x, y1, y2 }] = lines
    const pageWidth = Number(doc.renderPageSvg(0).match(/<svg[^>]* width="([\d.]+)"/)?.[1])
    expect(Math.abs(x - pageWidth / 2)).toBeLessThan(1)
    expect(y2).toBeGreaterThan(y1)
  })

  it('survives saving as .hwp and as HWPX', () => {
    const doc = twoColumns()
    doc.setColumnSeparator(0, JSON.stringify(LINE))
    for (const bytes of [doc.exportHwp(), doc.exportHwpx()]) {
      const reopened = new HwpDocument(bytes)
      expect(separator(reopened)).toEqual(LINE)
      expect(separatorLines(reopened)).toHaveLength(1)
    }
  })

  it('goes away with type 0, also after saving', () => {
    const doc = twoColumns()
    doc.setColumnSeparator(0, JSON.stringify(LINE))
    doc.setColumnSeparator(0, '{"type":0}')
    expect(separator(doc).type).toBe(0)
    expect(separatorLines(doc)).toEqual([])
    for (const bytes of [doc.exportHwp(), doc.exportHwpx()]) {
      expect(separator(new HwpDocument(bytes)).type).toBe(0)
    }
  })

  it('refuses a value a saved file could not keep', () => {
    const doc = twoColumns()
    expect(() => doc.setColumnSeparator(0, '{"type":8}')).toThrow()
    expect(() => doc.setColumnSeparator(0, '{"type":1,"width":16}')).toThrow()
    expect(() => doc.setColumnSeparator(0, '{"type":1,"color":"red"}')).toThrow()
    expect(separator(doc).type).toBe(0)
  })

  it('refuses every value outside what it says it accepts and keeps the line it had', () => {
    const doc = twoColumns()
    doc.setColumnSeparator(0, JSON.stringify(LINE))
    const accepted = [
      '{"type":-1}',
      '{"type":1.5}',
      '{"type":"1"}',
      '{"type":1,"width":-1}',
      '{"type":1,"width":2.5}',
      '{"type":1,"width":null}',
      '{"type":1,"color":123}',
      '{"type":1,"color":"#+1+2+3"}',
      '{"type":1,"color":"#가나"}',
    ].filter((json) => {
      try {
        doc.setColumnSeparator(0, json)
        return true
      } catch {
        return false
      }
    })
    expect(accepted).toEqual([])
    expect(separator(doc)).toEqual(LINE)
  })

  it('reports itself as compact JSON', () => {
    const doc = twoColumns()
    doc.setColumnSeparator(0, JSON.stringify(LINE))
    const json = doc.getColumnDef(0)
    expect(json).toBe(JSON.stringify(JSON.parse(json)))
  })

  it('starts below the head table when only the left column holds text', () => {
    const { doc, headBottom } = shortQuizWithHeadTable()
    const lines = separatorLines(doc)
    expect(lines).toHaveLength(1)
    expect(Math.abs(lines[0].y1 - headBottom)).toBeLessThan(0.1)
  })

  it('names each line kind in HWPX as Hancom Hangul does, both ways', async () => {
    const written: string[] = []
    const read: number[] = []
    const plain = twoColumns()
    plain.setColumnSeparator(0, JSON.stringify(LINE))
    const plainHwpx = plain.exportHwpx()
    for (const [type, name] of HANCOM_COL_LINE_NAMES) {
      const doc = twoColumns()
      doc.setColumnSeparator(0, JSON.stringify({ type, width: 3, color: '#000000' }))
      written.push((await sectionXml(doc.exportHwpx())).match(/<hp:colLine[^>]*\/>/)![0])
      const hancom = await withSectionXml(plainHwpx, (xml) =>
        xml.replace(/<hp:colLine[^>]*\/>/, hancomColLine(name)),
      )
      read.push(separator(new HwpDocument(hancom)).type)
    }
    expect(written).toEqual(HANCOM_COL_LINE_NAMES.map(([, name]) => hancomColLine(name)))
    expect(read).toEqual(HANCOM_COL_LINE_NAMES.map(([type]) => type))
  })
})
