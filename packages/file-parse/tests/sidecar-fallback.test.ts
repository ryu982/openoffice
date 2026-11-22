import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REDACT_EL, REDACT_NS } from '@genoffice/agent-core/redact-range'
import { REDACT_EXT_URI, setRedactExt } from '../../pptx-engine/src/redaction-xml'

vi.mock('../src/docx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/docx')>()
  return { ...actual, docxToText: vi.fn(actual.docxToText) }
})
vi.mock('../src/xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/xlsx')>()
  return { ...actual, xlsxToText: vi.fn(actual.xlsxToText) }
})
vi.mock('../src/pptx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/pptx')>()
  return { ...actual, pptxToText: vi.fn(actual.pptxToText) }
})
vi.mock('../src/odt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/odt')>()
  return { ...actual, odtToText: vi.fn(actual.odtToText) }
})
vi.mock('../src/epub', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/epub')>()
  return { ...actual, epubToText: vi.fn(actual.epubToText) }
})
vi.mock('../src/xmind', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/xmind')>()
  return { ...actual, xmindToText: vi.fn(actual.xmindToText) }
})
vi.mock('../src/doc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/doc')>()
  return { ...actual, docToText: vi.fn(actual.docToText) }
})
vi.mock('../src/ppt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ppt')>()
  return { ...actual, pptToText: vi.fn(actual.pptToText) }
})

import {
  ParseSidecarClient,
  SidecarInfraError,
  parseFileToText,
  stopParseSidecar,
} from '../src/index'
import { docToText } from '../src/doc'
import { docxToText } from '../src/docx'
import { epubToText } from '../src/epub'
import { odtToText } from '../src/odt'
import { pptToText } from '../src/ppt'
import { pptxToText } from '../src/pptx'
import { xlsxToText } from '../src/xlsx'
import { xmindToText } from '../src/xmind'
import {
  buildDocxFixture,
  buildPdfFixture,
  buildPptxFixture,
  buildXlsxFixture,
  TINY_PNG_BASE64,
  writeFixture,
} from './helpers/fixtures'

const savedEnv = {
  GENOFFICE_PARSE_SIDECAR: process.env.GENOFFICE_PARSE_SIDECAR,
  GENOFFICE_PARSE_SIDECAR_PATH: process.env.GENOFFICE_PARSE_SIDECAR_PATH,
}

function restoreEnv(): void {
  if (savedEnv.GENOFFICE_PARSE_SIDECAR === undefined) {
    delete process.env.GENOFFICE_PARSE_SIDECAR
  } else {
    process.env.GENOFFICE_PARSE_SIDECAR = savedEnv.GENOFFICE_PARSE_SIDECAR
  }
  if (savedEnv.GENOFFICE_PARSE_SIDECAR_PATH === undefined) {
    delete process.env.GENOFFICE_PARSE_SIDECAR_PATH
  } else {
    process.env.GENOFFICE_PARSE_SIDECAR_PATH = savedEnv.GENOFFICE_PARSE_SIDECAR_PATH
  }
}

async function zipBombBytes(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>',
  )
  const bytes = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
  const centralName = bytes.lastIndexOf(Buffer.from('xl/workbook.xml'))
  bytes.writeUInt32LE(600_000_000, centralName - 46 + 24)
  return new Uint8Array(bytes)
}

function encryptedOoxmlBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(64),
    Buffer.from('EncryptedPackage', 'utf16le'),
  ])
}

async function redactedPptxBytes(malformed = false): Promise<Uint8Array> {
  const xmlDecl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
  const slideNs =
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
  const rPr = malformed
    ? `<a:rPr><a:extLst><a:ext uri="${REDACT_EXT_URI}" xmlns:go="${REDACT_NS}"><${REDACT_EL}/></a:ext></a:extLst></a:rPr>`
    : setRedactExt('<a:rPr lang="en-US"/>', 'secret phone')
  const slide =
    `${xmlDecl}<p:sld ${slideNs}><p:cSld><p:spTree><p:sp><p:txBody><a:p>` +
    `<a:r><a:t>Call </a:t></a:r><a:r>${rPr}<a:t>555-0199</a:t></a:r>` +
    `</a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  const zip = new JSZip()
  zip.file('ppt/slides/slide1.xml', slide)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  stopParseSidecar()
  restoreEnv()
})

const sidecarDisabledByEnv =
  process.env.GENOFFICE_PARSE_SIDECAR?.trim().toLowerCase() === '0' ||
  process.env.GENOFFICE_PARSE_SIDECAR?.trim().toLowerCase() === 'off'

describe.skipIf(sidecarDisabledByEnv)(
  'parseFileToText: strict non-fallback on sidecar rejections',
  () => {
    it('never falls back to TS on zip_rejected', async () => {
      const bombPath = writeFixture('fallback-bomb.xlsx', await zipBombBytes())
      const res = await parseFileToText(bombPath)
      expect(res.ok).toBe(false)
      expect(res.kind).toBe('text')
      expect(res.error).toMatch(/600000000|uncompressed|zip/i)
      expect(xlsxToText).not.toHaveBeenCalled()
    })

    it('never falls back to TS on content_mismatch', async () => {
      const cases: Array<[string, ReturnType<typeof vi.fn>]> = [
        ['mismatch.docx', docxToText as unknown as ReturnType<typeof vi.fn>],
        ['mismatch.xlsx', xlsxToText as unknown as ReturnType<typeof vi.fn>],
        ['mismatch.pptx', pptxToText as unknown as ReturnType<typeof vi.fn>],
        ['mismatch.odt', odtToText as unknown as ReturnType<typeof vi.fn>],
        ['mismatch.epub', epubToText as unknown as ReturnType<typeof vi.fn>],
        ['mismatch.xmind', xmindToText as unknown as ReturnType<typeof vi.fn>],
      ]
      for (const [name, spy] of cases) {
        const res = await parseFileToText(writeFixture(name, 'not a zip file'))
        expect(res.ok, name).toBe(false)
        expect(res.kind, name).toBe('text')
        expect(res.error, name).toMatch(/Content mismatch/i)
        expect(spy, name).not.toHaveBeenCalled()
      }
    })

    it('never falls back to TS on password_protected', async () => {
      const path = writeFixture('locked.docx', encryptedOoxmlBytes())
      const res = await parseFileToText(path)
      expect(res.ok).toBe(false)
      expect(res.kind).toBe('text')
      expect(res.error).toMatch(/Password-protected/i)
      expect(docxToText).not.toHaveBeenCalled()
    })

    it('never falls back to TS on corrupt archive', async () => {
      const path = writeFixture(
        'corrupt.docx',
        Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xde, 0xad, 0xbe, 0xef]),
      )
      const res = await parseFileToText(path)
      expect(res.ok).toBe(false)
      expect(res.kind).toBe('text')
      expect(res.error).toBeTruthy()
      expect(docxToText).not.toHaveBeenCalled()
    })

    it('never falls back to TS on unsupported_encoding (UTF-32 BOM CSV)', async () => {
      const path = writeFixture(
        'utf32.csv',
        Buffer.from([0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x41]),
      )
      const res = await parseFileToText(path)
      expect(res.ok).toBe(false)
      expect(res.kind).toBe('text')
      expect(res.error).toMatch(/UTF-32/i)
    })

    it('uses sidecar without invoking TS extractors on clean Office documents', async () => {
      const docxRes = await parseFileToText(writeFixture('clean.docx', await buildDocxFixture()))
      expect(docxRes.ok).toBe(true)
      expect(docxRes.text).toContain('Annual Report')
      expect(docxToText).not.toHaveBeenCalled()

      const xlsxRes = await parseFileToText(writeFixture('clean.xlsx', await buildXlsxFixture()))
      expect(xlsxRes.ok).toBe(true)
      expect(xlsxRes.text).toContain('Alice')
      expect(xlsxToText).not.toHaveBeenCalled()

      const pptxRes = await parseFileToText(writeFixture('clean.pptx', await buildPptxFixture()))
      expect(pptxRes.ok).toBe(true)
      expect(pptxRes.text).toContain('ProductIntro')
      expect(pptxToText).not.toHaveBeenCalled()
    })
  },
)

describe('parseFileToText: allowed fallbacks and redaction boundary', () => {
  it('falls back to TS when GENOFFICE_PARSE_SIDECAR=0 or off', async () => {
    const extractSpy = vi.spyOn(ParseSidecarClient.prototype, 'extractFile')
    const path = writeFixture('env-off.docx', await buildDocxFixture())

    process.env.GENOFFICE_PARSE_SIDECAR = '0'
    const res0 = await parseFileToText(path)
    expect(res0.ok).toBe(true)
    expect(res0.text).toContain('Annual Report')
    expect(extractSpy).not.toHaveBeenCalled()
    expect(docxToText).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    process.env.GENOFFICE_PARSE_SIDECAR = 'OFF'
    const resOff = await parseFileToText(path)
    expect(resOff.ok).toBe(true)
    expect(extractSpy).not.toHaveBeenCalled()
    expect(docxToText).toHaveBeenCalledTimes(1)
  })

  it('falls back to TS when sidecar binary is missing', async () => {
    delete process.env.GENOFFICE_PARSE_SIDECAR
    process.env.GENOFFICE_PARSE_SIDECAR_PATH = join(
      writeFixture('placeholder.txt', 'x'),
      '..',
      'nonexistent-sidecar-binary.exe',
    )
    const path = writeFixture('missing-bin.docx', await buildDocxFixture())
    const res = await parseFileToText(path)
    expect(res.ok).toBe(true)
    expect(res.text).toContain('Annual Report')
    expect(docxToText).toHaveBeenCalledTimes(1)
  })

  it('falls back to TS when sidecar binary is unrunnable / crashes', async () => {
    delete process.env.GENOFFICE_PARSE_SIDECAR
    const badBin = writeFixture('fake-crash-sidecar.exe', 'not a valid executable')
    process.env.GENOFFICE_PARSE_SIDECAR_PATH = badBin

    const path = writeFixture('crash-bin.docx', await buildDocxFixture())
    const res = await parseFileToText(path)
    expect(res.ok).toBe(true)
    expect(res.text).toContain('Annual Report')
    expect(docxToText).toHaveBeenCalledTimes(1)
  })

  it('falls back to TS on SidecarInfraError (e.g. protocol mismatch)', async () => {
    delete process.env.GENOFFICE_PARSE_SIDECAR
    vi.spyOn(ParseSidecarClient.prototype, 'extractFile').mockRejectedValueOnce(
      new SidecarInfraError('Protocol version mismatch', 'protocol_mismatch'),
    )
    const path = writeFixture('infra-err.docx', await buildDocxFixture())
    const res = await parseFileToText(path)
    expect(res.ok).toBe(true)
    expect(res.text).toContain('Annual Report')
    expect(docxToText).toHaveBeenCalledTimes(1)
  })

  it('routes pptx with redaction_present to TS pptxToText and fails closed on broken marks', async () => {
    delete process.env.GENOFFICE_PARSE_SIDECAR
    const validPath = writeFixture('redacted-valid.pptx', await redactedPptxBytes(false))
    const validRes = await parseFileToText(validPath)
    expect(validRes).toEqual({
      ok: true,
      kind: 'text',
      text: '## Slide 1\nCall {{secret phone}}',
    })
    expect(pptxToText).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    const brokenPath = writeFixture('redacted-broken.pptx', await redactedPptxBytes(true))
    const brokenRes = await parseFileToText(brokenPath)
    expect(brokenRes.ok).toBe(false)
    expect(brokenRes.kind).toBe('text')
    expect(brokenRes.error).toMatch(/redaction/i)
    expect(JSON.stringify(brokenRes)).not.toContain('555-0199')
    expect(pptxToText).toHaveBeenCalledTimes(1)
  })

  it('uses sidecar directly for legacy OLE2 .doc and .ppt without calling TS extractors, and falls back only when disabled', async () => {
    delete process.env.GENOFFICE_PARSE_SIDECAR
    const legacyDoc = fileURLToPath(new URL('./fixtures/legacy-sample.doc', import.meta.url))
    const legacyPpt = fileURLToPath(new URL('./fixtures/legacy-sample.ppt', import.meta.url))

    const docRes = await parseFileToText(legacyDoc)
    expect(docRes.ok).toBe(true)
    expect(docRes.text).toContain('Legacy DOC body text')
    expect(docToText).not.toHaveBeenCalled()

    const pptRes = await parseFileToText(legacyPpt)
    expect(pptRes.ok).toBe(true)
    expect(pptRes.text).toContain('## Slide 1')
    expect(pptRes.text).toContain('Legacy PPT title')
    expect(pptToText).not.toHaveBeenCalled()

    // Explicit disable falls back to TS docToText / pptToText
    process.env.GENOFFICE_PARSE_SIDECAR = '0'
    const docFallback = await parseFileToText(legacyDoc)
    expect(docFallback).toEqual(docRes)
    expect(docToText).toHaveBeenCalledTimes(1)

    const pptFallback = await parseFileToText(legacyPpt)
    expect(pptFallback).toEqual(pptRes)
    expect(pptToText).toHaveBeenCalledTimes(1)
  })

  it('never invokes sidecar for redaction-bearing text/markup, pdf, or images', async () => {
    delete process.env.GENOFFICE_PARSE_SIDECAR
    const extractSpy = vi.spyOn(ParseSidecarClient.prototype, 'extractFile')

    const files: Array<[string, string | Uint8Array]> = [
      ['direct.md', '# Hello\n'],
      ['direct.markdown', '# Hello\n'],
      ['direct.txt', 'hello text'],
      ['direct.json', '{"a":1}'],
      ['direct.html', '<p>hello</p>'],
      ['direct.htm', '<p>hello</p>'],
      ['direct.pdf', buildPdfFixture('Hello PDF')],
      ['direct.png', Buffer.from(TINY_PNG_BASE64, 'base64')],
    ]

    for (const [name, content] of files) {
      const res = await parseFileToText(writeFixture(name, content))
      expect(res.ok, name).toBe(true)
    }

    expect(extractSpy).not.toHaveBeenCalled()
  })
})
