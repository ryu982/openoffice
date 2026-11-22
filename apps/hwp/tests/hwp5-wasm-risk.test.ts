/**
 * Track B (hwp5-wasm) 4-pillar risk verification suite:
 * 1. Differential equivalence (WASM vs JS cfb fallback GENOFFICE_HWP5_WASM=0) across
 *    section tails, tab widths, field kinds, save preview, and tracked-changes stripping
 * 2. Strict @rhwp/core (rhwp_bg.wasm) reopen validation on every WASM-rewritten HWP 5 output
 * 3. OLE2 hygiene (' Sh33tJ5' absent, unused FAT/MiniFAT slots === 0xffffffff)
 * 4. Malformed / encrypted / distribution copy safe rejection with ZERO JS cfb fallback
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import init, { HwpDocument } from '@rhwp/core'
import { readStream as wasmReadStream } from '@genoffice/hwp5-wasm/node'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fieldKindsOf, restoreFieldKinds } from '../src/main/field-kinds'
import {
  DOC_INFO,
  SECTION,
  openHwp,
  pathsOf,
  resetHwp5WasmForTests,
  rewriteStreams,
  sectionCount,
  streamOf,
  writeContainer,
} from '../src/main/hwp5-file'
import { BLANK_PNG, writePreview } from '../src/main/preview-parts'
import { restoreSectionTails, sectionTailsOf } from '../src/main/section-tails'
import { newTabsOf, writeTabWidths } from '../src/main/tab-widths'
import { hasTrackedChanges, withoutTrackedChanges } from '../src/main/tracked-changes'

const cfbSpies = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
}))

vi.mock('cfb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('cfb')>()
  cfbSpies.read.mockImplementation(actual.read)
  cfbSpies.write.mockImplementation(actual.write)
  return {
    ...actual,
    read: cfbSpies.read,
    write: cfbSpies.write,
  }
})

const actualCfb = await vi.importActual<typeof import('cfb')>('cfb')
const require = createRequire(import.meta.url)

const savedEnv = {
  wasm: process.env.GENOFFICE_HWP5_WASM,
  wasmPath: process.env.GENOFFICE_HWP5_WASM_PATH,
}
const tempDirs: string[] = []

function restoreEnv(): void {
  if (savedEnv.wasm === undefined) delete process.env.GENOFFICE_HWP5_WASM
  else process.env.GENOFFICE_HWP5_WASM = savedEnv.wasm
  if (savedEnv.wasmPath === undefined) delete process.env.GENOFFICE_HWP5_WASM_PATH
  else process.env.GENOFFICE_HWP5_WASM_PATH = savedEnv.wasmPath
}

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

afterEach(() => {
  restoreEnv()
  resetHwp5WasmForTests()
  cfbSpies.read.mockClear()
  cfbSpies.write.mockClear()
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

function exportDoc(text: string): Uint8Array {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.insertText(0, 0, 0, text)
  const out = doc.exportHwp()
  doc.free()
  return out
}

function withBackend<T>(useWasm: boolean, fn: () => T): T {
  resetHwp5WasmForTests()
  process.env.GENOFFICE_HWP5_WASM = useWasm ? '1' : '0'
  try {
    return fn()
  } finally {
    restoreEnv()
    resetHwp5WasmForTests()
  }
}

function assertCleanOle2(bytes: Uint8Array): void {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // No SheetJS marker stream in raw bytes or directory paths
  expect(buf.includes(Buffer.from('Sh33tJ5', 'latin1'))).toBe(false)
  expect(buf.includes(Buffer.from('Sh33tJ5', 'utf16le'))).toBe(false)

  // Every unused FAT and MiniFAT slot must be FREESECT (0xffffffff)
  const sectorSize = 1 << buf.readUInt16LE(30)
  const miniSectorSize = 1 << buf.readUInt16LE(32)
  const fatPerSector = sectorSize / 4
  const totalSectors = (buf.length - sectorSize) / sectorSize
  expect(Number.isInteger(totalSectors)).toBe(true)
  const sectorAt = (index: number) => sectorSize + index * sectorSize
  const FREE = 0xffffffff
  const END_OF_CHAIN = 0xfffffffe

  const fatSectors: number[] = []
  for (let slot = 0; slot < 109; slot++) {
    const s = buf.readUInt32LE(76 + slot * 4)
    if (s < totalSectors) fatSectors.push(s)
  }
  for (let nth = 0; nth < fatSectors.length; nth++) {
    const base = sectorAt(fatSectors[nth]!)
    for (let slot = 0; slot < fatPerSector; slot++) {
      if (nth * fatPerSector + slot >= totalSectors) {
        expect(buf.readUInt32LE(base + slot * 4)).toBe(FREE)
      }
    }
  }

  const nextOf = (sector: number): number => {
    const fIdx = Math.floor(sector / fatPerSector)
    const fSec = fatSectors[fIdx]!
    return buf.readUInt32LE(sectorAt(fSec) + (sector % fatPerSector) * 4)
  }
  const firstDir = buf.readUInt32LE(48)
  const rootMiniBytes = buf.readUInt32LE(sectorAt(firstDir) + 120)
  const totalMiniSectors = Math.ceil(rootMiniBytes / miniSectorSize)
  let miniFat = buf.readUInt32LE(60)
  let nth = 0
  while (miniFat < totalSectors && miniFat !== END_OF_CHAIN && miniFat !== FREE) {
    const base = sectorAt(miniFat)
    for (let slot = 0; slot < fatPerSector; slot++) {
      if (nth * fatPerSector + slot >= totalMiniSectors) {
        expect(buf.readUInt32LE(base + slot * 4)).toBe(FREE)
      }
    }
    miniFat = nextOf(miniFat)
    nth++
  }
}

function record(tag: number, level: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4)
  head.writeUInt32LE((tag | (level << 10) | (payload.length << 20)) >>> 0)
  return Buffer.concat([head, payload])
}

function longChar(code: number, kind: string): Buffer {
  const unit = Buffer.alloc(16)
  unit.writeUInt16LE(code, 0)
  unit.write(kind, 2, 'latin1')
  unit.writeUInt16LE(code, 14)
  return unit
}

function fieldParagraph(textKind: string, command: string): Buffer {
  const text = Buffer.concat([
    longChar(3, textKind),
    Buffer.from('가', 'utf16le'),
    longChar(4, 'em%\u0000'),
    Buffer.from('\r', 'utf16le'),
  ])
  const header = Buffer.alloc(24)
  header.writeUInt32LE(text.length / 2, 0)
  const control = Buffer.concat([
    Buffer.from('knu%', 'latin1'),
    Buffer.alloc(5),
    Buffer.from(command, 'utf16le'),
  ])
  return Buffer.concat([record(66, 0, header), record(67, 1, text), record(71, 1, control)])
}

function writeCleanFixtureCfb(cfb: import('cfb').CFB$Container): Uint8Array {
  // Remove the synthetic '\x01Sh33tJ5' stream that SheetJS cfb_add injects into test fixtures,
  // and pass a type-0 sentinel so CFB.write does not re-create it as a real stream.
  for (let i = cfb.FullPaths.length - 1; i >= 0; i--) {
    if (cfb.FullPaths[i]?.includes('Sh33tJ5')) {
      cfb.FullPaths.splice(i, 1)
      cfb.FileIndex.splice(i, 1)
    }
  }
  for (const entry of cfb.FileIndex as Array<{ L?: number; R?: number; C?: number }>) {
    entry.L = entry.R = entry.C = Number.NaN
  }
  cfb.FileIndex.push({ name: '\x01Sh33tJ5', type: 0 } as import('cfb').CFB$Entry)
  cfb.FullPaths.push(`${cfb.FullPaths[0]}\x01Sh33tJ5`)
  return new Uint8Array(writeContainer(cfb))
}

function appendSectionParagraph(file: Uint8Array, paragraph: Buffer): Uint8Array {
  const opened = openHwp(file)!
  const current = streamOf(opened, SECTION(0))!
  const rewritten = rewriteStreams(
    opened,
    new Map([[SECTION(0), Buffer.concat([current, paragraph])]]),
  )!
  return new Uint8Array(rewritten.buffer, rewritten.byteOffset, rewritten.byteLength)
}

function makeFlaggedHwp(file: Uint8Array, flag: number, viewText?: Uint8Array): Uint8Array {
  const cfb = actualCfb.read(Buffer.from(file), { type: 'buffer' })
  const header = Buffer.from(actualCfb.find(cfb, '/FileHeader')!.content as Uint8Array)
  header.writeUInt32LE((header.readUInt32LE(36) | flag) >>> 0, 36)
  actualCfb.utils.cfb_add(cfb, '/FileHeader', header)
  if (viewText) {
    actualCfb.utils.cfb_add(cfb, '/ViewText/Section0', Buffer.from(viewText))
  }
  return writeCleanFixtureCfb(cfb)
}

function masterPageTail(kind: number): Buffer {
  const paraHeader = Buffer.alloc(24)
  paraHeader.writeUInt32LE(0x80000001, 0)
  paraHeader.writeUInt16LE(1, 12)
  paraHeader.writeUInt16LE(1, 16)
  const line = Buffer.alloc(36)
  line.writeUInt32LE(1000, 8)
  line.writeUInt32LE(1000, 12)
  line.writeUInt32LE(850, 16)
  const para = Buffer.concat([
    record(66, 1, paraHeader),
    record(68, 2, Buffer.alloc(8)),
    record(69, 2, line),
  ])
  const listHeader = Buffer.alloc(34)
  listHeader.writeUInt32LE(1, 0)
  listHeader.writeUInt32LE(67180, 8)
  listHeader.writeUInt32LE(51024, 12)
  listHeader.writeUInt8(kind, 18)
  return Buffer.concat([record(72, 1, listHeader), para])
}

describe('Track B (hwp5-wasm) differential, strict rhwp reopen, and security risks', () => {
  it('matches JS cfb across section tails, tab widths, field kinds, preview, and tracked changes + reopens cleanly in @rhwp/core', () => {
    // 1. Section tails (master page tail stripped on save, then restored)
    const tailBase = exportDoc('바탕쪽 본문')
    const tailSource = appendSectionParagraph(tailBase, masterPageTail(1))
    const savedWithoutTail = tailBase

    const tailsWasm = withBackend(true, () => {
      const kept = sectionTailsOf(tailSource)!
      return restoreSectionTails(savedWithoutTail, kept)
    })
    const tailsJs = withBackend(false, () => {
      const kept = sectionTailsOf(tailSource)!
      return restoreSectionTails(savedWithoutTail, kept)
    })
    expect(tailsWasm.restored).toBe(1)
    expect(tailsWasm.restored).toBe(tailsJs.restored)
    expect(streamOf(openHwp(tailsWasm.bytes)!, SECTION(0))).toEqual(
      streamOf(openHwp(tailsJs.bytes)!, SECTION(0)),
    )
    assertCleanOle2(tailsWasm.bytes)
    const reopenTails = new HwpDocument(tailsWasm.bytes)
    expect(reopenTails.getParagraphCount(0)).toBeGreaterThan(0)
    reopenTails.free()

    // 2. Tab widths
    const tabDoc = HwpDocument.createEmpty()
    tabDoc.createBlankDocument()
    tabDoc.insertText(0, 0, 0, '항목\t값')
    const tabBytes = tabDoc.exportHwp()
    tabDoc.free()
    const spots = withBackend(true, () => newTabsOf(tabBytes, 'hwp'))
    const spotsJs = withBackend(false, () => newTabsOf(tabBytes, 'hwp'))
    expect(spots).toEqual(spotsJs)
    const measured = spots.map((s) => ({ ...s, width: 6000, type: 0, fill: 3 }))
    const tabOutWasm = withBackend(true, () => writeTabWidths(tabBytes, 'hwp', measured))
    const tabOutJs = withBackend(false, () => writeTabWidths(tabBytes, 'hwp', measured))
    expect(tabOutWasm.written).toBe(tabOutJs.written)
    expect(streamOf(openHwp(tabOutWasm.bytes)!, SECTION(0))).toEqual(
      streamOf(openHwp(tabOutJs.bytes)!, SECTION(0)),
    )
    assertCleanOle2(tabOutWasm.bytes)
    const reopenTab = new HwpDocument(tabOutWasm.bytes)
    expect(reopenTab.getTextRange(0, 0, 0, reopenTab.getParagraphLength(0, 0))).toContain('항목')
    reopenTab.free()

    // 3. Field kinds
    const base = exportDoc('필드 본문')
    const openedFields = appendSectionParagraph(base, fieldParagraph('em%%', 'MEMO/1/1/'))
    const savedFields = appendSectionParagraph(base, fieldParagraph('knu%', 'MEMO/1/1/'))
    const fkWasm = withBackend(true, () =>
      restoreFieldKinds(savedFields, fieldKindsOf(openedFields)!),
    )
    const fkJs = withBackend(false, () =>
      restoreFieldKinds(savedFields, fieldKindsOf(openedFields)!),
    )
    expect(fkWasm.restored).toBe(1)
    expect(fkWasm.restored).toBe(fkJs.restored)
    expect(streamOf(openHwp(fkWasm.bytes)!, SECTION(0))).toEqual(
      streamOf(openHwp(fkJs.bytes)!, SECTION(0)),
    )
    assertCleanOle2(fkWasm.bytes)

    // 4. Preview (PrvText + PrvImage) on a real HWP 5 fixture (memo-source.hwp)
    const withPrv = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'memo-source.hwp')))

    const prvWasm = withBackend(true, () =>
      writePreview(withPrv, 'hwp', { text: '새 미리보기 텍스트', image: BLANK_PNG }),
    )!
    const prvJs = withBackend(false, () =>
      writePreview(withPrv, 'hwp', { text: '새 미리보기 텍스트', image: BLANK_PNG }),
    )!
    expect(prvWasm).not.toBeNull()
    expect(prvJs).not.toBeNull()
    assertCleanOle2(prvWasm)
    const expectedPrvText = Buffer.from('새 미리보기 텍스트', 'utf16le')
    const prvTextWasm = wasmReadStream(prvWasm, '/PrvText', false)
    const prvImageWasm = wasmReadStream(prvWasm, '/PrvImage', false)
    const prvJsCfb = actualCfb.read(Buffer.from(prvJs), { type: 'buffer' })
    const prvTextJs = actualCfb.find(prvJsCfb, '/PrvText')?.content
    const prvImageJs = actualCfb.find(prvJsCfb, '/PrvImage')?.content
    expect(prvTextWasm).not.toBeNull()
    expect(prvImageWasm).not.toBeNull()
    expect(prvTextJs).toBeTruthy()
    expect(prvImageJs).toBeTruthy()
    expect(Buffer.from(prvTextWasm!)).toEqual(Buffer.from(prvTextJs as Uint8Array))
    expect(Buffer.from(prvImageWasm!)).toEqual(Buffer.from(prvImageJs as Uint8Array))
    expect(Buffer.from(prvTextWasm!)).toEqual(expectedPrvText)
    expect(Buffer.from(prvImageWasm!)).toEqual(Buffer.from(BLANK_PNG))
    const reopenPrv = new HwpDocument(prvWasm)
    expect(reopenPrv.getParagraphCount(0)).toBeGreaterThan(0)
    reopenPrv.free()

    // 5. Tracked changes strip
    const bodyDoc = exportDoc('최종 본문 텍스트')
    const viewDoc = exportDoc('이전 변경 이력 텍스트')
    const viewCfb = actualCfb.read(Buffer.from(viewDoc), { type: 'buffer' })
    const viewSec = Buffer.from(
      actualCfb.find(viewCfb, '/BodyText/Section0')!.content as Uint8Array,
    )
    const tracked = makeFlaggedHwp(bodyDoc, 0x4000, viewSec)

    expect(withBackend(true, () => hasTrackedChanges(tracked))).toBe(true)
    expect(withBackend(false, () => hasTrackedChanges(tracked))).toBe(true)
    const strippedWasm = withBackend(true, () => withoutTrackedChanges(tracked))!
    const strippedJs = withBackend(false, () => withoutTrackedChanges(tracked))!
    expect(strippedWasm).not.toBeNull()
    expect(strippedJs).not.toBeNull()
    assertCleanOle2(strippedWasm)
    expect(withBackend(true, () => hasTrackedChanges(strippedWasm))).toBe(false)
    expect(pathsOf(openHwp(strippedWasm)!).some((p) => /\/ViewText\//i.test(p))).toBe(false)
    expect(streamOf(openHwp(strippedWasm)!, SECTION(0))).toEqual(
      streamOf(openHwp(strippedJs)!, SECTION(0)),
    )
    expect(streamOf(openHwp(strippedWasm)!, DOC_INFO)).toEqual(
      streamOf(openHwp(strippedJs)!, DOC_INFO),
    )
    expect(sectionCount(openHwp(strippedWasm)!)).toBe(1)
    const reopenStripped = new HwpDocument(strippedWasm)
    expect(reopenStripped.getTextRange(0, 0, 0, reopenStripped.getParagraphLength(0, 0))).toContain(
      '최종 본문 텍스트',
    )
    reopenStripped.free()
  })

  it('safely rejects corrupted, encrypted, and distribution HWP files without throwing or falling back to JS cfb', () => {
    const base = exportDoc('안전 거절 시험')
    const encrypted = makeFlaggedHwp(base, 0x02)
    const distribution = makeFlaggedHwp(base, 0x04)
    const encryptedTracked = makeFlaggedHwp(base, 0x4000 | 0x02, Buffer.from([1, 2, 3]))
    const corrupted = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0])
    const garbage = new Uint8Array([0x00, 0x11, 0x22, 0x33, 0x44])

    cfbSpies.read.mockClear()
    cfbSpies.write.mockClear()

    expect(openHwp(encrypted)).toBeNull()
    expect(openHwp(distribution)).toBeNull()
    expect(openHwp(corrupted)).toBeNull()
    expect(openHwp(garbage)).toBeNull()
    expect(hasTrackedChanges(corrupted)).toBe(false)
    expect(withoutTrackedChanges(encryptedTracked)).toBeNull()
    expect(withoutTrackedChanges(corrupted)).toBeNull()
    expect(sectionTailsOf(corrupted)).toBeNull()

    // Strict no-fallback invariant: WASM was healthy, so JS cfb MUST NOT have been invoked.
    expect(cfbSpies.read).not.toHaveBeenCalled()
    expect(cfbSpies.write).not.toHaveBeenCalled()
  })

  it('falls back to JS cfb only on infra failure (missing/corrupt WASM path or env=0)', () => {
    const base = exportDoc('인프라 폴백')
    const dir = mkdtempSync(join(tmpdir(), 'hwp5-risk-infra-'))
    tempDirs.push(dir)
    const badWasm = join(dir, 'corrupt.wasm')
    writeFileSync(badWasm, Buffer.from('not-a-wasm-binary'))

    process.env.GENOFFICE_HWP5_WASM_PATH = badWasm
    resetHwp5WasmForTests()
    cfbSpies.read.mockClear()
    const opened = openHwp(base)
    expect(opened).not.toBeNull()
    expect(opened!.backend).toBe('cfb')
    expect(cfbSpies.read).toHaveBeenCalled()
  })
})
