// @vitest-environment jsdom
/**
 * The marks the plugin draws on the pages over the places it changed, against the real
 * rhwp engine. The editor's view (where pages sit, the zoom) is a stand-in: pages one under
 * another, 2000 pixels apart, 10 pixels from the left, at zoom 2.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { MARKS_EVENT, agentPlugin, type AgentPluginHost } from '../studio-plugin/agent-plugin.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

const PAGE_GAP = 2000
const PAGE_LEFT = 10
const ZOOM = 2

interface Rect {
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
}

function open(lines: string[]) {
  document.body.innerHTML = '<div id="scroll-container"><div id="scroll-content"></div></div>'
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  lines.forEach((line, k) => {
    if (k > 0) doc.splitParagraph(0, k - 1, doc.getParagraphLength(0, k - 1))
    doc.insertText(0, k, 0, line)
  })
  const listeners: (() => void)[] = []
  const commands = new Map<string, (services: unknown) => void>()
  const services = {
    getInputHandler: () => ({
      virtualScroll: {
        getPageOffset: (page: number) => page * PAGE_GAP,
        getPageLeftResolved: () => PAGE_LEFT,
      },
    }),
    getViewportManager: () => ({ getZoom: () => ZOOM }),
  }
  const host = {
    read: (fn: (d: never) => unknown) => fn(doc as never),
    transaction: (_label: string, fn: (tx: never) => unknown) => {
      const result = fn({ doc: () => doc, deferPagination: () => {} } as never)
      for (const listener of listeners) listener()
      return result
    },
    events: { on: (_name: string, handler: () => void) => listeners.push(handler) },
    automation: {
      registerCommand: (def: { id: string; execute: (services: unknown) => void }) =>
        commands.set(def.id, def.execute),
      execute: (id: string) => commands.get(id)?.(services) ?? null,
    },
  } as unknown as AgentPluginHost
  const plugin = agentPlugin.activate(host)
  /** an edit the user makes: the editor says the document changed */
  const userEdit = () => {
    doc.insertText(0, 0, 0, '손')
    for (const listener of listeners) listener()
  }
  return { plugin, doc, userEdit }
}

/** The marks on the page, as page rectangles again. */
function marksOnPage(): Rect[] {
  return [...document.querySelectorAll<HTMLElement>('.ieum-change-marks > div')].map((box) => {
    const top = parseFloat(box.style.top)
    const pageIndex = Math.floor(top / PAGE_GAP)
    return {
      pageIndex,
      x: Math.round((parseFloat(box.style.left) - PAGE_LEFT) / ZOOM),
      y: Math.round((top - pageIndex * PAGE_GAP) / ZOOM),
      width: Math.round(parseFloat(box.style.width) / ZOOM),
      height: Math.round(parseFloat(box.style.height) / ZOOM),
    }
  })
}

/** Where the engine lays out a run of a body paragraph, rounded as marksOnPage rounds. */
function rectsOf(doc: HwpDocument, para: number, start: number, end: number): Rect[] {
  return (JSON.parse(doc.getSelectionRects(0, para, start, para, end)) as Rect[]).map((r) => ({
    pageIndex: r.pageIndex,
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  }))
}

const textOf = (doc: HwpDocument, para: number) =>
  doc.getTextRange(0, para, 0, doc.getParagraphLength(0, para))

/** The first table of the body: the paragraph it sits in, and its first control. */
function firstTable(doc: HwpDocument): { para: number; control: number } {
  for (let para = 0; para < doc.getParagraphCount(0); para++) {
    const controls = (JSON.parse(doc.getControlTextPositions(0, para)) as unknown[]).length
    for (let control = 0; control < controls; control++) {
      try {
        doc.getTableBBox(0, para, control)
        return { para, control }
      } catch {
        // not a table
      }
    }
  }
  throw new Error('no table')
}

/** A paragraph of a cell of the first table, as engine calls address it. */
function cellOf(doc: HwpDocument, cell: number, cellPara: number) {
  const { para, control } = firstTable(doc)
  const path = JSON.stringify([{ controlIndex: control, cellIndex: cell, cellParaIndex: cellPara }])
  return {
    text: () =>
      doc.getTextInCellByPath(0, para, path, 0, doc.getCellParagraphLengthByPath(0, para, path)),
    rects: (start: number, end: number): Rect[] =>
      (
        JSON.parse(
          doc.getSelectionRectsInCellByPath(0, para, path, cellPara, start, cellPara, end),
        ) as Rect[]
      ).map((r) => ({
        pageIndex: r.pageIndex,
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      })),
  }
}

afterEach(() => {
  agentPlugin.deactivate?.()
})

describe('marks of changes', () => {
  it('marks the text a replacement put in', () => {
    const { plugin, doc } = open(['제출 기한은 3월 2일', '담당자: 홍길동'])
    plugin.replaceText('홍길동', '김철수', null)
    expect(marksOnPage()).toEqual(rectsOf(doc, 1, 5, 8))
  })

  it('marks every place of a replace-all, a later one in a paragraph where it moved to', () => {
    const { plugin, doc } = open(['가 가 가', '가'])
    plugin.replaceAllText('가', '나다')
    expect(textOf(doc, 0)).toBe('나다 나다 나다')
    expect(marksOnPage()).toEqual([
      ...rectsOf(doc, 0, 0, 2),
      ...rectsOf(doc, 0, 3, 5),
      ...rectsOf(doc, 0, 6, 8),
      ...rectsOf(doc, 1, 0, 2),
    ])
  })

  it('marks each paragraph it added, and moves the marks of earlier changes below them', () => {
    const { plugin, doc } = open(['첫째', '둘째', '셋째'])
    plugin.replaceText('셋째', '세 번째', null)
    plugin.insertParagraphs('첫째', null, 'after', ['새 하나', '새 둘'])
    expect(textOf(doc, 4)).toBe('세 번째')
    expect(marksOnPage()).toEqual([
      ...rectsOf(doc, 4, 0, 4),
      ...rectsOf(doc, 1, 0, 4),
      ...rectsOf(doc, 2, 0, 3),
    ])
  })

  it('marks nothing for a removed paragraph, and moves the marks below it up', () => {
    const { plugin, doc } = open(['첫째', '둘째', '셋째'])
    plugin.replaceText('둘째', '두 번째', null)
    plugin.replaceText('셋째', '세 번째', null)
    plugin.deleteParagraph('두 번째', null)
    expect(textOf(doc, 1)).toBe('세 번째')
    // the removed paragraph's mark went with it
    expect(marksOnPage()).toEqual(rectsOf(doc, 1, 0, 4))
  })

  it('moves the marks below in the same cell when paragraphs are added to a table cell', () => {
    const { plugin, doc } = open(['첫째'])
    plugin.insertTable('첫째', null, 'after', [
      ['알파', '베타'],
      ['감마', '델타'],
    ])
    plugin.insertParagraphs('알파', null, 'after', ['아래'])
    plugin.clearMarks()
    plugin.replaceText('아래', '아래쪽', null)
    plugin.replaceText('베타', '베타칸', null)
    plugin.insertParagraphs('알파', null, 'after', ['새 줄'])
    expect(cellOf(doc, 0, 1).text()).toBe('새 줄')
    expect(cellOf(doc, 0, 2).text()).toBe('아래쪽')
    expect(marksOnPage()).toEqual([
      // the paragraph that moved down in the cell, the other cell as it was, the new one
      ...cellOf(doc, 0, 2).rects(0, 3),
      ...cellOf(doc, 1, 0).rects(0, 3),
      ...cellOf(doc, 0, 1).rects(0, 4),
    ])
  })

  it('moves the marks below in the same cell up when a paragraph of the cell goes', () => {
    const { plugin, doc } = open(['첫째'])
    plugin.insertTable('첫째', null, 'after', [['알파', '베타']])
    plugin.insertParagraphs('알파', null, 'after', ['가운데', '아래', '끝'])
    plugin.clearMarks()
    plugin.replaceText('가운데', '가운데줄', null)
    plugin.replaceText('아래', '아래쪽', null)
    plugin.deleteParagraph('가운데줄', null)
    expect(cellOf(doc, 0, 1).text()).toBe('아래쪽')
    expect(cellOf(doc, 0, 2).text()).toBe('끝')
    // the removed paragraph's mark went with it, and none was left on 끝
    expect(marksOnPage()).toEqual(cellOf(doc, 0, 1).rects(0, 3))
  })

  it('takes the marks off when the panel asks, or when the user edits the document', () => {
    const first = open(['가격 표', '금액'])
    first.plugin.replaceText('금액', '합계', null)
    expect(marksOnPage().length).toBeGreaterThan(0)
    first.plugin.clearMarks()
    expect(marksOnPage()).toEqual([])

    const second = open(['가격 표', '금액'])
    second.plugin.replaceText('금액', '합계', null)
    second.userEdit()
    expect(marksOnPage()).toEqual([])
  })

  it('tells the app when the pages come to carry marks and when they lose them, so the panel can drop its button', () => {
    const told: unknown[] = []
    const listen = (event: Event) => told.push((event as CustomEvent<unknown>).detail)
    window.addEventListener(MARKS_EVENT, listen)
    try {
      const { plugin, userEdit } = open(['가격 표', '금액'])
      plugin.replaceText('금액', '합계', null)
      // a second mark changes nothing the app is told of
      plugin.replaceText('가격', '값', null)
      expect(told).toEqual([{ shown: true }])
      userEdit()
      expect(told).toEqual([{ shown: true }, { shown: false }])
      // an edit with no marks to take off says nothing
      userEdit()
      plugin.replaceText('값', '단가', null)
      plugin.clearMarks()
      expect(told).toEqual([{ shown: true }, { shown: false }, { shown: true }, { shown: false }])
      // a change that marks nothing (a removed paragraph) says nothing
      plugin.deleteParagraph('합계', null)
      expect(told).toHaveLength(4)
    } finally {
      window.removeEventListener(MARKS_EVENT, listen)
    }
  })

  it('draws the marks in the light colours of the shared mark tokens: the page is paper white in every theme', () => {
    // the first value of each is the light theme's
    const tokens = readFileSync(require.resolve('@genoffice/ui/tokens.css'), 'utf8')
    /** the first value of a token, as `rgb(r g b / a%)` writes it */
    const token = (name: string) => {
      const at = tokens.indexOf(`${name}:`)
      return tokens.slice(tokens.indexOf('rgb(', at) + 4, tokens.indexOf(')', at))
    }
    const rgba = (value: string) => {
      const [r, g, b, a] = value
        .split(/[\s/%]+/)
        .filter(Boolean)
        .map(Number)
      return `rgba(${r}, ${g}, ${b}, ${a! / 100})`
    }
    const { plugin } = open(['금액'])
    plugin.replaceText('금액', '합계', null)
    const box = document.querySelector<HTMLElement>('.ieum-change-marks > div')!
    // jsdom keeps the colour as it was set
    expect(box.style.background).toBe(rgba(token('--color-ai-changed-bg')))
    expect(box.style.boxShadow).toBe(`inset 0 -2px 0 ${rgba(token('--color-ai-changed-line'))}`)
  })

  it('gives the panel no list of marks in what a change returns', () => {
    const { plugin } = open(['가 가'])
    const result = plugin.replaceAllText('가', '나')
    expect(result).not.toHaveProperty('marks')
  })
})
