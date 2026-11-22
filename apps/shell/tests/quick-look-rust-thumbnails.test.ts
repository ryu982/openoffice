import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { deflateRawSync } from 'node:zlib'
import JSZip from 'jszip'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('cfb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('cfb')>()
  return { ...actual, read: vi.fn(actual.read) }
})

import * as CFB from 'cfb'
import {
  ParseSidecarClient,
  SidecarInfraError,
  getInteractiveParseSidecar,
  stopParseSidecar,
} from '@genoffice/file-parse'
import {
  ENCRYPTED as HWP5_ENCRYPTED,
  FILE_HEADER as HWP5_FILE_HEADER,
  SIGNATURE as HWP5_SIGNATURE,
  resetHwp5WasmForTests,
} from '../../hwp/src/main/hwp5-file'
import {
  clearQuickLookCache,
  extractEmbeddedThumbnail,
  extractEmbeddedThumbnailFromFile,
  extractQuickLook,
} from '../src/main/quick-look/extract'

const tempDirs: string[] = []
const savedEnv = {
  GENOFFICE_HWP5_WASM: process.env.GENOFFICE_HWP5_WASM,
  GENOFFICE_HWP5_WASM_PATH: process.env.GENOFFICE_HWP5_WASM_PATH,
  GENOFFICE_PARSE_SIDECAR: process.env.GENOFFICE_PARSE_SIDECAR,
  GENOFFICE_PARSE_SIDECAR_PATH: process.env.GENOFFICE_PARSE_SIDECAR_PATH,
}

function makeTempDir(prefix = 'ql-rust-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

const FAKE_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad, 0xbe, 0xef,
])
const FAKE_BMP = Buffer.from([
  0x42, 0x4d, 0x26, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1a, 0x00,
])
const FAKE_JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

function buildHwp5Fixture(opts: {
  prvImage?: Buffer
  encrypted?: boolean
  compressedPrvImage?: boolean
}): Buffer {
  const cfb = CFB.utils.cfb_new()
  const header = Buffer.alloc(256)
  header.write(HWP5_SIGNATURE, 0, 'latin1')
  header.writeUInt32LE(opts.encrypted ? HWP5_ENCRYPTED : 0, 36)
  CFB.utils.cfb_add(cfb, HWP5_FILE_HEADER, header)
  if (opts.prvImage) {
    const stream = opts.compressedPrvImage ? deflateRawSync(opts.prvImage) : opts.prvImage
    CFB.utils.cfb_add(cfb, '/PrvImage', stream)
  }
  return Buffer.from(CFB.write(cfb, { type: 'buffer' }) as Uint8Array)
}

async function buildZipBombWithThumb(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('docProps/thumbnail.png', FAKE_PNG)
  zip.file('word/media/bomb.bin', Buffer.alloc(1024 * 1024))
  const buf = (await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })) as Buffer
  const centralName = buf.lastIndexOf(Buffer.from('word/media/bomb.bin'))
  buf.writeUInt32LE(64, centralName - 46 + 24)
  return buf
}

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  clearQuickLookCache()
  resetHwp5WasmForTests()
  stopParseSidecar()
  restoreEnv()
})

afterAll(() => {
  stopParseSidecar()
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Quick Look HWP 5 thumbnail extraction via @genoffice/hwp5-wasm', () => {
  it('extracts uncompressed and raw-deflated /PrvImage via WASM without calling JS cfb', async () => {
    delete process.env.GENOFFICE_HWP5_WASM
    delete process.env.GENOFFICE_HWP5_WASM_PATH

    // Note: buildHwp5Fixture writes via SheetJS cfb (leaving 0xfffffffe padding),
    // proving inspectHwp5WithWasm normalizes unused FAT/MiniFAT slots inside WASM
    // without falling back to JS cfb.
    const plainHwp = buildHwp5Fixture({ prvImage: FAKE_PNG })
    const plainUrl = await extractEmbeddedThumbnail('hwp', plainHwp)
    expect(plainUrl).toBe(`data:image/png;base64,${FAKE_PNG.toString('base64')}`)
    expect(CFB.read).not.toHaveBeenCalled()

    const deflatedHwp = buildHwp5Fixture({ prvImage: FAKE_BMP, compressedPrvImage: true })
    const deflatedUrl = await extractEmbeddedThumbnail('hwp', deflatedHwp)
    expect(deflatedUrl).toBe(`data:image/bmp;base64,${FAKE_BMP.toString('base64')}`)
    expect(CFB.read).not.toHaveBeenCalled()
  })

  it('never falls back to JS cfb on corrupt or encrypted HWP 5 containers', async () => {
    delete process.env.GENOFFICE_HWP5_WASM
    delete process.env.GENOFFICE_HWP5_WASM_PATH

    const corruptOle = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 1, 2, 3])
    expect(await extractEmbeddedThumbnail('hwp', corruptOle)).toBeUndefined()
    expect(CFB.read).not.toHaveBeenCalled()

    const encryptedHwp = buildHwp5Fixture({ prvImage: FAKE_PNG, encrypted: true })
    expect(await extractEmbeddedThumbnail('hwp', encryptedHwp)).toBeUndefined()
    expect(CFB.read).not.toHaveBeenCalled()

    const missingPrv = buildHwp5Fixture({})
    expect(await extractEmbeddedThumbnail('hwp', missingPrv)).toBeUndefined()
    expect(CFB.read).not.toHaveBeenCalled()
  })

  it('falls back to JS cfb when GENOFFICE_HWP5_WASM=0|off or WASM binary is missing/invalid', async () => {
    const hwpBytes = buildHwp5Fixture({ prvImage: FAKE_PNG })

    process.env.GENOFFICE_HWP5_WASM = '0'
    resetHwp5WasmForTests()
    expect(await extractEmbeddedThumbnail('hwp', hwpBytes)).toBe(
      `data:image/png;base64,${FAKE_PNG.toString('base64')}`,
    )
    expect(CFB.read).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    process.env.GENOFFICE_HWP5_WASM = 'off'
    resetHwp5WasmForTests()
    expect(await extractEmbeddedThumbnail('hwp', hwpBytes)).toBe(
      `data:image/png;base64,${FAKE_PNG.toString('base64')}`,
    )
    expect(CFB.read).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    delete process.env.GENOFFICE_HWP5_WASM
    process.env.GENOFFICE_HWP5_WASM_PATH = join(makeTempDir(), 'missing-hwp5.wasm')
    resetHwp5WasmForTests()
    expect(await extractEmbeddedThumbnail('hwp', hwpBytes)).toBe(
      `data:image/png;base64,${FAKE_PNG.toString('base64')}`,
    )
    expect(CFB.read).toHaveBeenCalledTimes(1)
  })
})

describe('Quick Look ZIP thumbnail extraction via ieum-parse-sidecar', () => {
  it('extracts thumbnails for OOXML, ODT, XMind, and HWPX via sidecar without invoking JSZip', async () => {
    delete process.env.GENOFFICE_PARSE_SIDECAR
    const dir = makeTempDir()
    const loadSpy = vi.spyOn(JSZip, 'loadAsync')

    const cases: Array<{ ext: string; entry: string; img: Buffer; mime: string }> = [
      { ext: 'docx', entry: 'docProps/thumbnail.png', img: FAKE_PNG, mime: 'image/png' },
      { ext: 'pptx', entry: 'docProps/thumbnail.jpeg', img: FAKE_JPG, mime: 'image/jpeg' },
      { ext: 'xlsx', entry: 'docProps/thumbnail.png', img: FAKE_PNG, mime: 'image/png' },
      { ext: 'odt', entry: 'Thumbnails/thumbnail.png', img: FAKE_PNG, mime: 'image/png' },
      { ext: 'xmind', entry: 'Thumbnails/thumbnail.png', img: FAKE_PNG, mime: 'image/png' },
      { ext: 'hwpx', entry: 'Preview/PrvImage.bmp', img: FAKE_BMP, mime: 'image/bmp' },
    ]

    for (const c of cases) {
      const zip = new JSZip()
      zip.file(c.entry, c.img)
      const filePath = join(dir, `sample.${c.ext}`)
      writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
      const url = await extractEmbeddedThumbnailFromFile(filePath, c.ext)
      expect(url, c.ext).toBe(`data:${c.mime};base64,${c.img.toString('base64')}`)
    }

    expect(loadSpy).not.toHaveBeenCalled()
  })

  it('never falls back to JSZip on zip_rejected, corrupt, password_protected, or not_found', async () => {
    delete process.env.GENOFFICE_PARSE_SIDECAR
    const dir = makeTempDir()
    const loadSpy = vi.spyOn(JSZip, 'loadAsync')

    // 1. Real lying ZIP bomb
    const bombPath = join(dir, 'bomb.docx')
    writeFileSync(bombPath, await buildZipBombWithThumb())
    expect(await extractEmbeddedThumbnailFromFile(bombPath, 'docx')).toBeUndefined()
    expect(loadSpy).not.toHaveBeenCalled()

    // 2. Real corrupt ZIP
    const corruptPath = join(dir, 'corrupt.pptx')
    writeFileSync(corruptPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xde, 0xad, 0xbe, 0xef]))
    expect(await extractEmbeddedThumbnailFromFile(corruptPath, 'pptx')).toBeUndefined()
    expect(loadSpy).not.toHaveBeenCalled()

    // 3. Valid ZIP with no thumbnail
    const emptyZip = new JSZip()
    emptyZip.file('word/document.xml', '<w:document/>')
    const emptyPath = join(dir, 'empty.docx')
    writeFileSync(emptyPath, await emptyZip.generateAsync({ type: 'nodebuffer' }))
    expect(await extractEmbeddedThumbnailFromFile(emptyPath, 'docx')).toBeUndefined()
    expect(loadSpy).not.toHaveBeenCalled()

    // 4. Simulated password_protected rejectCode on a valid ZIP
    const validZip = new JSZip()
    validZip.file('docProps/thumbnail.png', FAKE_PNG)
    const validPath = join(dir, 'valid-but-rejected.docx')
    writeFileSync(validPath, await validZip.generateAsync({ type: 'nodebuffer' }))
    const spy = vi.spyOn(getInteractiveParseSidecar(), 'extractThumbnail').mockResolvedValueOnce({
      status: 'rejected',
      rejectCode: 'password_protected',
      message: 'Password-protected',
    })
    expect(await extractEmbeddedThumbnailFromFile(validPath, 'docx')).toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(loadSpy).not.toHaveBeenCalled()
  })

  it('falls back to JSZip only when GENOFFICE_PARSE_SIDECAR=0|off or on SidecarInfraError', async () => {
    const dir = makeTempDir()
    const zip = new JSZip()
    zip.file('docProps/thumbnail.png', FAKE_PNG)
    const filePath = join(dir, 'fallback.docx')
    writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
    const loadSpy = vi.spyOn(JSZip, 'loadAsync')

    process.env.GENOFFICE_PARSE_SIDECAR = '0'
    expect(await extractEmbeddedThumbnailFromFile(filePath, 'docx')).toBe(
      `data:image/png;base64,${FAKE_PNG.toString('base64')}`,
    )
    expect(loadSpy).toHaveBeenCalledTimes(1)

    loadSpy.mockClear()
    process.env.GENOFFICE_PARSE_SIDECAR = 'off'
    expect(await extractEmbeddedThumbnailFromFile(filePath, 'docx')).toBe(
      `data:image/png;base64,${FAKE_PNG.toString('base64')}`,
    )
    expect(loadSpy).toHaveBeenCalledTimes(1)

    loadSpy.mockClear()
    delete process.env.GENOFFICE_PARSE_SIDECAR
    vi.spyOn(ParseSidecarClient.prototype, 'extractThumbnail').mockRejectedValueOnce(
      new SidecarInfraError('Sidecar crashed', 'process_exited'),
    )
    expect(await extractEmbeddedThumbnailFromFile(filePath, 'docx')).toBe(
      `data:image/png;base64,${FAKE_PNG.toString('base64')}`,
    )
    expect(loadSpy).toHaveBeenCalledTimes(1)
  })

  it('previews a 60 MiB media-heavy DOCX in Quick Look via streaming sidecar with low latency', async () => {
    delete process.env.GENOFFICE_PARSE_SIDECAR
    const dir = makeTempDir()
    const zip = new JSZip()
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    )
    zip.file(
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    )
    zip.file(
      'word/document.xml',
      '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:p><w:r><w:t>LargeMediaQuickLook</w:t></w:r></w:p></w:body></w:document>',
    )
    zip.file('docProps/thumbnail.png', FAKE_PNG, { compression: 'DEFLATE' })
    zip.file('word/media/video.bin', Buffer.alloc(60 * 1024 * 1024), { compression: 'STORE' })

    const bigPath = join(dir, 'media-60m.docx')
    writeFileSync(bigPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }))

    const loadSpy = vi.spyOn(JSZip, 'loadAsync')
    const rssBefore = process.memoryUsage().rss
    const t0 = performance.now()
    const payload = await extractQuickLook(bigPath)
    const elapsedMs = performance.now() - t0
    const rssDeltaMb = (process.memoryUsage().rss - rssBefore) / (1024 * 1024)

    expect(payload.ok).toBe(true)
    expect(payload.thumbnailDataUrl).toBe(`data:image/png;base64,${FAKE_PNG.toString('base64')}`)
    expect(payload.plainText).toContain('LargeMediaQuickLook')
    expect(loadSpy).not.toHaveBeenCalled()
    expect(rssDeltaMb).toBeLessThan(64)
    expect(elapsedMs).toBeLessThan(10_000)
  }, 45_000)
})
