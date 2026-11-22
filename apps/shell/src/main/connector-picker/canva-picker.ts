import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConnectorAttachWireResult } from '@genoffice/electron-utils/connector-attach-channels'
import type { ConnectorPickerItem } from '../../shared/connector-picker-api'
import { atomicWriteFile } from '../atomic-write'
import type { NotionPickerCallAnswer, NotionToolDescriptor } from './notion-picker'

/** Subdirectory under OS temp dir where Canva design snapshots and exports are stored */
export const CANVA_ATTACH_SUBDIR = 'ieumoffice-canva-attach'
/** Maximum number of Canva designs that may be attached in one pick */
export const MAX_CANVA_PICKS = 20
/** Maximum size of an exported Canva PPTX/PDF download (100 MB) */
export const MAX_CANVA_EXPORT_BYTES = 100 * 1024 * 1024
/** Cleanup threshold for cached Canva attach snapshots and exports (7 days) */
const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface CanvaToolSet {
  searchTool: NotionToolDescriptor
  readTool: NotionToolDescriptor
  exportFormatsTool: NotionToolDescriptor | null
  exportTool: NotionToolDescriptor | null
}

/**
 * Discover Canva search, read, and export tools from the connected Canva MCP
 * server catalog.
 */
export function findCanvaTools(tools: readonly NotionToolDescriptor[]): CanvaToolSet | null {
  const byExact = (name: string) => tools.find((t) => t.name.toLowerCase() === name) ?? null
  const searchTool =
    byExact('search-designs') ??
    tools.find(
      (t) => t.name.toLowerCase().includes('search') && t.name.toLowerCase().includes('design'),
    ) ??
    null
  const readTool =
    byExact('read-design') ??
    tools.find(
      (t) => t.name.toLowerCase().includes('read') && t.name.toLowerCase().includes('design'),
    ) ??
    null
  if (!searchTool || !readTool) return null
  const exportFormatsTool =
    byExact('get-export-formats') ??
    tools.find((t) => t.name.toLowerCase().includes('export-format')) ??
    null
  const exportTool =
    byExact('export-design') ??
    tools.find(
      (t) => t.name.toLowerCase().includes('export') && t.name.toLowerCase().includes('design'),
    ) ??
    null
  return { searchTool, readTool, exportFormatsTool, exportTool }
}

/** Build schema-compliant arguments for Canva's `search-designs` tool */
export function buildCanvaSearchInput(query: string): Record<string, unknown> {
  const clean = query.trim()
  if (clean) {
    return {
      query: clean,
      sort_by: 'relevance',
      limit: 30,
      user_intent: 'Search the user’s Canva designs to attach or open in the editor',
    }
  }
  return {
    sort_by: 'modified_descending',
    limit: 30,
    user_intent: 'List the user’s recent Canva designs for selection',
  }
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenced) {
      try {
        return JSON.parse(fenced[1]!.trim())
      } catch {
        // fall through
      }
    }
    const start = trimmed.search(/[{[]/)
    if (start >= 0) {
      try {
        return JSON.parse(trimmed.slice(start))
      } catch {
        // fall through
      }
    }
    return null
  }
}

function epochOrIsoToIso(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    // Canva returns Unix seconds (e.g. 1771856225); handle ms too just in case
    const ms = raw > 1e12 ? raw : raw * 1000
    return new Date(ms).toISOString()
  }
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return ''
}

/** Parse Canva `search-designs` tool output into picker items */
export function parseCanvaSearchResults(output: string): ConnectorPickerItem[] {
  const parsed = tryParseJson(output)
  let rawList: unknown[] = []
  if (Array.isArray(parsed)) {
    rawList = parsed
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    for (const key of ['items', 'designs', 'results', 'data']) {
      if (Array.isArray(obj[key])) {
        rawList = obj[key] as unknown[]
        break
      }
    }
  }

  const items: ConnectorPickerItem[] = []
  const seen = new Set<string>()
  for (const row of rawList) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const id =
      typeof rec.design_id === 'string' && rec.design_id.trim()
        ? rec.design_id.trim()
        : typeof rec.id === 'string' && rec.id.trim()
          ? rec.id.trim()
          : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    const title =
      typeof rec.title === 'string' && rec.title.trim()
        ? rec.title.trim()
        : typeof rec.name === 'string' && rec.name.trim()
          ? rec.name.trim()
          : id
    const subtitle = epochOrIsoToIso(rec.updated_at ?? rec.created_at)
    const pageCount =
      typeof rec.page_count === 'number' && Number.isFinite(rec.page_count) && rec.page_count > 0
        ? Math.floor(rec.page_count)
        : undefined
    const designTypes = Array.isArray(rec.design_types)
      ? rec.design_types.filter((t): t is string => typeof t === 'string' && t.trim() !== '')
      : undefined
    items.push({
      id,
      title,
      subtitle,
      ...(pageCount !== undefined ? { pageCount } : {}),
      ...(designTypes && designTypes.length > 0 ? { designTypes } : {}),
    })
  }
  return items
}

function collectTextNodes(node: unknown, out: string[], depth = 0): void {
  if (depth > 16 || node === null || node === undefined) return
  if (typeof node === 'string') {
    const clean = node.trim()
    if (clean) out.push(clean)
    return
  }
  if (Array.isArray(node)) {
    for (const item of node) collectTextNodes(item, out, depth + 1)
    return
  }
  if (typeof node !== 'object') return
  const rec = node as Record<string, unknown>
  // Common Canva text-bearing fields
  for (const key of [
    'text',
    'plain_text',
    'content',
    'label',
    'heading',
    'body',
    'notes',
    'note',
  ]) {
    if (typeof rec[key] === 'string' && rec[key].trim()) {
      out.push(rec[key].trim())
    }
  }
  for (const key of [
    'elements',
    'children',
    'items',
    'blocks',
    'paragraphs',
    'rows',
    'cells',
    'richtexts',
  ]) {
    if (rec[key] !== undefined) collectTextNodes(rec[key], out, depth + 1)
  }
}

/**
 * Convert Canva `read-design` output into clean, compact Markdown for AI attachment.
 */
export function formatCanvaDesignMarkdown(rawOutput: string, fallbackTitle: string): string {
  const parsed = tryParseJson(rawOutput)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const plain = rawOutput.trim()
    if (!plain) return fallbackTitle ? `# ${fallbackTitle}\n` : ''
    return fallbackTitle && !/^#\s+/.test(plain) ? `# ${fallbackTitle}\n\n${plain}\n` : `${plain}\n`
  }

  const rec = parsed as Record<string, unknown>
  const meta =
    rec.design_metadata && typeof rec.design_metadata === 'object'
      ? (rec.design_metadata as Record<string, unknown>)
      : null
  const title =
    (typeof meta?.title === 'string' && meta.title.trim()) ||
    (typeof rec.title === 'string' && rec.title.trim()) ||
    fallbackTitle.trim() ||
    'Canva Design'

  const lines: string[] = [`# ${title}`]
  const pageCount =
    typeof meta?.page_count === 'number'
      ? meta.page_count
      : Array.isArray(rec.page_metadata)
        ? rec.page_metadata.length
        : null
  if (pageCount && pageCount > 0) {
    lines.push('', `Pages: ${pageCount}`)
  }

  // Page-by-page extraction when `design_content` or `pages` is structured as an array/object
  const contentRoot = rec.design_content ?? rec.pages ?? rec.content
  let extractedPages = false

  if (Array.isArray(contentRoot) && contentRoot.length > 0) {
    contentRoot.forEach((page, idx) => {
      const texts: string[] = []
      collectTextNodes(page, texts)
      const deduped = texts.filter((t, i) => i === 0 || t !== texts[i - 1])
      if (deduped.length > 0) {
        extractedPages = true
        const pRec = page && typeof page === 'object' ? (page as Record<string, unknown>) : null
        const pNum =
          typeof pRec?.page_number === 'number'
            ? pRec.page_number
            : typeof pRec?.index === 'number'
              ? pRec.index
              : idx + 1
        lines.push('', `## Page ${pNum}`, '', ...deduped)
      }
    })
  } else if (contentRoot && typeof contentRoot === 'object') {
    const cRec = contentRoot as Record<string, unknown>
    if (Array.isArray(cRec.pages)) {
      cRec.pages.forEach((page, idx) => {
        const texts: string[] = []
        collectTextNodes(page, texts)
        const deduped = texts.filter((t, i) => i === 0 || t !== texts[i - 1])
        if (deduped.length > 0) {
          extractedPages = true
          const pRec = page && typeof page === 'object' ? (page as Record<string, unknown>) : null
          const pNum =
            typeof pRec?.page_number === 'number'
              ? pRec.page_number
              : typeof pRec?.index === 'number'
                ? pRec.index
                : idx + 1
          lines.push('', `## Page ${pNum}`, '', ...deduped)
        }
      })
    } else {
      const texts: string[] = []
      collectTextNodes(contentRoot, texts)
      if (texts.length > 0) {
        extractedPages = true
        lines.push('', ...texts)
      }
    }
  } else if (typeof contentRoot === 'string' && contentRoot.trim()) {
    extractedPages = true
    lines.push('', contentRoot.trim())
  }

  // Presenter notes if present
  if (rec.presenter_notes !== undefined) {
    const notes: string[] = []
    collectTextNodes(rec.presenter_notes, notes)
    if (notes.length > 0) {
      lines.push('', '## Presenter Notes', '', ...notes)
    }
  }

  if (!extractedPages) {
    // Fallback: preserve compact JSON when Canva returned an unexpected schema
    lines.push('', '```json', JSON.stringify(rec, null, 2).slice(0, 20_000), '```')
  }

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`
}

function safeFileName(title: string, id: string, ext: string, index: number): string {
  let noCtrl = ''
  for (const ch of title) {
    noCtrl += ch.charCodeAt(0) < 32 ? ' ' : ch
  }
  const cleaned = noCtrl
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
  const base = cleaned || `canva-design-${index + 1}`
  const shortId = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-8) || `${Date.now().toString(36)}`
  return `${base}-${shortId}.${ext}`
}

/** Remove temporary Canva snapshot/export files older than 7 days */
export async function cleanupOldCanvaFiles(
  attachDir: string,
  nowMs: number = Date.now(),
): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(attachDir)
  } catch {
    return
  }
  const cutoff = nowMs - SNAPSHOT_MAX_AGE_MS
  await Promise.all(
    entries.map(async (name) => {
      if (!/\.(md|pptx|pdf)$/i.test(name)) return
      const full = join(attachDir, name)
      try {
        const info = await stat(full)
        if (info.isFile() && info.mtimeMs < cutoff) {
          await unlink(full)
        }
      } catch {
        // ignore stale or vanished files
      }
    }),
  )
}

export interface FetchCanvaDesignsParams {
  serverId: string
  selectedItems: readonly ConnectorPickerItem[]
  readTool: NotionToolDescriptor
  callForUserPicker: (
    serverId: string,
    tool: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<NotionPickerCallAnswer>
  attachDir: string
  signal?: AbortSignal
}

/**
 * Fetch up to 20 selected Canva designs via `read-design` and save clean
 * Markdown snapshots into `attachDir` for AI chat attachment.
 */
export async function fetchCanvaDesignsToTemp(
  params: FetchCanvaDesignsParams,
): Promise<ConnectorAttachWireResult> {
  const items = params.selectedItems.slice(0, MAX_CANVA_PICKS)
  if (items.length === 0) return { ok: false, reason: 'cancelled' }

  await mkdir(params.attachDir, { recursive: true })
  const paths: string[] = []
  let failed = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const res = await params.callForUserPicker(
      params.serverId,
      params.readTool.name,
      {
        design_id: item.id,
        filter: { fields: ['design_metadata', 'design_content', 'presenter_notes'] },
        user_intent: 'Read selected Canva design content to attach to document chat',
      },
      params.signal,
    )
    if (!res.ok || res.isError || !res.output.trim()) {
      failed += 1
      continue
    }
    const markdown = formatCanvaDesignMarkdown(res.output, item.title)
    const filePath = join(params.attachDir, safeFileName(item.title, item.id, 'md', i))
    await atomicWriteFile(filePath, Buffer.from(markdown, 'utf8'))
    paths.push(filePath)
  }

  if (paths.length === 0) {
    return { ok: false, reason: 'failed' }
  }
  return {
    ok: true,
    paths,
    ...(failed > 0 ? { failed } : {}),
  }
}

/** Pick preferred tab-openable export format (`pptx` for presentations, else `pdf`) */
export function pickCanvaExportFormat(formatsOutput: string): 'pptx' | 'pdf' | null {
  const parsed = tryParseJson(formatsOutput)
  const supported = new Set<string>()
  const visit = (val: unknown, depth = 0): void => {
    if (depth > 8 || val === null || val === undefined) return
    if (typeof val === 'string') {
      const lower = val.toLowerCase()
      if (lower === 'pptx' || lower === 'pdf') supported.add(lower)
      return
    }
    if (Array.isArray(val)) {
      for (const x of val) visit(x, depth + 1)
      return
    }
    if (typeof val === 'object') {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        const lower = k.toLowerCase()
        if ((lower === 'pptx' || lower === 'pdf') && v !== false && v !== null) {
          supported.add(lower)
        }
        visit(v, depth + 1)
      }
    }
  }
  visit(parsed)
  if (supported.has('pptx')) return 'pptx'
  if (supported.has('pdf')) return 'pdf'
  // Fallback text scan when the response isn't JSON
  if (/\bpptx\b/i.test(formatsOutput)) return 'pptx'
  if (/\bpdf\b/i.test(formatsOutput)) return 'pdf'
  return null
}

/** Check that a Canva export download URL is strictly HTTPS on a public host */
export function isAllowedCanvaDownloadUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local') ||
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host)
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}

/** Extract the first downloadable HTTPS URL from Canva's `export-design` output */
export function extractCanvaExportUrl(output: string): string | null {
  const parsed = tryParseJson(output)
  const urls: string[] = []
  const visit = (val: unknown, depth = 0): void => {
    if (depth > 8 || val === null || val === undefined) return
    if (typeof val === 'string') {
      if (/^https:\/\//i.test(val.trim())) urls.push(val.trim())
      return
    }
    if (Array.isArray(val)) {
      for (const x of val) visit(x, depth + 1)
      return
    }
    if (typeof val === 'object') {
      const rec = val as Record<string, unknown>
      for (const key of ['urls', 'url', 'download_url', 'downloadUrl', 'job', 'result', 'export']) {
        if (rec[key] !== undefined) visit(rec[key], depth + 1)
      }
      for (const v of Object.values(rec)) visit(v, depth + 1)
    }
  }
  visit(parsed)
  for (const candidate of urls) {
    if (isAllowedCanvaDownloadUrl(candidate)) return candidate
  }
  const regexMatch = output.match(/https:\/\/[^\s"'<>]+/i)
  if (regexMatch && isAllowedCanvaDownloadUrl(regexMatch[0])) return regexMatch[0]
  return null
}

export interface ExportCanvaDesignParams {
  serverId: string
  item: ConnectorPickerItem
  tools: CanvaToolSet
  callForUserPicker: (
    serverId: string,
    tool: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<NotionPickerCallAnswer>
  fetchBytes: (url: string, signal?: AbortSignal) => Promise<Uint8Array>
  attachDir: string
  signal?: AbortSignal
}

export type ExportCanvaDesignResult =
  { ok: true; path: string; format: 'pptx' | 'pdf' } | { ok: false; error: string }

/**
 * Export one Canva design as PPTX (preferred for presentations) or PDF, download
 * it to `attachDir`, and return the local file path ready to open in an editor tab.
 */
export async function exportCanvaDesignToTemp(
  params: ExportCanvaDesignParams,
): Promise<ExportCanvaDesignResult> {
  if (!params.tools.exportTool) {
    return { ok: false, error: 'Canva export tool is not available on this server.' }
  }

  let format: 'pptx' | 'pdf' = params.item.designTypes?.includes('presentation') ? 'pptx' : 'pdf'
  if (params.tools.exportFormatsTool) {
    const fmtRes = await params.callForUserPicker(
      params.serverId,
      params.tools.exportFormatsTool.name,
      {
        design_id: params.item.id,
        user_intent: 'Check supported export formats for the selected Canva design',
      },
      params.signal,
    )
    if (fmtRes.ok && !fmtRes.isError && fmtRes.output.trim()) {
      const picked = pickCanvaExportFormat(fmtRes.output)
      if (!picked) {
        return { ok: false, error: 'This Canva design cannot be exported as PPTX or PDF.' }
      }
      format = picked
    }
  }

  const expRes = await params.callForUserPicker(
    params.serverId,
    params.tools.exportTool.name,
    {
      design_id: params.item.id,
      format: { type: format },
      user_intent: `Export the selected Canva design as ${format.toUpperCase()} to open in the editor`,
    },
    params.signal,
  )
  if (!expRes.ok || expRes.isError) {
    return {
      ok: false,
      error: expRes.ok ? expRes.output || 'Canva export failed.' : expRes.error,
    }
  }

  const downloadUrl = extractCanvaExportUrl(expRes.output)
  if (!downloadUrl) {
    return { ok: false, error: 'Canva did not return a downloadable export link.' }
  }

  let bytes: Uint8Array
  try {
    bytes = await params.fetchBytes(downloadUrl, params.signal)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to download Canva export.',
    }
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CANVA_EXPORT_BYTES) {
    return { ok: false, error: 'Canva export file is empty or exceeds the size limit.' }
  }

  await mkdir(params.attachDir, { recursive: true })
  const filePath = join(
    params.attachDir,
    safeFileName(params.item.title, params.item.id, format, 0),
  )
  await atomicWriteFile(filePath, bytes)
  return { ok: true, path: filePath, format }
}
