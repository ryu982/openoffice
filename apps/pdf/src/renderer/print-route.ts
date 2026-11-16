/**
 * Which pages the print dialog's range covers, and which print path a job
 * takes. With the shared layout options at their defaults the current path
 * (`printDoc` → `printPdf`) runs with the arguments it always got; any option
 * sends the job to the main process, which arranges it (spec 3).
 */
import {
  isDefaultOptions,
  type PageSize,
  type PrintLayoutOptions,
} from '@genoffice/print-layout/plan'
import { parsePageRanges } from './view-config'

export type PrintRangeMode = 'all' | 'current' | 'custom' | 'picked'

export interface PrintRangeInput {
  mode: PrintRangeMode
  /** the custom range field, e.g. "1,3,5-8" */
  customText: string
  /** visible pages */
  pageCount: number
  /** 1-based visible page the reader is on */
  currentPage: number
  /** 1-based visible pages picked in the thumbnails */
  pickedPages: readonly number[]
}

/** 1-based pages to print; `pages` undefined means the whole document. */
export type PrintTargets = { ok: true; pages: number[] | undefined } | { ok: false }

/** One picked page is the current page; the range needs two or more. */
export function canPrintPicked(pickedPages: readonly number[]): boolean {
  return pickedPages.length >= 2
}

export function printTargets(input: PrintRangeInput): PrintTargets {
  switch (input.mode) {
    case 'all':
      return { ok: true, pages: undefined }
    case 'current':
      return { ok: true, pages: [input.currentPage] }
    case 'custom': {
      const pages = parsePageRanges(input.customText, input.pageCount)
      return pages && pages.length > 0 ? { ok: true, pages } : { ok: false }
    }
    case 'picked':
      if (!canPrintPicked(input.pickedPages)) return { ok: false }
      return { ok: true, pages: [...new Set(input.pickedPages)].sort((a, b) => a - b) }
  }
}

/** Picked original page indices as 1-based visible pages, in visible order. */
export function pickedVisiblePages(
  picked: readonly number[],
  visList: readonly number[],
): number[] {
  return picked
    .map((origIdx) => visList.indexOf(origIdx) + 1)
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
}

export interface PrintRoutes {
  /** the current print path; called with no argument for the whole document, as before */
  current: (...pages: [] | [number[]]) => void
  /** the arranged route; null is the whole document */
  arranged: (pages: number[] | null) => void
}

export function routePrint(
  options: PrintLayoutOptions,
  pages: number[] | undefined,
  routes: PrintRoutes,
): 'current' | 'arranged' {
  if (isDefaultOptions(options)) {
    if (pages === undefined) routes.current()
    else routes.current(pages)
    return 'current'
  }
  routes.arranged(pages ?? null)
  return 'arranged'
}

/** What the viewer knows about a visible page: pdf.js size at scale 1 and its total rotation. */
export interface VisiblePageGeom {
  width: number
  height: number
  rotate: number
  userUnit: number
}

/**
 * The print job's page sizes for the layout diagram, from what the viewer
 * already knows: the job holds these visible pages in this order once the
 * pending edits are saved. pdf.js sizes include UserUnit; the job PDF's boxes
 * do not. Null while the range resolves to no page.
 */
export function jobPageSizes(
  pages: readonly number[] | undefined,
  pageCount: number,
  geomAt: (visiblePage: number) => VisiblePageGeom | null,
): PageSize[] | null {
  const list = pages ?? Array.from({ length: pageCount }, (_, i) => i + 1)
  if (list.length === 0) return null
  const out: PageSize[] = []
  for (const n of list) {
    const g = n >= 1 && n <= pageCount ? geomAt(n) : null
    if (!g) return null
    const unit = g.userUnit > 0 ? g.userUnit : 1
    const w = g.width / unit
    const h = g.height / unit
    const quarter = ((Math.round(g.rotate / 90) % 4) + 4) % 4
    out.push(quarter % 2 === 0 ? { widthPt: w, heightPt: h } : { widthPt: h, heightPt: w })
  }
  return out
}
