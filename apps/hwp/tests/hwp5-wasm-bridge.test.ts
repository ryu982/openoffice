/**
 * Bridge tests for the HWP 5 WASM integration in apps/hwp and CLI WASM path resolution.
 * Verifies default WASM execution, env-var switches, infra-only fallback to JS cfb,
 * strict no-fallback on semantic/security rejections, clean OLE2 output, and CLI lookup order.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import init, { HwpDocument } from '@rhwp/core'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  DOC_INFO,
  SECTION,
  hasStream,
  openHwp,
  pathsOf,
  recordsOf,
  resetHwp5WasmForTests,
  rewriteStreams,
  sameStreams,
  sectionCount,
  setHwp5WasmPathResolver,
  streamOf,
} from '../src/main/hwp5-file'
import { hasTrackedChanges, withoutTrackedChanges } from '../src/main/tracked-changes'
import { hwp5WasmPath } from '../../../packages/cli/src/resources'

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

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hwp5-bridge-'))
  tempDirs.push(dir)
  return dir
}

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

function exported(text = 'Hello bridge test'): Uint8Array {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.insertText(0, 0, 0, text)
  const bytes = doc.exportHwp()
  doc.free()
  return bytes
}

function withFlagAndViewText(
  file: Uint8Array,
  options: { flag?: number; viewText?: Uint8Array },
): Uint8Array {
  const cfb = actualCfb.read(Buffer.from(file), { type: 'buffer' })
  if (options.flag) {
    const header = Buffer.from(actualCfb.find(cfb, '/FileHeader')!.content as Uint8Array)
    header.writeUInt32LE((header.readUInt32LE(36) | options.flag) >>> 0, 36)
    actualCfb.utils.cfb_add(cfb, '/FileHeader', header)
  }
  if (options.viewText) {
    actualCfb.utils.cfb_add(cfb, '/ViewText/Section0', Buffer.from(options.viewText))
  }
  return new Uint8Array(actualCfb.write(cfb, { type: 'buffer' }) as Buffer)
}

function trackedFile(): Uint8Array {
  const base = exported('Body text')
  const viewDoc = exported('View copy text')
  const viewCfb = actualCfb.read(Buffer.from(viewDoc), { type: 'buffer' })
  const viewSection = Buffer.from(
    actualCfb.find(viewCfb, '/BodyText/Section0')!.content as Uint8Array,
  )
  return withFlagAndViewText(base, { flag: 0x4000, viewText: viewSection })
}

/** Verifies every unused FAT and MiniFAT slot in an OLE2 container is FREESECT (0xffffffff). */
function hasValidFreeFatSlots(bytes: Uint8Array): boolean {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (buf.length < 512) return false
  const sectorShift = buf.readUInt16LE(30)
  const miniShift = buf.readUInt16LE(32)
  const sectorSize = 1 << sectorShift
  const miniSectorSize = 1 << miniShift
  const fatPerSector = sectorSize / 4
  const totalSectors = (buf.length - sectorSize) / sectorSize
  if (!Number.isInteger(totalSectors) || totalSectors <= 0) return false
  const sectorAt = (index: number) => sectorSize + index * sectorSize
  const FREE = 0xffffffff
  const END_OF_CHAIN = 0xfffffffe

  const fatSectors: number[] = []
  for (let slot = 0; slot < 109; slot++) {
    const s = buf.readUInt32LE(76 + slot * 4)
    if (s < totalSectors) fatSectors.push(s)
  }
  let difat = buf.readUInt32LE(68)
  for (let guard = 0; difat < totalSectors && guard < totalSectors; guard++) {
    for (let slot = 0; slot < fatPerSector - 1; slot++) {
      const s = buf.readUInt32LE(sectorAt(difat) + slot * 4)
      if (s < totalSectors) fatSectors.push(s)
    }
    difat = buf.readUInt32LE(sectorAt(difat) + (fatPerSector - 1) * 4)
  }

  for (let nth = 0; nth < fatSectors.length; nth++) {
    const base = sectorAt(fatSectors[nth]!)
    for (let slot = 0; slot < fatPerSector; slot++) {
      if (nth * fatPerSector + slot >= totalSectors) {
        if (buf.readUInt32LE(base + slot * 4) !== FREE) return false
      }
    }
  }

  const nextInFat = (sector: number): number => {
    const table = fatSectors[Math.floor(sector / fatPerSector)]
    if (table === undefined) return END_OF_CHAIN
    return buf.readUInt32LE(sectorAt(table) + (sector % fatPerSector) * 4)
  }

  const miniSectors: number[] = []
  let mini = buf.readUInt32LE(60)
  for (let guard = 0; mini < totalSectors && guard < totalSectors; guard++) {
    miniSectors.push(mini)
    mini = nextInFat(mini)
  }
  const dirFirst = buf.readUInt32LE(48)
  const rootSize = buf.readUInt32LE(sectorAt(dirFirst) + 120)
  const usedMini = Math.ceil(rootSize / miniSectorSize)
  for (let nth = 0; nth < miniSectors.length; nth++) {
    const base = sectorAt(miniSectors[nth]!)
    for (let slot = 0; slot < fatPerSector; slot++) {
      if (nth * fatPerSector + slot >= usedMini) {
        if (buf.readUInt32LE(base + slot * 4) !== FREE) return false
      }
    }
  }
  return true
}

function textFromRhwp(bytes: Uint8Array): string {
  const doc = new HwpDocument(bytes)
  try {
    return JSON.parse(doc.getTextFileText()) as string
  } finally {
    doc.free()
  }
}

describe('HWP 5 WASM bridge: default WASM backend', () => {
  it('uses WASM by default for openHwp, streamOf, sectionCount, recordsOf, pathsOf, hasStream, sameStreams, rewriteStreams', () => {
    const file = exported('Default WASM test')
    cfbSpies.read.mockClear()
    cfbSpies.write.mockClear()

    const opened = openHwp(file)
    expect(opened).not.toBeNull()
    expect(opened!.backend).toBe('wasm')
    expect(opened!.compressed).toBe(true)
    expect(sectionCount(opened!)).toBe(1)

    const paths = pathsOf(opened!)
    expect(paths).toContain('/FileHeader')
    expect(paths).toContain('/DocInfo')
    expect(paths).toContain('/BodyText/Section0')

    expect(hasStream(opened!, '/BodyText/Section0')).toBe(true)
    expect(hasStream(opened!, '/bodytext/section0')).toBe(true)
    expect(hasStream(opened!, '/BodyText')).toBe(false)
    expect(hasStream(opened!, '/DoesNotExist')).toBe(false)

    const docInfo = streamOf(opened!, DOC_INFO)
    const section0 = streamOf(opened!, SECTION(0))
    expect(docInfo).not.toBeNull()
    expect(section0).not.toBeNull()
    expect(recordsOf(docInfo!)).not.toBeNull()
    expect(recordsOf(section0!)!.length).toBeGreaterThan(0)

    const changed = new Map<string, Buffer>([[SECTION(0), section0!]])
    const rewritten = rewriteStreams(opened!, changed)
    expect(rewritten).not.toBeNull()

    const reopened = openHwp(rewritten!)
    expect(reopened).not.toBeNull()
    expect(reopened!.backend).toBe('wasm')
    expect(sameStreams(opened!, reopened!, changed)).toBe(true)

    // JS cfb was never touched on the WASM path
    expect(cfbSpies.read).not.toHaveBeenCalled()
    expect(cfbSpies.write).not.toHaveBeenCalled()
  })

  it('produces clean OLE2 output (no Sh33tJ5 marker, valid 0xffffffff FAT slots, readable by rhwp)', () => {
    const file = exported('Clean output check')
    const opened = openHwp(file)!
    const section0 = streamOf(opened, SECTION(0))!
    const rewritten = rewriteStreams(opened, new Map([[SECTION(0), section0]]))!

    expect(rewritten.includes(Buffer.from('Sh33tJ5', 'latin1'))).toBe(false)
    expect(hasValidFreeFatSlots(rewritten)).toBe(true)
    expect(textFromRhwp(rewritten)).toContain('Clean output check')

    const tracked = trackedFile()
    expect(hasTrackedChanges(tracked)).toBe(true)
    const stripped = withoutTrackedChanges(tracked)!
    expect(stripped).not.toBeNull()
    expect(Buffer.from(stripped).includes(Buffer.from('Sh33tJ5', 'latin1'))).toBe(false)
    expect(hasValidFreeFatSlots(stripped)).toBe(true)
    expect(hasTrackedChanges(stripped)).toBe(false)
    expect(textFromRhwp(stripped)).toContain('Body text')
    expect(cfbSpies.read).not.toHaveBeenCalled()
    expect(cfbSpies.write).not.toHaveBeenCalled()
  })

  it('returns consistent pathsOf between WASM and JS cfb backends', () => {
    const file = exported('Path parity')
    const wasmOpened = openHwp(file)!
    expect(wasmOpened.backend).toBe('wasm')

    process.env.GENOFFICE_HWP5_WASM = '0'
    const cfbOpened = openHwp(file)!
    expect(cfbOpened.backend).toBe('cfb')

    expect([...pathsOf(wasmOpened)].sort()).toEqual([...pathsOf(cfbOpened)].sort())
    expect(sameStreams(wasmOpened, cfbOpened, new Map())).toBe(true)
  })

  it('opens and cleanly rewrites leniently padded OLE2 containers (END_OF_CHAIN unused FAT slots) on WASM without JS cfb', () => {
    const clean = exported('Lenient OLE2 input')
    const rawCfb = actualCfb.read(Buffer.from(clean), { type: 'buffer' })
    const lenient = new Uint8Array(actualCfb.write(rawCfb, { type: 'buffer' }) as Buffer)
    expect(hasValidFreeFatSlots(lenient)).toBe(false)
    cfbSpies.read.mockClear()
    cfbSpies.write.mockClear()

    const opened = openHwp(lenient)
    expect(opened).not.toBeNull()
    expect(opened!.backend).toBe('wasm')
    const section0 = streamOf(opened!, SECTION(0))!
    const rewritten = rewriteStreams(opened!, new Map([[SECTION(0), section0]]))!
    expect(rewritten).not.toBeNull()
    expect(hasValidFreeFatSlots(rewritten)).toBe(true)
    expect(rewritten.includes(Buffer.from('Sh33tJ5', 'latin1'))).toBe(false)
    expect(textFromRhwp(rewritten)).toContain('Lenient OLE2 input')
    expect(cfbSpies.read).not.toHaveBeenCalled()
    expect(cfbSpies.write).not.toHaveBeenCalled()
  })
})

describe('HWP 5 WASM bridge: env switches and infra-only fallback', () => {
  it.each(['0', 'off', 'OFF', ' Off '])(
    'forces JS cfb backend when GENOFFICE_HWP5_WASM=%s',
    (flag) => {
      process.env.GENOFFICE_HWP5_WASM = flag
      const file = exported('JS fallback test')
      cfbSpies.read.mockClear()

      const opened = openHwp(file)
      expect(opened).not.toBeNull()
      expect(opened!.backend).toBe('cfb')
      expect(cfbSpies.read).toHaveBeenCalled()
      expect(hasStream(opened!, '/BodyText/Section0')).toBe(true)
      expect(hasStream(opened!, '/BodyText')).toBe(false)

      const section0 = streamOf(opened!, SECTION(0))!
      expect(recordsOf(section0)).not.toBeNull()
      const rewritten = rewriteStreams(opened!, new Map([[SECTION(0), section0]]))
      expect(rewritten).not.toBeNull()
      expect(textFromRhwp(rewritten!)).toContain('JS fallback test')

      const tracked = trackedFile()
      expect(hasTrackedChanges(tracked)).toBe(true)
      const stripped = withoutTrackedChanges(tracked)
      expect(stripped).not.toBeNull()
      expect(textFromRhwp(stripped!)).toContain('Body text')
    },
  )

  it('falls back to JS cfb when GENOFFICE_HWP5_WASM_PATH points to a missing file', () => {
    process.env.GENOFFICE_HWP5_WASM_PATH = join(makeTempDir(), 'does-not-exist.wasm')
    const file = exported('Missing wasm fallback')
    cfbSpies.read.mockClear()

    const opened = openHwp(file)
    expect(opened).not.toBeNull()
    expect(opened!.backend).toBe('cfb')
    expect(cfbSpies.read).toHaveBeenCalled()

    const tracked = trackedFile()
    expect(hasTrackedChanges(tracked)).toBe(true)
    expect(withoutTrackedChanges(tracked)).not.toBeNull()
  })

  it('falls back to JS cfb when GENOFFICE_HWP5_WASM_PATH points to corrupt bytes', () => {
    const corruptWasm = join(makeTempDir(), 'corrupt.wasm')
    writeFileSync(corruptWasm, Buffer.from('not a wasm module'))
    process.env.GENOFFICE_HWP5_WASM_PATH = corruptWasm
    const file = exported('Corrupt wasm fallback')
    cfbSpies.read.mockClear()

    const opened = openHwp(file)
    expect(opened).not.toBeNull()
    expect(opened!.backend).toBe('cfb')
    expect(cfbSpies.read).toHaveBeenCalled()
  })

  it('uses custom path resolver and falls back to JS cfb if the resolver throws', () => {
    const realWasm = require.resolve('@genoffice/hwp5-wasm/pkg/hwp5_wasm_bg.wasm')
    setHwp5WasmPathResolver(() => realWasm)
    const file = exported('Custom resolver test')
    cfbSpies.read.mockClear()

    const opened = openHwp(file)
    expect(opened).not.toBeNull()
    expect(opened!.backend).toBe('wasm')
    expect(cfbSpies.read).not.toHaveBeenCalled()

    setHwp5WasmPathResolver(() => {
      throw new Error('simulated missing resource')
    })
    const fallback = openHwp(file)
    expect(fallback).not.toBeNull()
    expect(fallback!.backend).toBe('cfb')
    expect(cfbSpies.read).toHaveBeenCalled()
  })
})

describe('HWP 5 WASM bridge: strict no-fallback on semantic and security rejections', () => {
  it('never falls back to JS cfb for corrupt bytes, encrypted/distribution/ViewText docs, corrupt records, or missing stream paths', () => {
    const valid = exported('Rejection test')
    const encrypted = withFlagAndViewText(valid, { flag: 0x2 })
    const distribution = withFlagAndViewText(valid, { flag: 0x4 })
    const withViewText = withFlagAndViewText(valid, { viewText: Buffer.from([1, 2, 3, 4]) })
    const trackedDist = withFlagAndViewText(trackedFile(), { flag: 0x4 })
    const trackedEnc = withFlagAndViewText(trackedFile(), { flag: 0x2 })
    const corruptOle = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4])
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])

    // Open a valid document first so WASM is active, then clear spies
    const opened = openHwp(valid)!
    expect(opened.backend).toBe('wasm')
    cfbSpies.read.mockClear()
    cfbSpies.write.mockClear()

    expect(openHwp(corruptOle)).toBeNull()
    expect(openHwp(zipBytes)).toBeNull()
    expect(openHwp(new Uint8Array(0))).toBeNull()
    expect(openHwp(encrypted)).toBeNull()
    expect(openHwp(distribution)).toBeNull()
    expect(openHwp(withViewText)).toBeNull()

    expect(hasTrackedChanges(corruptOle)).toBe(false)
    expect(hasTrackedChanges(zipBytes)).toBe(false)
    expect(hasTrackedChanges(valid)).toBe(false)

    expect(withoutTrackedChanges(corruptOle)).toBeNull()
    expect(withoutTrackedChanges(valid)).toBeNull()
    expect(withoutTrackedChanges(trackedDist)).toBeNull()
    expect(withoutTrackedChanges(trackedEnc)).toBeNull()

    // Corrupt tagged record stream (truncated header / truncated payload)
    expect(recordsOf(Buffer.from([0x42, 0x00]))).toBeNull()
    expect(recordsOf(Buffer.from([0x42, 0x00, 0x40, 0x00, 0x01]))).toBeNull()

    // Missing replacement stream path in rewriteStreams
    expect(rewriteStreams(opened, new Map([['/NoSuchStream', Buffer.from('abc')]]))).toBeNull()

    // HARD GATE: none of these semantic/security rejections may invoke JS cfb
    expect(cfbSpies.read).not.toHaveBeenCalled()
    expect(cfbSpies.write).not.toHaveBeenCalled()
  })
})

describe('packages/cli hwp5WasmPath resolution order', () => {
  it('prefers GENOFFICE_HWP5_WASM_PATH, then packaged Resources/wasm, then dev repo, else throws', () => {
    const packagedDir = makeTempDir()
    const envOverride = join(packagedDir, 'custom-hwp5.wasm')
    const devRoot = join(__dirname, '..', '..', '..')

    // 1. Env override wins over everything
    expect(hwp5WasmPath({ GENOFFICE_HWP5_WASM_PATH: envOverride }, packagedDir, devRoot)).toBe(
      envOverride,
    )

    // 2. Packaged Resources/wasm/hwp5_bg.wasm wins over dev repo
    expect(hwp5WasmPath({}, packagedDir, devRoot)).toBe(join(packagedDir, 'wasm', 'hwp5_bg.wasm'))

    // 3. Dev repo resolves packages/hwp5-wasm/pkg/hwp5_wasm_bg.wasm
    const resolved = hwp5WasmPath({}, null, devRoot)
    expect(resolved.replace(/\\/g, '/')).toMatch(/packages\/hwp5-wasm\/pkg\/hwp5_wasm_bg\.wasm$/)

    // 4. Throws descriptive error when nothing matches
    expect(() => hwp5WasmPath({}, null, null)).toThrow(
      'hwp5_bg.wasm not found (set GENOFFICE_HWP5_WASM_PATH)',
    )
  })
})
