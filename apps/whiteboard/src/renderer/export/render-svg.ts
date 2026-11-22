/**
 * Theme-invariant SVG serializer and PNG rasterizer for whiteboard pages.
 * Used identically for PNG/SVG/PDF exports, printing, `--headless-export`,
 * `.whiteboard` thumbnails, and AI vision PNG page snapshots.
 *
 * Never reads CSS theme variables — document paper and objects always render in
 * their own warm paper-craft document colors, and UI chrome (selection handles,
 * AI highlights) is never included.
 */
import {
  computePageBounds,
  computeStrokeOutline,
  type BoardDocument,
  type ConnectorProps,
  type ImageProps,
  type LinkProps,
  type RichText,
  type ShapeProps,
  type StickerProps,
  type StickyProps,
  type StrokeProps,
  type TableProps,
  type TextAlign,
  type TextProps,
} from '@genoffice/whiteboard-engine'
import { computeConnectorGeometry, PAPER_COLORS, resolveConnectorEnd } from '../canvas/paper-style'
import { shapePath, shapeTextBox } from '../canvas/shape-paths'
import { stickerInnerSvg } from '../canvas/stickers'

export interface RenderedPageSvg {
  svg: string
  width: number
  height: number
  viewBoxX: number
  viewBoxY: number
}

const FONT_STACK = "'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, -apple-system, sans-serif"

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function richTextPlain(rt: RichText | undefined): string {
  if (!rt || !Array.isArray(rt.paragraphs)) return ''
  return rt.paragraphs
    .map((p) => (Array.isArray(p.runs) ? p.runs.map((r) => r.text ?? '').join('') : ''))
    .join('\n')
}

function renderRichTextSvg(
  rt: RichText | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  fontSize: number,
  defaultColor: string,
  defaultAlign: TextAlign = 'left',
  verticalAlign: 'top' | 'center' = 'top',
): string {
  if (!rt || !Array.isArray(rt.paragraphs) || rt.paragraphs.length === 0) return ''
  const plain = richTextPlain(rt)
  if (!plain) return ''

  const lineH = fontSize * 1.38
  const totalH = rt.paragraphs.length * lineH
  const startY =
    verticalAlign === 'center'
      ? y + Math.max(fontSize * 0.9, (h - totalH) / 2 + fontSize * 0.85)
      : y + fontSize * 0.95

  const out: string[] = []
  rt.paragraphs.forEach((p, idx) => {
    const align = p.align ?? defaultAlign
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'
    const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x
    const ty = startY + idx * lineH
    const runs = (p.runs ?? []).map((r) => {
      const attrs: string[] = []
      if (r.bold) attrs.push('font-weight="700"')
      if (r.italic) attrs.push('font-style="italic"')
      const decos = [r.underline ? 'underline' : '', r.strike ? 'line-through' : '']
        .filter(Boolean)
        .join(' ')
      if (decos) attrs.push(`text-decoration="${decos}"`)
      attrs.push(`fill="${escXml(r.color || defaultColor)}"`)
      return `<tspan ${attrs.join(' ')}>${escXml(r.text || ' ')}</tspan>`
    })
    out.push(
      `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-family="${FONT_STACK}" font-size="${fontSize}" text-anchor="${anchor}">${runs.join('')}</text>`,
    )
  })
  return out.join('')
}

function dashAttr(style?: string, strokeWidth = 2): string {
  if (style === 'dashed') return ` stroke-dasharray="${strokeWidth * 3} ${strokeWidth * 2.4}"`
  if (style === 'dotted') return ` stroke-dasharray="${strokeWidth} ${strokeWidth * 2.2}"`
  return ''
}

export function renderPageToSvg(
  doc: BoardDocument,
  pageId: string,
  resourceDataUrls: ReadonlyMap<string, string>,
  freeformMargin = 48,
): RenderedPageSvg | null {
  const page = doc.pages.find((p) => p.id === pageId)
  if (!page) return null

  const bounds = computePageBounds(doc, pageId, freeformMargin) ?? {
    x: 0,
    y: 0,
    width: page.width || 1920,
    height: page.height || 1080,
  }
  const w = Math.max(1, Math.round(bounds.width))
  const h = Math.max(1, Math.round(bounds.height))

  const pageObjs = doc.objects
    .filter((o) => o.pageId === pageId)
    .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0))
  const byId = new Map(pageObjs.map((o) => [o.id, o]))

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}">`,
  )
  parts.push(
    `<defs><filter id="wb-card-shadow" x="-12%" y="-10%" width="124%" height="128%"><feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="#221D17" flood-opacity="0.12"/><feDropShadow dx="0" dy="3.5" stdDeviation="4" flood-color="#221D17" flood-opacity="0.08"/></filter></defs>`,
  )

  // Background layer (document paper colors, never inverted by dark UI theme).
  const bg = page.background
  if (bg.kind === 'solid') {
    parts.push(
      `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${escXml(bg.color)}"/>`,
    )
  } else if (bg.kind === 'grid') {
    parts.push(
      `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${escXml(bg.color)}"/>`,
    )
    const step = 32
    const patId = `wb-grid-${bg.pattern}`
    if (bg.pattern === 'dot') {
      parts.push(
        `<defs><pattern id="${patId}" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><circle cx="16" cy="16" r="1.4" fill="#221D17" fill-opacity="0.15"/></pattern></defs>`,
      )
    } else {
      parts.push(
        `<defs><pattern id="${patId}" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><path d="M ${step} 0 L 0 0 0 ${step}" fill="none" stroke="#DDD3C2" stroke-width="1"/></pattern></defs>`,
      )
    }
    parts.push(
      `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="url(#${patId})"/>`,
    )
  } else if (bg.kind === 'image') {
    parts.push(
      `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${PAPER_COLORS.paper}"/>`,
    )
    const dataUrl = resourceDataUrls.get(bg.resourceId)
    if (dataUrl) {
      parts.push(
        `<image href="${escXml(dataUrl)}" x="0" y="0" width="${bg.width}" height="${bg.height}" preserveAspectRatio="xMidYMid meet"/>`,
      )
    }
  }

  for (const obj of pageObjs) {
    const cx = obj.x + obj.width / 2
    const cy = obj.y + obj.height / 2
    const rotAttr =
      Math.abs(obj.rotation) > 1e-4 ? ` transform="rotate(${obj.rotation} ${cx} ${cy})"` : ''

    switch (obj.kind) {
      case 'sticky': {
        const p = obj.props as unknown as StickyProps
        parts.push(`<g${rotAttr} filter="url(#wb-card-shadow)">`)
        parts.push(
          `<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" rx="3" fill="${escXml(p.color || '#FBE7A1')}"/>`,
        )
        parts.push(
          renderRichTextSvg(
            p.text,
            obj.x + 16,
            obj.y + 16,
            Math.max(10, obj.width - 32),
            Math.max(10, obj.height - 32),
            p.fontSize ?? 18,
            PAPER_COLORS.ink,
            p.align ?? 'left',
            'top',
          ),
        )
        parts.push('</g>')
        break
      }
      case 'text': {
        const p = obj.props as unknown as TextProps
        parts.push(`<g${rotAttr}>`)
        if (p.background || p.borderColor) {
          parts.push(
            `<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" rx="6" fill="${escXml(p.background || 'none')}" stroke="${escXml(p.borderColor || 'none')}" stroke-width="1"/>`,
          )
        }
        parts.push(
          renderRichTextSvg(
            p.text,
            obj.x + 6,
            obj.y + 4,
            Math.max(10, obj.width - 12),
            Math.max(10, obj.height - 8),
            p.fontSize ?? 24,
            p.color || PAPER_COLORS.ink,
            p.align ?? 'left',
            'top',
          ),
        )
        parts.push('</g>')
        break
      }
      case 'shape': {
        const p = obj.props as unknown as ShapeProps
        const sw = p.strokeWidth ?? 2.5
        const kind = p.shape || 'rounded_rectangle'
        const d = shapePath(kind, obj.width, obj.height, sw / 2)
        const box = shapeTextBox(kind, obj.width, obj.height)
        parts.push(`<g${rotAttr}>`)
        parts.push(
          `<g transform="translate(${obj.x} ${obj.y})"><path d="${d}" fill="${escXml(p.fill || PAPER_COLORS.zoneFill)}" stroke="${escXml(p.stroke || PAPER_COLORS.ink)}" stroke-width="${sw}" stroke-linejoin="round"${dashAttr(p.lineStyle, sw)}/></g>`,
        )
        parts.push(
          renderRichTextSvg(
            p.text,
            obj.x + box.left,
            obj.y + box.top,
            Math.max(10, box.width),
            Math.max(10, box.height),
            p.fontSize ?? 18,
            PAPER_COLORS.ink,
            p.align ?? 'center',
            'center',
          ),
        )
        parts.push('</g>')
        break
      }
      case 'connector': {
        const p = obj.props as unknown as ConnectorProps
        const a = resolveConnectorEnd(p.start, byId)
        const b = resolveConnectorEnd(p.end, byId)
        const sw = p.strokeWidth ?? 3
        const ink = p.color || PAPER_COLORS.ink
        const geom = computeConnectorGeometry(a, b, p.waypoints, sw, p.startHead, p.endHead)
        const lineCap = p.lineStyle === 'dashed' || p.lineStyle === 'dotted' ? 'butt' : 'round'
        parts.push('<g>')
        parts.push(
          `<path d="${geom.shaftPath}" fill="none" stroke="${escXml(ink)}" stroke-width="${sw}" stroke-linecap="${lineCap}" stroke-linejoin="round"${dashAttr(p.lineStyle, sw)}/>`,
        )
        if (geom.startArrowPath) {
          parts.push(`<path d="${geom.startArrowPath}" fill="${escXml(ink)}"/>`)
        }
        if (geom.endArrowPath) {
          parts.push(`<path d="${geom.endArrowPath}" fill="${escXml(ink)}"/>`)
        }
        if (geom.startCircle) {
          parts.push(
            `<circle cx="${geom.startCircle.x}" cy="${geom.startCircle.y}" r="${Math.max(4, sw * 1.5)}" fill="${escXml(ink)}"/>`,
          )
        }
        if (geom.endCircle) {
          parts.push(
            `<circle cx="${geom.endCircle.x}" cy="${geom.endCircle.y}" r="${Math.max(4, sw * 1.5)}" fill="${escXml(ink)}"/>`,
          )
        }
        const lbl = richTextPlain(p.label)
        if (lbl) {
          const pillW = Math.max(48, lbl.length * 10 + 18)
          parts.push(
            `<rect x="${(geom.midpoint.x - pillW / 2).toFixed(1)}" y="${(geom.midpoint.y - 22).toFixed(1)}" width="${pillW}" height="24" rx="6" fill="${PAPER_COLORS.paper}" stroke="${PAPER_COLORS.line}" stroke-width="1"/>`,
          )
          parts.push(
            `<text x="${geom.midpoint.x.toFixed(1)}" y="${(geom.midpoint.y - 6).toFixed(1)}" text-anchor="middle" font-family="${FONT_STACK}" font-size="13" font-weight="500" fill="${PAPER_COLORS.ink}">${escXml(lbl)}</text>`,
          )
        }
        parts.push('</g>')
        break
      }
      case 'stroke': {
        const p = obj.props as unknown as StrokeProps
        const d = computeStrokeOutline(p.points ?? [], p.width ?? 4, p.tool ?? 'pen')
        if (d) {
          const isHi = p.tool === 'highlighter'
          parts.push(
            `<g transform="translate(${obj.x} ${obj.y})" opacity="${p.opacity ?? (isHi ? 0.35 : 1)}"${isHi ? ' style="mix-blend-mode:multiply"' : ''}><path d="${d}" fill="${escXml(p.color || PAPER_COLORS.ink)}"/></g>`,
          )
        }
        break
      }
      case 'image': {
        const p = obj.props as unknown as ImageProps
        const dataUrl = resourceDataUrls.get(p.resourceId)
        if (dataUrl) {
          parts.push(
            `<g${rotAttr}><image href="${escXml(dataUrl)}" x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" preserveAspectRatio="xMidYMid meet"/></g>`,
          )
        }
        break
      }
      case 'table': {
        const p = obj.props as unknown as TableProps
        const rows = p.rowIds?.length || 1
        const cols = p.colIds?.length || 1
        const cellW = obj.width / cols
        const cellH = obj.height / rows
        parts.push(`<g${rotAttr} filter="url(#wb-card-shadow)">`)
        parts.push(
          `<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" rx="4" fill="${PAPER_COLORS.paper}" stroke="${PAPER_COLORS.lineDashed}" stroke-width="1.5"/>`,
        )
        p.rowIds?.forEach((rid, ri) => {
          p.colIds?.forEach((cid, ci) => {
            const cx0 = obj.x + ci * cellW
            const cy0 = obj.y + ri * cellH
            if (ri === 0 && p.headerRow) {
              parts.push(
                `<rect x="${cx0}" y="${cy0}" width="${cellW}" height="${cellH}" fill="${PAPER_COLORS.zoneFill}" stroke="${PAPER_COLORS.lineStrong}" stroke-width="1"/>`,
              )
            } else {
              parts.push(
                `<rect x="${cx0}" y="${cy0}" width="${cellW}" height="${cellH}" fill="none" stroke="${PAPER_COLORS.lineStrong}" stroke-width="1"/>`,
              )
            }
            const cellRt = p.cells?.[`${rid}:${cid}`]
            if (cellRt && richTextPlain(cellRt)) {
              parts.push(
                renderRichTextSvg(
                  cellRt,
                  cx0 + 10,
                  cy0 + 4,
                  Math.max(10, cellW - 20),
                  Math.max(10, cellH - 8),
                  p.fontSize ?? 14,
                  PAPER_COLORS.ink,
                  'left',
                  'center',
                ),
              )
            }
          })
        })
        parts.push('</g>')
        break
      }
      case 'sticker': {
        const p = obj.props as unknown as StickerProps
        parts.push(
          `<g${rotAttr}><svg x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" viewBox="0 0 100 100" overflow="visible">${stickerInnerSvg(p.stickerId, p.tint)}</svg></g>`,
        )
        break
      }
      case 'link': {
        const p = obj.props as unknown as LinkProps
        parts.push(`<g${rotAttr} filter="url(#wb-card-shadow)">`)
        parts.push(
          `<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" rx="10" fill="${PAPER_COLORS.paper}" stroke="${PAPER_COLORS.line}" stroke-width="1.5"/>`,
        )
        const hasPreview = p.previewResourceId && resourceDataUrls.has(p.previewResourceId)
        const textX = hasPreview ? obj.x + 112 : obj.x + 16
        const textW = hasPreview ? obj.width - 124 : obj.width - 32
        if (hasPreview) {
          const url = resourceDataUrls.get(p.previewResourceId!)!
          parts.push(
            `<image href="${escXml(url)}" x="${obj.x + 10}" y="${obj.y + 10}" width="92" height="${Math.max(40, obj.height - 20)}" preserveAspectRatio="xMidYMid slice"/>`,
          )
        }
        parts.push(
          `<text x="${textX}" y="${obj.y + 34}" font-family="${FONT_STACK}" font-size="15" font-weight="600" fill="${PAPER_COLORS.accent}">${escXml((p.title || p.url).slice(0, 60))} ↗</text>`,
        )
        if (p.description) {
          parts.push(
            `<text x="${textX}" y="${obj.y + 56}" font-family="${FONT_STACK}" font-size="12" fill="${PAPER_COLORS.inkMuted}">${escXml(p.description.slice(0, 80))}</text>`,
          )
        }
        parts.push(
          `<text x="${textX}" y="${obj.y + obj.height - 16}" font-family="${FONT_STACK}" font-size="11" fill="${PAPER_COLORS.inkMuted}">${escXml(p.url.slice(0, Math.max(20, Math.floor(textW / 6.5))))}</text>`,
        )
        parts.push('</g>')
        break
      }
    }
  }

  parts.push('</svg>')
  return {
    svg: parts.join('\n'),
    width: w,
    height: h,
    viewBoxX: bounds.x,
    viewBoxY: bounds.y,
  }
}

/** Rasterizes a theme-invariant page SVG into PNG bytes via an offscreen HTMLCanvasElement. */
export async function renderSvgToPngBytes(
  svg: string,
  width: number,
  height: number,
  maxEdge = 2400,
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1))
  const outW = Math.max(1, Math.round(width * scale))
  const outH = Math.max(1, Math.round(height * scale))
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('failed to load SVG into image'))
      el.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = PAPER_COLORS.paper
    ctx.fillRect(0, 0, outW, outH)
    ctx.drawImage(img, 0, 0, outW, outH)
    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    )
    if (!pngBlob) return null
    const buf = await pngBlob.arrayBuffer()
    return { bytes: new Uint8Array(buf), width: outW, height: outH }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function uint8ToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
