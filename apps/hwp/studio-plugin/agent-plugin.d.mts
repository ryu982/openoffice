export declare const AGENT_PLUGIN_ID: 'ieum-agent'

import type { DocumentProfile } from '@genoffice/doc-rules'

/**
 * What the document is made of, for the format checks of `@genoffice/doc-rules`. The
 * editor does not know the file's extension, so the app fills `format` in.
 */
export type AgentDocumentProfile = Omit<DocumentProfile, 'format'>

/** One place a searched text occurs. */
export interface AgentMatch {
  /** 1-based position among all matches, in reading order */
  occurrence: number
  inTable: boolean
  /** the match with some text around it; absent when it could not be read */
  context?: string
  /** false for text inside an equation, which has no replace path */
  replaceable?: false
  /** the nearest paragraph in front that does not hold the match (its heading, often), cut short */
  before?: string
}

export interface AgentFindResult {
  count: number
  /** the first matches only; `count` is the real total */
  matches: AgentMatch[]
}

/**
 * Where a change is, for the editor to show: the paragraph (for a cell, the body paragraph
 * its table sits in and the path to the cell paragraph), and a run of characters in it.
 */
export interface AgentPlace {
  sec: number
  para: number
  path?: { controlIndex: number; cellIndex: number; cellParaIndex: number }[]
  offset: number
  length: number
}

export type AgentReplaceResult =
  | { ok: true; count: number; inTable: boolean; place: AgentPlace }
  | {
      ok: false
      /**
       * `spans_object`: an object of the line (an equation, a footnote mark, a picture set
       * as a character) stands between two characters of the match
       */
      reason:
        'not_found' | 'ambiguous' | 'no_such_occurrence' | 'unsupported_place' | 'spans_object'
      count: number
      matches?: AgentMatch[]
    }

export type AgentReplaceAllResult =
  /** `skipped`: matches left as they were, each across an object of its line */
  | { ok: true; count: number; skipped?: number; place: AgentPlace }
  | { ok: false; reason: 'not_found'; count: 0 }
  /** every match lies across an object of its line; `count` is how many */
  | { ok: false; reason: 'spans_object'; count: number }

/** Why a paragraph edit did nothing: the anchor could not be decided, or an object is in the way. */
export interface AgentPlaceRefusal {
  ok: false
  reason: 'not_found' | 'ambiguous' | 'no_such_occurrence' | 'unsupported_place' | 'has_objects'
  count: number
  matches?: AgentMatch[]
}

/** Where a paragraph edit goes relative to the anchor paragraph; "end" is the end of the document. */
export type AgentWhere = 'after' | 'before' | 'end'

export type AgentInsertResult =
  { ok: true; count: number; inTable: boolean; place: AgentPlace } | AgentPlaceRefusal

export type AgentDeleteResult =
  | {
      ok: true
      /** the removed text, cut to a few hundred characters */
      text: string
      /** the paragraph kept its place as an empty line (the first of its cell or section) */
      emptied: boolean
      inTable: boolean
      place: AgentPlace
    }
  | AgentPlaceRefusal
  /** the paragraph's whole text is one of `protectTexts`: nothing was removed */
  | { ok: false; reason: 'protected'; count: number; text: string }

/** A font this PC lacks and the font of the same kind written in its place. */
export interface AgentStandInFont {
  asked: string
  used: string
}

/** A line of a table cell: its kind, its width in millimetres and its colour. */
export interface AgentBorderRule {
  /** which edges of the block: default all */
  sides?:
    | 'all'
    | 'outer'
    | 'inner'
    | 'top'
    | 'bottom'
    | 'left'
    | 'right'
    | 'inner_horizontal'
    | 'inner_vertical'
  /** default solid; none takes the line away */
  line?: 'none' | 'solid' | 'dashed' | 'dotted' | 'double'
  /** 0.1 to 5 mm; default 0.12, for a double line 0.5 */
  width?: number
  /** #RRGGBB; default black */
  color?: string
}

/** How cells are to look; what is left out stays as it is. */
export interface AgentCellLook {
  /** #RRGGBB, or "none" to take the fill away */
  background?: string
  /** the height of the rows of the cells, in millimetres */
  heightMm?: number
  /** a line across each cell: down from the top left, up from the bottom left, both, or none */
  diagonal?: 'down' | 'up' | 'both' | 'none'
  /** the format of the text in the cells: bold, size, font, colour, align and the like */
  text?: AgentStyleFormat | null
  /** in order: a later rule goes over an earlier one */
  borders?: AgentBorderRule[]
  verticalAlign?: 'top' | 'middle' | 'bottom'
  /** the share of the table's width each column takes, one positive number per column */
  columnWidths?: number[]
}

/** A block of cells from its top left to its bottom right corner, rows and columns from 1. */
export interface AgentCellBlock {
  fromRow: number
  fromCol: number
  toRow: number
  toCol: number
}

/** How a new table is to look. */
export interface AgentTableLook {
  /** the first row names the columns */
  header?: boolean
  /** grid: a line round every cell (default); open: no line at the sides, heavier above and below; rows: lines between rows only */
  look?: 'grid' | 'open' | 'rows'
  /** fill of the header row, #RRGGBB or "none"; default light grey */
  headerColor?: string
  /** the columns' shares of the width, one positive number for each column */
  columnWidths?: number[]
  /** alignment of the body cells: one for all, or one for each column */
  align?: 'left' | 'center' | 'right' | ('left' | 'center' | 'right')[]
  /** font size of the table's text in points; default that of the paragraph beside it */
  size?: number
  /** font of the table's text; default that of the paragraph beside it */
  font?: string
  /** where the text runs in columns: as wide as the page, laid across them; only as the head of the document, before its first paragraph */
  acrossColumns?: boolean
  /** the share of the text width the table takes, in percent; default all of it */
  widthPercent?: number
  /** where a table narrower than the text stands */
  place?: 'left' | 'center' | 'right'
  /** the header row is repeated at the top of every page the table runs over */
  repeatHeader?: boolean
}

/** A paragraph style a styleParagraphs call makes, or changes when the document has it. */
export interface AgentBatchStyle {
  name: string
  /** the style whose look it starts from when it is made; 바탕글 when not given */
  basedOn?: string | null
  format?: AgentStyleFormat | null
  /** its paragraphs stay on the page of the one after them (a heading is not left behind) */
  keepWithNext?: boolean | null
}

/** The numbered levels of a Korean official document, named by the first number of each. */
export type AgentNumberedMark = 'Ⅰ' | '1.' | '가.' | '1)' | '가)' | '(1)' | '(가)' | '①'

/** Which paragraphs take a style: those that start so, or the one that contains the text. */
export interface AgentStyleRule {
  style: string
  /** every body paragraph that starts with this, leading spaces aside */
  startsWith?: string | null
  /** every body paragraph numbered at this level: "1." is every 1. 2. 3. … paragraph */
  numbered?: AgentNumberedMark | null
  /** text one paragraph contains (a table cell too) */
  find?: string | null
  occurrence?: number | null
}

export interface AgentStyleBatch {
  styles?: AgentBatchStyle[] | null
  apply?: AgentStyleRule[] | null
}

export type AgentStyleParagraphsResult =
  | {
      ok: true
      /** styles made and styles changed */
      made: number
      changed: number
      /** paragraphs given a style */
      paragraphs: number
      /** how many paragraphs each rule gave its style to, in the order of the rules */
      rules: { style: string; paragraphs: number }[]
      place?: AgentPlace
      keptOwnLook?: number
      standIn?: AgentStandInFont[]
    }
  | { ok: false; reason: 'style_exists' }
  | AgentNoSuchStyle
  | {
      ok: false
      reason: 'not_found' | 'ambiguous' | 'no_such_occurrence' | 'unsupported_place'
      /** the text of the rule that could not be placed */
      find: string
      count: number
      matches?: AgentMatch[]
    }
  | { ok: false; reason: 'too_many'; limit: number }
  | { ok: false; reason: 'has_objects'; count: number }
  | AgentMemoRemovalRefusal

/** How a title box is to look. */
export interface AgentTitleBox {
  /** bands: colour bands above and below (default); lines: heavy lines above and below; box: a line all round; shaded: a fill */
  look?: 'bands' | 'lines' | 'box' | 'shaded'
  /** the main colour, #RRGGBB */
  color?: string
  /** the second colour: the lower band or line, or the lines of a shaded box */
  color2?: string
  /** the title's look, over the one it has now */
  font?: string
  size?: number
  bold?: boolean
  textColor?: string
}

export type AgentTitleBoxResult =
  | {
      ok: true
      look: string
      /** the rows of the box: the title's and any bands */
      rows: number
      place: AgentPlace
      /** the box's number, as listTables numbers tables, and how many tables there are now */
      table?: number
      tables?: number
      /** the text colour asked for could not be told from what is behind the title, and was left out */
      textColorDropped?: boolean
      /** the colour the title was given to show on a dark fill, when the call named none */
      textColor?: string
      standIn?: AgentStandInFont[]
    }
  | AgentPlaceRefusal
  /** the title is inside a table cell, where a box cannot be made: `table` is its number */
  | { ok: false; reason: 'in_table'; count: number; table?: number }
  /** the title runs in columns set part way through its section and is not laid out yet */
  | { ok: false; reason: 'columns_unknown'; count: number }
  /** the paragraph is numbered or bulleted: the number would stay on its own line */
  | { ok: false; reason: 'numbered'; count: number }

/** Which fonts Korean documents use this PC has and lacks; both are empty when that is not known. */
export interface AgentDocumentFonts {
  known: boolean
  onPc: string[]
  missing: string[]
}

/** The page number of a document: where it is, its shape and whether it has dashes. */
export interface AgentPageNumber {
  position:
    | 'top_left'
    | 'top_center'
    | 'top_right'
    | 'bottom_left'
    | 'bottom_center'
    | 'bottom_right'
    | 'outside_top'
    | 'outside_bottom'
    | 'inside_top'
    | 'inside_bottom'
  format:
    | 'digit'
    | 'circledDigit'
    | 'upperRoman'
    | 'lowerRoman'
    | 'upperAlpha'
    | 'lowerAlpha'
    | 'hangulSyllable'
    | 'hanjaDigit'
  dashes: boolean
}

export interface AgentPageNumberChange {
  position: AgentPageNumber['position'] | 'none'
  format?: AgentPageNumber['format'] | null
  dashes?: boolean | null
}

/** A header or footer as the model reads it. */
export type AgentHeaderFooterState =
  | { exists: false }
  /**
   * plain: one line of text and fields, which setHeaderFooter may rewrite. Its text has the
   * page fields as {page} and {pages}; align and size are told for a plain one, align only
   * when it is one setHeaderFooter writes.
   */
  | {
      exists: true
      text: string
      plain: boolean
      align?: 'left' | 'center' | 'right'
      size?: number
    }

export interface AgentPageLayout {
  sections: number
  pages: number
  /** the line drawn round every page; null when there is none */
  pageBorder: { line: string; color: string } | null
  /**
   * the columns the text of the first section starts in; `line` the line between them when
   * there is one; `changesWithin` when a later part of the document sets other columns
   */
  columns: { count: number; gapMm: number; line?: AgentColumnLineDrawn; changesWithin?: true }
  pageNumber: AgentPageNumber | null
  header: AgentHeaderFooterState
  footer: AgentHeaderFooterState
  map: AgentPageMap
}

/**
 * The first or last paragraph of a page by its first words on that page (`continues`: it
 * began on the page before), or a table with no text beside it.
 */
export type AgentPageEnd = { text: string; continues?: true } | { table: number }

/** One page of the page map; `pastFoot` counts lines of body text below its text area. */
export type AgentMapPage =
  | { page: number; empty: true }
  | { page: number; first: AgentPageEnd; last: AgentPageEnd; pastFoot?: number }

/** Where the body falls on the pages, as print lays them out; tables as listTables numbers them. */
export interface AgentPageMap {
  pages: AgentMapPage[]
  /**
   * A caption (a `<표 n>` start or the caption style) before a table, an outline heading, or
   * a line kept with the next one, that ends a page (or a column) apart from what follows it,
   * empty paragraphs (or ones of spaces only) between them aside. `kept`: it keeps with the
   * next line, which Hangul honours in print and the engine's layout does not. `apart`: the
   * empty paragraph right after it is drawn on its page (or column), so it keeps with that
   * empty line at most and stays alone in Hangul too. When that empty line is drawn on the
   * next page, Hangul takes a kept line along with it.
   */
  alone: {
    page: number
    column?: number
    kind: 'heading' | 'caption' | 'line'
    text: string
    /** the name of its paragraph style, '' when it cannot be read */
    style: string
    /** the page the paragraph after it starts on */
    nextPage: number
    kept?: true
    apart?: true
  }[]
  /** tables drawn over more than one page, from page to page */
  spans: { table: number; from: number; to: number }[]
  past: AgentTablePastFoot[]
}

/**
 * A table drawn below the foot of a page's text area from `row` on, cut off in print;
 * `taller` when it is higher than the text area, so it cannot fit any page whole.
 */
export interface AgentTablePastFoot {
  table: number
  page: number
  row: number
  taller?: true
}

/** The lines setColumns draws between columns. */
export type AgentColumnLine = 'solid' | 'dashed' | 'dotted'

/** Every line a document may have between its columns. */
export type AgentColumnLineDrawn =
  AgentColumnLine | 'dash-dot' | 'dash-dot-dot' | 'long-dash' | 'circles'

export type AgentColumnsResult =
  /**
   * `wide`: the tables, as listTables numbers them, wider than a column now; absent when none is.
   * `line`: the line asked for, when one was; or, with `lineKept`, the line that was
   * there and stays because none was asked for
   */
  | {
      ok: true
      count: number
      gapMm: number
      was: number
      sections: number
      wide?: number[]
      line?: AgentColumnLineDrawn | 'none'
      lineKept?: true
    }
  | AgentMemoRemovalRefusal

/** The line round every page: as a cell's border line is told; line "none" takes it away. */
export interface AgentPageBorder {
  line: 'none' | 'solid' | 'dashed' | 'dotted' | 'double'
  width?: number
  color?: string
}

export type AgentPageBorderResult =
  { ok: true; sections: number; drawn: boolean } | AgentMemoRemovalRefusal

/** One equation to put in: where (text of the document) and its script. */
export interface AgentEquation {
  find: string
  occurrence?: number | null
  /** the equation in the script of Hangul's equation editor, one line */
  script: string
  /** default true: the equation takes the place of `find`; false puts it right after */
  replace?: boolean
}

export type AgentEquationsResult =
  | { ok: true; count: number; place: AgentPlace; marks: AgentPlace[] }
  /** `index` is the item (from 0) that could not be placed; nothing was changed */
  | {
      ok: false
      reason: 'not_found' | 'ambiguous' | 'no_such_occurrence' | 'unsupported_place' | 'in_table'
      index: number
      find: string
      count: number
      matches?: AgentMatch[]
    }
  | { ok: false; reason: 'has_objects'; count: number }
  | AgentMemoRemovalRefusal

export type AgentPictureResizeResult =
  /** fitted: the width asked for was more than the text is wide, so the text's width was used */
  | { ok: true; widthMm: number; heightMm: number; fitted: boolean; place: AgentPlace }
  /** unsupported_place: the picture is inside a table cell */
  | { ok: false; reason: 'no_such_picture' | 'unsupported_place'; count: number }
  | AgentMemoRemovalRefusal

export type AgentBreakKind = 'page' | 'column'

export type AgentBreakResult =
  | { ok: true; kind: AgentBreakKind; columns: number; place: AgentPlace }
  /** the paragraph carried a break that covers the one asked for: nothing was changed */
  | { ok: true; kind: AgentBreakKind; already: AgentBreakKind }
  | AgentPlaceRefusal
  /**
   * the paragraph is inside a table cell, is the first one of the document, starts a part
   * of the document with other columns (a break would take that start away), or holds a
   * mark of its place (a page number that starts anew, a hidden page number, a bookmark)
   * that a break would leave on the page before
   */
  | { ok: false; reason: 'in_table' | 'at_start' | 'layout_start' | 'holds_mark'; count: number }
  | AgentMemoRemovalRefusal

export type AgentPageNumberResult =
  { ok: true; sections: number; pageNumber: AgentPageNumber | null } | AgentMemoRemovalRefusal

export interface AgentHeaderFooterChange {
  /** one line; {page} is the page number and {pages} the number of pages; empty removes it */
  text: string
  /** left out, a line that is there keeps its alignment and a new one is centred */
  align?: 'left' | 'center' | 'right' | null
  /** font size in points */
  size?: number | null
}

export type AgentHeaderFooterResult =
  | { ok: true; kind: 'header' | 'footer'; removed: boolean; text?: string }
  /** it holds more than a line of text and fields: laid out by hand, left alone */
  | { ok: false; reason: 'not_plain' }
  /** nothing to remove */
  | { ok: false; reason: 'not_there' }
  | AgentMemoRemovalRefusal

export type AgentTableResult =
  | {
      ok: true
      rows: number
      cols: number
      inTable: boolean
      place: AgentPlace
      /** the new table's number, as listTables numbers tables, and how many there are now; absent in a cell */
      table?: number
      tables?: number
      /** the table lies across the columns of its page */
      acrossColumns?: boolean
      /** the colour the words of the header row were given to show on its fill, when the fill is dark */
      headerTextColor?: string
      standIn?: AgentStandInFont[]
    }
  | AgentPlaceRefusal
  /** the anchor is inside a table cell, where a table cannot be made */
  | { ok: false; reason: 'in_table'; count: number }
  /** a table across the columns goes before the first paragraph of the document only */
  | { ok: false; reason: 'not_at_start'; count: number }
  /**
   * the place runs in columns set part way through its section and is not laid out yet, so
   * their width is not known
   */
  | { ok: false; reason: 'columns_unknown'; count: number }

/** A picture put into the document: where it now sits. */
export type AgentPictureResult =
  { ok: true; inTable: boolean; place: AgentPlace } | AgentPlaceRefusal

/** Character formatting to change; what is left out stays as it is. */
/** A paragraph's border: on which sides, and the line. */
export interface AgentParagraphBorder {
  /** default box: all four sides. top_bottom: lines above and below; none takes the border away */
  sides?: 'box' | 'top' | 'bottom' | 'left' | 'right' | 'top_bottom' | 'none'
  line?: 'none' | 'solid' | 'dashed' | 'dotted' | 'double'
  /** line width in mm */
  width?: number
  /** #RRGGBB */
  color?: string
}

export interface AgentTextFormat {
  /** the width of the characters in percent of their own (Hangul's 장평) */
  charWidth?: number
  /** the space between characters in percent, negative brings them together (Hangul's 자간) */
  letterSpacing?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  /** font size in points */
  size?: number
  /** text colour, #RRGGBB */
  color?: string
  /** highlight colour, #RRGGBB, or "none" to take it away */
  highlight?: string
  /** font name; one the document lacks is added to its fonts */
  font?: string
  /** a character style of the document, by its name (listStyles); set before the rest */
  charStyle?: string
}

/** Formatting of a whole paragraph: its own properties, and character formatting for all its text. */
/** One tab stop of a paragraph. */
export interface AgentTabStop {
  /** millimetres from the left edge of the text; left out: the right edge of the text */
  atMm?: number | null
  /** how the text after the tab sits at the stop; default right at the right edge, else left */
  align?: 'left' | 'right' | 'center' | 'decimal'
  /** what fills the way to the stop; default none */
  leader?: 'none' | 'dots' | 'dashes' | 'line'
}

export interface AgentParagraphFormat extends AgentTextFormat {
  /** the tab stops of the paragraph, replacing the ones it has */
  tabs?: AgentTabStop[]
  /** a border round the paragraph or on some of its sides; neighbours with the same one make one box */
  border?: AgentParagraphBorder
  /** the colour behind the paragraph, #RRGGBB, or "none" */
  background?: string
  align?: 'left' | 'center' | 'right' | 'justify'
  /** line spacing in percent of the font height */
  lineSpacing?: number
  /** indent in points: positive sets the first line further in; negative is Hangul's hanging indent (the first line stays at marginLeft, the lines after it start that much further in) */
  indent?: number
  /** left and right margins of the paragraph, in points */
  marginLeft?: number
  marginRight?: number
  /** space above and below the paragraph, in points */
  spacingBefore?: number
  spacingAfter?: number
  /** a paragraph style of the document, by its name (listStyles) */
  style?: string
  /** a numbered or bulleted paragraph (the editor's number and bullet buttons), or none */
  list?: 'number' | 'bullet' | 'none'
  /** the level of a list paragraph, 1 to 7 */
  listLevel?: number
  /** the bullet character of a bulleted paragraph; default ● */
  bullet?: string
}

export interface AgentWholeParagraphFormat extends AgentParagraphFormat {
  /** put the character formatting on every word even where words of a paragraph differ in it; otherwise such a call is refused (words_set_apart) */
  everyWord?: boolean
}

/** Some words of the paragraphs differ from the rest in character properties the call would put on every word. */
export interface AgentWordsSetApart {
  ok: false
  reason: 'words_set_apart'
  /** those properties, in the names of the format */
  properties: string[]
  paragraphs: number
}

/** A call named a style the document does not have; `styles` are the ones of that kind it has. */
export interface AgentNoSuchStyle {
  ok: false
  reason: 'no_such_style'
  /** the kind of style that was looked for; any: a style of either kind */
  kind: 'paragraph' | 'character' | 'any'
  styles: string[]
}

/** The styles of the document by name. */
export interface AgentStyleNames {
  paragraph: string[]
  character: string[]
}

export type AgentStyleKind = 'paragraph' | 'character'

/** What a style looks like, in the units the format calls take; paragraph properties for a paragraph style only. */
export interface AgentStyleLook {
  font: string
  size: number
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  color: string
  align?: string
  lineSpacing?: number
  indent?: number
  marginLeft?: number
  marginRight?: number
  spacingBefore?: number
  spacingAfter?: number
}

export type AgentReadStyleResult =
  | {
      ok: true
      name: string
      /** left out when the style has none */
      englishName?: string
      kind: AgentStyleKind
      /** the paragraph style that follows a paragraph of this one (paragraph styles) */
      nextStyle?: string
      look: AgentStyleLook
    }
  | AgentNoSuchStyle

/** The look of a style: formatting without styles. */
export type AgentStyleFormat = Omit<AgentParagraphFormat, 'style' | 'charStyle'>

export interface AgentNewStyle {
  name: string
  englishName?: string | null
  /** paragraph when not given */
  kind?: AgentStyleKind | null
  /** the style whose look it starts from; 바탕글 when not given */
  basedOn?: string | null
  /** the paragraph style that follows; the new style itself when not given */
  nextStyle?: string | null
  format?: AgentStyleFormat | null
}

export interface AgentStyleChanges {
  /** a new name */
  name?: string | null
  englishName?: string | null
  nextStyle?: string | null
  format?: AgentStyleFormat | null
}

export type AgentStyleResult =
  | { ok: true; name: string; kind: AgentStyleKind }
  /** another style already has the name */
  | { ok: false; reason: 'style_exists' }
  | AgentNoSuchStyle

/** A place in a table, rows and columns from 1. */
export interface AgentCellPlace {
  row: number
  col: number
}

export type AgentMergeCellsResult =
  | { ok: true; merged: number; place: AgentPlace }
  | { ok: false; reason: 'no_such_table'; count: number }
  | { ok: false; reason: 'unsupported_place' }
  | { ok: false; reason: 'no_such_cell'; rows: number; cols: number }
  | { ok: false; reason: 'crosses_merged' | 'named_cells'; cells: AgentCellPlace[] }

export type AgentSplitCellResult =
  | { ok: true; unmerged: boolean; place: AgentPlace }
  | { ok: false; reason: 'no_such_table'; count: number }
  | { ok: false; reason: 'unsupported_place' | 'not_merged' | 'holds_object' }
  | { ok: false; reason: 'no_such_cell'; rows: number; cols: number }

export type AgentFormatCellsResult =
  | {
      ok: true
      count: number
      place: AgentPlace
      standIn?: AgentStandInFont[]
      /** cells (rows and columns from 1) whose text the diagonal that was drawn runs through */
      crossed?: { row: number; col: number }[]
      /** the widths of the columns now, in millimetres, when columnWidths was given */
      columnWidthsMm?: number[]
      /**
       * rows (from 1) of a head across the columns whose text needs more than the height
       * set: the text runs past the row, and the other columns start over the head
       */
      overflowingRows?: number[]
    }
  | { ok: false; reason: 'no_such_table'; count: number }
  /** columnWidths does not give one number for each of the `cols` columns */
  | { ok: false; reason: 'column_count'; cols: number }
  /** a column is covered only by merged cells, so its width cannot be read */
  | { ok: false; reason: 'merged_columns'; cols: number }
  | { ok: false; reason: 'unsupported_place'; count: number }
  | {
      ok: false
      reason: 'no_such_cell'
      cells: { row: number; col: number }[]
      rows: number
      cols: number
    }

export type AgentFormatTextResult =
  | { ok: true; count: number; place: AgentPlace }
  | {
      ok: false
      reason: 'not_found' | 'ambiguous' | 'no_such_occurrence' | 'unsupported_place' | 'has_objects'
      count: number
      matches?: AgentMatch[]
    }
  | AgentNoSuchStyle

/** What replaceFont changed: runs of text, and paragraphs holding at least one. */
export interface AgentReplaceFontResult {
  ok: true
  ranges: number
  paragraphs: number
  /** the cap stopped it: some text still uses the old font */
  truncated?: true
}

export type AgentFormatParagraphResult =
  | {
      ok: true
      inTable: boolean
      place: AgentPlace
      /** 1 when the paragraph took the style's name but kept its own look (as in formatSelection) */
      keptOwnLook?: number
    }
  | AgentPlaceRefusal
  | AgentNoSuchStyle
  | AgentWordsSetApart

/** A table cell whose text does not fit where it is drawn, as checkLayout lists it. */
export interface AgentLayoutOverflow {
  /** the table, as listTables numbers tables */
  table: number
  /** 1-based row and column of the cell */
  row: number
  col: number
  /** 1-based page the cut-off text is on */
  page: number
  /** how far the text runs past the cell's bottom edge, in mm */
  over: number
  /** the cell's text, cut short */
  text: string
}

/** A cut-off cell as cutCells lists it: its table, as listTables numbers them, row and column. */
export type AgentCutCell = Pick<AgentLayoutOverflow, 'table' | 'row' | 'col'>

/**
 * A row of a table across the columns at the head of the document that a change left
 * taller than its text needs (it needed more before): it keeps its height. Any change's
 * answer may carry them as `tallerRows`.
 */
export interface AgentTallerRow {
  table: number
  row: number
  heightMm: number
  needsMm: number
}

/** A place in the tables to measure from: 1-based table (as listTables) and row. */
export interface AgentLayoutPlace {
  table: number
  row: number
}

export interface AgentLayoutCheck {
  /** tables in the document, as listTables numbers them */
  tables: number
  /** where this call started */
  from: AgentLayoutPlace
  /** the cells from `from` up to `next` (or the end) whose text does not fit */
  cells: AgentLayoutOverflow[]
  /** the cells a line of which starts inside a word, such as a broken address or date */
  wrapped: Omit<AgentLayoutOverflow, 'over'>[]
  /** the tables from `from` on drawn below the foot of a page */
  past: AgentTablePastFoot[]
  /** cells this call measured */
  measured: number
  /** where the next call goes on; absent when the last table was measured */
  next?: AgentLayoutPlace
  /** the document is large: tables inside cells may be missing from the end of the list */
  partial?: boolean
}

/** One table of the document, as listTables lists it. */
export interface AgentTableSummary {
  /** 1-based position among all tables in reading order; what readTable and fillCells take */
  table: number
  rows: number
  cols: number
  /** the number of the table whose cell this one sits in; absent for a table of the body */
  inTable?: number
  /** the line of text the table follows, cut short; empty when there is none close by */
  near: string
  /** the text of its first cells that hold any, each cut short */
  preview: string[]
}

export interface AgentTableList {
  /** all tables found; `tables` holds the first ones only */
  count: number
  /** the search for tables inside table cells ran out of budget: some may be missing */
  partial: boolean
  tables: AgentTableSummary[]
}

/** One cell of a table. A merged cell is listed once, at its first row and column. */
export interface AgentTableCell {
  /** 1-based */
  row: number
  col: number
  rowSpan?: number
  colSpan?: number
  /** the paragraphs of the cell joined by line breaks, cut when long */
  text: string
  /** numbers (as in listFields) of the click-here fields that sit in the cell */
  fields?: number[]
  /** the box its paragraph is bulleted with (a form's □ choice box), when it is unchecked */
  box?: string
  /** a picture, a shape or a table sits in the cell or floats over it: not empty, whatever its text */
  object?: true
}

export type AgentReadTableResult =
  | {
      ok: true
      table: number
      rows: number
      cols: number
      cells: AgentTableCell[]
      /** the table goes on: the row to read from next */
      nextRow?: number
    }
  | { ok: false; reason: 'no_such_table'; count: number }

/** Text for one cell: 1-based place, and the text (a line break starts a new paragraph). */
export interface AgentCellText {
  row: number
  col: number
  text: string
}

export type AgentFillCellsResult =
  | { ok: true; table: number; count: number; place: AgentPlace }
  | { ok: false; reason: 'no_such_table'; count: number }
  | {
      ok: false
      /**
       * no_such_cell: the places are outside the table. occupied: the cells hold text and
       * overwrite was not given. has_fields: the cells hold several form fields each.
       * holds_object: the cells hold a picture or another object.
       */
      reason: 'no_such_cell' | 'occupied' | 'has_fields' | 'holds_object'
      cells: { row: number; col: number; text?: string; fields?: number[] }[]
      rows: number
      cols: number
    }
  /** the change would have removed an object of the document, and was rolled back */
  | { ok: false; reason: 'has_objects'; count: number }

/** One cell whose choice box is to be ticked: 1-based place, and the words beside it when needed. */
export interface AgentCheckBox {
  row: number
  col: number
  /** the words beside the box, when the cell has more than one */
  choice?: string
}

export type AgentCheckBoxesResult =
  | { ok: true; table: number; count: number; place: AgentPlace }
  | { ok: false; reason: 'no_such_table'; count: number }
  | {
      ok: false
      /**
       * no_such_cell: the places are outside the table. no_box: no tick box was found (it
       * may be a picture or a form control, which this editor cannot tick).
       * ambiguous_box: the cell has more than one box and choice named none of them.
       */
      reason: 'no_such_cell' | 'no_box' | 'ambiguous_box'
      cells: { row: number; col: number; choices?: string[] }[]
      rows: number
      cols: number
    }
  /** the change would have removed an object of the document, and was rolled back */
  | { ok: false; reason: 'has_objects'; count: number }

export interface AgentField {
  /** 1-based position in the document; what fillField takes */
  field: number
  /** not unique: a field nobody named carries its guide text */
  name: string
  guide: string
  value: string
  /** a named table cell rather than a click-here field */
  inCell: boolean
}

export type AgentFillResult =
  | { ok: true; name: string; place?: AgentPlace }
  | { ok: false; reason: 'no_such_field'; count: number }

/** One run of a selection: the text selected in one paragraph, and where it is. */
export interface AgentSegment extends AgentPlace {
  text: string
}

export type AgentSelectionResult =
  | {
      ok: true
      inTable: boolean
      /**
       * the runs are the paragraphs of one stretch (the body, or one cell), so the selection
       * can be rewritten into more or fewer paragraphs; false for table cells and the like
       */
      contiguous: boolean
      /** the plugin made this selection itself when it showed a change; the user did not */
      own: boolean
      /** one run per paragraph touched, in reading order */
      segments: AgentSegment[]
    }
  | {
      ok: false
      /**
       * none: nothing is selected. unsupported: the selection is at a place without an
       * address here (a note, a header). too_long: beyond the sanity limit of a selection.
       */
      reason: 'none' | 'unsupported' | 'too_long'
    }

export type AgentReplaceSelectionResult =
  | { ok: true; segments: AgentSegment[]; place: AgentPlace }
  /** a run no longer holds the text it held when the selection was read */
  | { ok: false; reason: 'changed' }
  /** the texts are not as many as the runs, and the runs are not one stretch of paragraphs */
  | { ok: false; reason: 'count'; count: number }
  | { ok: false; reason: 'has_objects'; count: number }
  /** a run to rewrite lies across an object of its line */
  | { ok: false; reason: 'spans_object'; count: number }

export type AgentFormatSelectionResult =
  | {
      ok: true
      count: number
      place: AgentPlace
      /**
       * paragraphs that took the style's name but kept their own look: the editor keeps a
       * paragraph's own paragraph formatting whole when it differs from its former style's
       */
      keptOwnLook?: number
    }
  | { ok: false; reason: 'changed' | 'unsupported_place' }
  | { ok: false; reason: 'has_objects'; count: number }
  | AgentNoSuchStyle

/** Rows or columns of a table. */
export type AgentTableLines = 'rows' | 'columns'

/** Why a row or column call did nothing. */
export type AgentTableLinesRefusal =
  | { ok: false; reason: 'no_such_table'; count: number }
  | {
      ok: false
      /**
       * nested: the table sits inside a cell of another table, where the engine cannot add
       * or remove lines. no_such_line: the row or column is outside the table.
       * would_empty: nothing would be left of the table.
       */
      reason: 'nested' | 'no_such_line' | 'would_empty'
      rows: number
      cols: number
    }
  | {
      ok: false
      /** cells of those lines hold a picture or another object */
      reason: 'holds_object'
      cells: { row: number; col: number }[]
      rows: number
      cols: number
    }
  | { ok: false; reason: 'has_objects'; count: number }

export type AgentAddLinesResult =
  | {
      ok: true
      table: number
      /** the size of the table now */
      rows: number
      cols: number
      /** 1-based number of the first new row or column */
      first: number
      count: number
      place?: AgentPlace
    }
  | AgentTableLinesRefusal

export type AgentRemoveLinesResult =
  | {
      ok: true
      table: number
      rows: number
      cols: number
      count: number
      /** the text that went with them, cut to a few hundred characters */
      text: string
      place: AgentPlace
    }
  | AgentTableLinesRefusal

export type AgentDeleteTableResult =
  | {
      ok: true
      table: number
      rows: number
      cols: number
      /** the tables inside its cells that went with it */
      inner: number
      /** the text that went with it, cut to a few hundred characters */
      text: string
      place: AgentPlace
    }
  | { ok: false; reason: 'no_such_table'; count: number }
  | { ok: false; reason: 'holds_object'; cells: { row: number; col: number }[] }
  | { ok: false; reason: 'has_objects'; count: number }

/** What a File menu item of the editor asks the app to do. */
export type AgentFileCommand =
  'open' | 'save' | 'saveAs' | 'importPdf' | 'pdf' | 'preview' | 'print'

/** The event those items fire on the editor's window; `detail` is the AgentFileCommand. */
export declare const FILE_COMMAND_EVENT: 'ieum:file-command'

/** The command behind the editor's right-click item 쉬운 말로 풀기. */
export declare const EASY_WORDS_COMMAND: 'ext:ieum-easy-words'

/** The event that item fires on the editor's window; `detail` is an AgentEasyWordsDetail. */
export declare const EASY_WORDS_EVENT: 'ieum:easy-words'

/** What a click on 쉬운 말로 풀기 hands the app: the selected text, a line per paragraph. */
export interface AgentEasyWordsDetail {
  text: string
}

/** The event watchMissingFonts fires on the editor's window; `detail` is an AgentMissingFontsDetail. */
export declare const MISSING_FONTS_EVENT: 'ieum:missing-fonts'

/** The fonts the document's text uses that are not on this PC, each once. */
export interface AgentMissingFontsDetail {
  fonts: string[]
}

/** The words of the status bar's character count (showCharCount), in the app's language. */
export interface AgentCharCountLabels {
  /** shown while nothing is selected; {total} is the document's characters */
  total: string
  /** shown while a block is selected; {selected} and {total} */
  selected: string
  /** the tooltip without a block; {total} and {totalNoSpace} (without blanks) */
  hint: string
  /** the tooltip with a block; {selected}, {total}, {selectedNoSpace} and {totalNoSpace} */
  hintSelected: string
  /** the language the numbers are written in (BCP 47) */
  locale?: string
}

/** The words the editor marks a font that is not on this PC with. */
export interface AgentMissingFontLabels {
  /** shown beside the font's entry in the font menu */
  tag: string
  /** the tooltip of that entry and of the font box */
  hint: string
}

/**
 * Whether a line break between the texts `left` and `right` of a cell splits a word, as
 * checkLayout counts the cells that wrap inside one.
 */
export declare function splitsWord(left: string, right: string): boolean

/** The parts of the editor toolbar's style list (a select element) syncStyleList uses. */
export interface StyleListElement {
  readonly options: ArrayLike<{ value: string; textContent: string | null }>
  selectedIndex: number
  value: string
  replaceChildren(...nodes: unknown[]): void
  readonly ownerDocument: {
    createElement(name: 'option'): { value: string; textContent: string | null }
  }
}

/**
 * Fill the editor toolbar's style list with the document's styles when they differ from what
 * it shows, keeping the number shown where a style still has it. True when it was refilled.
 */
export declare function syncStyleList(
  select: StyleListElement,
  styles: { id: number; name: string }[],
): boolean

/** The event the plugin fires on the editor's window when the unsaved state changes; `detail` is the new state. */
export declare const DIRTY_EVENT: 'ieum:dirty-changed'

export type AgentNoteKind = 'footnote' | 'endnote'

/** One footnote or endnote of the body, as listNotes lists it. */
export interface AgentNote {
  /** 1-based position among the notes of the body in reading order; what editNote and deleteNote take */
  note: number
  kind: AgentNoteKind
  /** the number the document shows (footnotes and endnotes are counted apart) */
  number: number
  /** the text in front of the note's mark */
  after: string
  /** the note's text, a line per paragraph, cut when long */
  text: string
  /** it holds something besides text (an equation, a picture): it is not rewritten */
  objects?: true
  /**
   * it has no automatic number: what reads as its number is typed text (a document
   * generator's), part of `text`, and no number is drawn besides
   */
  noAutoNumber?: true
}

/** One kind of note's settings, as noteSettings reads them and setNoteSettings takes them. */
export interface AgentNoteShape {
  /** the engine's name of the number format: digit, circledDigit, upperRoman, hangulSyllable, userChar… */
  numberFormat: string
  /** the symbol of the userChar format */
  symbol?: string
  /** characters before and after the number ("" for none) */
  prefix: string
  suffix: string
  /** the number in the note is raised */
  superscript: boolean
  startNumber: number
  /** footnotes: continue, restartSection, restartPage; endnotes: continue, restartSection */
  numbering: string
  /** footnotes: eachColumn, belowText, rightColumn; endnotes: documentEnd, sectionEnd */
  placement: string
  /** a line above the notes */
  separator: boolean
}

export interface AgentNoteSettings {
  sections: number
  /** null when this engine cannot read them */
  footnote: AgentNoteShape | null
  endnote: AgentNoteShape | null
}

/** What setNoteSettings takes: only the settings to change. */
export type AgentNoteShapeChange = Partial<Omit<AgentNoteShape, 'symbol'>> & { symbol?: string }

export type AgentNoteSettingsResult =
  | { ok: true; kind: AgentNoteKind; settings: AgentNoteShape | null }
  /** this engine cannot change footnote settings */
  | { ok: false; reason: 'unsupported' }
  | AgentMemoRemovalRefusal

/** A section's page setup, in millimetres. */
export interface AgentPageSetup {
  /** A3, A4, A5, B4, B5, Letter or Legal, when the paper is one of them */
  paper?: string
  /** the paper, portrait */
  width: number
  height: number
  orientation: 'portrait' | 'landscape'
  margins: {
    left: number
    right: number
    top: number
    bottom: number
    header: number
    footer: number
    gutter: number
  }
}

/** What setPageSetup takes: paper by name or width and height (portrait), orientation, any margins. */
export interface AgentPageSetupChange {
  paper?: string
  width?: number
  height?: number
  orientation?: 'portrait' | 'landscape'
  margins?: Partial<AgentPageSetup['margins']>
}

export type AgentPageSetupResult =
  | { ok: true; sections: number; pageSetup: AgentPageSetup }
  | { ok: false; reason: 'no_such_section'; count: number }
  /** the margins would leave less than 2 cm for text in that section (from 1) */
  | { ok: false; reason: 'no_text_area'; section: number }
  | AgentMemoRemovalRefusal

/** How a group of body paragraphs looks, in the format calls' units. */
export interface AgentLook {
  /** what formatLook takes; absent for another document's looks */
  id?: string
  /** how many body paragraphs look like this */
  paragraphs: number
  style: string
  font: string
  size: number
  bold: boolean
  italic: boolean
  underline: boolean
  color: string
  align: string
  lineSpacing?: number
  /** a line spacing that is not a percentage (Fixed, SpaceOnly, Minimum) */
  lineSpacingKind?: string
  indent: number
  marginLeft: number
  marginRight: number
  spacingBefore: number
  spacingAfter: number
  list?: 'number' | 'bullet' | 'outline'
  listLevel?: number
  /** the bullet of a bulleted paragraph */
  bullet?: string
  /** paragraphs of the group whose formatting changes inside their text */
  mixedFormatting?: number
  samples: string[]
}

export interface AgentFormatting {
  /** one page setup when every section has it, else one per section */
  pageSetup: AgentPageSetup | (AgentPageSetup & { section: number })[]
  notes: { footnote?: AgentNoteShape; endnote?: AgentNoteShape }
  /** the paragraph styles the body uses, and the character styles */
  styles: {
    name: string
    kind: 'paragraph' | 'character'
    paragraphs: number
    look: Record<string, unknown>
  }[]
  /** non-empty body paragraphs looked at */
  paragraphs: number
  looks: AgentLook[]
  /** looks past the ones listed */
  otherLooks?: number
  /** the document has more paragraphs than were looked at */
  truncated?: true
}

/** One body paragraph and its look, as paragraphLooks lists them. */
export interface AgentParagraphLook {
  /** 1-based position among the body paragraphs that hold text */
  paragraph: number
  /** the look id, as formatting lists looks */
  look: string
  /** the start of its text */
  text: string
}

export interface AgentParagraphLooks {
  /** body paragraphs that hold text; `paragraphs` holds one part of them */
  count: number
  paragraphs: AgentParagraphLook[]
  /** where the next call goes on, when more paragraphs follow */
  next?: number
  /** the document is very long: the last paragraphs were not looked at */
  truncated?: boolean
}

export type AgentFormattingResult =
  ({ ok: true } & AgentFormatting) | { ok: false; reason: 'unreadable'; message: string }

export type AgentFormatLookResult =
  | {
      ok: true
      paragraphs: number
      place: AgentPlace
      /** paragraphs that keep some formatting of their own over the new style */
      keptOwnLook?: number
    }
  | {
      ok: false
      reason: 'no_such_look'
      looks: { id: string; paragraphs: number; sample: string }[]
    }
  | AgentNoSuchStyle
  | AgentWordsSetApart
  | { ok: false; reason: 'has_objects'; count: number }
  | AgentMemoRemovalRefusal

/** An equation of the body text: its number, the words on either side of it, its script. */
export interface AgentListedEquation {
  equation: number
  before: string
  after: string
  /** the start of the paragraph before, where the words round the equation say little */
  previous?: string
  script: string
}

export interface AgentEquationList {
  count: number
  /** equations inside table cells, notes or text boxes, which these tools do not reach */
  elsewhere: number
  equations: AgentListedEquation[]
}

export type AgentEditEquationResult =
  /** `was` is the script the equation had */
  | { ok: true; removed: boolean; was: string; place: AgentPlace }
  | { ok: false; reason: 'no_such_equation'; count: number }

export interface AgentNoteList {
  count: number
  /** notes inside table cells or text boxes, which have no address here */
  elsewhere: number
  notes: AgentNote[]
}

export type AgentInsertNoteResult =
  { ok: true; kind: AgentNoteKind; number: number | null; place: AgentPlace } | AgentPlaceRefusal

export type AgentEditNoteResult =
  | { ok: true; kind: AgentNoteKind; number: number; was: string; place: AgentPlace }
  | { ok: false; reason: 'no_such_note'; count: number }
  | { ok: false; reason: 'has_objects'; count: number }

export type AgentDeleteNoteResult =
  | { ok: true; kind: AgentNoteKind; number: number; text: string; place: AgentPlace }
  | { ok: false; reason: 'no_such_note'; count: number }
  | { ok: false; reason: 'has_objects'; count: number }

/** Where a memo anchor sits, as the engine reports it. */
export type AgentMemoPlace =
  'body' | 'tableCell' | 'textBox' | 'header' | 'footer' | 'footnote' | 'endnote' | 'unknown'

/** One step of the engine's memo path; a text box has no cell index. */
export interface AgentMemoPathStep {
  type: 'cell' | 'textbox'
  controlIndex: number
  cellIndex?: number
  paraIndex: number
}

/** A memo anchor in the editor's place terms, before it is put in the document. */
export interface AgentMemoAnchor {
  place: 'body' | 'tableCell' | 'textBox'
  sectionIndex: number
  paraIndex: number
  startCharIdx: number
  endCharIdx: number
  /** null for the body; the editor's cell path for a cell or a text box */
  path: { controlIndex: number; cellIndex: number; cellParaIndex: number }[] | null
}

/** A rectangle a memo anchor covers on a page; a caret anchor has width 0. */
export interface AgentMemoRect {
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
}

/** One memo of the document, as the panel lists it. */
export interface AgentMemo {
  id: number
  /** the number the file gives it; it can repeat, unlike id */
  index: number
  author: string
  date: string | null
  text: string
  place: AgentMemoPlace
  sectionIndex: number | null
  paraIndex: number | null
  startCharIdx: number | null
  endCharIdx: number | null
  path: AgentMemoPathStep[] | null
  /** the page the anchor starts on (1-based); 0 when it cannot be told */
  page: number
  editable: boolean
  readOnlyReason: 'formatted' | 'object' | 'unsupported_place' | 'protected' | null
  /** the anchor in the terms reveal() and the editor use; null for a memo without an address */
  anchor: AgentPlace | null
  rects: AgentMemoRect[]
  /** the first words of the text, for a card */
  preview: string
}

export interface AgentMemoList {
  count: number
  memos: AgentMemo[]
  /** false when this engine build has no memo API; the panel stays closed then */
  supported?: boolean
}

export type AgentMemoSelectionResult =
  | {
      ok: true
      place: 'body' | 'tableCell' | 'textBox'
      sectionIndex: number
      paraIndex: number
      startCharIdx: number
      endCharIdx: number
      path: AgentMemoAnchor['path']
      /** the text the memo would be put on, or words around the caret */
      preview: string
      /** the same anchor, as insertMemo takes it */
      anchor: AgentMemoAnchor
    }
  | {
      ok: false
      /**
       * none: no caret. multi_paragraph: the selection runs over more than one paragraph.
       * unsupported_place: a note, a header, a block of cells. overlap: a memo is there
       * already. protected: the document cannot be saved.
       */
      reason: 'none' | 'multi_paragraph' | 'unsupported_place' | 'overlap' | 'protected'
    }

/** What an AI change may be told about memos: the default asks before taking one away. */
export interface AgentChangeOptions {
  /** the user approved the memos this change takes: only for the one retried change */
  allowMemoRemoval?: boolean
  /** "ask" (the default) refuses and asks; "allow" is the same as allowMemoRemoval */
  memoPolicy?: 'ask' | 'allow'
  /** the memos the user approved taking (ids of the refusal): any other one is refused again */
  approvedMemoIds?: number[]
  /**
   * deleteParagraph only: a paragraph whose whole text (spaces squashed) is one of these is
   * not removed, and the call answers `protected`
   */
  protectTexts?: string[]
}

/**
 * An AI change that would take memos with it was rolled back. The panel shows these memos
 * and retries the same change with `allowMemoRemoval` when the user says yes. A mutating
 * call answers this in place of its usual result; a caller that expects it widens the
 * call's answer with this type.
 */
export interface AgentMemoRemovalRefusal {
  ok: false
  reason: 'memo_removal_requires_approval'
  count: number
  memos: {
    id: number
    index: number
    author: string
    /** the first words of the text, cut short */
    text: string
    place: AgentMemoPlace
    page: number
  }[]
}

export type AgentInsertMemoResult =
  { ok: true; id: number; index: number } | { ok: false; reason: string }

export type AgentSetMemoResult = { ok: true } | { ok: false; reason: string; why?: string | null }

export type AgentRemoveMemoResult =
  { ok: true } | { ok: false; reason: string; why?: string | null }

/** The event the plugin fires when a user's own edit took memos away. */
export declare const MEMO_REMOVED_EVENT: 'ieum:memo-removed'

/** The event the plugin fires when a paste brought text without the memos copied with it. */
export declare const MEMO_NOT_COPIED_EVENT: 'ieum:memo-not-copied'

/** One heading of a table of contents: text it contains, and its level (1 to 3). */
export interface AgentTocEntry {
  find: string
  /** which occurrence of find, when it occurs more than once */
  occurrence?: number | null
  level: number
}

/** A tab a save found without a width: see TabSpot in src/main/tab-widths.ts. */
export interface AgentTabSpot {
  sec: number
  para: number
  cells: { table: number; cell: number; para: number }[]
  tab: number
  tabs: number
}

/** Width in HWPUNIT; kind (0 left, 1 right, 2 centre, 3 decimal) and leader of its tab stop. */
export interface AgentTabMeasure {
  width: number
  type: number
  fill: number
}

export type AgentInsertTocResult =
  /** `table`: the contents table's number, as listTables numbers tables, of `tables` */
  | { ok: true; count: number; pages: number[]; table: number; tables: number; place: AgentPlace }
  | AgentPlaceRefusal
  | { ok: false; reason: 'in_table'; count: number }
  /** a heading could not be decided: `why` is not_found, ambiguous, no_such_occurrence or unsupported_place */
  | {
      ok: false
      reason: 'no_heading'
      heading: string
      why: string
      count: number
      matches?: AgentMatch[]
    }
  /**
   * contents insertToc made in this document are there: table `table`, `title` when the
   * paragraph right above it is a line of text, `first` when it is the first paragraph of the document
   */
  | { ok: false; reason: 'toc_exists'; count: number; table: number; title?: string; first?: true }
  /** a 차례 or 목차 line `title` has Hangul's contents of tab lines under it already */
  | { ok: false; reason: 'toc_exists'; count: number; lines: true; title: string }

export type AgentRefreshTocResult =
  | {
      ok: true
      /** rows that hold a page number */
      lines: number
      changed: number
      /** headings no longer found in the body */
      missing?: string[]
      place: AgentPlace
    }
  | AgentPlaceRefusal
  | { ok: false; reason: 'in_table'; count: number }
  | { ok: false; reason: 'no_toc'; count: number }

export type AgentUndoResult =
  { ok: boolean; undone: number } | { ok: false; reason: 'changed'; undone: 0 }

/** One picture of the document, as listPictures lists it. */
export interface AgentPicture {
  /** 1-based position in reading order; what readPicture takes */
  picture: number
  /** image MIME type, for example image/png */
  type: string
  /** the page its paragraph starts on, as the document numbers pages; null when unknown */
  page: number | null
  /** the text beside it, cut short; empty when its paragraph holds no text */
  near: string
  /** the table it sits in, as listTables numbers tables; null when it is in the body text */
  table: number | null
}

export interface AgentPictureList {
  count: number
  /** more pictures exist than the list holds: `pictures` is the first ones */
  limited: boolean
  pictures: AgentPicture[]
}

export type AgentReadPictureResult =
  | { ok: true; mime: string; base64: string }
  /** the number is not in the current list */
  | { ok: false; reason: 'no_such_picture'; count: number }
  /** larger than the panel sends to the model */
  | { ok: false; reason: 'too_large'; bytes: number }

/** What the plugin answers to, by method name (the studio's `plugins.invoke`). */
export interface AgentPluginSurface {
  foreignChanges(): number
  /** moves with every edit of the document and every document swapped in */
  documentRevision(): number
  readText(): string
  listPictures(): AgentPictureList
  readPicture(picture: number): AgentReadPictureResult
  /** What the document is made of (paragraphs, tables, pictures, fonts); reads only. */
  documentProfile(): AgentDocumentProfile
  findText(find: string): AgentFindResult
  replaceText(
    find: string,
    replacement: string,
    occurrence?: number | null,
    options?: AgentChangeOptions,
  ): AgentReplaceResult
  replaceAllText(
    find: string,
    replacement: string,
    options?: AgentChangeOptions,
  ): AgentReplaceAllResult
  insertParagraphs(
    anchor: string,
    occurrence: number | null,
    where: AgentWhere,
    paragraphs: string[],
    options?: AgentChangeOptions,
  ): AgentInsertResult
  deleteParagraph(
    find: string,
    occurrence: number | null,
    options?: AgentChangeOptions,
  ): AgentDeleteResult
  insertTable(
    anchor: string,
    occurrence: number | null,
    where: AgentWhere,
    rows: string[][],
    /** the header row alone, or the whole look of the table */
    header?: boolean | AgentTableLook | null,
    options?: AgentChangeOptions,
  ): AgentTableResult
  insertPicture(
    anchor: string,
    occurrence: number | null,
    where: AgentWhere,
    /** base64 bytes of a PNG, JPEG or GIF; the extension has to be that format */
    base64: string,
    /** the width on the page, in points; the height follows the natural pixel size */
    widthPt: number,
    naturalWidthPx: number,
    naturalHeightPx: number,
    extension: 'png' | 'jpg' | 'gif',
    options?: AgentChangeOptions,
  ): AgentPictureResult
  formatText(
    find: string,
    occurrence: number | null,
    all: boolean,
    format: AgentTextFormat,
    options?: AgentChangeOptions,
  ): AgentFormatTextResult
  /** every run of text whose Hangul font is `from` becomes `to`; one undo step */
  replaceFont(from: string, to: string): AgentReplaceFontResult
  formatParagraph(
    find: string,
    occurrence: number | null,
    format: AgentWholeParagraphFormat,
    options?: AgentChangeOptions,
  ): AgentFormatParagraphResult
  listTables(): AgentTableList
  /**
   * the table cells whose text is cut off on the page; reads only. Given `toRow`, only
   * table `fromTable` is measured, from `fromRow` to `toRow`
   */
  checkLayout(
    fromTable?: number | null,
    fromRow?: number | null,
    toRow?: number | null,
  ): AgentLayoutCheck
  /** every cut-off cell of the document, measured as checkLayout does, in one call; reads only */
  cutCells(): AgentCutCell[]
  readTable(table: number, fromRow?: number | null): AgentReadTableResult
  fillCells(
    table: number,
    cells: AgentCellText[],
    overwrite: boolean,
    options?: AgentChangeOptions,
  ): AgentFillCellsResult
  checkBoxes(
    table: number,
    cells: AgentCheckBox[],
    options?: AgentChangeOptions,
  ): AgentCheckBoxesResult
  addTableLines(
    table: number,
    what: AgentTableLines,
    at: number,
    where: 'after' | 'before',
    count: number,
    options?: AgentChangeOptions,
  ): AgentAddLinesResult
  removeTableLines(
    table: number,
    what: AgentTableLines,
    at: number,
    count: number,
    options?: AgentChangeOptions,
  ): AgentRemoveLinesResult
  deleteTable(table: number, options?: AgentChangeOptions): AgentDeleteTableResult
  installFileMenu(labels: Record<AgentFileCommand, string>): { ok: boolean }
  installEasyWords(label: string): { ok: boolean }
  removeEasyWords(): { ok: boolean }
  showCharCount(labels: AgentCharCountLabels): { ok: boolean }
  watchMissingFonts(labels: AgentMissingFontLabels): { ok: boolean }
  reveal(place: AgentPlace): { ok: boolean }
  selection(): AgentSelectionResult
  replaceSelection(
    segments: AgentSegment[],
    texts: string[],
    options?: AgentChangeOptions,
  ): AgentReplaceSelectionResult
  formatSelection(
    segments: AgentSegment[],
    format: AgentParagraphFormat,
    options?: AgentChangeOptions,
  ): AgentFormatSelectionResult
  listFields(): AgentField[]
  fillField(field: number, value: string, options?: AgentChangeOptions): AgentFillResult
  insertToc(
    anchor: string,
    occurrence: number | null,
    where: AgentWhere,
    title: string | null,
    entries: AgentTocEntry[],
    options?: AgentChangeOptions,
  ): AgentInsertTocResult
  refreshToc(
    title: string,
    occurrence: number | null,
    options?: AgentChangeOptions,
  ): AgentRefreshTocResult
  listNotes(): AgentNoteList
  /** the equations of the body text, numbered for editEquation */
  listEquations(): AgentEquationList
  /** a new script for an equation of listEquations, or null to remove it */
  editEquation(
    equation: number,
    script: string | null,
    options?: AgentChangeOptions,
  ): AgentEditEquationResult
  insertNote(
    kind: AgentNoteKind,
    anchor: string,
    occurrence: number | null,
    text: string,
    options?: AgentChangeOptions,
  ): AgentInsertNoteResult
  editNote(note: number, text: string, options?: AgentChangeOptions): AgentEditNoteResult
  deleteNote(note: number, options?: AgentChangeOptions): AgentDeleteNoteResult
  noteSettings(): AgentNoteSettings
  setNoteSettings(
    kind: AgentNoteKind,
    settings: AgentNoteShapeChange,
    options?: AgentChangeOptions,
  ): AgentNoteSettingsResult
  pageSetup(): { sections: AgentPageSetup[] }
  setPageSetup(
    setup: AgentPageSetupChange,
    section?: number | null,
    options?: AgentChangeOptions,
  ): AgentPageSetupResult
  /** this document's formatting, or that of another HWP / HWPX document given as base64 */
  formatting(base64?: string | null): AgentFormattingResult
  /** the body paragraphs in reading order with their look ids, from the `from`-th (1-based) */
  paragraphLooks(from?: number | null): AgentParagraphLooks
  formatLook(
    look: string,
    format: AgentWholeParagraphFormat,
    options?: AgentChangeOptions,
  ): AgentFormatLookResult
  measureTabs(spots: AgentTabSpot[]): { tabs: (AgentTabMeasure | null)[] }
  /**
   * The preview a save writes (decision 0146): the first lines of the document the way
   * Hangul writes `PrvText` (CR LF lines, a table row as `<cell><cell>`), and the first
   * page as base64 PNG 1024 pixels high, or null where it cannot be drawn.
   */
  savePreview(): { text: string; png: string | null }
  listStyles(): AgentStyleNames
  readStyle(name: string): AgentReadStyleResult
  createStyle(spec: AgentNewStyle, options?: AgentChangeOptions): AgentStyleResult
  editStyle(
    name: string,
    changes: AgentStyleChanges,
    options?: AgentChangeOptions,
  ): AgentStyleResult
  /** pages for printing from `from`, as many as are drawn in about two seconds */
  printPages(from: number): AgentPrintPages
  /** once the start-up look at the PC's fonts is over: whether print can use the screen's fonts */
  printFontsReady(): Promise<boolean>
  /** each page's size as the print path lays it out, from `from`, measured for about two seconds */
  printPageSizes(from: number): AgentPrintPageSizes
  /** one page as the print path draws it, for the preview; `page` is 0-based */
  previewPage(page: number): AgentPreviewPage
  /** the first body paragraph that starts on `page`, for Ctrl+Enter in the preview */
  pageTarget(page: number): AgentPageTarget
  mergeCells(
    table: number,
    from: AgentCellPlace,
    to: AgentCellPlace,
    options?: AgentChangeOptions,
  ): AgentMergeCellsResult
  splitCell(
    table: number,
    row: number,
    col: number,
    rows?: number | null,
    cols?: number | null,
    options?: AgentChangeOptions,
  ): AgentSplitCellResult
  /** cells: a list of places, a block, or null for the whole table; look: a background alone, or a look */
  formatCells(
    table: number,
    cells: { row: number; col: number }[] | AgentCellBlock | null,
    look: string | AgentCellLook,
    options?: AgentChangeOptions,
  ): AgentFormatCellsResult
  /** make or change paragraph styles and give them to paragraphs, one undo step */
  styleParagraphs(spec: AgentStyleBatch, options?: AgentChangeOptions): AgentStyleParagraphsResult
  /** turn the body paragraph the text occurs in into a title box */
  insertTitleBox(
    find: string,
    occurrence: number | null,
    spec?: AgentTitleBox | null,
    options?: AgentChangeOptions,
  ): AgentTitleBoxResult
  documentFonts(): AgentDocumentFonts
  pageCount(): number
  /** the page number, header and footer of the document */
  pageLayout(): AgentPageLayout
  setColumns(
    spec: { count: number; gapMm?: number | null; line?: AgentColumnLine | 'none' | null },
    options?: AgentChangeOptions,
  ): AgentColumnsResult
  insertBreak(
    find: string,
    occurrence: number | null,
    kind: AgentBreakKind,
    options?: AgentChangeOptions,
  ): AgentBreakResult
  /** draw a line round every page, or take it away */
  setPageBorder(spec: AgentPageBorder, options?: AgentChangeOptions): AgentPageBorderResult
  /** put equations into the body text, each in the place of text it names */
  insertEquations(items: AgentEquation[], options?: AgentChangeOptions): AgentEquationsResult
  /** give a picture of the body text another width; its height follows */
  resizePicture(
    picture: number,
    spec: { widthMm: number },
    options?: AgentChangeOptions,
  ): AgentPictureResizeResult
  setPageNumber(spec: AgentPageNumberChange, options?: AgentChangeOptions): AgentPageNumberResult
  setHeaderFooter(
    kind: 'header' | 'footer',
    spec: AgentHeaderFooterChange,
    options?: AgentChangeOptions,
  ): AgentHeaderFooterResult
  /** take the marks of the changes made so far off the pages */
  clearMarks(): { ok: true }
  /** whether the pages carry marks of changes now (a user edit takes them off) */
  hasMarks(): { ok: true; shown: boolean }
  undo(steps: number, expectedForeign: number): AgentUndoResult
  /** the memos of the document in document order, with their pages and anchor rectangles */
  listMemos(): AgentMemoList
  /** whether the selection (or the caret) may carry a memo anchor */
  memoSelection(): AgentMemoSelectionResult
  /** add a memo at an anchor memoSelection gave; one undo step */
  insertMemo(
    anchor: AgentMemoAnchor,
    author: string,
    text: string,
    options?: AgentChangeOptions,
  ): AgentInsertMemoResult
  /** replace the text of a memo, keeping its author and date; one undo step */
  setMemo(id: number, text: string, options?: AgentChangeOptions): AgentSetMemoResult
  /** remove a memo and keep the text it was put on; one undo step */
  removeMemo(id: number, options?: AgentChangeOptions): AgentRemoveMemoResult
  /** show the memo anchors on the pages while the panel is open, or take them off */
  showMemoAnchors(shown: boolean): { ok: true; shown: boolean }
  /** make one memo's anchor stronger on the pages, or none */
  selectMemo(id: number | null): { ok: true; id: number | null }
  /** take the editor's input away while the app's memo modal is open */
  setMemoLock(locked: boolean): { ok: true; locked: boolean }
}

/** Pages drawn for printing: SVG, and each page's size in CSS pixels. */
export interface AgentPrintPages {
  pageCount: number
  from: number
  pages: { svg: string; width: number; height: number }[]
}

/** Page sizes in CSS pixels as the print path lays the pages out, from page `from`. */
export interface AgentPrintPageSizes {
  pageCount: number
  from: number
  sizes: { width: number; height: number }[]
}

/** One page for the print preview, with the count it belongs to. */
export interface AgentPreviewPage {
  pageCount: number
  page: number
  svg: string
  width: number
  height: number
  /** the page's text margins, in CSS pixels, for the preview's margin guide */
  margins: { left: number; top: number; right: number; bottom: number }
}

export type AgentPageTarget =
  | {
      ok: true
      page: number
      target: {
        kind: 'body_paragraph'
        section: number
        paragraph: number
        charOffset: 0
        length: number
      }
    }
  | { ok: false; reason: 'no_paragraph' }

/** The part of the studio's plugin host this plugin uses. */
/** The part of the editor's state a command's canExecute reads. */
export interface AgentEditorContext {
  hasDocument: boolean
  hasSelection: boolean
  inCellSelectionMode: boolean
}

export interface AgentPluginHost {
  read<T>(fn: (doc: never) => T): T
  transaction<T>(label: string, fn: (tx: { doc(): never; deferPagination(): void }) => T): T
  events: { on(name: 'document-changed', handler: () => void): unknown }
  automation: {
    execute(command: string, params?: unknown): { ok?: boolean } | null | undefined
    registerCommand?(command: {
      id: string
      label: string
      shortcutLabel?: string
      /** whether the command is on now; the editor greys its menu item out otherwise */
      canExecute?(context: AgentEditorContext): boolean
      execute(services: never, params?: never): void
    }): void
    unregisterCommand?(id: string): void
    addMenuItem?(spec: { menuId: string; commandId: string; position?: 'top' | 'bottom' }): void
  }
}

export declare const agentPlugin: {
  id: typeof AGENT_PLUGIN_ID
  apiVersion: 1
  activate(host: AgentPluginHost): AgentPluginSurface
}

export default agentPlugin
