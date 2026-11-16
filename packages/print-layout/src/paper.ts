import { mmToPt, type PageSize } from './geometry'

/** Papers the layout can print on. Tunable list. */
export const PAPER_NAMES = ['A3', 'A4', 'A5', 'B4', 'B5', 'Letter', 'Legal'] as const
export type PaperName = (typeof PAPER_NAMES)[number]

/**
 * Portrait sizes in millimetres. B4 and B5 are the JIS sizes, the ones the word
 * editor's page setup already offers and the ones Korean offices load.
 */
export const PAPER_SIZES_MM: Readonly<Record<PaperName, { widthMm: number; heightMm: number }>> = {
  A3: { widthMm: 297, heightMm: 420 },
  A4: { widthMm: 210, heightMm: 297 },
  A5: { widthMm: 148, heightMm: 210 },
  B4: { widthMm: 257, heightMm: 364 },
  B5: { widthMm: 182, heightMm: 257 },
  Letter: { widthMm: 215.9, heightMm: 279.4 },
  Legal: { widthMm: 215.9, heightMm: 355.6 },
}

/** Portrait size of a paper in points. */
export function paperSizePt(name: PaperName): PageSize {
  const { widthMm, heightMm } = PAPER_SIZES_MM[name]
  return { widthPt: mmToPt(widthMm), heightPt: mmToPt(heightMm) }
}

export function isPaperName(value: unknown): value is PaperName {
  return typeof value === 'string' && (PAPER_NAMES as readonly string[]).includes(value)
}
