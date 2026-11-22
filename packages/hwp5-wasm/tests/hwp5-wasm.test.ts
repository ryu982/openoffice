import { readFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  initHwp5WasmSync,
  inspectHwp5,
  isHwp5WasmReady,
  parseRecords,
  readStream,
  rewriteStreams,
  stripTrackedChanges,
} from '../src/index'
import * as nodeApi from '../src/node'

const SIGNATURE = 'HWP Document File'
const FLAG_COMPRESSED = 0x0001
const FLAG_ENCRYPTED = 0x0002
const FLAG_DISTRIBUTION = 0x0004
const FLAG_TRACKED = 0x4000

const SECTOR_SIZE = 512
const MINI_SECTOR_SIZE = 64
const FAT_PER_SECTOR = SECTOR_SIZE / 4
const HEADER_FAT_SLOTS = 109
const FREE_SECT = 0xffffffff
const END_OF_CHAIN = 0xfffffffe
const FAT_SECT = 0xfffffffd
const NO_STREAM = 0xffffffff

interface DirNode {
  name: string
  type: 1 | 2 | 5 // 1 = storage, 2 = stream, 5 = root
  children: Map<string, DirNode>
  data?: Uint8Array
  id: number
  startSector: number
  size: number
  childId: number
  leftId: number
  rightId: number
}

function cfbNameCompare(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length
  const ua = a.toUpperCase()
  const ub = b.toUpperCase()
  return ua < ub ? -1 : ua > ub ? 1 : 0
}

/**
 * Minimal spec-compliant OLE2 v3 builder for self-contained test fixtures,
 * avoiding any runtime dependency on JS `cfb`.
 */
function buildOle2Container(
  streams: ReadonlyArray<{ path: string; data: Uint8Array }>,
  extraStorages: ReadonlyArray<string> = [],
): Uint8Array {
  const root: DirNode = {
    name: 'Root Entry',
    type: 5,
    children: new Map(),
    id: 0,
    startSector: END_OF_CHAIN,
    size: 0,
    childId: NO_STREAM,
    leftId: NO_STREAM,
    rightId: NO_STREAM,
  }

  const ensureStorage = (segments: string[]): DirNode => {
    let cur = root
    for (const seg of segments) {
      let next = cur.children.get(seg)
      if (!next) {
        next = {
          name: seg,
          type: 1,
          children: new Map(),
          id: -1,
          startSector: 0,
          size: 0,
          childId: NO_STREAM,
          leftId: NO_STREAM,
          rightId: NO_STREAM,
        }
        cur.children.set(seg, next)
      }
      cur = next
    }
    return cur
  }

  for (const storagePath of extraStorages) {
    const segs = storagePath
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter(Boolean)
    if (segs.length > 0) ensureStorage(segs)
  }

  for (const { path, data } of streams) {
    const segs = path
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter(Boolean)
    const name = segs.pop()!
    const parent = ensureStorage(segs)
    parent.children.set(name, {
      name,
      type: 2,
      children: new Map(),
      data,
      id: -1,
      startSector: END_OF_CHAIN,
      size: data.byteLength,
      childId: NO_STREAM,
      leftId: NO_STREAM,
      rightId: NO_STREAM,
    })
  }

  // Assign directory IDs and build balanced BST sibling links per storage
  const nodes: DirNode[] = [root]
  const assign = (parent: DirNode): void => {
    const sorted = [...parent.children.values()].sort((a, b) => cfbNameCompare(a.name, b.name))
    for (const child of sorted) {
      child.id = nodes.length
      nodes.push(child)
    }
    const buildTree = (items: DirNode[]): number => {
      if (items.length === 0) return NO_STREAM
      const mid = Math.floor(items.length / 2)
      const node = items[mid]!
      node.leftId = buildTree(items.slice(0, mid))
      node.rightId = buildTree(items.slice(mid + 1))
      return node.id
    }
    parent.childId = buildTree(sorted)
    for (const child of sorted) {
      if (child.type === 1) assign(child)
    }
  }
  assign(root)

  // Allocate stream data: < 4096 in mini stream, >= 4096 in regular sectors
  const regularSectors: Buffer[] = []
  const fat: number[] = []
  const allocChain = (chunks: Buffer[]): number => {
    if (chunks.length === 0) return END_OF_CHAIN
    const first = regularSectors.length
    for (let i = 0; i < chunks.length; i++) {
      regularSectors.push(chunks[i]!)
      fat.push(i + 1 < chunks.length ? first + i + 1 : END_OF_CHAIN)
    }
    return first
  }

  const miniChunks: Buffer[] = []
  const miniFat: number[] = []
  for (const node of nodes) {
    if (node.type !== 2 || !node.data) continue
    if (node.data.byteLength === 0) {
      node.startSector = END_OF_CHAIN
      node.size = 0
      continue
    }
    if (node.data.byteLength < 4096) {
      const count = Math.ceil(node.data.byteLength / MINI_SECTOR_SIZE)
      const firstMini = miniChunks.length
      for (let i = 0; i < count; i++) {
        const chunk = Buffer.alloc(MINI_SECTOR_SIZE)
        const slice = node.data.subarray(i * MINI_SECTOR_SIZE, (i + 1) * MINI_SECTOR_SIZE)
        chunk.set(slice)
        miniChunks.push(chunk)
        miniFat.push(i + 1 < count ? firstMini + i + 1 : END_OF_CHAIN)
      }
      node.startSector = firstMini
    } else {
      const count = Math.ceil(node.data.byteLength / SECTOR_SIZE)
      const chunks: Buffer[] = []
      for (let i = 0; i < count; i++) {
        const chunk = Buffer.alloc(SECTOR_SIZE)
        const slice = node.data.subarray(i * SECTOR_SIZE, (i + 1) * SECTOR_SIZE)
        chunk.set(slice)
        chunks.push(chunk)
      }
      node.startSector = allocChain(chunks)
    }
  }

  // Write mini stream into regular sectors under root entry
  if (miniChunks.length > 0) {
    const miniStream = Buffer.concat(miniChunks)
    root.size = miniStream.length
    const count = Math.ceil(miniStream.length / SECTOR_SIZE)
    const chunks: Buffer[] = []
    for (let i = 0; i < count; i++) {
      const chunk = Buffer.alloc(SECTOR_SIZE)
      miniStream.copy(chunk, 0, i * SECTOR_SIZE, Math.min((i + 1) * SECTOR_SIZE, miniStream.length))
      chunks.push(chunk)
    }
    root.startSector = allocChain(chunks)
  }

  // Write MiniFAT sectors
  let firstMiniFatSector = END_OF_CHAIN
  let miniFatSectorCount = 0
  if (miniFat.length > 0) {
    miniFatSectorCount = Math.ceil(miniFat.length / FAT_PER_SECTOR)
    const chunks: Buffer[] = []
    for (let s = 0; s < miniFatSectorCount; s++) {
      const buf = Buffer.alloc(SECTOR_SIZE)
      for (let slot = 0; slot < FAT_PER_SECTOR; slot++) {
        const idx = s * FAT_PER_SECTOR + slot
        buf.writeUInt32LE(idx < miniFat.length ? miniFat[idx]! : FREE_SECT, slot * 4)
      }
      chunks.push(buf)
    }
    firstMiniFatSector = allocChain(chunks)
  }

  // Write Directory sectors (4 entries of 128 bytes per 512-byte sector)
  const dirSectorsCount = Math.ceil(nodes.length / 4)
  const dirChunks: Buffer[] = []
  for (let s = 0; s < dirSectorsCount; s++) {
    const buf = Buffer.alloc(SECTOR_SIZE)
    for (let k = 0; k < 4; k++) {
      const node = nodes[s * 4 + k]
      const base = k * 128
      if (!node) {
        buf.writeUInt32LE(NO_STREAM, base + 68)
        buf.writeUInt32LE(NO_STREAM, base + 72)
        buf.writeUInt32LE(NO_STREAM, base + 76)
        continue
      }
      const nameUtf16 = Buffer.from(`${node.name}\0`, 'utf16le')
      nameUtf16.copy(buf, base)
      buf.writeUInt16LE(nameUtf16.length, base + 64)
      buf.writeUInt8(node.type, base + 66)
      buf.writeUInt8(1, base + 67) // color: black
      buf.writeUInt32LE(node.leftId >>> 0, base + 68)
      buf.writeUInt32LE(node.rightId >>> 0, base + 72)
      buf.writeUInt32LE(node.childId >>> 0, base + 76)
      buf.writeUInt32LE(node.startSector >>> 0, base + 116)
      buf.writeUInt32LE(node.size >>> 0, base + 120)
    }
    dirChunks.push(buf)
  }
  const firstDirSector = allocChain(dirChunks)

  // Compute number of FAT sectors needed (fixpoint)
  let fatSectorCount = Math.max(1, Math.ceil((fat.length + 1) / FAT_PER_SECTOR))
  while (Math.ceil((fat.length + fatSectorCount) / FAT_PER_SECTOR) > fatSectorCount) {
    fatSectorCount++
  }
  const fatSectorIndices: number[] = []
  for (let i = 0; i < fatSectorCount; i++) {
    fatSectorIndices.push(regularSectors.length)
    regularSectors.push(Buffer.alloc(SECTOR_SIZE))
    fat.push(FAT_SECT)
  }
  for (let s = 0; s < fatSectorCount; s++) {
    const buf = regularSectors[fatSectorIndices[s]!]!
    for (let slot = 0; slot < FAT_PER_SECTOR; slot++) {
      const idx = s * FAT_PER_SECTOR + slot
      buf.writeUInt32LE(idx < fat.length ? fat[idx]! : FREE_SECT, slot * 4)
    }
  }

  // Build 512-byte OLE2 v3 header
  const header = Buffer.alloc(SECTOR_SIZE)
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0)
  header.writeUInt16LE(0x003e, 24) // minor version
  header.writeUInt16LE(0x0003, 26) // major version 3
  header.writeUInt16LE(0xfffe, 28) // byte order
  header.writeUInt16LE(9, 30) // sector shift (512)
  header.writeUInt16LE(6, 32) // mini sector shift (64)
  header.writeUInt32LE(fatSectorCount, 44)
  header.writeUInt32LE(firstDirSector >>> 0, 48)
  header.writeUInt32LE(4096, 56) // mini stream cutoff
  header.writeUInt32LE(firstMiniFatSector >>> 0, 60)
  header.writeUInt32LE(miniFatSectorCount, 64)
  header.writeUInt32LE(END_OF_CHAIN >>> 0, 68) // no DIFAT sectors needed for small fixtures
  header.writeUInt32LE(0, 72)
  for (let slot = 0; slot < HEADER_FAT_SLOTS; slot++) {
    header.writeUInt32LE(
      slot < fatSectorIndices.length ? fatSectorIndices[slot]! : FREE_SECT,
      76 + slot * 4,
    )
  }

  return new Uint8Array(Buffer.concat([header, ...regularSectors]))
}

function makeFileHeader(flags: number): Uint8Array {
  const buf = Buffer.alloc(256)
  buf.write(SIGNATURE, 0, 'latin1')
  buf.writeUInt32LE(0x05010000, 32)
  buf.writeUInt32LE(flags >>> 0, 36)
  return new Uint8Array(buf)
}

function makeRecord(tag: number, level: number, payload: Uint8Array): Uint8Array {
  if (payload.byteLength < 0xfff) {
    const head = Buffer.alloc(4)
    head.writeUInt32LE(((tag & 0x3ff) | ((level & 0x3ff) << 10) | (payload.byteLength << 20)) >>> 0)
    return new Uint8Array(Buffer.concat([head, Buffer.from(payload)]))
  }
  const head = Buffer.alloc(8)
  head.writeUInt32LE(((tag & 0x3ff) | ((level & 0x3ff) << 10) | (0xfff << 20)) >>> 0, 0)
  head.writeUInt32LE(payload.byteLength >>> 0, 4)
  return new Uint8Array(Buffer.concat([head, Buffer.from(payload)]))
}

function makeHwp5(options: {
  flags?: number
  sections?: Uint8Array[]
  extraStreams?: Array<{ path: string; data: Uint8Array }>
  extraStorages?: string[]
}): Uint8Array {
  const flags = options.flags ?? FLAG_COMPRESSED
  const compressed = (flags & FLAG_COMPRESSED) !== 0
  const sections = options.sections ?? [makeRecord(66, 0, new Uint8Array([1, 2, 3, 4]))]
  const docInfoRaw = makeRecord(17, 0, new Uint8Array(32))

  const streams: Array<{ path: string; data: Uint8Array }> = [
    { path: '/FileHeader', data: makeFileHeader(flags) },
    {
      path: '/DocInfo',
      data: compressed ? new Uint8Array(deflateRawSync(docInfoRaw)) : docInfoRaw,
    },
    ...sections.map((sec, idx) => ({
      path: `/BodyText/Section${idx}`,
      data: compressed ? new Uint8Array(deflateRawSync(sec)) : sec,
    })),
    ...(options.extraStreams ?? []),
  ]
  return buildOle2Container(streams, options.extraStorages)
}

/** Verifies every unused FAT and MiniFAT slot in a binary OLE2 file holds FREESECT (0xffffffff). */
function assertUnusedSlotsAreFree(file: Uint8Array): void {
  const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength)
  expect(buf.length).toBeGreaterThanOrEqual(SECTOR_SIZE)
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  const totalSectors = (buf.length - SECTOR_SIZE) / SECTOR_SIZE
  expect(Number.isInteger(totalSectors)).toBe(true)
  const sectorAt = (s: number) => SECTOR_SIZE + s * SECTOR_SIZE

  const fatSectors: number[] = []
  for (let slot = 0; slot < HEADER_FAT_SLOTS; slot++) {
    const s = buf.readUInt32LE(76 + slot * 4)
    if (s < totalSectors) fatSectors.push(s)
  }
  let difat = buf.readUInt32LE(68)
  for (let guard = 0; difat < totalSectors && guard < totalSectors; guard++) {
    for (let slot = 0; slot < FAT_PER_SECTOR - 1; slot++) {
      const s = buf.readUInt32LE(sectorAt(difat) + slot * 4)
      if (s < totalSectors) fatSectors.push(s)
    }
    difat = buf.readUInt32LE(sectorAt(difat) + (FAT_PER_SECTOR - 1) * 4)
  }

  fatSectors.forEach((sector, nth) => {
    for (let slot = 0; slot < FAT_PER_SECTOR; slot++) {
      if (nth * FAT_PER_SECTOR + slot >= totalSectors) {
        const val = buf.readUInt32LE(sectorAt(sector) + slot * 4)
        expect(val).toBe(FREE_SECT)
      }
    }
  })

  const next = (sector: number): number => {
    const table = fatSectors[Math.floor(sector / FAT_PER_SECTOR)]
    return table === undefined
      ? END_OF_CHAIN
      : buf.readUInt32LE(sectorAt(table) + (sector % FAT_PER_SECTOR) * 4)
  }
  const miniSectors: number[] = []
  let mini = buf.readUInt32LE(60)
  for (let guard = 0; mini < totalSectors && guard < totalSectors; guard++) {
    miniSectors.push(mini)
    mini = next(mini)
  }
  const rootSize = buf.readUInt32LE(sectorAt(buf.readUInt32LE(48)) + 120)
  const usedMini = Math.ceil(rootSize / MINI_SECTOR_SIZE)
  miniSectors.forEach((sector, nth) => {
    for (let slot = 0; slot < FAT_PER_SECTOR; slot++) {
      if (nth * FAT_PER_SECTOR + slot >= usedMini) {
        const val = buf.readUInt32LE(sectorAt(sector) + slot * 4)
        expect(val).toBe(FREE_SECT)
      }
    }
  })
}

beforeAll(() => {
  initHwp5WasmSync(readFileSync(nodeApi.WASM_PATH))
})

describe('@genoffice/hwp5-wasm end-to-end WASM bindings', () => {
  it('initializes synchronously and inspects compressed and uncompressed HWP5 files', () => {
    expect(isHwp5WasmReady()).toBe(true)

    const sec0 = makeRecord(66, 0, new Uint8Array([1, 2, 3, 4]))
    const sec1 = makeRecord(66, 0, new Uint8Array([5, 6]))
    const hwp = makeHwp5({
      flags: FLAG_COMPRESSED,
      sections: [sec0, sec1],
      extraStreams: [
        { path: '/PrvText', data: new Uint8Array(Buffer.from('hello', 'utf16le')) },
        { path: '/BinData/BIN0001.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
        { path: '/\x05HwpSummaryInformation', data: new Uint8Array([0xfe, 0xff, 0, 0]) },
      ],
    })

    const info = inspectHwp5(hwp)
    expect(info.valid).toBe(true)
    expect(info.compressed).toBe(true)
    expect(info.encrypted).toBe(false)
    expect(info.distribution).toBe(false)
    expect(info.tracked).toBe(false)
    expect(info.hasViewText).toBe(false)
    expect(info.sections).toBe(2)
    expect(info.paths).toContain('/BodyText/')
    expect(info.paths).toContain('/BinData/')
    expect(info.streamPaths).toContain('/BodyText/Section0')
    expect(info.streamPaths).toContain('/BodyText/Section1')
    expect(info.streamPaths).toContain('/\x05HwpSummaryInformation')

    // Invalid inputs never throw
    expect(inspectHwp5(new Uint8Array(0)).valid).toBe(false)
    expect(inspectHwp5(new Uint8Array([0x50, 0x4b, 0x03, 0x04])).valid).toBe(false)
  })

  it('reads streams raw and decompressed, including control-char stream names', () => {
    const sec0 = makeRecord(66, 0, new Uint8Array([10, 20, 30, 40]))
    const summary = new Uint8Array([0xfe, 0xff, 0x01, 0x02, 0x03])
    const hwp = makeHwp5({
      flags: FLAG_COMPRESSED,
      sections: [sec0],
      extraStreams: [
        { path: '/PrvText', data: new Uint8Array(Buffer.from('preview', 'utf16le')) },
        { path: '/\x05HwpSummaryInformation', data: summary },
      ],
    })

    expect(readStream(hwp, '/BodyText/Section0', true)).toEqual(sec0)
    expect(readStream(hwp, 'bodytext/section0', true)).toEqual(sec0)
    expect(readStream(hwp, '/PrvText', false)).toEqual(
      new Uint8Array(Buffer.from('preview', 'utf16le')),
    )
    expect(readStream(hwp, '/\x05HwpSummaryInformation', false)).toEqual(summary)
    expect(readStream(hwp, '/DoesNotExist', false)).toBeNull()
    expect(readStream(new Uint8Array([1, 2, 3]), '/FileHeader', false)).toBeNull()
  })

  it('parses normal and extended-size HWP5 records and rejects truncated/overflowing streams', () => {
    expect(parseRecords(new Uint8Array(0))).toEqual([])

    const rec0 = makeRecord(66, 0, new Uint8Array([1, 2, 3, 4]))
    const rec1 = makeRecord(67, 1, new Uint8Array(5000).fill(0xcd))
    const combined = new Uint8Array(Buffer.concat([Buffer.from(rec0), Buffer.from(rec1)]))

    expect(parseRecords(combined)).toEqual([
      { tag: 66, level: 0, start: 0, body: 4, end: 8 },
      { tag: 67, level: 1, start: 8, body: 16, end: 5016 },
    ])

    expect(parseRecords(combined.subarray(0, combined.length - 1))).toBeNull()
    const overflow = Buffer.alloc(8)
    overflow.writeUInt32LE((66 | (0xfff << 20)) >>> 0, 0)
    overflow.writeUInt32LE(0xffffffff, 4)
    expect(parseRecords(new Uint8Array(overflow))).toBeNull()
  })

  it('rewrites compressed and plain streams while preserving all other streams and OLE2 invariants', () => {
    const origSec0 = makeRecord(66, 0, new Uint8Array([1, 2, 3, 4]))
    const origPrvImg = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const summary = new Uint8Array([0xfe, 0xff, 0x10, 0x20, 0x30])
    const bigBin = new Uint8Array(10_000).fill(0x42)

    const hwp = makeHwp5({
      flags: FLAG_COMPRESSED,
      sections: [origSec0],
      extraStreams: [
        { path: '/PrvText', data: new Uint8Array(Buffer.from('old', 'utf16le')) },
        { path: '/PrvImage', data: origPrvImg },
        { path: '/BinData/BIN0001.bin', data: bigBin },
        { path: '/\x05HwpSummaryInformation', data: summary },
      ],
    })

    const newSec0 = makeRecord(66, 0, new Uint8Array(6000).fill(0x7f))
    const newPrvText = new Uint8Array(Buffer.from('updated preview', 'utf16le'))
    const rewritten = rewriteStreams(hwp, [
      { path: '/BodyText/Section0', data: newSec0 },
      { path: '/PrvText', data: newPrvText, plain: true },
    ])

    expect(rewritten).not.toBeNull()
    const out = rewritten!
    const info = inspectHwp5(out)
    expect(info.valid).toBe(true)
    expect(info.paths.some((p) => p.includes('Sh33tJ5'))).toBe(false)
    assertUnusedSlotsAreFree(out)

    expect(readStream(out, '/BodyText/Section0', true)).toEqual(newSec0)
    expect(readStream(out, '/PrvText', false)).toEqual(newPrvText)
    expect(readStream(out, '/PrvImage', false)).toEqual(origPrvImg)
    expect(readStream(out, '/BinData/BIN0001.bin', false)).toEqual(bigBin)
    expect(readStream(out, '/\x05HwpSummaryInformation', false)).toEqual(summary)

    // Missing replacement target returns null
    expect(rewriteStreams(hwp, [{ path: '/Missing', data: new Uint8Array([1]) }])).toBeNull()
  })

  it('strips tracked changes cleanly and rejects non-tracked or protected files', () => {
    const sec0 = makeRecord(66, 0, new Uint8Array([11, 22, 33, 44]))
    const summary = new Uint8Array([0xfe, 0xff, 0xaa, 0xbb])
    const tracked = makeHwp5({
      flags: FLAG_COMPRESSED | FLAG_TRACKED,
      sections: [sec0],
      extraStreams: [
        { path: '/ViewText/Section0', data: new Uint8Array([9, 9, 9]) },
        { path: '/\x05HwpSummaryInformation', data: summary },
      ],
    })

    const before = inspectHwp5(tracked)
    expect(before.tracked).toBe(true)
    expect(before.hasViewText).toBe(true)

    const stripped = stripTrackedChanges(tracked)
    expect(stripped).not.toBeNull()
    const out = stripped!
    assertUnusedSlotsAreFree(out)

    const after = inspectHwp5(out)
    expect(after.valid).toBe(true)
    expect(after.compressed).toBe(true)
    expect(after.tracked).toBe(false)
    expect(after.hasViewText).toBe(false)
    expect(after.sections).toBe(1)
    expect(after.paths.some((p) => /viewtext/i.test(p))).toBe(false)
    expect(after.paths.some((p) => p.includes('Sh33tJ5'))).toBe(false)
    expect(readStream(out, '/BodyText/Section0', true)).toEqual(sec0)
    expect(readStream(out, '/\x05HwpSummaryInformation', false)).toEqual(summary)

    // Rejects plain, encrypted, distribution
    expect(stripTrackedChanges(out)).toBeNull()
    expect(
      stripTrackedChanges(
        makeHwp5({
          flags: FLAG_COMPRESSED | FLAG_TRACKED | FLAG_ENCRYPTED,
          sections: [sec0],
          extraStreams: [{ path: '/ViewText/Section0', data: new Uint8Array([1]) }],
        }),
      ),
    ).toBeNull()
    expect(
      stripTrackedChanges(
        makeHwp5({
          flags: FLAG_COMPRESSED | FLAG_TRACKED | FLAG_DISTRIBUTION,
          sections: [sec0],
          extraStreams: [{ path: '/ViewText/Section0', data: new Uint8Array([1]) }],
        }),
      ),
    ).toBeNull()
  })

  it('exposes auto-initialized synchronous helpers from ./src/node', () => {
    const sec0 = makeRecord(66, 0, new Uint8Array([7, 8, 9]))
    const hwp = makeHwp5({ flags: 0, sections: [sec0] })
    const info = nodeApi.inspectHwp5(hwp)
    expect(info.valid).toBe(true)
    expect(info.compressed).toBe(false)
    expect(nodeApi.readStream(hwp, '/BodyText/Section0', false)).toEqual(sec0)
    expect(nodeApi.parseRecords(sec0)).toEqual([{ tag: 66, level: 0, start: 0, body: 4, end: 7 }])
  })
})
