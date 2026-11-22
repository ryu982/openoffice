/**
 * Differential equivalence risk suite (Track A: ieum-parse-sidecar vs TS fallback).
 * Runs the exact same fixture corpus through both GENOFFICE_PARSE_SIDECAR=0 (TS)
 * and GENOFFICE_PARSE_SIDECAR=1 (live compiled Rust sidecar) and asserts identical output.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  parseFileToText,
  resolveParseSidecarPath,
  stopParseSidecar,
  type ParsedFile,
} from '../src/index'

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

let workDir: string
const savedSidecarEnv = process.env.GENOFFICE_PARSE_SIDECAR

beforeAll(() => {
  const bin = resolveParseSidecarPath()
  expect(bin, 'compiled ieum-parse-sidecar binary must exist for risk tests').toBeTruthy()
  workDir = mkdtempSync(join(tmpdir(), 'ieum-risk-diff-'))
})

afterAll(() => {
  stopParseSidecar()
  if (savedSidecarEnv === undefined) delete process.env.GENOFFICE_PARSE_SIDECAR
  else process.env.GENOFFICE_PARSE_SIDECAR = savedSidecarEnv
  rmSync(workDir, { recursive: true, force: true })
})

function writeBytes(name: string, bytes: Uint8Array | string): string {
  const full = join(workDir, name)
  writeFileSync(full, bytes)
  return full
}

async function parseBoth(filePath: string): Promise<{ rust: ParsedFile; ts: ParsedFile }> {
  process.env.GENOFFICE_PARSE_SIDECAR = '0'
  const ts = await parseFileToText(filePath)
  process.env.GENOFFICE_PARSE_SIDECAR = '1'
  const rust = await parseFileToText(filePath)
  return { rust, ts }
}

async function buildDocxBytes(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'word/document.xml',
    `${XML_DECL}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      '<w:body>' +
      '<w:p><w:r><w:t>분기 보고서 2026 &amp; 요약</w:t></w:r></w:p>' +
      '<w:tbl><w:tr>' +
      '<w:tc><w:p><w:r><w:t>항목</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>금액</w:t></w:r></w:p></w:tc>' +
      '</w:tr><w:tr>' +
      '<w:tc><w:p><w:r><w:t>매출</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>1200</w:t></w:r></w:p></w:tc>' +
      '</w:tr></w:tbl>' +
      '</w:body></w:document>',
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function buildXlsxBytes(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    'xl/workbook.xml',
    `${XML_DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="요약" sheetId="1" r:id="rId1"/><sheet name="Data" sheetId="2" r:id="rId2"/></sheets></workbook>',
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'xl/sharedStrings.xml',
    `${XML_DECL}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">` +
      '<si><t>제품명</t></si><si><t>이음오피스</t></si></sst>',
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    `${XML_DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>수량</t></is></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>42</v></c></row>' +
      '</sheetData></worksheet>',
  )
  zip.file(
    'xl/worksheets/sheet2.xml',
    `${XML_DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
      '<row r="1"><c r="A1" t="str"><v>alpha</v></c><c r="B1"><v>3.14</v></c></row>' +
      '</sheetData></worksheet>',
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function buildPptxBytes(): Promise<Uint8Array> {
  const zip = new JSZip()
  const NS =
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  zip.file(
    'ppt/slides/slide1.xml',
    `${XML_DECL}<p:sld ${NS}><p:cSld><p:spTree><p:sp><p:txBody>` +
      '<a:p><a:r><a:t>발표 제목</a:t></a:r></a:p>' +
      '<a:p><a:r><a:t>핵심 지표 98%</a:t></a:r></a:p>' +
      '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  )
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2018/10/relationships/comments" Target="../comments/comment1.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'ppt/notesSlides/notesSlide1.xml',
    `${XML_DECL}<p:notes ${NS}><p:cSld><p:spTree><p:sp>` +
      '<p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody>' +
      '<a:p><a:r><a:t>발표자 메모 내용</a:t></a:r></a:p>' +
      '</p:txBody></p:sp></p:spTree></p:cSld></p:notes>',
  )
  zip.file(
    'ppt/comments/comment1.xml',
    `${XML_DECL}<p188:cmLst xmlns:p188="http://schemas.microsoft.com/office/powerpoint/2018/8/main" ` +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<p188:cm authorId="a1" created="2026-01-01T00:00:00Z">' +
      '<p188:txBody><a:p><a:r><a:t>검토 의견</a:t></a:r></a:p></p188:txBody>' +
      '</p188:cm></p188:cmLst>',
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function buildOdtBytes(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' })
  zip.file(
    'content.xml',
    `${XML_DECL}<office:document-content ` +
      'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
      'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
      'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">' +
      '<office:body><office:text>' +
      '<text:h text:outline-level="1">오픈도큐먼트 제목</text:h>' +
      '<text:p>본문 문단 <text:s text:c="2"/>테스트</text:p>' +
      '<table:table><table:table-row>' +
      '<table:table-cell><text:p>셀A</text:p></table:table-cell>' +
      '<table:table-cell><text:p>셀B</text:p></table:table-cell>' +
      '</table:table-row></table:table>' +
      '</office:text></office:body></office:document-content>',
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function buildEpubBytes(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `${XML_DECL}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
      '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
      '</container>',
  )
  zip.file(
    'OEBPS/content.opf',
    `${XML_DECL}<package xmlns="http://www.idpf.org/2007/opf" version="3.0">` +
      '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>전자책 시험</dc:title><dc:creator>홍길동</dc:creator></metadata>' +
      '<manifest>' +
      '<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>' +
      '</manifest>' +
      '<spine><itemref idref="ch1"/><itemref idref="ch2"/></spine></package>',
  )
  zip.file(
    'OEBPS/ch1.xhtml',
    '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>제1장</h1><p>첫 번째 본문입니다.</p></body></html>',
  )
  zip.file(
    'OEBPS/ch2.xhtml',
    '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>제2장</h1><p>두 번째 본문입니다.</p></body></html>',
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function buildXmindBytes(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    'content.json',
    JSON.stringify([
      {
        id: 'sheet-1',
        title: '전략 지도',
        rootTopic: {
          id: 'root',
          title: '2026 목표',
          notes: { plain: { content: '루트 메모' } },
          children: {
            attached: [
              { id: 'c1', title: '속도 개선' },
              { id: 'c2', title: '메모리 절감' },
            ],
          },
        },
      },
    ]),
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

describe('Track A differential equivalence (Rust sidecar vs TypeScript)', () => {
  it('matches TS output identically for docx', async () => {
    const file = writeBytes('diff.docx', await buildDocxBytes())
    const { rust, ts } = await parseBoth(file)
    expect(rust).toEqual(ts)
    expect(rust.ok).toBe(true)
    expect(rust.text).toContain('분기 보고서 2026 & 요약')
  })

  it('matches TS output identically for xlsx and xlsm', async () => {
    const bytes = await buildXlsxBytes()
    for (const ext of ['xlsx', 'xlsm']) {
      const file = writeBytes(`diff.${ext}`, bytes)
      const { rust, ts } = await parseBoth(file)
      expect(rust, ext).toEqual(ts)
      expect(rust.ok).toBe(true)
      expect(rust.text).toContain('이음오피스')
    }
  })

  it('matches TS output identically for pptx (slides, notes, modern comments)', async () => {
    const file = writeBytes('diff.pptx', await buildPptxBytes())
    const { rust, ts } = await parseBoth(file)
    expect(rust).toEqual(ts)
    expect(rust.ok).toBe(true)
    expect(rust.text).toContain('발표자 메모 내용')
    expect(rust.text).toContain('검토 의견')
  })

  it('matches TS output identically for odt', async () => {
    const file = writeBytes('diff.odt', await buildOdtBytes())
    const { rust, ts } = await parseBoth(file)
    expect(rust).toEqual(ts)
    expect(rust.ok).toBe(true)
    expect(rust.text).toContain('오픈도큐먼트 제목')
  })

  it('matches TS output identically for epub', async () => {
    const file = writeBytes('diff.epub', await buildEpubBytes())
    const { rust, ts } = await parseBoth(file)
    expect(rust).toEqual(ts)
    expect(rust.ok).toBe(true)
    expect(rust.text).toContain('첫 번째 본문입니다.')
    expect(rust.text).toContain('두 번째 본문입니다.')
  })

  it('matches TS output identically for xmind', async () => {
    const file = writeBytes('diff.xmind', await buildXmindBytes())
    const { rust, ts } = await parseBoth(file)
    expect(rust).toEqual(ts)
    expect(rust.ok).toBe(true)
    expect(rust.text).toContain('2026 목표')
    expect(rust.text).toContain('메모리 절감')
  })

  it('matches TS output identically for ZIP-based .doc files', async () => {
    const file = writeBytes('zip-backed.doc', await buildDocxBytes())
    const { rust, ts } = await parseBoth(file)
    expect(rust).toEqual(ts)
    expect(rust.ok).toBe(true)
    expect(rust.text).toContain('분기 보고서 2026 & 요약')
  })

  it('matches TS output identically for non-redacted plain/tabular formats (csv, tsv, xml, log, py)', async () => {
    const cases: Array<[string, string]> = [
      ['table.csv', '\uFEFFname,value\r\n한글,100\r\n"a,b",200\r\n'],
      ['table.tsv', 'col1\tcol2\n알파\t베타\n'],
      ['config.xml', '<root><item id="1">설정값</item></root>\n'],
      ['app.log', '2026-04-01 INFO started service\n2026-04-01 WARN retry=1\n'],
      ['script.py', '# sample\ndef greet(name: str) -> str:\n    return f"hello {name}"\n'],
    ]
    for (const [name, content] of cases) {
      const file = writeBytes(name, content)
      const { rust, ts } = await parseBoth(file)
      expect(rust, name).toEqual(ts)
      expect(rust.ok).toBe(true)
    }
  })
})
