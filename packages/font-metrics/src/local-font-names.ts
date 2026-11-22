/**
 * Per-face SFNT metadata (name, OS/2, head) for local font catalogs (HWP editor).
 *
 * The Hangul editor (rhwp-studio) otherwise calls FontData.blob() on every installed
 * face inside the renderer to read these three small tables. That pulls gigabytes of
 * font data (especially 100MB+ macOS CJK .ttc collections) through renderer Blobs and
 * hits open-file limits on Linux (#488) or crashes the renderer on macOS (#591).
 *
 * Reading the tables here via sfnt.ts opens one file descriptor at a time, reads only
 * the directory plus name/OS2/head bytes, closes immediately, and caches once per process.
 */
import { closeSync, openSync } from 'node:fs'

import { faceOffsets, readTable, readTableDir, systemFontFiles } from './sfnt'

/** Face identifier fields from Local Font Access (queryLocalFonts). */
export interface LocalFontFaceQuery {
  readonly family?: string
  readonly fullName?: string
  readonly postscriptName?: string
  readonly style?: string
}

/** SFNT name and style metadata matching rhwp-studio's SfntFontNames shape. */
export interface LocalFontNames {
  families: string[]
  fullNames: string[]
  postscriptNames: string[]
  styles: string[]
  weightClass?: number
  italic?: boolean
}

export interface ParsedLocalFontFace {
  readonly meta: LocalFontNames
  /** Extra ASCII PostScript/full names from Mac Roman (platform 1, encoding 0) for lookup only. */
  readonly lookupPostscriptNames: readonly string[]
  readonly lookupFullNames: readonly string[]
}

export interface LocalFontNameIndex {
  readonly byPostscript: Map<string, LocalFontNames[]>
  readonly byFullName: Map<string, LocalFontNames[]>
  readonly byFamilyStyle: Map<string, LocalFontNames[]>
  readonly byFamily: Map<string, LocalFontNames[]>
}

const MAX_FACES = 25_000
const MAX_NAME_CHARS = 512

/** Same normalization rhwp-studio uses (`normalizeFontAlias`). */
export function normalizeFontAlias(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replaceAll('\u0000', '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US')
}

function normalizeFontNames(values: readonly string[]): string[] {
  const byAlias = new Map<string, string>()
  for (const raw of values) {
    const cleaned = raw.replaceAll('\u0000', '').normalize('NFC').replace(/\s+/g, ' ').trim()
    const key = normalizeFontAlias(cleaned)
    if (key && !byAlias.has(key)) byAlias.set(key, cleaned)
  }
  return Array.from(byAlias.values()).sort((a, b) => a.localeCompare(b, 'ko'))
}

function decodeUtf16Be(buf: Buffer, off: number, len: number): string {
  const evenLen = len & ~1
  if (evenLen <= 0) return ''
  return Buffer.from(buf.subarray(off, off + evenLen))
    .swap16()
    .toString('utf16le')
}

/**
 * Parse Unicode SFNT names (platform 0 / 3) plus OS/2 & head weight/italic flags.
 * Matches rhwp-studio's parseSfntNameTable + readSfntFontNames logic.
 */
export function parseLocalFontMeta(
  nameBuf: Buffer | null,
  os2Buf: Buffer | null,
  headBuf: Buffer | null,
): ParsedLocalFontFace {
  const families: string[] = []
  const fullNames: string[] = []
  const postscriptNames: string[] = []
  const styles: string[] = []
  const lookupPostscriptNames: string[] = []
  const lookupFullNames: string[] = []

  if (nameBuf && nameBuf.length >= 6) {
    const count = nameBuf.readUInt16BE(2)
    const strBase = nameBuf.readUInt16BE(4)
    const recordsEnd = 6 + count * 12
    if (recordsEnd <= nameBuf.length && strBase <= nameBuf.length) {
      for (let i = 0; i < count; i++) {
        const r = 6 + i * 12
        const platform = nameBuf.readUInt16BE(r)
        const encoding = nameBuf.readUInt16BE(r + 2)
        const nameId = nameBuf.readUInt16BE(r + 6)
        const len = nameBuf.readUInt16BE(r + 8)
        const off = strBase + nameBuf.readUInt16BE(r + 10)
        if (len === 0 || off + len > nameBuf.length) continue

        if (platform === 0 || platform === 3) {
          const text = decodeUtf16Be(nameBuf, off, len).replaceAll('\u0000', '').trim()
          if (!text) continue
          if (nameId === 1 || nameId === 16) families.push(text)
          else if (nameId === 2 || nameId === 17) styles.push(text)
          else if (nameId === 4) fullNames.push(text)
          else if (nameId === 6) postscriptNames.push(text)
        } else if (platform === 1 && encoding === 0 && (nameId === 4 || nameId === 6)) {
          // Mac Roman ASCII names help match faces when Unicode records omit them,
          // without leaking legacy macOS codepages into display/alias names.
          const text = nameBuf
            .toString('latin1', off, off + len)
            .replaceAll('\u0000', '')
            .trim()
          if (!text || /[^\x20-\x7e]/.test(text)) continue
          if (nameId === 6) lookupPostscriptNames.push(text)
          else lookupFullNames.push(text)
        }
      }
    }
  }

  let weightClass: number | undefined
  let italic: boolean | undefined

  if (os2Buf && os2Buf.length >= 6) {
    const w = os2Buf.readUInt16BE(4)
    if (w >= 1 && w <= 1000) weightClass = w
    if (os2Buf.length >= 64) {
      italic = (os2Buf.readUInt16BE(62) & 0x0201) !== 0
    }
  }

  if (headBuf && headBuf.length >= 46) {
    const headStyle = headBuf.readUInt16BE(44)
    weightClass ??= (headStyle & 1) !== 0 ? 700 : 400
    italic ??= (headStyle & 2) !== 0
  }

  const meta: LocalFontNames = {
    families: normalizeFontNames(families),
    fullNames: normalizeFontNames(fullNames),
    postscriptNames: normalizeFontNames(postscriptNames),
    styles: normalizeFontNames(styles),
    ...(weightClass !== undefined ? { weightClass } : {}),
    ...(italic !== undefined ? { italic } : {}),
  }

  return { meta, lookupPostscriptNames, lookupFullNames }
}

function addToIndex(map: Map<string, LocalFontNames[]>, key: string, meta: LocalFontNames): void {
  if (!key) return
  const list = map.get(key)
  if (!list) map.set(key, [meta])
  else if (!list.includes(meta)) list.push(meta)
}

export function buildLocalFontNameIndex(faces: readonly ParsedLocalFontFace[]): LocalFontNameIndex {
  const byPostscript = new Map<string, LocalFontNames[]>()
  const byFullName = new Map<string, LocalFontNames[]>()
  const byFamilyStyle = new Map<string, LocalFontNames[]>()
  const byFamily = new Map<string, LocalFontNames[]>()

  for (const { meta, lookupPostscriptNames, lookupFullNames } of faces) {
    for (const ps of [...meta.postscriptNames, ...lookupPostscriptNames]) {
      addToIndex(byPostscript, normalizeFontAlias(ps), meta)
    }
    for (const full of [...meta.fullNames, ...lookupFullNames]) {
      addToIndex(byFullName, normalizeFontAlias(full), meta)
    }
    for (const family of meta.families) {
      addToIndex(byFamily, normalizeFontAlias(family), meta)
      for (const style of meta.styles) {
        addToIndex(byFamilyStyle, normalizeFontAlias(`${family} ${style}`), meta)
      }
    }
  }

  return { byPostscript, byFullName, byFamilyStyle, byFamily }
}

function mergeMetas(hits: readonly LocalFontNames[]): LocalFontNames {
  if (hits.length === 1) return hits[0]!
  const weightClass = hits.find((h) => h.weightClass !== undefined)?.weightClass
  const italic = hits.find((h) => h.italic !== undefined)?.italic
  return {
    families: normalizeFontNames(hits.flatMap((h) => h.families)),
    fullNames: normalizeFontNames(hits.flatMap((h) => h.fullNames)),
    postscriptNames: normalizeFontNames(hits.flatMap((h) => h.postscriptNames)),
    styles: normalizeFontNames(hits.flatMap((h) => h.styles)),
    ...(weightClass !== undefined ? { weightClass } : {}),
    ...(italic !== undefined ? { italic } : {}),
  }
}

function matchOne(query: LocalFontFaceQuery, index: LocalFontNameIndex): LocalFontNames | null {
  const ps = normalizeFontAlias(query.postscriptName)
  if (ps) {
    const hits = index.byPostscript.get(ps)
    if (hits && hits.length > 0) return mergeMetas(hits)
  }

  const full = normalizeFontAlias(query.fullName)
  if (full) {
    const hits = index.byFullName.get(full)
    if (hits && hits.length === 1) return hits[0]!
  }

  const familyStyle = normalizeFontAlias(`${query.family ?? ''} ${query.style ?? ''}`)
  if (familyStyle && query.family && query.style) {
    const hits = index.byFamilyStyle.get(familyStyle)
    if (hits && hits.length === 1) return hits[0]!
  }

  const family = normalizeFontAlias(query.family)
  if (family) {
    const hits = index.byFamily.get(family)
    if (hits && hits.length === 1) return hits[0]!
  }

  return null
}

/** Match each queried face to its SFNT metadata in input order; unmatched entries are null. */
export function resolveLocalFontNames(
  queries: readonly LocalFontFaceQuery[],
  index: LocalFontNameIndex,
): Array<LocalFontNames | null> {
  return queries.map((q) => matchOne(q, index))
}

/** Read metadata for every face in one font file, touching only the required tables. */
export function scanLocalFontFile(path: string, out: ParsedLocalFontFace[]): void {
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch {
    return
  }
  try {
    for (const offset of faceOffsets(fd)) {
      const tables = readTableDir(fd, offset)
      if (!tables) continue
      const nameBuf = readTable(fd, tables, 'name', 1 << 20)
      const os2Buf = readTable(fd, tables, 'OS/2', 512)
      const headBuf = readTable(fd, tables, 'head', 512)
      if (!nameBuf && !os2Buf && !headBuf) continue
      const parsed = parseLocalFontMeta(nameBuf, os2Buf, headBuf)
      if (
        parsed.meta.families.length > 0 ||
        parsed.meta.fullNames.length > 0 ||
        parsed.meta.postscriptNames.length > 0 ||
        parsed.lookupPostscriptNames.length > 0 ||
        parsed.lookupFullNames.length > 0
      ) {
        out.push(parsed)
      }
    }
  } catch {
    /* unreadable or malformed file: skip */
  } finally {
    closeSync(fd)
  }
}

let cachedScan: Promise<LocalFontNameIndex> | null = null

/**
 * Scan the OS's installed font directories once per process, yielding every 16 files so
 * the main process stays responsive. Uses systemFontFiles() only (never app template dirs).
 */
function installedLocalFontIndex(): Promise<LocalFontNameIndex> {
  cachedScan ??= (async () => {
    const faces: ParsedLocalFontFace[] = []
    let count = 0
    for (const path of systemFontFiles()) {
      scanLocalFontFile(path, faces)
      if (++count % 16 === 0) await new Promise<void>((r) => setImmediate(r))
    }
    return buildLocalFontNameIndex(faces)
  })()
  return cachedScan
}

function sanitizeField(value: unknown): string {
  return typeof value === 'string' && value.length <= MAX_NAME_CHARS ? value : ''
}

/** IPC entry: validate untrusted renderer face list and return per-face SFNT metadata. */
export async function localFontNamesFor(faces: unknown): Promise<Array<LocalFontNames | null>> {
  if (!Array.isArray(faces) || faces.length === 0) return []
  const queries: LocalFontFaceQuery[] = []
  const limit = Math.min(faces.length, MAX_FACES)
  for (let i = 0; i < limit; i++) {
    const item = faces[i]
    if (!item || typeof item !== 'object') {
      queries.push({})
      continue
    }
    const raw = item as Record<string, unknown>
    queries.push({
      family: sanitizeField(raw.family),
      fullName: sanitizeField(raw.fullName),
      postscriptName: sanitizeField(raw.postscriptName),
      style: sanitizeField(raw.style),
    })
  }
  return resolveLocalFontNames(queries, await installedLocalFontIndex())
}
