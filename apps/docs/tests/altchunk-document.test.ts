import { describe, expect, it } from 'vitest'
import { ALT_CHUNK_CSP, altChunkDocument } from '../src/main/altchunk-document'

const BOM = String.fromCharCode(0xfeff)
const META = `<meta http-equiv="Content-Security-Policy" content="${ALT_CHUNK_CSP}">`

describe('altChunkDocument', () => {
  it('blocks scripts and anything fetched from outside the page', () => {
    const rules = ALT_CHUNK_CSP.split(';').map((rule) => rule.trim())
    expect(rules).toContain("default-src 'none'")
    expect(rules).toContain("script-src 'none'")
    expect(rules).toContain("object-src 'none'")
    expect(rules).toContain("frame-src 'none'")
    expect(rules).toContain("form-action 'none'")
    expect(rules).toContain("base-uri 'none'")
    expect(ALT_CHUNK_CSP).not.toMatch(/unsafe-eval|https?:|file:|\*/)
  })

  it('puts the policy ahead of every tag, behind the BOM', () => {
    const page = altChunkDocument('<html><head><script>x()</script></head><body>a</body></html>')
    expect(page.startsWith(`${BOM}${META}<html>`)).toBe(true)
  })

  it('keeps a doctype (and comments before it) first, so the layout mode stays', () => {
    const html = '<!-- saved by Word -->\n<!DOCTYPE html>\n<html><body>a</body></html>'
    const page = altChunkDocument(html)
    expect(page).toBe(
      `${BOM}<!-- saved by Word -->\n<!DOCTYPE html>${META}\n<html><body>a</body></html>`,
    )
  })

  it('cannot be closed early by the chunk itself', () => {
    const page = altChunkDocument('"><script>x()</script>')
    expect(page.indexOf(META)).toBe(1)
    expect(page.slice(1 + META.length)).toBe('"><script>x()</script>')
  })
})
