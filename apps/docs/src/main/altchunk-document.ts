/**
 * The page a w:altChunk HTML chunk is rendered from. The chunk comes from
 * whoever made the .docx, so it renders the way Word imports it: no scripts,
 * nothing fetched from outside the page. Images that came inlined (MHT parts
 * become data: URLs) still show.
 */
export const ALT_CHUNK_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

/** Comments and a doctype that must stay ahead of any tag: a tag before the
 *  doctype would drop the page into quirks mode and change its layout. */
const PROLOGUE = /^(?:\s|<!--[\s\S]*?-->)*(?:<!doctype[^>]*>)?/i

const BOM = String.fromCharCode(0xfeff)

export function altChunkDocument(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${ALT_CHUNK_CSP}">`
  const prologue = PROLOGUE.exec(html)?.[0] ?? ''
  // the BOM outranks a stale <meta charset> left in the decoded markup
  return `${BOM}${prologue}${meta}${html.slice(prologue.length)}`
}
