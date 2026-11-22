import type { Stats } from 'node:fs'
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, isAbsolute, join, posix, win32 } from 'node:path'
import { tempPathBeside } from '@genoffice/electron-utils/atomic-write'
import { atomicWriteFile } from '../atomic-write'
import {
  comparablePath,
  folderRefusal,
  isPlainSegment,
  samePath,
  type RefusalContext,
} from '../projects/paths'

/**
 * Built-in local Obsidian Vault engine.
 *
 * Security invariants:
 * - Zero intrusion: never writes `.ieumoffice/` or any metadata/index file into a vault.
 * - `.md` files only; hidden segments (`.obsidian`, `.git`, `.hidden.md`, ...), `..`,
 *   absolute paths, symlinks/junctions, and hardlinks (`nlink > 1`) are all refused.
 * - Open-tab writes/deletes are refused (`isFileOpen`); unsaved open-tab reads are
 *   refused (`hasUnsavedChanges`); reads pass through `parseFileToText` (decision 0016).
 * - `delete_note` uses `trashItem` exclusively and never falls back to `unlink`.
 */

export interface VaultEntryLike {
  id: string
  name: string
  path: string
  enabled: boolean
}

export interface ObsidianVaultDeps {
  isFileOpen(absPath: string): Promise<boolean> | boolean
  hasUnsavedChanges(absPath: string): Promise<boolean> | boolean
  parseFileToText(absPath: string): Promise<{ ok: boolean; text?: string; error?: string }>
  trashItem(absPath: string): Promise<void>
  platform?: NodeJS.Platform
}

export interface ObsidianToolResult {
  output: string
  isError: boolean
}

export type ValidateVaultResult =
  | { ok: true; path: string; suggestedName: string; hasObsidianDir: boolean }
  | { ok: false; reason: 'forbidden' | 'not-a-folder'; detail?: string }

export interface VaultPickerNote {
  vaultId: string
  vaultName: string
  relPath: string
  absPath: string
  title: string
  mtimeMs: number
  tags: string[]
}

const MAX_SCAN_NOTES = 10_000
const MAX_SEARCH_READ_BYTES = 512 * 1024
const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200
const DEFAULT_SEARCH_LIMIT = 20
const MAX_SEARCH_LIMIT = 50
const DEFAULT_READ_LIMIT = 12_000
const MAX_READ_LIMIT = 30_000

const writeQueues = new Map<string, Promise<void>>()

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException | undefined)?.code ?? ''
}

async function lstatOrNull(filePath: string): Promise<Stats | null> {
  try {
    return await lstat(filePath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

function looksAbsolute(filePath: string): boolean {
  return (
    isAbsolute(filePath) ||
    win32.isAbsolute(filePath) ||
    posix.isAbsolute(filePath) ||
    /^[A-Za-z]:/.test(filePath)
  )
}

function serializeWrite<T>(
  filePath: string,
  platform: NodeJS.Platform,
  task: () => Promise<T>,
): Promise<T> {
  const key = comparablePath(filePath, platform)
  const previous = writeQueues.get(key) ?? Promise.resolve()
  const run = previous.then(task, task)
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  writeQueues.set(key, tail)
  void tail.then(() => {
    if (writeQueues.get(key) === tail) writeQueues.delete(key)
  })
  return run
}

/** Suggest a case-insensitively unique vault name */
export function suggestVaultName(baseName: string, existingNames: readonly string[]): string {
  const clean = baseName.trim() || 'Vault'
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()))
  if (!taken.has(clean.toLowerCase())) return clean
  for (let i = 2; i < 1000; i++) {
    const candidate = `${clean}-${i}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return `${clean}-${Date.now()}`
}

/** Validate a candidate vault folder before registering it */
export async function validateVaultFolder(
  folder: string,
  ctx: { homeDir: string; userData: string; platform?: NodeJS.Platform },
): Promise<ValidateVaultResult> {
  const platform = ctx.platform ?? process.platform
  if (!folder || typeof folder !== 'string' || !looksAbsolute(folder)) {
    return { ok: false, reason: 'not-a-folder', detail: 'not-absolute' }
  }
  let real: string
  try {
    real = (await realpath(folder)).normalize('NFC')
  } catch {
    return { ok: false, reason: 'not-a-folder', detail: 'missing' }
  }
  const refusalCtx: RefusalContext = {
    homeDir: ctx.homeDir,
    userData: ctx.userData,
    platform,
  }
  const refusal = folderRefusal(real, refusalCtx)
  if (refusal) {
    return {
      ok: false,
      reason: refusal === 'not-a-folder' ? 'not-a-folder' : 'forbidden',
      detail: refusal,
    }
  }
  const obsInfo = await lstatOrNull(join(real, '.obsidian'))
  const hasObsidianDir = Boolean(obsInfo && obsInfo.isDirectory() && !obsInfo.isSymbolicLink())
  const suggestedName = basename(real).trim() || 'Vault'
  return { ok: true, path: real, suggestedName, hasObsidianDir }
}

// ---- path security inside a vault -------------------------------------------

function parseMarkdownSegments(relPath: unknown): string[] | { error: string } {
  if (typeof relPath !== 'string' || relPath.trim() === '') {
    return { error: 'Note path must be a non-empty relative path ending in .md.' }
  }
  if (looksAbsolute(relPath)) {
    return { error: 'Absolute paths are not allowed; provide a path relative to the vault root.' }
  }
  const normalized = relPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const segments = normalized.split('/')
  for (const seg of segments) {
    if (!isPlainSegment(seg)) {
      return { error: `Invalid path segment "${seg}".` }
    }
    if (seg.startsWith('.')) {
      return { error: `Hidden files and folders ("${seg}") are not accessible in Obsidian vaults.` }
    }
  }
  const last = segments[segments.length - 1] ?? ''
  if (!/\.md$/i.test(last)) {
    return { error: 'Only Markdown (.md) notes are accessible in Obsidian vaults.' }
  }
  return segments
}

async function assertVaultRoot(
  vaultRoot: string,
  platform: NodeJS.Platform,
): Promise<string | null> {
  if (!looksAbsolute(vaultRoot)) return 'Vault path is not absolute.'
  try {
    const info = await lstat(vaultRoot)
    if (info.isSymbolicLink() || !info.isDirectory())
      return 'Vault folder is no longer a valid directory.'
    const real = await realpath(vaultRoot)
    if (!samePath(real, vaultRoot, platform)) return 'Vault folder path has moved or changed.'
    return null
  } catch {
    return 'Vault folder is missing or unreadable.'
  }
}

async function resolveExistingNote(
  vaultRoot: string,
  relPath: unknown,
  platform: NodeJS.Platform,
): Promise<{ ok: true; absPath: string; relPath: string } | { ok: false; error: string }> {
  const segs = parseMarkdownSegments(relPath)
  if (!Array.isArray(segs)) return { ok: false, error: segs.error }
  const rootErr = await assertVaultRoot(vaultRoot, platform)
  if (rootErr) return { ok: false, error: rootErr }

  let dir = vaultRoot
  for (const seg of segs.slice(0, -1)) {
    dir = join(dir, seg)
    const info = await lstatOrNull(dir)
    if (!info) return { ok: false, error: `Note not found: ${segs.join('/')}` }
    if (info.isSymbolicLink())
      return { ok: false, error: 'Symlinks and junctions are not allowed inside a vault.' }
    if (!info.isDirectory()) return { ok: false, error: `Invalid folder in path: ${seg}` }
  }
  if (!samePath(await realpath(dir), dir, platform)) {
    return { ok: false, error: 'Symlinks and junctions are not allowed inside a vault.' }
  }
  const target = join(dir, segs[segs.length - 1]!)
  const targetInfo = await lstatOrNull(target)
  if (!targetInfo) return { ok: false, error: `Note not found: ${segs.join('/')}` }
  if (targetInfo.isSymbolicLink()) {
    return { ok: false, error: 'Symlinked notes are not allowed inside a vault.' }
  }
  if (!targetInfo.isFile()) return { ok: false, error: 'Target path is not a regular file.' }
  if (targetInfo.nlink > 1) {
    return { ok: false, error: 'Hard-linked files are refused for safety.' }
  }
  return { ok: true, absPath: target, relPath: segs.join('/') }
}

async function resolveNewNote(
  vaultRoot: string,
  relPath: unknown,
  platform: NodeJS.Platform,
): Promise<{ ok: true; absPath: string; relPath: string } | { ok: false; error: string }> {
  const segs = parseMarkdownSegments(relPath)
  if (!Array.isArray(segs)) return { ok: false, error: segs.error }
  const rootErr = await assertVaultRoot(vaultRoot, platform)
  if (rootErr) return { ok: false, error: rootErr }

  let dir = vaultRoot
  for (const seg of segs.slice(0, -1)) {
    dir = join(dir, seg)
    let info = await lstatOrNull(dir)
    if (!info) {
      try {
        await mkdir(dir)
      } catch (error) {
        if (errorCode(error) !== 'EEXIST')
          return { ok: false, error: `Could not create folder: ${seg}` }
      }
      info = await lstatOrNull(dir)
    }
    if (!info) return { ok: false, error: `Could not access folder: ${seg}` }
    if (info.isSymbolicLink())
      return { ok: false, error: 'Symlinks and junctions are not allowed inside a vault.' }
    if (!info.isDirectory())
      return { ok: false, error: `Path component "${seg}" is not a directory.` }
  }
  if (!samePath(await realpath(dir), dir, platform)) {
    return { ok: false, error: 'Symlinks and junctions are not allowed inside a vault.' }
  }
  const target = join(dir, segs[segs.length - 1]!)
  const existing = await lstatOrNull(target)
  if (existing) {
    return {
      ok: false,
      error: `Note already exists: ${segs.join('/')}. Use update_note or append_note instead.`,
    }
  }
  return { ok: true, absPath: target, relPath: segs.join('/') }
}

// ---- scanning, tags, frontmatter, wikilinks ---------------------------------

interface ScannedNote {
  relPath: string
  absPath: string
  title: string
  mtimeMs: number
}

async function scanVaultNotes(
  vaultRoot: string,
  platform: NodeJS.Platform,
): Promise<ScannedNote[]> {
  if (await assertVaultRoot(vaultRoot, platform)) return []
  const notes: ScannedNote[] = []

  const walk = async (dir: string, relPrefix: string): Promise<void> => {
    if (notes.length >= MAX_SCAN_NOTES) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (notes.length >= MAX_SCAN_NOTES) return
      const name = entry.name
      if (!isPlainSegment(name) || name.startsWith('.')) continue
      const full = join(dir, name)
      const info = await lstatOrNull(full)
      if (!info || info.isSymbolicLink()) continue
      const rel = relPrefix ? `${relPrefix}/${name}` : name
      if (info.isDirectory()) {
        await walk(full, rel)
      } else if (info.isFile() && /\.md$/i.test(name) && info.nlink <= 1) {
        notes.push({
          relPath: rel,
          absPath: full,
          title: name.replace(/\.md$/i, ''),
          mtimeMs: info.mtimeMs,
        })
      }
    }
  }

  await walk(vaultRoot, '')
  notes.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return notes
}

function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')
}

export function extractFrontmatterAndTags(text: string): { frontmatter: string; tags: string[] } {
  const tags = new Set<string>()
  let frontmatter = ''
  let body = text
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (fmMatch) {
    frontmatter = fmMatch[1] ?? ''
    body = text.slice(fmMatch[0].length)
    // Inline YAML list: tags: [a, b] or tags: a, b
    const inlineTags = frontmatter.match(/^tags\s*:\s*\[([^\]]*)\]/im)
    if (inlineTags?.[1]) {
      for (const raw of inlineTags[1].split(',')) {
        const cleaned = raw.trim().replace(/^['"#]+|['"]+$/g, '')
        if (cleaned) tags.add(cleaned.toLowerCase())
      }
    } else {
      // Multiline YAML list under tags:
      const blockMatch = frontmatter.match(/^tags\s*:\s*\r?\n((?:[ \t]*-[ \t]*[^\r\n]+\r?\n?)+)/im)
      if (blockMatch?.[1]) {
        for (const line of blockMatch[1].split(/\r?\n/)) {
          const item = line
            .replace(/^[ \t]*-[ \t]*/, '')
            .trim()
            .replace(/^['"#]+|['"]+$/g, '')
          if (item) tags.add(item.toLowerCase())
        }
      } else {
        const single = frontmatter.match(/^tags\s*:\s*([^\r\n[]+)/im)
        if (single?.[1]) {
          for (const raw of single[1].split(/[,\s]+/)) {
            const cleaned = raw.trim().replace(/^['"#]+|['"]+$/g, '')
            if (cleaned) tags.add(cleaned.toLowerCase())
          }
        }
      }
    }
  }
  const cleanBody = stripCodeBlocks(body)
  for (const match of cleanBody.matchAll(
    /(?:^|[\s(])#([A-Za-z0-9_\u00C0-\u024F\u3131-\uD7A3/-]+)/g,
  )) {
    const tag = match[1]?.trim().toLowerCase()
    if (tag && !/^\d+$/.test(tag)) tags.add(tag)
  }
  return { frontmatter, tags: [...tags] }
}

function extractWikilinks(text: string): string[] {
  const clean = stripCodeBlocks(text)
  const targets = new Set<string>()
  for (const match of clean.matchAll(/(?<!!)\[\[([^[\]\r\n]+)\]\]/g)) {
    const raw = (match[1] ?? '').split('|')[0]?.split('#')[0]?.trim() ?? ''
    if (raw) targets.add(raw)
  }
  return [...targets]
}

function resolveWikilinks(
  links: readonly string[],
  notes: readonly ScannedNote[],
): { target: string; resolved: string[] }[] {
  const byRelLower = new Map<string, string>()
  const byBaseLower = new Map<string, string[]>()
  for (const note of notes) {
    const noExt = note.relPath.replace(/\.md$/i, '').toLowerCase()
    byRelLower.set(noExt, note.relPath)
    byRelLower.set(note.relPath.toLowerCase(), note.relPath)
    const base = note.title.toLowerCase()
    const bucket = byBaseLower.get(base) ?? []
    bucket.push(note.relPath)
    byBaseLower.set(base, bucket)
  }
  return links.map((target) => {
    const key = target.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
    const direct = byRelLower.get(key) ?? byRelLower.get(`${key}.md`)
    if (direct) return { target, resolved: [direct] }
    const byName = byBaseLower.get(key.replace(/\.md$/i, '')) ?? []
    return { target, resolved: byName }
  })
}

async function readNoteTextForIndex(absPath: string): Promise<string> {
  try {
    const info = await lstat(absPath)
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink > 1 ||
      info.size > MAX_SEARCH_READ_BYTES
    ) {
      return ''
    }
    return await readFile(absPath, 'utf8')
  } catch {
    return ''
  }
}

/** Reusable safe scanner for the shell's Obsidian Note Picker window */
export async function listVaultNotesForPicker(
  vaults: readonly VaultEntryLike[],
  options: { platform?: NodeJS.Platform } = {},
): Promise<VaultPickerNote[]> {
  const platform = options.platform ?? process.platform
  const all: VaultPickerNote[] = []
  for (const vault of vaults) {
    const scanned = await scanVaultNotes(vault.path, platform)
    for (const note of scanned) {
      const content = await readNoteTextForIndex(note.absPath)
      const { tags } = extractFrontmatterAndTags(content)
      all.push({
        vaultId: vault.id,
        vaultName: vault.name,
        relPath: note.relPath,
        absPath: note.absPath,
        title: note.title,
        mtimeMs: note.mtimeMs,
        tags,
      })
    }
  }
  all.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return all
}

// ---- multi-vault selection --------------------------------------------------

function pickVaults(
  activeVaults: readonly VaultEntryLike[],
  requestedVault: unknown,
  allowAllWhenMulti: boolean,
): { ok: true; vaults: VaultEntryLike[] } | { ok: false; error: string } {
  if (activeVaults.length === 0) {
    return { ok: false, error: 'No active Obsidian vault is available in this chat.' }
  }
  const names = activeVaults.map((v) => v.name)
  const req = typeof requestedVault === 'string' ? requestedVault.trim() : ''
  if (req) {
    const found = activeVaults.find((v) => v.name.toLowerCase() === req.toLowerCase())
    if (!found) {
      return {
        ok: false,
        error: `Obsidian vault "${req}" is not active in this chat. Active vaults: ${names.join(', ')}.`,
      }
    }
    return { ok: true, vaults: [found] }
  }
  if (activeVaults.length === 1) return { ok: true, vaults: [activeVaults[0]!] }
  if (allowAllWhenMulti) return { ok: true, vaults: [...activeVaults] }
  return {
    ok: false,
    error: `Multiple Obsidian vaults are active (${names.join(', ')}). Specify the "vault" parameter.`,
  }
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.min(Math.max(min, Math.floor(n)), max) : fallback
}

function normalizeTagFilter(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/^#/, '').toLowerCase() : ''
}

function insertUnderHeading(source: string, heading: string, content: string): string | null {
  const wanted = heading
    .trim()
    .replace(/^#+\s*/, '')
    .toLowerCase()
  if (!wanted) return null
  const lines = source.split(/\r?\n/)
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  let startLine = -1
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (m && m[2]!.trim().toLowerCase() === wanted) {
      startLine = i
      level = m[1]!.length
      break
    }
  }
  if (startLine < 0) return null
  let insertAt = lines.length
  for (let i = startLine + 1; i < lines.length; i++) {
    const m = lines[i]!.match(/^(#{1,6})\s+/)
    if (m && m[1]!.length <= level) {
      insertAt = i
      break
    }
  }
  // Insert right before trailing blank lines preceding the next heading
  while (insertAt > startLine + 1 && lines[insertAt - 1]!.trim() === '') {
    insertAt -= 1
  }
  const addition = content.replace(/\r?\n/g, eol).split(eol)
  lines.splice(insertAt, 0, ...addition)
  return lines.join(eol)
}

// ---- 7 tool executors -------------------------------------------------------

async function readNoteTextForAi(absPath: string, deps: ObsidianVaultDeps): Promise<string | null> {
  if (await deps.hasUnsavedChanges(absPath)) return null
  try {
    const info = await lstat(absPath)
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink > 1 ||
      info.size > MAX_SEARCH_READ_BYTES
    ) {
      return null
    }
    const parsed = await deps.parseFileToText(absPath)
    if (!parsed.ok || typeof parsed.text !== 'string') return null
    return parsed.text
  } catch {
    return null
  }
}

export async function executeObsidianTool(
  toolName: string,
  input: Record<string, unknown>,
  activeVaults: readonly VaultEntryLike[],
  deps: ObsidianVaultDeps,
): Promise<ObsidianToolResult> {
  const platform = deps.platform ?? process.platform
  const err = (msg: string): ObsidianToolResult => ({ output: msg, isError: true })

  if (toolName === 'list_notes') {
    const picked = pickVaults(activeVaults, input.vault, true)
    if (!picked.ok) return err(picked.error)
    const folderPrefix =
      typeof input.folder === 'string'
        ? input.folder
            .trim()
            .replace(/\\/g, '/')
            .replace(/^\/+|\/+$/g, '')
            .toLowerCase()
        : ''
    const tagFilter = normalizeTagFilter(input.tag)
    const limit = clampInt(input.limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT)
    const tagCounts = new Map<string, number>()
    const rows: { vault: string; relPath: string; mtimeMs: number; tags: string[] }[] = []

    for (const vault of picked.vaults) {
      const notes = await scanVaultNotes(vault.path, platform)
      for (const note of notes) {
        if (folderPrefix && !note.relPath.toLowerCase().startsWith(`${folderPrefix}/`)) continue
        const text = await readNoteTextForAi(note.absPath, deps)
        const { tags } = text !== null ? extractFrontmatterAndTags(text) : { tags: [] as string[] }
        if (tagFilter && !tags.includes(tagFilter)) continue
        for (const t of tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
        rows.push({ vault: vault.name, relPath: note.relPath, mtimeMs: note.mtimeMs, tags })
      }
    }
    rows.sort((a, b) => b.mtimeMs - a.mtimeMs)
    const shown = rows.slice(0, limit)
    const lines = shown.map(
      (r) =>
        `- [${r.vault}] ${r.relPath} (modified ${new Date(r.mtimeMs).toISOString().slice(0, 16)}Z${
          r.tags.length > 0 ? `, tags: ${r.tags.map((t) => `#${t}`).join(' ')}` : ''
        })`,
    )
    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([t, c]) => `#${t} (${c})`)
    const header = `Found ${rows.length} note(s)${rows.length > shown.length ? ` (showing ${shown.length})` : ''}.`
    const footer = topTags.length > 0 ? `\nTags: ${topTags.join(', ')}` : ''
    return {
      output: `${header}\n${lines.join('\n') || '(no matching notes)'}${footer}`,
      isError: false,
    }
  }

  if (toolName === 'search_notes') {
    const query = typeof input.query === 'string' ? input.query.trim() : ''
    if (!query) return err('query must be a non-empty string.')
    const picked = pickVaults(activeVaults, input.vault, true)
    if (!picked.ok) return err(picked.error)
    const tagFilter = normalizeTagFilter(input.tag)
    const limit = clampInt(input.limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT)
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const matches: {
      vault: string
      relPath: string
      title: string
      tags: string[]
      score: number
      mtimeMs: number
      snippet: string
    }[] = []

    for (const vault of picked.vaults) {
      const notes = await scanVaultNotes(vault.path, platform)
      for (const note of notes) {
        const safeText = await readNoteTextForAi(note.absPath, deps)
        const { frontmatter, tags } =
          safeText !== null ? extractFrontmatterAndTags(safeText) : { frontmatter: '', tags: [] }
        if (tagFilter && !tags.includes(tagFilter)) continue
        const text = safeText ?? ''
        const lowerTitle = note.title.toLowerCase()
        const lowerPath = note.relPath.toLowerCase()
        const lowerFm = frontmatter.toLowerCase()
        const lowerBody = text.toLowerCase()
        const tagBlob = tags.map((t) => `#${t}`).join(' ')
        let score = 0
        for (const term of terms) {
          const tClean = term.replace(/^#/, '')
          if (lowerTitle.includes(term)) score += 6
          else if (lowerPath.includes(term)) score += 4
          else if (tags.includes(tClean) || tagBlob.includes(term)) score += 5
          else if (lowerFm.includes(term)) score += 3
          else if (lowerBody.includes(term)) score += 2
          else {
            score = 0
            break
          }
        }
        if (score === 0) continue
        const firstIdx = lowerBody.indexOf(terms[0]!)
        const snippetStart = Math.max(0, firstIdx - 60)
        const snippet =
          firstIdx >= 0
            ? text
                .slice(snippetStart, snippetStart + 180)
                .replace(/\s+/g, ' ')
                .trim()
            : text.slice(0, 140).replace(/\s+/g, ' ').trim()
        matches.push({
          vault: vault.name,
          relPath: note.relPath,
          title: note.title,
          tags,
          score,
          mtimeMs: note.mtimeMs,
          snippet,
        })
      }
    }
    matches.sort((a, b) => b.score - a.score || b.mtimeMs - a.mtimeMs)
    const shown = matches.slice(0, limit)
    if (shown.length === 0) {
      return { output: `No notes matched "${query}".`, isError: false }
    }
    const lines = shown.map(
      (m) =>
        `[${m.vault}] ${m.relPath}${m.tags.length ? ` (${m.tags.map((t) => `#${t}`).join(' ')})` : ''}\n  ${m.snippet}`,
    )
    return {
      output: `Matched ${matches.length} note(s):\n${lines.join('\n')}`,
      isError: false,
    }
  }

  if (toolName === 'read_note') {
    const picked = pickVaults(activeVaults, input.vault, false)
    if (!picked.ok) return err(picked.error)
    const vault = picked.vaults[0]!
    const resolved = await resolveExistingNote(vault.path, input.path, platform)
    if (!resolved.ok) return err(resolved.error)
    if (await deps.hasUnsavedChanges(resolved.absPath)) {
      return err('This note is open with unsaved changes. Save it in the editor, then try again.')
    }
    const parsed = await deps.parseFileToText(resolved.absPath)
    if (!parsed.ok || typeof parsed.text !== 'string') {
      return err(parsed.error || 'Could not read note.')
    }
    const fullText = parsed.text
    const offset = clampInt(input.offset, 0, 0, Math.max(0, fullText.length))
    const limit = clampInt(input.limit, DEFAULT_READ_LIMIT, 200, MAX_READ_LIMIT)
    const slice = fullText.slice(offset, offset + limit)
    const end = offset + slice.length
    const more = end < fullText.length

    const links = extractWikilinks(fullText)
    let linkSection = ''
    if (links.length > 0) {
      const vaultNotes = await scanVaultNotes(vault.path, platform)
      const resolvedLinks = resolveWikilinks(links, vaultNotes)
      const formatted = resolvedLinks.map((l) =>
        l.resolved.length > 0
          ? `[[${l.target}]] -> ${l.resolved.join(', ')}`
          : `[[${l.target}]] -> (unresolved)`,
      )
      linkSection = `\n\nWikilinks:\n${formatted.join('\n')}`
    }

    return {
      output:
        `[${vault.name}] ${resolved.relPath} — characters ${offset}..${end} of ${fullText.length}` +
        (more ? ` (continue with offset=${end})` : ' (end)') +
        `\n\n${slice}${linkSection}`,
      isError: false,
    }
  }

  if (toolName === 'create_note') {
    const picked = pickVaults(activeVaults, input.vault, false)
    if (!picked.ok) return err(picked.error)
    if (typeof input.content !== 'string') return err('content must be a string.')
    const vault = picked.vaults[0]!
    const resolved = await resolveNewNote(vault.path, input.path, platform)
    if (!resolved.ok) return err(resolved.error)

    return serializeWrite(resolved.absPath, platform, async () => {
      if (await lstatOrNull(resolved.absPath)) {
        return err(`Note already exists: ${resolved.relPath}.`)
      }
      const temp = tempPathBeside(resolved.absPath)
      try {
        await writeFile(temp, Buffer.from(input.content as string, 'utf8'), { flag: 'wx' })
        if (await lstatOrNull(resolved.absPath)) {
          await unlink(temp).catch(() => undefined)
          return err(`Note already exists: ${resolved.relPath}.`)
        }
        await rename(temp, resolved.absPath)
      } catch (error) {
        await unlink(temp).catch(() => undefined)
        return err(`Failed to create note: ${(error as Error).message}`)
      }
      return { output: `Created [${vault.name}] ${resolved.relPath}.`, isError: false }
    })
  }

  if (toolName === 'append_note') {
    const picked = pickVaults(activeVaults, input.vault, false)
    if (!picked.ok) return err(picked.error)
    if (typeof input.content !== 'string') return err('content must be a string.')
    const vault = picked.vaults[0]!
    const resolved = await resolveExistingNote(vault.path, input.path, platform)
    if (!resolved.ok) return err(resolved.error)
    if (await deps.isFileOpen(resolved.absPath)) {
      return err(
        `Note "${resolved.relPath}" is currently open in an editor tab. Edit it in the open tab instead.`,
      )
    }

    return serializeWrite(resolved.absPath, platform, async () => {
      const recheck = await resolveExistingNote(vault.path, input.path, platform)
      if (!recheck.ok) return err(recheck.error)
      if (await deps.isFileOpen(recheck.absPath)) {
        return err(
          `Note "${recheck.relPath}" is currently open in an editor tab. Edit it in the open tab instead.`,
        )
      }
      const current = await readFile(recheck.absPath, 'utf8')
      let next: string
      if (typeof input.heading === 'string' && input.heading.trim()) {
        const inserted = insertUnderHeading(current, input.heading, input.content as string)
        if (inserted === null) {
          return err(`Heading "${input.heading}" was not found in ${recheck.relPath}.`)
        }
        next = inserted
      } else {
        const sep = current.length === 0 || current.endsWith('\n') ? '' : '\n'
        next = `${current}${sep}${input.content as string}`
      }
      await atomicWriteFile(recheck.absPath, Buffer.from(next, 'utf8'))
      return { output: `Appended to [${vault.name}] ${recheck.relPath}.`, isError: false }
    })
  }

  if (toolName === 'update_note') {
    const picked = pickVaults(activeVaults, input.vault, false)
    if (!picked.ok) return err(picked.error)
    const vault = picked.vaults[0]!
    const resolved = await resolveExistingNote(vault.path, input.path, platform)
    if (!resolved.ok) return err(resolved.error)
    if (await deps.isFileOpen(resolved.absPath)) {
      return err(
        `Note "${resolved.relPath}" is currently open in an editor tab. Edit it in the open tab instead.`,
      )
    }
    const hasFull = typeof input.content === 'string'
    const hasReplace = typeof input.old_text === 'string' && typeof input.new_text === 'string'
    if (!hasFull && !hasReplace) {
      return err('Provide either "content" (full replacement) or both "old_text" and "new_text".')
    }

    return serializeWrite(resolved.absPath, platform, async () => {
      const recheck = await resolveExistingNote(vault.path, input.path, platform)
      if (!recheck.ok) return err(recheck.error)
      if (await deps.isFileOpen(recheck.absPath)) {
        return err(
          `Note "${recheck.relPath}" is currently open in an editor tab. Edit it in the open tab instead.`,
        )
      }
      let next: string
      if (hasReplace) {
        const oldText = input.old_text as string
        const newText = input.new_text as string
        if (!oldText) return err('old_text must not be empty.')
        const current = await readFile(recheck.absPath, 'utf8')
        const first = current.indexOf(oldText)
        if (first < 0) return err(`old_text was not found in ${recheck.relPath}.`)
        if (input.replace_all === true) {
          next = current.split(oldText).join(newText)
        } else {
          if (current.indexOf(oldText, first + oldText.length) >= 0) {
            return err(
              `old_text matched multiple places in ${recheck.relPath}. Provide more surrounding context or set replace_all=true.`,
            )
          }
          next = `${current.slice(0, first)}${newText}${current.slice(first + oldText.length)}`
        }
      } else {
        next = input.content as string
      }
      await atomicWriteFile(recheck.absPath, Buffer.from(next, 'utf8'))
      return { output: `Updated [${vault.name}] ${recheck.relPath}.`, isError: false }
    })
  }

  if (toolName === 'delete_note') {
    const picked = pickVaults(activeVaults, input.vault, false)
    if (!picked.ok) return err(picked.error)
    const vault = picked.vaults[0]!
    const resolved = await resolveExistingNote(vault.path, input.path, platform)
    if (!resolved.ok) return err(resolved.error)
    if (await deps.isFileOpen(resolved.absPath)) {
      return err(
        `Note "${resolved.relPath}" is currently open in an editor tab. Close the tab before deleting it.`,
      )
    }

    return serializeWrite(resolved.absPath, platform, async () => {
      const recheck = await resolveExistingNote(vault.path, input.path, platform)
      if (!recheck.ok) return err(recheck.error)
      if (await deps.isFileOpen(recheck.absPath)) {
        return err(
          `Note "${recheck.relPath}" is currently open in an editor tab. Close the tab before deleting it.`,
        )
      }
      try {
        await deps.trashItem(recheck.absPath)
      } catch (error) {
        return err(
          `Could not move "${recheck.relPath}" to trash (file was not deleted): ${(error as Error).message}`,
        )
      }
      return { output: `Moved [${vault.name}] ${recheck.relPath} to OS trash.`, isError: false }
    })
  }

  return err(`Unknown Obsidian tool: ${toolName}`)
}
