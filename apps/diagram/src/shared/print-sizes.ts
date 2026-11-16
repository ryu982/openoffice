/**
 * The sheet a diagram page prints on (spec 5). draw.io measures in units of
 * 1/100 inch (its A4 page is 827 × 1169), and a page prints on a sheet of its
 * own page format. The print document (`main/print-document.ts`) and the
 * print dialog's layout diagram read the same sizes from here, so the
 * diagram shows the sheets the job PDF really has.
 */
import type { PageSize } from '@genoffice/print-layout/plan'

/** draw.io's A4 portrait page, used for a page whose format is unusable. */
export const FALLBACK_SHEET_UNITS = { width: 827, height: 1169 } as const

const MAX_UNITS = 100_000

/** draw.io units (1/100 inch) to points (1/72 inch) */
const points = (units: number): number => (units * 72) / 100

/** A size in draw.io units, or `fallback` when it is not a usable one. */
export function sheetUnits(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 && value <= MAX_UNITS ? value : fallback
}

/** The sheet of one page in points, as the print document sizes it. */
export function sheetSizePt(page: { pageWidth: number; pageHeight: number }): PageSize {
  return {
    widthPt: points(sheetUnits(page.pageWidth, FALLBACK_SHEET_UNITS.width)),
    heightPt: points(sheetUnits(page.pageHeight, FALLBACK_SHEET_UNITS.height)),
  }
}
