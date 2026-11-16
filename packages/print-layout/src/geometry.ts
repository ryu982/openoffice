/** A page or sheet size in PDF points, with any /Rotate already applied. */
export interface PageSize {
  widthPt: number
  heightPt: number
}

/** A box in points on a sheet. Origin is the sheet's top-left corner, y grows downwards. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A straight line in the same top-left coordinates as `Rect`. */
export interface LineSegment {
  x1: number
  y1: number
  x2: number
  y2: number
}

export const PT_PER_MM = 72 / 25.4

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM
}

/** Uniform scale that fits `page` inside `box`; `grow: false` never enlarges. */
export function fitScale(
  page: PageSize,
  box: { width: number; height: number },
  grow: boolean,
): number {
  const s = Math.min(box.width / page.widthPt, box.height / page.heightPt)
  return grow ? s : Math.min(1, s)
}

/** `page` scaled by `scale` and centred on `box`. The result may extend past `box`. */
export function centreIn(page: PageSize, box: Rect, scale: number): Rect {
  const width = page.widthPt * scale
  const height = page.heightPt * scale
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  }
}

export function isLandscape(size: PageSize): boolean {
  return size.widthPt > size.heightPt
}
