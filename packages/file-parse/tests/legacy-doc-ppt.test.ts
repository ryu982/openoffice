import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as CFB from 'cfb'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/doc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/doc')>()
  return { ...actual, docToText: vi.fn(actual.docToText) }
})
vi.mock('../src/ppt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ppt')>()
  return { ...actual, pptToText: vi.fn(actual.pptToText) }
})

import { docToText } from '../src/doc'
import { pptToText } from '../src/ppt'
import {
  ParseSidecarClient,
  SIDECAR_EXTS,
  SidecarInfraError,
  parseFileToText,
  stopParseSidecar,
  type ParsedFile,
} from '../src/index'
import { buildDocxFixture, writeFixture } from './helpers/fixtures'

function legacyFixture(name: string): string {
  return fileURLToPath(new URL(`fixtures/${name}`, import.meta.url))
}

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

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  stopParseSidecar()
  restoreEnv()
})

async function parseBoth(filePath: string): Promise<{ rust: ParsedFile; ts: ParsedFile }> {
  process.env.GENOFFICE_PARSE_SIDECAR = '0'
  const ts = await parseFileToText(filePath)
  process.env.GENOFFICE_PARSE_SIDECAR = '1'
  const rust = await parseFileToText(filePath)
  return { rust, ts }
}

function buildOleBuffer(streams: ReadonlyArray<readonly [string, Uint8Array]>): Buffer {
  const container = CFB.utils.cfb_new()
  for (const [name, data] of streams) {
    CFB.utils.cfb_add(container, name, Buffer.from(data))
  }
  return CFB.write(container, { type: 'buffer' }) as Buffer
}

function pptRecord(ver: number, inst: number, recType: number, payload: Uint8Array): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt16LE((ver & 0x0f) | (inst << 4), 0)
  header.writeUInt16LE(recType, 2)
  header.writeUInt32LE(payload.length, 4)
  return Buffer.concat([header, Buffer.from(payload)])
}

function buildSyntheticDocOle(opts: {
  nFib?: number
  flags?: number
  bodyText: string
  headerText?: string
  textboxText?: string
  corruptPieceOffset?: boolean
}): Buffer {
  const wordDoc = Buffer.alloc(512)
  wordDoc.writeUInt16LE(0xa5ec, 0)
  wordDoc.writeUInt16LE(opts.nFib ?? 0x00c1, 2)
  wordDoc.writeUInt16LE(opts.flags ?? 0x0200, 10) // 1Table by default

  let off = 32
  wordDoc.writeUInt16LE(14, off)
  off += 2 + 28
  wordDoc.writeUInt16LE(22, off)
  const lwStart = off + 2
  off = lwStart + 88
  wordDoc.writeUInt16LE(34, off)
  const pairsStart = off + 2

  const bodyBuf = Buffer.from(opts.bodyText, 'utf16le')
  const hdrBuf = Buffer.from(opts.headerText ?? '', 'utf16le')
  const txbxBuf = Buffer.from(opts.textboxText ?? '', 'utf16le')

  const bodyOff = wordDoc.length
  const hdrOff = bodyOff + bodyBuf.length
  const txbxOff = hdrOff + hdrBuf.length
  const fullWordDoc = Buffer.concat([wordDoc, bodyBuf, hdrBuf, txbxBuf])

  const cBody = opts.bodyText.length
  const cHdr = (opts.headerText ?? '').length
  const cTxbx = (opts.textboxText ?? '').length
  fullWordDoc.writeUInt32LE(cBody, lwStart + 3 * 4)
  fullWordDoc.writeUInt32LE(cHdr, lwStart + 5 * 4)
  fullWordDoc.writeUInt32LE(cTxbx, lwStart + 9 * 4)

  const pieces: Array<{ chars: number; byteOff: number }> = []
  if (cBody > 0) pieces.push({ chars: cBody, byteOff: opts.corruptPieceOffset ? 999_999 : bodyOff })
  if (cHdr > 0) pieces.push({ chars: cHdr, byteOff: hdrOff })
  if (cTxbx > 0) pieces.push({ chars: cTxbx, byteOff: txbxOff })

  const plcLen = 4 + pieces.length * 12
  const table = Buffer.alloc(1 + 4 + plcLen)
  table[0] = 0x02 // Pcdt
  table.writeUInt32LE(plcLen, 1)
  let cp = 0
  table.writeUInt32LE(0, 5)
  for (let i = 0; i < pieces.length; i++) {
    cp += pieces[i]!.chars
    table.writeUInt32LE(cp, 5 + (i + 1) * 4)
  }
  const pcdsStart = 5 + (pieces.length + 1) * 4
  for (let i = 0; i < pieces.length; i++) {
    table.writeUInt32LE(pieces[i]!.byteOff, pcdsStart + i * 8 + 2)
  }

  const pair33 = pairsStart + 33 * 8
  fullWordDoc.writeUInt32LE(0, pair33)
  fullWordDoc.writeUInt32LE(table.length, pair33 + 4)

  const tableName = ((opts.flags ?? 0x0200) & 0x0200) !== 0 ? '/1Table' : '/0Table'
  return buildOleBuffer([
    ['/WordDocument', fullWordDoc],
    [tableName, table],
  ])
}

function buildSyntheticPptWithNotes(): Buffer {
  const makeSp = (inner: Buffer, placeholderId?: number): Buffer => {
    const parts: Buffer[] = []
    if (placeholderId !== undefined) {
      const ph = Buffer.alloc(8)
      ph[4] = placeholderId
      parts.push(pptRecord(0xf, 0, 0xf011, pptRecord(0, 0, 0x0bc3, ph)))
    }
    parts.push(pptRecord(0, 0, 0xf00d, inner))
    return pptRecord(0xf, 0, 0xf004, Buffer.concat(parts))
  }
  const makeSlideAtom = (notesIdRef: number): Buffer => {
    const p = Buffer.alloc(24)
    p.writeUInt32LE(notesIdRef, 16)
    return pptRecord(2, 0, 0x03ef, p)
  }
  const makePersistAtom = (persistIdRef: number, slideId: number): Buffer => {
    const p = Buffer.alloc(20)
    p.writeUInt32LE(persistIdRef, 0)
    p.writeUInt32LE(slideId, 12)
    return pptRecord(0, 0, 0x03f3, p)
  }

  // Slide 1 with UTF-16LE Korean + CP1252 TextBytesAtom + linked Notes (id 500)
  const sp1 = makeSp(pptRecord(0, 0, 0x0fa0, Buffer.from('슬라이드 제목', 'utf16le')))
  const sp2 = makeSp(
    pptRecord(0, 0, 0x0fa8, Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x35])),
  )
  const s1Dg = pptRecord(0xf, 0, 0xf002, pptRecord(0xf, 0, 0xf003, Buffer.concat([sp1, sp2])))
  const slide1 = pptRecord(
    0xf,
    0,
    0x03ee,
    Buffer.concat([makeSlideAtom(500), pptRecord(0xf, 0, 0x040c, s1Dg)]),
  )

  // Notes for Slide 1
  const notesSp = makeSp(pptRecord(0, 0, 0x0fa0, Buffer.from('발표자 노트', 'utf16le')), 12)
  const notesDg = pptRecord(0xf, 0, 0xf002, pptRecord(0xf, 0, 0xf003, notesSp))
  const notesRec = pptRecord(0xf, 0, 0x03f0, pptRecord(0xf, 0, 0x040c, notesDg))

  const slwt0 = pptRecord(0xf, 0, 0x0ff0, makePersistAtom(2, 256))
  const slwt2 = pptRecord(0xf, 2, 0x0ff0, makePersistAtom(3, 500))
  const docRec = pptRecord(0xf, 0, 0x03e8, Buffer.concat([slwt0, slwt2]))

  const docOff = 0
  const slideOff = docRec.length
  const notesOff = slideOff + slide1.length
  const pdOff = notesOff + notesRec.length

  const pdPayload = Buffer.alloc(4 + 3 * 4)
  pdPayload.writeUInt32LE(((3 << 20) | 1) >>> 0, 0)
  pdPayload.writeUInt32LE(docOff, 4)
  pdPayload.writeUInt32LE(slideOff, 8)
  pdPayload.writeUInt32LE(notesOff, 12)
  const pdRec = pptRecord(0, 0, 0x1772, pdPayload)

  const ueaOff = pdOff + pdRec.length
  const ueaPayload = Buffer.alloc(28)
  ueaPayload.writeUInt32LE(0, 8)
  ueaPayload.writeUInt32LE(pdOff, 12)
  ueaPayload.writeUInt32LE(1, 16)
  const ueaRec = pptRecord(0, 0, 0x0ff5, ueaPayload)

  const pptDoc = Buffer.concat([docRec, slide1, notesRec, pdRec, ueaRec])

  const cuPayload = Buffer.alloc(20)
  cuPayload.writeUInt32LE(20, 0)
  cuPayload.writeUInt32LE(0xe391c05f, 4)
  cuPayload.writeUInt32LE(ueaOff, 8)
  cuPayload.writeUInt16LE(0x03f4, 14)
  cuPayload[16] = 3
  const cuRec = pptRecord(0, 0, 0x0ff6, cuPayload)

  return buildOleBuffer([
    ['/Current User', cuRec],
    ['/PowerPoint Document', pptDoc],
  ])
}

describe('parseFileToText: legacy .doc', () => {
  it('extracts body text from a Word 97-2003 document', async () => {
    const result = await parseFileToText(legacyFixture('legacy-sample.doc'))
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('text')
    expect(result.text).toContain('Legacy Report')
    expect(result.text).toContain('Legacy DOC body text')
    expect(result.text).toContain('Second paragraph from Word 97-2003.')
  })

  it('exposes the same text through docToText', async () => {
    const text = await docToText(await readFile(legacyFixture('legacy-sample.doc')))
    expect(text).toContain('Legacy Report')
    expect(text).toContain('Legacy DOC body text')
  })

  it('reads an uppercase .DOC extension through the same path', async () => {
    const path = writeFixture('upper.DOC', await readFile(legacyFixture('legacy-sample.doc')))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(true)
    expect(result.text).toContain('Legacy Report')
  })

  it('rejects a corrupt .doc with an error instead of throwing', async () => {
    const path = writeFixture('corrupt.doc', Buffer.from('not a legacy document'))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('text')
    expect(result.error).toBeTruthy()
  })

  it('rejects an empty .doc with an error instead of throwing', async () => {
    const path = writeFixture('empty.doc', Buffer.alloc(0))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('parseFileToText: legacy .ppt', () => {
  it('extracts one text section per slide from a PowerPoint 97-2003 presentation', async () => {
    const result = await parseFileToText(legacyFixture('legacy-sample.ppt'))
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('text')
    expect(result.text).toContain('## Slide 1')
    expect(result.text).toContain('Legacy PPT title')
    expect(result.text).toContain('First slide body')
    expect(result.text).toContain('## Slide 2')
    expect(result.text).toContain('Second legacy slide')
  })

  it('exposes the same text through pptToText', async () => {
    const text = await pptToText(await readFile(legacyFixture('legacy-sample.ppt')))
    expect(text).toContain('## Slide 1')
    expect(text).toContain('Legacy PPT title')
  })

  it('rejects a corrupt .ppt with an error instead of throwing', async () => {
    const path = writeFixture('corrupt.ppt', Buffer.from('not a legacy document'))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('text')
    expect(result.error).toBeTruthy()
  })

  it('rejects an empty .ppt with an error instead of throwing', async () => {
    const path = writeFixture('empty.ppt', Buffer.alloc(0))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('ieum-parse-sidecar: legacy .doc / .ppt differential, security, budget, and fallback', () => {
  it('includes both doc and ppt in SIDECAR_EXTS', () => {
    expect(SIDECAR_EXTS.has('doc')).toBe(true)
    expect(SIDECAR_EXTS.has('ppt')).toBe(true)
  })

  it('matches TS output identically for legacy-sample.doc, legacy-sample.ppt, and ZIP-backed .doc', async () => {
    const docPair = await parseBoth(legacyFixture('legacy-sample.doc'))
    expect(docPair.rust).toEqual(docPair.ts)
    expect(docPair.rust.ok).toBe(true)

    const pptPair = await parseBoth(legacyFixture('legacy-sample.ppt'))
    expect(pptPair.rust).toEqual(pptPair.ts)
    expect(pptPair.rust.ok).toBe(true)

    const zipDocPath = writeFixture('ooxml-under-doc.doc', await buildDocxFixture())
    const zipDocPair = await parseBoth(zipDocPath)
    expect(zipDocPair.rust).toEqual(zipDocPair.ts)
    expect(zipDocPair.rust.ok).toBe(true)
  })

  it('matches TS docToText on body + body textboxes while excluding headers', async () => {
    const syntheticDoc = writeFixture(
      'body-and-textbox.doc',
      buildSyntheticDocOle({
        bodyText: '본문 첫 줄\r본문 둘째 줄\r',
        headerText: '머리글 제외\r',
        textboxText: '텍스트상자 내용\r',
      }),
    )
    const { rust, ts } = await parseBoth(syntheticDoc)
    expect(rust).toEqual(ts)
    expect(rust.ok).toBe(true)
    expect(rust.text).toContain('본문 첫 줄')
    expect(rust.text).toContain('텍스트상자 내용')
    expect(rust.text).not.toContain('머리글 제외')
  })

  it('extracts UTF-16LE, CP1252 TextBytesAtom, and speaker notes from synthetic .ppt via sidecar', async () => {
    const pptPath = writeFixture('notes-cp1252.ppt', buildSyntheticPptWithNotes())
    const res = await parseFileToText(pptPath)
    expect(res.ok).toBe(true)
    expect(res.text).toBe('## Slide 1\n슬라이드 제목\nCafé €5\n### Notes\n발표자 노트')
    expect(pptToText).not.toHaveBeenCalled()
  })

  it('supports maxChars budget and tokenize:true via sidecar for .doc and .ppt', async () => {
    const client = new ParseSidecarClient({ idleTimeoutMs: null })
    try {
      const docZero = await parseFileToText(legacyFixture('legacy-sample.doc'), { maxChars: 0 })
      expect(docZero).toEqual({ ok: true, kind: 'text', text: '' })

      const pptZero = await parseFileToText(legacyFixture('legacy-sample.ppt'), { maxChars: 0 })
      expect(pptZero).toEqual({ ok: true, kind: 'text', text: '' })

      const docCapped = await parseFileToText(legacyFixture('legacy-sample.doc'), { maxChars: 13 })
      expect(docCapped).toEqual({ ok: true, kind: 'text', text: 'Legacy Report' })

      const docTok = await client.extractFile({
        path: legacyFixture('legacy-sample.doc'),
        ext: 'doc',
        tokenize: true,
      })
      expect(docTok.status).toBe('ok')
      if (docTok.status === 'ok') {
        expect(docTok.tokens?.bi).toContain('legacy')
      }

      const pptTok = await client.extractFile({
        path: legacyFixture('legacy-sample.ppt'),
        ext: 'ppt',
        tokenize: true,
      })
      expect(pptTok.status).toBe('ok')
      if (pptTok.status === 'ok') {
        expect(pptTok.tokens?.uni).toContain('slide')
      }
    } finally {
      await client.shutdown()
    }
  })

  it('strictly rejects encrypted, pre-97, corrupt, and mismatched .doc/.ppt without TS fallback', async () => {
    // 1. Encrypted .doc (FibBase.fEncrypted)
    const encDocPath = writeFixture(
      'encrypted.doc',
      buildSyntheticDocOle({ flags: 0x0300, bodyText: 'Secret\r' }),
    )
    // 2. Word 95 .doc (nFib < 0x00C1)
    const oldDocPath = writeFixture(
      'word95.doc',
      buildSyntheticDocOle({ nFib: 0x0065, bodyText: 'Old\r' }),
    )
    // 3. Out-of-bounds piece offset .doc
    const badPieceDocPath = writeFixture(
      'bad-piece.doc',
      buildSyntheticDocOle({ bodyText: 'Bad\r', corruptPieceOffset: true }),
    )
    // 4. Encrypted .ppt via CurrentUserAtom token 0xF3D1C4DF
    const encCu = Buffer.alloc(20)
    encCu.writeUInt32LE(0xf3d1c4df, 4)
    const encPptPath = writeFixture(
      'encrypted-cu.ppt',
      buildOleBuffer([
        ['/Current User', pptRecord(0, 0, 0x0ff6, encCu)],
        ['/PowerPoint Document', Buffer.alloc(0)],
      ]),
    )
    // 5. Encrypted .ppt via EncryptedSummary stream
    const encSummaryPptPath = writeFixture(
      'encrypted-summary.ppt',
      buildOleBuffer([
        ['/EncryptedSummary', Buffer.alloc(16)],
        ['/PowerPoint Document', Buffer.alloc(0)],
      ]),
    )
    // 6. Encrypted .ppt via RT_CryptSession10Container (0x2F14)
    const okCu = Buffer.alloc(20)
    okCu.writeUInt32LE(0xe391c05f, 4)
    okCu[16] = 3
    const crypt10PptPath = writeFixture(
      'encrypted-crypt10.ppt',
      buildOleBuffer([
        ['/Current User', pptRecord(0, 0, 0x0ff6, okCu)],
        ['/PowerPoint Document', pptRecord(0xf, 0, 0x2f14, Buffer.alloc(8))],
      ]),
    )
    // 7. PowerPoint 95 (PP40)
    const ppt95Path = writeFixture('ppt95.ppt', buildOleBuffer([['/PP40', Buffer.alloc(32)]]))
    // 8. ZIP disguised as .ppt -> content_mismatch
    const zip = new JSZip()
    zip.file('a.txt', 'hello')
    const zipPptPath = writeFixture(
      'zip-as-ppt.ppt',
      await zip.generateAsync({ type: 'uint8array' }),
    )

    const client = new ParseSidecarClient({ idleTimeoutMs: null })
    try {
      const cases: Array<[string, string, string]> = [
        [encDocPath, 'doc', 'password_protected'],
        [oldDocPath, 'doc', 'corrupt'],
        [badPieceDocPath, 'doc', 'corrupt'],
        [encPptPath, 'ppt', 'password_protected'],
        [encSummaryPptPath, 'ppt', 'password_protected'],
        [crypt10PptPath, 'ppt', 'password_protected'],
        [ppt95Path, 'ppt', 'corrupt'],
        [zipPptPath, 'ppt', 'content_mismatch'],
      ]
      for (const [filePath, ext, expectedCode] of cases) {
        const raw = await client.extractFile({ path: filePath, ext })
        expect(raw.status, filePath).toBe('rejected')
        if (raw.status === 'rejected') {
          expect(raw.rejectCode, filePath).toBe(expectedCode)
        }
        const parsed = await parseFileToText(filePath)
        expect(parsed.ok, filePath).toBe(false)
        expect(parsed.kind, filePath).toBe('text')
        expect(parsed.error, filePath).toBeTruthy()
      }
      expect(docToText).not.toHaveBeenCalled()
      expect(pptToText).not.toHaveBeenCalled()
    } finally {
      await client.shutdown()
    }
  })

  it('falls back to TS docToText and pptToText only on infra failures or GENOFFICE_PARSE_SIDECAR=0|off', async () => {
    const docPath = legacyFixture('legacy-sample.doc')
    const pptPath = legacyFixture('legacy-sample.ppt')

    // 1. Disabled via env
    process.env.GENOFFICE_PARSE_SIDECAR = 'off'
    expect((await parseFileToText(docPath)).ok).toBe(true)
    expect((await parseFileToText(pptPath)).ok).toBe(true)
    expect(docToText).toHaveBeenCalledTimes(1)
    expect(pptToText).toHaveBeenCalledTimes(1)

    // 2. Missing sidecar binary
    vi.clearAllMocks()
    delete process.env.GENOFFICE_PARSE_SIDECAR
    process.env.GENOFFICE_PARSE_SIDECAR_PATH = join(
      writeFixture('placeholder-legacy.txt', 'x'),
      '..',
      'missing-sidecar.exe',
    )
    expect((await parseFileToText(docPath)).ok).toBe(true)
    expect((await parseFileToText(pptPath)).ok).toBe(true)
    expect(docToText).toHaveBeenCalledTimes(1)
    expect(pptToText).toHaveBeenCalledTimes(1)

    // 3. Simulated SidecarInfraError (crash/protocol error)
    vi.clearAllMocks()
    delete process.env.GENOFFICE_PARSE_SIDECAR_PATH
    vi.spyOn(ParseSidecarClient.prototype, 'extractFile')
      .mockRejectedValueOnce(new SidecarInfraError('crash', 'process_exited'))
      .mockRejectedValueOnce(new SidecarInfraError('crash', 'process_exited'))
    expect((await parseFileToText(docPath)).ok).toBe(true)
    expect((await parseFileToText(pptPath)).ok).toBe(true)
    expect(docToText).toHaveBeenCalledTimes(1)
    expect(pptToText).toHaveBeenCalledTimes(1)
  })
})
