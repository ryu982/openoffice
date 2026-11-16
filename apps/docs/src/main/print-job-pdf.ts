/**
 * The word editor's print job PDF for the advanced print route (decision
 * 0141). The renderer prints the chosen preview pages to PDF fragments (the
 * PDF export's own per paper size printToPDF) and hands them over; this module
 * checks and merges them. A printed selection arrives as its own .docx, made
 * by the editor's save path from the selected content only, and is prepared
 * here so it opens as one section (the one the selection starts in) numbered
 * from page 1. Electron-free so unit tests import it directly.
 */
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'
import { bufferSource, readZipEntries, writeZip } from '@genoffice/docx-engine/zip-splice'

/** What the renderer sends with a print, preview or save of the new route. */
export interface DocsPrintJob {
  /** base64 PDF fragments, in page order */
  parts: string[]
  /** the document's file name, for the save dialog */
  name?: string
}

/** More fragments than this is not a job the renderer makes (ten pages each). */
const MAX_JOB_PARTS = 10_000

/** Checks the renderer's job request; throws on anything else. */
export function readDocsPrintJob(raw: unknown): DocsPrintJob {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null
  const parts = r?.parts
  if (
    !Array.isArray(parts) ||
    parts.length === 0 ||
    parts.length > MAX_JOB_PARTS ||
    !parts.every((p) => typeof p === 'string' && p.length > 0)
  ) {
    throw new Error('the print job has no pages')
  }
  return {
    parts: parts as string[],
    ...(typeof r?.name === 'string' ? { name: r.name } : {}),
  }
}

/** One PDF of the fragments in order; a single fragment is passed through. */
export async function mergePrintJobParts(parts: readonly string[]): Promise<Uint8Array> {
  if (parts.length === 1) return new Uint8Array(Buffer.from(parts[0]!, 'base64'))
  const { PDFDocument } = await import('pdf-lib')
  const merged = await PDFDocument.create()
  for (const b64 of parts) {
    const part = await PDFDocument.load(new Uint8Array(Buffer.from(b64, 'base64')))
    const pages = await merged.copyPages(part, part.getPageIndices())
    for (const page of pages) merged.addPage(page)
  }
  return merged.save()
}

/** The save dialog's suggestion: the document's name as a .pdf. */
export function printPdfDefaultName(name: unknown): string {
  const base =
    typeof name === 'string'
      ? (name.split(/[\\/]/).pop() ?? '').replace(/\.(?:docx|odt)$/i, '').trim()
      : ''
  return `${base || 'document'}.pdf`
}

/** A section's properties as the renderer sends them for a printed selection. */
export function validSectPrXml(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length < 1_000_000 &&
    /^<w:sectPr(?:\s[^>]*)?(?:\/>|>[\s\S]*<\/w:sectPr>)$/.test(v.trim())
  )
}

const SECT_PR_TAG = /<w:sectPr(?=[\s>/])[^>]*?(\/?)>|<\/w:sectPr>/g

/** Outermost w:sectPr elements (a w:sectPrChange nests one inside another). */
function outerSectPrs(xml: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  let depth = 0
  let start = -1
  SECT_PR_TAG.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SECT_PR_TAG.exec(xml)) !== null) {
    const closing = m[0].startsWith('</')
    const selfClosing = !closing && m[1] === '/'
    if (closing) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        out.push({ start, end: m.index + m[0].length })
        start = -1
      }
      if (depth < 0) depth = 0
    } else if (selfClosing) {
      if (depth === 0) out.push({ start: m.index, end: m.index + m[0].length })
    } else {
      if (depth === 0) start = m.index
      depth += 1
    }
  }
  return out
}

/** Page numbers of the section count from 1 (w:pgNumType w:start). */
function numberFromOne(sectPr: string): string {
  return sectPr.replace(/<w:pgNumType\b[^>]*?\/?>/, (tag) =>
    / w:start="[^"]*"/.test(tag) ? tag.replace(/ w:start="[^"]*"/, ' w:start="1"') : tag,
  )
}

/**
 * The selection's document part made one section: every paragraph-level
 * section break goes, and the body's own section properties become `sectPr`
 * (the section the selection starts in; null keeps the body's own, which is
 * already that section). Page numbers start at 1.
 */
export function selectionDocumentXml(xml: string, sectPr: string | null): string {
  const bodyClose = xml.lastIndexOf('</w:body>')
  if (bodyClose < 0) throw new Error('the selection has no document body')
  const ranges = outerSectPrs(xml).filter((r) => r.end <= bodyClose)
  const last = ranges[ranges.length - 1]
  const bodyRange = last && xml.slice(last.end, bodyClose).trim() === '' ? last : undefined
  let body = bodyRange ? xml.slice(bodyRange.start, bodyRange.end) : null
  if (sectPr !== null) body = sectPr.trim()
  let out = ''
  let at = 0
  for (const r of ranges) {
    if (r === bodyRange) continue
    out += xml.slice(at, r.start)
    at = r.end
  }
  const tailStart = bodyRange ? bodyRange.start : bodyClose
  out += xml.slice(at, tailStart)
  if (body !== null) out += numberFromOne(body)
  out += xml.slice(bodyRange ? bodyRange.end : bodyClose)
  return out
}

const OFFICE_DOCUMENT_REL =
  /<Relationship\b(?=[^>]*\bType="[^"]*\/officeDocument")[^>]*\bTarget="([^"]+)"[^>]*\/?>/

const METHOD_DEFLATE = 8

/** The main document part's path inside the package (usually word/document.xml). */
function mainPartPath(rootRels: string | null): string {
  const target = rootRels ? OFFICE_DOCUMENT_REL.exec(rootRels)?.[1] : undefined
  return target ? target.replace(/^\//, '') : 'word/document.xml'
}

/**
 * The selection's .docx as the hidden print render opens it: its document
 * part rewritten by `selectionDocumentXml`; every other part is copied as
 * stored, never re-compressed.
 */
export async function selectionDocxForPrint(docx: Buffer, sectPr: string | null): Promise<Buffer> {
  const src = bufferSource(docx)
  const entries = await readZipEntries(src)
  const readText = async (name: string): Promise<string | null> => {
    const e = entries.find((x) => x.name === name)
    if (!e) return null
    const raw = await src.read(e.dataOffset, e.csize)
    const data = e.method === METHOD_DEFLATE ? inflateRawSync(raw) : raw
    return data.toString('utf8')
  }
  const docPath = mainPartPath(await readText('_rels/.rels'))
  const docXml = await readText(docPath)
  if (docXml === null) throw new Error('the selection has no document part')
  const next = Buffer.from(selectionDocumentXml(docXml, sectPr), 'utf8')
  const packed = deflateRawSync(next)
  const out: Parameters<typeof writeZip>[0] = []
  for (const e of entries) {
    const { dataOffset, ...meta } = e
    if (e.name === docPath) {
      out.push({
        meta: {
          ...meta,
          method: METHOD_DEFLATE,
          crc: crc32(next) >>> 0,
          csize: packed.length,
          usize: next.length,
        },
        data: packed,
      })
    } else {
      out.push({ meta, data: await src.read(dataOffset, e.csize) })
    }
  }
  return writeZip(out)
}
