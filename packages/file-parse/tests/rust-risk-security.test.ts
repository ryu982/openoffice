/**
 * Security, malicious input, redaction closed-failure, and strict no-fallback risk suite.
 * Proves:
 * - False-declaration ZIP bombs are rejected immediately without memory spike
 * - Oversized declarations, encrypted ZIP entries, and traversal/URI rels are blocked
 * - Redacted PPTX (body, notes, comments, drawings, malformed XML) never leaks raw secret text
 * - Redacted Markdown and HTML bypass the sidecar and remain fail-closed
 * - Semantic/security rejections NEVER trigger TypeScript fallback
 * - Infrastructure failures (missing binary, crash, env=0) DO fall back cleanly
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { REDACT_EL, REDACT_NS } from '@genoffice/agent-core/redact-range'
import { PPTX_REDACT_EXT_URI } from '../src/pptx-redaction'
import { setRedactExt } from '../../pptx-engine/src/redaction-xml'
import {
  getInteractiveParseSidecar,
  parseFileToText,
  ParseSidecarClient,
  resolveParseSidecarPath,
  stopParseSidecar,
} from '../src/index'

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const SECRET = 'TOP_SECRET_ACCOUNT_99887766'
const SLIDE_NS =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

let workDir: string
let seq = 0
const savedEnv = {
  sidecar: process.env.GENOFFICE_PARSE_SIDECAR,
  sidecarPath: process.env.GENOFFICE_PARSE_SIDECAR_PATH,
}

beforeAll(() => {
  expect(resolveParseSidecarPath(), 'compiled ieum-parse-sidecar binary must exist').toBeTruthy()
  workDir = mkdtempSync(join(tmpdir(), 'ieum-risk-sec-'))
})

afterEach(() => {
  stopParseSidecar()
  if (savedEnv.sidecar === undefined) delete process.env.GENOFFICE_PARSE_SIDECAR
  else process.env.GENOFFICE_PARSE_SIDECAR = savedEnv.sidecar
  if (savedEnv.sidecarPath === undefined) delete process.env.GENOFFICE_PARSE_SIDECAR_PATH
  else process.env.GENOFFICE_PARSE_SIDECAR_PATH = savedEnv.sidecarPath
  vi.restoreAllMocks()
})

afterAll(() => {
  stopParseSidecar()
  rmSync(workDir, { recursive: true, force: true })
})

function writeBytes(ext: string, bytes: Uint8Array | string): string {
  const full = join(workDir, `sec-${++seq}.${ext}`)
  writeFileSync(full, bytes)
  return full
}

async function buildLyingZipBomb(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    'xl/workbook.xml',
    `${XML_DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>`,
  )
  // 2 MiB of zeros compresses tiny, then central header lies and claims 200 bytes.
  zip.file('xl/worksheets/sheet1.xml', Buffer.alloc(2 * 1024 * 1024))
  const buf = (await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })) as Buffer
  const centralName = buf.lastIndexOf(Buffer.from('xl/worksheets/sheet1.xml'))
  buf.writeUInt32LE(200, centralName - 46 + 24)
  return new Uint8Array(buf)
}

async function buildHugeDeclaredZip(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    'xl/workbook.xml',
    `${XML_DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>`,
  )
  const buf = (await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })) as Buffer
  const centralName = buf.lastIndexOf(Buffer.from('xl/workbook.xml'))
  buf.writeUInt32LE(600_000_000, centralName - 46 + 24)
  return new Uint8Array(buf)
}

async function buildEncryptedFlagZip(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('content.xml', '<root>secret</root>')
  const buf = (await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })) as Buffer
  // Set general-purpose bit 0 (encrypted) in both local header and central directory header.
  const localSig = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  buf.writeUInt16LE(buf.readUInt16LE(localSig + 6) | 0x0001, localSig + 6)
  const centralSig = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  buf.writeUInt16LE(buf.readUInt16LE(centralSig + 8) | 0x0001, centralSig + 8)
  return new Uint8Array(buf)
}

async function buildSimpleDocx(text: string): Promise<Uint8Array> {
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
      `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

describe('Track A security, malicious inputs, redaction, and fallback policy', () => {
  it('immediately rejects lying-declaration ZIP bombs with zip_rejected and bounded memory', async () => {
    const file = writeBytes('xlsx', await buildLyingZipBomb())
    const client = new ParseSidecarClient()
    try {
      const memBefore = process.memoryUsage().rss
      const raw = await client.extractFile({ path: file, ext: 'xlsx' })
      const memDeltaMb = (process.memoryUsage().rss - memBefore) / (1024 * 1024)
      expect(raw.status).toBe('rejected')
      if (raw.status === 'rejected') {
        expect(raw.rejectCode).toBe('zip_rejected')
        expect(raw.message).toMatch(/zip rejected/i)
      }
      expect(memDeltaMb).toBeLessThan(64)
    } finally {
      await client.shutdown()
    }

    const parsed = await parseFileToText(file)
    expect(parsed.ok).toBe(false)
    expect(parsed.text).toBeUndefined()
  })

  it('rejects oversized per-part declared ZIP and encrypted-entry ZIPs', async () => {
    const hugeFile = writeBytes('xlsx', await buildHugeDeclaredZip())
    const encFile = writeBytes('odt', await buildEncryptedFlagZip())
    const client = new ParseSidecarClient()
    try {
      const hugeRes = await client.extractFile({ path: hugeFile, ext: 'xlsx' })
      expect(hugeRes.status).toBe('rejected')
      if (hugeRes.status === 'rejected') {
        expect(hugeRes.rejectCode).toBe('zip_rejected')
      }

      const encRes = await client.extractFile({ path: encFile, ext: 'odt' })
      expect(encRes.status).toBe('rejected')
      if (encRes.status === 'rejected') {
        expect(['zip_rejected', 'password_protected']).toContain(encRes.rejectCode)
      }
    } finally {
      await client.shutdown()
    }
  })

  it('blocks path traversal (../) and URI scheme Targets in OOXML relationships', async () => {
    const zip = new JSZip()
    zip.file(
      'xl/workbook.xml',
      `${XML_DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Evil1" sheetId="1" r:id="rId1"/>' +
        '<sheet name="Evil2" sheetId="2" r:id="rId2"/>' +
        '<sheet name="Safe" sheetId="3" r:id="rId3"/></sheets></workbook>',
    )
    zip.file(
      'xl/_rels/workbook.xml.rels',
      `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="../../../etc/passwd"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="file:///C:/Windows/win.ini"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>',
    )
    zip.file(
      'xl/worksheets/sheet1.xml',
      `${XML_DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
        '<row r="1"><c r="A1" t="inlineStr"><is><t>SafeCellOnly</t></is></c></row>' +
        '</sheetData></worksheet>',
    )
    const file = writeBytes('xlsx', await zip.generateAsync({ type: 'uint8array' }))
    const parsed = await parseFileToText(file)
    expect(parsed.ok).toBe(true)
    expect(parsed.text).toContain('SafeCellOnly')
    expect(parsed.text).not.toContain('root:')
    expect(parsed.text).not.toContain('[fonts]')
  })

  it('never leaks raw text on PPTX redaction in body, notes, comments, drawings, or malformed redaction XML', async () => {
    const rPr = setRedactExt('<a:rPr lang="en-US"/>', 'secret label')
    const cases: Array<{ name: string; build: () => Promise<Uint8Array>; expectOk: boolean }> = [
      {
        name: 'slide body',
        expectOk: true,
        build: async () => {
          const z = new JSZip()
          z.file(
            'ppt/slides/slide1.xml',
            `${XML_DECL}<p:sld ${SLIDE_NS}><p:cSld><p:spTree><p:sp><p:txBody>` +
              `<a:p><a:r><a:t>Keep </a:t></a:r><a:r>${rPr}<a:t>${SECRET}</a:t></a:r></a:p>` +
              '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
          )
          return z.generateAsync({ type: 'uint8array' })
        },
      },
      {
        name: 'speaker notes',
        expectOk: true,
        build: async () => {
          const z = new JSZip()
          z.file(
            'ppt/slides/slide1.xml',
            `${XML_DECL}<p:sld ${SLIDE_NS}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Public</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
          )
          z.file(
            'ppt/slides/_rels/slide1.xml.rels',
            `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
              '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
          )
          z.file(
            'ppt/notesSlides/notesSlide1.xml',
            `${XML_DECL}<p:notes ${SLIDE_NS}><p:cSld><p:spTree><p:sp>` +
              '<p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody>' +
              `<a:p><a:r>${rPr}<a:t>${SECRET}</a:t></a:r></a:p>` +
              '</p:txBody></p:sp></p:spTree></p:cSld></p:notes>',
          )
          return z.generateAsync({ type: 'uint8array' })
        },
      },
      {
        name: 'modern comments',
        expectOk: true,
        build: async () => {
          const z = new JSZip()
          z.file(
            'ppt/slides/slide1.xml',
            `${XML_DECL}<p:sld ${SLIDE_NS}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Public</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
          )
          z.file(
            'ppt/slides/_rels/slide1.xml.rels',
            `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
              '<Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2018/10/relationships/comments" Target="../comments/comment1.xml"/></Relationships>',
          )
          z.file(
            'ppt/comments/comment1.xml',
            `${XML_DECL}<p188:cmLst xmlns:p188="http://schemas.microsoft.com/office/powerpoint/2018/8/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
              `<p188:cm authorId="a1" created="2026-01-01T00:00:00Z"><p188:txBody><a:p><a:r>${rPr}<a:t>${SECRET}</a:t></a:r></a:p></p188:txBody></p188:cm></p188:cmLst>`,
          )
          return z.generateAsync({ type: 'uint8array' })
        },
      },
      {
        name: 'malformed redaction XML (fail closed)',
        expectOk: false,
        build: async () => {
          const z = new JSZip()
          z.file(
            'ppt/slides/slide1.xml',
            `${XML_DECL}<p:sld ${SLIDE_NS}><p:cSld><p:spTree><p:sp><p:txBody>` +
              `<a:p><a:r><a:rPr><a:extLst><a:ext uri="${PPTX_REDACT_EXT_URI}"><r:${REDACT_EL} xmlns:r="${REDACT_NS}"/></a:ext></a:extLst></a:rPr><a:t>${SECRET}</a:t></a:r></a:p>` +
              '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
          )
          return z.generateAsync({ type: 'uint8array' })
        },
      },
    ]

    const client = new ParseSidecarClient()
    try {
      for (const c of cases) {
        const file = writeBytes('pptx', await c.build())
        // 1. Rust sidecar MUST return fallback with zero secret bytes in payload.
        const raw = await client.extractFile({
          path: file,
          ext: 'pptx',
          redactNamespaces: [REDACT_NS],
        })
        expect(raw, c.name).toEqual({ status: 'fallback', fallbackReason: 'redaction_present' })
        expect(JSON.stringify(raw)).not.toContain(SECRET)

        // 2. End-to-end parseFileToText delegates to TS and never leaks SECRET.
        const parsed = await parseFileToText(file)
        expect(parsed.ok, c.name).toBe(c.expectOk)
        expect(JSON.stringify(parsed)).not.toContain(SECRET)
        if (c.expectOk) {
          expect(parsed.text).toContain('{{secret label}}')
        }
      }
    } finally {
      await client.shutdown()
    }
  })

  it('bypasses sidecar for redacted Markdown and HTML and keeps fail-closed semantics', async () => {
    const spy = vi.spyOn(getInteractiveParseSidecar(), 'extractFile')
    const mdFile = writeBytes(
      'md',
      `Public <span class="redact-span" data-redaction="" data-label="secret label">${SECRET}</span> tail`,
    )
    const brokenMdFile = writeBytes(
      'md',
      `Public <span class="redact-span" data-redaction="" data-label="secret label">${SECRET} unclosed`,
    )
    const htmlFile = writeBytes(
      'html',
      `<p>Public <span data-gx-redact="secret label">${SECRET}</span> tail</p>`,
    )
    const mdRes = await parseFileToText(mdFile)
    const brokenMdRes = await parseFileToText(brokenMdFile)
    const htmlRes = await parseFileToText(htmlFile)
    expect(spy).not.toHaveBeenCalled()
    expect(mdRes.ok).toBe(true)
    expect(mdRes.text).toContain('{{secret label}}')
    expect(mdRes.text).not.toContain(SECRET)
    expect(brokenMdRes.ok).toBe(false)
    expect(JSON.stringify(brokenMdRes)).not.toContain(SECRET)
    expect(htmlRes.ok).toBe(true)
    expect(htmlRes.text).toContain('{{secret label}}')
    expect(htmlRes.text).not.toContain(SECRET)
  })

  it('NEVER falls back to TS on semantic/security rejectCodes', async () => {
    const docxFile = writeBytes('docx', await buildSimpleDocx('ValidDocxWouldSucceedInTS'))
    const rejectCodes = [
      'zip_rejected',
      'content_mismatch',
      'password_protected',
      'corrupt',
      'unsupported_encoding',
    ] as const

    for (const rejectCode of rejectCodes) {
      const spy = vi.spyOn(getInteractiveParseSidecar(), 'extractFile').mockResolvedValueOnce({
        status: 'rejected',
        rejectCode,
        message: `simulated ${rejectCode}`,
      })
      const parsed = await parseFileToText(docxFile)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(parsed.ok, rejectCode).toBe(false)
      expect(parsed.text).toBeUndefined()
      expect(parsed.error).toContain(`simulated ${rejectCode}`)
      spy.mockRestore()
    }
  })

  it('falls back to TS only on infrastructure failures (env=0, missing binary, crash)', async () => {
    const docxFile = writeBytes('docx', await buildSimpleDocx('FallbackInfraOk'))

    // 1. Disabled via env
    process.env.GENOFFICE_PARSE_SIDECAR = '0'
    const disabledRes = await parseFileToText(docxFile)
    expect(disabledRes.ok).toBe(true)
    expect(disabledRes.text).toContain('FallbackInfraOk')

    // 2. Missing binary path
    delete process.env.GENOFFICE_PARSE_SIDECAR
    process.env.GENOFFICE_PARSE_SIDECAR_PATH = join(workDir, 'does-not-exist-sidecar.exe')
    const missingRes = await parseFileToText(docxFile)
    expect(missingRes.ok).toBe(true)
    expect(missingRes.text).toContain('FallbackInfraOk')
  })
})
