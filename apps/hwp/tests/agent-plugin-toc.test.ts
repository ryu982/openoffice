/**
 * The plugin's table-of-contents tools against the real rhwp engine, on a report long
 * enough to run over several pages.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { agentPlugin, type AgentPluginHost } from '../studio-plugin/agent-plugin.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

const CHAPTERS = 4
const BODY_LINES = 30

/** 보고서 제목, then chapters of a heading, a sub-heading and body lines. */
function report() {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  const lines = ['보고서 제목']
  for (let i = 1; i <= CHAPTERS; i++) {
    lines.push(`${i}. 장 제목 ${i}`, `${i}.1 절 제목 ${i}`)
    for (let j = 0; j < BODY_LINES; j++) lines.push(`본문 ${i}-${j} 문장입니다. 줄을 채웁니다.`)
  }
  lines.forEach((line, k) => {
    if (k > 0) doc.splitParagraph(0, k - 1, doc.getParagraphLength(0, k - 1))
    doc.insertText(0, k, 0, line)
  })
  return doc
}

function open(
  start: HwpDocument = report(),
  on: (event: string, fn: () => void) => number = () => 0,
) {
  let doc = start
  const history: Uint8Array[] = []
  const host = {
    read: (fn: (d: never) => unknown) => fn(doc as never),
    transaction: (_label: string, fn: (tx: never) => unknown) => {
      const before = doc.exportHwp()
      try {
        const result = fn({ doc: () => doc, deferPagination: () => {} } as never)
        history.push(before)
        return result
      } catch (thrown) {
        doc = new HwpDocument(before)
        throw thrown
      }
    },
    events: { on },
    automation: { registerCommand: () => {}, execute: () => ({ ok: false }) },
  } as unknown as AgentPluginHost
  return { plugin: agentPlugin.activate(host), doc: () => doc, steps: () => history.length }
}

const ENTRIES = Array.from({ length: CHAPTERS }, (_, i) => [
  { find: `장 제목 ${i + 1}`, level: 1 },
  { find: `절 제목 ${i + 1}`, level: 2 },
]).flat()

/** The page the engine lays a body paragraph that starts with `text` out on. */
function pageOf(doc: HwpDocument, text: string): number {
  for (let k = 0; k < doc.getParagraphCount(0); k++) {
    if (doc.getTextRange(0, k, 0, doc.getParagraphLength(0, k)).startsWith(text)) {
      const at = JSON.parse(doc.getPageOfPosition(0, k)) as { page: number }
      return at.page + 1
    }
  }
  throw new Error(`no paragraph starts with ${text}`)
}

describe('making a table of contents', () => {
  it('lists the headings with the pages they are on once the contents are in place', () => {
    const { plugin, doc, steps } = open()
    const result = plugin.insertToc('보고서 제목', null, 'after', '차 례', ENTRIES)
    expect(result).toMatchObject({ ok: true, count: ENTRIES.length })
    expect(steps()).toBe(1)
    const table = plugin.readTable(1)
    if (!table.ok) throw new Error('no table')
    expect(table.rows).toBe(ENTRIES.length)
    expect(table.cols).toBe(2)
    const rows = Array.from({ length: table.rows }, (_, r) =>
      table.cells.filter((cell) => cell.row === r + 1).map((cell) => cell.text),
    )
    expect(rows[0]).toEqual(['1. 장 제목 1', String(pageOf(doc(), '1. 장 제목 1'))])
    expect(rows[ENTRIES.length - 1]).toEqual([
      `${CHAPTERS}.1 절 제목 ${CHAPTERS}`,
      String(pageOf(doc(), `${CHAPTERS}.1 절 제목 ${CHAPTERS}`)),
    ])
    expect(result.ok && result.pages.at(-1)).toBeGreaterThan(1)
    // the title line, then the table, right after the anchor
    expect(doc().getTextRange(0, 1, 0, doc().getParagraphLength(0, 1))).toBe('차 례')
  })

  it('goes before the anchor too, and without a title', () => {
    const { plugin } = open()
    const result = plugin.insertToc('1. 장 제목 1', null, 'before', null, ENTRIES.slice(0, 2))
    expect(result).toMatchObject({ ok: true, count: 2 })
    const table = plugin.readTable(1)
    expect(table.ok && table.cells.map((cell) => cell.text)).toEqual([
      '1. 장 제목 1',
      '1',
      '1.1 절 제목 1',
      '1',
    ])
  })

  it('names the heading it cannot use and changes nothing', () => {
    const { plugin, steps } = open()
    expect(
      plugin.insertToc('보고서 제목', null, 'after', '차 례', [{ find: '제목', level: 1 }]),
    ).toMatchObject({ ok: false, reason: 'no_heading', heading: '제목', why: 'ambiguous' })
    expect(
      plugin.insertToc('보고서 제목', null, 'after', '차 례', [{ find: '없는 제목', level: 1 }]),
    ).toMatchObject({ ok: false, reason: 'no_heading', why: 'not_found' })
    expect(steps()).toBe(0)
  })

  it('refuses entries without a level and too many of them', () => {
    const { plugin } = open()
    expect(() =>
      plugin.insertToc('보고서 제목', null, 'after', null, [{ find: '장 제목 1', level: 4 }]),
    ).toThrow()
    expect(() => plugin.insertToc('보고서 제목', null, 'after', null, [])).toThrow()
  })
})

describe('writing the page numbers again', () => {
  it('follows the headings after the document moved them, and touches nothing else', () => {
    const { plugin, doc } = open()
    plugin.insertToc('보고서 제목', null, 'after', '차 례', ENTRIES)
    // a page and more of text pushed in before the first chapter
    const at = 3
    for (let i = 0; i < 45; i++) doc().splitParagraph(0, at, doc().getParagraphLength(0, at))
    const result = plugin.refreshToc('차 례', null)
    expect(result).toMatchObject({ ok: true, lines: ENTRIES.length })
    expect(result.ok && result.changed).toBeGreaterThan(0)
    const table = plugin.readTable(1)
    if (!table.ok) throw new Error('no table')
    const pages = table.cells.filter((cell) => cell.col === 2).map((cell) => Number(cell.text))
    expect(pages[0]).toBe(pageOf(doc(), '1. 장 제목 1'))
    expect(pages.at(-1)).toBe(pageOf(doc(), `${CHAPTERS}.1 절 제목 ${CHAPTERS}`))
    // nothing more to change the second time
    expect(plugin.refreshToc('차 례', null)).toMatchObject({ ok: true, changed: 0 })
  })

  it('says when no table of contents follows the line', () => {
    const { plugin } = open()
    expect(plugin.refreshToc('보고서 제목', null)).toMatchObject({ ok: false, reason: 'no_toc' })
  })
})

/** The look of the first paragraph of a cell of the table in body paragraph `para`. */
function cellLook(doc: HwpDocument, para: number, cell: number) {
  const chars = JSON.parse(doc.getCellCharPropertiesAt(0, para, 0, cell, 0, 0)) as {
    fontFamily: string
    fontSize: number
  }
  const shape = JSON.parse(doc.getCellParaPropertiesAt(0, para, 0, cell, 0)) as {
    marginLeft: number
  }
  const style = (JSON.parse(doc.getCellStyleAt(0, para, 0, cell, 0)) as { name?: string }).name
  return { font: chars.fontFamily, size: chars.fontSize / 100, margin: shape.marginLeft, style }
}

/** The look of the start of body paragraph `para`. */
function paragraphLook(doc: HwpDocument, para: number) {
  const chars = JSON.parse(doc.getCharPropertiesAt(0, para, 0)) as {
    fontFamily: string
    fontSize: number
    bold: boolean
  }
  const shape = JSON.parse(doc.getParaPropertiesAt(0, para)) as { alignment: string }
  const style = (JSON.parse(doc.getStyleAt(0, para)) as { name?: string }).name
  return {
    font: chars.fontFamily,
    size: chars.fontSize / 100,
    bold: chars.bold,
    align: shape.alignment,
    style,
  }
}

describe('the look of a table of contents', () => {
  it('takes the 차례 styles of the document, not the look of the heading it follows', () => {
    const { plugin, doc } = open()
    // the anchor is a heading in 16pt bold
    doc().applyCharFormat(0, 0, 0, doc().getParagraphLength(0, 0), '{"fontSize":1600,"bold":true}')
    expect(
      plugin.insertToc('보고서 제목', null, 'after', '차 례', ENTRIES.slice(0, 2)),
    ).toMatchObject({ ok: true })
    expect(paragraphLook(doc(), 1)).toMatchObject({ size: 16, align: 'center', style: '차례 제목' })
    expect(paragraphLook(doc(), 2).style).toBe('바탕글')
    const first = cellLook(doc(), 2, 0)
    const second = cellLook(doc(), 2, 2)
    expect(first).toMatchObject({ size: 11, style: '차례 1' })
    expect(second).toMatchObject({ size: 11, style: '차례 2' })
    expect(second.margin).toBeGreaterThan(first.margin)
  })

  it('takes the body font without 차례 styles, with an indent for each level and a bold title', () => {
    const start = new HwpDocument(
      new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'generated-form-tables.hwpx'))),
    )
    const heading = (para: number) =>
      start.getTextRange(0, para, 0, start.getParagraphLength(0, para))
    const entries = [
      { find: heading(2), level: 1 },
      { find: heading(14), level: 2 },
    ]
    const { plugin, doc } = open(start)
    expect(plugin.insertToc(heading(2), null, 'after', '차 례', entries)).toMatchObject({
      ok: true,
    })
    // the heading is 함초롬돋움 11pt bold; the body text is 맑은 고딕 10pt
    expect(paragraphLook(doc(), 3)).toEqual({
      font: '맑은 고딕',
      size: 10,
      bold: true,
      align: 'center',
      style: '바탕글',
    })
    const first = cellLook(doc(), 4, 0)
    const second = cellLook(doc(), 4, 2)
    expect(first).toMatchObject({ font: '맑은 고딕', size: 10 })
    expect(second).toMatchObject({ font: '맑은 고딕', size: 10 })
    expect(second.margin).toBeGreaterThan(first.margin)
  })
})

describe('a second table of contents', () => {
  it('refuses a second table of contents and names the one there', () => {
    const { plugin, steps } = open()
    plugin.insertToc('보고서 제목', null, 'after', '차 례', ENTRIES.slice(0, 2))
    expect(plugin.insertToc('보고서 제목', null, 'after', '차 례', ENTRIES.slice(0, 4))).toEqual({
      ok: false,
      reason: 'toc_exists',
      count: 1,
      table: 1,
      title: '차 례',
    })
    expect(steps()).toBe(1)
  })

  it('still refuses it once a heading was renamed', () => {
    const { plugin, steps } = open()
    plugin.insertToc('보고서 제목', null, 'after', '차 례', ENTRIES.slice(0, 2))
    expect(plugin.replaceText('장 제목 1', '개요와 배경', 2)).toMatchObject({ ok: true })
    const before = steps()
    expect(
      plugin.insertToc('보고서 제목', null, 'after', '목 차', [
        { find: '1. 개요와 배경', level: 1 },
      ]),
    ).toMatchObject({ ok: false, reason: 'toc_exists', table: 1, title: '차 례' })
    expect(steps()).toBe(before)
  })

  it('still refuses it when a heading holds a tab or two spaces', () => {
    for (const heading of ['Ⅰ.\t개요', 'Ⅰ.  개요']) {
      const doc = HwpDocument.createEmpty()
      doc.createBlankDocument()
      ;['보고서', heading, '개요 본문이다.', 'Ⅱ. 결과', '결과 본문이다.'].forEach((line, k) => {
        if (k > 0) doc.splitParagraph(0, k - 1, doc.getParagraphLength(0, k - 1))
        doc.insertText(0, k, 0, line)
      })
      const { plugin, steps } = open(doc)
      const entries = [
        { find: heading, level: 1 },
        { find: 'Ⅱ. 결과', level: 1 },
      ]
      expect(plugin.insertToc('보고서', null, 'after', '차 례', entries)).toMatchObject({
        ok: true,
      })
      const before = steps()
      expect(plugin.insertToc('결과 본문', null, 'after', '목 차', entries)).toMatchObject({
        ok: false,
        reason: 'toc_exists',
        table: 1,
      })
      expect(steps()).toBe(before)
    }
  })

  it('still knows its table of contents once its lines and a page cell were changed', () => {
    const { plugin, steps } = withUserTable([['가', '나']])
    plugin.insertToc('보고서', null, 'after', '차 례', TWO)
    plugin.formatCells(1, null, { borders: [{ sides: 'bottom', line: 'dotted' }] })
    plugin.fillCells(1, [{ row: 2, col: 2, text: '1~2' }], true)
    const before = steps()
    expect(plugin.insertToc('결과 본문', null, 'after', '목 차', TWO)).toMatchObject({
      ok: false,
      reason: 'toc_exists',
      table: 1,
      title: '차 례',
    })
    expect(steps()).toBe(before)
  })

  it('names no line for contents right under a table, and its way leaves that table', () => {
    const doc = HwpDocument.createEmpty()
    doc.createBlankDocument()
    const lines = [
      '학교 현황',
      'Ⅰ. 학생 현황',
      '올해 학생 수는 늘었다.',
      'Ⅱ. 교사 현황',
      '끝 줄이다.',
    ]
    lines.forEach((text, k) => {
      if (k > 0) doc.splitParagraph(0, k - 1, doc.getParagraphLength(0, k - 1))
      doc.insertText(0, k, 0, text)
    })
    const { plugin, steps } = open(doc)
    plugin.insertTable('학교 현황', null, 'after', [
      ['학생 수', '328'],
      ['교사 수', '25'],
    ])
    const entries = [
      { find: 'Ⅰ. 학생 현황', level: 1 },
      { find: 'Ⅱ. 교사 현황', level: 1 },
    ]
    expect(plugin.insertToc('Ⅰ. 학생 현황', null, 'before', null, entries)).toMatchObject({
      ok: true,
      table: 2,
    })
    const before = steps()
    const again = entries.map((entry) => ({ ...entry, occurrence: 2 }))
    expect(plugin.insertToc('올해 학생', null, 'before', null, again)).toEqual({
      ok: false,
      reason: 'toc_exists',
      count: 1,
      table: 2,
    })
    expect(steps()).toBe(before)
    expect(plugin.deleteTable(2)).toMatchObject({ ok: true })
    expect(plugin.insertToc('Ⅰ. 학생 현황', null, 'before', null, entries)).toMatchObject({
      ok: true,
      table: 2,
    })
    const user = plugin.readTable(1)
    if (!user.ok) throw new Error('no table')
    expect(user.cells.map((cell) => cell.text)).toEqual(['학생 수', '328', '교사 수', '25'])
  })

  it('says when the contents it refuses for are the first paragraph of the document', () => {
    const doc = HwpDocument.createEmpty()
    doc.createBlankDocument()
    const lines = ['1. 추진 배경', '배경 본문이다.', '2. 추진 결과', '결과 본문이다.']
    lines.forEach((text, k) => {
      if (k > 0) doc.splitParagraph(0, k - 1, doc.getParagraphLength(0, k - 1))
      doc.insertText(0, k, 0, text)
    })
    const { plugin } = open(doc)
    const entries = [
      { find: '1. 추진 배경', level: 1 },
      { find: '2. 추진 결과', level: 1 },
    ]
    expect(plugin.insertToc('1. 추진 배경', null, 'before', null, entries)).toMatchObject({
      ok: true,
      table: 1,
    })
    const again = entries.map((entry) => ({ ...entry, occurrence: 2 }))
    expect(plugin.insertToc('1. 추진 배경', 2, 'before', null, again)).toEqual({
      ok: false,
      reason: 'toc_exists',
      count: 1,
      table: 1,
      first: true,
    })
  })

  it('refuses a second contents where Hangul wrote them as lines with a tab to the page', () => {
    const { plugin, doc, steps } = open()
    doc().splitParagraph(0, 0, doc().getParagraphLength(0, 0))
    doc().insertText(0, 1, 0, '차 례')
    doc().splitParagraph(0, 1, doc().getParagraphLength(0, 1))
    doc().insertText(0, 2, 0, '1. 장 제목 1	1')
    const before = steps()
    expect(plugin.insertToc('보고서 제목', null, 'after', '차 례', ENTRIES)).toEqual({
      ok: false,
      reason: 'toc_exists',
      count: 1,
      lines: true,
      title: '차 례',
    })
    expect(steps()).toBe(before)
  })

  it('makes the contents anew after the old table was removed, under the same title line', () => {
    const { plugin, doc } = open()
    plugin.insertToc('보고서 제목', null, 'after', '차 례', ENTRIES.slice(0, 2))
    expect(plugin.deleteTable(1)).toMatchObject({ ok: true })
    expect(plugin.insertToc('차 례', null, 'after', null, ENTRIES.slice(0, 4))).toMatchObject({
      ok: true,
      table: 1,
      tables: 1,
    })
    const table = plugin.readTable(1)
    if (!table.ok) throw new Error('no table')
    expect(table.cells.filter((cell) => cell.col === 1).map((cell) => cell.text)).toEqual([
      '1. 장 제목 1',
      '1.1 절 제목 1',
      '2. 장 제목 2',
      '2.1 절 제목 2',
    ])
    expect(doc().getTextRange(0, 1, 0, 3)).toBe('차 례')
  })
})

function withUserTable(rows: string[][], header = false, line = '평가 비율은 다음과 같다.') {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  const lines = ['보고서', 'Ⅰ. 개요', line, 'Ⅱ. 결과', '결과 본문이다.']
  lines.forEach((text, k) => {
    if (k > 0) doc.splitParagraph(0, k - 1, doc.getParagraphLength(0, k - 1))
    doc.insertText(0, k, 0, text)
  })
  const opened = open(doc)
  opened.plugin.insertTable(line, null, 'after', rows, header)
  return opened
}

const TWO = [
  { find: 'Ⅰ. 개요', level: 1 },
  { find: 'Ⅱ. 결과', level: 1 },
]

describe('refresh_toc on a table it did not make here', () => {
  it('leaves a count table as it is when its rows name no text of the body', () => {
    const { plugin, doc } = withUserTable(
      [
        ['학생', '328'],
        ['교사', '24'],
      ],
      false,
      '구성원 수',
    )
    const was = doc().exportHwp()
    expect(plugin.refreshToc('구성원 수', null)).toMatchObject({
      ok: true,
      lines: 2,
      changed: 0,
      missing: ['학생', '교사'],
    })
    expect(doc().exportHwp()).toEqual(was)
    expect(plugin.insertToc('보고서', null, 'after', '차 례', TWO)).toMatchObject({
      ok: true,
      table: 1,
      tables: 2,
    })
  })

  it('writes the pages of contents it did not make when every row names a heading', () => {
    const { plugin, doc } = withUserTable(
      [
        ['Ⅰ. 개요', '7'],
        ['Ⅱ. 결과', '9'],
      ],
      false,
      '차 례',
    )
    expect(plugin.refreshToc('차 례', null)).toMatchObject({ ok: true, lines: 2, changed: 2 })
    const table = plugin.readTable(1)
    if (!table.ok) throw new Error('no table')
    expect(table.cells.filter((cell) => cell.col === 2).map((cell) => cell.text)).toEqual([
      String(pageOf(doc(), 'Ⅰ. 개요')),
      String(pageOf(doc(), 'Ⅱ. 결과')),
    ])
  })

  it('writes the other rows of contents made before and names a heading renamed since', () => {
    const { plugin, doc } = withUserTable(
      [
        ['Ⅰ. 개요', '1'],
        ['Ⅱ. 결과', '1'],
        ['결과 본문', '1'],
      ],
      false,
      '차 례',
    )
    expect(plugin.replaceText('Ⅱ. 결과', 'Ⅱ. 실적', 2)).toMatchObject({ ok: true })
    expect(plugin.insertBreak('결과 본문', 2, 'page')).toMatchObject({ ok: true })
    expect(plugin.refreshToc('차 례', null)).toMatchObject({
      ok: true,
      lines: 3,
      changed: 1,
      missing: ['Ⅱ. 결과'],
    })
    const table = plugin.readTable(1)
    if (!table.ok) throw new Error('no table')
    expect(table.cells.filter((cell) => cell.col === 2).map((cell) => cell.text)).toEqual([
      '1',
      '1',
      String(pageOf(doc(), '결과 본문이다.')),
    ])
    expect(pageOf(doc(), '결과 본문이다.')).toBe(2)
  })

  it('takes a two-column table of numbers without lines for no table of contents', () => {
    const { plugin, doc } = withUserTable([
      ['출석', '10'],
      ['과제', '20'],
      ['시험', '70'],
    ])
    plugin.formatCells(1, null, { borders: [{ sides: 'all', line: 'none' }] })
    const was = doc().exportHwp()
    expect(plugin.refreshToc('평가 비율은', null)).toMatchObject({ ok: true, changed: 0 })
    expect(doc().exportHwp()).toEqual(was)
    expect(plugin.insertToc('보고서', null, 'after', '차 례', TWO)).toMatchObject({
      ok: true,
      table: 1,
    })
  })

  it('makes contents beside a table of page-like numbers under a 차례 line and leaves it', () => {
    const doc = HwpDocument.createEmpty()
    doc.createBlankDocument()
    const lines = [
      '학급 회의 보고',
      '1. 회의 안건',
      '차례',
      '2. 결정 사항',
      '김민수가 회장을 맡는다.',
    ]
    lines.forEach((text, k) => {
      if (k > 0) doc.splitParagraph(0, k - 1, doc.getParagraphLength(0, k - 1))
      doc.insertText(0, k, 0, text)
    })
    const { plugin, doc: now } = open(doc)
    plugin.insertTable('차례', null, 'after', [
      ['김민수', '1'],
      ['이서연', '2'],
      ['박지훈', '3'],
    ])
    const entries = [
      { find: '1. 회의 안건', level: 1 },
      { find: '2. 결정 사항', level: 1 },
    ]
    expect(plugin.insertToc('학급 회의 보고', null, 'after', '차 례', entries)).toMatchObject({
      ok: true,
      table: 1,
      tables: 2,
    })
    const was = now().exportHwp()
    expect(plugin.refreshToc('차례', null)).toMatchObject({
      ok: true,
      changed: 0,
      missing: ['이서연', '박지훈'],
    })
    expect(now().exportHwp()).toEqual(was)
    expect(plugin.insertToc('김민수가', null, 'after', '목 차', entries)).toMatchObject({
      ok: false,
      reason: 'toc_exists',
      table: 1,
      title: '차 례',
    })
  })
})

describe('contents this tool made, whatever line is above them', () => {
  const heads = ['Ⅰ. 개요', 'Ⅱ. 추진 결과', 'Ⅲ. 향후 계획']
  function reportOf(on?: (event: string, fn: () => void) => number) {
    const doc = HwpDocument.createEmpty()
    doc.createBlankDocument()
    const lines = ['사업 결과 보고서', heads[0], '개요 본문이다.', heads[1], '결과 본문이다.']
    lines.push(heads[2], '계획 본문이다.')
    lines.forEach((text, k) => {
      if (k > 0) doc.splitParagraph(0, k - 1, doc.getParagraphLength(0, k - 1))
      doc.insertText(0, k, 0, text)
    })
    return open(doc, on)
  }
  const entries = heads.map((find) => ({ find, level: 1 }))

  it('writes the pages again under any title or none', () => {
    for (const [title, line] of [
      ['목차 (Contents)', '목차 (Contents)'],
      [null, '사업 결과 보고서'],
    ] as const) {
      const { plugin, doc } = reportOf()
      expect(plugin.insertToc('사업 결과 보고서', null, 'after', title, entries)).toMatchObject({
        ok: true,
      })
      expect(plugin.insertBreak('Ⅲ. 향후 계획', 2, 'page')).toMatchObject({ ok: true })
      expect(plugin.refreshToc(line, null)).toMatchObject({ ok: true, lines: 3, changed: 1 })
      const table = plugin.readTable(1)
      if (!table.ok) throw new Error('no table')
      expect(table.cells.filter((cell) => cell.col === 2).map((cell) => cell.text)).toEqual([
        '1',
        '1',
        String(pageOf(doc(), 'Ⅲ. 향후 계획')),
      ])
      expect(pageOf(doc(), 'Ⅲ. 향후 계획')).toBe(2)
    }
  })

  it('refuses a second one past an empty line under the title, where refresh_toc finds none', () => {
    const { plugin, steps } = reportOf()
    plugin.insertToc('사업 결과 보고서', null, 'after', '차 례', entries)
    plugin.insertParagraphs('차 례', null, 'after', [''])
    expect(plugin.refreshToc('차 례', null)).toEqual({ ok: false, reason: 'no_toc', count: 0 })
    const before = steps()
    const again = entries.map((entry) => ({ ...entry, occurrence: 2 }))
    expect(plugin.insertToc('사업 결과 보고서', null, 'after', '차 례', again)).toEqual({
      ok: false,
      reason: 'toc_exists',
      count: 1,
      table: 1,
    })
    expect(steps()).toBe(before)
  })

  it('forgets them once another document is opened in the editor', () => {
    const handlers = new Map<string, () => void>()
    const { plugin } = reportOf((event, fn) => {
      handlers.set(event, fn)
      return 0
    })
    plugin.insertToc('사업 결과 보고서', null, 'after', '차 례', entries)
    handlers.get('document-swapped')?.()
    const again = entries.map((entry) => ({ ...entry, occurrence: 2 }))
    expect(plugin.insertToc('사업 결과 보고서', null, 'after', '차 례', again)).toMatchObject({
      ok: true,
      tables: 2,
    })
  })
})
