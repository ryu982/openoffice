/**
 * The six whiteboard AI tools:
 * - read_board
 * - edit_board
 * - apply_template
 * - search_images
 * - insert_image
 * - generate_image
 */
import type { AgentToolDef } from '@genoffice/agent-core'
import type { WhiteboardAiHost } from '../../shared/ai-host'

export const WHITEBOARD_TOOL_NAMES = {
  read: 'read_board',
  edit: 'edit_board',
  applyTemplate: 'apply_template',
  searchImages: 'search_images',
  insertImage: 'insert_image',
  generateImage: 'generate_image',
} as const

export interface WhiteboardImageBackend {
  imageSearch(query: string): Promise<unknown>
  fetchImage(url: string): Promise<{ base64: string; mime: string } | null>
  generateImage(op: { prompt: string; aspectRatio?: string; model?: string }): Promise<unknown>
}

export interface WhiteboardToolResult {
  output: string
  isError?: boolean
  mutated?: boolean
  changedIds?: string[]
  detail?: { count?: number; query?: string }
}

export const WHITEBOARD_TOOLS: readonly AgentToolDef[] = [
  {
    name: WHITEBOARD_TOOL_NAMES.read,
    description:
      'Read the whiteboard structure as a text table. Omit page to read all pages, or pass a page id, title, or 1-based index.',
    inputSchema: {
      type: 'object',
      properties: {
        page: {
          type: 'string',
          description: 'Optional page id, title, or 1-based index. Omit to read all pages.',
        },
      },
    },
  },
  {
    name: WHITEBOARD_TOOL_NAMES.edit,
    description:
      'Apply an atomic list of edit operations to the whiteboard (all-or-nothing, 1 undo step). Supported ops: add, update (including tablePatch), move (x/y and z-order toFront/toBack), delete, add_page, rename_page, delete_page, set_page_format.',
    inputSchema: {
      type: 'object',
      properties: {
        ops: {
          type: 'array',
          description: 'Ordered list of whiteboard edit operations.',
          items: { type: 'object' },
        },
        defaultPageId: {
          type: 'string',
          description: 'Optional target page id for add ops without an explicit pageId.',
        },
      },
      required: ['ops'],
    },
  },
  {
    name: WHITEBOARD_TOOL_NAMES.applyTemplate,
    description:
      'Apply a declarative JSON layout template ({ schemaVersion: 1, target?: "new_pages"|"current_page", pages: [{ key, title?, blocks: [{ type, key, ... }] }] }) with stack/grid containers and leaf blocks as one undo step.',
    inputSchema: {
      type: 'object',
      properties: {
        template: {
          type: 'object',
          description:
            'Declarative template JSON document with schemaVersion: 1 and pages[].blocks[].',
        },
      },
      required: ['template'],
    },
  },
  {
    name: WHITEBOARD_TOOL_NAMES.searchImages,
    description: 'Search the web for reference images and return candidate URLs and titles.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Image search keywords' },
      },
      required: ['query'],
    },
  },
  {
    name: WHITEBOARD_TOOL_NAMES.insertImage,
    description:
      'Embed a raster image (PNG/JPEG/WebP/GIF) from a URL or base64 payload directly into the .whiteboard archive and place it on the current page.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTP/HTTPS image URL to download and embed' },
        base64: {
          type: 'string',
          description: 'Raw base64 raster image bytes (alternative to url)',
        },
        alt: { type: 'string', description: 'Short image description' },
        x: { type: 'number', description: 'Optional canvas X coordinate' },
        y: { type: 'number', description: 'Optional canvas Y coordinate' },
        width: { type: 'number', description: 'Optional width in canvas pixels' },
        height: { type: 'number', description: 'Optional height in canvas pixels' },
      },
    },
  },
  {
    name: WHITEBOARD_TOOL_NAMES.generateImage,
    description:
      'Generate a raster image from a text prompt using the configured image provider and embed it directly on the current whiteboard page.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed visual prompt for image generation' },
        aspectRatio: { type: 'string', description: 'Optional aspect ratio (e.g. 1:1, 16:9, 4:3)' },
        alt: { type: 'string', description: 'Short image description' },
        x: { type: 'number', description: 'Optional canvas X coordinate' },
        y: { type: 'number', description: 'Optional canvas Y coordinate' },
      },
      required: ['prompt'],
    },
  },
]

function base64ToUint8(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, '').trim()
  const bin = atob(clean)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function defaultImageBackend(): WhiteboardImageBackend {
  return {
    imageSearch: (query) => window.whiteboardApi.ai.imageSearch(query),
    fetchImage: (url) => window.whiteboardApi.ai.fetchImage(url),
    generateImage: (op) => window.whiteboardApi.ai.generateImage(op),
  }
}

export async function runWhiteboardTool(
  host: WhiteboardAiHost,
  name: string,
  input: Record<string, unknown>,
  backend: WhiteboardImageBackend = defaultImageBackend(),
): Promise<WhiteboardToolResult> {
  if (name === WHITEBOARD_TOOL_NAMES.read) {
    const pageRef =
      typeof input.page === 'string' && input.page.trim() ? input.page.trim() : undefined
    const view = pageRef ? await host.readPage(pageRef) : await host.readBoard()
    if (!view) {
      return { output: `page not found: ${pageRef ?? ''}`, isError: true }
    }
    return { output: view.text || '(empty whiteboard)', mutated: false }
  }

  if (name === WHITEBOARD_TOOL_NAMES.edit) {
    const ops = Array.isArray(input.ops)
      ? input.ops.filter((v): v is Record<string, unknown> => Boolean(v && typeof v === 'object'))
      : []
    if (ops.length === 0) {
      return { output: 'ops must be a non-empty array of objects', isError: true }
    }
    const defaultPageId =
      typeof input.defaultPageId === 'string' && input.defaultPageId.trim()
        ? input.defaultPageId.trim()
        : undefined
    const res = await host.applyOps(ops, { defaultPageId })
    if (!res.ok) {
      const reasons = (res.failures ?? [])
        .map(
          (f) =>
            `op[${f.index}]: ${f.error?.code ?? 'error'} — ${f.error?.message ?? 'invalid operation'}`,
        )
        .join('\n')
      return {
        output: `Edit refused (nothing changed):\n${reasons || 'invalid operations'}`,
        isError: true,
        mutated: false,
      }
    }
    const changedIds = [...res.created, ...res.updated]
    return {
      output: JSON.stringify({
        changed: res.changed,
        created: res.created,
        updated: res.updated,
        deleted: res.deleted,
      }),
      mutated: res.changed,
      changedIds,
      detail: { count: ops.length },
    }
  }

  if (name === WHITEBOARD_TOOL_NAMES.applyTemplate) {
    const template =
      input.template && typeof input.template === 'object'
        ? (input.template as Record<string, unknown>)
        : null
    if (!template) {
      return { output: 'template object is required', isError: true }
    }
    const res = await host.applyTemplate(template)
    if (!res.ok) {
      return {
        output: `Template refused: ${res.error.code} — ${res.error.message}`,
        isError: true,
        mutated: false,
      }
    }
    return {
      output: JSON.stringify({
        createdPageIds: res.result.createdPageIds,
        createdObjectIds: res.result.createdObjectIds,
      }),
      mutated: true,
      changedIds: res.result.createdObjectIds,
      detail: { count: res.result.createdObjectIds.length },
    }
  }

  if (name === WHITEBOARD_TOOL_NAMES.searchImages) {
    const query = String(input.query ?? '').trim()
    if (!query) return { output: 'query must not be empty', isError: true }
    const raw = (await backend.imageSearch(query)) as {
      error?: string
      images?: Array<{ title?: string; url?: string; imageUrl?: string; thumbnailUrl?: string }>
      results?: Array<{ title?: string; url?: string; imageUrl?: string }>
    }
    if (raw?.error) {
      return { output: `image search failed: ${raw.error}`, isError: true, detail: { query } }
    }
    const items = raw?.images ?? raw?.results ?? []
    const lines = items.slice(0, 8).map((it, i) => {
      const url = it.imageUrl || it.url || ''
      return `${i + 1}. ${it.title || 'Image'}\n   ${url}`
    })
    return {
      output: lines.join('\n') || '(no image results)',
      mutated: false,
      detail: { query, count: items.length },
    }
  }

  if (name === WHITEBOARD_TOOL_NAMES.insertImage) {
    let bytes: Uint8Array
    if (typeof input.base64 === 'string' && input.base64.trim()) {
      try {
        bytes = base64ToUint8(input.base64)
      } catch {
        return { output: 'invalid base64 image payload', isError: true }
      }
    } else if (typeof input.url === 'string' && input.url.trim()) {
      const fetched = await backend.fetchImage(input.url.trim())
      if (!fetched?.base64) {
        return { output: 'could not fetch image from url', isError: true }
      }
      bytes = base64ToUint8(fetched.base64)
    } else {
      return { output: 'provide either url or base64', isError: true }
    }

    const inserted = await host.insertImage({
      bytes,
      alt: typeof input.alt === 'string' ? input.alt : undefined,
      x: typeof input.x === 'number' ? input.x : undefined,
      y: typeof input.y === 'number' ? input.y : undefined,
      width: typeof input.width === 'number' ? input.width : undefined,
      height: typeof input.height === 'number' ? input.height : undefined,
    })
    if (!inserted.ok) {
      return { output: `insert_image failed: ${inserted.error}`, isError: true }
    }
    return {
      output: JSON.stringify({ objectId: inserted.objectId, resourceId: inserted.resourceId }),
      mutated: true,
      changedIds: [inserted.objectId],
      detail: { count: 1 },
    }
  }

  if (name === WHITEBOARD_TOOL_NAMES.generateImage) {
    const prompt = String(input.prompt ?? '').trim()
    if (!prompt) return { output: 'prompt must not be empty', isError: true }
    const res = (await backend.generateImage({
      prompt,
      aspectRatio: typeof input.aspectRatio === 'string' ? input.aspectRatio : undefined,
    })) as {
      ok?: boolean
      error?: string
      base64?: string
      imageBase64?: string
      data?: string
    }
    const b64 = res?.base64 || res?.imageBase64 || res?.data
    if (!b64) {
      return {
        output: `generate_image failed: ${res?.error ?? 'no image returned'}`,
        isError: true,
      }
    }
    const inserted = await host.insertImage({
      bytes: base64ToUint8(b64),
      alt: typeof input.alt === 'string' ? input.alt : prompt.slice(0, 80),
      x: typeof input.x === 'number' ? input.x : undefined,
      y: typeof input.y === 'number' ? input.y : undefined,
    })
    if (!inserted.ok) {
      return { output: `insert generated image failed: ${inserted.error}`, isError: true }
    }
    return {
      output: JSON.stringify({ objectId: inserted.objectId, resourceId: inserted.resourceId }),
      mutated: true,
      changedIds: [inserted.objectId],
      detail: { count: 1 },
    }
  }

  return { output: `unknown tool: ${name}`, isError: true }
}
