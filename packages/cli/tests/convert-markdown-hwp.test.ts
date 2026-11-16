import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { run, tempDir } from './helpers'

/**
 * Headings, a list, bold text and two tables whose cells wrap: the shape of a
 * Markdown note someone wants as a Hangul document.
 */
const MARKDOWN = [
  '# 도서관 이용 안내',
  '',
  '봄 학기 도서관 이용 방법을 정리했습니다.',
  '',
  '## 1. 기본 정보',
  '',
  '| 항목 | 내용 |',
  '| --- | --- |',
  '| 위치 | 본관 2층 동쪽 끝, 계단을 올라와 오른쪽 복도를 따라가면 보이는 유리문 안쪽 |',
  '| 여는 시간 | 평일 오전 9시부터 오후 6시까지이며 시험 기간에는 오후 9시까지 연장해서 엽니다 |',
  '| 문의 | library@example.com |',
  '',
  '## 2. 자리 안내',
  '',
  '자리는 **세 구역**으로 나뉩니다.',
  '',
  '1. 조용한 구역: 말소리를 내지 않습니다.',
  '2. 모둠 구역: 낮은 목소리로 이야기할 수 있습니다.',
  '',
  '| 번호 | 구역 | 지켜 주실 것 |',
  '| --- | --- | --- |',
  '| 1 | 조용한 구역 | 전화는 복도에서 받고, 자판 소리가 큰 기기는 모둠 구역에서 써 주세요 |',
  '| 2 | 모둠 구역 | 여섯 사람까지 한 탁자를 쓸 수 있습니다 |',
  '',
].join('\n')

const BODY = [
  '도서관 이용 안내',
  '봄 학기 도서관 이용 방법을 정리했습니다.',
  '1. 기본 정보',
  '',
  '2. 자리 안내',
  '자리는 세 구역으로 나뉩니다.',
  '조용한 구역: 말소리를 내지 않습니다.',
  '모둠 구역: 낮은 목소리로 이야기할 수 있습니다.',
  '',
  // the Word export ends a document whose last block is a table with an empty paragraph
  '',
]

beforeAll(async () => {
  const wasm = createRequire(import.meta.url).resolve('@rhwp/core/rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

function opened<T>(path: string, read: (doc: HwpDocument) => T): T {
  const doc = new HwpDocument(new Uint8Array(readFileSync(path)))
  try {
    return read(doc)
  } finally {
    doc.free()
  }
}

/** the body paragraphs of a written file; a table's paragraph has no text of its own */
const bodyTexts = (path: string): string[] =>
  opened(path, (doc) =>
    Array.from({ length: doc.getParagraphCount(0) }, (_, p) => {
      const length = doc.getParagraphLength(0, p)
      return length ? doc.getTextRange(0, p, 0, length) : ''
    }),
  )

function note(dir: string, name = 'guide.md', text = MARKDOWN): string {
  const path = join(dir, name)
  writeFileSync(path, text, 'utf8')
  return path
}

describe.each(['hwpx', 'hwp'] as const)('convert a Markdown file --to %s', (format) => {
  it('writes a Hangul document beside it with the same paragraphs and tables', async () => {
    const dir = tempDir()
    const input = note(dir)
    const r = await run(['convert', input, '--to', format, '--json'])
    expect(r.code).toBe(0)
    const json = r.json()
    expect(json).toMatchObject({ status: 'ok', command: 'convert' })
    expect(json.output_path).toBe(join(dir, `guide.${format}`))
    expect(json.warnings).toBeUndefined()
    expect(json.detail).toEqual({ title: 'guide', hwp_report: [] })
    const head = readFileSync(json.output_path).subarray(0, 4)
    expect([...head]).toEqual(
      format === 'hwpx' ? [0x50, 0x4b, 0x03, 0x04] : [0xd0, 0xcf, 0x11, 0xe0],
    )
    expect(bodyTexts(json.output_path)).toEqual(BODY)
    const tables = opened(json.output_path, (doc) =>
      [3, 8].map((p) => JSON.parse(doc.getTableDimensions(0, p, 0))),
    )
    expect(tables).toMatchObject([
      { rowCount: 4, colCount: 2 },
      { rowCount: 3, colCount: 3 },
    ])
  })

  it('leaves the Markdown file as it was and never writes over a file without --force', async () => {
    const dir = tempDir()
    const input = note(dir)
    const target = join(dir, `guide.${format}`)
    writeFileSync(target, 'keep')
    const r = await run(['convert', input, '--to', format, '--json'])
    expect(r.code).toBe(2)
    expect(r.json().error).toBe('output_exists')
    expect(readFileSync(target, 'utf8')).toBe('keep')
    expect((await run(['convert', input, '--to', format, '--force'])).code).toBe(0)
    expect(bodyTexts(target)).toEqual(BODY)
    expect(readFileSync(input, 'utf8')).toBe(MARKDOWN)
  })
})

describe('the tables of a Markdown file in Hangul', () => {
  it('get the look of a Hangul document, not the one of the Word export', async () => {
    const dir = tempDir()
    const input = note(dir)
    const out = join(dir, 'guide.hwpx')
    expect((await run(['convert', input, '--to', 'hwpx', '--json'])).code).toBe(0)
    const zip = await JSZip.loadAsync(readFileSync(out))
    const section = await zip.file('Contents/section0.xml')!.async('string')
    const tables = [...section.matchAll(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g)].map((m) => m[0])
    expect(tables).toHaveLength(2)
    for (const table of tables) {
      // between the paragraphs, divided at a row when a page ends, the header row repeated
      expect(table).toMatch(/<hp:tbl\b[^>]*pageBreak="TABLE"[^>]*repeatHeader="1"/)
      expect(table).toContain('treatAsChar="0"')
      // room above and below the text of every cell (1 mm is 283)
      const margins = [...table.matchAll(/<hp:cellMargin [^>]*top="(\d+)" bottom="(\d+)"/g)]
      expect(margins.length).toBeGreaterThan(0)
      expect(margins.every((m) => Number(m[1]) >= 283 && Number(m[2]) >= 283)).toBe(true)
    }
    // 항목 | 내용: the label column is as wide as its labels, the text takes the rest
    const widths = [...tables[0]!.matchAll(/<hp:cellSz width="(\d+)"/g)].map((m) => Number(m[1]))
    expect(widths[0]!).toBeLessThan(widths[1]! / 3)
  })

  it('a .docx of the same content keeps the widths Word has', async () => {
    const dir = tempDir()
    const input = note(dir)
    const docx = join(dir, 'guide.docx')
    expect((await run(['convert', input, '--to', 'docx', '--json'])).code).toBe(0)
    expect(
      (await run(['convert', docx, '--to', 'hwpx', '--out', join(dir, 'word.hwpx')])).code,
    ).toBe(0)
    const zip = await JSZip.loadAsync(readFileSync(join(dir, 'word.hwpx')))
    const section = await zip.file('Contents/section0.xml')!.async('string')
    const first = /<hp:tbl\b[\s\S]*?<\/hp:tbl>/.exec(section)![0]
    const widths = [...first.matchAll(/<hp:cellSz width="(\d+)"/g)].map((m) => Number(m[1]))
    expect(widths[0]).toBe(widths[1])
    // a Word table also runs over pages, and its header row stays as Word has it
    expect(first).toContain('treatAsChar="0"')
    expect(first).toContain('repeatHeader="0"')
  })
})

describe('convert Markdown to Hangul: the rest of the contract', () => {
  it('lists hwp and hwpx among the Markdown routes', async () => {
    const dir = tempDir()
    const r = await run(['convert', note(dir), '--to', 'hwt', '--json'])
    expect(r.code).toBe(1)
    expect(r.json().detail.supported).toMatch(/md→[^,]*\bhwp\b/)
    expect(r.json().detail.supported).toMatch(/md→[^,]*\bhwpx\b/)
    expect(r.json().detail.supported).toMatch(/markdown→[^,]*\bhwpx\b/)
  })

  it('takes the .markdown extension and --out', async () => {
    const dir = tempDir()
    const input = note(dir, 'guide.markdown')
    const out = join(dir, 'out', 'copy.hwpx')
    const r = await run(['convert', input, '--to', 'hwpx', '--out', out, '--json'])
    expect(r.code).toBe(0)
    expect(r.json().output_path).toBe(out)
    expect(existsSync(out)).toBe(true)
    expect(bodyTexts(out)).toEqual(BODY)
  })

  it('reports what Hangul does not carry, as for a Word document', async () => {
    const dir = tempDir()
    const input = note(dir, 'link.md', '# 제목\n\n[누리집](https://example.com) 을 봅니다.\n')
    const r = await run(['convert', input, '--to', 'hwpx', '--json'])
    expect(r.code).toBe(0)
    const json = r.json()
    expect(json.detail.hwp_report).toEqual([{ feature: 'hyperlink', kind: 'changed', count: 1 }])
    expect(json.warnings.map((w: { code: string }) => w.code)).toEqual(['hwp_changed'])
    expect(bodyTexts(json.output_path)).toContain('누리집 을 봅니다.')
  })
})
