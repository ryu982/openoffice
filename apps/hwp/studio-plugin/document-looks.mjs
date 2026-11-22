/**
 * The looks the AI gives a document, as data and pure functions: the lines of table cells,
 * the looks of a new table and of a title box, the fonts that stand in for a font this PC
 * lacks, and the names the page number settings go by. The plugin (agent-plugin.mjs) does
 * the edits; nothing here touches a document.
 *
 * Everything here is document content: the colours and widths are the same in the light
 * and the dark theme.
 */

/** The kinds of line a cell border takes, with the engine's line type of each. */
export const BORDER_LINES = { none: 0, solid: 1, dashed: 2, dotted: 3, double: 8 }

/** Hangul's border widths in millimetres; the engine takes the place in this list. */
export const BORDER_WIDTHS_MM = [
  0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0,
]

/** The width of a line nobody gave a width: Hangul's own thin line. */
export const DEFAULT_BORDER_MM = 0.12
/** A double line thinner than this is drawn as one line. */
const DEFAULT_DOUBLE_MM = 0.5

/**
 * Which edges of a block of cells a border rule means. `outer` is the outline of the
 * block, `inner` the lines between its cells, `all` both.
 */
export const BORDER_SIDES = [
  'all',
  'outer',
  'inner',
  'top',
  'bottom',
  'left',
  'right',
  'inner_horizontal',
  'inner_vertical',
]

const HEX = /^#[0-9a-fA-F]{6}$/

/** The place of the border width nearest to `mm` in Hangul's list. */
export function borderWidthIndex(mm) {
  let best = 0
  for (let index = 1; index < BORDER_WIDTHS_MM.length; index++) {
    if (Math.abs(BORDER_WIDTHS_MM[index] - mm) < Math.abs(BORDER_WIDTHS_MM[best] - mm)) {
      best = index
    }
  }
  return best
}

/**
 * One border rule, checked: `{ sides, line }` with the line as the engine takes it. Throws
 * an Error whose message says what is wrong with the rule.
 */
export function borderRuleOf(rule) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    throw new Error('each border needs sides and a line')
  }
  const sides = rule.sides ?? 'all'
  if (!BORDER_SIDES.includes(sides)) {
    throw new Error(`sides must be one of ${BORDER_SIDES.join(', ')}`)
  }
  const kind = rule.line ?? 'solid'
  if (!Object.hasOwn(BORDER_LINES, kind)) {
    throw new Error(`line must be one of ${Object.keys(BORDER_LINES).join(', ')}`)
  }
  let mm = kind === 'double' ? DEFAULT_DOUBLE_MM : DEFAULT_BORDER_MM
  if (rule.width !== undefined && rule.width !== null) {
    if (typeof rule.width !== 'number' || !(rule.width >= 0.1 && rule.width <= 5)) {
      throw new Error('width must be 0.1 to 5 millimetres')
    }
    mm = rule.width
  }
  let color = '#000000'
  if (rule.color !== undefined && rule.color !== null) {
    if (typeof rule.color !== 'string' || !HEX.test(rule.color)) {
      throw new Error('color must look like #RRGGBB')
    }
    color = rule.color.toLowerCase()
  }
  const type = BORDER_LINES[kind]
  return { sides, line: { type, width: type === 0 ? 0 : borderWidthIndex(mm), color } }
}

const EDGE_PROPS = {
  top: 'borderTop',
  bottom: 'borderBottom',
  left: 'borderLeft',
  right: 'borderRight',
}

/** Whether a rule for `sides` means an edge that is outer (or inner) and runs that way. */
function ruleMeans(sides, edge, outer) {
  if (sides === 'all') return true
  if (sides === 'outer') return outer
  if (sides === 'inner') return !outer
  if (outer) return sides === edge
  const horizontal = edge === 'top' || edge === 'bottom'
  return sides === (horizontal ? 'inner_horizontal' : 'inner_vertical')
}

/**
 * The border properties each cell of a block takes for the rules, in order (a later rule
 * goes over an earlier one). `grid` is the table's cells with their zero-based row, col and
 * spans; `rect` the block, zero-based and inclusive. A line between two cells of the block
 * is given to both, so the two never disagree. An edge of a merged cell that lies outside
 * the block is left as it is. Returns a Map from cell number to the properties to set.
 */
export function cellBorders(grid, rect, rules) {
  const out = new Map()
  for (const cell of grid) {
    const top = cell.row
    const left = cell.col
    const bottom = cell.row + cell.rowSpan - 1
    const right = cell.col + cell.colSpan - 1
    if (bottom < rect.top || top > rect.bottom || right < rect.left || left > rect.right) continue
    // each edge of the cell: on the outline of the block, between two of its cells, or outside it
    const edges = [
      ['top', top === rect.top ? 'outer' : top > rect.top ? 'inner' : null],
      ['bottom', bottom === rect.bottom ? 'outer' : bottom < rect.bottom ? 'inner' : null],
      ['left', left === rect.left ? 'outer' : left > rect.left ? 'inner' : null],
      ['right', right === rect.right ? 'outer' : right < rect.right ? 'inner' : null],
    ]
    const props = {}
    for (const rule of rules) {
      for (const [edge, where] of edges) {
        if (where && ruleMeans(rule.sides, edge, where === 'outer')) {
          props[EDGE_PROPS[edge]] = rule.line
        }
      }
    }
    if (Object.keys(props).length > 0) out.set(cell.cell, props)
  }
  return out
}

/** The looks a new table can be given, as the model names them. */
export const TABLE_LOOKS = ['grid', 'open', 'rows']

const solid = (sides, mm) => borderRuleOf({ sides, line: 'solid', width: mm })
const none = (sides) => borderRuleOf({ sides, line: 'none' })

/**
 * The border rules of a table look, as blocks: `{ header: boolean, rules }`, the header
 * block being the first row. `grid` is a thin line round every cell (what a new table has
 * anyway). `open` is the table of Korean reports: no line at the left and right edge, a
 * heavier line above and below, and a line under the header. `rows` has lines between the
 * rows only.
 */
export function tableLookBlocks(look, header) {
  if (look === 'open') {
    return [
      {
        header: false,
        rules: [
          solid('all', 0.12),
          none('left'),
          none('right'),
          solid('top', 0.5),
          solid('bottom', 0.5),
        ],
      },
      ...(header ? [{ header: true, rules: [solid('bottom', 0.3)] }] : []),
    ]
  }
  if (look === 'rows') {
    return [
      {
        header: false,
        rules: [
          none('all'),
          solid('inner_horizontal', 0.12),
          solid('top', 0.4),
          solid('bottom', 0.4),
        ],
      },
      ...(header ? [{ header: true, rules: [solid('bottom', 0.3)] }] : []),
    ]
  }
  return []
}

/**
 * Rows of a table's head: flagged as header, or with a line under them unlike the line under
 * the next row (a first row styled by hand, a head of two rows) while that next line still
 * lies between two rows. In a table of two rows, the first is a head when the line under it
 * is unlike the line over the table.
 */
export function headRowsOf(edges, flagged) {
  const rows = edges.length - 1
  const same = (one, other) =>
    one.every((line, col) => {
      const below = other[col]
      if (!line || !below) return true
      if (line.type === 0 || below.type === 0) return line.type === below.type
      return (
        line.type === below.type &&
        line.width === below.width &&
        String(line.color).toLowerCase() === String(below.color).toLowerCase()
      )
    })
  const drawnByHand = (head) =>
    head + 2 < rows
      ? !same(edges[head + 1], edges[head + 2])
      : rows === 2 && head === 0 && !same(edges[1], edges[0])
  let head = 0
  while (head < rows && (flagged[head] === true || drawnByHand(head))) head += 1
  return head
}

/** `edge` with each merged-cell gap (null) filled from the nearest column that has a line, else with `fallback`. */
function filledEdge(edge, fallback) {
  return edge.map((line, col) => {
    if (line) return line
    for (let step = 1; step < edge.length; step++) {
      const near = edge[col - step] ?? edge[col + step]
      if (near) return near
    }
    return fallback
  })
}

/** The thinnest drawn line of `lines` (border type 0 is no line); null when none is. */
function thinnestOf(lines) {
  let thin = null
  for (const line of lines) {
    if (line && line.type !== 0 && (!thin || line.width < thin.width)) thin = line
  }
  return thin
}

/**
 * The line new rows get when the table has none between two body rows. Never the outline:
 * forms draw it heavy, and it must not show up inside the table.
 */
function innerLineOf(edges, verticals) {
  const any = thinnestOf([...edges.flat(), ...verticals])
  return (
    thinnestOf(verticals) ??
    thinnestOf(edges.slice(1, -1).flat()) ??
    (any ? { ...any, type: 1 } : null)
  )
}

/**
 * The horizontal lines of a table once `count` rows were added at row `first` (zero-based,
 * the first new row). `edges` are the lines before: one list per edge from the top of the
 * table (0) to its bottom (one more than the rows), each a line per column (null where a
 * merged cell runs across the edge); `flagged` says which rows carry the header flag;
 * `verticals` are the lines between its columns. The outline stays with the edge of the
 * table and the lines of the head (headRowsOf) with the head; every line the new rows bring
 * is the line between the first two body rows, or, without two body rows, innerLineOf.
 * Null for a table of one row, or one that draws no line: the lines are then left as the
 * engine copied them.
 */
export function rowEdgesAfterAdding(edges, flagged, verticals, first, count) {
  const rows = edges.length - 1
  const between = headRowsOf(edges, flagged) + 1
  if (rows < 2) return null
  const fallback = innerLineOf(edges, verticals)
  if (!fallback) return null
  const inner =
    between < rows ? filledEdge(edges[between], fallback) : Array(edges[0].length).fill(fallback)
  const at = Math.min(first, rows - 1)
  return [...edges.slice(0, at + 1), ...Array(count).fill(inner), ...edges.slice(at + 1)]
}

/** The looks a title box can be given. */
export const TITLE_BOX_LOOKS = ['bands', 'lines', 'box', 'shaded']

/** Height of a colour band of a title box: 2 mm, in HWPUNIT. */
export const TITLE_BAND_HEIGHT = 567

/**
 * A title box as cells: `rows` of them, the title in cell `title`, and the properties of
 * each cell. `bands` has a thin band of colour above and below the title; `lines` a heavy
 * line above and below; `box` a line all round; `shaded` a fill behind the title.
 * `color` is the main colour and `color2` the second (the lower band, or the line of a
 * shaded box); both are #rrggbb.
 */
export function titleBoxCells(look, color, color2) {
  const off = { type: 0, width: 0, color: '#000000' }
  const noLines = { borderLeft: off, borderRight: off, borderTop: off, borderBottom: off }
  const line = (mm, of) => ({ type: 1, width: borderWidthIndex(mm), color: of })
  if (look === 'bands') {
    const band = (of) => ({
      ...noLines,
      fillType: 'solid',
      fillColor: of,
      patternType: -1,
      height: TITLE_BAND_HEIGHT,
    })
    return {
      rows: 3,
      title: 1,
      bands: [0, 2],
      cells: [band(color), { ...noLines, verticalAlign: 1 }, band(color2 ?? color)],
    }
  }
  if (look === 'lines') {
    return {
      rows: 1,
      title: 0,
      bands: [],
      cells: [
        {
          ...noLines,
          borderTop: line(1.0, color),
          borderBottom: line(1.0, color2 ?? color),
          verticalAlign: 1,
        },
      ],
    }
  }
  if (look === 'shaded') {
    return {
      rows: 1,
      title: 0,
      bands: [],
      cells: [
        {
          ...noLines,
          ...(color2 ? { borderTop: line(0.4, color2), borderBottom: line(0.4, color2) } : {}),
          fillType: 'solid',
          fillColor: color,
          patternType: -1,
          verticalAlign: 1,
        },
      ],
    }
  }
  const all = line(0.5, color)
  return {
    rows: 1,
    title: 0,
    bands: [],
    cells: [
      { borderLeft: all, borderRight: all, borderTop: all, borderBottom: all, verticalAlign: 1 },
    ],
  }
}

/** The colours a title box takes when none is given: the main one, by look. */
export const TITLE_BOX_COLORS = {
  bands: '#1f3864',
  lines: '#000000',
  box: '#000000',
  shaded: '#e7edf5',
}

/**
 * The fonts Korean documents are written in, for the list of which ones this PC has. The
 * first two come with Hancom Office only; 함초롬 can be installed on its own; the rest come
 * with an operating system or are free to install.
 */
export const DOCUMENT_FONTS = [
  'HY헤드라인M',
  '휴먼명조',
  '함초롬바탕',
  '함초롬돋움',
  '맑은 고딕',
  '바탕',
  '돋움',
  '굴림',
  '나눔고딕',
  '나눔명조',
  'Apple SD Gothic Neo',
  'AppleMyungjo',
  'Noto Sans CJK KR',
  'Noto Serif CJK KR',
]

/**
 * What stands in for a font this PC lacks, by the kind of face it is: a heavy headline
 * face, a serif (명조) text face, or a gothic one. A headline face has no free family of
 * its weight on every PC, so a gothic stands in for it in bold.
 */
const FONT_KINDS = [
  {
    test: /헤드라인|견고딕|headline/i,
    bold: true,
    stand: ['맑은 고딕', 'Apple SD Gothic Neo', '나눔고딕', 'Noto Sans CJK KR', 'Noto Sans KR'],
  },
  {
    test: /명조|바탕|궁서|myungjo|batang|serif/i,
    bold: false,
    stand: ['함초롬바탕', '바탕', '나눔명조', 'AppleMyungjo', 'Noto Serif CJK KR', 'Noto Serif KR'],
  },
  {
    test: /[\s\S]/,
    bold: false,
    stand: [
      '함초롬돋움',
      '맑은 고딕',
      '나눔고딕',
      'Apple SD Gothic Neo',
      'Noto Sans CJK KR',
      'Noto Sans KR',
    ],
  },
]

/**
 * The font to write instead of `name` when this PC is known not to have it: the first font
 * of the same kind that it does have, `{ font, bold }`. Null when the PC has `name`, when
 * what it has is not known (`onPc` answers undefined), or when it has none of the stand-ins:
 * the name is then written as asked. `onPc(name)` answers true, false or undefined.
 */
export function standInFont(name, onPc) {
  if (typeof name !== 'string' || !name.trim() || onPc(name) !== false) return null
  const kind = FONT_KINDS.find((candidate) => candidate.test.test(name))
  for (const font of kind.stand) {
    if (font !== name && onPc(font) === true) return { font, bold: kind.bold }
  }
  return null
}

/** Where a page number goes, as the model names it, with Hangul's position code (table 150). */
export const PAGE_NUMBER_PLACES = {
  none: 0,
  top_left: 1,
  top_center: 2,
  top_right: 3,
  bottom_left: 4,
  bottom_center: 5,
  bottom_right: 6,
  outside_top: 7,
  outside_bottom: 8,
  inside_top: 9,
  inside_bottom: 10,
}

/** The shapes of a page number both HWP and HWPX have (table 134). */
export const PAGE_NUMBER_SHAPES = {
  digit: 0,
  circledDigit: 1,
  upperRoman: 2,
  lowerRoman: 3,
  upperAlpha: 4,
  lowerAlpha: 5,
  hangulSyllable: 6,
  hanjaDigit: 7,
}

const nameOfCode = (table, code) => Object.keys(table).find((name) => table[name] === code) ?? null

/** A section's page number as the engine reports it, in the model's names; null for none. */
export function pageNumberOf(found) {
  if (!found || found.position === 0) return null
  return {
    position: nameOfCode(PAGE_NUMBER_PLACES, found.position) ?? 'bottom_center',
    format: nameOfCode(PAGE_NUMBER_SHAPES, found.format) ?? 'digit',
    dashes: found.dash === true,
  }
}

/** The marks a header or footer text may hold for the page number and the number of pages. */
export const HEADER_FIELD_TOKENS = { '{page}': 1, '{pages}': 2 }

/**
 * A header or footer text as the pieces to write in order: `{ text }` for words and
 * `{ field }` (the engine's field type) for a `{page}` or `{pages}` mark.
 */
export function headerPieces(text) {
  const pieces = []
  let rest = text
  while (rest.length > 0) {
    let at = -1
    let token = null
    for (const candidate of Object.keys(HEADER_FIELD_TOKENS)) {
      const index = rest.indexOf(candidate)
      if (index >= 0 && (at < 0 || index < at)) {
        at = index
        token = candidate
      }
    }
    if (token === null) {
      pieces.push({ text: rest })
      break
    }
    if (at > 0) pieces.push({ text: rest.slice(0, at) })
    pieces.push({ field: HEADER_FIELD_TOKENS[token] })
    rest = rest.slice(at + token.length)
  }
  return pieces
}

/** The letters Korean documents count with: 가, 나, 다, … */
const HANGUL_ORDER = '가나다라마바사아자차카타파하'

/** A day of a month as Korean documents write it: 12. */
const DAY = String.raw`(?:0?[1-9]|[12]\d|3[01])\.`
/** A month and a day as Korean documents write them: 11. 12. */
const MONTH_DAY = String.raw`(?:0?[1-9]|1[0-2])\.\s*${DAY}`
/** The marks a range of dates is written with: ~, ～, ∼ and -. */
const RANGE = '[~\uFF5E\u223C-]'
/** What follows a date and not a number: the weekday in brackets ((목)) or a time (09:00). */
const DATE_TAIL = String.raw`\([월화수목금토일](?:요일)?\)|\d{1,2}:\d{2}`

/**
 * A line that starts with a date as Korean documents write one: a month and a day followed
 * by the weekday in brackets (11. 12.(목)), by a time (11. 12. 09:00), by a range to another
 * month and day (11. 12.~11. 14., 11. 12.-11. 14.) or to a day that the weekday, a time or
 * the line's end follows (11. 12.~14.(토)), or by nothing (12. 25.). A number followed by a
 * reference to other parts (10. 1.~3.의, 6. 1.~3. 문항을, 1. 2.(가)를) is not a date.
 */
export const DATE_START = new RegExp(
  String.raw`^${MONTH_DAY.replace('\\s*', '\\s+')}\s*(?:${DATE_TAIL}|${RANGE}\s*(?:${MONTH_DAY}|${DAY}\s*(?:${DATE_TAIL}|$))|$)`,
)

/**
 * How the numbered levels of a Korean official document start, named by the first number of
 * each level (Ⅰ, 1., 가., 1), 가), (1), (가), ①), as the first characters of a paragraph tell
 * it, leading spaces aside. "1." is not the start of a decimal (1.5), of a year (2026.) or
 * of a date (DATE_START).
 */
export const NUMBERED_MARKS = {
  Ⅰ: /^(?:[Ⅰ-Ⅻ]+(?:[.\s]|$)|[IVX]{1,4}\.(?:\s|$))/,
  '1.': new RegExp(`^(?!${DATE_START.source.slice(1)})\\d{1,2}\\.(?!\\d)`),
  '가.': new RegExp(`^[${HANGUL_ORDER}]\\.(?:\\s|$)`),
  '1)': /^\d{1,2}\)/,
  '가)': new RegExp(`^[${HANGUL_ORDER}]\\)`),
  '(1)': /^\(\d{1,2}\)/,
  '(가)': new RegExp(`^\\([${HANGUL_ORDER}]\\)`),
  '①': /^[①-⑳]/,
}

/** The numbered level a paragraph starts with (a key of NUMBERED_MARKS), or null. */
export function numberedMarkOf(text) {
  const head = String(text ?? '').trimStart()
  for (const [name, mark] of Object.entries(NUMBERED_MARKS)) {
    if (mark.test(head)) return name
  }
  return null
}

/** A 가. line with no space after its mark (가.접수), which is not taken for the level. */
export const NUMBERED_WITHOUT_SPACE = { '가.': new RegExp(`^[${HANGUL_ORDER}]\\.(?=\\S)`) }

/** A cut line: dashes and spaces round a short text, six dashes or more (- - - 절취선 - - -). */
function isCutLine(line) {
  const text = line.trim()
  const dashes = (text.match(/-/g) ?? []).length
  const rest = [...text.replace(/[-\s]/g, '')].length
  return dashes >= 6 && rest <= 6 && text.startsWith('-') && text.endsWith('-')
}

/**
 * Why a rule that gives a style to the lines starting with `mark` leaves paragraph text
 * `head` (its leading spaces already removed) out although it starts so: a mark of one
 * character skips a line where the same character follows it with no space between
 * (`placeholder`: ○○ 사업) and a `cutLine`. Null when the line is not left out.
 */
export function markSkipOf(head, mark) {
  if (!head.startsWith(mark) || [...mark].length !== 1) return null
  if (head.slice(mark.length).startsWith(mark)) return 'placeholder'
  return isCutLine(head) ? 'cutLine' : null
}

/**
 * Whether a rule that gives a style to the lines starting with `mark` names paragraph text
 * `head` (its leading spaces already removed): it starts so and is not left out (markSkipOf).
 */
export function startsWithMark(head, mark) {
  return head.startsWith(mark) && markSkipOf(head, mark) === null
}

/** A mark at the start of a line that is not a numbered level: □, ○, -, ※ and the like. */
const SYMBOL_MARK = /^[^\p{L}\p{N}\s]{1,3}(?=\s)/u
/** A letter with a dot or a bracket as a mark: ㄱ. ㄴ. or a) b). */
const LETTER_MARK = /^\p{L}[.)](?=\s)/u

/**
 * How many characters of `text` come before the words its later lines hang under: the
 * leading spaces, the mark and the spaces after it; 0 when the line has no mark. `rule` says
 * what the mark is when a style rule named the line (`{ startsWith }` or `{ numbered }`);
 * without one, a numbered level, a symbol or a letter with a dot or bracket is taken.
 */
export function markLengthOf(text, rule = null) {
  const line = String(text ?? '')
  const head = line.trimStart()
  let mark = 0
  if (typeof rule?.startsWith === 'string') {
    mark = head.startsWith(rule.startsWith) ? rule.startsWith.length : 0
  } else {
    const patterns = rule?.numbered
      ? [NUMBERED_MARKS[rule.numbered]]
      : [...Object.values(NUMBERED_MARKS), SYMBOL_MARK, LETTER_MARK]
    for (const pattern of patterns) {
      const found = pattern.exec(head)
      if (found) {
        mark = found[0].length
        break
      }
    }
  }
  if (mark === 0) return 0
  const after = head.slice(mark)
  return line.length - head.length + mark + (after.length - after.trimStart().length)
}

/** Most columns a section's text is laid out in. */
export const MAX_COLUMNS = 4
/** The gap between columns when a call names none, and the widest one, in millimetres. */
export const DEFAULT_COLUMN_GAP_MM = 8
export const MAX_COLUMN_GAP_MM = 30
/** What a break starts in front of a paragraph. */
export const BREAK_KINDS = ['page', 'column']

/**
 * The sides a paragraph's border may be drawn on, by name: a box all round, a line under a
 * heading, a band at the left of a note, lines above and below. "none" takes the border away.
 */
export const PARAGRAPH_BORDER_SIDES = {
  box: ['borderLeft', 'borderRight', 'borderTop', 'borderBottom'],
  top: ['borderTop'],
  bottom: ['borderBottom'],
  left: ['borderLeft'],
  right: ['borderRight'],
  top_bottom: ['borderTop', 'borderBottom'],
  none: [],
}

/**
 * A paragraph border as the engine takes it: the line on the named sides and no line on
 * the others, so that a call says the whole border and leaves nothing of an earlier one.
 * `rule` is `{ sides, line, width, color }`: sides a key of PARAGRAPH_BORDER_SIDES
 * (default box), the rest as borderRuleOf reads a cell's line.
 */
export function paragraphBorderOf(rule) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    throw new Error('border must be an object: { sides, line, width, color }')
  }
  const sides = rule.sides ?? 'box'
  if (!Object.hasOwn(PARAGRAPH_BORDER_SIDES, sides)) {
    throw new Error(`border sides must be one of ${Object.keys(PARAGRAPH_BORDER_SIDES).join(', ')}`)
  }
  const { line } = borderRuleOf({ line: rule.line, width: rule.width, color: rule.color })
  const none = { type: BORDER_LINES.none, width: 0, color: '#000000' }
  const drawn =
    sides === 'none' || line.type === BORDER_LINES.none ? [] : PARAGRAPH_BORDER_SIDES[sides]
  const out = {}
  for (const side of PARAGRAPH_BORDER_SIDES.box) out[side] = drawn.includes(side) ? line : none
  return out
}

/** How wide a character may be set, and how far apart, in percent (Hangul's 장평 and 자간). */
export const CHAR_WIDTH_PERCENT = { min: 50, max: 200 }
export const LETTER_SPACING_PERCENT = { min: -50, max: 50 }
/** The share of the text width a new table may take, in percent. */
export const TABLE_WIDTH_PERCENT = { min: 15, max: 100 }
/** The height a table row may be given, in millimetres. */
export const ROW_HEIGHT_MM = { min: 3, max: 250 }

/** How bright a colour (#RRGGBB) is, from 0 (black) to 1 (white), as contrast is reckoned. */
function luminanceOf(hex) {
  const channel = (index) => {
    const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

/** The contrast of two colours (#RRGGBB): 1 for the same colour, 21 for black on white. */
export function contrastRatio(one, other) {
  const [light, dark] = [luminanceOf(one), luminanceOf(other)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

/** Below this contrast words cannot be told from what is behind them (white on a pale fill). */
export const MIN_TEXT_CONTRAST = 1.6

/** Black words on a fill they have less contrast with than this are hard to read. */
export const MIN_BLACK_ON_FILL = 3

/**
 * The colour words take on a fill (#RRGGBB) when the call names none that shows on it: white
 * where black and the colour they have (`current`, black when not known) would both be hard
 * to read, else null for the colour they have.
 */
export function textColorOnFill(fill, current) {
  const shows = (color) => contrastRatio(color, fill) >= MIN_BLACK_ON_FILL
  return shows('#000000') || (typeof current === 'string' && shows(current)) ? null : '#ffffff'
}

/** How text sits at a tab stop, and what fills the way to it, with the engine's codes. */
export const TAB_ALIGNS = { left: 0, right: 1, center: 2, decimal: 3 }
export const TAB_LEADERS = { none: 0, line: 1, dashes: 2, dots: 3 }
/** Tab stops one paragraph takes at most, and how far from the left edge one may stand, in mm. */
export const MAX_TABS = 8
export const MAX_TAB_MM = 400

/**
 * The tab stops of a paragraph, checked: each `{ atMm, align, leader }`. Without `atMm`
 * the stop stands at the right edge of the text, where a page number of a contents line or
 * a signature goes; its text is then right-aligned unless `align` says otherwise. The
 * result names each stop by its place in millimetres (null for the right edge) and the
 * engine's codes, sorted from the left.
 */
export function tabStopsOf(tabs) {
  if (!Array.isArray(tabs) || tabs.length > MAX_TABS) {
    throw new Error(`tabs must be a list of at most ${MAX_TABS} tab stops`)
  }
  const stops = tabs.map((tab) => {
    if (!tab || typeof tab !== 'object' || Array.isArray(tab)) {
      throw new Error('each tab stop is an object: { atMm, align, leader }')
    }
    const atEdge = tab.atMm === undefined || tab.atMm === null
    if (!atEdge && (typeof tab.atMm !== 'number' || !(tab.atMm > 0 && tab.atMm <= MAX_TAB_MM))) {
      throw new Error(
        `atMm of a tab stop must be more than 0 and at most ${MAX_TAB_MM} millimetres`,
      )
    }
    const align = tab.align ?? (atEdge ? 'right' : 'left')
    if (!Object.hasOwn(TAB_ALIGNS, align)) {
      throw new Error(`a tab's align must be one of ${Object.keys(TAB_ALIGNS).join(', ')}`)
    }
    const leader = tab.leader ?? 'none'
    if (!Object.hasOwn(TAB_LEADERS, leader)) {
      throw new Error(`a tab's leader must be one of ${Object.keys(TAB_LEADERS).join(', ')}`)
    }
    return { atMm: atEdge ? null : tab.atMm, type: TAB_ALIGNS[align], fill: TAB_LEADERS[leader] }
  })
  if (stops.filter((stop) => stop.atMm === null).length > 1) {
    throw new Error('only one tab stop stands at the right edge: give the others atMm')
  }
  return stops.sort((a, b) => (a.atMm ?? Infinity) - (b.atMm ?? Infinity))
}

/**
 * The diagonal of a table cell, as the engine takes it: "down" runs from the top left to
 * the bottom right (the corner cell of a timetable), "up" from the bottom left to the top
 * right, "both" crosses the cell out, "none" takes the line away.
 */
export const CELL_DIAGONALS = {
  none: { diagonalSlash: 0, diagonalBackSlash: 0 },
  down: { diagonalSlash: 0, diagonalBackSlash: 2 },
  up: { diagonalSlash: 2, diagonalBackSlash: 0 },
  both: { diagonalSlash: 2, diagonalBackSlash: 2 },
}
/** The line a diagonal is drawn with: thin, solid, black. */
export const CELL_DIAGONAL_LINE = { diagonalLine: 1, diagonalWidth: 1, diagonalColor: '#000000' }

/** Equations one call puts in at most, and the longest script of one. */
export const MAX_EQUATIONS = 60
export const MAX_EQUATION_SCRIPT = 1000
/** The width a picture may be given, in millimetres. */
export const PICTURE_WIDTH_MM = { min: 5, max: 400 }

/**
 * The look of a test paper (원안지) built from nothing, when no school form is open: B4
 * portrait in two columns with a line between them, 11 pt body text justified at 160 %,
 * and question lines that hang by the width of their number. The hwp-exam-paper skill
 * gives the model these numbers; its test holds the skill to them.
 */
export const EXAM_PAPER = {
  page: {
    paper: 'B4',
    widthMm: 257,
    heightMm: 364,
    marginLeft: 19,
    marginRight: 19,
    marginTop: 10,
    marginBottom: 10,
    marginHeader: 11,
    marginFooter: 10,
  },
  columns: { count: 2, gapMm: 8, line: 'solid' },
  body: { size: 11, align: 'justify', lineSpacing: 160 },
  /** The hanging indent of a question line, as wide as its number: 1.5 times the text size. */
  questionIndentPt: 16.5,
}

/** The width of one column of the test paper in millimetres. */
export function examColumnWidthMm() {
  const { page, columns } = EXAM_PAPER
  const text = page.widthMm - page.marginLeft - page.marginRight
  return (text - columns.gapMm * (columns.count - 1)) / columns.count
}

/**
 * Where the choices of a question stand when `perLine` of them share a line: the first at
 * the question's indent, each next one a share of the rest of the column further on. Tab
 * stops in millimetres from the column's left edge, one fewer than the choices.
 */
export function examChoiceStops(perLine) {
  const indentMm = (EXAM_PAPER.questionIndentPt * 25.4) / 72
  const share = (examColumnWidthMm() - indentMm) / perLine
  return Array.from(
    { length: perLine - 1 },
    (_, k) => Math.round((indentMm + share * (k + 1)) * 10) / 10,
  )
}
