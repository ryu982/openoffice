import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parseFileToText } from '../src/index'
import { pdfToText } from '../src/pdf'
import {
  extractPdfTextWithPdfium,
  FPDF_ERR_FORMAT,
  FPDF_ERR_PASSWORD,
  FPDF_ERR_SECURITY,
  getPdfiumHeapSizeForTests,
  isPdfPdfiumDisabled,
  normalizePdfiumPageText,
  PdfDocumentError,
  PdfiumInfraError,
  resetPdfiumCacheForTests,
  resolvePdfiumWasmPath,
} from '../src/pdf-pdfium'
import { buildPdfFixture, writeFixture } from './helpers/fixtures'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function repoFixture(relPath: string): Uint8Array {
  return new Uint8Array(readFileSync(join(REPO_ROOT, relPath)))
}

function buildMultiPageAsciiPdf(streams: readonly string[]): Uint8Array {
  const pageIds = streams.map((_, idx) => 4 + idx * 2)
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${streams.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  for (let i = 0; i < streams.length; i++) {
    const contentId = 5 + i * 2
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    )
    bodies.push(`<< /Length ${streams[i]!.length} >>\nstream\n${streams[i]!}\nendstream`)
  }
  let out = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (let i = 0; i < bodies.length; i++) {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${bodies[i]!}\nendobj\n`
  }
  const xrefStart = out.length
  out += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= bodies.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return new TextEncoder().encode(out)
}

/** Builds a Type0/Identity-H PDF with an explicit ToUnicode CMap for Korean/Unicode tests. */
function buildToUnicodePdf(linesPerPage: readonly (readonly string[])[]): Uint8Array {
  const allCodePoints = [...new Set([...linesPerPage.flat().join('')])]
  const charToCid = new Map(allCodePoints.map((ch, idx) => [ch, idx + 1]))
  const bfchar = allCodePoints
    .map((ch, idx) => {
      const units = [...Array(ch.length).keys()]
        .map((k) => ch.charCodeAt(k).toString(16).padStart(4, '0'))
        .join('')
      return `<${(idx + 1).toString(16).padStart(4, '0')}> <${units}>`
    })
    .join('\n')
  const toUnicode = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    `${allCodePoints.length} beginbfchar`,
    bfchar,
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n')

  const encodeStr = (s: string) =>
    `<${[...s].map((ch) => charToCid.get(ch)!.toString(16).padStart(4, '0')).join('')}>`

  const streams = linesPerPage.map((lines) => {
    let y = 740
    return lines
      .map((line) => {
        const op = `BT /F1 10 Tf 36 ${y} Td ${encodeStr(line)} Tj ET`
        y -= 16
        return op
      })
      .join('\n')
  })

  const pageIds = streams.map((_, idx) => 7 + idx * 2)
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${streams.length} >>`,
    '<< /Type /Font /Subtype /Type0 /BaseFont /MalgunGothic /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 5 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /MalgunGothic /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 6 0 R /DW 600 >>',
    `<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}\nendstream`,
    '<< /Type /FontDescriptor /FontName /MalgunGothic /Flags 32 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>',
  ]
  for (let i = 0; i < streams.length; i++) {
    const contentId = 8 + i * 2
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    )
    bodies.push(`<< /Length ${streams[i]!.length} >>\nstream\n${streams[i]!}\nendstream`)
  }
  let out = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (let i = 0; i < bodies.length; i++) {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${bodies[i]!}\nendobj\n`
  }
  const xrefStart = out.length
  out += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= bodies.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return new TextEncoder().encode(out)
}

/** Builds a Korean PDF using the predefined UniKS-UTF16-H CMap with no ToUnicode stream. */
function buildKoreanPredefinedCMapPdf(text: string): Uint8Array {
  const hex = [...text].map((ch) => ch.charCodeAt(0).toString(16).padStart(4, '0')).join('')
  const stream = `BT /F1 12 Tf 72 720 Td <${hex}> Tj ET`
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [5 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /HYGoThic-Medium /Encoding /UniKS-UTF16-H /DescendantFonts [4 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYGoThic-Medium /CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 2 >> /DW 1000 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (let i = 0; i < bodies.length; i++) {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${bodies[i]!}\nendobj\n`
  }
  const xrefStart = out.length
  out += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= bodies.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return new TextEncoder().encode(out)
}

const savedEnv = {
  GENOFFICE_PDF_PDFIUM: process.env.GENOFFICE_PDF_PDFIUM,
  GENOFFICE_PDFIUM_WASM_PATH: process.env.GENOFFICE_PDFIUM_WASM_PATH,
  GENOFFICE_PDFIUM_WASM: process.env.GENOFFICE_PDFIUM_WASM,
}

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  resetPdfiumCacheForTests()
})

describe('pdf-pdfium: path resolution and env switches', () => {
  it('recognizes GENOFFICE_PDF_PDFIUM=0 and off (trimmed, case-insensitive)', () => {
    expect(isPdfPdfiumDisabled({})).toBe(false)
    expect(isPdfPdfiumDisabled({ GENOFFICE_PDF_PDFIUM: '1' })).toBe(false)
    expect(isPdfPdfiumDisabled({ GENOFFICE_PDF_PDFIUM: '0' })).toBe(true)
    expect(isPdfPdfiumDisabled({ GENOFFICE_PDF_PDFIUM: ' off ' })).toBe(true)
    expect(isPdfPdfiumDisabled({ GENOFFICE_PDF_PDFIUM: 'OFF' })).toBe(true)
  })

  it('resolves pdfium.wasm in precedence order: override -> cli env -> module -> resourcesPath -> cli bundle', () => {
    expect(
      resolvePdfiumWasmPath({
        env: {
          GENOFFICE_PDFIUM_WASM_PATH: '/override/pdfium.wasm',
          GENOFFICE_PDFIUM_WASM: '/cli/pdfium.wasm',
        },
      }),
    ).toBe('/override/pdfium.wasm')

    expect(
      resolvePdfiumWasmPath({
        env: { GENOFFICE_PDFIUM_WASM: '/cli/pdfium.wasm' },
      }),
    ).toBe('/cli/pdfium.wasm')

    const triedSpecifiers: string[] = []
    expect(
      resolvePdfiumWasmPath({
        env: {},
        resolveModule: (spec) => {
          triedSpecifiers.push(spec)
          if (spec === '@embedpdf/pdfium/pdfium.wasm')
            return '/nm/@embedpdf/pdfium/dist/pdfium.wasm'
          throw new Error('not exported')
        },
        exists: (p) => p === '/nm/@embedpdf/pdfium/dist/pdfium.wasm',
        resourcesPath: '/app/resources',
      }),
    ).toBe('/nm/@embedpdf/pdfium/dist/pdfium.wasm')
    expect(triedSpecifiers).toEqual([
      '@embedpdf/pdfium/dist/pdfium.wasm',
      '@embedpdf/pdfium/pdfium.wasm',
    ])

    const packagedPath = join('/app/resources', 'wasm', 'pdfium.wasm')
    expect(
      resolvePdfiumWasmPath({
        env: {},
        resolveModule: () => {
          throw new Error('no node_modules')
        },
        exists: (p) => p === packagedPath,
        resourcesPath: '/app/resources',
      }),
    ).toBe(packagedPath)

    const cliBundleDir = resolve('/app/resources/cli')
    const cliBundleWasm = resolve(cliBundleDir, '..', 'wasm', 'pdfium.wasm')
    expect(
      resolvePdfiumWasmPath({
        env: {},
        resolveModule: () => {
          throw new Error('no node_modules')
        },
        resourcesPath: undefined,
        moduleUrl: pathToFileURL(join(cliBundleDir, 'genoffice.cjs')).href,
        exists: (p) => p === cliBundleWasm,
      }),
    ).toBe(cliBundleWasm)

    expect(
      resolvePdfiumWasmPath({
        env: {},
        resolveModule: () => {
          throw new Error('missing')
        },
        resourcesPath: undefined,
        exists: () => false,
      }),
    ).toBeNull()
  })
})

describe('pdf-pdfium: text extraction, Korean CMap, and differential parity', () => {
  it('matches pdfjs-dist output on plain-sample.pdf and owner-only encrypted PDF', async () => {
    for (const rel of [
      'apps/pdf/tests/fixtures/plain-sample.pdf',
      'apps/pdf/tests/fixtures/enc-r5-owneronly.pdf',
    ]) {
      const bytes = repoFixture(rel)
      const pdfiumText = await extractPdfTextWithPdfium(bytes)

      process.env.GENOFFICE_PDF_PDFIUM = '0'
      const pdfjsText = await pdfToText(bytes)
      delete process.env.GENOFFICE_PDF_PDFIUM

      expect(pdfiumText).toBe(pdfjsText)
      expect(pdfiumText).toContain('Encrypted Edit Probe')
      expect(pdfiumText).toContain('Second paragraph for text comparison.')
    }
  })

  it('extracts multi-page text with blank-line separators and preserves empty pages', async () => {
    const pdf = buildMultiPageAsciiPdf([
      'BT /F1 12 Tf 72 720 Td (Page One) Tj ET',
      '',
      'BT /F1 12 Tf 72 720 Td (Page Three) Tj ET',
    ])
    const pdfiumText = await pdfToText(pdf)
    process.env.GENOFFICE_PDF_PDFIUM = '0'
    const pdfjsText = await pdfToText(pdf)
    expect(pdfiumText).toBe('Page One\n\n\n\nPage Three')
    expect(pdfiumText).toBe(pdfjsText)
  })

  it('returns empty string for a valid zero-page PDF', async () => {
    const pdf = buildMultiPageAsciiPdf([])
    expect(await pdfToText(pdf)).toBe('')
  })

  it('extracts Korean ToUnicode, UTF-16 surrogate emoji, and predefined UniKS-UTF16-H CMap', async () => {
    const unicodePdf = buildToUnicodePdf([
      ['안녕하세요 이음오피스 테스트입니다.', '두 번째 줄 12345 ABC 😀'],
      ['둘째 쪽 한국어 본문'],
    ])
    const unicodeText = await pdfToText(unicodePdf)
    expect(unicodeText).toBe(
      '안녕하세요 이음오피스 테스트입니다.\n두 번째 줄 12345 ABC 😀\n\n둘째 쪽 한국어 본문',
    )

    // Predefined Korean CMap (UniKS-UTF16-H) without embedded ToUnicode: PDFium decodes via built-in CMap.
    const cmapPdf = buildKoreanPredefinedCMapPdf('안녕하세요 한글 CMap 테스트')
    const cmapText = await pdfToText(cmapPdf)
    expect(cmapText).toBe('안녕하세요 한글 CMap 테스트')
  })

  it('strips PDFium line-end soft-hyphen markers (U+FFFE/U+0002) while preserving regular hyphens', async () => {
    expect(normalizePdfiumPageText('classi\u0002fication\r\nre\ufffesult\r\nfoo-bar\r')).toBe(
      'classification\nresult\nfoo-bar',
    )

    const pdf = buildMultiPageAsciiPdf([
      'BT /F1 12 Tf 72 720 Td (classi-) Tj 0 -14 Td (fication) Tj 0 -14 Td (well-known) Tj ET',
    ])
    const text = await pdfToText(pdf)
    expect(text).not.toContain('\u0002')
    expect(text).not.toContain('\ufffe')
    expect(text).toContain('classification')
    expect(text).toContain('well-known')
  })

  it('never mutates or detaches the caller Uint8Array', async () => {
    const pdf = buildPdfFixture('Immutable bytes check')
    const snapshot = new Uint8Array(pdf)
    const text = await pdfToText(pdf)
    expect(text).toBe('Immutable bytes check')
    expect(pdf.byteLength).toBe(snapshot.byteLength)
    expect(pdf).toEqual(snapshot)
  })
})

describe('pdf-pdfium: encrypted and corrupt PDF rejections (no pdfjs fallback)', () => {
  const passwordFixtures = [
    'apps/pdf/tests/fixtures/enc-r3-rc4.pdf',
    'apps/pdf/tests/fixtures/enc-r4-aes128.pdf',
    'apps/pdf/tests/fixtures/enc-r5-aes256.pdf',
    'apps/pdf/tests/fixtures/enc128.pdf',
    'apps/pdf/tests/fixtures/enc256.pdf',
    'apps/pdf/tests/fixtures/encrc4.pdf',
    'apps/shell/tests/fixtures/testPassword4Spaces.pdf',
  ]

  it('rejects password-protected PDFs with PdfDocumentError(password-required) and never falls back', async () => {
    for (const rel of passwordFixtures) {
      const bytes = repoFixture(rel)
      let thrown: unknown
      try {
        await pdfToText(bytes)
      } catch (err) {
        thrown = err
      }
      expect(thrown, rel).toBeInstanceOf(PdfDocumentError)
      const docErr = thrown as PdfDocumentError
      expect(docErr.code, rel).toBe('password-required')
      expect(docErr.fpdfError, rel).toBe(FPDF_ERR_PASSWORD)
      expect(docErr.message, rel).toMatch(/password/i)

      const parsed = await parseFileToText(join(REPO_ROOT, rel))
      expect(parsed.ok, rel).toBe(false)
      expect(parsed.error, rel).toMatch(/password/i)
    }
  })

  it('rejects certificate-encrypted PDFs with PdfDocumentError(unsupported) and never falls back', async () => {
    const rel = 'apps/shell/tests/fixtures/certEncrypted.pdf'
    const bytes = repoFixture(rel)
    let thrown: unknown
    try {
      await pdfToText(bytes)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(PdfDocumentError)
    const docErr = thrown as PdfDocumentError
    expect(docErr.code).toBe('unsupported')
    expect(docErr.fpdfError).toBe(FPDF_ERR_SECURITY)
    expect(docErr.message).toMatch(/encrypted/i)

    const parsed = await parseFileToText(join(REPO_ROOT, rel))
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toMatch(/encrypted/i)
  })

  it('rejects corrupt and empty PDFs with PdfDocumentError(corrupt) and never falls back', async () => {
    const cases: Array<[string, Uint8Array]> = [
      ['corruptExample.pdf', repoFixture('apps/shell/tests/fixtures/corruptExample.pdf')],
      ['garbage', new TextEncoder().encode('%PDF-1.4 garbage')],
      ['empty', new Uint8Array(0)],
    ]
    for (const [label, bytes] of cases) {
      let thrown: unknown
      try {
        await pdfToText(bytes)
      } catch (err) {
        thrown = err
      }
      expect(thrown, label).toBeInstanceOf(PdfDocumentError)
      const docErr = thrown as PdfDocumentError
      expect(docErr.code, label).toBe('corrupt')
      expect(docErr.fpdfError, label).toBe(FPDF_ERR_FORMAT)
    }
  })
})

describe('pdf-pdfium: infrastructure fallback and memory stability', () => {
  it('falls back to pdfjs-dist when GENOFFICE_PDF_PDFIUM=0 or off', async () => {
    const pdf = buildPdfFixture('Env disabled fallback')
    process.env.GENOFFICE_PDF_PDFIUM = '0'
    expect(await pdfToText(pdf)).toBe('Env disabled fallback')
    process.env.GENOFFICE_PDF_PDFIUM = 'off'
    expect(await pdfToText(pdf)).toBe('Env disabled fallback')
  })

  it('falls back to pdfjs-dist when pdfium.wasm path is missing or invalid', async () => {
    const pdf = buildPdfFixture('Missing wasm fallback')

    process.env.GENOFFICE_PDFIUM_WASM_PATH = join(REPO_ROOT, 'nonexistent-pdfium-binary.wasm')
    await expect(extractPdfTextWithPdfium(pdf)).rejects.toBeInstanceOf(PdfiumInfraError)
    expect(await pdfToText(pdf)).toBe('Missing wasm fallback')

    // Invalid WASM bytes trigger compile/init failure (PdfiumInfraError) -> safe fallback to pdfjs-dist.
    const badWasm = writeFixture('invalid-pdfium.wasm', Buffer.from('not-a-wasm-module'))
    process.env.GENOFFICE_PDFIUM_WASM_PATH = badWasm
    await expect(extractPdfTextWithPdfium(pdf)).rejects.toBeInstanceOf(PdfiumInfraError)
    expect(await pdfToText(pdf)).toBe('Missing wasm fallback')
  })

  it('keeps WASM heap stable across repeated extractions and rejections (no memory leak)', async () => {
    const multiPage = buildToUnicodePdf(
      Array.from({ length: 10 }, (_, p) =>
        Array.from(
          { length: 10 },
          (__, l) => `제${p + 1}쪽 문단 ${l + 1} PDFium 메모리 안정성 검사`,
        ),
      ),
    )
    const encrypted = repoFixture('apps/pdf/tests/fixtures/enc-r5-aes256.pdf')
    const corrupt = new TextEncoder().encode('%PDF-1.4 garbage')

    // Warm up allocator once before sampling baseline WASM linear memory size.
    await extractPdfTextWithPdfium(multiPage)
    const heapBefore = await getPdfiumHeapSizeForTests()
    expect(heapBefore).toBeGreaterThan(0)

    for (let i = 0; i < 100; i++) {
      const out = await extractPdfTextWithPdfium(multiPage)
      expect(out).toContain('제10쪽 문단 10')
    }
    for (let i = 0; i < 50; i++) {
      await expect(extractPdfTextWithPdfium(encrypted)).rejects.toBeInstanceOf(PdfDocumentError)
      await expect(extractPdfTextWithPdfium(corrupt)).rejects.toBeInstanceOf(PdfDocumentError)
    }

    const heapAfter = await getPdfiumHeapSizeForTests()
    expect(heapAfter).toBe(heapBefore)
  })

  it('extracts multi-page Korean+English PDF faster than pdfjs-dist with equivalent content', async () => {
    const multiPage = buildToUnicodePdf(
      Array.from({ length: 40 }, (_, p) =>
        Array.from(
          { length: 15 },
          (__, l) => `Page ${p + 1} Line ${l + 1}: 이음오피스 PDFium 텍스트 추출 벤치마크`,
        ),
      ),
    )

    // Warm both engines before timing.
    const warmPdfium = await pdfToText(multiPage)
    process.env.GENOFFICE_PDF_PDFIUM = '0'
    const warmPdfjs = await pdfToText(multiPage)
    delete process.env.GENOFFICE_PDF_PDFIUM

    expect(warmPdfium).toBe(warmPdfjs)

    const runs = 3
    const t0 = performance.now()
    for (let i = 0; i < runs; i++) await pdfToText(multiPage)
    const pdfiumMs = (performance.now() - t0) / runs

    process.env.GENOFFICE_PDF_PDFIUM = '0'
    const t1 = performance.now()
    for (let i = 0; i < runs; i++) await pdfToText(multiPage)
    const pdfjsMs = (performance.now() - t1) / runs

    expect(pdfiumMs).toBeLessThan(pdfjsMs)
  })
})
