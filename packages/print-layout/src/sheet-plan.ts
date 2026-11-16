import { at } from './at'
import { issue, PrintLayoutError } from './errors'
import {
  centreIn,
  fitScale,
  isLandscape,
  mmToPt,
  type LineSegment,
  type PageSize,
  type Rect,
} from './geometry'
import { labelCellBoxes, labelCellCount, resolveLabelSpec } from './labels'
import { validateOptions, type NupCount, type PrintLayoutOptions } from './options'
import { paperSizePt, PAPER_SIZES_MM } from './paper'

/** One place on a face. Every cell is drawn clipped to its `box`. */
export interface PlacedCell {
  /**
   * The area this cell owns: the grid cell for N-up and booklet, the label box
   * for labels, the whole face for single pages and poster tiles.
   */
  box: Rect
  /** 0-based job page drawn here, or null for a blank cell. */
  pageIndex: number | null
  /**
   * Where the whole job page (as displayed, /Rotate applied) lands, scaled with
   * its aspect kept. It can extend past `box` (poster tiles, single pages at
   * 100% on a smaller paper); the part outside `box` is clipped. Null when blank.
   */
  content: Rect | null
  /** Labels: 1-based cell number, counted row-first. */
  labelCell?: number
  /** Booklet: 1-based booklet page, counting the blank pages added at the end. */
  bookletPage?: number
}

export interface PosterTile {
  /** 0-based job page this tile belongs to */
  pageIndex: number
  /** 0-based tile column and row */
  col: number
  row: number
  cols: number
  rows: number
}

/** One side of a sheet of paper in the arranged output. */
export interface PlannedFace {
  /** 1-based face number in the arranged output, before sides and reverse. */
  face: number
  /** face size in points */
  width: number
  height: number
  cells: PlacedCell[]
  /** Booklet: which physical sheet (1-based) and which side of it. */
  booklet?: { sheet: number; side: 'front' | 'back' }
  poster?: PosterTile
  /** thin lines to cut along (poster tiles) */
  cutMarks: LineSegment[]
}

export interface SheetPlan {
  /** every arranged face, in arranged order */
  faces: PlannedFace[]
  /** the faces that get printed: `faces` after the sides filter, then reversed if asked */
  output: PlannedFace[]
}

const NUP_GRID: Record<NupCount, { long: number; short: number }> = {
  2: { long: 2, short: 1 },
  4: { long: 2, short: 2 },
  6: { long: 3, short: 2 },
  9: { long: 3, short: 3 },
  16: { long: 4, short: 4 },
}

/** Scales this close are treated as a tie. */
const TIE = 1e-9

interface GridFace {
  width: number
  height: number
  cols: number
  rows: number
}

/**
 * Picks the face orientation that shows `first` largest in one cell. `base` is
 * the paper (or first page) size in either orientation.
 */
function chooseGrid(
  base: PageSize,
  first: PageSize,
  portraitGrid: { cols: number; rows: number },
  landscapeGrid: { cols: number; rows: number },
  preferLandscapeOnTie: boolean,
): GridFace {
  const a = Math.min(base.widthPt, base.heightPt)
  const b = Math.max(base.widthPt, base.heightPt)
  const portrait: GridFace = { width: a, height: b, ...portraitGrid }
  const landscape: GridFace = { width: b, height: a, ...landscapeGrid }
  const scale = (g: GridFace) =>
    fitScale(first, { width: g.width / g.cols, height: g.height / g.rows }, true)
  const sp = scale(portrait)
  const sl = scale(landscape)
  if (Math.abs(sp - sl) <= TIE * Math.max(sp, sl))
    return preferLandscapeOnTie ? landscape : portrait
  return sl > sp ? landscape : portrait
}

function gridCell(g: GridFace, col: number, row: number): Rect {
  const width = g.width / g.cols
  const height = g.height / g.rows
  return { x: col * width, y: row * height, width, height }
}

function fitCell(pages: readonly PageSize[], pageIndex: number | null, box: Rect): PlacedCell {
  if (pageIndex === null) return { box, pageIndex: null, content: null }
  const page = at(pages, pageIndex)
  return { box, pageIndex, content: centreIn(page, box, fitScale(page, box, true)) }
}

function baseSize(pages: readonly PageSize[], o: PrintLayoutOptions): PageSize {
  return o.paper === 'source' ? at(pages, 0) : paperSizePt(o.paper)
}

function planSingle(
  pages: readonly PageSize[],
  o: PrintLayoutOptions,
): Omit<PlannedFace, 'face'>[] {
  return pages.map((page, pageIndex) => {
    if (o.paper === 'source') {
      const box = { x: 0, y: 0, width: page.widthPt, height: page.heightPt }
      return {
        width: box.width,
        height: box.height,
        cells: [{ box, pageIndex, content: { ...box } }],
        cutMarks: [],
      }
    }
    const paper = paperSizePt(o.paper)
    const landscape = isLandscape(page)
    const width = landscape ? paper.heightPt : paper.widthPt
    const height = landscape ? paper.widthPt : paper.heightPt
    const box = { x: 0, y: 0, width, height }
    const scale = o.fitToPaper ? fitScale(page, box, false) : 1
    return {
      width,
      height,
      cells: [{ box, pageIndex, content: centreIn(page, box, scale) }],
      cutMarks: [],
    }
  })
}

function planNup(pages: readonly PageSize[], o: PrintLayoutOptions): Omit<PlannedFace, 'face'>[] {
  const { long, short } = NUP_GRID[o.nup.count]
  const g = chooseGrid(
    baseSize(pages, o),
    at(pages, 0),
    { cols: short, rows: long },
    { cols: long, rows: short },
    isLandscape(at(pages, 0)),
  )
  const perFace = g.cols * g.rows
  const faces: Omit<PlannedFace, 'face'>[] = []
  for (let start = 0; start < pages.length; start += perFace) {
    const cells: PlacedCell[] = []
    for (let j = 0; j < perFace; j++) {
      const col = o.nup.order === 'row' ? j % g.cols : Math.floor(j / g.rows)
      const row = o.nup.order === 'row' ? Math.floor(j / g.cols) : j % g.rows
      const k = start + j
      cells.push(fitCell(pages, k < pages.length ? k : null, gridCell(g, col, row)))
    }
    faces.push({ width: g.width, height: g.height, cells, cutMarks: [] })
  }
  return faces
}

function planBooklet(
  pages: readonly PageSize[],
  o: PrintLayoutOptions,
): Omit<PlannedFace, 'face'>[] {
  const side = { cols: 2, rows: 1 }
  const g = chooseGrid(baseSize(pages, o), at(pages, 0), side, side, true)
  const total = Math.ceil(pages.length / 4) * 4
  const faces: Omit<PlannedFace, 'face'>[] = []
  for (let s = 0; s < total / 4; s++) {
    const sides: Array<['front' | 'back', number, number]> = [
      ['front', total - 2 * s, 2 * s + 1],
      ['back', 2 * s + 2, total - 2 * s - 1],
    ]
    for (const [which, leftPage, rightPage] of sides) {
      const pair = o.booklet.binding === 'left' ? [leftPage, rightPage] : [rightPage, leftPage]
      const cells = pair.map((bookletPage, col) => ({
        ...fitCell(
          pages,
          bookletPage <= pages.length ? bookletPage - 1 : null,
          gridCell(g, col, 0),
        ),
        bookletPage,
      }))
      faces.push({
        width: g.width,
        height: g.height,
        cells,
        booklet: { sheet: s + 1, side: which },
        cutMarks: [],
      })
    }
  }
  return faces
}

function planPoster(
  pages: readonly PageSize[],
  o: PrintLayoutOptions,
): Omit<PlannedFace, 'face'>[] {
  const { cols, rows, cutMarks } = o.poster
  const overlap = mmToPt(o.poster.overlapMm)
  const posterOf = (g: { width: number; height: number }) => ({
    width: cols * g.width - (cols - 1) * overlap,
    height: rows * g.height - (rows - 1) * overlap,
  })
  const base = baseSize(pages, o)
  const a = Math.min(base.widthPt, base.heightPt)
  const b = Math.max(base.widthPt, base.heightPt)
  const portrait = { width: a, height: b }
  const landscape = { width: b, height: a }
  // Same rule as N-up: the orientation that shows the first page largest.
  const sp = fitScale(at(pages, 0), posterOf(portrait), true)
  const sl = fitScale(at(pages, 0), posterOf(landscape), true)
  const tie = Math.abs(sp - sl) <= TIE * Math.max(sp, sl)
  const tile = tie
    ? isLandscape(at(pages, 0))
      ? landscape
      : portrait
    : sl > sp
      ? landscape
      : portrait
  if (overlap >= tile.width || overlap >= tile.height) {
    throw new PrintLayoutError(
      issue('poster-overlap-too-large', 'the overlap is as large as the sheet it overlaps'),
    )
  }
  const poster = posterOf(tile)
  const stepX = tile.width - overlap
  const stepY = tile.height - overlap
  const faces: Omit<PlannedFace, 'face'>[] = []
  pages.forEach((page, pageIndex) => {
    const whole = centreIn(page, { x: 0, y: 0, ...poster }, fitScale(page, poster, true))
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const box = { x: 0, y: 0, width: tile.width, height: tile.height }
        const marks: LineSegment[] = []
        if (cutMarks && col < cols - 1) {
          marks.push({ x1: stepX, y1: 0, x2: stepX, y2: tile.height })
        }
        if (cutMarks && row < rows - 1) {
          marks.push({ x1: 0, y1: stepY, x2: tile.width, y2: stepY })
        }
        faces.push({
          width: tile.width,
          height: tile.height,
          cells: [
            {
              box,
              pageIndex,
              content: { ...whole, x: whole.x - col * stepX, y: whole.y - row * stepY },
            },
          ],
          poster: { pageIndex, col, row, cols, rows },
          cutMarks: marks,
        })
      }
    }
  })
  return faces
}

function planLabels(
  pages: readonly PageSize[],
  o: PrintLayoutOptions,
): Omit<PlannedFace, 'face'>[] {
  // validateOptions has resolved the spec already.
  const spec = resolveLabelSpec(o.labels.spec)!
  const paper = PAPER_SIZES_MM[spec.paper]
  const width = mmToPt(paper.widthMm)
  const height = mmToPt(paper.heightMm)
  const boxes = labelCellBoxes(spec)
  const perFace = labelCellCount(spec)
  const first = o.labels.startCell - 1
  const sheetCount = o.labels.fill === 'repeat' ? 1 : Math.ceil((first + pages.length) / perFace)
  const faces: Omit<PlannedFace, 'face'>[] = []
  for (let s = 0; s < sheetCount; s++) {
    const cells = boxes.map((box, c) => {
      let pageIndex: number | null = null
      if (o.labels.fill === 'repeat') {
        if (c >= first) pageIndex = o.labels.repeatPage - 1
      } else {
        const k = s * perFace + c - first
        if (k >= 0 && k < pages.length) pageIndex = k
      }
      return { ...fitCell(pages, pageIndex, box), labelCell: c + 1 }
    })
    faces.push({ width, height, cells, cutMarks: [] })
  }
  return faces
}

/**
 * Lays the job's pages onto faces. `pages` are the job's page sizes in points
 * with /Rotate applied. Throws `PrintLayoutError` for invalid options or page
 * sizes. The plan is the single source for both the layout diagram and the
 * arranged PDF.
 */
export function planSheets(pages: readonly PageSize[], options: PrintLayoutOptions): SheetPlan {
  const checked = validateOptions(options, pages.length)
  if (!checked.ok) throw new PrintLayoutError(checked.error)
  const o = checked.options
  for (const p of pages) {
    if (!(
      Number.isFinite(p.widthPt) &&
      Number.isFinite(p.heightPt) &&
      p.widthPt > 0 &&
      p.heightPt > 0
    )) {
      throw new PrintLayoutError(issue('invalid-page-size', 'every page needs a positive size'))
    }
  }
  const arranged =
    o.mode === 'nup'
      ? planNup(pages, o)
      : o.mode === 'booklet'
        ? planBooklet(pages, o)
        : o.mode === 'poster'
          ? planPoster(pages, o)
          : o.mode === 'labels'
            ? planLabels(pages, o)
            : planSingle(pages, o)
  const faces = arranged.map((f, i) => ({ face: i + 1, ...f }))
  const kept =
    o.sides === 'all' ? faces : faces.filter((f) => (f.face % 2 === 1) === (o.sides === 'odd'))
  const output = o.reverse ? kept.slice().reverse() : kept
  return { faces, output }
}
