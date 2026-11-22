/**
 * Warm paper-craft visual tokens, geometric connector arrowheads, object-edge snapping,
 * and rich-text mark helpers shared across the live whiteboard stage and SVG export.
 */
import type {
  BoardObject,
  ConnectorEnd,
  ConnectorHead,
  Point,
  RichText,
  TextAlign,
  TextRun,
} from '@genoffice/whiteboard-engine'

/** Warm paper-craft document colors (theme-invariant canvas & export colors). */
export const PAPER_COLORS = {
  paper: '#FFFDF8',
  zoneFill: '#F7F2E8',
  ink: '#221D17',
  inkMuted: '#6B6257',
  line: '#DDD3C2',
  lineStrong: '#CFC3AF',
  lineDashed: '#B8AC98',
  accent: '#B4462A',
  live: '#1E6B66',
  highlighterYellow: '#F5C542',
} as const

/** Soft warm-paper tones for sticky notes and shape fills. */
export const PAPER_FILL_SWATCHES = [
  '#FBE7A1', // butter yellow
  '#F7C9C4', // coral blush
  '#F9CFA0', // warm apricot
  '#CFE6C2', // soft sage
  '#C9DDF0', // dusty sky
  '#E9DEF2', // soft lavender
  '#B3DCD5', // mist teal
  '#FFFDF8', // warm ivory paper
] as const

/** Readable warm-editorial ink tones for text, pen strokes, connectors, and shape borders. */
export const PAPER_INK_SWATCHES = [
  '#221D17', // espresso ink
  '#B4462A', // terracotta
  '#2F5FA8', // editorial blue
  '#1E6B66', // deep teal
  '#3F7A2E', // forest green
  '#C8641E', // warm ochre
  '#6E4A9E', // plum
  '#6B6257', // warm gray
] as const

export const FONT_SIZE_PRESETS = [18, 24, 36, 56] as const
export const LINE_WIDTH_PRESETS = [2, 4, 8] as const

export type RichMark = 'bold' | 'italic' | 'underline' | 'strike'

export interface RichFormatState {
  readonly bold: boolean
  readonly italic: boolean
  readonly underline: boolean
  readonly strike: boolean
  readonly color: string | null
}

/** Extracts shared formatting flags across all non-empty runs of a RichText block. */
export function richTextFormatState(rt: RichText | undefined): RichFormatState {
  const runs: TextRun[] = []
  for (const p of rt?.paragraphs ?? []) {
    for (const r of p.runs ?? []) {
      if (r.text) runs.push(r)
    }
  }
  if (runs.length === 0) {
    return { bold: false, italic: false, underline: false, strike: false, color: null }
  }
  const firstColor = runs[0]?.color ?? null
  const sameColor = runs.every((r) => (r.color ?? null) === firstColor) ? firstColor : null
  return {
    bold: runs.every((r) => Boolean(r.bold)),
    italic: runs.every((r) => Boolean(r.italic)),
    underline: runs.every((r) => Boolean(r.underline)),
    strike: runs.every((r) => Boolean(r.strike)),
    color: sameColor,
  }
}

/** Toggles a text mark across every run of a RichText block. */
export function toggleRichTextMark(rt: RichText | undefined, mark: RichMark): RichText {
  const state = richTextFormatState(rt)
  const nextVal = !state[mark]
  const paragraphs = (rt?.paragraphs ?? [{ runs: [{ text: '' }] }]).map((p) => ({
    ...p,
    runs: (p.runs ?? []).map((r) => {
      const next: TextRun = { ...r }
      if (nextVal) next[mark] = true
      else delete next[mark]
      return next
    }),
  }))
  return { paragraphs }
}

/** Sets text ink color across every run of a RichText block. */
export function setRichTextColor(rt: RichText | undefined, color: string): RichText {
  const paragraphs = (rt?.paragraphs ?? [{ runs: [{ text: '' }] }]).map((p) => ({
    ...p,
    runs: (p.runs ?? []).map((r) => ({ ...r, color })),
  }))
  return { paragraphs }
}

/** Builds a RichText block from plain multiline text while preserving the first run's marks. */
export function updateRichTextPreservingStyle(
  existing: RichText | undefined,
  text: string,
  defaultAlign?: TextAlign,
): RichText {
  const sample = existing?.paragraphs?.[0]?.runs?.[0]
  const style: Omit<TextRun, 'text'> = {}
  if (sample?.bold) style.bold = true
  if (sample?.italic) style.italic = true
  if (sample?.underline) style.underline = true
  if (sample?.strike) style.strike = true
  if (sample?.color) style.color = sample.color
  const align = existing?.paragraphs?.[0]?.align ?? defaultAlign
  return {
    paragraphs: text.split('\n').map((line) => ({
      ...(align ? { align } : {}),
      runs: [{ text: line, ...style }],
    })),
  }
}

/** Creates a fresh RichText block from plain multiline text. */
export function plainRichText(
  text: string,
  options: { bold?: boolean; color?: string; align?: TextAlign } = {},
): RichText {
  const style: Omit<TextRun, 'text'> = {}
  if (options.bold) style.bold = true
  if (options.color) style.color = options.color
  return {
    paragraphs: text.split('\n').map((line) => ({
      ...(options.align ? { align: options.align } : {}),
      runs: [{ text: line, ...style }],
    })),
  }
}

/** Geometric filled arrowhead length proportional to line stroke width. */
export function connectorHeadLength(strokeWidth: number): number {
  return Math.max(12, strokeWidth * 3.5)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Pulls `point` back toward `from` so the shaft finishes cleanly inside the arrowhead base. */
function pullBack(point: Point, from: Point, by: number): Point {
  const dist = Math.hypot(point.x - from.x, point.y - from.y)
  if (dist <= by || dist < 1e-3) return point
  const t = by / dist
  return {
    x: round2(point.x + (from.x - point.x) * t),
    y: round2(point.y + (from.y - point.y) * t),
  }
}

/** Computes a crisp geometric filled arrowhead polygon with its tip at `tip`, pointing away from `from`. */
export function connectorArrowPath(tip: Point, from: Point, strokeWidth: number): string {
  const length = connectorHeadLength(strokeWidth)
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x)
  const half = length * 0.55
  const bx = tip.x - Math.cos(angle) * length
  const by = tip.y - Math.sin(angle) * length
  const px = -Math.sin(angle) * half
  const py = Math.cos(angle) * half
  return `M${round2(tip.x)} ${round2(tip.y)}L${round2(bx + px)} ${round2(by + py)}L${round2(bx - px)} ${round2(by - py)}Z`
}

export interface ConnectorRenderGeometry {
  readonly shaftPath: string
  readonly fullPath: string
  readonly startArrowPath: string | null
  readonly endArrowPath: string | null
  readonly startCircle: Point | null
  readonly endCircle: Point | null
  readonly midpoint: Point
}

/**
 * Computes clean editorial connector geometry: pulled-back line shaft + geometric filled
 * arrowheads or endpoint dots (no marker scaling artifacts).
 */
export function computeConnectorGeometry(
  start: Point,
  end: Point,
  waypoints: readonly Point[] | undefined,
  strokeWidth: number,
  startHead: ConnectorHead | undefined,
  endHead: ConnectorHead | undefined,
): ConnectorRenderGeometry {
  const pts: Point[] = [start, ...(waypoints ?? []), end]
  const hasStartArrow = startHead === 'arrow' || startHead === 'triangle'
  const hasEndArrow = endHead === 'arrow' || endHead === 'triangle'
  const inset = connectorHeadLength(strokeWidth) * 0.7

  const shaftPts = pts.map((pt) => ({ x: pt.x, y: pt.y }))
  const firstNeighbor = pts[1] ?? end
  const lastNeighbor = pts[pts.length - 2] ?? start

  if (hasStartArrow && shaftPts.length >= 2) {
    shaftPts[0] = pullBack(start, firstNeighbor, inset)
  }
  if (hasEndArrow && shaftPts.length >= 2) {
    shaftPts[shaftPts.length - 1] = pullBack(end, lastNeighbor, inset)
  }

  const toPath = (list: readonly Point[]) =>
    list.map((p, i) => `${i === 0 ? 'M' : 'L'}${round2(p.x)} ${round2(p.y)}`).join(' ')

  const midIdx = Math.floor(pts.length / 2)
  const midpoint =
    pts.length % 2 === 1
      ? pts[midIdx]!
      : {
          x: (pts[midIdx - 1]!.x + pts[midIdx]!.x) / 2,
          y: (pts[midIdx - 1]!.y + pts[midIdx]!.y) / 2,
        }

  return {
    shaftPath: toPath(shaftPts),
    fullPath: toPath(pts),
    startArrowPath: hasStartArrow ? connectorArrowPath(start, firstNeighbor, strokeWidth) : null,
    endArrowPath: hasEndArrow ? connectorArrowPath(end, lastNeighbor, strokeWidth) : null,
    startCircle: startHead === 'circle' ? start : null,
    endCircle: endHead === 'circle' ? end : null,
    midpoint,
  }
}

/** Resolves a ConnectorEnd (anchored object side or free canvas point) to board coordinates. */
export function resolveConnectorEnd(
  end: ConnectorEnd,
  byId: ReadonlyMap<string, BoardObject>,
): Point {
  if ('objectId' in end) {
    const obj = byId.get(end.objectId)
    if (obj) {
      return {
        x: obj.x + obj.width * (end.anchorX ?? 0.5),
        y: obj.y + obj.height * (end.anchorY ?? 0.5),
      }
    }
    return { x: 0, y: 0 }
  }
  return { x: end.x, y: end.y }
}

const SIDE_ANCHORS = [
  { anchorX: 0.5, anchorY: 0 },
  { anchorX: 1, anchorY: 0.5 },
  { anchorX: 0.5, anchorY: 1 },
  { anchorX: 0, anchorY: 0.5 },
] as const

export interface SnapAttachTarget {
  readonly objectId: string
  readonly anchorX: number
  readonly anchorY: number
  readonly x: number
  readonly y: number
}

/** Finds the top-most attachable object under `point` and snaps to its nearest/facing side middle. */
export function findAttachTarget(
  objects: readonly BoardObject[],
  point: Point,
  tolerance: number,
  excludeIds: ReadonlySet<string> = new Set(),
  toward?: Point,
): SnapAttachTarget | null {
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const obj = objects[i]!
    if (obj.kind === 'connector' || obj.kind === 'stroke' || excludeIds.has(obj.id)) continue
    if (
      point.x < obj.x - tolerance ||
      point.y < obj.y - tolerance ||
      point.x > obj.x + obj.width + tolerance ||
      point.y > obj.y + obj.height + tolerance
    ) {
      continue
    }
    let best: (typeof SIDE_ANCHORS)[number] = SIDE_ANCHORS[0]
    let bestDist = Infinity
    for (const side of SIDE_ANCHORS) {
      const sx = obj.x + obj.width * side.anchorX
      const sy = obj.y + obj.height * side.anchorY
      const ref = toward ?? point
      const d = Math.hypot(ref.x - sx, ref.y - sy)
      if (d < bestDist) {
        bestDist = d
        best = side
      }
    }
    return {
      objectId: obj.id,
      anchorX: best.anchorX,
      anchorY: best.anchorY,
      x: round2(obj.x + obj.width * best.anchorX),
      y: round2(obj.y + obj.height * best.anchorY),
    }
  }
  return null
}

/** Maps a legacy raw white page background to warm ivory paper on the live stage. */
export function livePaperColor(bgColor: string | undefined): string {
  if (!bgColor || bgColor.toUpperCase() === '#FFFFFF' || bgColor.toUpperCase() === '#FFF') {
    return PAPER_COLORS.paper
  }
  return bgColor
}
