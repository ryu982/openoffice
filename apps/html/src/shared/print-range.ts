/**
 * A typed page range of the print dialog, read the way Chromium's `pageRanges`
 * prints it: the chosen pages in document order, each once, pages past the end
 * of the document left out. The screen counts the pages it shows with this and
 * the main process builds the job PDF of the same pages.
 */
export interface HtmlPrintPageRange {
  /** 1-based, inclusive */
  from: number
  to: number
}

/** The 1-based pages a range picks out of a document of `pageCount` pages, ascending. */
export function pickPrintPages(ranges: readonly HtmlPrintPageRange[], pageCount: number): number[] {
  const picked = new Set<number>()
  for (const { from, to } of ranges) {
    for (let page = Math.max(1, from); page <= Math.min(to, pageCount); page++) picked.add(page)
  }
  return [...picked].sort((a, b) => a - b)
}

/** Ascending pages as a `pageRanges` text: [1, 2, 3, 5] → "1-3, 5". */
export function printPagesText(pages: readonly number[]): string {
  const parts: string[] = []
  let start = -1
  let end = -1
  const flush = () => {
    if (start > 0) parts.push(start === end ? `${start}` : `${start}-${end}`)
  }
  for (const page of pages) {
    if (page === end + 1) {
      end = page
      continue
    }
    flush()
    start = page
    end = page
  }
  flush()
  return parts.join(', ')
}

const MAX_RANGES = 1000
const MAX_PAGE = 1_000_000

/** A request's ranges, checked; null when they are not a well-formed list. */
export function readPrintPageRanges(raw: unknown): HtmlPrintPageRange[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_RANGES) return null
  const out: HtmlPrintPageRange[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null
    const { from, to } = item as Record<string, unknown>
    if (!Number.isInteger(from) || !Number.isInteger(to)) return null
    const f = from as number
    const t = to as number
    if (f < 1 || t < f || t > MAX_PAGE) return null
    out.push({ from: f, to: t })
  }
  return out
}
