import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import {
  initHwp5WasmSync,
  inspectHwp5 as wasmInspectHwp5,
  isHwp5WasmReady,
  parseRecords as wasmParseRecords,
  readStream as wasmReadStream,
  rewriteStreams as wasmRewriteStreams,
} from '@genoffice/hwp5-wasm'
import type { Hwp5Info, StreamReplacement } from '@genoffice/hwp5-wasm'
import * as CFB from 'cfb'

/**
 * Reading and rewriting HWP 5 files (a compound file whose DocInfo and BodyText streams are
 * deflated lists of tagged records, as the public HWP 5.0 format describes them), for the
 * few things the module puts right in the bytes rhwp wrote (decisions 0024 and 0026).
 */

export const SECTION = (index: number): string => `/BodyText/Section${index}`
export const FILE_HEADER = '/FileHeader'
export const DOC_INFO = '/DocInfo'
export const SIGNATURE = 'HWP Document File'
/** FileHeader properties: the streams are deflated / encrypted / a distribution copy */
export const COMPRESSED = 0x1
export const ENCRYPTED = 0x2
export const DISTRIBUTION = 0x4
export const PARA_HEADER = 66
export const PARA_TEXT = 67
export const CTRL_HEADER = 71
export const LIST_HEADER = 72
/** A document has few sections; this only bounds the walk over a malformed container. */
export const MAX_SECTIONS = 4096

export interface HwpRecord {
  tag: number
  level: number
  start: number
  /** where its payload starts */
  body: number
  end: number
}

let customWasmPathResolver: (() => string) | null = null
let loadedWasmPath: string | null = null
let failedWasmPath: string | null = null

/** Registers an optional path resolver (e.g. for standalone CLI without process.resourcesPath). */
export function setHwp5WasmPathResolver(resolver: (() => string) | null): void {
  customWasmPathResolver = resolver
  failedWasmPath = null
}

/** Resets cached WASM path/failure state between tests. */
export function resetHwp5WasmForTests(): void {
  customWasmPathResolver = null
  loadedWasmPath = null
  failedWasmPath = null
}

function isWasmDisabledByEnv(): boolean {
  const flag = process.env.GENOFFICE_HWP5_WASM?.trim().toLowerCase()
  return flag === '0' || flag === 'off'
}

function resolveHwp5WasmPath(): string | null {
  const envPath = process.env.GENOFFICE_HWP5_WASM_PATH?.trim()
  if (envPath) return envPath

  if (customWasmPathResolver) {
    try {
      const resolved = customWasmPathResolver()
      return resolved || null
    } catch {
      return null
    }
  }

  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    const packaged = join(resourcesPath, 'wasm', 'hwp5_bg.wasm')
    if (existsSync(packaged)) return packaged
  }

  try {
    return createRequire(import.meta.url).resolve('@genoffice/hwp5-wasm/pkg/hwp5_wasm_bg.wasm')
  } catch {
    return null
  }
}

/**
 * Ensures the HWP 5 WASM module is loaded and ready.
 * Returns false ONLY when WASM is disabled via GENOFFICE_HWP5_WASM=0|off or on an
 * infrastructure failure (missing binary, read error, or invalid/uncompilable WASM).
 */
export function ensureHwp5Wasm(): boolean {
  if (isWasmDisabledByEnv()) return false
  const targetPath = resolveHwp5WasmPath()
  if (!targetPath) return false
  if (loadedWasmPath === targetPath && isHwp5WasmReady()) return true
  if (failedWasmPath === targetPath) return false

  try {
    const bytes = readFileSync(targetPath)
    if (isHwp5WasmReady()) {
      // wasm-bindgen's initSync is a no-op once initialized; validate any new path explicitly.
      if (!WebAssembly.validate(bytes)) {
        failedWasmPath = targetPath
        return false
      }
    } else {
      initHwp5WasmSync(bytes)
    }
    loadedWasmPath = targetPath
    failedWasmPath = null
    return true
  } catch {
    failedWasmPath = targetPath
    return false
  }
}

function normalizeHwpPath(path: string): string {
  const slash = path.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!slash) return '/'
  return slash.startsWith('/') ? slash : `/${slash}`
}

function recordsOfJs(data: Buffer): HwpRecord[] | null {
  const out: HwpRecord[] = []
  let at = 0
  while (at < data.length) {
    if (at + 4 > data.length) return null
    const start = at
    const word = data.readUInt32LE(at)
    let size = word >>> 20
    at += 4
    if (size === 0xfff) {
      if (at + 4 > data.length) return null
      size = data.readUInt32LE(at)
      at += 4
    }
    const body = at
    at += size
    if (at > data.length) return null
    out.push({ tag: word & 0x3ff, level: (word >>> 10) & 0x3ff, start, body, end: at })
  }
  return out
}

/** The records of a stream, or null when the bytes are not a whole list of records. */
export function recordsOf(data: Buffer): HwpRecord[] | null {
  if (ensureHwp5Wasm()) {
    return wasmParseRecords(data)
  }
  return recordsOfJs(data)
}

export type OpenedHwp =
  | {
      backend: 'wasm'
      bytes: Uint8Array
      info: Hwp5Info
      compressed: boolean
    }
  | {
      backend: 'cfb'
      cfb: CFB.CFB$Container
      compressed: boolean
    }

function openHwpCfb(file: Uint8Array): Extract<OpenedHwp, { backend: 'cfb' }> | null {
  let cfb: CFB.CFB$Container
  try {
    cfb = CFB.read(Buffer.from(file.buffer, file.byteOffset, file.byteLength), {
      type: 'buffer',
    })
  } catch {
    return null
  }
  const header = CFB.find(cfb, FILE_HEADER)
  if (!header?.content || header.content.length < 40) return null
  const bytes = Buffer.from(header.content as Uint8Array)
  if (bytes.toString('latin1', 0, SIGNATURE.length) !== SIGNATURE) return null
  const flags = bytes.readUInt32LE(36)
  if (flags & (ENCRYPTED | DISTRIBUTION)) return null
  // a second copy of the body for viewing: which copy the engine reads is not known here
  if (cfb.FullPaths.some((path) => /\/ViewText\//i.test(path))) return null
  return { backend: 'cfb', cfb, compressed: (flags & COMPRESSED) !== 0 }
}

/** A plain HWP 5 container, or null: not one, or one whose streams are not readable here. */
export function openHwp(file: Uint8Array): OpenedHwp | null {
  if (ensureHwp5Wasm()) {
    const { bytes, info } = inspectHwp5WithWasm(file)
    if (!info.valid || info.encrypted || info.distribution || info.hasViewText) return null
    return { backend: 'wasm', bytes, info, compressed: info.compressed }
  }
  return openHwpCfb(file)
}

const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

/**
 * Copies an OLE2 container and rewrites unused FAT/MiniFAT slots from END_OF_CHAIN (0xfffffffe)
 * to FREE (0xffffffff), returning null if the bytes are not a valid OLE2 layout or nothing changed.
 * Needed because SheetJS cfb pads unused sector table slots with END_OF_CHAIN, which Hangul reads
 * but Rust's strict cfb crate rejects on open.
 */
function normalizeOle2FreeSlots(file: Uint8Array): Uint8Array | null {
  if (file.byteLength < SECTOR) return null
  const view = Buffer.from(file.buffer, file.byteOffset, file.byteLength)
  if (!view.subarray(0, 8).equals(OLE2_MAGIC)) return null
  const sectorShift = view.readUInt16LE(30)
  const miniShift = view.readUInt16LE(32)
  if ((sectorShift !== 9 && sectorShift !== 12) || miniShift > sectorShift) return null
  const sectorSize = 1 << sectorShift
  const miniSectorSize = 1 << miniShift
  const fatPerSector = sectorSize / 4
  if (view.length < sectorSize || (view.length - sectorSize) % sectorSize !== 0) return null
  const sectors = (view.length - sectorSize) / sectorSize
  const sectorAt = (index: number): number => sectorSize + index * sectorSize

  const fatSectors: number[] = []
  for (let slot = 0; slot < HEADER_FAT_SLOTS; slot++) {
    const sector = view.readUInt32LE(76 + slot * 4)
    if (sector < sectors) fatSectors.push(sector)
  }
  let more = view.readUInt32LE(68)
  for (let guard = 0; more < sectors && guard < sectors; guard++) {
    const base = sectorAt(more)
    if (base + sectorSize > view.length) return null
    for (let slot = 0; slot < fatPerSector - 1; slot++) {
      const sector = view.readUInt32LE(base + slot * 4)
      if (sector < sectors) fatSectors.push(sector)
    }
    more = view.readUInt32LE(base + (fatPerSector - 1) * 4)
  }
  const next = (sector: number): number => {
    const table = fatSectors[Math.floor(sector / fatPerSector)]
    if (table === undefined) return END_OF_CHAIN
    const base = sectorAt(table)
    if (base + sectorSize > view.length) return END_OF_CHAIN
    return view.readUInt32LE(base + (sector % fatPerSector) * 4)
  }

  const miniSectors: number[] = []
  let mini = view.readUInt32LE(60)
  for (let guard = 0; mini < sectors && guard < sectors; guard++) {
    miniSectors.push(mini)
    mini = next(mini)
  }
  const dirFirst = view.readUInt32LE(48)
  if (dirFirst >= sectors) return null
  const dirBase = sectorAt(dirFirst)
  if (dirBase + 128 > view.length) return null
  const rootSize =
    sectorShift === 9
      ? view.readUInt32LE(dirBase + 120)
      : Number(view.readBigUInt64LE(dirBase + 120))
  const usedMini = Math.ceil(rootSize / miniSectorSize)

  const freeFrom = (
    tableSectors: number[],
    used: number,
    current: Buffer | null,
  ): Buffer | null => {
    let out = current
    tableSectors.forEach((sector, nth) => {
      const base = sectorAt(sector)
      if (base + sectorSize > view.length) return
      for (let slot = 0; slot < fatPerSector; slot++) {
        const at = base + slot * 4
        if (nth * fatPerSector + slot >= used && view.readUInt32LE(at) === END_OF_CHAIN) {
          out ??= Buffer.from(view)
          out.writeUInt32LE(FREE, at)
        }
      }
    })
    return out
  }
  let copy = freeFrom(miniSectors, usedMini, null)
  copy = freeFrom(fatSectors, sectors, copy)
  return copy ? new Uint8Array(copy.buffer, copy.byteOffset, copy.byteLength) : null
}

/**
 * Inspects an HWP 5 container with the WASM backend. When the strict OLE2 reader rejects a
 * leniently padded container (unused FAT/MiniFAT slots set to END_OF_CHAIN rather than FREE),
 * normalizes only those unused table slots in memory and retries in WASM — never falling back to JS cfb.
 */
export function inspectHwp5WithWasm(file: Uint8Array): { bytes: Uint8Array; info: Hwp5Info } {
  const info = wasmInspectHwp5(file)
  if (info.valid) return { bytes: file, info }
  const normalized = normalizeOle2FreeSlots(file)
  if (!normalized) return { bytes: file, info }
  return { bytes: normalized, info: wasmInspectHwp5(normalized) }
}

/** Whether the container holds a stream entry at `path` (case-insensitive). */
export function hasStream(opened: OpenedHwp, path: string): boolean {
  const norm = normalizeHwpPath(path)
  if (opened.backend === 'wasm') {
    const needle = norm.toLowerCase()
    return opened.info.streamPaths.some((candidate) => candidate.toLowerCase() === needle)
  }
  const entry = CFB.find(opened.cfb, norm)
  return entry?.type === 2
}

function rawStreamOf(opened: OpenedHwp, path: string): Buffer | null {
  if (opened.backend === 'wasm') {
    const raw = wasmReadStream(opened.bytes, path, false)
    return raw ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength) : null
  }
  const entry = CFB.find(opened.cfb, path)
  if (!entry || entry.type !== 2) return null
  return Buffer.from((entry.content ?? []) as Uint8Array)
}

export function streamOf(opened: OpenedHwp, path: string): Buffer | null {
  if (opened.backend === 'wasm') {
    const data = wasmReadStream(opened.bytes, path, opened.compressed)
    return data ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : null
  }
  const entry = CFB.find(opened.cfb, path)
  if (!entry?.content) return null
  const raw = Buffer.from(entry.content as Uint8Array)
  return opened.compressed ? inflateRawSync(raw) : raw
}

export function sectionCount(opened: OpenedHwp): number {
  if (opened.backend === 'wasm') return opened.info.sections
  let count = 0
  while (count < MAX_SECTIONS && CFB.find(opened.cfb, SECTION(count))) count++
  return count
}

const SECTOR = 512
const MINI_SECTOR = 64
const FAT_PER_SECTOR = SECTOR / 4
const END_OF_CHAIN = 0xfffffffe
const FREE = 0xffffffff
/** FAT sectors the header itself lists; more are listed in a chain of sectors of their own */
const HEADER_FAT_SLOTS = 109
/** The library puts a stream of its own, by this name, into every container it writes. */
const LIBRARY_MARKER = ' Sh33tJ5'

/**
 * The container as a file (JS cfb fallback only). Two things the library does are undone,
 * because the document is the user's and rhwp must read it back whole:
 * - it adds a marker stream of its own unless it finds one. An unused entry by that name
 *   at the end of the directory is found, and dropped again before anything is written.
 * - it fills the unused entries of the sector tables with "end of chain" rather than
 *   "free". Hangul reads that; rhwp's strict reader does not, and falls back to a reader
 *   that leaves out the preview picture, the summary and the scripts on the next save.
 */
export function writeContainer(cfb: CFB.CFB$Container): Buffer {
  cfb.FileIndex.push({ name: LIBRARY_MARKER, type: 0 } as CFB.CFB$Entry)
  cfb.FullPaths.push(cfb.FullPaths[0] + LIBRARY_MARKER)
  const file = CFB.write(cfb, { type: 'buffer' }) as Buffer
  const sectors = (file.length - SECTOR) / SECTOR
  const sectorAt = (index: number): number => SECTOR + index * SECTOR
  const freeFrom = (tableSectors: number[], used: number): void => {
    tableSectors.forEach((sector, nth) => {
      for (let slot = 0; slot < FAT_PER_SECTOR; slot++) {
        const at = sectorAt(sector) + slot * 4
        if (nth * FAT_PER_SECTOR + slot >= used && file.readUInt32LE(at) === END_OF_CHAIN) {
          file.writeUInt32LE(FREE, at)
        }
      }
    })
  }
  // the sectors of the FAT: the header lists the first ones, a chain of sectors the rest
  const fatSectors: number[] = []
  for (let slot = 0; slot < HEADER_FAT_SLOTS; slot++) {
    const sector = file.readUInt32LE(76 + slot * 4)
    if (sector < sectors) fatSectors.push(sector)
  }
  let more = file.readUInt32LE(68)
  for (let guard = 0; more < sectors && guard < sectors; guard++) {
    for (let slot = 0; slot < FAT_PER_SECTOR - 1; slot++) {
      const sector = file.readUInt32LE(sectorAt(more) + slot * 4)
      if (sector < sectors) fatSectors.push(sector)
    }
    more = file.readUInt32LE(sectorAt(more) + (FAT_PER_SECTOR - 1) * 4)
  }
  const next = (sector: number): number => {
    const table = fatSectors[Math.floor(sector / FAT_PER_SECTOR)]
    return table === undefined
      ? END_OF_CHAIN
      : file.readUInt32LE(sectorAt(table) + (sector % FAT_PER_SECTOR) * 4)
  }
  // the mini FAT is a chain in the FAT; the size of the root entry says how much of it is used
  const miniSectors: number[] = []
  let mini = file.readUInt32LE(60)
  for (let guard = 0; mini < sectors && guard < sectors; guard++) {
    miniSectors.push(mini)
    mini = next(mini)
  }
  const rootSize = file.readUInt32LE(sectorAt(file.readUInt32LE(48)) + 120)
  freeFrom(miniSectors, Math.ceil(rootSize / MINI_SECTOR))
  freeFrom(fatSectors, sectors)
  return file
}

/**
 * The storages and streams of a container in canonical `/...` form (storages end with `/`);
 * the root entry and unused directory entries are excluded.
 */
export function pathsOf(opened: OpenedHwp): string[] {
  if (opened.backend === 'wasm') {
    return [...opened.info.paths]
  }
  const root = opened.cfb.FullPaths[0] ?? ''
  const prefix = root.endsWith('/') ? root : `${root}/`
  const out: string[] = []
  opened.cfb.FullPaths.forEach((full, index) => {
    const entry = opened.cfb.FileIndex[index]
    if (!entry || entry.type === 0 || entry.type === 5 || index === 0) return
    const rel = full.startsWith(prefix) ? `/${full.slice(prefix.length)}` : normalizeHwpPath(full)
    if (entry.type === 1) {
      out.push(rel.endsWith('/') ? rel : `${rel}/`)
    } else {
      out.push(rel.endsWith('/') ? rel.slice(0, -1) : rel)
    }
  })
  return out
}

/**
 * The two containers hold the same streams with the same bytes; `changed` ones hold these.
 * `plain` names changed streams kept uncompressed in a compressed file (the preview).
 */
export function sameStreams(
  before: OpenedHwp,
  after: OpenedHwp,
  changed: Map<string, Buffer>,
  plain: ReadonlySet<string> = new Set(),
): boolean {
  const paths = pathsOf(before)
  const now = pathsOf(after)
  if (paths.length !== now.length || !paths.every((path) => now.includes(path))) return false
  for (const path of paths) {
    // a storage holds no bytes of its own: that it is still there was checked above
    if (path.endsWith('/')) continue
    const meant = changed.get(path)
    if (meant) {
      const back = plain.has(path) ? rawStreamOf(after, path) : streamOf(after, path)
      if (!back || !back.equals(meant)) return false
    } else {
      const was = rawStreamOf(before, path)
      const is = rawStreamOf(after, path)
      if (!was || !is || !was.equals(is)) return false
    }
  }
  return true
}

/**
 * The file with some streams replaced (`changed`: path -> uncompressed bytes), written and
 * read back: null unless every other stream came back as it was and the changed ones as
 * meant. The streams named in `plain` are written as given even in a compressed file:
 * HWP 5 never compresses the preview (`/PrvText`, `/PrvImage`).
 */
export function rewriteStreams(
  opened: OpenedHwp,
  changed: Map<string, Buffer>,
  plain: ReadonlySet<string> = new Set(),
): Buffer | null {
  if (opened.backend === 'wasm') {
    const replacements: StreamReplacement[] = []
    for (const [path, data] of changed) {
      replacements.push({ path, data, plain: plain.has(path) })
    }
    const written = wasmRewriteStreams(opened.bytes, replacements)
    return written ? Buffer.from(written.buffer, written.byteOffset, written.byteLength) : null
  }
  for (const [path, data] of changed) {
    const entry = CFB.find(opened.cfb, path)
    if (!entry) return null
    const content = opened.compressed && !plain.has(path) ? deflateRawSync(data) : data
    entry.content = content
    entry.size = content.length
  }
  const written = writeContainer(opened.cfb)
  const check = openHwpCfb(written)
  return check && sameStreams(opened, check, changed, plain) ? written : null
}
