/**
 * Pieces of the advanced print route (decision 0141) the word editor works
 * out on its own: which preview pages go into one printToPDF call, and what
 * a printed selection is made of. No DOM and no IPC, so tests import it.
 */
import type { Node as PmDocNode } from '@tiptap/pm/model'
import { applySectionSettings, applyTitlePg, type SectionInfo } from '@genoffice/docx-engine'
import type { PageSize } from '@genoffice/print-layout/plan'
import type { PmNode } from './editor/convert'

/** The job PDF of chosen preview pages: base64 fragments in page order. */
export type PrintPageJob = { ok: true; parts: string[] } | { ok: false; error?: string }

/** A printed selection laid out on pages of its own. */
export type PrintSelectionJob =
  { ok: true; parts: string[]; pages: PageSize[] } | { ok: false; error?: string }

/** Pages one printToPDF call prints: 0-based preview pages `from..to`, paper in twips. */
export interface PrintJobGroup {
  w: number
  h: number
  from: number
  to: number
}

/** Chromium prints at most this many heavy pages reliably in one job (the PDF export's own chunk). */
export const PRINT_JOB_CHUNK = 10

/**
 * The printToPDF calls for the chosen pages: runs of consecutive chosen pages
 * of one paper size, at most `chunk` pages each. Pages left out of the range
 * fall between groups, so no call prints them.
 */
export function printJobGroups(
  sizes: ReadonlyArray<{ w: number; h: number }>,
  pages: readonly number[],
  chunk: number = PRINT_JOB_CHUNK,
): PrintJobGroup[] {
  const groups: PrintJobGroup[] = []
  const chosen = [...new Set(pages)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < sizes.length)
    .sort((a, b) => a - b)
  for (const i of chosen) {
    const { w, h } = sizes[i]!
    const last = groups[groups.length - 1]
    if (
      last &&
      last.to === i - 1 &&
      last.w === w &&
      last.h === h &&
      last.to - last.from + 1 < chunk
    )
      last.to = i
    else groups.push({ w, h, from: i, to: i })
  }
  return groups
}

const PX_PER_PT = 96 / 72

/** A preview sheet's size in points, read off its layout size in CSS px. */
export function previewPageSize(widthPx: number, heightPx: number): PageSize {
  return { widthPt: widthPx / PX_PER_PT, heightPt: heightPx / PX_PER_PT }
}

/** An empty section-break paragraph: a chip in the editor, a section in the file. */
function isSectionBreakChip(node: PmNode): boolean {
  return node.type === 'docProtected' && node.attrs?.label === 'Section break paragraph'
}

/**
 * The document a printed selection is made of: the selected content only,
 * cut as the editor cuts it (a partly selected paragraph keeps its own
 * formatting), without the section-break chips that would start new
 * sections. Null when nothing printable is selected.
 */
export function selectionPrintDoc(doc: PmDocNode, from: number, to: number): PmNode | null {
  if (!(to > from)) return null
  const cut = doc.cut(from, to).toJSON() as PmNode
  const content = (cut.content ?? []).filter((node) => !isSectionBreakChip(node))
  if (content.length === 0) return null
  return { ...cut, content }
}

/**
 * Section properties a printed selection takes: those of the section it starts
 * in, with the page setup the editor shows for it. Null for the document's
 * last section, whose properties the save already writes into the body.
 */
export function selectionSectPr(sections: readonly SectionInfo[], index: number): string | null {
  if (sections.length <= 1 || index >= sections.length - 1) return null
  const sec = sections[Math.max(0, index)]
  if (!sec?.sectPrXml) return null
  return applyTitlePg(applySectionSettings(sec.sectPrXml, sec.settings), sec.titlePg)
}
