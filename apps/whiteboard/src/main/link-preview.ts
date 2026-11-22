/**
 * Opt-in link preview fetcher for whiteboard link cards (matches Mindmap decision 0099).
 *
 * NEVER invoked automatically on open, render, export, or print. Only runs once when
 * the user explicitly ticks "Fetch title and preview image" and confirms the link dialog.
 * Uses `fetchWithSsrfGuard` (no cookies, <= 512KB head) and `fetchImageBytes` (raster only).
 */
import { ipcMain } from 'electron'
import { fetchImageBytes } from '@genoffice/electron-utils/fetch-image-bytes'
import { fetchWithSsrfGuard } from '@genoffice/electron-utils/safe-remote-url'
import { sniffImage } from '@genoffice/whiteboard-engine/node'
import { WHITEBOARD_CHANNELS, type LinkPreviewResult } from '../shared/ipc'

export const PAGE_READ_LIMIT = 512 * 1024
const PAGE_TIMEOUT_MS = 15_000
const TITLE_MAX = 200
const DESC_MAX = 400

const PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
}

const PICTURE_KEYS = [
  'og:image:secure_url',
  'og:image',
  'og:image:url',
  'twitter:image',
  'twitter:image:src',
]
const TITLE_KEYS = ['og:title', 'twitter:title']
const DESC_KEYS = ['og:description', 'twitter:description', 'description']

export interface ParsedPagePreview {
  title: string | null
  description: string | null
  pictureUrl: string | null
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code =
        ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1))
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole
  })
}

function attributesOf(tag: string): Map<string, string> {
  const found = new Map<string, string>()
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  for (const match of tag.matchAll(pattern)) {
    const name = match[1]!.toLowerCase()
    if (!found.has(name))
      found.set(name, decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? ''))
  }
  return found
}

function clampLine(text: string, max: number): string | null {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function resolveHttpUrl(value: string, base: string): string | null {
  try {
    const url = new URL(value.trim(), base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function parseLinkPreviewHtml(html: string, pageUrl: string): ParsedPagePreview {
  const meta = new Map<string, string>()
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributesOf(match[0])
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').trim().toLowerCase()
    const content = attrs.get('content')
    if (key && content && content.trim() && !meta.has(key)) {
      meta.set(key, content)
    }
  }

  let pictureUrl: string | null = null
  for (const key of PICTURE_KEYS) {
    const val = meta.get(key)
    pictureUrl = val ? resolveHttpUrl(val, pageUrl) : null
    if (pictureUrl) break
  }

  let title: string | null = null
  for (const key of TITLE_KEYS) {
    const val = meta.get(key)
    title = val ? clampLine(val, TITLE_MAX) : null
    if (title) break
  }
  if (!title) {
    const tag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)
    if (tag) title = clampLine(decodeHtmlEntities(tag[1]!), TITLE_MAX)
  }

  let description: string | null = null
  for (const key of DESC_KEYS) {
    const val = meta.get(key)
    description = val ? clampLine(val, DESC_MAX) : null
    if (description) break
  }

  return { title, description, pictureUrl }
}

async function readHeadBytes(response: Response, limit = PAGE_READ_LIMIT): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < limit) {
      const { done, value } = await reader.read()
      if (done || !value) break
      const keep = total + value.byteLength > limit ? value.subarray(0, limit - total) : value
      chunks.push(keep)
      total += keep.byteLength
      // Stop early once `</head>` appears.
      const tail = new TextDecoder('latin1').decode(keep)
      if (/<\/head\s*>/i.test(tail)) break
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  return merged
}

export async function readWhiteboardLinkPreview(rawUrl: unknown): Promise<LinkPreviewResult> {
  if (typeof rawUrl !== 'string') return { ok: false, error: 'invalid url' }
  const trimmed = rawUrl.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, error: 'invalid url' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'only http and https links support previews' }
  }

  try {
    const response = await fetchWithSsrfGuard(parsed.toString(), {
      headers: PAGE_HEADERS,
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    })
    if (!response || !response.ok) {
      return {
        ok: false,
        error: response ? `HTTP ${response.status}` : 'blocked or unreachable URL',
      }
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      return { ok: true, title: null, description: null, imageBytes: null, imageMime: null }
    }
    const headBytes = await readHeadBytes(response, PAGE_READ_LIMIT)
    const charsetMatch = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)
    let html: string
    try {
      html = new TextDecoder(charsetMatch?.[1] ?? 'utf-8').decode(headBytes)
    } catch {
      html = new TextDecoder('utf-8').decode(headBytes)
    }

    const preview = parseLinkPreviewHtml(html, response.url || parsed.toString())
    let imageBytes: Uint8Array | null = null
    let imageMime: string | null = null
    if (preview.pictureUrl) {
      const img = await fetchImageBytes(preview.pictureUrl)
      if (img?.base64) {
        const buf = Buffer.from(img.base64, 'base64')
        const raw = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
        // Verify raster magic bytes through the Rust engine (rejects SVG / non-raster).
        const header = sniffImage(raw)
        if (header) {
          imageBytes = raw
          imageMime = header.mime
        }
      }
    }

    return {
      ok: true,
      title: preview.title,
      description: preview.description,
      imageBytes,
      imageMime,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function registerWhiteboardLinkPreviewIpc(): void {
  ipcMain.handle(WHITEBOARD_CHANNELS.readLinkPreview, (_e, url: unknown) =>
    readWhiteboardLinkPreview(url),
  )
}
