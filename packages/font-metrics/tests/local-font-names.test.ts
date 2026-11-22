// Per-face SFNT metadata for the Hangul editor (local-font-names.ts).
// The main process reads only the name, OS/2 and head tables from disk so the
// HWP renderer never pulls gigabytes of font files through FontData.blob().
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildLocalFontNameIndex,
  localFontNamesFor,
  parseLocalFontMeta,
  resolveLocalFontNames,
  scanLocalFontFile,
  type ParsedLocalFontFace,
} from '../src/local-font-names'

const EN = 0x0409
const KO = 0x0412

interface NameRec {
  platform?: number
  encoding?: number
  lang?: number
  id: number
  text: string
}

function nameTable(records: NameRec[]): Buffer {
  const strings = records.map((r) => {
    const platform = r.platform ?? 3
    if (platform === 0 || platform === 3) {
      return Buffer.from(r.text, 'utf16le').swap16()
    }
    return Buffer.from(r.text, 'latin1')
  })
  const header = Buffer.alloc(6 + 12 * records.length)
  header.writeUInt16BE(records.length, 2)
  header.writeUInt16BE(header.length, 4)
  let off = 0
  records.forEach((r, i) => {
    const at = 6 + 12 * i
    const platform = r.platform ?? 3
    header.writeUInt16BE(platform, at)
    header.writeUInt16BE(r.encoding ?? (platform === 1 ? 0 : 1), at + 2)
    header.writeUInt16BE(r.lang ?? EN, at + 4)
    header.writeUInt16BE(r.id, at + 6)
    header.writeUInt16BE(strings[i]!.length, at + 8)
    header.writeUInt16BE(off, at + 10)
    off += strings[i]!.length
  })
  return Buffer.concat([header, ...strings])
}

function os2Table(weightClass: number, fsSelection: number, length = 64): Buffer {
  const buf = Buffer.alloc(length)
  if (length >= 6) buf.writeUInt16BE(weightClass, 4)
  if (length >= 64) buf.writeUInt16BE(fsSelection, 62)
  return buf
}

function headTable(macStyle: number, length = 54): Buffer {
  const buf = Buffer.alloc(length)
  if (length >= 46) buf.writeUInt16BE(macStyle, 44)
  return buf
}

/** Build a minimal standalone SFNT binary with the given tables. */
function buildSfnt(tables: Record<string, Buffer>, baseOffset = 0): Buffer {
  const entries = Object.entries(tables)
  const dirLen = 12 + 16 * entries.length
  const header = Buffer.alloc(dirLen)
  header.writeUInt32BE(0x00010000, 0)
  header.writeUInt16BE(entries.length, 4)
  const chunks: Buffer[] = [header]
  let dataOff = baseOffset + dirLen
  entries.forEach(([tag, body], i) => {
    const rec = 12 + 16 * i
    header.write(tag.padEnd(4, ' ').slice(0, 4), rec, 'latin1')
    header.writeUInt32BE(dataOff, rec + 8)
    header.writeUInt32BE(body.length, rec + 12)
    chunks.push(body)
    dataOff += body.length
  })
  return Buffer.concat(chunks)
}

/** Build a minimal TTC holding two faces whose table offsets point inside the TTC. */
function buildTtc(faces: Array<Record<string, Buffer>>): Buffer {
  const ttcHeaderLen = 12 + 4 * faces.length
  const ttcHeader = Buffer.alloc(ttcHeaderLen)
  ttcHeader.write('ttcf', 0, 'latin1')
  ttcHeader.writeUInt32BE(0x00010000, 4)
  ttcHeader.writeUInt32BE(faces.length, 8)
  const parts: Buffer[] = [ttcHeader]
  let cursor = ttcHeaderLen
  faces.forEach((tables, i) => {
    ttcHeader.writeUInt32BE(cursor, 12 + 4 * i)
    const faceBuf = buildSfnt(tables, cursor)
    parts.push(faceBuf)
    cursor += faceBuf.length
  })
  return Buffer.concat(parts)
}

describe('parseLocalFontMeta', () => {
  it('extracts Unicode families, styles, full names, PostScript names and OS/2 flags', () => {
    const parsed = parseLocalFontMeta(
      nameTable([
        { id: 1, lang: EN, text: 'Apple SD Gothic Neo' },
        { id: 1, lang: KO, text: '애플 SD 산돌고딕 Neo' },
        { id: 2, lang: EN, text: 'SemiBold' },
        { id: 4, lang: EN, text: 'Apple SD Gothic Neo SemiBold' },
        { id: 4, lang: KO, text: '애플 SD 산돌고딕 Neo SemiBold' },
        { id: 6, lang: EN, text: 'AppleSDGothicNeo-SemiBold' },
        { id: 16, lang: EN, text: 'Apple SD Gothic Neo' },
        { id: 17, lang: EN, text: 'SemiBold' },
      ]),
      os2Table(600, 0x0000),
      headTable(0),
    )

    expect(parsed.meta).toEqual({
      families: ['애플 SD 산돌고딕 Neo', 'Apple SD Gothic Neo'],
      fullNames: ['애플 SD 산돌고딕 Neo SemiBold', 'Apple SD Gothic Neo SemiBold'],
      postscriptNames: ['AppleSDGothicNeo-SemiBold'],
      styles: ['SemiBold'],
      weightClass: 600,
      italic: false,
    })
  })

  it('excludes legacy Mac platform names from output while indexing ASCII lookup keys', () => {
    const parsed = parseLocalFontMeta(
      nameTable([
        { platform: 1, encoding: 0, id: 1, text: 'MacLegacyFamily' },
        { platform: 1, encoding: 0, id: 6, text: 'MacLegacy-Regular' },
        { platform: 1, encoding: 3, id: 6, text: '\x81\x40broken' },
        { platform: 3, encoding: 1, id: 1, lang: KO, text: '한글글꼴' },
      ]),
      null,
      null,
    )

    expect(parsed.meta.families).toEqual(['한글글꼴'])
    expect(parsed.meta.postscriptNames).toEqual([])
    expect(parsed.lookupPostscriptNames).toEqual(['MacLegacy-Regular'])
  })

  it('falls back to head macStyle when OS/2 is missing or truncated', () => {
    const boldItalic = parseLocalFontMeta(null, null, headTable(0b11))
    expect(boldItalic.meta.weightClass).toBe(700)
    expect(boldItalic.meta.italic).toBe(true)

    const obliqueFromOs2 = parseLocalFontMeta(null, os2Table(500, 0x0200), headTable(0))
    expect(obliqueFromOs2.meta.weightClass).toBe(500)
    expect(obliqueFromOs2.meta.italic).toBe(true)

    // OS/2 has weightClass only (short table), italic falls back to head
    const partialOs2 = parseLocalFontMeta(null, os2Table(300, 0, 10), headTable(0b10))
    expect(partialOs2.meta.weightClass).toBe(300)
    expect(partialOs2.meta.italic).toBe(true)
  })

  it('survives truncated name, OS/2 and head buffers', () => {
    const table = nameTable([{ id: 1, lang: EN, text: 'Arial' }])
    expect(
      parseLocalFontMeta(table.subarray(0, 10), Buffer.alloc(2), Buffer.alloc(4)).meta,
    ).toEqual({
      families: [],
      fullNames: [],
      postscriptNames: [],
      styles: [],
    })
  })
})

describe('resolveLocalFontNames', () => {
  const regular = parseLocalFontMeta(
    nameTable([
      { id: 1, lang: EN, text: 'Malgun Gothic' },
      { id: 1, lang: KO, text: '맑은 고딕' },
      { id: 2, lang: EN, text: 'Regular' },
      { id: 4, lang: EN, text: 'Malgun Gothic' },
      { id: 4, lang: KO, text: '맑은 고딕' },
      { id: 6, lang: EN, text: 'MalgunGothic' },
    ]),
    os2Table(400, 0),
    null,
  )
  const bold = parseLocalFontMeta(
    nameTable([
      { id: 1, lang: EN, text: 'Malgun Gothic' },
      { id: 1, lang: KO, text: '맑은 고딕' },
      { id: 2, lang: EN, text: 'Bold' },
      { id: 4, lang: EN, text: 'Malgun Gothic Bold' },
      { id: 4, lang: KO, text: '맑은 고딕 Bold' },
      { id: 6, lang: EN, text: 'MalgunGothicBold' },
    ]),
    os2Table(700, 0),
    null,
  )
  const solo = parseLocalFontMeta(
    nameTable([
      { id: 1, lang: EN, text: 'Batang' },
      { id: 1, lang: KO, text: '바탕' },
      { id: 2, lang: EN, text: 'Regular' },
      { id: 4, lang: EN, text: 'Batang' },
      { id: 6, lang: EN, text: 'Batang' },
    ]),
    os2Table(400, 0),
    null,
  )
  const macKeyed = parseLocalFontMeta(
    nameTable([
      { platform: 1, encoding: 0, id: 6, text: 'AppleMyungjo' },
      { platform: 3, encoding: 1, id: 1, lang: KO, text: '애플명조' },
    ]),
    os2Table(400, 0),
    null,
  )
  const index = buildLocalFontNameIndex([regular, bold, solo, macKeyed])

  it('matches by PostScript name first, ignoring case and spacing', () => {
    const [hit] = resolveLocalFontNames(
      [{ postscriptName: '  MALGUNGOTHICBOLD ', family: 'Malgun Gothic' }],
      index,
    )
    expect(hit?.weightClass).toBe(700)
    expect(hit?.families).toContain('맑은 고딕')
  })

  it('falls back to unique fullName, family+style, or single-face family without guessing ambiguous styles', () => {
    const [byFull, byFamilyStyle, bySoloFamily, ambiguous, missing] = resolveLocalFontNames(
      [
        { fullName: 'Malgun Gothic Bold' },
        { family: 'Malgun Gothic', style: 'Regular' },
        { family: 'Batang' },
        { family: 'Malgun Gothic' },
        { postscriptName: 'NoSuchFont', family: 'NoSuchFont' },
      ],
      index,
    )
    expect(byFull?.postscriptNames).toEqual(['MalgunGothicBold'])
    expect(byFamilyStyle?.postscriptNames).toEqual(['MalgunGothic'])
    expect(bySoloFamily?.families).toContain('바탕')
    expect(ambiguous).toBeNull()
    expect(missing).toBeNull()
  })

  it('matches faces indexed by Mac Roman ASCII PostScript name', () => {
    const [hit] = resolveLocalFontNames([{ postscriptName: 'AppleMyungjo' }], index)
    expect(hit?.families).toEqual(['애플명조'])
  })

  it('merges aliases when two files share a PostScript name', () => {
    const a = parseLocalFontMeta(
      nameTable([
        { id: 1, lang: EN, text: 'HCR Batang' },
        { id: 6, lang: EN, text: 'HCRBatang' },
      ]),
      os2Table(400, 0),
      null,
    )
    const b = parseLocalFontMeta(
      nameTable([
        { id: 1, lang: KO, text: '함초롬바탕' },
        { id: 6, lang: EN, text: 'HCRBatang' },
      ]),
      os2Table(400, 0),
      null,
    )
    const [hit] = resolveLocalFontNames(
      [{ postscriptName: 'HCRBatang' }],
      buildLocalFontNameIndex([a, b]),
    )
    expect(hit?.families).toEqual(['함초롬바탕', 'HCR Batang'])
  })
})

describe('scanLocalFontFile', () => {
  it('reads standalone .ttf and multi-face .ttc files without reading the whole file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ieum-local-font-names-'))
    try {
      const ttfPath = join(dir, 'solo.ttf')
      writeFileSync(
        ttfPath,
        buildSfnt({
          name: nameTable([
            { id: 1, lang: EN, text: 'NanumGothic' },
            { id: 1, lang: KO, text: '나눔고딕' },
            { id: 6, lang: EN, text: 'NanumGothic' },
          ]),
          'OS/2': os2Table(400, 0),
          head: headTable(0),
        }),
      )

      const ttcPath = join(dir, 'pair.ttc')
      writeFileSync(
        ttcPath,
        buildTtc([
          {
            name: nameTable([
              { id: 1, lang: EN, text: 'PingFang KR' },
              { id: 1, lang: KO, text: '핑팡 KR' },
              { id: 2, lang: EN, text: 'Regular' },
              { id: 6, lang: EN, text: 'PingFangKR-Regular' },
            ]),
            'OS/2': os2Table(400, 0),
          },
          {
            name: nameTable([
              { id: 1, lang: EN, text: 'PingFang KR' },
              { id: 1, lang: KO, text: '핑팡 KR' },
              { id: 2, lang: EN, text: 'Semibold' },
              { id: 6, lang: EN, text: 'PingFangKR-Semibold' },
            ]),
            'OS/2': os2Table(600, 0),
          },
        ]),
      )

      const brokenPath = join(dir, 'broken.ttf')
      writeFileSync(brokenPath, Buffer.from('not a font'))

      const scanned: ParsedLocalFontFace[] = []
      scanLocalFontFile(ttfPath, scanned)
      scanLocalFontFile(ttcPath, scanned)
      scanLocalFontFile(brokenPath, scanned)
      scanLocalFontFile(join(dir, 'missing.ttf'), scanned)

      const index = buildLocalFontNameIndex(scanned)
      const [nanum, pfReg, pfSemi] = resolveLocalFontNames(
        [
          { postscriptName: 'NanumGothic' },
          { postscriptName: 'PingFangKR-Regular' },
          { postscriptName: 'PingFangKR-Semibold' },
        ],
        index,
      )

      expect(nanum?.families).toEqual(['나눔고딕', 'NanumGothic'])
      expect(pfReg?.families).toEqual(['핑팡 KR', 'PingFang KR'])
      expect(pfReg?.weightClass).toBe(400)
      expect(pfSemi?.weightClass).toBe(600)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('localFontNamesFor input guards', () => {
  it('returns an empty array for non-array or empty IPC inputs without scanning', async () => {
    expect(await localFontNamesFor(null)).toEqual([])
    expect(await localFontNamesFor('Arial')).toEqual([])
    expect(await localFontNamesFor([])).toEqual([])
  })
})
