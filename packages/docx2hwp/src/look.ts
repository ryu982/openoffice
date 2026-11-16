/**
 * The look of a table in Hangul. Two things a Word table relies on are not
 * there: Hangul puts the whole line gap under a line and none under the last
 * line of a cell, so a cell without vertical margins has its text against
 * both borders; and a table placed like a character cannot go on to the next
 * page, so a long one leaves the rest of its page empty. Every document gets
 * those two put right (wordLook). A document that was not laid out in Word
 * (Markdown has tables but says nothing of widths, margins or headers) also
 * gets the rest of a Hangul table's look (hangulLook). Pure functions over
 * the plan: the engine is not involved.
 */
import type { Block, Cell, HwpPlan, Inline, Para, Table } from './model'
import { hwpFromMm, hwpFromPt, ptFromHwp, ptFromPara, type HwpUnit } from './units'

/**
 * 'word' keeps what the Word document says and only makes its tables hold in
 * Hangul: they run over pages and their text stays off the borders. 'hangul'
 * gives the tables the whole look of a document written in Hangul. Nothing
 * but tables is touched either way.
 */
export type HwpLook = 'word' | 'hangul'

/** the space a table between paragraphs keeps to the text above and below it */
const TABLE_ABOVE = hwpFromMm(1)
const TABLE_BELOW = hwpFromMm(3)
const TABLE_BELOW_MOST_PT = 24
/** a Word table has no margin of its own: only the text under it is kept off its border */
const WORD_TABLE_ABOVE = hwpFromMm(0)
const WORD_TABLE_BELOW = hwpFromMm(1)

const CELL_MARGIN_VERTICAL = hwpFromMm(1)
/** Hangul's own default for a new cell */
const CELL_MARGIN_SIDE = hwpFromMm(1.8)

export function hangulLook(plan: HwpPlan): HwpPlan {
  return {
    ...plan,
    body: plan.body.map((block, i) =>
      block.kind === 'table'
        ? {
            ...tableLook(block),
            flow: {
              kind: 'block',
              above: TABLE_ABOVE,
              below: spaceBelow(plan.body[i + 1], TABLE_BELOW),
            },
          }
        : block,
    ),
  }
}

/**
 * A Word document's tables as Word shows them, made to hold in Hangul: a body
 * table goes on to the next page, and a cell has at least the vertical margin
 * that stands in for the line gap Hangul leaves out. Widths, alignment, the
 * side margins and the header row stay what the document says.
 */
export function wordLook(plan: HwpPlan): HwpPlan {
  return {
    ...plan,
    body: plan.body.map((block, i) =>
      block.kind === 'table'
        ? {
            ...offTheBorders(block),
            flow: {
              kind: 'block',
              above: WORD_TABLE_ABOVE,
              below: spaceBelow(plan.body[i + 1], WORD_TABLE_BELOW),
            },
          }
        : block,
    ),
  }
}

function offTheBorders(table: Table): Table {
  return {
    ...table,
    cells: table.cells.map((cell): Cell => ({
      ...cell,
      padding: {
        ...cell.padding,
        top: atLeast(cell.padding.top, CELL_MARGIN_VERTICAL),
        bottom: atLeast(cell.padding.bottom, CELL_MARGIN_VERTICAL),
      },
      body: cell.body.map((block) => (block.kind === 'table' ? offTheBorders(block) : block)),
    })),
  }
}

/**
 * The paragraph after a table between paragraphs starts at the table's bottom
 * edge: its own space above is not kept clear of the table, so the table's
 * margin has to be at least that much.
 */
function spaceBelow(next: Block | undefined, least: HwpUnit): HwpUnit {
  if (next?.kind !== 'para') return least
  const before = hwpFromPt(Math.min(ptFromPara(next.shape.before), TABLE_BELOW_MOST_PT))
  return before > least ? before : least
}

function tableLook(table: Table): Table {
  const header = hasHeaderRow(table)
  const cells = table.cells.map((cell): Cell => ({
    ...cell,
    vAlign: 'center',
    padding: {
      top: atLeast(cell.padding.top, CELL_MARGIN_VERTICAL),
      bottom: atLeast(cell.padding.bottom, CELL_MARGIN_VERTICAL),
      left: atLeast(cell.padding.left, CELL_MARGIN_SIDE),
      right: atLeast(cell.padding.right, CELL_MARGIN_SIDE),
    },
    body: cell.body.map((block) =>
      block.kind === 'table'
        ? tableLook(block)
        : header && cell.row === 0
          ? headerPara(block)
          : block,
    ),
  }))
  const padded: Table = { ...table, cells, repeatHeader: table.repeatHeader || header }
  return { ...padded, colWidths: fittedWidths(padded) }
}

const atLeast = (value: HwpUnit, floor: HwpUnit): HwpUnit => (value < floor ? floor : value)

/**
 * The first row names the columns when it alone is shaded (how a Markdown
 * table's header arrives), or when Word already repeats it on every page.
 */
function hasHeaderRow(table: Table): boolean {
  if (table.repeatHeader) return true
  const rows = new Set(table.cells.map((cell) => cell.row))
  if (rows.size < 2) return false
  const first = table.cells.filter((cell) => cell.row === 0)
  const rest = table.cells.filter((cell) => cell.row !== 0)
  return first.every((cell) => cell.fill !== null) && rest.every((cell) => cell.fill === null)
}

/** bold and centred, as the Hangul editor writes the header of a table it adds */
function headerPara(para: Para): Para {
  return {
    ...para,
    shape: { ...para.shape, align: 'center' },
    inlines: para.inlines.map((inline): Inline =>
      inline.kind === 'text' ? { ...inline, chars: { ...inline.chars, bold: true } } : inline,
    ),
  }
}

// ---------------------------------------------------------------- column widths

/**
 * Columns that all came out the same width were never given one. They get
 * widths from what they hold, the way a browser lays out a table: each column
 * between its longest word and its longest line, sharing the table's width.
 * A table whose columns differ keeps the widths its author set.
 */
function fittedWidths(table: Table): readonly HwpUnit[] {
  const widths = table.colWidths
  const points = widths.map((w) => ptFromHwp(w))
  const totalPt = points.reduce((sum, w) => sum + w, 0)
  const even = totalPt / Math.max(1, points.length)
  if (points.length < 2 || points.some((w) => Math.abs(w - even) > even * 0.02)) return widths
  const least = widths.map(() => 0)
  const most = widths.map(() => 0)
  for (const cell of table.cells) {
    if (cell.colSpan !== 1) continue
    const margins = ptFromHwp(cell.padding.left) + ptFromHwp(cell.padding.right)
    const { word, line } = contentWidths(cell.body)
    least[cell.col] = Math.max(least[cell.col]!, word + margins)
    most[cell.col] = Math.max(most[cell.col]!, line + margins)
  }
  const sumLeast = least.reduce((sum, w) => sum + w, 0)
  const sumMost = most.reduce((sum, w) => sum + w, 0)
  if (sumMost <= 0) return widths
  const shares =
    sumMost <= totalPt
      ? // everything fits on one line: the spare width is shared by line length
        most.map((w) => (w * totalPt) / sumMost)
      : sumLeast >= totalPt
        ? least.map((w) => (w * totalPt) / sumLeast)
        : most.map(
            (w, c) => least[c]! + ((w - least[c]!) * (totalPt - sumLeast)) / (sumMost - sumLeast),
          )
  // the widest column takes what rounding left over, so the table keeps its width
  const widest = shares.indexOf(Math.max(...shares))
  const others = shares.reduce(
    (sum, pt, c) => (c === widest ? sum : sum + ptFromHwp(hwpFromPt(pt))),
    0,
  )
  return shares.map((pt, c) => hwpFromPt(c === widest ? totalPt - others : pt))
}

/** a line of at most this many character widths is kept on one line */
const LABEL_EMS = 10

/** the widest word and the widest unwrapped paragraph of a cell, in points */
function contentWidths(story: readonly Block[]): { word: number; line: number } {
  let word = 0
  let line = 0
  for (const block of story) {
    if (block.kind === 'table') {
      // a table inside the cell needs the room it was given
      const inner = block.colWidths.reduce((sum, w) => sum + ptFromHwp(w), 0)
      word = Math.max(word, inner)
      line = Math.max(line, inner)
      continue
    }
    let current = 0
    let token = 0
    const endToken = () => {
      word = Math.max(word, token)
      token = 0
    }
    let size = 0
    const endLine = () => {
      endToken()
      line = Math.max(line, current)
      // a short line is a label: breaking it inside the column reads badly
      if (current <= LABEL_EMS * size) word = Math.max(word, current)
      current = 0
    }
    for (const inline of block.inlines) {
      if (inline.kind === 'picture') {
        endToken()
        const width = ptFromHwp(inline.picture.width)
        word = Math.max(word, width)
        current += width
        continue
      }
      if (inline.kind !== 'text') continue
      size = ptFromHwp(inline.chars.size) * (inline.chars.bold ? 1.05 : 1)
      for (const ch of inline.text) {
        if (ch === '\n') {
          endLine()
          continue
        }
        const advance = advanceOf(ch) * size
        current += advance
        if (ch === ' ' || ch === '\t') endToken()
        else token += advance
      }
    }
    endLine()
  }
  return { word, line }
}

/**
 * A character's advance as a share of the font size. A rough figure is enough:
 * the widths only decide how the columns share the table.
 */
function advanceOf(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  if (ch === ' ') return 0.5
  if (ch === '\t') return 2
  // Hangul, CJK, kana, full-width forms, enclosed and compatibility symbols
  if (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xff60) ||
    code >= 0x20000
  ) {
    return 1
  }
  if (code >= 0x41 && code <= 0x5a) return 0.68
  if (code >= 0x30 && code <= 0x39) return 0.56
  if (/[.,:;'"!|ilj()[\]{}·]/.test(ch)) return 0.32
  return 0.55
}
