/**
 * Pure print/PDF HTML builder for whiteboard pages.
 * Always renders in light color-scheme so exports and printouts are theme-invariant.
 */
import { randomBytes } from 'node:crypto'
import type { PrintPage } from '../shared/ipc'

const PX_PER_INCH = 96

function pxToInches(px: number, fallback: number): string {
  const safe = Number.isFinite(px) && px > 0 ? px : fallback
  return `${Math.round((safe / PX_PER_INCH) * 1000) / 1000}in`
}

export function isPrintPage(value: unknown): value is PrintPage {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return (
    typeof p.svg === 'string' &&
    /^\s*<svg[\s>]/i.test(p.svg) &&
    ['width', 'height', 'pageWidth', 'pageHeight'].every(
      (k) => typeof p[k] === 'number' && Number.isFinite(p[k] as number) && (p[k] as number) > 0,
    )
  )
}

/** Strips active tags, event handlers, and external URLs from SVG before loading into a print window. */
export function inertSvg(svg: string): string {
  return svg
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      /\s(?:xlink:)?href\s*=\s*("(?:\s*(?:https?:|\/\/|javascript:)[^"]*)"|'(?:\s*(?:https?:|\/\/|javascript:)[^']*)')/gi,
      '',
    )
    .replace(/url\(\s*['"]?\s*(?:https?:|\/\/)[^)]*\)/gi, 'none')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Produces a theme-invariant multi-page HTML document (one sheet per whiteboard page,
 * sized to each page's own pixel dimensions at 96 DPI).
 */
export function buildPrintHtml(pages: readonly PrintPage[], title = ''): string {
  const rules: string[] = [
    'html, body { margin: 0; padding: 0; background: #ffffff; color-scheme: light; }',
    '.sheet { display: flex; align-items: center; justify-content: center; overflow: hidden;',
    '  box-sizing: border-box; background: #ffffff; break-after: page; }',
    '.sheet:last-child { break-after: auto; }',
    '.sheet > svg { display: block; max-width: 100%; max-height: 100%; }',
  ]
  const sheets: string[] = []
  pages.forEach((page, index) => {
    const name = `p${index + 1}`
    const pw = pxToInches(page.pageWidth, 1123)
    const ph = pxToInches(page.pageHeight, 794)
    const w = pxToInches(page.width, page.pageWidth)
    const h = pxToInches(page.height, page.pageHeight)
    rules.push(`@page ${name} { size: ${pw} ${ph}; margin: 0; }`)
    rules.push(`.${name} { page: ${name}; width: ${pw}; height: ${ph}; }`)
    rules.push(`.${name} > svg { width: ${w}; height: ${h}; }`)
    sheets.push(`<div class="sheet ${name}">${inertSvg(page.svg)}</div>`)
  })
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<title>${escapeHtml(title.slice(0, 200))}</title>`,
    `<style>\n${rules.join('\n')}\n</style>`,
    '</head><body>',
    sheets.join('\n'),
    '</body></html>',
  ].join('\n')
}

export function isPrintCancel(failureReason: unknown): boolean {
  return typeof failureReason === 'string' && /cancel/i.test(failureReason)
}

const documents = new Map<string, string>()

export function holdPrintDocument(html: string): string {
  const token = randomBytes(16).toString('hex')
  documents.set(token, html)
  return token
}

export function takePrintDocument(token: string): string | null {
  const html = documents.get(token) ?? null
  documents.delete(token)
  return html
}

export function dropPrintDocument(token: string): void {
  documents.delete(token)
}
