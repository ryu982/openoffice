/**
 * The app's own plugin inside the rhwp-studio editor: the document operations
 * the AI panel needs, done on the editor's live document.
 *
 * It runs in the studio's realm, not in the app renderer, and is bundled into
 * the studio build (scripts/build-studio.mjs; the studio-plugin-allow patch
 * lets the studio load it). It imports nothing from the studio and knows only
 * the shape of the plugin host: `read` for lookups, `transaction` for every
 * change. One transaction is one undo step in the editor's own history and is
 * rolled back whole when it throws, so a change the AI makes is undone like a
 * change the user makes.
 *
 * Everything returned crosses to the app renderer by structured clone.
 */

import {
  charCountItem,
  charCountText,
  charCounter,
  checkCharCountLabels,
  countCollector,
} from './char-count.mjs'
import { documentStats, engineChars, engineLength, engineSlice } from './document-info.mjs'
import { installDialogTheme } from './dialog-theme.mjs'
import {
  BORDER_LINES,
  BREAK_KINDS,
  CELL_DIAGONALS,
  CELL_DIAGONAL_LINE,
  CHAR_WIDTH_PERCENT,
  DEFAULT_COLUMN_GAP_MM,
  MIN_TEXT_CONTRAST,
  LETTER_SPACING_PERCENT,
  DOCUMENT_FONTS,
  MAX_COLUMNS,
  MAX_COLUMN_GAP_MM,
  MAX_EQUATIONS,
  MAX_EQUATION_SCRIPT,
  NUMBERED_MARKS,
  PAGE_NUMBER_PLACES,
  PAGE_NUMBER_SHAPES,
  PICTURE_WIDTH_MM,
  ROW_HEIGHT_MM,
  TABLE_LOOKS,
  TABLE_WIDTH_PERCENT,
  TITLE_BOX_COLORS,
  TITLE_BOX_LOOKS,
  borderRuleOf,
  cellBorders,
  contrastRatio,
  HEADER_FIELD_TOKENS,
  headerPieces,
  pageNumberOf as pageNumberSettingOf,
  rowEdgesAfterAdding,
  paragraphBorderOf,
  standInFont,
  tabStopsOf,
  tableLookBlocks,
  textColorOnFill,
  titleBoxCells,
} from './document-looks.mjs'
import { equationSvgForThisPc, isEquationSvgFamily } from './equation-fonts.mjs'
import { gridOf as sizeGridOf, spanUpdates } from './table-sizes.mjs'
import {
  fontOnPc,
  missingFonts,
  printFontsReady,
  setMissingFontLabels,
  whenPcFontsSettled,
} from './pc-fonts.mjs'
import { printSvgForThisPc, screenFonts } from './print-fonts.mjs'

export const AGENT_PLUGIN_ID = 'ieum-agent'

/** Matches listed back to the caller when a search is ambiguous. */
const MAX_LISTED_MATCHES = 20
/** Text runs one replaceFont call changes; beyond this it says it stopped early. */
const MAX_FONT_RANGES = 5000
/** Paragraphs one documentProfile call reads; beyond this the profile says it is partial. */
const MAX_PROFILE_PARAGRAPHS = 20000
/** Tables one documentProfile call reports. */
const MAX_PROFILE_TABLES = 500
/** Cells one table reports to the merge check. */
const MAX_PROFILE_CELLS = 2000
/** Character-shape reads one documentProfile call makes, body and cells together. */
const MAX_PROFILE_SHAPES = 60000
/** Cell paragraphs one documentProfile call reads fonts from. */
const MAX_PROFILE_CELL_PARAGRAPHS = 4000
/** Pictures one documentProfile call reports. */
const MAX_PROFILE_PICTURES = 100
/** Characters of surrounding text shown with each listed match. */
const CONTEXT_CHARS = 30
/** Characters of the paragraph in front shown with each listed match (its heading, often). */
const BEFORE_CHARS = 24
/** Paragraphs looked back through for that one. */
const BEFORE_LOOKBACK = 20
/** Most history steps one undo call takes back. */
const MAX_UNDO_STEPS = 200
/** Most paragraphs one insert call adds. */
const MAX_INSERTED_PARAGRAPHS = 100
/** Most cells a new table holds. */
const MAX_TABLE_CELLS = 400
/** Characters of a removed paragraph handed back, for the panel's list of changes. */
const MAX_REPORTED_CHARS = 200
/** Tables one listTables call lists. */
const MAX_LISTED_TABLES = 200
/** Cells that do not fit one checkLayout call lists before it stops at the end of a row. */
const MAX_LISTED_OVERFLOWS = 100
/** How long one checkLayout call measures for; it is called again from where it stopped. */
const LAYOUT_BATCH_MS = 2000
/**
 * How much of its height a line may pass the cell's bottom edge and still read whole: the
 * line box is the font's em box, and the glyphs stop short of its bottom, so text that only
 * touches the border (a tight row) is not reported.
 */
const LAYOUT_SLACK_LINE = 0.2
/** Cells one readTable call returns; a longer table is read on from the row it names. */
const MAX_READ_CELLS = 600
/** Characters of one cell handed back by readTable. */
const MAX_CELL_CHARS = 300
/** Cells one fillCells call sets. */
const MAX_FILLED_CELLS = 400
/** Lines of text one cell is given. */
const MAX_CELL_LINES = 50
/** Most rows or columns one cell is split into. */
const MAX_SPLIT = 10
/** Cells one call gives a background colour. */
const MAX_FORMATTED_CELLS = 500
/** Rows or columns one call adds to or removes from a table. */
const MAX_TABLE_LINES = 50
/** Pictures one listPictures call lists. */
const MAX_LISTED_PICTURES = 100
/** Largest picture readPicture hands back to the AI panel, in bytes. */
const MAX_PICTURE_BYTES = 10 * 1024 * 1024
/** Characters of the text around a picture shown with it in the list. */
const PICTURE_CONTEXT_CHARS = 60
/** Objects tried in one cell paragraph when looking for a picture (the engine does not list them). */
const PICTURE_CELL_CONTROLS = 8
/** Cells one checkBoxes call ticks. */
const MAX_CHECKED_CELLS = 400
/**
 * The boxes Korean forms print a choice with, and the mark a ticked one takes. A box is
 * often the paragraph's bullet rather than text, so it cannot be replaced: the tick changes
 * the bullet instead, which keeps the cell's layout.
 */
const BOX_CHARS = '□☐▢❑◻'
const CHECKED_BOX = '☑'
const CHECKED_BOX_CHARS = '☑☒'
/** Characters of the words beside a box handed back when a cell has more than one. */
const MAX_BOX_CHOICE_CHARS = 40
/** What sits on the page as an object and can lie over a table cell without being in it. */
const FLOATING_KINDS = new Set(['image', 'picture', 'shape', 'group', 'ole', 'textbox'])
/** The command this plugin registers with the editor to move its caret to a place. */
const REVEAL_COMMAND = 'ext:ieum-reveal'
/**
 * The event the File menu items this plugin adds fire on the editor's window, with the
 * command as its detail: the app hears it and saves or prints the way Ctrl+S and Ctrl+P do.
 */
export const FILE_COMMAND_EVENT = 'ieum:file-command'
/**
 * The event this plugin fires on the editor's window when the document's unsaved state
 * changes, with the new state (true: unsaved changes) as its detail.
 */
export const DIRTY_EVENT = 'ieum:dirty-changed'
/** The File menu items, top to bottom: the command the app runs, and the shortcut shown. */
const FILE_MENU = [
  { command: 'open', id: 'ext:ieum-open', shortcut: 'Ctrl+O' },
  { command: 'save', id: 'ext:ieum-save', shortcut: 'Ctrl+S' },
  { command: 'saveAs', id: 'ext:ieum-save-as', shortcut: 'Ctrl+Shift+S' },
  { command: 'importPdf', id: 'ext:ieum-import-pdf' },
  { command: 'pdf', id: 'ext:ieum-export-pdf' },
  { command: 'preview', id: 'ext:ieum-preview' },
  { command: 'print', id: 'ext:ieum-print', shortcut: 'Ctrl+P' },
]
/** The command that reads what the user has selected in the editor. */
const SELECTION_COMMAND = 'ext:ieum-selection'
/** The command that counts the document's characters for the status bar (char-count.mjs). */
const COUNT_COMMAND = 'ext:ieum-count-characters'
/**
 * The command behind the editor's right-click item 쉬운 말로 풀기, which the
 * studio-easy-words-context-menu patch puts into the body and table cell menus. The menu
 * shows the command's label, which the app gives in its language (installEasyWords).
 */
export const EASY_WORDS_COMMAND = 'ext:ieum-easy-words'
/**
 * The event that item fires on the editor's window, with the selected text as its detail
 * (`{ text }`): the app asks its AI panel to explain that text in plain words.
 */
export const EASY_WORDS_EVENT = 'ieum:easy-words'
/**
 * The event watchMissingFonts fires on the editor's window once the PC's fonts are known,
 * with the fonts of the document that are not on this PC as its detail (`{ fonts }`).
 */
export const MISSING_FONTS_EVENT = 'ieum:missing-fonts'
/** The command that selects the word under the caret (a double click in the page). */
const WORD_COMMAND = 'ext:ieum-select-word'
/** The command that selects the paragraph under the caret (a triple click in the page). */
const PARAGRAPH_COMMAND = 'ext:ieum-select-paragraph'
/** The command that keeps a drag begun with a double click on whole words. */
const WORD_DRAG_COMMAND = 'ext:ieum-word-drag'
/** The command that draws the marks of this plugin's changes on the pages. */
const MARK_COMMAND = 'ext:ieum-mark-changes'
/** Most places marked at once: a replace-all over a long document stops here. */
const MAX_MARKS = 500
/** How long one call of printPages draws pages for; the bridge gives a call ten seconds. */
const PRINT_BATCH_MS = 2000

/**
 * A page's SVG as the print path draws it, for this PC: an equation's glyph runs decoded
 * where Hancom's equation font is missing, and the page's text in the fonts the screen
 * shows it in (print-fonts.mjs). `screen` is one screenFonts() for the pages of a call.
 */
function printSvgOf(doc, page, screen) {
  return printSvgForThisPc(
    equationSvgForThisPc(doc.renderPageSvgWithProfile(page, 'print')),
    screen,
    isEquationSvgFamily,
  )
}

/** One page as the print path draws it: the SVG and its size in CSS pixels. */
function printPageOf(doc, page, screen) {
  const info = JSON.parse(doc.getPageInfo(page))
  return {
    svg: printSvgOf(doc, page, screen),
    width: info.width,
    height: info.height,
  }
}
/**
 * How a mark looks: a light fill over the changed text and a line under it, warm so it is
 * not taken for the editor's blue selection. The page is paper white in every theme, so these
 * are the light values of the app's `--color-ai-changed-bg` and `--color-ai-changed-line`:
 * the editor's frame does not load the app's tokens (a test keeps the two the same).
 */
const MARK_FILL = 'rgba(255, 193, 7, 0.24)'
const MARK_LINE = 'rgba(214, 140, 0, 0.85)'
/** Under the editor's selection (5) and caret. */
const MARK_LAYER_Z = 4
/** The editor lays pages out again after a change, in its own time: the marks follow then. */
const MARK_SETTLE_MS = 350
/** Changes that leave nothing to mark: what they removed is gone. */
const UNMARKED_CHANGES = new Set(['delete-paragraph', 'remove-table-lines', 'delete-note'])

/**
 * The events the memo panel and the app use: a user's own edit took memos away, or a paste
 * brought text without the memo that was copied with it (a paste from another editor).
 */
export const MEMO_REMOVED_EVENT = 'ieum:memo-removed'
export const MEMO_NOT_COPIED_EVENT = 'ieum:memo-not-copied'
/** The commands this plugin registers with the editor for the memo panel. */
const MEMO_LIST_COMMAND = 'ext:ieum-memo-list'
const MEMO_SELECTION_COMMAND = 'ext:ieum-memo-selection'
const MEMO_INSERT_COMMAND = 'ext:ieum-memo-insert'
const MEMO_SET_COMMAND = 'ext:ieum-memo-set'
const MEMO_REMOVE_COMMAND = 'ext:ieum-memo-remove'
const MEMO_MARK_COMMAND = 'ext:ieum-memo-anchors'
const MEMO_LOCK_COMMAND = 'ext:ieum-memo-lock'
const MEMO_UNLOCK_COMMAND = 'ext:ieum-memo-unlock'
/** Where a memo anchor may be put. */
const MEMO_PLACES = new Set(['body', 'tableCell', 'textBox'])
/** Changes the plugin makes for the memo panel: removing the memo is what was asked. */
const MEMO_CHANGES = new Set(['memo-insert', 'memo-set', 'memo-remove'])
/** The longest memo text the engine takes, in UTF-16 units. */
const MAX_MEMO_TEXT = 100_000
const MAX_MEMO_AUTHOR = 64
/** How much of a memo a card and an approval question show. */
const MEMO_PREVIEW_CHARS = 80
/** How far around a caret the anchor preview looks. */
const MEMO_CARET_CHARS = 15
/** Under the AI change marks, above the pages: a memo anchor is a quiet band, not a selection. */
const MEMO_LAYER_Z = 3
const MEMO_FILL = 'rgba(64, 132, 240, 0.16)'
const MEMO_LINE = 'rgba(28, 96, 214, 0.7)'
const MEMO_SELECTED_FILL = 'rgba(64, 132, 240, 0.32)'
const MEMO_SELECTED_LINE = 'rgba(18, 72, 176, 0.95)'
/** The bar a memo with no text range gets at its caret. */
const MEMO_CARET_WIDTH = 2
/** How long after an unannounced user change the memo list is looked at for pasted memos. */
const MEMO_PROBE_MS = 250
/**
 * The channel a copy of memo-bearing text is told on, so another editor instance (a split
 * pane or another document tab) can tell the app a paste brought the text without the memo.
 * It carries a marker only, not the clipboard content; a paste from the system clipboard
 * gives no way to know what it held, so this is best effort.
 */
const MEMO_COPY_CHANNEL = 'ieum:hwp-memo-copied'
const MEMO_COPY_WINDOW_MS = 15_000

/** The most runs and characters of one selection: a sanity limit, far above real use. */
const MAX_SELECTED_RUNS = 5000
const MAX_SELECTED_CHARS = 400000
/**
 * Lookups one walk over the document spends on finding tables inside table cells: three per
 * cell paragraph. A government notice with a 429-row list (about 8,000 cells) needs about
 * 25,000, and 100,000 lookups take well under a second.
 */
const MAX_NESTED_LOOKUPS = 100000
/** Objects tried in one cell paragraph when looking for a table inside it. */
const NESTED_CONTROLS_TRIED = 3
/** How many controls of one cell paragraph the object check asks about. */
const MAX_CELL_CONTROLS = 32
/** How deep tables inside tables are followed. */
const MAX_TABLE_DEPTH = 3
/** Cells and characters of a table shown in the list of tables. */
const PREVIEW_CELLS = 5
const PREVIEW_CHARS = 24
/** Lines one readText looks for inside other lines of the plain-text export before adding them. */
const MAX_CONTAINMENT_CHECKS = 2000
/** Font sizes a format request may ask for, in points. */
const MIN_FONT_PT = 4
const MAX_FONT_PT = 200
/** Line spacings a format request may ask for, in percent of the font height. */
const MIN_LINE_SPACING = 50
const MAX_LINE_SPACING = 500

/** What the engine says when a paragraph has no object at the place asked for. */
const NO_OBJECT_THERE = '범위 초과'

const parse = (json) => JSON.parse(json)

/** A replacement stays inside one paragraph: no line breaks or other control characters. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
/** The control characters a new paragraph may not hold: all of them but the tab. */
// eslint-disable-next-line no-control-regex -- the tab is let through on purpose
const PARAGRAPH_CONTROL_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f]/

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/** The engine throws plain strings; give every failure a message the bridge can carry. */
function asError(thrown) {
  if (thrown instanceof Error) return thrown
  return fail('ENGINE_ERROR', String(thrown))
}

/**
 * The cell a match sits in, as the engine's by-path calls want it: one entry
 * per nesting level, outermost first. Null for a match in the body.
 */
function cellPathOf(hit) {
  if (Array.isArray(hit.cellPath) && hit.cellPath.length > 0) {
    return hit.cellPath.map((entry) => ({
      controlIndex: entry.controlIndex,
      cellIndex: entry.cellIndex,
      cellParaIndex: entry.cellParaIndex,
    }))
  }
  const cell = hit.cellContext
  if (!cell) return null
  return [{ controlIndex: cell.ctrlIdx, cellIndex: cell.cellIdx, cellParaIndex: cell.cellPara }]
}

/**
 * Where a change is, so the editor can show it: the paragraph (for a cell, the body
 * paragraph its table sits in and the path to the cell paragraph), and a run of characters.
 */
function placeOf(hit, length) {
  const path = cellPathOf(hit)
  return {
    sec: hit.sec,
    para: hit.para,
    ...(path ? { path } : {}),
    offset: hit.charOffset ?? 0,
    length,
  }
}

/** Where a form field is; null for a field in a text box or a note, which has no such address. */
function fieldPlace(field) {
  const where = field.location
  if (!where) return null
  const path = Array.isArray(where.path) ? where.path : []
  if (path.some((entry) => entry.type !== 'cell')) return null
  return {
    sec: where.sectionIndex,
    para: where.paraIndex,
    ...(path.length > 0
      ? {
          path: path.map((entry) => ({
            controlIndex: entry.controlIndex,
            cellIndex: entry.cellIndex,
            cellParaIndex: entry.paraIndex,
          })),
        }
      : {}),
    offset: field.startCharIdx ?? 0,
    length: 0,
  }
}

/** The engine's memo path (a type per step) in the form the editor's calls take. */
function memoPathOf(entry) {
  if (!Array.isArray(entry.path) || entry.path.length === 0) return null
  return entry.path.map((step) => ({
    controlIndex: step.controlIndex,
    // a text box is addressed like a table of one cell
    cellIndex: Number.isInteger(step.cellIndex) ? step.cellIndex : 0,
    cellParaIndex: Number.isInteger(step.cellParaIndex)
      ? step.cellParaIndex
      : Number.isInteger(step.paraIndex)
        ? step.paraIndex
        : 0,
  }))
}

/** A memo anchor as the editor's place calls take it; null where this plugin has no address. */
function memoAnchorOf(entry) {
  if (!MEMO_PLACES.has(entry.place)) return null
  if (!Number.isInteger(entry.sectionIndex) || !Number.isInteger(entry.paraIndex)) return null
  const path = memoPathOf(entry)
  if (entry.place !== 'body' && !path) return null
  const offset = Number.isInteger(entry.startCharIdx) ? entry.startCharIdx : 0
  const end = Number.isInteger(entry.endCharIdx) ? entry.endCharIdx : offset
  return {
    sec: entry.sectionIndex,
    para: entry.paraIndex,
    ...(path ? { path } : {}),
    offset,
    length: Math.max(0, end - offset),
  }
}

/** The rectangle(s) a memo anchor covers, or the caret bar of one with no text range. */
function memoRectsOf(doc, entry) {
  const anchor = memoAnchorOf(entry)
  if (!anchor) return []
  const path = anchor.path
  if (anchor.length > 0) {
    const rects = path
      ? parse(
          doc.getSelectionRectsInCellByPath(
            anchor.sec,
            anchor.para,
            JSON.stringify(path),
            path[path.length - 1].cellParaIndex,
            anchor.offset,
            path[path.length - 1].cellParaIndex,
            anchor.offset + anchor.length,
          ),
        )
      : parse(
          doc.getSelectionRects(
            anchor.sec,
            anchor.para,
            anchor.offset,
            anchor.para,
            anchor.offset + anchor.length,
          ),
        )
    return Array.isArray(rects) ? rects : []
  }
  const at = path
    ? parse(doc.getCursorRectByPath(anchor.sec, anchor.para, JSON.stringify(path), anchor.offset))
    : parse(doc.getCursorRect(anchor.sec, anchor.para, anchor.offset))
  if (!at || !Number.isFinite(at.pageIndex)) return []
  // a caret has no width: the panel's drawing gives it the small bar it shows instead
  return [{ pageIndex: at.pageIndex, x: at.x, y: at.y, width: 0, height: at.height ?? 0 }]
}

/** The engine's memo list as plain data; an engine without memos answers nothing. */
function memoEntriesOf(doc) {
  if (typeof doc.getMemoList !== 'function') return []
  const entries = parse(doc.getMemoList())
  return Array.isArray(entries) ? entries : []
}

/**
 * Whether the document is password protected. The engine's document info has the password
 * flag only, not a distribution flag: a distribution-only document gets as far as the
 * mutation, where the engine refuses with memo_read_only and the panel shows that.
 */
const memoProtected = (doc) => parse(doc.getDocumentInfo()).encrypted === true

/** What the panel and an approval question need to know about a memo that is going away. */
const memoSummaryOf = (entry) => ({
  id: entry.id,
  index: entry.index,
  author: typeof entry.author === 'string' ? entry.author : '',
  text: clip(
    String(entry.text ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
    MAX_REPORTED_CHARS,
  ),
  place: entry.place,
  page: Number.isInteger(entry.page) ? entry.page : 0,
})

/** The memo list with where each anchor is on the pages: what the panel shows. */
function memoListOf(doc) {
  return memoEntriesOf(doc).map((entry) => {
    let rects
    try {
      rects = memoRectsOf(doc, entry)
    } catch {
      // an anchor the page layout does not know: the panel still lists the memo
      rects = []
    }
    const page =
      Number.isInteger(entry.page) && entry.page > 0
        ? entry.page
        : rects.length > 0
          ? rects[0].pageIndex + 1
          : 0
    return {
      id: entry.id,
      index: entry.index,
      author: typeof entry.author === 'string' ? entry.author : '',
      date: entry.date ?? null,
      text: typeof entry.text === 'string' ? entry.text : '',
      place: typeof entry.place === 'string' ? entry.place : 'unknown',
      sectionIndex: Number.isInteger(entry.sectionIndex) ? entry.sectionIndex : null,
      paraIndex: Number.isInteger(entry.paraIndex) ? entry.paraIndex : null,
      startCharIdx: Number.isInteger(entry.startCharIdx) ? entry.startCharIdx : null,
      endCharIdx: Number.isInteger(entry.endCharIdx) ? entry.endCharIdx : null,
      path: Array.isArray(entry.path) ? entry.path : null,
      page,
      editable: entry.editable === true,
      readOnlyReason: typeof entry.readOnlyReason === 'string' ? entry.readOnlyReason : null,
      anchor: memoAnchorOf(entry),
      rects,
      preview: clip(
        String(entry.text ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
        MEMO_PREVIEW_CHARS,
      ),
    }
  })
}

/** A memo box (its body paragraph, or the cell or text box it sits in) as a string key. */
const memoPathKey = (path) =>
  Array.isArray(path) && path.length > 0
    ? JSON.stringify(
        path.map((step) => [
          step.controlIndex,
          Number.isInteger(step.cellIndex) ? step.cellIndex : 0,
          Number.isInteger(step.cellParaIndex)
            ? step.cellParaIndex
            : Number.isInteger(step.paraIndex)
              ? step.paraIndex
              : 0,
        ]),
      )
    : 'body'

const memoBoxKey = (entry) => `${entry.sectionIndex}:${entry.paraIndex}:${memoPathKey(entry.path)}`

/**
 * Whether a memo range and a new anchor would share one area. An empty anchor at the edge
 * of a memo does not overlap it; an empty anchor inside one, or at its exact place, does.
 */
function memoOverlaps(entries, key, start, end) {
  return entries.some((entry) => {
    if (!MEMO_PLACES.has(entry.place) || memoBoxKey(entry) !== key) return false
    const from = entry.startCharIdx
    const to = entry.endCharIdx
    if (!Number.isInteger(from) || !Number.isInteger(to)) return false
    if (start === end) return (from < start && start < to) || (from === start && to === end)
    return from < end && start < to
  })
}

/** The paragraph of a memo box an anchor's character offsets count from. */
const memoAnchorK = (anchor) =>
  anchor.path
    ? anchor.path[anchor.path.length - 1].cellParaIndex
    : Number.isInteger(anchor.paraIndex)
      ? anchor.paraIndex
      : anchor.para

/** A memo author as the file may hold it: no separators, 64 units, never empty. */
function memoAuthorOf(author) {
  const clean = String(author ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\;]/g, '')
    .trim()
    .slice(0, MAX_MEMO_AUTHOR)
  // the product's name (PRODUCT_NAME of @genoffice/i18n, which this plugin cannot import):
  // Hangul shows it as the author
  return clean || 'IeumOffice'
}

/** An anchor the panel hands back, checked before it reaches the engine. */
function checkMemoAnchor(anchor) {
  if (!anchor || typeof anchor !== 'object') throw fail('BAD_ARGUMENT', 'anchor must be an object')
  if (!MEMO_PLACES.has(anchor.place)) {
    throw fail('BAD_ARGUMENT', 'anchor.place must be body, tableCell or textBox')
  }
  const { sectionIndex, paraIndex, startCharIdx, endCharIdx } = anchor
  if (!Number.isInteger(sectionIndex) || !Number.isInteger(paraIndex)) {
    throw fail('BAD_ARGUMENT', 'the anchor paragraph must be a pair of integers')
  }
  if (
    !Number.isInteger(startCharIdx) ||
    !Number.isInteger(endCharIdx) ||
    startCharIdx < 0 ||
    endCharIdx < startCharIdx
  ) {
    throw fail('BAD_ARGUMENT', 'the anchor range must be a pair of character offsets')
  }
  let path = null
  if (anchor.place === 'body') {
    if (anchor.path !== null && anchor.path !== undefined) {
      throw fail('BAD_ARGUMENT', 'a body memo takes no path')
    }
  } else {
    if (!Array.isArray(anchor.path) || anchor.path.length === 0) {
      throw fail('BAD_ARGUMENT', 'a cell or text box memo needs a path')
    }
    path = anchor.path.map((step) => {
      if (
        !step ||
        !Number.isInteger(step.controlIndex) ||
        !Number.isInteger(step.cellIndex) ||
        !Number.isInteger(step.cellParaIndex)
      ) {
        throw fail('BAD_ARGUMENT', 'the anchor path steps must be integers')
      }
      return {
        controlIndex: step.controlIndex,
        cellIndex: step.cellIndex,
        cellParaIndex: step.cellParaIndex,
      }
    })
  }
  return { place: anchor.place, sectionIndex, paraIndex, startCharIdx, endCharIdx, path }
}

/** The engine's memo error envelope, when the call threw one. */
function memoErrorOf(thrown) {
  const text = thrown instanceof Error ? thrown.message : String(thrown)
  try {
    const parsed = JSON.parse(text)
    if (parsed && parsed.ok === false && typeof parsed.code === 'string') return parsed
  } catch {
    // an engine error that is not a memo refusal
  }
  return null
}

/** Whether a selection as this plugin addresses it comes at or after another place. */
function placeAtOrAfter(one, other) {
  if (!one || !other) return false
  if (one.sec !== other.sec) return one.sec > other.sec
  if (one.para !== other.para) return one.para > other.para
  const a = one.path ?? []
  const b = other.path ?? []
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const stepA = a[index]
    const stepB = b[index]
    if (!stepA || !stepB) return Boolean(stepA)
    if (stepA.controlIndex !== stepB.controlIndex) return stepA.controlIndex > stepB.controlIndex
    if ((stepA.cellIndex ?? 0) !== (stepB.cellIndex ?? 0)) {
      return (stepA.cellIndex ?? 0) > (stepB.cellIndex ?? 0)
    }
    if ((stepA.cellParaIndex ?? 0) !== (stepB.cellParaIndex ?? 0)) {
      return (stepA.cellParaIndex ?? 0) > (stepB.cellParaIndex ?? 0)
    }
  }
  const oneK = Number.isInteger(one.k) ? one.k : memoAnchorK(one)
  const otherK = Number.isInteger(other.k) ? other.k : memoAnchorK(other)
  if (oneK !== otherK) return oneK > otherK
  return one.offset >= other.offset
}

/** How many memos start inside a copied selection: what a paste from it would bring. */
function memosWithin(doc, start, end) {
  return memoEntriesOf(doc).filter((entry) => {
    const anchor = memoAnchorOf(entry)
    if (!anchor) return false
    const at = { ...anchor, k: memoAnchorK(anchor) }
    return placeAtOrAfter(at, start) && placeAtOrAfter(end, at)
  }).length
}

/** Tell the app about something the document did, in one event on the editor's window. */
function announce(name, detail) {
  try {
    globalThis.dispatchEvent?.(new CustomEvent(name, { detail }))
  } catch {
    // an editor window without events: the panel keeps what it has
  }
}

/**
 * Move the editor's caret to a place and select the run there; the editor scrolls to its
 * caret. The caret is not part of the plugin host: this runs as a command of the editor,
 * which is handed the editor's own services. The focus stays where it is.
 */
function showPlace(services, place) {
  const input = services && services.getInputHandler ? services.getInputHandler() : null
  const cursor = input ? input.cursor : null
  if (!cursor || !place || !Number.isInteger(place.sec) || !Number.isInteger(place.para)) {
    return false
  }
  const path = Array.isArray(place.path) ? place.path : []
  const offset = Number.isInteger(place.offset) ? place.offset : 0
  const start =
    path.length > 0
      ? {
          sectionIndex: place.sec,
          paragraphIndex: place.para,
          charOffset: offset,
          parentParaIndex: place.para,
          controlIndex: path[0].controlIndex,
          cellIndex: path[0].cellIndex,
          cellParaIndex: path[0].cellParaIndex,
          // a cell of a table inside a cell is named by the whole path
          ...(path.length > 1 ? { cellPath: path } : {}),
        }
      : { sectionIndex: place.sec, paragraphIndex: place.para, charOffset: offset }
  cursor.clearSelection()
  cursor.moveTo(start)
  if (Number.isInteger(place.length) && place.length > 0) {
    cursor.setAnchor()
    cursor.moveTo({ ...start, charOffset: offset + place.length })
  }
  if (input.updateCaret) input.updateCaret()
  return true
}

/**
 * What is selected in the editor: the two ends of a run of text in document order, or a
 * block of table cells (dragged across cells, or picked with F5). Null when nothing is.
 */
function cursorSelection(services) {
  const input = services && services.getInputHandler ? services.getInputHandler() : null
  const cursor = input ? input.cursor : null
  if (!cursor) return null
  if (cursor.isInCellSelectionMode && cursor.isInCellSelectionMode()) {
    const range = cursor.getSelectedCellRange ? cursor.getSelectedCellRange() : null
    const table = cursor.getCellTableContext ? cursor.getCellTableContext() : null
    if (range && table) {
      const excluded = cursor.getExcludedCells ? [...cursor.getExcludedCells()] : []
      return { block: { table, range, excluded } }
    }
  }
  if (!cursor.hasSelection()) return null
  const ordered = cursor.getSelectionOrdered()
  return ordered ? { start: ordered.start, end: ordered.end } : null
}

const asCellPath = (entries) =>
  entries.map((entry) => ({
    controlIndex: entry.controlIndex,
    // a text box is addressed like a table of one cell
    cellIndex: Number.isInteger(entry.cellIndex) ? entry.cellIndex : 0,
    cellParaIndex: entry.cellParaIndex,
  }))

/**
 * One end of a selection in the terms of this plugin: the paragraph it is in (for a cell or
 * a text box, the body paragraph that holds it and the path to the paragraph inside) and
 * the offset. Null for a place this plugin has no address for (a note, a header).
 */
function endOf(position) {
  if (!position) return null
  if (!Number.isInteger(position.sectionIndex) || !Number.isInteger(position.charOffset)) {
    return null
  }
  const cells =
    Array.isArray(position.cellPath) && position.cellPath.length > 0
      ? position.cellPath
      : Number.isInteger(position.cellIndex) || position.isTextBox
        ? [position]
        : null
  if (!cells) {
    return {
      sec: position.sectionIndex,
      para: position.paragraphIndex,
      path: null,
      k: position.paragraphIndex,
      offset: position.charOffset,
    }
  }
  const path = asCellPath(cells)
  if (
    path.some(
      (entry) => !Number.isInteger(entry.controlIndex) || !Number.isInteger(entry.cellParaIndex),
    )
  ) {
    return null
  }
  return {
    sec: position.sectionIndex,
    para: Number.isInteger(position.parentParaIndex)
      ? position.parentParaIndex
      : position.paragraphIndex,
    path,
    k: path[path.length - 1].cellParaIndex,
    offset: position.charOffset,
    textBox: position.isTextBox === true,
  }
}

/** Whether two ends in cells lie in the same table, and with `cell` in the same cell of it. */
function sameTable(a, b, cell) {
  if (a.sec !== b.sec || a.para !== b.para || a.path.length !== b.path.length) return false
  return a.path.every((entry, index) => {
    const other = b.path[index]
    const last = index === a.path.length - 1
    return (
      entry.controlIndex === other.controlIndex &&
      (last
        ? !cell || entry.cellIndex === other.cellIndex
        : entry.cellIndex === other.cellIndex && entry.cellParaIndex === other.cellParaIndex)
    )
  })
}

/** The runs of a selection as they are gathered, with what they add up to. */
function runCollector() {
  const segments = []
  let chars = 0
  return {
    segments,
    /** the characters from..to of paragraph k of a box, when there are any */
    add(box, k, from, to) {
      const length = box.length(k)
      const start = Math.min(Math.max(from, 0), length)
      const end = Math.min(to, length)
      if (end <= start) return
      chars += end - start
      segments.push({
        ...box.place(k, end - start),
        offset: start,
        // the engine's offsets count characters, not a JavaScript string's units
        text: engineSlice(box.text(k, length), start, end),
      })
    },
    tooLong: () => segments.length > MAX_SELECTED_RUNS || chars > MAX_SELECTED_CHARS,
  }
}

/**
 * The text of a table's cells as runs, in reading order: each paragraph of each cell that
 * `wanted` picks (all of them without it), followed by the tables that sit in it.
 */
function collectTable(doc, tables, index, out, wanted) {
  const table = tables[index]
  const inside = tables
    .map((child, at) => ({ child, at }))
    .filter(({ child }) => child.parent === index)
  const grid = wanted ? gridOf(doc, table) : null
  for (let cell = 0; cell < table.cells; cell++) {
    if (grid && !wanted(grid[cell])) continue
    const box = cellBox(doc, table, cell)
    const count = box.count()
    for (let k = 0; k < count; k++) {
      out.add(box, k, 0, Infinity)
      for (const { child, at } of inside) {
        const holder = child.path[child.path.length - 2]
        if (holder.cellIndex === cell && holder.cellParaIndex === k) {
          collectTable(doc, tables, at, out, null)
        }
      }
      if (out.tooLong()) return
    }
  }
}

/**
 * The text between two places of the body as runs, across sections when need be. A table
 * goes in whole when the paragraph it sits in is wholly inside the selection.
 */
function collectBody(doc, tablesNow, start, end, out) {
  for (let sec = start.sec; sec <= end.sec; sec++) {
    const box = containerOf(doc, { sec, para: 0 })
    const last = box.count() - 1
    const first = sec === start.sec ? start.k : 0
    const stop = sec === end.sec ? Math.min(end.k, last) : last
    for (let k = first; k <= stop; k++) {
      const length = box.length(k)
      const from = sec === start.sec && k === start.k ? start.offset : 0
      const to = sec === end.sec && k === end.k ? end.offset : length
      out.add(box, k, from, to)
      if (from <= 0 && to >= length && box.objectPositions(k).length > 0) {
        const tables = tablesNow()
        tables.forEach((table, index) => {
          if (table.parent === null && table.sec === sec && table.para === k) {
            collectTable(doc, tables, index, out, null)
          }
        })
      }
      if (out.tooLong()) return
    }
  }
}

/**
 * The runs of what the selection command saw (`seen`) put into `out` (runCollector, or the
 * status bar's count): a block of cells, a stretch inside one cell, from cell to cell of one
 * table, or across the body, where an end inside a table takes that table whole.
 * { ok: true, inTable }, or { ok: false, reason: 'unsupported' } for a place without an address.
 */
function gatherSelection(doc, seen, out) {
  let known = null
  const tablesNow = () => (known ??= tablesOf(doc).tables)
  const tableAt = (sec, para, path) => {
    const key = tableKey(sec, para, path)
    return tablesNow().findIndex((table) => tableKey(table.sec, table.para, table.path) === key)
  }
  /** the cells a block between two corners covers, a merged cell by any of its places */
  const within = (range, skip) => (cell) =>
    cell.row <= range.endRow &&
    cell.row + cell.rowSpan - 1 >= range.startRow &&
    cell.col <= range.endCol &&
    cell.col + cell.colSpan - 1 >= range.startCol &&
    !skip.has(`${cell.row},${cell.col}`)
  let inTable = false
  if (seen.block) {
    const { table, range, excluded } = seen.block
    const path =
      Array.isArray(table.cellPath) && table.cellPath.length > 0
        ? asCellPath(table.cellPath)
        : [{ controlIndex: table.ci, cellIndex: 0, cellParaIndex: 0 }]
    const index = tableAt(table.sec, table.ppi, path)
    if (index < 0) return { ok: false, reason: 'unsupported' }
    collectTable(doc, tablesNow(), index, out, within(range, new Set(excluded)))
    inTable = true
  } else {
    const start = endOf(seen.start)
    const end = endOf(seen.end)
    if (!start || !end) return { ok: false, reason: 'unsupported' }
    if (start.path && end.path && sameTable(start, end, true)) {
      // inside one cell or text box: its paragraphs
      const box = containerOf(doc, {
        sec: start.sec,
        para: start.para,
        cellPath: start.path,
      })
      for (let k = start.k; k <= end.k; k++) {
        out.add(box, k, k === start.k ? start.offset : 0, k === end.k ? end.offset : Infinity)
      }
      inTable = true
    } else if (start.path && end.path && sameTable(start, end, false)) {
      // from one cell to another of the same table: the block of cells between them
      const index = tableAt(start.sec, start.para, start.path)
      if (index < 0) return { ok: false, reason: 'unsupported' }
      const grid = gridOf(doc, tablesNow()[index])
      const a = grid[start.path[start.path.length - 1].cellIndex]
      const b = grid[end.path[end.path.length - 1].cellIndex]
      if (!a || !b) return { ok: false, reason: 'unsupported' }
      const range = {
        startRow: Math.min(a.row, b.row),
        endRow: Math.max(a.row + a.rowSpan - 1, b.row + b.rowSpan - 1),
        startCol: Math.min(a.col, b.col),
        endCol: Math.max(a.col + a.colSpan - 1, b.col + b.colSpan - 1),
      }
      collectTable(doc, tablesNow(), index, out, within(range, new Set()))
      inTable = true
    } else {
      // across the body: an end inside a table takes that table whole
      collectBody(
        doc,
        tablesNow,
        start.path ? { sec: start.sec, k: start.para, offset: 0 } : start,
        end.path ? { sec: end.sec, k: end.para, offset: Infinity } : end,
        out,
      )
    }
  }
  return { ok: true, inTable }
}

/**
 * Whether the runs are paragraphs of one stretch: in order in the body of a section or in
 * one cell (a paragraph without text between two of them has no run, and does not break
 * the stretch). Only such a selection can be rewritten into more or fewer paragraphs than
 * it has.
 */
function isContiguous(segments) {
  return segments.every((segment, index) => {
    if (index === 0) return true
    const before = segments[index - 1]
    if (segment.sec !== before.sec) return false
    const path = segment.path ?? null
    const pathBefore = before.path ?? null
    if (!path || !pathBefore) return !path && !pathBefore && segment.para > before.para
    const a = { sec: segment.sec, para: segment.para, path }
    const b = { sec: before.sec, para: before.para, path: pathBefore }
    return (
      sameTable(a, b, true) &&
      path[path.length - 1].cellParaIndex > pathBefore[pathBefore.length - 1].cellParaIndex
    )
  })
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u

/**
 * The word around an offset of a text: a run of letters and digits. Null on a blank or a mark.
 * The offset and the word's ends are the engine's, which count characters: an emoji or a Han
 * character outside the basic plane (𠀀) is one there and two units in a JavaScript string.
 */
function wordAt(text, offset) {
  const chars = engineChars(text)
  let at = Math.min(offset, chars.length - 1)
  if (at < 0) return null
  // a click behind the last letter of a word still means that word
  if (!WORD_CHARACTER.test(chars[at]) && at > 0 && WORD_CHARACTER.test(chars[at - 1])) at -= 1
  if (!WORD_CHARACTER.test(chars[at])) return null
  let start = at
  let end = at + 1
  while (start > 0 && WORD_CHARACTER.test(chars[start - 1])) start -= 1
  while (end < chars.length && WORD_CHARACTER.test(chars[end])) end += 1
  return { start, end }
}

/** An engine answer the bridge hands back either parsed or as JSON. */
const answerOf = (value) => (typeof value === 'string' ? parse(value) : value)

/**
 * The caret's paragraph, wherever the caret is: the body or a table cell, a header or footer
 * being edited, or a footnote being edited. `text` is the paragraph's text and `offset` the
 * caret's place in it; `select(from, to)` selects from one such place's offset to another's,
 * `from` staying the anchor. Null in a mode with no text caret (an object, a cell block).
 */
function caretParagraph(services, readText) {
  const input = services && services.getInputHandler ? services.getInputHandler() : null
  const cursor = input ? input.cursor : null
  if (!cursor || !cursor.getPosition) return null
  const elsewhere = ['isInPictureObjectSelection', 'isInCellSelectionMode'].some(
    (mode) => typeof cursor[mode] === 'function' && cursor[mode](),
  )
  if (elsewhere) return null
  if (typeof cursor.isInHeaderFooter === 'function' && cursor.isInHeaderFooter()) {
    const target = {
      sectionIdx: cursor.hfSectionIdx,
      isHeader: cursor.headerFooterMode === 'header',
      applyTo: cursor.hfApplyTo,
    }
    const para = cursor.hfParaIdx
    const info = answerOf(
      services.wasm.getHeaderFooterParaInfo(
        target.sectionIdx,
        target.isHeader,
        target.applyTo,
        para,
      ),
    )
    return {
      input,
      kind: 'header',
      key: `hf:${target.sectionIdx}:${target.isHeader}:${target.applyTo}:${para}`,
      text: String(info?.text ?? ''),
      offset: cursor.hfCharOffset,
      at: (offset) => ({ ...target, paraIdx: para, charOffset: offset }),
      select: (from, to) =>
        cursor.selectHeaderFooterRange(
          from.at(from.offset),
          to.at(to.offset),
          cursor.hfPreviewPage,
        ),
      forward: () => {
        const ordered = cursor.getHeaderFooterSelectionOrdered?.()
        return (
          !ordered ||
          (ordered.end.paraIdx === cursor.hfParaIdx &&
            ordered.end.charOffset === cursor.hfCharOffset)
        )
      },
    }
  }
  if (typeof cursor.isInFootnote === 'function' && cursor.isInFootnote()) {
    const para = cursor.fnInnerParaIdx
    const info = answerOf(
      services.wasm.getFootnoteInfo(cursor.fnSectionIdx, cursor.fnParaIdx, cursor.fnControlIdx),
    )
    return {
      input,
      kind: 'footnote',
      key: `fn:${cursor.fnSectionIdx}:${cursor.fnParaIdx}:${cursor.fnControlIdx}:${para}`,
      text: String(info?.texts?.[para] ?? ''),
      offset: cursor.fnCharOffset,
      at: (offset) => ({ fnParaIdx: para, charOffset: offset }),
      select: (from, to) => {
        cursor.clearSelection()
        cursor.setFnCursorPosition(from.at(from.offset).fnParaIdx, from.offset)
        cursor.setFnAnchor()
        cursor.setFnCursorPosition(to.at(to.offset).fnParaIdx, to.offset)
        return true
      },
      forward: () => {
        const ordered = cursor.getFootnoteSelectionOrdered?.()
        return (
          !ordered ||
          (ordered.end.fnParaIdx === cursor.fnInnerParaIdx &&
            ordered.end.charOffset === cursor.fnCharOffset)
        )
      },
    }
  }
  const position = cursor.getPosition()
  const at = endOf(position)
  if (!at) return null
  return {
    input,
    kind: 'body',
    key: placeKey({ ...at, offset: 0, length: 0 }),
    text: readText(at),
    offset: at.offset,
    at: (offset) => ({ ...position, charOffset: offset }),
    select: (from, to) => {
      cursor.clearSelection()
      cursor.moveTo(from.at(from.offset))
      cursor.setAnchor()
      cursor.moveTo(to.at(to.offset))
      return true
    },
    forward: () => {
      const ordered = cursor.getSelectionOrdered?.()
      if (!ordered) return true
      const now = cursor.getPosition()
      return ['sectionIndex', 'paragraphIndex', 'cellIndex', 'cellParaIndex', 'charOffset'].every(
        (key) => ordered.end[key] === now[key],
      )
    },
  }
}

/** Select from one offset of a caret paragraph to another and show it. */
function selectIn(place, start, end) {
  const done = place.select({ ...place, offset: start }, { ...place, offset: end })
  if (done !== false && place.input.updateCaret) place.input.updateCaret()
  return done !== false
}

/**
 * Select the word the caret is in, the way a double click does in Hangul and every other
 * editor; the studio's own double click only opens headers, text boxes and objects. Works in
 * the body, in cells, and in a header, footer or footnote being edited.
 */
function selectWord(services, readText) {
  const place = caretParagraph(services, readText)
  if (!place) return false
  const word = wordAt(place.text, place.offset)
  if (!word) return false
  return selectIn(place, word.start, word.end)
}

/** Select the whole paragraph the caret is in, as a triple click does in Hangul. */
function selectParagraph(services, readText) {
  const place = caretParagraph(services, readText)
  if (!place || place.text.length === 0) return false
  // to the paragraph's end in the engine's characters
  return selectIn(place, 0, engineLength(place.text))
}

/**
 * A drag begun with a double click selects whole words, as in Hangul: `start` notes the word
 * the drag began on, `move` (after each of the studio's own drag steps, which put the
 * selection's end under the pointer) widens both ends to word boundaries. Returns the drag
 * state, with `widened` once the selection reached past its first word.
 */
function wordDrag(services, readText, drag, phase) {
  const place = caretParagraph(services, readText)
  if (!place) return phase === 'start' ? null : drag
  if (phase === 'start') {
    const word = wordAt(place.text, place.offset)
    return word ? { place, start: word.start, end: word.end, widened: false } : null
  }
  // a paragraph of another kind (out of a header into the body): the studio's selection stays
  if (!drag || place.kind !== drag.place.kind) return drag
  const samePara = place.key === drag.place.key
  if (samePara && place.offset >= drag.start && place.offset <= drag.end) {
    selectIn(drag.place, drag.start, drag.end)
    return drag
  }
  const forward = samePara ? place.offset > drag.end : place.forward()
  const word = wordAt(place.text, place.offset) ?? { start: place.offset, end: place.offset }
  const done = forward
    ? drag.place.select({ ...drag.place, offset: drag.start }, { ...place, offset: word.end })
    : drag.place.select({ ...drag.place, offset: drag.end }, { ...place, offset: word.start })
  if (done !== false && place.input.updateCaret) place.input.updateCaret()
  return { ...drag, widened: true }
}

const placeKey = (place) =>
  [
    place.sec,
    place.para,
    (place.path ?? []).map((e) => `${e.controlIndex}.${e.cellIndex}.${e.cellParaIndex}`).join('/'),
    place.offset,
    place.length,
  ].join(':')

/** The paragraph of the box a segment of a selection is in. */
const segmentBox = (doc, segment) => {
  const box = containerOf(doc, { sec: segment.sec, para: segment.para, cellPath: segment.path })
  return { box, k: box.index }
}

/** A selection as the panel handed it back: a list of runs, one per paragraph. */
function checkSegments(segments) {
  const ok =
    Array.isArray(segments) &&
    segments.length > 0 &&
    segments.length <= MAX_SELECTED_RUNS &&
    segments.every(
      (segment) =>
        segment &&
        Number.isInteger(segment.sec) &&
        Number.isInteger(segment.para) &&
        Number.isInteger(segment.offset) &&
        Number.isInteger(segment.length) &&
        segment.offset >= 0 &&
        segment.length >= 0 &&
        typeof segment.text === 'string',
    )
  if (!ok) throw fail('BAD_ARGUMENT', 'the selection is not one this editor handed out')
}

/** Whether every run still holds the text it held when the selection was read. */
function segmentsStand(doc, segments) {
  return segments.every((segment) => {
    try {
      const { box, k } = segmentBox(doc, segment)
      const whole = box.text(k, box.length(k))
      return engineSlice(whole, segment.offset, segment.offset + segment.length) === segment.text
    } catch {
      return false
    }
  })
}

/** Text inside an equation is a script, not prose: it has no replace path here. */
const isReplaceable = (hit) => hit.equationControl === undefined

function contextOf(doc, hit) {
  const start = Math.max(0, hit.charOffset - CONTEXT_CHARS)
  const path = cellPathOf(hit)
  if (path) {
    const json = JSON.stringify(path)
    const length = doc.getCellParagraphLengthByPath(hit.sec, hit.para, json)
    const count = Math.min(length - start, hit.length + CONTEXT_CHARS * 2)
    return count > 0 ? doc.getTextInCellByPath(hit.sec, hit.para, json, start, count) : ''
  }
  const length = doc.getParagraphLength(hit.sec, hit.para)
  const count = Math.min(length - start, hit.length + CONTEXT_CHARS * 2)
  return count > 0 ? doc.getTextRange(hit.sec, hit.para, start, count) : ''
}

/**
 * The nearest paragraph in front of a match, in its cell or section, that is not blank and
 * does not hold the matched text: under several "○ " lines that is their heading, which
 * tells the matches apart where the text around them is the same.
 */
function beforeOf(doc, hit) {
  const box = containerOf(doc, hit)
  const own = box.text(box.index, box.length(box.index))
  const found = own.slice(hit.charOffset, hit.charOffset + hit.length)
  for (let k = box.index - 1; k >= 0 && k >= box.index - BEFORE_LOOKBACK; k--) {
    const text = squash(box.text(k, box.length(k)))
    if (text && !text.includes(squash(found))) return clip(text, BEFORE_CHARS)
  }
  return ''
}

function describe(doc, hit, index) {
  const row = { occurrence: index + 1, inTable: Boolean(hit.cellContext) }
  if (!isReplaceable(hit)) return { ...row, replaceable: false }
  let described = row
  try {
    described = { ...row, context: contextOf(doc, hit) }
    const before = beforeOf(doc, hit)
    if (before) described.before = before
  } catch {
    // the surrounding text is a courtesy; the match itself is still valid
  }
  return described
}

function searchAll(doc, find) {
  if (typeof find !== 'string' || find.length === 0) {
    throw fail('BAD_ARGUMENT', 'find must be a non-empty string')
  }
  return parse(doc.searchAllText(find, true, true))
}

function checkReplacement(replacement) {
  if (typeof replacement !== 'string' || CONTROL_CHARS.test(replacement)) {
    throw fail('BAD_ARGUMENT', 'replacement must be one line of plain text')
  }
}

/** A replacement of text in a line: one line, where a tab is text as in a new paragraph. */
function checkLineText(replacement) {
  if (typeof replacement !== 'string' || PARAGRAPH_CONTROL_CHARS.test(replacement)) {
    throw fail('BAD_ARGUMENT', 'replacement must be one line of plain text')
  }
}

function expectOk(json, what) {
  const result = parse(json)
  if (result && result.ok === false) throw fail('ENGINE_REFUSED', `the editor refused to ${what}`)
}

/** How many engine characters (code points) the one-call cell replace takes at a time. */
const MAX_CELL_REPLACE_CHARS = 8

/** The first part of a cell replacement the engine takes at once, whole code points only. */
function cellReplaceHead(text) {
  // the engine's one-call cell replace refuses a tab, so the head stops in front of one
  return Array.from(text.split('\t')[0]).slice(0, MAX_CELL_REPLACE_CHARS).join('')
}

/**
 * The caret place of a character of a body paragraph: its offset in the text plus one for
 * every object of the line in front of it that the engine counts as a character (an
 * equation, a footnote mark, a picture set as a character).
 */
const caretOf = (doc, hit, offset) => doc.textToLogicalOffset(hit.sec, hit.para, offset)

/**
 * The engine would leave such an object behind the new text. A cell paragraph cannot be
 * asked (the engine converts offsets of body paragraphs only).
 */
function spansObject(doc, hit) {
  if (cellPathOf(hit) || hit.length < 2) return false
  const { charOffset: start, length } = hit
  return caretOf(doc, hit, start + length) - caretOf(doc, hit, start + 1) > length - 1
}

const followsObject = (doc, hit) =>
  hit.length > 0 && caretOf(doc, hit, hit.charOffset + 1) - caretOf(doc, hit, hit.charOffset) > 1

function replaceHit(doc, hit, replacement) {
  const path = cellPathOf(hit)
  if (!path) {
    const { sec, para, charOffset: start, length } = hit
    if (replacement.length > 0 && followsObject(doc, hit)) {
      // the engine types new text in front of an object that stands at its place, which
      // would put the object behind the new text
      expectOk(doc.replaceText(sec, para, start + 1, length - 1, replacement), 'replace')
      expectOk(doc.deleteText(sec, para, start, 1), 'replace')
      return
    }
    expectOk(doc.replaceText(sec, para, start, length, replacement), 'replace')
    return
  }
  const json = JSON.stringify(path)
  if (replacement.length === 0) {
    // an empty replacement is a deletion: a memo whose whole anchor goes with it is the
    // engine's removal, which the memo guard asks the user about
    expectOk(
      doc.deleteTextInCellByPath(hit.sec, hit.para, json, hit.charOffset, hit.length),
      'delete',
    )
    return
  }
  const last = path[path.length - 1]
  const head = cellReplaceHead(replacement)
  if (
    path.length === 1 &&
    typeof doc.replaceTextInCellDeferredPagination === 'function' &&
    head !== ''
  ) {
    // one engine call keeps a memo on the replaced text. It removes and puts in up to eight
    // characters (code points) each, so a longer match is first worn down from its end,
    // eight characters to one per call (a plain delete would take a memo that lies wholly
    // in the part it removes), and a longer replacement is the head in the last call and
    // the rest typed right after it. The engine counts its offsets (and the match's) in
    // characters, not UTF-16 units.
    let removed = hit.length
    while (removed > MAX_CELL_REPLACE_CHARS) {
      const start = removed - MAX_CELL_REPLACE_CHARS
      expectOk(
        doc.replaceTextInCellDeferredPagination(
          hit.sec,
          hit.para,
          last.controlIndex,
          last.cellIndex,
          last.cellParaIndex,
          hit.charOffset + start,
          MAX_CELL_REPLACE_CHARS,
          ' ',
        ),
        'replace',
      )
      removed = start + 1
    }
    const headLength = Array.from(head).length
    const total = Array.from(replacement).length
    expectOk(
      doc.replaceTextInCellDeferredPagination(
        hit.sec,
        hit.para,
        last.controlIndex,
        last.cellIndex,
        last.cellParaIndex,
        hit.charOffset,
        removed,
        head,
      ),
      'replace',
    )
    if (headLength < total) {
      expectOk(
        doc.insertTextInCellByPath(
          hit.sec,
          hit.para,
          json,
          hit.charOffset + headLength,
          replacement.slice(head.length),
        ),
        'insert',
      )
    }
    return
  }
  // a table inside a table cell has no path-taking one-call replace; an engine without it
  // (an older build) is written as delete + insert too
  expectOk(
    doc.deleteTextInCellByPath(hit.sec, hit.para, json, hit.charOffset, hit.length),
    'delete',
  )
  expectOk(
    doc.insertTextInCellByPath(hit.sec, hit.para, json, hit.charOffset, replacement),
    'insert',
  )
}

/** A split offset past the end of any paragraph: the engine takes it as the paragraph's end. */
const PAST_PARAGRAPH_END = 0x3fffffff

/**
 * The engine splits at a caret place, where an object of the line (an equation, a footnote
 * mark, a picture set as a character) counts as one character, so a split can land in front
 * of the place its caller counted in characters.
 */
function splitKeepingText(length, k, textOffset, split) {
  const whole = length(k)
  const kept = Math.min(textOffset, whole)
  split()
  if (length(k) !== kept || length(k + 1) !== whole - kept) {
    throw fail('HAS_OBJECTS', 'the split would have moved text of the paragraph')
  }
}

/** The engine's names for a numbering restart, as setNumberingRestart takes them. */
const RESTART_CONTINUE = 1
const RESTART_NEW_START = 2

/**
 * What to do with a break asked for on a paragraph, from what the engine says the paragraph
 * carried (`meta`, the removedParaMeta of the join in insertBreak). The engine's break call
 * leaves the paragraph's break and its numbering restart on the half that is joined away:
 * - `already`: the paragraph starts a page (or a column, when a column is asked for);
 * - `refuse`: it starts a part with other columns or a section, a mark the break replaces;
 * - `restart`: go on, and set this numbering restart on the paragraph again (null: none).
 */
function breakOutcome(meta, kind) {
  const { column_type: had, numbering_restart: numbering } = meta ?? {}
  if (typeof had !== 'string') throw fail('ENGINE', 'the break could not be read')
  if (had === 'Page' || (had === 'Column' && kind === 'column')) {
    return { already: had.toLowerCase() }
  }
  if (had !== 'None' && had !== 'Column') return { refuse: 'layout_start' }
  if (numbering === null) return { restart: null }
  if (numbering === 'ContinuePrevious') return { restart: [RESTART_CONTINUE, 0] }
  if (Number.isInteger(numbering?.NewStart)) {
    return { restart: [RESTART_NEW_START, numbering.NewStart] }
  }
  throw fail('ENGINE', 'the numbering of the paragraph could not be read')
}

/**
 * The run of paragraphs a match sits in (the body of a section, or one table cell) with the
 * engine calls that address a paragraph of it by index. `index` is the matched paragraph.
 */
function containerOf(doc, hit) {
  const { sec, para } = hit
  const path = cellPathOf(hit)
  if (!path) {
    const lengthOf = (k) => doc.getParagraphLength(sec, k)
    return {
      index: para,
      inTable: false,
      place: (k, length) => ({ sec, para: k, offset: 0, length }),
      count: () => doc.getParagraphCount(sec),
      length: lengthOf,
      text: (k, count) => (count > 0 ? doc.getTextRange(sec, k, 0, count) : ''),
      // tables, pictures and the like sit in a paragraph without being its text; each one
      // has a place among the characters (the first paragraph of a document always holds
      // some: its section and column definitions). A memo is left out: it is a field the
      // memo guard watches, and a paragraph may be changed around it.
      objectPositions: (k) => memoFreeObjectPositions(doc, sec, k),
      split: (k, textOffset) =>
        splitKeepingText(lengthOf, k, textOffset, () =>
          expectOk(
            doc.splitParagraph(sec, k, doc.textToLogicalOffset(sec, k, textOffset)),
            'split the paragraph',
          ),
        ),
      splitEnd: (k) =>
        splitKeepingText(lengthOf, k, lengthOf(k), () =>
          expectOk(doc.splitParagraph(sec, k, doc.getLogicalLength(sec, k)), 'split the paragraph'),
        ),
      runLooks: (k, length) =>
        parse(doc.getCharShapeRuns(sec, k, 0, length)).map((run) =>
          parse(doc.getCharPropertiesAt(sec, k, run.startOffset ?? 0)),
        ),
      // an empty paragraph after k without splitting k: it takes k's paragraph formatting
      addAfter: (k) => expectOk(doc.insertParagraph(sec, k + 1), 'add a paragraph'),
      insert: (k, text) => expectOk(doc.insertText(sec, k, 0, text), 'insert'),
      deleteText: (k, count) => expectOk(doc.deleteText(sec, k, 0, count), 'delete'),
      deleteRange: (k1, o1, k2, o2) => expectOk(doc.deleteRange(sec, k1, o1, k2, o2), 'delete'),
      remove: (k) => expectOk(doc.deleteParagraph(sec, k), 'remove the paragraph'),
      pasteHtml: (k, html) => expectOk(doc.pasteHtml(sec, k, 0, html), 'insert the table'),
      formatChars: (k, start, end, json) =>
        expectOk(doc.applyCharFormat(sec, k, start, end, json), 'format the text'),
      formatParagraph: (k, json) =>
        expectOk(doc.applyParaFormat(sec, k, json), 'format the paragraph'),
      applyStyle: (k, id) => expectOk(doc.applyStyle(sec, k, id), 'apply the style'),
      // a character style is its character shape on the text: the engine's applyStyle
      // would give it to the whole paragraph
      setCharShape: (k, start, end, id) =>
        expectOk(doc.setCharShapeId(sec, k, start, end, id), 'apply the character style'),
      styleShape: (k) => ({
        style: parse(doc.getStyleAt(sec, k)).id,
        paraShape: parse(doc.getParaPropertiesAt(sec, k)).paraShapeId,
      }),
    }
  }
  const last = path[path.length - 1]
  const at = (k) => JSON.stringify([...path.slice(0, -1), { ...last, cellParaIndex: k }])
  const lengthOf = (k) => doc.getCellParagraphLengthByPath(sec, para, at(k))
  return {
    index: last.cellParaIndex,
    inTable: true,
    place: (k, length) => ({ sec, para, path: parse(at(k)), offset: 0, length }),
    count: () => doc.getCellParagraphCountByPath(sec, para, at(0)),
    length: lengthOf,
    text: (k, count) => (count > 0 ? doc.getTextInCellByPath(sec, para, at(k), 0, count) : ''),
    // the engine cannot be asked this for a cell paragraph; the before/after check of the
    // callers (keepingObjects) is what protects an object there
    objectPositions: () => [],
    runLooks: (k, length) =>
      parse(doc.getCharShapeRunsInCellByPath(sec, para, at(k), 0, length)).map((run) =>
        parse(doc.getCellCharPropertiesAtByPath(sec, para, at(k), run.startOffset ?? 0)),
      ),
    // the engine has no caret place to ask for in a cell paragraph
    split: (k, textOffset) =>
      splitKeepingText(lengthOf, k, textOffset, () =>
        expectOk(
          doc.splitParagraphInCellByPath(sec, para, at(k), textOffset),
          'split the paragraph',
        ),
      ),
    splitEnd: (k) =>
      splitKeepingText(lengthOf, k, lengthOf(k), () =>
        expectOk(
          doc.splitParagraphInCellByPath(sec, para, at(k), PAST_PARAGRAPH_END),
          'split the paragraph',
        ),
      ),
    insert: (k, text) => expectOk(doc.insertTextInCellByPath(sec, para, at(k), 0, text), 'insert'),
    deleteText: (k, count) =>
      expectOk(doc.deleteTextInCellByPath(sec, para, at(k), 0, count), 'delete'),
    deleteRange: (k1, o1, k2, o2) =>
      expectOk(doc.deleteRangeInCellByPath(sec, para, at(k1), k1, o1, k2, o2), 'delete'),
    // the engine removes a paragraph of the body only
    remove: (k) =>
      expectOk(
        doc.deleteRangeInCellByPath(sec, para, at(k - 1), k - 1, lengthOf(k - 1), k, lengthOf(k)),
        'remove the paragraph',
      ),
    pasteHtml: (k, html) =>
      expectOk(doc.pasteHtmlInCellByPath(sec, para, at(k), 0, html), 'insert the table'),
    formatChars: (k, start, end, json) =>
      expectOk(
        doc.applyCharFormatInCellByPath(sec, para, at(k), start, end, json),
        'format the text',
      ),
    // the engine formats a cell paragraph by table and cell number only, which cannot name
    // a cell of a table inside another table's cell
    formatParagraph:
      path.length === 1
        ? (k, json) =>
            expectOk(
              doc.applyParaFormatInCell(sec, para, last.controlIndex, last.cellIndex, k, json),
              'format the paragraph',
            )
        : null,
    applyStyle:
      path.length === 1
        ? (k, id) =>
            expectOk(
              doc.applyCellStyle(sec, para, last.controlIndex, last.cellIndex, k, id),
              'apply the style',
            )
        : null,
    setCharShape: (k, start, end, id) =>
      expectOk(
        doc.setCharShapeIdInCellByPath(sec, para, at(k), start, end, id),
        'apply the character style',
      ),
    styleShape:
      path.length === 1
        ? (k) => ({
            style: parse(doc.getCellStyleAt(sec, para, last.controlIndex, last.cellIndex, k)).id,
            paraShape: parse(
              doc.getCellParaPropertiesAt(sec, para, last.controlIndex, last.cellIndex, k),
            ).paraShapeId,
          })
        : null,
  }
}

/**
 * What an edit must leave alone: the objects of the document and the field values. An edit
 * that fills cells names the fields it sets itself (`ignore`, by field id); the value of a
 * named cell is its text, so those are not watched then either.
 */
function objectsOf(doc, ignore = null) {
  // memos are fields of their own but are watched by the memo guard: their text is the
  // anchor text, which changes whenever that text is edited. The engine also lists each
  // memo among the paragraph's controls, so those controls are left out of the count.
  const all = parse(doc.getFieldList())
  const fields = all.filter((field) => field.fieldType !== 'memo')
  const watched = ignore
    ? fields.filter((field) => field.cellField !== true && !ignore.has(field.fieldId))
    : fields
  const controls = parse(doc.getControls())
  const unnamed = controls.filter((control) => control.ctrlId === '' && control.ctrlCh === 0)
  const used = new Set()
  let memoControls = 0
  for (const memo of all.filter((field) => field.fieldType === 'memo')) {
    const index = unnamed.findIndex(
      (control, at) =>
        !used.has(at) &&
        Number.isInteger(memo.listId) &&
        control.list === memo.listId &&
        control.para === memo.paraInList,
    )
    if (index < 0) continue
    used.add(index)
    memoControls += 1
  }
  return {
    controls: controls.length - memoControls,
    fields: JSON.stringify(watched.map((field) => field.value ?? '')),
  }
}

/**
 * The places of the controls of a body paragraph, without the memos: a memo is a field
 * that the memo guard watches, not an object that a paragraph edit must step around.
 */
function memoFreeObjectPositions(doc, sec, para) {
  const positions = parse(doc.getControlTextPositions(sec, para))
  const starts = memoEntriesOf(doc)
    .filter(
      (entry) => entry.place === 'body' && entry.sectionIndex === sec && entry.paraIndex === para,
    )
    .map((entry) => entry.startCharIdx)
    .filter((offset) => Number.isInteger(offset))
  return positions.filter((position) => !starts.includes(position))
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const ALIGNMENTS = ['left', 'center', 'right', 'justify']
const TOGGLES = ['bold', 'italic', 'underline', 'strikethrough']

/** Longest font name taken; real names are far shorter. */
const MAX_FONT_NAME = 64
/** The font languages of a character shape: Hangul, Latin, Hanja, Japanese, other, symbol, user. */
const FONT_LANGUAGES = 7
/** Paragraph indents, margins and spacing come to the engine at twice their HWPUNIT, 100 to a point. */
const PARA_UNITS_PER_PT = 200
/** What a paragraph's indent, margins and spacing may be set to, in points. */
const PARA_LENGTHS = {
  indent: { min: -100, max: 100, key: 'indent' },
  marginLeft: { min: 0, max: 300, key: 'marginLeft' },
  marginRight: { min: 0, max: 300, key: 'marginRight' },
  spacingBefore: { min: 0, max: 200, key: 'spacingBefore' },
  spacingAfter: { min: 0, max: 200, key: 'spacingAfter' },
}
/** What a paragraph's list may be: numbered, bulleted, or none (the head type the editor sets). */
const LIST_KINDS = ['number', 'bullet', 'none']
/** Levels a list paragraph may take (Hangul numbers seven). */
const MAX_LIST_LEVEL = 7
/** The bullet the editor's bullet button puts. */
const DEFAULT_BULLET = '●'
/** Style kinds as the engine lists them: paragraph styles are 0, character styles 1. */
const PARAGRAPH_STYLE = 0
const CHARACTER_STYLE = 1
/** The editor toolbar's style list: one option per style, its value the style's number. */
const STYLE_LIST_SELECTOR = '#style-name'
/** How long the document rests before the toolbar's style list is checked against it. */
const STYLE_LIST_PAUSE_MS = 400
/** The command this plugin registers to have the editor show the caret's style again. */
const CARET_STATE_COMMAND = 'ext:ieum-caret-state'

/**
 * Fill the editor toolbar's style list (`select`) with the document's styles (as
 * getStyleList gives them) when they differ from what it shows. The number shown stays
 * shown when there still is a style by it: the editor sets the list by the number of the
 * caret's style, which may already be the new one. Returns whether the list was refilled.
 */
export function syncStyleList(select, styles) {
  const shown = Array.from(select.options, (option) => [Number(option.value), option.textContent])
  if (JSON.stringify(shown) === JSON.stringify(styles.map((style) => [style.id, style.name]))) {
    return false
  }
  const current = select.value
  select.replaceChildren(
    ...styles.map((style) => {
      const option = select.ownerDocument.createElement('option')
      option.value = String(style.id)
      option.textContent = style.name
      return option
    }),
  )
  if (styles.some((style) => String(style.id) === current)) select.value = current
  else select.selectedIndex = -1
  return true
}

/** Longest style name taken, as the editor's style dialog has it. */
const MAX_STYLE_NAME = 250
/** Not in a style name, besides control characters: the engine reads names out of JSON without unescaping them. */
const STYLE_NAME_QUOTES = /["\\]/

/**
 * A format request, checked. `chars` and `paragraph` hold what was asked for, null when
 * nothing of that kind was; `font` and `style` are names the document resolves when the
 * change is made (resolveFormat). Only what was asked for is set, so everything else about
 * the text stays as it is.
 */
function formatOf(format, allowParagraph) {
  if (!format || typeof format !== 'object' || Array.isArray(format)) {
    throw fail('BAD_ARGUMENT', 'format must be an object')
  }
  const given = (key) => format[key] !== undefined && format[key] !== null
  const chars = {}
  for (const key of TOGGLES) {
    if (!given(key)) continue
    if (typeof format[key] !== 'boolean') throw fail('BAD_ARGUMENT', `${key} must be true or false`)
    chars[key] = format[key]
  }
  if (given('size')) {
    if (
      typeof format.size !== 'number' ||
      !(format.size >= MIN_FONT_PT && format.size <= MAX_FONT_PT)
    ) {
      throw fail('BAD_ARGUMENT', `size must be ${MIN_FONT_PT} to ${MAX_FONT_PT} points`)
    }
    // the engine counts in hundredths of a point
    chars.fontSize = Math.round(format.size * 100)
  }
  if (given('color')) {
    if (typeof format.color !== 'string' || !HEX_COLOR.test(format.color)) {
      throw fail('BAD_ARGUMENT', 'color must look like #RRGGBB')
    }
    chars.textColor = format.color.toLowerCase()
  }
  if (given('highlight')) {
    const none = format.highlight === 'none'
    if (!none && (typeof format.highlight !== 'string' || !HEX_COLOR.test(format.highlight))) {
      throw fail('BAD_ARGUMENT', 'highlight must look like #RRGGBB, or be "none"')
    }
    // no highlight is a white one: the engine has no other way to say it here
    chars.shadeColor = none ? '#ffffff' : format.highlight.toLowerCase()
  }
  // Hangul's 장평 and 자간, the same for every script of the text
  for (const [name, key, { min, max }] of [
    ['charWidth', 'ratios', CHAR_WIDTH_PERCENT],
    ['letterSpacing', 'spacings', LETTER_SPACING_PERCENT],
  ]) {
    if (!given(name)) continue
    const percent = format[name]
    if (typeof percent !== 'number' || !(percent >= min && percent <= max)) {
      throw fail('BAD_ARGUMENT', `${name} must be ${min} to ${max} percent`)
    }
    chars[key] = Array(FONT_LANGUAGES).fill(Math.round(percent))
  }
  let font = null
  if (given('font')) {
    const name = typeof format.font === 'string' ? format.font.trim() : ''
    if (!name || name.length > MAX_FONT_NAME || CONTROL_CHARS.test(name)) {
      throw fail('BAD_ARGUMENT', `font must be a font name of 1 to ${MAX_FONT_NAME} characters`)
    }
    font = name
  }
  const paragraph = {}
  // a border round the paragraph, or on some of its sides, and a colour behind it.
  // Neighbours with the same border are drawn as one box.
  if (given('border')) {
    try {
      Object.assign(paragraph, paragraphBorderOf(format.border), { borderConnect: true })
    } catch (thrown) {
      throw fail('BAD_ARGUMENT', thrown.message)
    }
  }
  // tab stops: resolveFormat turns them into the engine's, which are measured from the
  // left edge of the text and so need the width of the page
  if (given('tabs')) {
    try {
      paragraph.tabs = tabStopsOf(format.tabs)
    } catch (thrown) {
      throw fail('BAD_ARGUMENT', thrown.message)
    }
  }
  if (given('background')) {
    const none = format.background === 'none'
    if (!none && (typeof format.background !== 'string' || !HEX_COLOR.test(format.background))) {
      throw fail('BAD_ARGUMENT', 'background must look like #RRGGBB, or be "none"')
    }
    if (none) paragraph.fillType = 'none'
    else {
      paragraph.fillType = 'solid'
      paragraph.fillColor = format.background.toLowerCase()
      paragraph.patternType = -1
    }
  }
  if (given('align')) {
    if (!ALIGNMENTS.includes(format.align)) {
      throw fail('BAD_ARGUMENT', `align must be one of ${ALIGNMENTS.join(', ')}`)
    }
    paragraph.alignment = format.align
  }
  if (given('lineSpacing')) {
    const percent = format.lineSpacing
    if (
      typeof percent !== 'number' ||
      !(percent >= MIN_LINE_SPACING && percent <= MAX_LINE_SPACING)
    ) {
      throw fail(
        'BAD_ARGUMENT',
        `lineSpacing must be ${MIN_LINE_SPACING} to ${MAX_LINE_SPACING} percent`,
      )
    }
    paragraph.lineSpacing = Math.round(percent)
    paragraph.lineSpacingType = 'Percent'
  }
  for (const [name, { min, max, key }] of Object.entries(PARA_LENGTHS)) {
    if (!given(name)) continue
    const points = format[name]
    if (typeof points !== 'number' || !(points >= min && points <= max)) {
      throw fail('BAD_ARGUMENT', `${name} must be ${min} to ${max} points`)
    }
    paragraph[key] = Math.round(points * PARA_UNITS_PER_PT)
  }
  if (given('list')) {
    if (!LIST_KINDS.includes(format.list)) {
      throw fail('BAD_ARGUMENT', `list must be one of ${LIST_KINDS.join(', ')}`)
    }
    // resolveFormat turns this into the engine's head type and numbering in the change
    paragraph.list = { kind: format.list, level: 0, bullet: DEFAULT_BULLET }
  }
  if (given('listLevel')) {
    if (!paragraph.list || paragraph.list.kind === 'none') {
      throw fail('BAD_ARGUMENT', 'listLevel goes with list "number" or "bullet"')
    }
    const level = format.listLevel
    if (!Number.isInteger(level) || level < 1 || level > MAX_LIST_LEVEL) {
      throw fail('BAD_ARGUMENT', `listLevel must be a whole number from 1 to ${MAX_LIST_LEVEL}`)
    }
    paragraph.list.level = level - 1
  }
  if (given('bullet')) {
    if (paragraph.list?.kind !== 'bullet') {
      throw fail('BAD_ARGUMENT', 'bullet goes with list "bullet"')
    }
    if (
      typeof format.bullet !== 'string' ||
      [...format.bullet].length !== 1 ||
      CONTROL_CHARS.test(format.bullet) ||
      format.bullet.trim() === ''
    ) {
      throw fail('BAD_ARGUMENT', 'bullet must be one visible character')
    }
    paragraph.list.bullet = format.bullet
  }
  let style = null
  if (given('style')) {
    const name = typeof format.style === 'string' ? format.style.trim() : ''
    if (!name || CONTROL_CHARS.test(name)) throw fail('BAD_ARGUMENT', 'style must be a style name')
    style = name
  }
  let charStyle = null
  if (given('charStyle')) {
    const name = typeof format.charStyle === 'string' ? format.charStyle.trim() : ''
    if (!name || CONTROL_CHARS.test(name)) {
      throw fail('BAD_ARGUMENT', 'charStyle must be a style name')
    }
    charStyle = name
  }
  const hasChars = Object.keys(chars).length > 0 || font !== null || charStyle !== null
  const hasParagraph = Object.keys(paragraph).length > 0 || style !== null
  if (hasParagraph && !allowParagraph) {
    throw fail(
      'BAD_ARGUMENT',
      'align, lineSpacing, indents, margins, spacing, border, background, tabs, list and style belong to a whole paragraph',
    )
  }
  if (!hasChars && !hasParagraph) throw fail('BAD_ARGUMENT', 'format names nothing to change')
  if (given('everyWord') && typeof format.everyWord !== 'boolean') {
    throw fail('BAD_ARGUMENT', 'everyWord must be true or false')
  }
  return {
    chars: Object.keys(chars).length > 0 || font !== null ? chars : null,
    font,
    paragraph: Object.keys(paragraph).length > 0 ? paragraph : null,
    style,
    charStyle,
    everyWord: format.everyWord === true,
  }
}

const FORMAT_NAME_OF_RUN_KEY = {
  fontSize: 'size',
  textColor: 'color',
  shadeColor: 'highlight',
  ratios: 'charWidth',
  spacings: 'letterSpacing',
  fontFamilies: 'font',
  charShapeId: 'charStyle',
}

function wordsSetApart(spec, paragraphs) {
  if (spec.everyWord) return null
  const keys = [
    ...Object.keys(spec.chars ?? {}),
    ...(spec.font ? ['fontFamilies'] : []),
    ...(spec.charStyle ? ['charShapeId'] : []),
  ]
  if (keys.length === 0) return null
  const properties = new Set()
  let count = 0
  for (const [box, k] of paragraphs) {
    const length = box.length(k)
    if (length === 0) continue
    const runs = box.runLooks(k, length)
    const apart = keys.filter(
      (key) => new Set(runs.map((run) => JSON.stringify(run[key]))).size > 1,
    )
    if (apart.length === 0) continue
    count += 1
    for (const key of apart) properties.add(FORMAT_NAME_OF_RUN_KEY[key] ?? key)
  }
  return properties.size > 0
    ? { ok: false, reason: 'words_set_apart', properties: [...properties], paragraphs: count }
    : null
}

/** The style called `name` (its own or its English name), of `type` unless that is null. */
function styleNamed(doc, name, type) {
  const wanted = name.toLowerCase()
  return (
    parse(doc.getStyleList()).find(
      (candidate) =>
        (type === null || candidate.type === type) &&
        (String(candidate.name ?? '').toLowerCase() === wanted ||
          String(candidate.englishName ?? '').toLowerCase() === wanted),
    ) ?? null
  )
}

/** The number of the paragraph style called `name` (its own or its English name), or null. */
function styleIdOf(doc, name) {
  return styleNamed(doc, name, PARAGRAPH_STYLE)?.id ?? null
}

/** A refusal for a style the document does not have, with the ones of that kind it has. */
const noSuchStyle = (doc, type = PARAGRAPH_STYLE) => ({
  ok: false,
  reason: 'no_such_style',
  kind: type === null ? 'any' : type === CHARACTER_STYLE ? 'character' : 'paragraph',
  styles: parse(doc.getStyleList())
    .filter((style) => type === null || style.type === type)
    .map((style) => style.name),
})

/** The refusal for a format whose paragraph or character style the document lacks, or null. */
function missingStyle(doc, spec) {
  if (spec.style && styleIdOf(doc, spec.style) === null) return noSuchStyle(doc)
  if (spec.charStyle && styleNamed(doc, spec.charStyle, CHARACTER_STYLE) === null) {
    return noSuchStyle(doc, CHARACTER_STYLE)
  }
  return null
}

/**
 * Whether the paragraph has formatting of its own that applyStyle will keep: its paragraph
 * shape differs from the shape of its style so far. The engine, as Hangul does, keeps the
 * properties that differ and takes the rest from the new style (engine patch 0013). Null
 * where it cannot be asked.
 */
function keepsOwnLook(doc, box, k) {
  if (!box.styleShape) return null
  const { style, paraShape } = box.styleShape(k)
  const old = parse(doc.getStyleList()).find((candidate) => candidate.id === style)
  return old ? old.paraShapeId !== paraShape : false
}

/**
 * A colour that says nothing about the answer: black text, or white on a dark fill.
 */
const ANSWER_COLORS = new Set(['#000000', '#ffffff'])

/**
 * The formatting that makes text a filled answer: black and upright, the way Hangul shows
 * the value of a filled click-here field. Null when the text already looks that way, or
 * when its colour is white (white text sits on a dark fill and is meant to stay white).
 * Font, size, bold, underline and strikethrough are kept: only a guide's colour and slant
 * are dropped.
 */
function answerFormatOf(chars) {
  const color = typeof chars.textColor === 'string' ? chars.textColor.toLowerCase() : ''
  const recolour = color !== '' && !ANSWER_COLORS.has(color)
  const upright = chars.italic === true
  if (!recolour && !upright) return null
  return JSON.stringify({
    ...(recolour ? { textColor: '#000000' } : {}),
    ...(upright ? { italic: false } : {}),
  })
}

/** Make the text [0, length) of paragraph k of a table cell look like an answer. */
function plainAnswerInCell(doc, table, cell, k, length) {
  if (!Number.isInteger(length) || length <= 0) return
  const path = JSON.stringify(cellAt(table.path, cell, k))
  let format
  try {
    format = answerFormatOf(
      parse(doc.getCellCharPropertiesAtByPath(table.sec, table.para, path, 0)),
    )
  } catch {
    return // the text cannot be read back: it stays as the engine wrote it
  }
  if (!format) return
  expectOk(
    doc.applyCharFormatInCellByPath(table.sec, table.para, path, 0, length, format),
    'write the answer',
  )
}

/** What tells one field from another: fields copied and pasted share their id, not their place. */
const fieldKey = (field) =>
  `${field.fieldId}|${JSON.stringify(field.location ?? null)}|${field.startCharIdx ?? ''}`

/**
 * Set the value of the field with this key (fieldKey: id, place and start). The
 * engine sets a value by field id, and a form whose fields were copied and pasted carries
 * the same id on several fields: setting by id then always writes the first of them. Such a
 * field is written where it stands instead, its text replaced in place, and the result is
 * checked: this field holds the value and its namesakes kept theirs (text typed at the start
 * of an empty field lands in it). When that cannot be done the call fails and the change is
 * rolled back, rather than write another field.
 */
function setFieldAt(doc, key, value) {
  const before = parse(doc.getFieldList())
  const index = before.findIndex((other) => fieldKey(other) === key)
  const field = before[index]
  if (!field) throw fail('CHANGED', 'the document changed mid-call')
  const twins = before.filter((other) => other.fieldId === field.fieldId).length
  if (twins < 2) {
    expectOk(doc.setFieldValue(field.fieldId, value), 'fill the field')
    return
  }
  const ambiguous = () =>
    fail(
      'AMBIGUOUS_FIELD',
      `field ${index + 1} shares its id with ${twins - 1} other field(s) and could not be filled on its own`,
    )
  const at = field.location
  const start = field.startCharIdx
  const end = field.endCharIdx
  const path = at && Array.isArray(at.path) ? at.path : []
  if (!at || !Number.isInteger(start) || !Number.isInteger(end) || end < start) {
    throw ambiguous()
  }
  if (path.length > 0) {
    if (!path.every((entry) => entry.type === 'cell')) throw ambiguous()
    const json = JSON.stringify(
      path.map((entry) => ({
        controlIndex: entry.controlIndex,
        cellIndex: entry.cellIndex,
        cellParaIndex: entry.paraIndex,
      })),
    )
    if (end > start) {
      expectOk(
        doc.deleteTextInCellByPath(at.sectionIndex, at.paraIndex, json, start, end - start),
        'fill the field',
      )
    }
    if (value) {
      expectOk(
        doc.insertTextInCellByPath(at.sectionIndex, at.paraIndex, json, start, value),
        'fill the field',
      )
    }
  } else {
    if (end > start) {
      expectOk(doc.deleteText(at.sectionIndex, at.paraIndex, start, end - start), 'fill the field')
    }
    if (value)
      expectOk(doc.insertText(at.sectionIndex, at.paraIndex, start, value), 'fill the field')
  }
  const after = parse(doc.getFieldList())
  const kept =
    after.length === before.length &&
    after[index]?.value === value &&
    before.every(
      (other, k) =>
        k === index || other.fieldId !== field.fieldId || after[k]?.value === other.value,
    )
  if (!kept) throw ambiguous()
}

/**
 * Make the value of each of these fields look like an answer. A field's guide text is
 * often blue italics, and the engine writes the value with the look of the text it
 * replaces; Hangul shows a filled field's value black and upright.
 */
function plainAnswerFields(doc, ids, keys = null) {
  if (keys ? keys.size === 0 : !ids || ids.size === 0) return
  for (const field of parse(doc.getFieldList())) {
    if (keys ? !keys.has(fieldKey(field)) : !ids.has(field.fieldId)) continue
    const start = field.startCharIdx
    const end = field.endCharIdx
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) continue
    const at = field.location ?? {}
    const path = Array.isArray(at.path) ? at.path : null
    try {
      if (path) {
        // a field in a table cell (a text box has another address and is left alone)
        if (!path.every((entry) => entry.type === 'cell')) continue
        const cellPath = path.map((entry) => ({
          controlIndex: entry.controlIndex,
          cellIndex: entry.cellIndex,
          cellParaIndex: entry.paraIndex,
        }))
        const json = JSON.stringify(cellPath)
        const format = answerFormatOf(
          parse(doc.getCellCharPropertiesAtByPath(at.sectionIndex, at.paraIndex, json, start)),
        )
        if (format) {
          expectOk(
            doc.applyCharFormatInCellByPath(
              at.sectionIndex,
              at.paraIndex,
              json,
              start,
              end,
              format,
            ),
            'write the answer',
          )
        }
      } else {
        const format = answerFormatOf(
          parse(doc.getCharPropertiesAt(at.sectionIndex, at.paraIndex, start)),
        )
        if (format) {
          expectOk(
            doc.applyCharFormat(at.sectionIndex, at.paraIndex, start, end, format),
            'write the answer',
          )
        }
      }
    } catch {
      // a field the engine cannot read back keeps the look it was written with
    }
  }
}

/**
 * A checked format as the engine takes it, in a change: a font is looked up in the
 * document's font lists, one per language, and added to them where it is missing.
 */
function resolveFormat(doc, spec) {
  let chars = null
  if (spec.chars) {
    const out = { ...spec.chars }
    if (spec.font) {
      const ids = []
      for (let lang = 0; lang < FONT_LANGUAGES; lang++) {
        const id = doc.findOrCreateFontIdForLang(lang, spec.font)
        if (!Number.isInteger(id) || id < 0) throw fail('ENGINE', 'the font could not be set')
        ids.push(id)
      }
      out.fontIds = ids
    }
    chars = JSON.stringify(out)
  }
  let style = null
  if (spec.style) {
    style = styleIdOf(doc, spec.style)
    if (style === null) throw fail('CHANGED', 'the style is gone')
  }
  let charShape = null
  if (spec.charStyle) {
    const named = styleNamed(doc, spec.charStyle, CHARACTER_STYLE)
    if (!named) throw fail('CHANGED', 'the style is gone')
    charShape = named.charShapeId
  }
  return {
    chars,
    paragraph: spec.paragraph ? JSON.stringify(paragraphFormatOf(doc, spec.paragraph)) : null,
    style,
    charShape,
  }
}

/**
 * A checked paragraph format as the engine takes it, in a change: a list becomes the head
 * type, numbering and level the editor's own number and bullet buttons give a paragraph.
 * The numbering or bullet definition is found or added to the document (the editor's
 * default numbering; a bullet by its character).
 */
function paragraphFormatOf(doc, paragraph) {
  const { list, tabs, ...rest } = paragraph
  if (tabs) {
    // a stop's place is counted from the left edge of the text, whatever the paragraph's
    // margins are, in twice the engine's unit; the right edge is the width of a column
    // less the right margin the same call sets. A .hwp keeps the doubled number as it is,
    // and Hangul lays out a line again past a stop stored odd as out of reach, so every
    // place is a whole unit doubled, as Hangul stores its own
    const edge = 2 * (columnWidthUnits(doc, 0) - Math.round((rest.marginRight ?? 0) / 2))
    rest.tabStops = tabs.map((tab) => ({
      position: tab.atMm === null ? edge : 2 * Math.round((tab.atMm * 7200) / 25.4),
      type: tab.type,
      fill: tab.fill,
    }))
  }
  if (!list) return rest
  if (list.kind === 'none') return { ...rest, headType: 'None' }
  const id =
    list.kind === 'number' ? doc.ensureDefaultNumbering() : doc.ensureDefaultBullet(list.bullet)
  if (!Number.isInteger(id) || id <= 0) throw fail('ENGINE', 'the list could not be set')
  return {
    ...rest,
    headType: list.kind === 'number' ? 'Number' : 'Bullet',
    numberingId: id,
    paraLevel: list.level,
  }
}

/** A style name as the engine can store it, trimmed; `what` names the argument. */
function styleNameOf(value, what) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (
    !name ||
    name.length > MAX_STYLE_NAME ||
    STYLE_NAME_QUOTES.test(name) ||
    CONTROL_CHARS.test(name)
  ) {
    throw fail(
      'BAD_ARGUMENT',
      `${what} must be 1 to ${MAX_STYLE_NAME} characters, without quotes, backslashes or line breaks`,
    )
  }
  return name
}

/**
 * The look a style is made or changed with: a format without styles of its own. A
 * character style takes character formatting only. Null when nothing was given.
 */
function styleFormatOf(format, paragraphStyle) {
  if (format === undefined || format === null) return null
  if (typeof format !== 'object' || Array.isArray(format)) {
    throw fail('BAD_ARGUMENT', 'format must be an object')
  }
  if (Object.values(format).every((value) => value === undefined || value === null)) return null
  if (format.style != null || format.charStyle != null) {
    throw fail('BAD_ARGUMENT', 'a style is not made of other styles: pass its formatting')
  }
  const spec = formatOf(format, true)
  if (!paragraphStyle && spec.paragraph) {
    throw fail(
      'BAD_ARGUMENT',
      'a character style has character formatting only: align, lineSpacing, indents, margins and spacing belong to a paragraph style',
    )
  }
  return spec
}

/** Set a style's look: its character shape and, for a paragraph style, its paragraph shape. */
function setStyleLook(doc, id, spec) {
  if (!spec) return
  const { chars, paragraph } = resolveFormat(doc, spec)
  if (!doc.updateStyleShapes(id, chars ?? '{}', paragraph ?? '{}')) {
    throw fail('ENGINE_REFUSED', 'the editor refused to change the style')
  }
}

/** Whether a style other than `except` (an id) is called `name`, by its own or English name. */
function styleNameTaken(doc, name, except = null) {
  const style = styleNamed(doc, name, null)
  return style !== null && style.id !== except
}

/** Points of a paragraph length as the engine reports it: margins and indent in page pixels. */
const ptOfPx = (px) => Math.round(px * 7.5) / 10
/** Points of paragraph spacing as the engine reports it: twice the page pixels. */
const ptOfSpacing = (px) => Math.round(px * 3.75) / 10

/** What a style looks like, in the units the format calls take. */
function styleLookOf(doc, style) {
  const { charProps: c, paraProps: p } = parse(doc.getStyleDetail(style.id))
  const look = {
    font: c.fontFamily,
    size: c.fontSize / 100,
    bold: c.bold === true,
    italic: c.italic === true,
    underline: c.underline === true,
    strikethrough: c.strikethrough === true,
    color: c.textColor,
  }
  if (style.type !== PARAGRAPH_STYLE) return look
  return {
    ...look,
    align: p.alignment,
    ...(p.lineSpacingType === 'Percent' ? { lineSpacing: p.lineSpacing } : {}),
    indent: ptOfPx(p.indent),
    marginLeft: ptOfPx(p.marginLeft),
    marginRight: ptOfPx(p.marginRight),
    spacingBefore: ptOfSpacing(p.spacingBefore),
    spacingAfter: ptOfSpacing(p.spacingAfter),
  }
}

const kindOf = (style) => (style.type === CHARACTER_STYLE ? 'character' : 'paragraph')

/** HWPUNIT in a millimetre (7200 to the inch). */
const HWPUNIT_PER_MM = 7200 / 25.4
const mmOf = (hwpunit) => Math.round((hwpunit / HWPUNIT_PER_MM) * 10) / 10
const hwpunitOf = (mm) => Math.round(mm * HWPUNIT_PER_MM)
/** Paper sizes by name, portrait, in millimetres; B4 and B5 are Hangul's (JIS) ones. */
const PAPER_SIZES = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  B4: [257, 364],
  B5: [182, 257],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
}
/** The page setup's margins as the format calls name them, and the engine's names. */
const PAGE_MARGINS = {
  left: 'marginLeft',
  right: 'marginRight',
  top: 'marginTop',
  bottom: 'marginBottom',
  header: 'marginHeader',
  footer: 'marginFooter',
  gutter: 'marginGutter',
}
/** A page within this of a paper's size both ways is read as that paper. */
const PAPER_NAME_TOLERANCE_MM = 1
const isPaperSize = ([w, h], width, height) =>
  Math.abs(w - width) < PAPER_NAME_TOLERANCE_MM && Math.abs(h - height) < PAPER_NAME_TOLERANCE_MM
const MIN_PAPER_MM = 50
const MAX_PAPER_MM = 1000
const MAX_MARGIN_MM = 200
/** Least text area a page setup may leave, in millimetres each way. */
const MIN_TEXT_AREA_MM = 20

/** A section's page setup in millimetres: paper (by name when it is a known one), orientation, margins. */
function pageSetupOf(doc, sec) {
  const def = parse(doc.getPageDef(sec))
  const width = mmOf(def.width)
  const height = mmOf(def.height)
  const paper =
    Object.entries(PAPER_SIZES).find(([, size]) => isPaperSize(size, width, height))?.[0] ?? null
  const margins = {}
  for (const [name, key] of Object.entries(PAGE_MARGINS)) margins[name] = mmOf(def[key] ?? 0)
  return {
    ...(paper ? { paper } : {}),
    width,
    height,
    orientation: def.landscape === true ? 'landscape' : 'portrait',
    margins,
  }
}

/**
 * A page setup request, checked: what to give the engine's setPageDef (only what was asked
 * for), or a failure. `paper` names a size, or `width` and `height` give one (millimetres,
 * portrait); `orientation` turns it; `margins` sets the margins named.
 */
function pageSetupChangeOf(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw fail('BAD_ARGUMENT', 'the page setup must be an object')
  }
  const out = {}
  const given = (key) => spec[key] !== undefined && spec[key] !== null
  const millimetres = (value, min, max, what) => {
    if (typeof value !== 'number' || !(value >= min && value <= max)) {
      throw fail('BAD_ARGUMENT', `${what} must be ${min} to ${max} millimetres`)
    }
    return hwpunitOf(value)
  }
  if (given('paper')) {
    const size = PAPER_SIZES[spec.paper]
    if (!size) {
      throw fail('BAD_ARGUMENT', `paper must be one of ${Object.keys(PAPER_SIZES).join(', ')}`)
    }
    const ownSize = given('width') || given('height')
    if (ownSize && !isPaperSize(size, spec.width, spec.height)) {
      throw fail(
        'BAD_ARGUMENT',
        `paper ${spec.paper} is ${size[0]} by ${size[1]} millimetres: give paper, or width and height, not a size that differs from the paper`,
      )
    }
    out.width = hwpunitOf(ownSize ? spec.width : size[0])
    out.height = hwpunitOf(ownSize ? spec.height : size[1])
  } else if (given('width') || given('height')) {
    if (!given('width') || !given('height')) {
      throw fail('BAD_ARGUMENT', 'width and height go together')
    }
    out.width = millimetres(spec.width, MIN_PAPER_MM, MAX_PAPER_MM, 'width')
    out.height = millimetres(spec.height, MIN_PAPER_MM, MAX_PAPER_MM, 'height')
  }
  if (given('orientation')) {
    if (spec.orientation !== 'portrait' && spec.orientation !== 'landscape') {
      throw fail('BAD_ARGUMENT', 'orientation must be portrait or landscape')
    }
    out.landscape = spec.orientation === 'landscape'
  }
  if (given('margins')) {
    if (typeof spec.margins !== 'object' || Array.isArray(spec.margins)) {
      throw fail('BAD_ARGUMENT', 'margins must be an object')
    }
    for (const [name, value] of Object.entries(spec.margins)) {
      if (value === undefined || value === null) continue
      const key = PAGE_MARGINS[name]
      if (!key) {
        throw fail(
          'BAD_ARGUMENT',
          `margins take ${Object.keys(PAGE_MARGINS).join(', ')}, not ${String(name)}`,
        )
      }
      out[key] = millimetres(value, 0, MAX_MARGIN_MM, `the ${name} margin`)
    }
  }
  if (Object.keys(out).length === 0)
    throw fail('BAD_ARGUMENT', 'the page setup names nothing to change')
  return out
}

/**
 * Whether a section would keep room for text after `change`: the paper less the margins,
 * each way, as Hangul lays the body out (the header and footer margins inside the top and
 * bottom ones, the gutter beside the left one).
 */
function leavesTextArea(def, change) {
  const next = { ...def, ...change }
  const turned = next.landscape === true
  const width = mmOf(turned ? next.height : next.width)
  const height = mmOf(turned ? next.width : next.height)
  const across = width - mmOf(next.marginLeft + next.marginRight + (next.marginGutter ?? 0))
  const down =
    height -
    mmOf(next.marginTop + next.marginBottom + (next.marginHeader ?? 0) + (next.marginFooter ?? 0))
  return across >= MIN_TEXT_AREA_MM && down >= MIN_TEXT_AREA_MM
}

/** Number formats a note may take, as the engine names them. */
const NOTE_NUMBER_FORMATS = [
  'digit',
  'circledDigit',
  'upperRoman',
  'lowerRoman',
  'upperAlpha',
  'lowerAlpha',
  'circledUpperAlpha',
  'circledLowerAlpha',
  'hangulSyllable',
  'circledHangulSyllable',
  'hangulJamo',
  'circledHangulJamo',
  'hangulDigit',
  'hanjaDigit',
  'circledHanjaDigit',
  'userChar',
]
const NOTE_NUMBERINGS = {
  footnote: ['continue', 'restartSection', 'restartPage'],
  endnote: ['continue', 'restartSection'],
}
const NOTE_PLACEMENTS = {
  footnote: ['eachColumn', 'belowText', 'rightColumn'],
  endnote: ['documentEnd', 'sectionEnd'],
}
const MAX_NOTE_START = 9999

/** The note shape of one kind in a section, as the format calls name it; null when the engine cannot tell. */
function noteShapeOf(doc, kind, sec) {
  const read = kind === 'footnote' ? doc.getFootnoteShape : doc.getEndnoteShape
  if (typeof read !== 'function') return null
  const shape = parse(read.call(doc, sec))
  if (!shape.ok) return null
  return {
    numberFormat: shape.numberFormat,
    ...(shape.numberFormat === 'userChar' ? { symbol: shape.userChar } : {}),
    prefix: shape.prefixChar,
    suffix: shape.suffixChar,
    superscript: shape.numberCodeSuperscript === true,
    startNumber: shape.startNumber,
    numbering: shape.numbering,
    placement: shape.placement,
    separator: shape.separatorEnabled === true,
  }
}

/** A note settings request, checked: what to give the engine's apply call (only what was asked for). */
function noteSettingsChangeOf(kind, spec) {
  if (!NOTE_KINDS.includes(kind)) throw fail('BAD_ARGUMENT', 'kind must be footnote or endnote')
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw fail('BAD_ARGUMENT', 'the settings must be an object')
  }
  const given = (key) => spec[key] !== undefined && spec[key] !== null
  const oneOf = (key, values) => {
    if (!values.includes(spec[key])) {
      throw fail('BAD_ARGUMENT', `${key} must be one of ${values.join(', ')}`)
    }
    return spec[key]
  }
  const decoration = (key) => {
    const value = spec[key]
    if (typeof value !== 'string' || [...value].length > 1 || CONTROL_CHARS.test(value)) {
      throw fail('BAD_ARGUMENT', `${key} must be one character, or "" for none`)
    }
    return value
  }
  const out = {}
  if (given('numberFormat')) out.numberFormat = oneOf('numberFormat', NOTE_NUMBER_FORMATS)
  if (given('symbol')) {
    const symbol = decoration('symbol')
    if (symbol === '') throw fail('BAD_ARGUMENT', 'symbol must be one character')
    out.userChar = symbol
  }
  if (out.numberFormat === 'userChar' && out.userChar === undefined) {
    throw fail('BAD_ARGUMENT', 'numberFormat userChar needs the symbol')
  }
  if (given('prefix')) out.prefixChar = decoration('prefix')
  if (given('suffix')) out.suffixChar = decoration('suffix')
  if (given('superscript')) {
    if (typeof spec.superscript !== 'boolean')
      throw fail('BAD_ARGUMENT', 'superscript must be true or false')
    out.numberCodeSuperscript = spec.superscript
  }
  if (given('startNumber')) {
    if (
      !Number.isInteger(spec.startNumber) ||
      spec.startNumber < 1 ||
      spec.startNumber > MAX_NOTE_START
    ) {
      throw fail('BAD_ARGUMENT', `startNumber must be a whole number from 1 to ${MAX_NOTE_START}`)
    }
    out.startNumber = spec.startNumber
  }
  if (given('numbering')) out.numbering = oneOf('numbering', NOTE_NUMBERINGS[kind])
  if (given('placement')) out.placement = oneOf('placement', NOTE_PLACEMENTS[kind])
  if (given('separator')) {
    if (typeof spec.separator !== 'boolean')
      throw fail('BAD_ARGUMENT', 'separator must be true or false')
    out.separatorEnabled = spec.separator
  }
  if (Object.keys(out).length === 0)
    throw fail('BAD_ARGUMENT', 'the settings name nothing to change')
  return out
}
/** Length of the separator line Hangul draws for a new document's notes (5 cm). */
const NOTE_SEPARATOR_LENGTH = 14174

/**
 * The apply call's properties for one section: a separator asked for where the section has
 * none gets a thin solid line of the usual length (the engine's "off" clears all three); one
 * the section already draws is left as it is.
 */
function noteShapeChangeFor(doc, kind, sec, change) {
  if (change.separatorEnabled !== true) return change
  const { separatorEnabled: _on, ...rest } = change
  const current = noteShapeOf(doc, kind, sec)
  if (current?.separator) return rest
  return {
    ...rest,
    separatorLineType: 1,
    separatorLineWidth: 1,
    separatorLength: NOTE_SEPARATOR_LENGTH,
  }
}

/** Most body paragraphs the formatting profile looks at. */
const MAX_LOOK_PARAGRAPHS = 6000
/** Most looks the profile lists; the rest are counted. */
const MAX_LISTED_LOOKS = 40
const LOOK_SAMPLES = 2
const LOOK_SAMPLE_CHARS = 60
/** Body paragraphs one paragraphLooks call lists; the next call goes on from where it stopped. */
const MAX_LISTED_PARAGRAPH_LOOKS = 200

/** A short, stable name for a look: it stays the same while the paragraphs keep that look. */
function lookIdOf(key) {
  // FNV-1a, 32 bits: enough to tell a document's few dozen looks apart
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `L${hash.toString(36).padStart(6, '0').slice(-6)}`
}

/**
 * How one body paragraph looks, in the units the format calls take: its paragraph style, its
 * paragraph formatting and list, and the character formatting at its start. Null for a
 * paragraph the engine will not read.
 */
function paragraphLookOf(doc, sec, para, styles, bullets) {
  try {
    const p = parse(doc.getParaPropertiesAt(sec, para))
    const c = parse(doc.getCharPropertiesAt(sec, para, 0))
    const styleId = parse(doc.getStyleAt(sec, para)).id
    const head = p.headType === 'Number' || p.headType === 'Bullet' || p.headType === 'Outline'
    return {
      style: styles.get(styleId) ?? '',
      font: c.fontFamily,
      size: c.fontSize / 100,
      bold: c.bold === true,
      italic: c.italic === true,
      underline: c.underline === true,
      color: c.textColor,
      align: p.alignment,
      ...(p.lineSpacingType === 'Percent'
        ? { lineSpacing: p.lineSpacing }
        : { lineSpacingKind: p.lineSpacingType }),
      indent: ptOfPx(p.indent),
      marginLeft: ptOfPx(p.marginLeft),
      marginRight: ptOfPx(p.marginRight),
      spacingBefore: ptOfSpacing(p.spacingBefore),
      spacingAfter: ptOfSpacing(p.spacingAfter),
      ...(head
        ? {
            list:
              p.headType === 'Bullet' ? 'bullet' : p.headType === 'Outline' ? 'outline' : 'number',
            listLevel: (p.paraLevel ?? 0) + 1,
            ...(p.headType === 'Bullet' && bullets.has(p.numberingId)
              ? { bullet: bullets.get(p.numberingId) }
              : {}),
          }
        : {}),
    }
  } catch {
    return null
  }
}

/**
 * The body paragraphs of a document grouped by how they look (paragraphLookOf), most used
 * first. Empty paragraphs are left out. Each group has a stable id (lookIdOf) and the places
 * of its paragraphs; `mixed` counts its paragraphs whose text changes character formatting
 * somewhere (a bold word: only the start is in the look).
 */
function looksOf(doc) {
  const styles = new Map(parse(doc.getStyleList()).map((style) => [style.id, style.name]))
  const bullets = bulletChars(doc)
  const groups = new Map()
  let counted = 0
  let truncated = false
  for (let sec = 0; sec < doc.getSectionCount() && !truncated; sec++) {
    const count = doc.getParagraphCount(sec)
    for (let para = 0; para < count; para++) {
      if (counted >= MAX_LOOK_PARAGRAPHS) {
        truncated = true
        break
      }
      let length
      try {
        length = doc.getParagraphLength(sec, para)
      } catch {
        continue
      }
      const text = length > 0 ? squash(paragraphTextOf(doc, sec, para)) : ''
      if (!text) continue
      const look = paragraphLookOf(doc, sec, para, styles, bullets)
      if (!look) continue
      counted += 1
      const key = JSON.stringify(look)
      let group = groups.get(key)
      if (!group) {
        group = { id: lookIdOf(key), look, places: [], samples: [], mixed: 0 }
        groups.set(key, group)
      }
      group.places.push({ sec, para, length })
      if (group.samples.length < LOOK_SAMPLES) group.samples.push(clip(text, LOOK_SAMPLE_CHARS))
      try {
        if (parse(doc.getCharShapeRuns(sec, para, 0, length)).length > 1) group.mixed += 1
      } catch {
        // runs the engine will not read are not counted
      }
    }
  }
  const sorted = [...groups.values()].sort((a, b) => b.places.length - a.places.length)
  return { looks: sorted, counted, truncated }
}

/**
 * What a document's formatting is made of, for the model to follow or copy: the page setup,
 * the note settings, the paragraph styles in use, and the looks of the body paragraphs.
 * Reads only.
 */
function formattingOf(doc) {
  const sections = doc.getSectionCount()
  const pages = []
  for (let sec = 0; sec < sections; sec++) pages.push(pageSetupOf(doc, sec))
  const samePages = pages.every((page) => JSON.stringify(page) === JSON.stringify(pages[0]))
  const { looks, counted, truncated } = looksOf(doc)
  const used = new Map()
  for (const group of looks) {
    if (group.look.style)
      used.set(group.look.style, (used.get(group.look.style) ?? 0) + group.places.length)
  }
  const styles = parse(doc.getStyleList())
    .filter((style) => used.has(style.name) || style.type === CHARACTER_STYLE)
    .map((style) => ({
      name: style.name,
      kind: kindOf(style),
      paragraphs: used.get(style.name) ?? 0,
      look: styleLookOf(doc, style),
    }))
  const notes = {}
  for (const kind of NOTE_KINDS) {
    const shape = noteShapeOf(doc, kind, 0)
    if (shape) notes[kind] = shape
  }
  return {
    pageSetup: samePages ? pages[0] : pages.map((page, index) => ({ section: index + 1, ...page })),
    notes,
    styles,
    paragraphs: counted,
    looks: looks.slice(0, MAX_LISTED_LOOKS).map((group) => ({
      id: group.id,
      paragraphs: group.places.length,
      ...group.look,
      ...(group.mixed > 0 ? { mixedFormatting: group.mixed } : {}),
      samples: group.samples,
    })),
    ...(looks.length > MAX_LISTED_LOOKS ? { otherLooks: looks.length - MAX_LISTED_LOOKS } : {}),
    ...(truncated ? { truncated: true } : {}),
  }
}

/**
 * The body paragraphs in reading order with the look each has (looksOf: the ids
 * formattingOf lists), from the `from`-th (1-based) on: which paragraphs are formatted
 * alike and which one stands apart, such as a heading indented unlike the others. The look
 * itself (indents, alignment, spacing, font) is in formattingOf. Empty paragraphs are left
 * out, as there. Reads only.
 */
function paragraphLooksOf(doc, from) {
  const { looks, truncated } = looksOf(doc)
  const rows = []
  for (const group of looks) {
    for (const place of group.places) rows.push({ ...place, look: group.id })
  }
  rows.sort((a, b) => a.sec - b.sec || a.para - b.para)
  const start = Number.isInteger(from) && from > 1 ? Math.min(from - 1, rows.length) : 0
  const listed = rows.slice(start, start + MAX_LISTED_PARAGRAPH_LOOKS).map((row, index) => ({
    paragraph: start + index + 1,
    look: row.look,
    text: clip(squash(paragraphTextOf(doc, row.sec, row.para)), LOOK_SAMPLE_CHARS),
  }))
  const next = start + listed.length
  return {
    count: rows.length,
    paragraphs: listed,
    ...(next < rows.length ? { next: next + 1 } : {}),
    ...(truncated ? { truncated: true } : {}),
  }
}

/** Bytes from base64, for a document handed over as text. */
function bytesOfBase64(base64) {
  const binary = globalThis.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function checkWhere(where) {
  if (where !== 'after' && where !== 'before' && where !== 'end') {
    throw fail('BAD_ARGUMENT', 'where must be "after", "before" or "end"')
  }
}

/** The most a picture handed to the plugin may weigh; the panel already keeps pictures smaller. */
const PICTURE_MAX_BYTES = 10 * 1024 * 1024

/**
 * The bytes of a picture, told from the bytes themselves: the extension the model or the
 * panel named must be the format the bytes really are, or insertion would store a file the
 * document cannot draw. Returns the bytes and the extension to write with.
 */
function pictureOf(base64, extension) {
  const ext = extension === 'png' || extension === 'jpg' || extension === 'gif' ? extension : null
  if (typeof base64 !== 'string' || base64 === '' || !ext) {
    throw fail('BAD_ARGUMENT', 'the picture must be base64 PNG, JPEG or GIF bytes')
  }
  let bytes
  try {
    bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  } catch {
    throw fail('BAD_ARGUMENT', 'the picture is not base64')
  }
  if (bytes.byteLength === 0 || bytes.byteLength > PICTURE_MAX_BYTES) {
    throw fail('BAD_ARGUMENT', 'the picture is empty or too large')
  }
  const starts = (...signature) => signature.every((byte, index) => bytes[index] === byte)
  const matches =
    ext === 'png'
      ? starts(0x89, 0x50, 0x4e, 0x47)
      : ext === 'jpg'
        ? starts(0xff, 0xd8)
        : starts(0x47, 0x49, 0x46, 0x38)
  if (!matches) throw fail('BAD_ARGUMENT', `the bytes are not a ${ext.toUpperCase()} picture`)
  return { bytes, extension: ext }
}

function checkParagraphs(paragraphs) {
  const valid =
    Array.isArray(paragraphs) &&
    paragraphs.length > 0 &&
    paragraphs.length <= MAX_INSERTED_PARAGRAPHS &&
    // a tab is text: it runs to the next tab stop of its paragraph
    paragraphs.every((text) => typeof text === 'string' && !PARAGRAPH_CONTROL_CHARS.test(text))
  if (!valid) {
    throw fail(
      'BAD_ARGUMENT',
      `paragraphs must be 1 to ${MAX_INSERTED_PARAGRAPHS} strings, each one line of plain text`,
    )
  }
}

/** The rows as a rectangle of one-line strings, short rows padded with empty cells. */
function tableOf(rows) {
  const valid =
    Array.isArray(rows) &&
    rows.length > 0 &&
    rows.every(
      (row) =>
        Array.isArray(row) &&
        row.length > 0 &&
        row.every((cell) => typeof cell === 'string' && !CONTROL_CHARS.test(cell)),
    )
  const cols = valid ? Math.max(...rows.map((row) => row.length)) : 0
  if (!valid || rows.length * cols > MAX_TABLE_CELLS) {
    throw fail(
      'BAD_ARGUMENT',
      `rows must be a non-empty list of rows of one-line strings, at most ${MAX_TABLE_CELLS} cells`,
    )
  }
  return rows.map((row) => [...row, ...Array(cols - row.length).fill('')])
}

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The look of a new table's cells: a thin black line all round and the inner margins Hangul
 * gives a new table. Left out, the engine makes a table with no lines and no margins.
 * These are document content, not app chrome: the same in the light and the dark theme.
 */
const TABLE_CELL_STYLE = 'border:0.4pt solid #000000;padding:1.41pt 5.1pt'
/** Fill of a header row. Document content as well. */
const TABLE_HEADER_FILL = '#e5e5e5'
/** Top plus bottom cell margin of TABLE_CELL_STYLE, in points. */
const TABLE_CELL_MARGIN_PT = 2.82
/** Line height of a table cell relative to its font size (the engine's default line spacing). */
const TABLE_LINE_SPACING = 1.6
/** Font size assumed for a table when the paragraph next to it does not tell. */
const DEFAULT_FONT_PT = 10

/** The family and size in the character properties `read` gives, for the text of a new table. */
function fontOf(read) {
  try {
    const props = parse(read())
    // the name goes into a style attribute: nothing that could end it
    const family =
      typeof props.fontFamily === 'string' ? props.fontFamily.replace(/["';<>]/g, '') : ''
    const points = Number(props.fontSize) / 100
    return { family, points: points > 0 ? points : DEFAULT_FONT_PT }
  } catch {
    // the table is still made, in the document's default font
    return { family: '', points: DEFAULT_FONT_PT }
  }
}

const BODY_STYLE = '바탕글'

const HEADING_STYLE = /개요|제목|heading|title/i

/** The character runs of a body paragraph and whether it is a heading or mostly bold. Null when empty or unreadable. */
function bodyRunsOf(doc, styles, sec, para) {
  try {
    const length = doc.getParagraphLength(sec, para)
    if (length === 0) return null
    const heading =
      parse(doc.getParaPropertiesAt(sec, para)).headType === 'Outline' ||
      HEADING_STYLE.test(styles.get(parse(doc.getStyleAt(sec, para)).id) ?? '')
    const starts = parse(doc.getCharShapeRuns(sec, para, 0, length)).map(
      (run) => run.startOffset ?? 0,
    )
    const runs = []
    starts.forEach((start, index) => {
      const chars = (starts[index + 1] ?? length) - start
      if (chars <= 0) return
      const props = parse(doc.getCharPropertiesAt(sec, para, start))
      runs.push({ props, size: props.fontSize, bold: props.bold === true, chars })
    })
    const boldChars = runs.reduce((sum, run) => sum + (run.bold ? run.chars : 0), 0)
    return { heading, bold: boldChars * 2 > length, runs }
  } catch {
    return null
  }
}

function mostCharsOf(runs, key) {
  const totals = new Map()
  for (const run of runs) totals.set(key(run), (totals.get(key(run)) ?? 0) + run.chars)
  return [...totals].sort((a, b) => b[1] - a[1])[0]?.[0]
}

/**
 * The font of the body text, for a new table or table of contents. `beside` ({ sec, para })
 * is the paragraph it goes after; `fallback()` is taken when the body has no text that is
 * not bold.
 */
function bodyFontOf(doc, beside = null, fallback = null) {
  const styles = new Map(parse(doc.getStyleList()).map((style) => [style.id, style.name]))
  const plain = []
  const notBold = []
  const sizes = new Map()
  let counted = 0
  for (let sec = 0; sec < doc.getSectionCount(); sec++) {
    const count = doc.getParagraphCount(sec)
    for (let para = 0; para < count && counted < MAX_LOOK_PARAGRAPHS; para++) {
      const look = bodyRunsOf(doc, styles, sec, para)
      if (!look) continue
      notBold.push(...look.runs.filter((run) => !run.bold))
      if (look.heading || look.bold) continue
      counted += 1
      plain.push(...look.runs)
      const own = mostCharsOf(look.runs, (run) => run.size)
      sizes.set(own, (sizes.get(own) ?? 0) + 1)
    }
  }
  const key = (run) => `${run.props.fontFamily}|${run.size}`
  const lookOf = (runs) => {
    const most = mostCharsOf(runs, key)
    const chosen = runs.find((run) => key(run) === most)
    return chosen ? fontOf(() => JSON.stringify(chosen.props)) : null
  }
  // by paragraphs, not characters: one long title line of its own size is not the body
  const size = [...sizes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0]
  const near = beside && bodyRunsOf(doc, styles, beside.sec, beside.para)
  if (near && !near.heading && !near.bold && size !== undefined) {
    const own = mostCharsOf(near.runs, key)
    const chosen = near.runs.find((run) => key(run) === own)
    if (chosen && chosen.size === size) return fontOf(() => JSON.stringify(chosen.props))
  }
  return (
    lookOf(plain) ??
    lookOf(notBold) ??
    fallback?.() ??
    fontOf(() =>
      JSON.stringify(parse(doc.getStyleDetail(styleIdOf(doc, BODY_STYLE) ?? 0)).charProps),
    )
  )
}

/**
 * The engine builds a table from pasted HTML, the way it does for a paste from the
 * clipboard. Left to itself it uses the document's default font and a row too low for
 * one line, so each cell carries the font of the paragraph the table is put next to and a
 * height that fits a line of it (a cell whose text wraps still grows).
 */
function tableHtml(table, font, header, shadeHeader, columns = null) {
  const height = Math.round((font.points * TABLE_LINE_SPACING + TABLE_CELL_MARGIN_PT) * 10) / 10
  const text = [
    font.family ? `font-family:${font.family};mso-fareast-font-family:${font.family}` : '',
    `font-size:${font.points}pt`,
  ]
    .filter(Boolean)
    .join(';')
  // a column's width is what the engine takes from its cells; left out, the columns share the width
  const box = (col) =>
    `${TABLE_CELL_STYLE};height:${height}pt${columns?.widths ? `;width:${columns.widths[col]}pt` : ''}`
  const cell = (value, col) => {
    const align = columns?.aligns?.[col]
    const words = `<span style="${text}">${escapeHtml(value)}</span>`
    return `<td style="${box(col)}">${align ? `<p style="text-align:${align}">${words}</p>` : words}</td>`
  }
  // a header cell the way Hangul documents usually have it: bold, centred, on light grey;
  // as <th> the engine also marks it as a title cell, which repeats on the next page. The
  // grey is left out where it is put on afterwards (shadeHeaderCells)
  const head = (value, col) =>
    `<th style="${box(col)}${shadeHeader ? `;background-color:${TABLE_HEADER_FILL}` : ''}"><p style="text-align:center">` +
    `<span style="${text};font-weight:bold">${escapeHtml(value)}</span></p></th>`
  const rows = table.map(
    (row, index) => `<tr>${row.map(header && index === 0 ? head : cell).join('')}</tr>`,
  )
  return `<table>${rows.join('')}</table>`
}

/**
 * The table just pasted into body paragraph `place`, as the table calls take one (its
 * section, paragraph, path and counts), or null when no table is there.
 */
function pastedTableAt(doc, place) {
  const controls = parse(doc.getControlTextPositions(place.sec, place.para)).length
  for (let control = controls - 1; control >= 0; control--) {
    const path = [{ controlIndex: control, cellIndex: 0, cellParaIndex: 0 }]
    try {
      const dims = parse(doc.getTableDimensionsByPath(place.sec, place.para, JSON.stringify(path)))
      return {
        sec: place.sec,
        para: place.para,
        path,
        rows: dims.rowCount,
        cols: dims.colCount,
        cells: dims.cellCount,
      }
    } catch {
      continue
    }
  }
  return null
}

/**
 * Give the empty cells of a new table the look its text has. The pasted HTML carries the
 * font on the text, so a cell without any would take the document default, and so would
 * what is written into it later.
 */
function formatEmptyCells(doc, made, rows, font, aligns, header) {
  const control = made.path[0].controlIndex
  const chars = [false, true].map(
    (bold) =>
      resolveFormat(
        doc,
        formatOf({ ...(font.family ? { font: font.family } : {}), size: font.points, bold }, false),
      ).chars,
  )
  for (const cell of gridOf(doc, made)) {
    if (rows[cell.row]?.[cell.col] !== '') continue
    const head = header && cell.row === 0
    expectOk(
      doc.applyCharFormatInCell(made.sec, made.para, control, cell.cell, 0, 0, 0, chars[+head]),
      'format the empty cells',
    )
    expectOk(
      doc.applyParaFormatInCell(
        made.sec,
        made.para,
        control,
        cell.cell,
        0,
        JSON.stringify({ alignment: head ? 'center' : aligns[cell.col] }),
      ),
      'format the empty cells',
    )
  }
}

/**
 * The number listTables gives the table object `control` of body paragraph `para` (its last
 * table when `control` is null), with how many tables the document has; empty when no
 * table is there.
 */
function tableNumberOf(doc, sec, para, control = null) {
  const { tables } = tablesOf(doc)
  const index = tables.findLastIndex(
    (table) =>
      table.sec === sec &&
      table.para === para &&
      table.path.length === 1 &&
      (control === null || table.path[0].controlIndex === control),
  )
  return index < 0 ? {} : { table: index + 1, tables: tables.length }
}

/** The heads Hangul numbers or marks a paragraph with in front of its text. */
const NUMBERED_HEADS = new Set(['Number', 'Bullet', 'Outline'])

/** Where an object can be anchored so that it stands on the page, not in the text. */
const PAGE_ANCHORS = new Set(['Page', 'Paper'])

/**
 * How a body table is placed: `across`, its left and right are set on the page (the way
 * floatAcrossColumns lays a table over the columns); `fixed`, its height on the page is
 * set, so it does not move with the text. A table in the line of text or anchored to its
 * paragraph or column is neither.
 */
function placementOf(doc, sec, para, control) {
  try {
    const props = parse(doc.getTableProperties(sec, para, control))
    if (props.treatAsChar !== false) return { across: false, fixed: false }
    return { across: PAGE_ANCHORS.has(props.horzRelTo), fixed: PAGE_ANCHORS.has(props.vertRelTo) }
  } catch {
    return { across: false, fixed: false }
  }
}

/**
 * The listTables numbers of the body tables laid out wider than a column of their section:
 * in columns they lie over the text of the next column. A table set across the page is
 * meant to be wide.
 */
function tablesWiderThanColumn(doc) {
  const wide = []
  tablesOf(doc).tables.forEach((table, index) => {
    if (table.path.length !== 1) return
    const control = table.path[0].controlIndex
    try {
      if (placementOf(doc, table.sec, table.para, control).across) return
      const { width } = parse(doc.getTableBBox(table.sec, table.para, control))
      if (width > (columnWidthPt(doc, table.sec) * 96) / 72 + 1) wide.push(index + 1)
    } catch {}
  })
  return wide
}

/**
 * Set the lines of a block of cells of a body table (`rect`, zero-based and inclusive) by
 * border rules. Each cell gets all its changed edges in one call, and a line between two
 * cells of the block is the same on both: the engine carries a cell's edge over to its
 * neighbour, so two calls that disagree would leave the later one's line.
 */
function setCellBorders(doc, table, grid, rect, rules, more = null) {
  const control = table.path[0].controlIndex
  const borders = cellBorders(grid, rect, rules)
  let count = 0
  for (const cell of grid) {
    const inside =
      cell.row + cell.rowSpan - 1 >= rect.top &&
      cell.row <= rect.bottom &&
      cell.col + cell.colSpan - 1 >= rect.left &&
      cell.col <= rect.right
    if (!inside) continue
    const props = { ...(more ?? {}), ...(borders.get(cell.cell) ?? {}) }
    if (Object.keys(props).length === 0) continue
    expectOk(
      doc.setCellProperties(table.sec, table.para, control, cell.cell, JSON.stringify(props)),
      'format the cell',
    )
    count += 1
  }
  return count
}

/** The lines of a body table, as rowEdgesAfterAdding takes them. */
function rowEdgesOf(doc, table, grid) {
  const control = table.path[0].controlIndex
  const edges = Array.from({ length: table.rows + 1 }, () => Array(table.cols).fill(null))
  const flagged = Array(table.rows).fill(false)
  const verticals = []
  for (const cell of grid) {
    const props = parse(doc.getCellProperties(table.sec, table.para, control, cell.cell))
    if (props.isHeader === true) flagged[cell.row] = true
    for (let col = cell.col; col < cell.col + cell.colSpan; col++) {
      if (cell.row === 0) edges[0][col] = props.borderTop
      edges[cell.row + cell.rowSpan][col] = props.borderBottom
    }
    if (cell.col > 0) verticals.push(props.borderLeft)
    if (cell.col + cell.colSpan < table.cols) verticals.push(props.borderRight)
  }
  return { edges, flagged, verticals }
}

const sameLine = (one, other) =>
  one.type === other.type && one.width === other.width && one.color === other.color

/** Draw the horizontal lines `edges` (as rowEdgesOf reads them) on a body table. */
function setRowEdges(doc, table, grid, edges) {
  const control = table.path[0].controlIndex
  for (const cell of grid) {
    const props = parse(doc.getCellProperties(table.sec, table.para, control, cell.cell))
    const top = edges[cell.row]?.[cell.col]
    const bottom = edges[cell.row + cell.rowSpan]?.[cell.col]
    const lines = {
      ...(top && !sameLine(top, props.borderTop) ? { borderTop: top } : {}),
      ...(bottom && !sameLine(bottom, props.borderBottom) ? { borderBottom: bottom } : {}),
    }
    if (Object.keys(lines).length === 0) continue
    expectOk(
      doc.setCellProperties(table.sec, table.para, control, cell.cell, JSON.stringify(lines)),
      'draw the lines of the table',
    )
  }
}

/** How the body cells of a new table may be aligned. */
const TABLE_ALIGNS = ['left', 'center', 'right']

/**
 * The shares of the width the columns take, from one positive number per column (`cols`
 * of them; any number when null), summing to 1. A column far thinner than the rest could
 * not hold a character, so none takes less than MIN_COLUMN_SHARE.
 */
function columnSharesOf(list, cols) {
  const valid =
    Array.isArray(list) &&
    list.length > 0 &&
    (cols === null || list.length === cols) &&
    list.every((share) => typeof share === 'number' && Number.isFinite(share) && share > 0)
  if (!valid) {
    throw fail(
      'BAD_ARGUMENT',
      cols === null
        ? 'columnWidths must be positive numbers, one for each column'
        : `columnWidths must be ${cols} positive numbers, one for each column`,
    )
  }
  const sum = list.reduce((total, share) => total + share, 0)
  const floored = list.map((share) => Math.max(share / sum, MIN_COLUMN_SHARE))
  const total = floored.reduce((all, share) => all + share, 0)
  return floored.map((share) => share / total)
}

/**
 * How to give the columns of a body table the shares `shares` of its width (one per
 * column), the width of the table staying as it is: the engine's cell updates
 * (resizeTableCells, which wraps the cell text again) and the new widths in millimetres.
 * Null when a column has no cell of its own to read its width from.
 */
function columnPlanOf(doc, table, shares) {
  const control = table.path[0].controlIndex
  const cells = Array.from({ length: table.cells }, (_, cell) => {
    const info = parse(doc.getCellInfo(table.sec, table.para, control, cell))
    const props = parse(doc.getCellProperties(table.sec, table.para, control, cell))
    return {
      cellIdx: cell,
      row: info.row,
      col: info.col,
      rowSpan: info.rowSpan || 1,
      colSpan: info.colSpan || 1,
      width: props.width,
      height: props.height,
    }
  })
  const { colWidth } = sizeGridOf(cells)
  if (colWidth.some((width) => width === undefined)) return null
  const total = colWidth.reduce((sum, width) => sum + width, 0)
  const widths = shares.map((share) => Math.round(total * share))
  widths[widths.length - 1] = total - widths.slice(0, -1).reduce((sum, width) => sum + width, 0)
  const updates = spanUpdates(
    cells,
    'col',
    widths.map((width, col) => width - colWidth[col]),
  )
  return { updates, widths: widths.map(mmOf) }
}
/** Font sizes a new table's text takes, in points. */
const MIN_TABLE_FONT_PT = 6
const MAX_TABLE_FONT_PT = 40
/** The least share of the width a column is given, so that none comes out unusably thin. */
const MIN_COLUMN_SHARE = 0.04

/**
 * A look's format with a font this PC has where it names one the PC is known to lack
 * (standInFont): a look the AI picked is written in fonts the user can see and print.
 * `used` collects what stood in for what, for the answer.
 */
function standInFormat(format, used) {
  if (!format || typeof format !== 'object' || typeof format.font !== 'string') return format
  const asked = format.font.trim()
  const stand = standInFont(asked, fontOnPc)
  if (!stand) return format
  if (!used.some((entry) => entry.asked === asked)) used.push({ asked, used: stand.font })
  return { ...format, font: stand.font, ...(stand.bold ? { bold: true } : {}) }
}

/**
 * How a new table is to look, checked. A boolean is the header row alone, as the call took
 * before it knew looks. `look` is one of TABLE_LOOKS; `headerColor` the fill of the header
 * row ("none" for no fill); `columnWidths` the columns' shares of the width; `align` the
 * alignment of the body cells, one for all or one for each column; `size` and `font` the
 * text of the table, instead of that of the paragraph it is put next to.
 */
function tableLookOf(given, cols) {
  const plain = {
    header: given === true,
    look: 'grid',
    headerColor: null,
    shares: null,
    across: false,
    widthShare: 1,
    place: null,
    repeatHeader: false,
  }
  if (given === undefined || given === null || typeof given === 'boolean') {
    return { ...plain, aligns: null, size: null, font: null, standIns: [] }
  }
  if (typeof given !== 'object' || Array.isArray(given)) {
    throw fail('BAD_ARGUMENT', 'the look of the table must be an object')
  }
  const look = given.look ?? 'grid'
  if (!TABLE_LOOKS.includes(look)) {
    throw fail('BAD_ARGUMENT', `look must be one of ${TABLE_LOOKS.join(', ')}`)
  }
  if (
    given.acrossColumns !== undefined &&
    given.acrossColumns !== null &&
    typeof given.acrossColumns !== 'boolean'
  ) {
    throw fail('BAD_ARGUMENT', 'acrossColumns must be true or false')
  }
  const across = given.acrossColumns === true
  let widthShare = 1
  if (given.widthPercent !== undefined && given.widthPercent !== null) {
    const percent = given.widthPercent
    const { min, max } = TABLE_WIDTH_PERCENT
    if (typeof percent !== 'number' || !(percent >= min && percent <= max)) {
      throw fail('BAD_ARGUMENT', `widthPercent must be ${min} to ${max}`)
    }
    widthShare = percent / 100
  }
  let place = null
  if (given.place !== undefined && given.place !== null) {
    if (!TABLE_ALIGNS.includes(given.place)) {
      throw fail('BAD_ARGUMENT', `place must be one of ${TABLE_ALIGNS.join(', ')}`)
    }
    place = given.place
  }
  if (
    given.repeatHeader !== undefined &&
    given.repeatHeader !== null &&
    typeof given.repeatHeader !== 'boolean'
  ) {
    throw fail('BAD_ARGUMENT', 'repeatHeader must be true or false')
  }
  const repeatHeader = given.repeatHeader === true
  let headerColor = null
  if (given.headerColor !== undefined && given.headerColor !== null) {
    const none = given.headerColor === 'none'
    if (!none && (typeof given.headerColor !== 'string' || !HEX_COLOR.test(given.headerColor))) {
      throw fail('BAD_ARGUMENT', 'headerColor must look like #RRGGBB, or be "none"')
    }
    headerColor = none ? 'none' : given.headerColor.toLowerCase()
  }
  let shares = null
  if (given.columnWidths !== undefined && given.columnWidths !== null) {
    shares = columnSharesOf(given.columnWidths, cols)
  }
  let aligns = null
  if (given.align !== undefined && given.align !== null) {
    const list = Array.isArray(given.align) ? given.align : Array(cols).fill(given.align)
    if (list.length !== cols || !list.every((align) => TABLE_ALIGNS.includes(align))) {
      throw fail(
        'BAD_ARGUMENT',
        `align must be one of ${TABLE_ALIGNS.join(', ')}, or a list of ${cols} of them`,
      )
    }
    aligns = list
  }
  let size = null
  if (given.size !== undefined && given.size !== null) {
    if (
      typeof given.size !== 'number' ||
      !(given.size >= MIN_TABLE_FONT_PT && given.size <= MAX_TABLE_FONT_PT)
    ) {
      throw fail('BAD_ARGUMENT', `size must be ${MIN_TABLE_FONT_PT} to ${MAX_TABLE_FONT_PT} points`)
    }
    size = given.size
  }
  const standIns = []
  let font = null
  if (given.font !== undefined && given.font !== null) {
    const name = typeof given.font === 'string' ? given.font.trim() : ''
    if (!name || name.length > MAX_FONT_NAME || CONTROL_CHARS.test(name)) {
      throw fail('BAD_ARGUMENT', `font must be a font name of 1 to ${MAX_FONT_NAME} characters`)
    }
    // the name goes into a style attribute: nothing that could end it
    font = standInFormat({ font: name }, standIns).font.replace(/["';<>]/g, '')
  }
  return {
    header: given.header === true,
    look,
    headerColor,
    shares,
    across,
    widthShare,
    place,
    repeatHeader,
    aligns,
    size,
    font,
    standIns,
  }
}

/** How the text of a cell sits between its top and bottom edge, with the engine's code. */
const CELL_VERTICAL_ALIGNS = { top: 0, middle: 1, bottom: 2 }
/** Border rules one call takes at most. */
const MAX_BORDER_RULES = 12

/**
 * What a formatCells call changes, checked: the cell properties every named cell takes
 * (`props`: fill, vertical alignment) and the border rules. A string is a background alone.
 */
function cellLookOf(given) {
  const spec = typeof given === 'string' ? { background: given } : given
  const nothing =
    'name what to change: background, borders, verticalAlign, heightMm, diagonal, text or columnWidths'
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw fail('BAD_ARGUMENT', nothing)
  const props = {}
  if (spec.background !== undefined && spec.background !== null) {
    const none = spec.background === 'none'
    if (!none && (typeof spec.background !== 'string' || !HEX_COLOR.test(spec.background))) {
      throw fail('BAD_ARGUMENT', 'background must look like #RRGGBB, or be "none"')
    }
    if (none) props.fillType = 'none'
    else {
      // pattern -1 is none (see shadeHeaderCells)
      props.fillType = 'solid'
      props.fillColor = spec.background.toLowerCase()
      props.patternType = -1
    }
  }
  if (spec.verticalAlign !== undefined && spec.verticalAlign !== null) {
    if (!Object.hasOwn(CELL_VERTICAL_ALIGNS, spec.verticalAlign)) {
      throw fail(
        'BAD_ARGUMENT',
        `verticalAlign must be one of ${Object.keys(CELL_VERTICAL_ALIGNS).join(', ')}`,
      )
    }
    props.verticalAlign = CELL_VERTICAL_ALIGNS[spec.verticalAlign]
  }
  let rules = []
  if (spec.borders !== undefined && spec.borders !== null) {
    if (
      !Array.isArray(spec.borders) ||
      spec.borders.length === 0 ||
      spec.borders.length > MAX_BORDER_RULES
    ) {
      throw fail('BAD_ARGUMENT', `borders must be 1 to ${MAX_BORDER_RULES} rules`)
    }
    rules = spec.borders.map((rule) => {
      try {
        return borderRuleOf(rule)
      } catch (thrown) {
        throw fail('BAD_ARGUMENT', thrown.message)
      }
    })
  }
  if (spec.diagonal !== undefined && spec.diagonal !== null) {
    if (!Object.hasOwn(CELL_DIAGONALS, spec.diagonal)) {
      throw fail(
        'BAD_ARGUMENT',
        `diagonal must be one of ${Object.keys(CELL_DIAGONALS).join(', ')}`,
      )
    }
    Object.assign(props, CELL_DIAGONALS[spec.diagonal], CELL_DIAGONAL_LINE)
  }
  if (spec.heightMm !== undefined && spec.heightMm !== null) {
    const mm = spec.heightMm
    if (typeof mm !== 'number' || !(mm >= ROW_HEIGHT_MM.min && mm <= ROW_HEIGHT_MM.max)) {
      throw fail(
        'BAD_ARGUMENT',
        `heightMm must be ${ROW_HEIGHT_MM.min} to ${ROW_HEIGHT_MM.max} millimetres`,
      )
    }
    props.height = Math.round((mm * 7200) / 25.4)
  }
  // the text of the cells: a format as a style takes it (no style of its own, no list)
  const standIns = []
  let text = null
  if (spec.text !== undefined && spec.text !== null) {
    text = styleFormatOf(standInFormat(spec.text, standIns), true)
    if (text?.paragraph?.list) throw fail('BAD_ARGUMENT', 'a list is not set for cells')
  }
  const shares =
    spec.columnWidths !== undefined && spec.columnWidths !== null
      ? columnSharesOf(spec.columnWidths, null)
      : null
  if (Object.keys(props).length === 0 && rules.length === 0 && !text && !shares) {
    throw fail('BAD_ARGUMENT', nothing)
  }
  return { props, rules, text, shares, standIns }
}

/**
 * Give the text of every cell of a block (`rect`, zero-based and inclusive) a format:
 * each paragraph of each cell takes the paragraph part, and its characters the character
 * part. An empty paragraph takes the characters too, for what is typed into it later.
 */
function formatCellText(doc, table, grid, rect, format) {
  const control = table.path[0].controlIndex
  for (const cell of grid) {
    const inside =
      cell.row + cell.rowSpan - 1 >= rect.top &&
      cell.row <= rect.bottom &&
      cell.col + cell.colSpan - 1 >= rect.left &&
      cell.col <= rect.right
    if (!inside) continue
    const paragraphs = doc.getCellParagraphCount(table.sec, table.para, control, cell.cell)
    for (let k = 0; k < paragraphs; k++) {
      if (format.paragraph) {
        expectOk(
          doc.applyParaFormatInCell(table.sec, table.para, control, cell.cell, k, format.paragraph),
          'format the cell text',
        )
      }
      if (format.chars) {
        const length = doc.getCellParagraphLength(table.sec, table.para, control, cell.cell, k)
        expectOk(
          doc.applyCharFormatInCell(
            table.sec,
            table.para,
            control,
            cell.cell,
            k,
            0,
            length,
            format.chars,
          ),
          'format the cell text',
        )
      }
    }
  }
}

/** Styles one styleParagraphs call makes or changes at most, and rules it applies. */
const MAX_BATCH_STYLES = 12
const MAX_STYLE_RULES = 40
/** Longest text a paragraph is told by: how it starts. */
const MAX_STARTS_WITH = 40
/** Paragraphs one styleParagraphs call styles at most. */
const MAX_STYLED_PARAGRAPHS = 5000

/**
 * A styleParagraphs call, checked: the paragraph styles to make or change (`styles`, each
 * with its look as formatOf gives it) and the rules that say which paragraphs take which
 * style (`rules`). A rule names its paragraphs by how they start (`startsWith`, every body
 * paragraph that starts so, leading spaces aside), by the numbered level they start with
 * (`numbered`, a key of NUMBERED_MARKS: every "1." "2." … paragraph) or by text one
 * paragraph contains (`find`, with `occurrence` when the text occurs more than once). A
 * style's `keepWithNext` keeps its paragraphs on the page of the one after them.
 */
function styleBatchOf(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw fail('BAD_ARGUMENT', 'name styles to make and paragraphs to apply them to')
  }
  const standIns = []
  const styles = []
  if (spec.styles !== undefined && spec.styles !== null) {
    if (!Array.isArray(spec.styles) || spec.styles.length > MAX_BATCH_STYLES) {
      throw fail('BAD_ARGUMENT', `styles must be a list of at most ${MAX_BATCH_STYLES} styles`)
    }
    for (const given of spec.styles) {
      if (!given || typeof given !== 'object' || Array.isArray(given)) {
        throw fail('BAD_ARGUMENT', 'each style needs a name and its look')
      }
      const name = styleNameOf(given.name, 'the name of a style')
      if (styles.some((style) => style.name.toLowerCase() === name.toLowerCase())) {
        throw fail('BAD_ARGUMENT', `the style "${name}" is listed twice`)
      }
      const basedOn = given.basedOn == null ? null : styleNameOf(given.basedOn, 'basedOn')
      const look = styleFormatOf(standInFormat(given.format, standIns), true)
      const keep = given.keepWithNext
      if (keep !== undefined && keep !== null && typeof keep !== 'boolean') {
        throw fail('BAD_ARGUMENT', 'keepWithNext must be true or false')
      }
      styles.push({ name, basedOn, look, keepWithNext: keep ?? null })
    }
  }
  const rules = []
  if (spec.apply !== undefined && spec.apply !== null) {
    if (!Array.isArray(spec.apply) || spec.apply.length > MAX_STYLE_RULES) {
      throw fail('BAD_ARGUMENT', `apply must be a list of at most ${MAX_STYLE_RULES} rules`)
    }
    for (const given of spec.apply) {
      if (!given || typeof given !== 'object' || Array.isArray(given)) {
        throw fail('BAD_ARGUMENT', 'each rule needs a style and startsWith or find')
      }
      const style = styleNameOf(given.style, 'the style of a rule')
      const starts = given.startsWith
      const find = given.find
      const numbered = given.numbered
      const hasStarts = starts !== undefined && starts !== null
      const hasFind = find !== undefined && find !== null
      const hasNumbered = numbered !== undefined && numbered !== null
      if (Number(hasStarts) + Number(hasFind) + Number(hasNumbered) !== 1) {
        throw fail(
          'BAD_ARGUMENT',
          'each rule names its paragraphs by startsWith, by numbered or by find, one of the three',
        )
      }
      if (hasNumbered) {
        if (typeof numbered !== 'string' || !Object.hasOwn(NUMBERED_MARKS, numbered)) {
          throw fail(
            'BAD_ARGUMENT',
            `numbered must be one of ${Object.keys(NUMBERED_MARKS).join(', ')}`,
          )
        }
        rules.push({ style, startsWith: null, numbered, find: null, occurrence: null })
        continue
      }
      if (hasStarts) {
        const text = typeof starts === 'string' ? starts.trim() : ''
        if (!text || text.length > MAX_STARTS_WITH || CONTROL_CHARS.test(text)) {
          throw fail(
            'BAD_ARGUMENT',
            `startsWith must be 1 to ${MAX_STARTS_WITH} characters of one line`,
          )
        }
        rules.push({ style, startsWith: text, numbered: null, find: null, occurrence: null })
        continue
      }
      if (typeof find !== 'string' || !find || CONTROL_CHARS.test(find)) {
        throw fail('BAD_ARGUMENT', 'find must be text of one paragraph')
      }
      rules.push({
        style,
        startsWith: null,
        numbered: null,
        find,
        occurrence: given.occurrence ?? null,
      })
    }
  }
  if (styles.length === 0 && rules.length === 0) {
    throw fail('BAD_ARGUMENT', 'name styles to make and paragraphs to apply them to')
  }
  return { styles, rules, standIns }
}

/**
 * A title box call, checked: its look, its colours, and the character formatting the title
 * takes over the look it has now (null when none was given).
 */
function titleBoxOf(spec) {
  const given = spec ?? {}
  if (typeof given !== 'object' || Array.isArray(given)) {
    throw fail('BAD_ARGUMENT', 'the title box must be an object')
  }
  const look = given.look ?? 'bands'
  if (!TITLE_BOX_LOOKS.includes(look)) {
    throw fail('BAD_ARGUMENT', `look must be one of ${TITLE_BOX_LOOKS.join(', ')}`)
  }
  const colorOf = (value, what) => {
    if (value === undefined || value === null) return null
    if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
      throw fail('BAD_ARGUMENT', `${what} must look like #RRGGBB`)
    }
    return value.toLowerCase()
  }
  const textColor = colorOf(given.textColor, 'textColor')
  const standIns = []
  const text = {}
  for (const key of ['font', 'size', 'bold']) {
    if (given[key] !== undefined && given[key] !== null) text[key] = given[key]
  }
  const color = colorOf(given.color, 'color') ?? TITLE_BOX_COLORS[look]
  // words that cannot be told from what is behind them are no title: bands, lines and a
  // frame leave the white page behind the words, and a fill may be as pale as the words
  const behind = look === 'shaded' ? color : '#ffffff'
  const textColorDropped =
    textColor !== null && contrastRatio(textColor, behind) < MIN_TEXT_CONTRAST
  if (textColor !== null && !textColorDropped) text.color = textColor
  return {
    look,
    color,
    color2: colorOf(given.color2, 'color2'),
    text: Object.keys(text).length > 0 ? standInFormat(text, standIns) : null,
    fillUnderOwnColour:
      look === 'shaded' && (textColor === null || textColorDropped) ? color : null,
    standIns,
    textColorDropped,
  }
}

/**
 * Controls that set up the page from the paragraph they sit in (the first one of a
 * document, usually) without being content of it: the section and column definitions, the
 * page number, the header and footer, what a page hides, and a new page number.
 */
const PAGE_CONTROLS = new Set(['secd', 'cold', 'pgnp', 'head', 'foot', 'pghd', 'nwno'])

/**
 * Whether body paragraph `box.index` holds an object that is content (a table, a picture, a
 * note, a field), as opposed to the controls that set up the page. The engine names the
 * controls of the first section's body by paragraph; in a later section they cannot be told
 * apart here, so any object counts there.
 */
function holdsContentObject(doc, sec, box) {
  if (box.objectPositions(box.index).length === 0) return false
  if (sec !== 0) return true
  try {
    return parse(doc.getControls()).some(
      (control) =>
        control.list === 0 && control.para === box.index && !PAGE_CONTROLS.has(control.ctrlId),
    )
  } catch {
    return true
  }
}

/** Longest header or footer text one call writes. */
const MAX_HEADER_TEXT = 200
/**
 * Control characters a header or footer this app wrote may hold: the marks of its page
 * number fields. Any other (a table, a picture, a line break) means someone laid it out by
 * hand, and it is left alone.
 */
// eslint-disable-next-line no-control-regex
const HEADER_FIELD_MARKS = /[\u0012\u0015\u0016\u0017]/g
/** The mark the engine leaves in a header's text for a page field, by the field's type number. */
const HEADER_MARK_OF_FIELD = { 1: '\u0015', 2: '\u0016' }
// eslint-disable-next-line no-control-regex
const ANY_CONTROL = /[\u0000-\u001f]/g
/** The controls and spaces a paragraph's text may start with before its words. */
// eslint-disable-next-line no-control-regex
const LEADING_CONTROLS = /^[\s\u0000-\u001f]+/

/** Whether a header or footer as the engine reports it is one paragraph of text and fields. */
function plainHeader(found) {
  if ((found.paraCount ?? 1) > 1) return false
  return (
    String(found.text ?? '')
      .replace(HEADER_FIELD_MARKS, '')
      .search(ANY_CONTROL) < 0
  )
}

const HEADER_TOKEN_OF_MARK = new Map(
  Object.entries(HEADER_FIELD_TOKENS).map(([token, type]) => [HEADER_MARK_OF_FIELD[type], token]),
)

const headerTextOf = (text) =>
  String(text ?? '')
    .replace(HEADER_FIELD_MARKS, (mark) => HEADER_TOKEN_OF_MARK.get(mark) ?? '{field}')
    .replace(ANY_CONTROL, ' ')

function headerLookOf(doc, isHeader, text) {
  const look = {}
  const align = parse(doc.getParaPropertiesInHf(0, isHeader, 0, 0)).alignment
  if (TABLE_ALIGNS.includes(align)) look.align = align
  if (text.length > 0) {
    const size = parse(doc.getCharPropertiesInHeaderFooter(0, isHeader, 0, 0, 0)).fontSize
    if (Number.isFinite(size)) look.size = size / 100
  }
  return look
}

/**
 * Give the header row of a table just pasted in body paragraph `place` its grey, cell by
 * cell. Pasted with the grey, the engine takes the first cell's border and fill for the
 * table's own, and Hancom Hangul paints a table's own fill behind every cell: the whole
 * table came out grey. Pasted without it, the table's own has no fill, and the engine
 * colours each cell on its own. No table there leaves the paste as it is.
 */
function shadeHeaderCells(doc, place, cols, color = TABLE_HEADER_FILL) {
  const controls = parse(doc.getControlTextPositions(place.sec, place.para)).length
  for (let control = controls - 1; control >= 0; control--) {
    try {
      doc.getTableDimensionsByPath(
        place.sec,
        place.para,
        JSON.stringify([{ controlIndex: control, cellIndex: 0, cellParaIndex: 0 }]),
      )
    } catch {
      continue
    }
    // pattern -1 is none: left out, the engine puts in 0, which Hangul draws as horizontal lines
    const fill = JSON.stringify({
      fillType: 'solid',
      fillColor: color,
      patternType: -1,
    })
    for (let cell = 0; cell < cols; cell++) {
      expectOk(
        doc.setCellProperties(place.sec, place.para, control, cell, fill),
        'shade the header',
      )
    }
    return
  }
}

/** Which match a replace call means, or the reason it cannot be decided. */
const ENTITY = /&#(\d+);|&#x([0-9a-fA-F]+);/g

/** The engine's plain-text export writes some characters as numeric references. */
const decodeEntities = (text) =>
  text.replace(ENTITY, (_match, dec, hex) =>
    String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16)),
  )

const squash = (text) => text.replace(/\s+/g, ' ').trim()

/**
 * The document as plain text in reading order, one paragraph a line. The base is the
 * engine's own export, which reaches everything that holds text (text boxes, tables inside
 * cells, notes) and shows an empty form field by its guide text. That export leaves out
 * whole tables in some documents, though, and now and then a body paragraph. So the
 * paragraphs of the body and of its tables are walked as well, and each one the export does
 * not have is put in after the last line that it does have.
 *
 * A paragraph that holds a click-here field is not compared: the export writes the field's
 * guide into it, so the two never match and the line would come out twice.
 */
function textOf(doc) {
  const flat = decodeEntities(parse(doc.getTextFileText()))
  const lines = flat.split(/\r?\n/)
  // where each line of the export is: its places in order, one per occurrence
  const places = new Map()
  lines.forEach((line, index) => {
    const key = squash(line)
    if (!key) return
    const list = places.get(key)
    if (list) list.push(index)
    else places.set(key, [index])
  })
  const fielded = new Set()
  for (const field of parse(doc.getFieldList())) {
    const where = field.location
    // only a click-here field has a guide; a cross-reference or a link is ordinary text
    if (field.fieldType !== 'clickhere' || field.cellField === true || !where) continue
    const path = Array.isArray(where.path) ? where.path : []
    const cell = path[0]
    fielded.add(
      cell && cell.type === 'cell'
        ? `${where.sectionIndex}/${where.paraIndex}/${cell.controlIndex}.${cell.cellIndex}.${cell.paraIndex}`
        : `${where.sectionIndex}/${where.paraIndex}`,
    )
  }

  /** occurrences of a line already matched */
  const taken = new Map()
  /** lines put in, by the line of the export they follow (-1: in front of everything) */
  const extras = new Map()
  let pointer = -1
  let checks = MAX_CONTAINMENT_CHECKS
  let bare = null
  const match = (key) => {
    const list = places.get(key)
    const used = taken.get(key) ?? 0
    if (!list || used >= list.length) return false
    taken.set(key, used + 1)
    pointer = Math.max(pointer, list[used])
    return true
  }
  const add = (text) => {
    const bucket = extras.get(pointer)
    if (bucket) bucket.push(text)
    else extras.set(pointer, [text])
  }
  /** One walked paragraph: found in the export, or put in. */
  const see = (text) => {
    const key = squash(text)
    if (!key || match(key)) return
    // part of a longer line of the export (a paragraph with an equation or a note in it)
    if (checks > 0) {
      checks -= 1
      bare ??= flat.replace(/\s+/g, '')
      if (bare.includes(key.replace(/\s+/g, ''))) return
    }
    add(text.trim())
  }

  const sections = doc.getSectionCount()
  for (let sec = 0; sec < sections; sec++) {
    const paragraphs = doc.getParagraphCount(sec)
    for (let para = 0; para < paragraphs; para++) {
      const length = doc.getParagraphLength(sec, para)
      if (length > 0 && !fielded.has(`${sec}/${para}`)) see(doc.getTextRange(sec, para, 0, length))
      const controls = parse(doc.getControlTextPositions(sec, para)).length
      for (let ctrl = 0; ctrl < controls; ctrl++) {
        let dims
        try {
          dims = parse(doc.getTableDimensions(sec, para, ctrl))
        } catch {
          continue
        }
        const texts = []
        for (let cell = 0; cell < dims.cellCount; cell++) {
          const count = doc.getCellParagraphCount(sec, para, ctrl, cell)
          for (let k = 0; k < count; k++) {
            if (fielded.has(`${sec}/${para}/${ctrl}.${cell}.${k}`)) continue
            const size = doc.getCellParagraphLength(sec, para, ctrl, cell, k)
            if (size > 0) texts.push(doc.getTextInCell(sec, para, ctrl, cell, k, 0, size))
          }
        }
        // a table the export skipped whole goes in whole: a short cell ("1", "예") would
        // otherwise count as found wherever those characters occur in the document
        const known = texts.some((text) => {
          const list = places.get(squash(text))
          return Boolean(list) && (taken.get(squash(text)) ?? 0) < list.length
        })
        for (const text of texts) {
          if (known) see(text)
          else if (squash(text)) add(text.trim())
        }
      }
    }
  }
  if (extras.size === 0) return lines.join('\n')
  const out = [...(extras.get(-1) ?? [])]
  lines.forEach((line, index) => {
    out.push(line)
    const more = extras.get(index)
    if (more) out.push(...more)
  })
  return out.join('\n')
}

/**
 * The pictures of the document in reading order, with the text beside each one: first the
 * pictures of body paragraphs, then those inside table cells. A picture in a text box, a
 * header, a footer or the page background is not reached this way and is not listed. `sec`
 * and `para` are the body paragraph that holds it, `control` its place among that
 * paragraph's objects: the engine addresses the image by them (and by `cellPath` inside a
 * table).
 */
function picturesOf(doc) {
  const pictures = []
  const sections = doc.getSectionCount()
  for (let sec = 0; sec < sections && pictures.length < MAX_LISTED_PICTURES; sec++) {
    const paragraphs = doc.getParagraphCount(sec)
    for (let para = 0; para < paragraphs && pictures.length < MAX_LISTED_PICTURES; para++) {
      let positions
      try {
        positions = parse(doc.getControlTextPositions(sec, para))
      } catch {
        continue
      }
      for (let control = 0; control < positions.length; control++) {
        let mime
        try {
          mime = doc.getControlImageMime(sec, para, '[]', control)
        } catch {
          continue // not a picture: a table, a field, a section definition
        }
        if (!mime.startsWith('image/')) continue
        pictures.push(pictureAt(doc, sec, para, control, positions[control], mime))
      }
    }
  }
  // Pictures inside table cells: the engine does not list the objects of a cell paragraph,
  // so each cell paragraph is asked for the objects a picture can sit in. A form's photo or
  // seal is usually there rather than in the body text.
  if (pictures.length >= MAX_LISTED_PICTURES) return pictures
  const { tables } = tablesOf(doc)
  tables.forEach((table, index) => {
    if (pictures.length >= MAX_LISTED_PICTURES) return
    for (let cell = 0; cell < table.cells; cell++) {
      let count
      try {
        count = doc.getCellParagraphCountByPath(
          table.sec,
          table.para,
          JSON.stringify(cellAt(table.path, cell, 0)),
        )
      } catch {
        continue
      }
      for (let k = 0; k < count && pictures.length < MAX_LISTED_PICTURES; k++) {
        const cellPath = cellAt(table.path, cell, k)
        for (let control = 0; control < PICTURE_CELL_CONTROLS; control++) {
          let mime
          try {
            mime = doc.getControlImageMime(table.sec, table.para, JSON.stringify(cellPath), control)
          } catch {
            continue
          }
          if (!mime.startsWith('image/')) continue
          pictures.push(
            pictureAt(doc, table.sec, table.para, control, 0, mime, {
              table: index + 1,
              cell,
              cellPath,
            }),
          )
        }
      }
    }
  })
  return pictures
}

/**
 * One picture as picturesOf lists it: where it is and the words to recognize it by. `cell`
 * names the table and cell it sits in (table cells only); its text is read from the cell.
 */
function pictureAt(doc, sec, para, control, offset, mime, cell = null) {
  let near = ''
  try {
    if (cell) {
      const json = JSON.stringify(cell.cellPath)
      const length = doc.getCellParagraphLengthByPath(sec, para, json)
      if (length > 0) {
        near = clip(
          squash(
            doc.getTextInCellByPath(
              sec,
              para,
              json,
              0,
              Math.min(length, PICTURE_CONTEXT_CHARS * 2),
            ),
          ),
          PICTURE_CONTEXT_CHARS * 2,
        )
      }
    } else {
      const length = doc.getParagraphLength(sec, para)
      const start = Math.max(0, offset - PICTURE_CONTEXT_CHARS)
      const count = Math.min(length - start, PICTURE_CONTEXT_CHARS * 2)
      if (count > 0) {
        near = clip(squash(doc.getTextRange(sec, para, start, count)), PICTURE_CONTEXT_CHARS * 2)
      }
    }
  } catch {
    // the words are a courtesy; the picture itself is still listed
  }
  // the page the paragraph starts on, numbered as the document numbers its pages
  let page = null
  try {
    const at = parse(doc.getPageOfPosition(sec, para))
    if (at.ok && Number.isInteger(at.page)) {
      const info = parse(doc.getPageInfo(at.page))
      page = Number.isInteger(info.pageNumber) ? info.pageNumber : at.page + 1
    }
  } catch {
    // no page: the list still names the picture
  }
  return {
    sec,
    para,
    control,
    offset,
    mime,
    near,
    page,
    table: cell ? cell.table : null,
    cellPath: cell ? cell.cellPath : null,
  }
}

/** Base64 of picture bytes, a chunk at a time so a large picture does not overflow the stack. */
function base64Of(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * A table is named by a path like a cell is: one entry per nesting level, the last one
 * holding the table's place among the objects of its paragraph. This is the address of
 * paragraph `k` of cell `cell` of that table.
 */
const cellAt = (path, cell, k) => [
  ...path.slice(0, -1),
  { controlIndex: path[path.length - 1].controlIndex, cellIndex: cell, cellParaIndex: k },
]

const tableKey = (sec, para, path) =>
  [
    sec,
    para,
    ...path.slice(0, -1).map((e) => `${e.controlIndex}.${e.cellIndex}.${e.cellParaIndex}`),
    path[path.length - 1].controlIndex,
  ].join('/')

/**
 * Every table of the document in reading order, a table inside a cell right after the table
 * it sits in. The engine lists the objects of a body paragraph but not those of a cell
 * paragraph, so a table inside a cell is found by asking for it; `partial` says the budget
 * for that ran out and tables inside cells may be missing from the end of the list.
 */
function tablesOf(doc) {
  const tables = []
  let lookups = MAX_NESTED_LOOKUPS
  const dimensions = (sec, para, path) => {
    try {
      return parse(doc.getTableDimensionsByPath(sec, para, JSON.stringify(path)))
    } catch {
      // not a table: a picture, a text box, a section definition
      return null
    }
  }
  const add = (sec, para, path, dims, parent, depth) => {
    const index = tables.length
    tables.push({
      sec,
      para,
      path,
      rows: dims.rowCount,
      cols: dims.colCount,
      cells: dims.cellCount,
      parent,
    })
    if (depth >= MAX_TABLE_DEPTH) return
    for (let cell = 0; cell < dims.cellCount && lookups > 0; cell++) {
      const paragraphs = doc.getCellParagraphCountByPath(
        sec,
        para,
        JSON.stringify(cellAt(path, cell, 0)),
      )
      for (let k = 0; k < paragraphs && lookups > 0; k++) {
        for (let inner = 0; inner < NESTED_CONTROLS_TRIED; inner++) {
          lookups -= 1
          const innerPath = [
            ...cellAt(path, cell, k),
            { controlIndex: inner, cellIndex: 0, cellParaIndex: 0 },
          ]
          const innerDims = dimensions(sec, para, innerPath)
          if (innerDims) add(sec, para, innerPath, innerDims, index, depth + 1)
        }
      }
    }
  }
  const sections = doc.getSectionCount()
  for (let sec = 0; sec < sections; sec++) {
    const paragraphs = doc.getParagraphCount(sec)
    for (let para = 0; para < paragraphs; para++) {
      const controls = parse(doc.getControlTextPositions(sec, para)).length
      for (let ctrl = 0; ctrl < controls; ctrl++) {
        const path = [{ controlIndex: ctrl, cellIndex: 0, cellParaIndex: 0 }]
        const dims = dimensions(sec, para, path)
        if (dims) add(sec, para, path, dims, null, 1)
      }
    }
  }
  return { tables, partial: lookups <= 0 }
}

function holdsTable(doc, sec, para) {
  const controls = parse(doc.getControlTextPositions(sec, para)).length
  for (let ctrl = 0; ctrl < controls; ctrl++) {
    try {
      parse(doc.getTableDimensions(sec, para, ctrl))
      return true
    } catch {
      // not a table: a picture, a section definition
    }
  }
  return false
}

/**
 * The text lines of each table cell on page `page`, from one layout read of the page
 * (getPageTextLayout): for every cell, keyed as `tableKey` + `/` + cell index, its runs of
 * visible text as boxes in CSS px, each with the cell paragraph (`para`), the character it
 * starts at (`start`) and its text, so that whose text a run draws can be checked.
 */
function cellLinesOn(doc, page) {
  const lines = new Map()
  let layout
  try {
    layout = parse(doc.getPageTextLayout(page))
  } catch {
    return lines
  }
  for (const run of Array.isArray(layout?.runs) ? layout.runs : []) {
    const path = run.cellPath
    if (!Array.isArray(path) || path.length === 0 || !(run.w > 0)) continue
    // an empty paragraph is laid out as a blank run as wide as the cell: nothing to cut off
    if (!/\S/.test(run.displayText ?? run.text ?? '')) continue
    const last = path[path.length - 1]
    const key = [
      run.secIdx,
      run.parentParaIdx,
      ...path.slice(0, -1).map((e) => `${e.controlIndex}.${e.cellIndex}.${e.cellParaIndex}`),
      last.controlIndex,
      last.cellIndex,
    ].join('/')
    const box = {
      x: run.x,
      y: run.y,
      h: run.h,
      para: last.cellParaIndex,
      start: run.charStart,
      text: run.text,
    }
    const seen = lines.get(key)
    if (seen) seen.push(box)
    else lines.set(key, [box])
  }
  return lines
}

/**
 * Whether `run` draws the text of the cell whose paragraphs are `paragraphs`: its text is
 * the paragraph's from the character it starts at. The text layout of a page also holds the
 * header's, the footer's and the master page's text, and their cells are addressed like the
 * body's (the same paragraph, object and cell numbers), wherever on the page they stand. A
 * run with no character of its own (a bullet) is not the cell's text.
 */
function drawsTextOf(run, paragraphs) {
  if (!Number.isInteger(run.start) || typeof run.text !== 'string') return false
  const paragraph = paragraphs[run.para]
  if (typeof paragraph !== 'string') return false
  return engineSlice(paragraph, run.start, run.start + engineLength(run.text)) === run.text
}

/**
 * How far below the cell's bottom edge, in CSS px, the cell's lowest cut-off line of `runs`
 * ends, or null when every line reads whole. Only the runs drawn in the cell's column that
 * draw the cell's own text (`paragraphs()`, read only for a cell with a line past its edge)
 * count, and a line passes the edge by more than LAYOUT_SLACK_LINE of its height to be cut
 * off. The box must hold the start of one of those lines: the engine can hand back a master
 * page's table for a body table's address, and the body cell's text then stands elsewhere.
 */
function overflowIn(runs, box, paragraphs) {
  const edge = box.y + box.h
  const own = (run) => drawsTextOf(run, paragraphs())
  const inColumn = runs.filter((run) => run.x >= box.x - 1 && run.x < box.x + box.w)
  const past = inColumn
    .filter((run) => run.y + run.h - edge > run.h * LAYOUT_SLACK_LINE)
    .sort((a, b) => b.y + b.h - (a.y + a.h))
  const lowest = past.find(own)
  if (!lowest) return null
  if (!inColumn.some((run) => run.y >= box.y - 1 && run.y < edge && own(run))) return null
  return lowest.y + lowest.h - edge
}

/** Hangul and other CJK script: text written in it breaks between any two characters. */
const BREAKS_ANYWHERE = /[ᄀ-ᇿ぀-ヿ㄰-㆏一-鿿가-힯]/

const CLOSING_MARK = /\p{Pe}|\p{Pf}/u
const OPENING_MARK = /\p{Ps}|\p{Pi}/u
const STRAIGHT_QUOTE = /["']/

/**
 * Whether a line break between the texts `left` and `right` splits a word. A Korean
 * paragraph breaks per syllable by Hangul's default, so a break beside Hangul is no broken
 * word, except a number cut from the Hangul word it goes with (2026|년). A straight quote
 * closes a word when a word is on its left and opens one when a word is on its right.
 */
export function splitsWord(left, right) {
  const [before = '', prev = ''] = [...left].reverse()
  const [after = '', next = ''] = right
  if (!/\S/.test(before) || !/\S/.test(after)) return false
  const closes = CLOSING_MARK.test(before) || (STRAIGHT_QUOTE.test(before) && /\S/.test(prev))
  const opens = OPENING_MARK.test(after) || (STRAIGHT_QUOTE.test(after) && /\S/.test(next))
  if (closes || opens) return false
  const anywhere = [before, after].filter((char) => BREAKS_ANYWHERE.test(char)).length
  if (anywhere === 0) return true
  return anywhere === 1 && (/\d/.test(before) || /\d/.test(after))
}

/**
 * Whether one of the cell's lines of `runs` starts inside a word (splitsWord). Lines are
 * the runs of one paragraph that start at another height.
 */
function breaksInsideWord(runs, box, paragraphs) {
  const own = runs.filter(
    (run) => run.x >= box.x - 1 && run.x < box.x + box.w && drawsTextOf(run, paragraphs()),
  )
  const starts = new Map()
  for (const run of own) {
    const lines = starts.get(run.para) ?? new Map()
    const y = Math.round(run.y)
    lines.set(y, Math.min(lines.get(y) ?? Infinity, run.start))
    starts.set(run.para, lines)
  }
  for (const [para, lines] of starts) {
    const text = paragraphs()[para]
    const ordered = [...lines].sort((a, b) => a[0] - b[0])
    for (const [, start] of ordered.slice(1)) {
      if (splitsWord(engineSlice(text, Math.max(0, start - 2), start), engineSlice(text, start))) {
        return true
      }
    }
  }
  return false
}

/** How a table's caption line starts: <표 1>, [표 2], 표 3., 〈그림 1〉, Table 4. */
const CAPTION_START = /^[<[〈《(]?\s*(표|그림|도표|Table|Figure)\s*\d/i

/** The names Hangul gives its caption style. */
const CAPTION_STYLES = new Set(['캡션', 'Caption'])

/** The name of the style of body paragraph `para`, or '' when it cannot be read. */
function styleNameAt(doc, sec, para) {
  try {
    return parse(doc.getStyleAt(sec, para)).name ?? ''
  } catch {
    return ''
  }
}

/** Where the text area of page `page` ends and begins, in CSS px from the top of the page. */
function bodyAreaOf(doc, page) {
  const info = parse(doc.getPageInfo(page))
  const foot = info.footerArea?.y ?? info.height - info.marginBottom
  const top = info.headerArea ? info.headerArea.y + info.headerArea.height : info.marginTop
  return { top, foot, columns: Array.isArray(info.columns) ? info.columns : [] }
}

/**
 * Whether an object of a page's control layout can be the body's: the engine lays out the
 * master page's objects with the numbers of the master page's own paragraphs, and those
 * numbers can name a body paragraph. That paragraph must hold an object of that number.
 */
function holdsObjectAt(doc, control) {
  try {
    const box = containerOf(doc, { sec: control.secIdx, para: control.paraIdx })
    return box.objectPositions(control.paraIdx).length > control.controlIdx
  } catch {
    return false
  }
}

/**
 * Whether the table `control` of a page's control layout is the body table of its numbers,
 * not a master page's table numbered like it: the text drawn in its box is the body table's
 * cell text (drawsTextOf, as checkLayout tells a cell's own lines). A table with no text in
 * its box is taken as the body's.
 */
function drawsOwnCells(doc, control, runs) {
  const inBox = runs.filter(
    (run) =>
      Array.isArray(run.cellPath) &&
      run.cellPath.length === 1 &&
      run.secIdx === control.secIdx &&
      run.parentParaIdx === control.paraIdx &&
      run.cellPath[0].controlIndex === control.controlIdx &&
      /\S/.test(run.text ?? '') &&
      run.x >= control.x - 1 &&
      run.x < control.x + control.w &&
      run.y >= control.y - 1 &&
      run.y < control.y + control.h,
  )
  if (inBox.length === 0) return true
  return inBox.some((run) => {
    const { cellIndex, cellParaIndex } = run.cellPath[0]
    try {
      const box = containerOf(doc, {
        sec: control.secIdx,
        para: control.paraIdx,
        cellPath: [{ controlIndex: control.controlIdx, cellIndex, cellParaIndex }],
      })
      const text = box.text(cellParaIndex, box.length(cellParaIndex))
      return drawsTextOf({ ...run, para: 0, start: run.charStart }, [text])
    } catch {
      return false
    }
  })
}

/** The AgentPageMap of the document as it is laid out now. Reads only. */
function pageMapOf(doc) {
  const numbers = new Map()
  tablesOf(doc).tables.forEach((table, index) => {
    if (table.path.length === 1) {
      numbers.set(`${table.sec}/${table.para}/${table.path[0].controlIndex}`, index + 1)
    }
  })
  const counts = []
  const isBody = (sec, para) =>
    Number.isInteger(sec) &&
    Number.isInteger(para) &&
    para < (counts[sec] ??= sec < doc.getSectionCount() ? doc.getParagraphCount(sec) : 0)
  const order = (a, b) => a.sec - b.sec || a.para - b.para
  const pages = []
  const slots = []
  const spans = new Map()
  const past = []
  const drawnBefore = new Set()
  const total = doc.pageCount()
  for (let page = 0; page < total; page++) {
    const { top, foot, columns } = bodyAreaOf(doc, page)
    const columnOf = (x) => {
      let at = 0
      columns.forEach((column, index) => {
        if (x >= column.x - 1) at = index
      })
      return at
    }
    let runs = []
    try {
      runs = parse(doc.getPageTextLayout(page)).runs ?? []
    } catch {}
    let controls = []
    try {
      controls = parse(doc.getPageControlLayout(page)).controls ?? []
    } catch {}
    const items = []
    const starts = new Map()
    let objects = 0
    const lowLines = new Set()
    const drawn = []
    for (const run of runs) {
      if (run.cellPath || !isBody(run.secIdx, run.paraIdx)) continue
      const key = `${run.secIdx}/${run.paraIdx}`
      const inColumn = (drawn[columnOf(run.x)] ??= new Set())
      inColumn.add(key)
      if (Number.isInteger(run.charStart)) {
        starts.set(key, Math.min(starts.get(key) ?? Infinity, run.charStart))
      }
      if (!/\S/.test(run.text ?? '')) continue
      items.push({ sec: run.secIdx, para: run.paraIdx, column: columnOf(run.x), table: null })
      if (run.y + run.h - foot > run.h * LAYOUT_SLACK_LINE) lowLines.add(Math.round(run.y))
    }
    for (const control of controls) {
      if (control.headerFooter || !isBody(control.secIdx, control.paraIdx)) continue
      const number =
        control.type === 'table'
          ? (numbers.get(`${control.secIdx}/${control.paraIdx}/${control.controlIdx}`) ?? null)
          : null
      if (number === null) {
        if (holdsObjectAt(doc, control)) objects += 1
        continue
      }
      if (!drawsOwnCells(doc, control, runs)) continue
      items.push({
        sec: control.secIdx,
        para: control.paraIdx,
        column: columnOf(control.x),
        table: number,
      })
      spans.set(number, [...(spans.get(number) ?? []), page + 1])
      if (
        control.y + control.h > foot + 1 &&
        !placementOf(doc, control.secIdx, control.paraIdx, control.controlIdx).fixed
      ) {
        const low = (control.cells ?? []).filter((cell) => cell.y + cell.h > foot + 1)
        past.push({
          table: number,
          page: page + 1,
          row: low.length > 0 ? Math.min(...low.map((cell) => cell.row)) + 1 : 1,
          ...(control.h > foot - top + 1 ? { taller: true } : {}),
        })
      }
    }
    if (items.length === 0) {
      pages.push(
        objects > 0
          ? { page: page + 1, first: { text: '' }, last: { text: '' } }
          : { page: page + 1, empty: true },
      )
      continue
    }
    const sorted = [...items].sort(order)
    const ends = (item) => {
      const key = `${item.sec}/${item.para}`
      const continues = drawnBefore.has(key) && starts.has(key)
      const from = continues ? textOffsetOf(doc, item.sec, item.para, starts.get(key)) : 0
      const text = paragraphText(doc, item.sec, item.para, from)
      if (item.table !== null && !text) return { table: item.table }
      return continues ? { text, continues: true } : { text }
    }
    pages.push({
      page: page + 1,
      first: ends(sorted[0]),
      last: ends(sorted.at(-1)),
      ...(lowLines.size > 0 ? { pastFoot: lowLines.size } : {}),
    })
    for (const key of starts.keys()) drawnBefore.add(key)
    for (let column = 0; column < Math.max(1, columns.length); column++) {
      const mine = items.filter((item) => item.column === column).sort(order)
      if (mine.length === 0) continue
      slots.push({
        page: page + 1,
        column: column + 1,
        columns: columns.length,
        first: mine[0],
        last: mine.at(-1),
        drawn: drawn[column] ?? new Set(),
      })
    }
  }
  const alone = []
  for (let k = 0; k + 1 < slots.length; k++) {
    const { last } = slots[k]
    const { first } = slots[k + 1]
    if (last.table !== null || first.sec !== last.sec || first.para <= last.para) continue
    const text = paragraphText(doc, last.sec, last.para)
    if (!text) continue
    let between = last.para + 1
    while (between < first.para && !paragraphText(doc, last.sec, between)) between++
    if (between < first.para) continue
    const props = parse(doc.getParaPropertiesAt(last.sec, last.para))
    const kept = props.keepWithNext === true
    const style = styleNameAt(doc, last.sec, last.para)
    const caption = first.table !== null && (CAPTION_START.test(text) || CAPTION_STYLES.has(style))
    const heading = props.headType === 'Outline'
    if (!kept && !caption && !heading) continue
    alone.push({
      page: slots[k].page,
      ...(slots[k].columns > 1 ? { column: slots[k].column } : {}),
      kind: caption ? 'caption' : heading ? 'heading' : 'line',
      text,
      style,
      nextPage: slots[k + 1].page,
      ...(kept ? { kept: true } : {}),
      ...(first.para > last.para + 1 && slots[k].drawn.has(`${last.sec}/${last.para + 1}`)
        ? { apart: true }
        : {}),
    })
  }
  return {
    pages,
    alone,
    spans: [...spans]
      .filter(([, on]) => on.length > 1)
      .map(([table, on]) => ({ table, from: on[0], to: on.at(-1) })),
    past,
  }
}

/**
 * Where the engine's laid-out position `logical` (a run's charStart, which counts the objects
 * standing in the text) falls in the paragraph's text, which does not count them.
 */
function textOffsetOf(doc, sec, para, logical) {
  try {
    return doc.logicalToTextOffset(sec, para, logical)
  } catch {
    return logical
  }
}

/** The first words of body paragraph `para` from character `from` on, or '' when it has none. */
function paragraphText(doc, sec, para, from = 0) {
  const length = doc.getParagraphLength(sec, para)
  if (length <= from) return ''
  return clip(
    doc
      .getTextRange(sec, para, from, length - from)
      .replace(/\s+/g, ' ')
      .trim(),
    PREVIEW_CHARS,
  )
}

/**
 * The table cells whose text does not fit, as the pages are laid out (checkLayout lays them
 * out with the widths print and export use): a row keeps the height the file gives it, so a
 * line drawn past the cell's bottom edge is cut off on the page and in print. The cells'
 * boxes come from one read per table (getTableCellBboxesByPath) and their lines from one
 * read per page (cellLinesOn); a cell that runs on to the next page is measured page by
 * page. `over` is how far the text goes past the edge, in mm.
 *
 * Starts at table `fromTable`, row `fromRow` (1-based, as listTables and readTable number
 * them) and goes on for about two seconds or until MAX_LISTED_OVERFLOWS cells are listed,
 * always ending on a whole row; `next` names where the next call starts. Given `toRow`,
 * only table `fromTable` is measured, up to that row. Reads only.
 *
 * Beside the cut cells: `wrapped`, the cells a line of which starts inside a word, and
 * `past`, per table the first row drawn below the foot of a page's text area, whatever rows
 * were measured (a table stands whole on its page here, and one taller than the page runs
 * off it, `taller`); a table set at a height on the page stands where it was put.
 */
function overflowsOf(doc, fromTable, fromRow, toRow = null) {
  const { tables, partial } = tablesOf(doc)
  const start = Number.isInteger(fromTable) && fromTable >= 1 ? fromTable - 1 : 0
  const firstRow = Number.isInteger(fromRow) && fromRow >= 1 ? fromRow - 1 : 0
  const end = toRow === null ? tables.length : Math.min(start + 1, tables.length)
  const lastRow = toRow === null ? Infinity : toRow - 1
  const began = Date.now()
  const pages = new Map()
  const linesOn = (page) => {
    if (!pages.has(page)) pages.set(page, cellLinesOn(doc, page))
    return pages.get(page)
  }
  const areas = new Map()
  const areaOf = (page) => {
    if (!areas.has(page)) areas.set(page, bodyAreaOf(doc, page))
    return areas.get(page)
  }
  const toMm = (px) => Math.round(((px * 25.4) / 96) * 10) / 10
  const cells = []
  const wrapped = []
  const past = []
  let measured = 0
  let next = null
  for (let index = start; index < end && !next; index++) {
    const table = tables[index]
    let boxes
    try {
      boxes = parse(doc.getTableCellBboxesByPath(table.sec, table.para, JSON.stringify(table.path)))
    } catch {
      continue
    }
    if (!Array.isArray(boxes)) continue
    // the boxes number cells as the layout does, which can differ from the document's own
    // cell numbers (a table with a caption): the box's row and column name the cell
    let grid
    try {
      grid = gridOf(doc, table)
    } catch {
      continue
    }
    const cellAtPlace = new Map(grid.map((g) => [`${g.row}/${g.col}`, g.cell]))
    const key = tableKey(table.sec, table.para, table.path)
    const broken = new Set()
    const texts = new Map()
    const textOf = (cell) => {
      if (!texts.has(cell)) texts.set(cell, paragraphsOf(cellBox(doc, table, cell)))
      return texts.get(cell)
    }
    const rows = new Map()
    for (const box of boxes) {
      if (index === start && (box.row < firstRow || box.row > lastRow)) continue
      if (!rows.has(box.row)) rows.set(box.row, [])
      rows.get(box.row).push(box)
    }
    const below = boxes
      .filter((box) => box.y + box.h > areaOf(box.pageIndex).foot + 1)
      .sort((a, b) => a.row - b.row)
    if (
      below.length > 0 &&
      !(
        table.path.length === 1 &&
        placementOf(doc, table.sec, table.para, table.path[0].controlIndex).fixed
      )
    ) {
      const { pageIndex } = below[0]
      const { top, foot } = areaOf(pageIndex)
      const onPage = boxes.filter((box) => box.pageIndex === pageIndex)
      const height =
        Math.max(...onPage.map((box) => box.y + box.h)) - Math.min(...onPage.map((box) => box.y))
      past.push({
        table: index + 1,
        row: below[0].row + 1,
        page: pageIndex + 1,
        ...(height > foot - top + 1 ? { taller: true } : {}),
      })
    }
    for (const row of [...rows.keys()].sort((a, b) => a - b)) {
      if (
        measured > 0 &&
        (cells.length >= MAX_LISTED_OVERFLOWS || Date.now() - began > LAYOUT_BATCH_MS)
      ) {
        next = { table: index + 1, row: row + 1 }
        break
      }
      const listed = new Set()
      const counted = new Set()
      for (const box of rows.get(row)) {
        const cell = cellAtPlace.get(`${box.row}/${box.col}`)
        if (cell === undefined) continue
        if (!counted.has(cell)) {
          counted.add(cell)
          measured += 1
        }
        if (listed.has(cell)) continue
        const runs = linesOn(box.pageIndex).get(`${key}/${cell}`) ?? []
        if (!broken.has(cell) && breaksInsideWord(runs, box, () => textOf(cell))) {
          broken.add(cell)
          wrapped.push({
            table: index + 1,
            row: box.row + 1,
            col: box.col + 1,
            page: box.pageIndex + 1,
            text: clip(textOf(cell).join(' ').trim(), PREVIEW_CHARS),
          })
        }
        const cut = overflowIn(runs, box, () => textOf(cell))
        if (cut === null) continue
        listed.add(cell)
        cells.push({
          table: index + 1,
          row: box.row + 1,
          col: box.col + 1,
          page: box.pageIndex + 1,
          over: toMm(cut),
          text: clip(textOf(cell).join(' ').trim(), PREVIEW_CHARS),
        })
      }
    }
  }
  return {
    tables: tables.length,
    from: { table: start + 1, row: firstRow + 1 },
    cells,
    wrapped,
    past,
    measured,
    ...(next ? { next } : {}),
    ...(partial ? { partial: true } : {}),
  }
}

function cutCellsOf(doc) {
  const cells = []
  let from = { table: 1, row: 1 }
  for (;;) {
    const checked = overflowsOf(doc, from.table, from.row)
    cells.push(...checked.cells.map(({ table, row, col }) => ({ table, row, col })))
    if (!checked.next) return cells
    from = checked.next
  }
}

/**
 * Table `number` (as listTables numbers them) when it sits in a body paragraph, with its
 * cells; otherwise a refusal. The engine merges and splits cells by table and cell number,
 * which cannot name a table inside another table's cell.
 */
function bodyTable(doc, number) {
  const { tables } = tablesOf(doc)
  const table = Number.isInteger(number) ? tables[number - 1] : undefined
  if (!table) return { refusal: { ok: false, reason: 'no_such_table', count: tables.length } }
  if (table.path.length > 1) return { refusal: { ok: false, reason: 'unsupported_place' } }
  return { table, grid: gridOf(doc, table) }
}

/** The cells of a table with the place each takes: zero-based row and column, and its spans. */
function gridOf(doc, table) {
  const cells = []
  for (let cell = 0; cell < table.cells; cell++) {
    const info = parse(
      doc.getCellInfoByPath(table.sec, table.para, JSON.stringify(cellAt(table.path, cell, 0))),
    )
    cells.push({
      cell,
      row: info.row,
      col: info.col,
      rowSpan: info.rowSpan || 1,
      colSpan: info.colSpan || 1,
    })
  }
  return cells
}

/** The paragraphs of one cell, addressed like the paragraphs a match sits in. */
const cellBox = (doc, table, cell) =>
  containerOf(doc, { sec: table.sec, para: table.para, cellPath: cellAt(table.path, cell, 0) })

/** Whether a character is a form's tick box, ticked or not. */
const isBoxChar = (char) => BOX_CHARS.includes(char) || CHECKED_BOX_CHARS.includes(char)

/** The bullet characters of the document by bullet id (1-based), as getBulletList gives them. */
function bulletChars(doc) {
  const byId = new Map()
  for (const bullet of parse(doc.getBulletList())) {
    if (Number.isInteger(bullet.id) && typeof bullet.char === 'string') {
      byId.set(bullet.id, bullet.char)
    }
  }
  return byId
}

/**
 * The tick boxes a cell carries as paragraph bullets. A bullet lives in the paragraph
 * shape, not in the cell's text, so it cannot be replaced or deleted: a form's □ choices
 * are often these. A table inside another table's cell cannot be asked for a paragraph
 * shape, so those come back empty.
 */
function boxBulletsOf(doc, table, cell, bullets) {
  if (table.path.length > 1) return []
  const control = table.path[0].controlIndex
  const count = doc.getCellParagraphCountByPath(
    table.sec,
    table.para,
    JSON.stringify(cellAt(table.path, cell, 0)),
  )
  const boxes = []
  for (let k = 0; k < count; k++) {
    let props
    try {
      props = parse(doc.getCellParaPropertiesAt(table.sec, table.para, control, cell, k))
    } catch {
      continue
    }
    if (props.headType !== 'Bullet') continue
    const char = bullets.get(props.numberingId) ?? ''
    if (!isBoxChar(char)) continue
    boxes.push({ k, char, checked: CHECKED_BOX_CHARS.includes(char) })
  }
  return boxes
}

/**
 * The tick boxes typed into the text of a cell's paragraphs: the words right after a box
 * (or before it, when nothing follows) are the choice it belongs to. Offsets count
 * characters the way the engine does.
 */
function literalBoxesOf(texts) {
  const boxes = []
  for (let k = 0; k < texts.length; k++) {
    const chars = [...texts[k]]
    for (let i = 0; i < chars.length; i++) {
      if (!isBoxChar(chars[i])) continue
      let end = i + 1
      while (end < chars.length && !isBoxChar(chars[end])) end++
      let label = chars
        .slice(i + 1, end)
        .join('')
        .trim()
      if (!label) {
        let start = i - 1
        while (start >= 0 && !isBoxChar(chars[start])) start--
        label = chars
          .slice(start + 1, i)
          .join('')
          .trim()
      }
      boxes.push({
        kind: 'text',
        k,
        offset: i,
        label: clip(label, MAX_BOX_CHOICE_CHARS),
        checked: CHECKED_BOX_CHARS.includes(chars[i]),
      })
    }
  }
  return boxes
}

/** The tick boxes of a cell as candidates: its bullet boxes first, then the ones in its text. */
function boxesOf(doc, table, cell, texts, bullets) {
  const bullet = boxBulletsOf(doc, table, cell, bullets).map((entry) => ({
    kind: 'bullet',
    k: entry.k,
    label: clip((texts[entry.k] ?? '').trim(), MAX_BOX_CHOICE_CHARS),
    checked: entry.checked,
  }))
  return [...bullet, ...literalBoxesOf(texts)]
}

/**
 * The box `choice` names among the boxes of one cell. Without a choice the only box is
 * taken. Several, or a choice that names none, come back with the words of every box so
 * the caller can ask again.
 */
function pickBox(boxes, choice) {
  if (boxes.length === 0) return {}
  const wanted = typeof choice === 'string' ? choice.trim() : ''
  if (!wanted) {
    return boxes.length === 1
      ? { box: boxes[0] }
      : { choices: boxes.map((box) => box.label).filter(Boolean) }
  }
  const exact = boxes.filter((box) => box.label === wanted)
  if (exact.length === 1) return { box: exact[0] }
  const partial = boxes.filter(
    (box) => box.label !== '' && (box.label.includes(wanted) || wanted.includes(box.label)),
  )
  if (partial.length === 1) return { box: partial[0] }
  return { choices: boxes.map((box) => box.label).filter(Boolean) }
}

function paragraphsOf(box) {
  const texts = []
  const count = box.count()
  for (let k = 0; k < count; k++) texts.push(box.text(k, box.length(k)))
  return texts
}

/** Characters of preview text a save writes: Hangul keeps about this many (decision 0146). */
const PREVIEW_TEXT_CHARS = 1022
/** The preview picture's height in pixels, as Hangul 2024 draws it (724 × 1024 for A4). */
const PREVIEW_IMAGE_HEIGHT = 1024

/** What `read` returns, or `fallback` when it throws. */
function tryOr(read, fallback) {
  try {
    return read()
  } catch {
    return fallback
  }
}

/** A tab is a space in the preview; the engine's other control characters are no text. */
const previewLineOf = (text) =>
  String(text)
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex -- control characters are what this drops
    .replace(/[\u0000-\u001f]/g, '')

/**
 * The first lines of the document as Hangul writes them into `PrvText`: a line per body
 * paragraph, and in it, where it stands, each table as its rows (a row a line, each cell
 * as `<text>`, the paragraph's text going on after the last row) and each text box as
 * `<text>`. The paragraphs of a cell or a box are joined by a space, and a table or box
 * inside one follows its text. Only as much as the preview keeps is read.
 */
function previewTextOf(doc) {
  let text = ''
  const room = () => PREVIEW_TEXT_CHARS - text.length
  const json = JSON.stringify

  /** The paragraphs of one cell (or of a text box, cell 0), at most about `limit` chars. */
  const listText = (sec, para, path, cell, depth, limit) => {
    const count = tryOr(
      () => doc.getCellParagraphCountByPath(sec, para, json(cellAt(path, cell, 0))),
      0,
    )
    const parts = []
    let size = 0
    for (let k = 0; k < count && size < limit; k++) {
      const at = cellAt(path, cell, k)
      const length = tryOr(() => doc.getCellParagraphLengthByPath(sec, para, json(at)), 0)
      let line =
        length > 0
          ? previewLineOf(tryOr(() => doc.getTextInCellByPath(sec, para, json(at), 0, length), ''))
          : ''
      if (depth < MAX_TABLE_DEPTH) {
        for (let inner = 0; inner < NESTED_CONTROLS_TRIED; inner++) {
          const step = { controlIndex: inner, cellIndex: 0, cellParaIndex: 0 }
          // inside a cell only a table counts: the engine cannot tell a box there from a note
          line += objectText(sec, para, [...at, step], depth + 1, limit - size - line.length, false)
        }
      }
      parts.push(line)
      size += line.length + 1
    }
    return parts.join(' ')
  }

  /**
   * A table as its lines, a text box (`box`: the object is a shape) as `<text>`, anything
   * else (a picture, a header, a note) as nothing. Hangul writes a table's cells in their
   * stored order and starts a line at each cell in the first column, so a cell under a
   * merged first column stays on the line above.
   */
  const objectText = (sec, para, path, depth, limit, box) => {
    if (limit <= 0) return ''
    const dims = tryOr(() => parse(doc.getTableDimensionsByPath(sec, para, json(path))), null)
    if (!dims) {
      if (!box) return ''
      const count = tryOr(
        () => doc.getCellParagraphCountByPath(sec, para, json(cellAt(path, 0, 0))),
        0,
      )
      return count > 0 ? `<${listText(sec, para, path, 0, depth, limit)}>` : ''
    }
    let out = ''
    for (let cell = 0; cell < dims.cellCount && out.length < limit; cell++) {
      const col = tryOr(
        () => parse(doc.getCellInfoByPath(sec, para, json(cellAt(path, cell, 0)))).col,
        0,
      )
      if (cell > 0 && col === 0) out += '\r\n'
      out += `<${listText(sec, para, path, cell, depth, limit - out.length)}>`
    }
    return out
  }

  /** The object is a drawn shape (a text box), not a header, footer or note. */
  const isShape = (sec, para, ctrl) =>
    tryOr(() => {
      doc.getShapeProperties(sec, para, ctrl)
      return true
    }, false)

  const sections = doc.getSectionCount()
  for (let sec = 0; sec < sections && room() > 0; sec++) {
    const paragraphs = doc.getParagraphCount(sec)
    for (let para = 0; para < paragraphs && room() > 0; para++) {
      const length = doc.getParagraphLength(sec, para)
      const raw = length > 0 ? doc.getTextRange(sec, para, 0, length) : ''
      const places = tryOr(() => parse(doc.getControlTextPositions(sec, para)), [])
      // the objects in the order they stand in the text
      const order = places
        .map((at, ctrl) => ({ at: Number.isInteger(at) ? at : 0, ctrl }))
        .sort((a, b) => a.at - b.at || a.ctrl - b.ctrl)
      let line = ''
      let from = 0
      for (const { at, ctrl } of order) {
        const to = Math.min(Math.max(at, from), length)
        line += previewLineOf(engineSlice(raw, from, to))
        from = to
        const step = { controlIndex: ctrl, cellIndex: 0, cellParaIndex: 0 }
        line += objectText(sec, para, [step], 1, room() - line.length, isShape(sec, para, ctrl))
      }
      line += previewLineOf(engineSlice(raw, from, length))
      text += `${line}\r\n`
    }
  }
  return Array.from(text).slice(0, PREVIEW_TEXT_CHARS).join('')
}

/**
 * The first page as base64 PNG, PREVIEW_IMAGE_HEIGHT high on white, the way the screen
 * draws it; null where there is no page or nothing to draw on (no DOM in a test).
 */
function previewPngOf(doc) {
  const sheet = globalThis.document
  if (!sheet || doc.pageCount() < 1) return null
  const info = JSON.parse(doc.getPageInfo(0))
  if (!(info.width > 0 && info.height > 0)) return null
  const scale = PREVIEW_IMAGE_HEIGHT / info.height
  const page = sheet.createElement('canvas')
  doc.renderPageToCanvas(0, page, scale)
  if (!page.width || !page.height) return null
  const out = sheet.createElement('canvas')
  out.width = Math.max(1, Math.round(info.width * scale))
  out.height = PREVIEW_IMAGE_HEIGHT
  const pen = out.getContext('2d')
  if (!pen) return null
  pen.fillStyle = '#ffffff'
  pen.fillRect(0, 0, out.width, out.height)
  // the engine may draw at the screen's pixel ratio: fit what it drew to the picture
  pen.drawImage(page, 0, 0, out.width, out.height)
  const url = out.toDataURL('image/png')
  const comma = url.indexOf(',')
  return url.startsWith('data:image/png') && comma > 0 ? url.slice(comma + 1) : null
}

/** The text of one body paragraph, folded to one line, without control characters. */
function paragraphTextOf(doc, sec, para) {
  try {
    const length = doc.getParagraphLength(sec, para)
    if (length <= 0) return ''
    return foldText(doc.getTextRange(sec, para, 0, length))
  } catch {
    return ''
  }
}

function foldText(text) {
  return (
    String(text)
      // eslint-disable-next-line no-control-regex -- control characters are what this folds away
      .replace(/[\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * The closest text above a paragraph, skipping empty lines: Korean reports put a title
 * line, a blank line and the table under it, so a blank line is not "no title".
 */
function textAbove(doc, sec, para, textAt) {
  const own = textAt(sec, para)
  if (own) return own
  for (let k = para - 1; k >= 0; k--) {
    const above = textAt(sec, k)
    if (above) return above
  }
  return ''
}

/** The Hangul font name of a character shape, or '' when the engine gave none. */
function hangulFontOf(props) {
  const families = props && Array.isArray(props.fontFamilies) ? props.fontFamilies : []
  const name = typeof families[0] === 'string' ? families[0] : ''
  return name.trim()
}

/**
 * What the document is made of, for the format checks of `@genoffice/doc-rules`: the
 * paragraphs, the tables with their cells, the pictures, and every character shape in use
 * with the fonts it names. Reads only — it never changes the document, and it calls no
 * model. A cap that is reached sets `truncated`, so the panel can say it saw part of it.
 */
function profileOf(doc) {
  const shapes = new Map()
  const paragraphs = []
  const tables = []
  const pictures = []
  const texts = new Map()
  let truncated = false
  let shapeReads = 0
  let cellParagraphs = 0

  const textAt = (sec, para) => {
    const key = `${sec}:${para}`
    let text = texts.get(key)
    if (text === undefined) {
      text = paragraphTextOf(doc, sec, para)
      texts.set(key, text)
    }
    return text
  }

  /** One character shape seen at a place: its fonts, how often it is used, and where first. */
  const noteShape = (props, anchor) => {
    const id = props && props.charShapeId != null ? String(props.charShapeId) : ''
    const fonts = Array.isArray(props && props.fontFamilies)
      ? props.fontFamilies.filter((name) => typeof name === 'string' && name.trim() !== '')
      : typeof (props && props.fontFamily) === 'string' && props.fontFamily.trim() !== ''
        ? [props.fontFamily]
        : []
    let entry = shapes.get(id)
    if (!entry) {
      entry = { id, fonts: [...new Set(fonts)], uses: 0 }
      shapes.set(id, entry)
    }
    entry.uses += 1
    if (!entry.first) entry.first = anchor
  }

  /** The character shapes of one range of one paragraph, body or cell. */
  const noteRuns = (runs, propsAt, anchor) => {
    for (const run of Array.isArray(runs) ? runs : []) {
      if (shapeReads >= MAX_PROFILE_SHAPES) {
        truncated = true
        return
      }
      shapeReads += 1
      try {
        noteShape(parse(propsAt(run.startOffset ?? 0)), anchor)
      } catch {
        // a shape the engine will not read is left out of the font check
      }
    }
  }

  const sections = doc.getSectionCount()
  for (let sec = 0; sec < sections; sec++) {
    const count = doc.getParagraphCount(sec)
    for (let para = 0; para < count; para++) {
      if (paragraphs.length >= MAX_PROFILE_PARAGRAPHS) {
        truncated = true
        break
      }
      paragraphs.push({ index: para, section: sec, text: textAt(sec, para) })
      let length
      try {
        length = doc.getParagraphLength(sec, para)
      } catch {
        length = 0
      }
      if (length <= 0) continue
      let runs
      try {
        runs = parse(doc.getCharShapeRuns(sec, para, 0, length))
      } catch {
        runs = []
      }
      noteRuns(runs, (offset) => doc.getCharPropertiesAt(sec, para, offset), { section: sec, para })
    }
    if (paragraphs.length >= MAX_PROFILE_PARAGRAPHS) break
  }

  const found = tablesOf(doc)
  if (found.partial) truncated = true
  if (found.tables.length > MAX_PROFILE_TABLES) truncated = true
  for (const table of found.tables.slice(0, MAX_PROFILE_TABLES)) {
    const cells = []
    try {
      for (const cell of gridOf(doc, table)) {
        if (cells.length >= MAX_PROFILE_CELLS) {
          truncated = true
          break
        }
        cells.push({ row: cell.row, col: cell.col, rowSpan: cell.rowSpan, colSpan: cell.colSpan })
      }
    } catch {
      // a table whose cells the engine will not read is reported without them
    }
    const info = {
      index: tables.length,
      anchor: { section: table.sec, para: table.para, path: table.path },
      rows: table.rows,
      cols: table.cols,
      // a table inside a cell is part of that cell's content: it has no title of its own
      titleAbove: table.parent === null ? textAbove(doc, table.sec, table.para, textAt) : '',
      nested: table.parent !== null,
      cells,
    }
    // a one-cell table may be a title box: its text is what the check reports
    if (table.rows === 1 && table.cols === 1 && cells[0]) {
      try {
        const cellPath = cellAt(table.path, 0, 0)
        const length = doc.getCellParagraphLengthByPath(
          table.sec,
          table.para,
          JSON.stringify(cellPath),
        )
        const text =
          length > 0
            ? doc.getTextInCellByPath(table.sec, table.para, JSON.stringify(cellPath), 0, length)
            : ''
        cells[0].text = foldText(text).slice(0, 80)
      } catch {
        // no text to report
      }
    }
    tables.push(info)

    // the fonts inside the table, cell by cell: a form's text is mostly in cells
    for (
      let cell = 0;
      cell < table.cells &&
      shapeReads < MAX_PROFILE_SHAPES &&
      cellParagraphs < MAX_PROFILE_CELL_PARAGRAPHS;
      cell++
    ) {
      let count
      try {
        count = doc.getCellParagraphCountByPath(
          table.sec,
          table.para,
          JSON.stringify(cellAt(table.path, cell, 0)),
        )
      } catch {
        continue
      }
      for (let k = 0; k < count && shapeReads < MAX_PROFILE_SHAPES; k++) {
        if (cellParagraphs >= MAX_PROFILE_CELL_PARAGRAPHS) {
          truncated = true
          break
        }
        cellParagraphs += 1
        const path = cellAt(table.path, cell, k)
        const json = JSON.stringify(path)
        let length
        try {
          length = doc.getCellParagraphLengthByPath(table.sec, table.para, json)
        } catch {
          length = 0
        }
        if (length <= 0) continue
        let runs
        try {
          runs = parse(doc.getCharShapeRunsInCellByPath(table.sec, table.para, json, 0, length))
        } catch {
          runs = []
        }
        noteRuns(
          runs,
          (offset) => doc.getCellCharPropertiesAtByPath(table.sec, table.para, json, offset),
          { section: table.sec, para: table.para, path },
        )
      }
    }
  }

  // the body's pictures, in reading order; a picture inside a cell belongs to that cell
  for (let sec = 0; sec < doc.getSectionCount(); sec++) {
    const count = doc.getParagraphCount(sec)
    for (let para = 0; para < count && pictures.length < MAX_PROFILE_PICTURES; para++) {
      let positions
      try {
        positions = parse(doc.getControlTextPositions(sec, para))
      } catch {
        positions = []
      }
      for (let control = 0; control < positions.length; control++) {
        if (pictures.length >= MAX_PROFILE_PICTURES) break
        let mime
        try {
          mime = doc.getControlImageMime(sec, para, '[]', control)
        } catch {
          continue // not a picture: a table, a field, a section definition
        }
        if (!mime.startsWith('image/')) continue
        pictures.push({
          index: pictures.length,
          anchor: { section: sec, para },
          titleAbove: textAbove(doc, sec, para, textAt),
        })
      }
    }
  }
  if (pictures.length >= MAX_PROFILE_PICTURES) truncated = true

  const profile = {
    charShapes: [...shapes.values()],
    paragraphs,
    tables,
    pictures,
  }
  if (truncated) profile.truncated = true
  return profile
}

/**
 * Whether a cell holds an object: a picture, a shape, a table of its own. Such a cell can
 * be without a single character and still not be empty, and text written into it lands on
 * top of the picture. The engine does not list the objects of a cell paragraph, but asked
 * for a table there it answers "out of range" only when the paragraph holds no object at
 * all. Should that wording change, every cell reads as holding one and nothing is written:
 * the safe side, and the engine tests fail. A memo is a field of the file, seen here like a
 * control that is not a table; it is counted apart so that a memo alone is not an object.
 */
function memosInCellParagraph(doc, table, cell, k) {
  const wanted = cellAt(table.path, cell, k)
  return memoEntriesOf(doc).filter((entry) => {
    if (entry.place !== 'tableCell') return false
    const path = memoPathOf(entry)
    return Boolean(
      path &&
      path.length === wanted.length &&
      path.every(
        (step, index) =>
          step.controlIndex === wanted[index].controlIndex &&
          step.cellIndex === wanted[index].cellIndex &&
          step.cellParaIndex === wanted[index].cellParaIndex,
      ),
    )
  }).length
}

/** How many controls a cell paragraph has, and how many of them are tables. */
function cellControlsOf(doc, table, cell, k, memos) {
  let controls = 0
  let tables = 0
  const limit = Math.min(MAX_CELL_CONTROLS, memos + NESTED_CONTROLS_TRIED)
  for (let index = 0; index < limit; index++) {
    const path = [
      ...cellAt(table.path, cell, k),
      { controlIndex: index, cellIndex: 0, cellParaIndex: 0 },
    ]
    try {
      doc.getTableDimensionsByPath(table.sec, table.para, JSON.stringify(path))
      controls += 1
      tables += 1
    } catch (thrown) {
      if (String(thrown).includes(NO_OBJECT_THERE)) break
      controls += 1
    }
  }
  return { controls, tables }
}

function cellHoldsObject(doc, table, cell) {
  const paragraphs = doc.getCellParagraphCountByPath(
    table.sec,
    table.para,
    JSON.stringify(cellAt(table.path, cell, 0)),
  )
  for (let k = 0; k < paragraphs; k++) {
    const memos = memosInCellParagraph(doc, table, cell, k)
    const { controls } = cellControlsOf(doc, table, cell, k, memos)
    if (controls > memos) return true
  }
  return false
}

/**
 * Whether a cell holds an object other than a table: a picture, a shape. Asked for a table
 * there, the engine answers with its size, "out of range" when the paragraph has no more
 * objects, and another error for an object that is not a table. Only the first few objects
 * of a paragraph are asked about, as tablesOf does; a caller that removes the cell checks
 * the object count afterwards.
 */
function cellHoldsOtherObject(doc, table, cell) {
  const paragraphs = doc.getCellParagraphCountByPath(
    table.sec,
    table.para,
    JSON.stringify(cellAt(table.path, cell, 0)),
  )
  for (let k = 0; k < paragraphs; k++) {
    const memos = memosInCellParagraph(doc, table, cell, k)
    const { controls, tables } = cellControlsOf(doc, table, cell, k, memos)
    if (controls - tables - memos > 0) return true
  }
  return false
}

/** Whether the cell paragraph at `cellPath` (its last entry naming the paragraph) holds an object. */
function paragraphHoldsObject(doc, sec, para, cellPath) {
  const first = [...cellPath, { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }]
  try {
    doc.getTableDimensionsByPath(sec, para, JSON.stringify(first))
    return true
  } catch (thrown) {
    return !String(thrown).includes(NO_OBJECT_THERE)
  }
}

/**
 * The cells of a table that an object of the page lies on: a seal or a logo that belongs to
 * the body text and floats over the cell. It is not in the cell, so cellHoldsObject does not
 * see it, but text written there lands under it all the same. An object counts for the cell
 * its middle is in; one placed behind the text (a watermark) does not count.
 */
function coveredCells(doc, table) {
  const covered = new Set()
  let boxes
  try {
    boxes = parse(doc.getTableCellBboxesByPath(table.sec, table.para, JSON.stringify(table.path)))
  } catch {
    return covered
  }
  const pages = new Map()
  for (const box of boxes) {
    if (!Number.isInteger(box.pageIndex)) continue
    const list = pages.get(box.pageIndex)
    if (list) list.push(box)
    else pages.set(box.pageIndex, [box])
  }
  for (const [page, cells] of pages) {
    let controls
    try {
      controls = parse(doc.getPageControlLayout(page)).controls ?? []
    } catch {
      continue
    }
    for (const control of controls) {
      if (!FLOATING_KINDS.has(control.type) || control.wrap === 'behindText') continue
      const x = control.x + control.w / 2
      const y = control.y + control.h / 2
      const under = cells.find(
        (cell) => x >= cell.x && x <= cell.x + cell.w && y >= cell.y && y <= cell.y + cell.h,
      )
      if (under) covered.add(under.cellIdx)
    }
  }
  return covered
}

/**
 * A text cut to `max` characters with an ellipsis. Characters are the engine's (code points), so
 * an emoji or a Han character outside the basic plane is never cut in half.
 */
const clip = (text, max) => (engineLength(text) > max ? `${engineSlice(text, 0, max)}…` : text)

/**
 * The fields a form asks to be filled in: click-here fields and named table cells, in
 * document order. The engine lists every field, also a formula (a table's =SUM total) and
 * a hyperlink, which are not answers: filling one would overwrite the computed value or
 * the link text. listFields numbers these, and fillField and readTable use the numbers.
 */
function formFieldsOf(doc) {
  // a memo is neither: it never takes an answer and never shifts the numbers
  return parse(doc.getFieldList()).filter(
    (field) =>
      field.fieldType !== 'memo' && (field.cellField === true || field.fieldType === 'clickhere'),
  )
}

/**
 * The click-here fields that sit directly in a table cell, by table and cell. A cell that
 * holds one is filled through the field: text typed beside an empty field would leave its
 * guide text standing next to the answer.
 */
function fieldsByCell(doc) {
  const byCell = new Map()
  formFieldsOf(doc).forEach((field, index) => {
    if (field.cellField === true) return
    const where = field.location
    const path = where && Array.isArray(where.path) ? where.path : []
    if (path.length === 0 || path.some((entry) => entry.type !== 'cell')) return
    const cells = path.map((entry) => ({
      controlIndex: entry.controlIndex,
      cellIndex: entry.cellIndex,
      cellParaIndex: entry.paraIndex,
    }))
    const key = `${tableKey(where.sectionIndex, where.paraIndex, cells)}:${cells[cells.length - 1].cellIndex}`
    const entry = {
      number: index + 1,
      key: fieldKey(field),
      fieldId: field.fieldId,
      value: field.value ?? '',
      guide: field.guide ?? '',
    }
    const list = byCell.get(key)
    if (list) list.push(entry)
    else byCell.set(key, [entry])
  })
  return byCell
}

/** An empty field shows its guide text, which the engine also reports as its value. */
const fieldIsEmpty = (field) => field.value === '' || field.value === field.guide

/** What fillCells was asked to write: 1-based places, and the text of each as lines. */
function checkCells(cells) {
  if (!Array.isArray(cells) || cells.length === 0 || cells.length > MAX_FILLED_CELLS) {
    throw fail('BAD_ARGUMENT', `cells must be a list of 1 to ${MAX_FILLED_CELLS} entries`)
  }
  return cells.map((entry) => {
    const { row, col, text } = entry ?? {}
    if (!Number.isInteger(row) || row < 1 || !Number.isInteger(col) || col < 1) {
      throw fail('BAD_ARGUMENT', 'row and col count from 1 and are whole numbers')
    }
    if (typeof text !== 'string') throw fail('BAD_ARGUMENT', 'the text of a cell must be a string')
    const lines = text.split(/\r?\n/)
    if (lines.length > MAX_CELL_LINES || lines.some((line) => CONTROL_CHARS.test(line))) {
      throw fail('BAD_ARGUMENT', `a cell takes plain text of at most ${MAX_CELL_LINES} lines`)
    }
    return { row, col, lines }
  })
}

/** What checkBoxes was asked to tick: 1-based places, and the words beside a box when needed. */
function checkBoxCells(cells) {
  if (!Array.isArray(cells) || cells.length === 0 || cells.length > MAX_CHECKED_CELLS) {
    throw fail('BAD_ARGUMENT', `cells must be a list of 1 to ${MAX_CHECKED_CELLS} entries`)
  }
  return cells.map((entry) => {
    const { row, col, choice } = entry ?? {}
    if (!Number.isInteger(row) || row < 1 || !Number.isInteger(col) || col < 1) {
      throw fail('BAD_ARGUMENT', 'row and col count from 1 and are whole numbers')
    }
    if (choice != null) {
      if (typeof choice !== 'string' || choice.trim() === '' || CONTROL_CHARS.test(choice)) {
        throw fail('BAD_ARGUMENT', 'choice must be one line of the words beside the box')
      }
    }
    return { row, col, choice: typeof choice === 'string' ? choice : null }
  })
}

/** What a row or column call names: true for rows, false for columns. */
function checkLines(what, at, count) {
  if (what !== 'rows' && what !== 'columns') {
    throw fail('BAD_ARGUMENT', 'what must be "rows" or "columns"')
  }
  if (!Number.isInteger(at) || at < 1) {
    throw fail('BAD_ARGUMENT', 'at counts from 1 and is a whole number')
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_TABLE_LINES) {
    throw fail('BAD_ARGUMENT', `count must be between 1 and ${MAX_TABLE_LINES}`)
  }
  return what === 'rows'
}

function pickHit(hits, occurrence) {
  if (hits.length === 0) return { reason: 'not_found' }
  if (occurrence === undefined || occurrence === null) {
    return hits.length === 1 ? { hit: hits[0] } : { reason: 'ambiguous' }
  }
  if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > hits.length) {
    return { reason: 'no_such_occurrence' }
  }
  return { hit: hits[occurrence - 1] }
}

/** Most notes listNotes lists. */
const MAX_LISTED_NOTES = 200
/** Longest note text listNotes shows. */
const MAX_LISTED_NOTE_CHARS = 500
/** Most paragraphs one note is written with. */
const MAX_NOTE_LINES = 20
/** Text shown before a note's mark, so the model can tell where it sits. */
const NOTE_CONTEXT_CHARS = 30
const NOTE_KINDS = ['footnote', 'endnote']
const NOTE_CONTROL_IDS = new Set(['fn', 'en'])
/** What comes before the text in the first paragraph of a note: its number and a space. */
const NOTE_NUMBER_CHARS = 2

/**
 * The engine answers a note with its text as JSON, but leaves a tab in that text unescaped,
 * which JSON does not allow. Its answers carry no whitespace between tokens, so every control
 * character in one is inside a string and can be escaped.
 */
const parseNoteInfo = (json) =>
  JSON.parse(
    // eslint-disable-next-line no-control-regex
    json.replace(/[\u0000-\u001f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`),
  )

/**
 * The footnotes and endnotes of the body, in reading order. A note is addressed by the
 * body paragraph its mark sits in and its index among that paragraph's controls. The
 * engine has no such address for a note inside a table cell or a text box: `elsewhere`
 * counts those.
 *
 * The first paragraph of a note starts with its number and a space (`prefix` characters);
 * `lines` is the text after them. A note that holds anything but text (an equation, a
 * picture) is not `plain`: its text is shown but not rewritten.
 */
function notesOf(doc) {
  const controls = parse(doc.getControls()).filter((control) =>
    NOTE_CONTROL_IDS.has(control.ctrlId),
  )
  const notes = []
  if (controls.length === 0) return { notes, elsewhere: 0 }
  // the notes of the body, in document order: their kind, when the engine cannot say it
  // here (a new endnote has no place on a page until the editor lays the pages out again)
  const bodyNotes = controls.filter((control) => control.list === 0)
  const sections = doc.getSectionCount()
  for (let sec = 0; sec < sections; sec++) {
    const paragraphs = doc.getParagraphCount(sec)
    for (let para = 0; para < paragraphs && notes.length < controls.length; para++) {
      const positions = parse(doc.getControlTextPositions(sec, para))
      positions.forEach((offset, control) => {
        let info
        try {
          info = parseNoteInfo(doc.getFootnoteInfo(sec, para, control))
        } catch {
          return // not a note: a table, a picture, a section definition
        }
        if (!info.ok) return
        let kind = null
        let prefix = NOTE_NUMBER_CHARS
        try {
          const edit = parse(doc.getNoteEditInfo(sec, para, control))
          kind = edit.kind
          if (Number.isInteger(edit.charOffset)) prefix = edit.charOffset
        } catch {
          const listed = bodyNotes[notes.length]
          if (listed && listed.para === para && listed.controlIndex === control) {
            kind = listed.ctrlId === 'en' ? 'endnote' : 'footnote'
          }
        }
        const texts = Array.isArray(info.texts) ? info.texts : []
        // a note without a number slot (its number typed as text by a document generator)
        // shows no number: all of its text is text (engine patch 0029 reports the slot)
        const numbered = info.numberSlot !== -1
        if (!numbered) prefix = 0
        notes.push({
          sec,
          para,
          control,
          offset,
          kind: kind === 'endnote' ? 'endnote' : 'footnote',
          number: info.number,
          prefix,
          numbered,
          lines: texts.map((line, index) => (index === 0 ? line.slice(prefix) : line)),
          plain: texts.reduce((sum, line) => sum + line.length, 0) === info.totalTextLen,
        })
      })
    }
  }
  return { notes, elsewhere: Math.max(0, controls.length - notes.length) }
}

const MAX_LISTED_EQUATIONS = 200
const EQUATION_CONTEXT_CHARS = 20

/**
 * The equations of the body text in reading order: where each one is (section, paragraph,
 * its control and its place in the text) and its script. `elsewhere` counts the ones in
 * table cells, notes and text boxes: the engine reads only the first of a cell paragraph
 * and removes none there, so they are left out.
 */
function equationsOf(doc) {
  const total = parse(doc.getControls()).filter((control) => control.ctrlId === 'eqed').length
  const equations = []
  if (total === 0) return { equations, elsewhere: 0 }
  const sections = doc.getSectionCount()
  for (let sec = 0; sec < sections; sec++) {
    const paragraphs = doc.getParagraphCount(sec)
    for (let para = 0; para < paragraphs && equations.length < total; para++) {
      const positions = parse(doc.getControlTextPositions(sec, para))
      positions.forEach((offset, control) => {
        let props
        try {
          props = parse(doc.getEquationProperties(sec, para, control, -1, -1))
        } catch {
          return // not an equation: a table, a picture, a section definition
        }
        equations.push({ sec, para, control, offset, script: String(props.script ?? '') })
      })
    }
  }
  return { equations, elsewhere: Math.max(0, total - equations.length) }
}

const MIN_EQUATION_LETTERS = 10
const lettersOf = (text) => text.replace(/[\s①-⓿❶-➓]/g, '')

// how the questions of a test paper are numbered; 1) and (1) number choices too
const QUESTION_STYLES = [
  { name: '문', start: /^\s*문\s*\d+/ },
  { name: '1.', start: /^\s*\d+\s*\.(?!\d)/ },
  { name: '1)', start: /^\s*\d+\s*\)(?!\d)/, choice: true },
  { name: '(1)', start: /^\s*\(\s*\d+\s*\)/, choice: true },
  { name: '가.', start: /^\s*[가나다라마바사아자차카타파하]\s*\./ },
  { name: '(가)', start: /^\s*\(\s*[가나다라마바사아자차카타파하]\s*\)/ },
]
const PART_START = /^\s*[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]+\s*\./
const CHOICE_START = /^\s*[①-⑳❶-❿➀-➉]/

/**
 * A line numbered in the style of a question above it in the same part is the next
 * question; 1) or (1) in another style right after a question, or after such a choice, is
 * a choice. Ⅰ. starts a part.
 */
function lineKindsOf(doc, sec) {
  const kinds = []
  let styles = []
  let last = null
  for (let para = 0; para < doc.getParagraphCount(sec); para++) {
    const text = bodyText(doc, sec, para)
    if (!text.trim()) {
      kinds.push(null)
      continue
    }
    const style = QUESTION_STYLES.find(({ start }) => start.test(text))
    const open = style ? styles.indexOf(style.name) : -1
    let kind = null
    if (PART_START.test(text)) {
      kind = 'part'
      styles = []
    } else if (CHOICE_START.test(text)) kind = 'choice'
    else if (style && open >= 0) {
      kind = 'question'
      styles = styles.slice(0, open + 1)
    } else if (style?.choice && (last === 'question' || last === 'numbered')) kind = 'numbered'
    else if (style) {
      kind = 'question'
      styles.push(style.name)
    }
    kinds.push(kind)
    last = kind
  }
  return kinds
}

/**
 * The words right in front of an equation and right after it, in its paragraph. Where
 * those are only a circled number or a few letters (a choice of a question), also
 * `previous`: the start of the nearest question line above it in its section
 * (lineKindsOf), unless its own paragraph is a question line. `kinds` caches lineKindsOf
 * per section.
 */
function equationContext(doc, equation, kinds) {
  const { sec, para, offset } = equation
  const length = doc.getParagraphLength(sec, para)
  const from = Math.max(0, offset - EQUATION_CONTEXT_CHARS)
  const to = Math.min(length, offset + EQUATION_CONTEXT_CHARS)
  const before = offset > from ? doc.getTextRange(sec, para, from, offset - from) : ''
  const after = to > offset ? doc.getTextRange(sec, para, offset, to - offset) : ''
  if (lettersOf(before + after).length >= MIN_EQUATION_LETTERS) return { before, after }
  if (!kinds.has(sec)) kinds.set(sec, lineKindsOf(doc, sec))
  const lines = kinds.get(sec)
  if (lines[para] === 'question') return { before, after }
  for (let k = para - 1; k >= 0 && lines[k] !== 'part'; k--) {
    if (lines[k] !== 'question') continue
    return { before, after, previous: clip(squash(bodyText(doc, sec, k)), EQUATION_CONTEXT_CHARS) }
  }
  return { before, after }
}

/** The text in front of a note's mark, cut to a few words. */
function noteContext(doc, note) {
  const start = Math.max(0, note.offset - NOTE_CONTEXT_CHARS)
  return note.offset > start
    ? doc.getTextRange(note.sec, note.para, start, note.offset - start)
    : ''
}

function checkNoteText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw fail('BAD_ARGUMENT', 'the note text must be a non-empty string')
  }
  const lines = text.split('\n')
  if (lines.length > MAX_NOTE_LINES) {
    throw fail('BAD_ARGUMENT', `a note takes at most ${MAX_NOTE_LINES} paragraphs`)
  }
  for (const line of lines) {
    if (CONTROL_CHARS.test(line))
      throw fail('BAD_ARGUMENT', 'the note text holds a control character')
  }
  return lines
}

/**
 * Write `lines` into a note whose first paragraph holds only its number (`prefix`
 * characters): the first line after the number, each further line as a paragraph of its own.
 */
function writeNote(doc, at, prefix, lines) {
  const { sec, para, control } = at
  let end = prefix
  lines.forEach((line, index) => {
    if (index > 0) {
      // the engine counts a split in the first paragraph one place further than an insert (the
      // number in front); past the end it splits at the end, so the extra place is safe
      const at = index - 1 === 0 ? end + 1 : end
      expectOk(doc.splitParagraphInFootnote(sec, para, control, index - 1, at), 'split the note')
      end = 0
    }
    if (line) {
      expectOk(doc.insertTextInFootnote(sec, para, control, index, end, line), 'write the note')
    }
    end += line.length
  })
}

const noteSummary = (note) => ({ kind: note.kind, number: note.number })

/** Most entries one table of contents takes. */
const MAX_TOC_ENTRIES = 100
const MAX_TOC_LEVEL = 3
/** Longest heading a table of contents shows. */
const MAX_TOC_TEXT = 120
/** How far a heading is indented, per level below the first. */
const TOC_INDENT_PT = 14
/** Width of the page-number column; the heading column takes the rest of the text width. */
const TOC_PAGE_COLUMN_PT = 45
/** The cells of a contents table: no lines, Hangul's usual cell margins. */
const TOC_CELL_STYLE = 'border:none;padding:1.41pt 5.1pt'
/** Room a heading cell keeps free: its margins, and a little for a font wider than guessed. */
const TOC_CELL_SLACK_PT = 24
/** How much of a heading is looked up when the page numbers are written again. */
const TOC_KEY_CHARS = 40
const PAGE_NUMBER = /^\s*(\d+)\s*$/

/** The text of a body paragraph. */
const bodyText = (doc, sec, k) => {
  const length = doc.getParagraphLength(sec, k)
  return length > 0 ? doc.getTextRange(sec, k, 0, length) : ''
}

/** The page number a reader sees for a body paragraph (the section may number its pages its own way). */
function pageNumberOf(doc, sec, para) {
  const at = parse(doc.getPageOfPosition(sec, para))
  if (!at.ok || !Number.isInteger(at.page))
    throw fail('ENGINE', 'could not find the page of a heading')
  const info = parse(doc.getPageInfo(at.page))
  return Number.isInteger(info.pageNumber) ? info.pageNumber : at.page + 1
}

/** The width of the text of a section's page, in points. */
function textWidthPt(doc, sec) {
  const page = parse(doc.getPageDef(sec))
  const width = (page.landscape ? page.height : page.width) - page.marginLeft - page.marginRight
  return Math.max(100, Math.round((width - (page.marginGutter ?? 0)) / 100))
}

/** The columns of a section's text: how many, and the gap between them in points. */
function columnsOf(doc, sec) {
  let def = null
  try {
    def = parse(doc.getColumnDef(sec))
  } catch {
    // an engine without the call: one column
  }
  const count = Number.isInteger(def?.columnCount) && def.columnCount > 1 ? def.columnCount : 1
  const gapPt = count > 1 && Number.isFinite(def.spacing) ? Math.max(0, def.spacing) / 100 : 0
  const line = count > 1 ? (COLUMN_LINE_TYPES[def.separatorType] ?? null) : null
  return { count, gapPt, line }
}

/**
 * The line setColumns left stored between the columns when none was asked for; in one
 * column it is not drawn, and it comes back with the columns.
 */
function keptLine(doc) {
  let def = null
  try {
    def = parse(doc.getColumnDef(0))
  } catch {
    // an engine without the call: no line
  }
  const line = COLUMN_LINE_TYPES[def?.separatorType] ?? null
  return line ? { line, lineKept: true } : {}
}

/** The lines set_columns draws between columns. */
const COLUMN_LINES = ['none', 'solid', 'dashed', 'dotted']

/** Every line a document may have between its columns, by the type the engine stores. */
const COLUMN_LINE_TYPES = [
  null,
  'solid',
  'dashed',
  'dotted',
  'dash-dot',
  'dash-dot-dot',
  'long-dash',
  'circles',
]

/**
 * Whether the number of columns changes within the document (Hangul's 다단 설정 나누기, as
 * a test-paper form has a head in one column over a body in two): a column definition in a
 * paragraph that does not start a section. The engine lists the objects of every section's
 * body as one run of paragraphs, so a section's start is where its definition stands.
 */
function columnsChangeWithin(doc) {
  try {
    const controls = parse(doc.getControls())
    const starts = new Set(
      controls
        .filter((control) => control.ctrlId === 'secd')
        .map((control) => `${control.list}/${control.para}`),
    )
    return controls.some(
      (control) => control.ctrlId === 'cold' && !starts.has(`${control.list}/${control.para}`),
    )
  } catch {
    return false
  }
}

/**
 * The columns the text runs in at body paragraph `para` of section `sec`: how many and how
 * wide one is, in points, and `lineWidthPt`, how wide the paragraph's first line may run
 * where it is laid out (always after a mid-section definition, given `line` in the columns
 * a section starts with); null where that cannot be read. A section starts in the columns
 * getColumnDef reads. No engine call reads a column definition set part way through it (as
 * a test-paper form sets two columns under a head in one), so after one the columns are
 * read from where the paragraph's lines are laid out (columnsWhereLaid).
 */
function columnsAt(doc, sec, para, { line = false } = {}) {
  let first = 0
  for (let s = 0; s < sec; s++) first += doc.getParagraphCount(s)
  let controls = []
  try {
    controls = parse(doc.getControls())
  } catch {
    // an engine without the call: the section's own columns
  }
  const starts = new Set(
    controls.filter((control) => control.ctrlId === 'secd').map((control) => control.para),
  )
  const laterDefinition = controls.some(
    (control) =>
      control.ctrlId === 'cold' &&
      control.list === 0 &&
      !starts.has(control.para) &&
      control.para > first &&
      control.para <= first + para,
  )
  if (laterDefinition) return columnsWhereLaid(doc, sec, para)
  const { count } = columnsOf(doc, sec)
  const laid = line && count > 1 ? columnsWhereLaid(doc, sec, para) : null
  return {
    count,
    widthPt: columnWidthPt(doc, sec),
    ...(laid?.lineWidthPt ? { lineWidthPt: laid.lineWidthPt } : {}),
  }
}

/**
 * The columns body paragraph `para` of section `sec` is laid out in, read from its page:
 * each part of a page that runs in other columns has columns of its own from where it
 * starts, so the paragraph's are those of the last part that starts above its first line,
 * and the one of them its first line stands in. A part narrower than the text area runs in
 * columns. Null where the paragraph has no layout.
 */
function columnsWhereLaid(doc, sec, para) {
  let caret
  let tree
  try {
    caret = parse(doc.getCursorRect(sec, para, 0))
    tree = parse(doc.getPageRenderTree(caret.pageIndex))
  } catch {
    return null
  }
  let body = null
  const columns = []
  const gather = (node, column) => {
    if (node.type === 'Table' || node.type === 'Header' || node.type === 'Footer') return
    if (node.type === 'Body' && node.bbox) body = node.bbox
    if (node.type === 'Column' && node.bbox) {
      column = { ...node.bbox, lines: [] }
      columns.push(column)
    }
    if (node.type === 'TextLine' && column && node.bbox) column.lines.push(node.bbox)
    for (const child of node.children ?? []) gather(child, column)
  }
  gather(tree, null)
  const above = columns.filter((column) => column.y <= caret.y + 1)
  if (!body || above.length === 0) return null
  const top = Math.max(...above.map((column) => column.y))
  const part = above.filter((column) => Math.abs(column.y - top) < 1)
  const here = part.find((column) => caret.x >= column.x - 1 && caret.x <= column.x + column.w + 1)
  if (!here) return null
  const line = here.lines.find(
    (box) => box.y <= caret.y + caret.height && box.y + Math.max(box.h, 1) >= caret.y,
  )
  const pt = (px) => (px * 72) / 96
  return {
    // a column with no line on the page has no box of its own
    count: here.w < body.w - 1 ? Math.max(2, part.length) : 1,
    widthPt: Math.floor(pt(Math.min(...part.map((column) => column.w)))),
    ...(line ? { lineWidthPt: Math.floor(pt(Math.min(line.w, here.x + here.w - line.x))) } : {}),
  }
}

/**
 * The width one column of a section takes in the engine's units, not rounded to points:
 * a tab stop at the right edge must not stand past it.
 */
function columnWidthUnits(doc, sec) {
  const page = parse(doc.getPageDef(sec))
  const text =
    (page.landscape ? page.height : page.width) -
    page.marginLeft -
    page.marginRight -
    (page.marginGutter ?? 0)
  const { count, gapPt } = columnsOf(doc, sec)
  return Math.max(4000, Math.floor((text - gapPt * 100 * (count - 1)) / count))
}

/** The width one column of a section takes, in points: the text width when it has one. */
function columnWidthPt(doc, sec) {
  const text = textWidthPt(doc, sec)
  const { count, gapPt } = columnsOf(doc, sec)
  return count > 1 ? Math.max(40, Math.floor((text - gapPt * (count - 1)) / count)) : text
}

/**
 * Take the table of the first paragraph out of the line of text and lay it across the
 * columns as the head of the page: it hangs from the top of the text area and pushes the
 * text of every column below it, as the head of a test paper sits over two columns. A table
 * left in the line would run over the text of the next column. It hangs from the page, not
 * from its paragraph: the engine lays a table that hangs from the first paragraph too low,
 * over the text, once that paragraph also holds a page number or a footer.
 */
function floatAcrossColumns(doc, sec, para, control) {
  expectOk(
    doc.setTableProperties(
      sec,
      para,
      control,
      JSON.stringify({
        treatAsChar: false,
        textWrap: 'TopAndBottom',
        vertRelTo: 'Page',
        horzRelTo: 'Page',
        vertAlign: 'Top',
        horzAlign: 'Left',
        vertOffset: 0,
        horzOffset: 0,
      }),
    ),
    'lay the table across the columns',
  )
}

/** The engine's units in one pixel of its layout (96 pixels and 7200 units to the inch). */
const UNITS_PER_PX = 75

/** How far a row may stand from what its text needs and still count as fitted to it. */
const FITTED_SLACK = Math.round(0.2 * HWPUNIT_PER_MM)

/**
 * Every table of the document's first paragraph that lies across two or more columns, in
 * order, with `key`: what its rows are drawn from as the document holds it (its cells, their
 * text and the looks of their paragraphs and characters, the page and the columns). Reads no
 * layout: a change that left the key as it was did not touch the table.
 */
function headTablesOf(doc) {
  if (doc.getSectionCount() === 0 || doc.getParagraphCount(0) === 0) return []
  if (columnsOf(doc, 0).count < 2) return []
  const page = `${doc.getPageDef(0)}${doc.getColumnDef(0)}`
  const heads = []
  const controls = parse(doc.getControlTextPositions(0, 0)).length
  for (let control = 0; control < controls; control++) {
    if (!placementOf(doc, 0, 0, control).across) continue
    try {
      heads.push({ control, key: `${page}${headKeyOf(doc, control)}` })
    } catch {
      // a table whose cells cannot be read is left as it is, and no change waits on it
    }
  }
  return heads
}

function headKeyOf(doc, control) {
  const dims = doc.getTableDimensions(0, 0, control)
  // the text and the looks of its characters, from the table's own HTML; the spacing of
  // its paragraphs and the cells' sizes are not in it
  const parts = [
    dims,
    doc.getTableProperties(0, 0, control),
    doc.exportControlHtml(0, 0, '[]', control),
  ]
  const cells = parse(dims).cellCount
  for (let cell = 0; cell < cells; cell++) {
    parts.push(doc.getCellProperties(0, 0, control, cell))
    const paragraphs = doc.getCellParagraphCount(0, 0, control, cell)
    for (let k = 0; k < paragraphs; k++)
      parts.push(doc.getCellParaPropertiesAt(0, 0, control, cell, k))
  }
  return parts.join('\n')
}

/**
 * A head table as it is laid out, read without changing it: each cell on its first page
 * with its row, the rows it spans, its stored height and the height its text needs (from
 * where its first line starts to where its last one ends, the space before its first
 * paragraph, and its padding; null where the caret cannot stand in it), and the drawn
 * height of each row (a row drawn only by merged cells has none). Null when the table has
 * no layout.
 */
function measureHead(doc, control) {
  let boxes
  try {
    boxes = parse(doc.getTableCellBboxes(0, 0, control))
  } catch {
    return null
  }
  if (!Array.isArray(boxes) || boxes.length === 0) return null
  const page = Math.min(...boxes.map((box) => box.pageIndex))
  const drawn = []
  const cells = boxes
    .filter((box) => box.pageIndex === page)
    .map((box) => {
      if (box.rowSpan === 1) {
        drawn[box.row] = Math.max(drawn[box.row] ?? 0, Math.round(box.h * UNITS_PER_PX))
      }
      const props = parse(doc.getCellProperties(0, 0, control, box.cellIdx))
      return {
        cell: box.cellIdx,
        row: box.row,
        rowSpan: box.rowSpan,
        stored: props.height,
        need: textNeedOf(doc, control, box.cellIdx, props, page),
      }
    })
  return { cells, drawn }
}

function textNeedOf(doc, control, cell, props, page) {
  const caret = (para, offset) =>
    parse(
      doc.getCursorRectByPathNear(
        0,
        0,
        JSON.stringify([{ controlIndex: control, cellIndex: cell, cellParaIndex: para }]),
        offset,
        page,
      ),
    )
  try {
    const last = doc.getCellParagraphCount(0, 0, control, cell) - 1
    const top = caret(0, 0)
    const end = caret(last, doc.getCellParagraphLength(0, 0, control, cell, last))
    if (top.pageIndex !== end.pageIndex) return null
    const lines = Math.round((end.y + end.height - top.y) * UNITS_PER_PX)
    // the space before its first paragraph lies above its lines and the engine grows the
    // row for it (not for the space after its last); paragraph spacing reads back in pixels
    // of twice the engine's units
    const before = Number(parse(doc.getCellParaPropertiesAt(0, 0, control, cell, 0)).spacingBefore)
    const space = Number.isFinite(before) ? Math.round((before * UNITS_PER_PX) / 2) : 0
    return lines + space + props.paddingTop + props.paddingBottom
  } catch {
    return null
  }
}

/**
 * Per row of a measured head: the highest stored height of its own cells (none for a row of
 * merged cells only) and what its text needs (null where a cell's need cannot be read). A
 * merged cell needs of each row it spans what its text needs over them, less what its other
 * rows store.
 */
function headRowsOf({ cells }) {
  const stored = []
  const need = []
  const add = (row, value) => {
    if (need[row] === null) return
    need[row] = value === null ? null : Math.max(need[row] ?? 0, value)
  }
  for (const cell of cells) {
    if (cell.rowSpan !== 1) continue
    stored[cell.row] = Math.max(stored[cell.row] ?? 0, cell.stored)
    add(cell.row, cell.need)
  }
  for (const cell of cells) {
    if (cell.rowSpan === 1) continue
    const rows = Array.from({ length: cell.rowSpan }, (_, k) => cell.row + k)
    const spanned = rows.reduce((sum, row) => sum + (stored[row] ?? 0), 0)
    for (const row of rows) {
      add(row, cell.need === null ? null : cell.need - (spanned - (stored[row] ?? 0)))
    }
  }
  return { stored, need }
}

const rowCountOf = ({ cells }) => Math.max(0, ...cells.map((cell) => cell.row + cell.rowSpan))

/**
 * Settle the head tables a change touched (their key moved from `before`, a Map by control
 * of the heads measured before it): a row the change made taller that stores less than it
 * draws gets its drawn height, as the engine starts the other columns below the stored row
 * heights, which text growing in a cell does not change; a table that was not a head before
 * is measured against its stored heights. No row is lowered. `taller` names the rows that
 * were fitted to their text and now store more than it needs: only row_height_mm lowers
 * them. Tables the change did not touch are not read.
 */
function settleHeads(doc, before) {
  const heads = new Map()
  const taller = []
  const raised = new Set()
  for (const { control, key } of headTablesOf(doc)) {
    const was = before.get(control)
    if (was?.key === key) {
      heads.set(control, was)
      continue
    }
    let now = measureHead(doc, control)
    if (!now) continue
    for (const cell of now.cells) {
      if (cell.rowSpan !== 1) continue
      const drawn = now.drawn[cell.row]
      if (was?.measured && !(drawn > (was.measured.drawn[cell.row] ?? 0) + UNITS_PER_PX)) continue
      if (cell.stored < drawn - UNITS_PER_PX) {
        expectOk(
          doc.setCellProperties(0, 0, control, cell.cell, JSON.stringify({ height: drawn })),
          'fit the head table',
        )
        raised.add(control)
      }
    }
    if (raised.has(control)) now = measureHead(doc, control)
    if (was?.measured && now && rowCountOf(was.measured) === rowCountOf(now)) {
      taller.push(...rowsLeftTaller(doc, control, was.measured, now))
    }
    if (now) heads.set(control, { key, measured: now })
  }
  if (raised.size > 0) {
    for (const head of headTablesOf(doc)) {
      if (raised.has(head.control) && heads.has(head.control))
        heads.get(head.control).key = head.key
    }
  }
  return { heads, taller }
}

/**
 * Give the `count` rows a change added to a head table from row `first` (0-based) the height
 * their own text needs, or that of the table's lowest other row where it is higher.
 */
function fitAddedRows(doc, control, measured, first, count) {
  const { stored, need } = headRowsOf(measured)
  const added = (row) => row >= first && row < first + count
  const own = Math.max(0, ...need.filter((height, row) => added(row) && height != null))
  const lowest = Math.min(...stored.filter((height, row) => !added(row) && height > 0))
  const height = Math.max(own, Number.isFinite(lowest) ? lowest : 0)
  if (height <= 0) return
  for (const cell of measured.cells) {
    if (cell.rowSpan !== 1 || !added(cell.row) || cell.stored === height) continue
    expectOk(
      doc.setCellProperties(0, 0, control, cell.cell, JSON.stringify({ height })),
      'fit the head table',
    )
  }
}

/** The rows of a head that were fitted to their text before a change and now store more. */
function rowsLeftTaller(doc, control, was, now) {
  const before = headRowsOf(was)
  const after = headRowsOf(now)
  const left = []
  after.stored.forEach((stored, row) => {
    const fitted = before.stored[row]
    const needed = before.need[row]
    const needs = after.need[row]
    if (stored === undefined || fitted === undefined || needed == null || needs == null) return
    if (Math.abs(fitted - needed) > FITTED_SLACK || !(stored > needs + FITTED_SLACK)) return
    const { table } = tableNumberOf(doc, 0, 0, control)
    if (table) left.push({ table, row: row + 1, heightMm: mmOf(stored), needsMm: mmOf(needs) })
  })
  return left
}

/**
 * The rows of a head, numbered from 1, that hold the cells `cells` (document cell numbers)
 * and draw taller than they store: their text runs past them, and the other columns start
 * over the head.
 */
function overflowingRowsOf(measured, cells) {
  const { stored } = headRowsOf(measured)
  const rows = new Set()
  for (const cell of measured.cells) {
    if (!cells.includes(cell.cell)) continue
    const row = cell.row + cell.rowSpan - 1
    if (measured.drawn[row] > (stored[row] ?? Infinity) + UNITS_PER_PX) rows.add(row + 1)
  }
  return [...rows].sort((a, b) => a - b)
}

function checkTocEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_TOC_ENTRIES) {
    throw fail('BAD_ARGUMENT', `entries must list 1 to ${MAX_TOC_ENTRIES} headings`)
  }
  for (const entry of entries) {
    if (!entry || typeof entry.find !== 'string' || entry.find.length === 0) {
      throw fail('BAD_ARGUMENT', 'each entry needs the text of its heading')
    }
    if (!Number.isInteger(entry.level) || entry.level < 1 || entry.level > MAX_TOC_LEVEL) {
      throw fail('BAD_ARGUMENT', `each entry needs a level from 1 to ${MAX_TOC_LEVEL}`)
    }
  }
}

/**
 * A table of contents as a table the engine pastes: a row per heading, the heading in the
 * first column (indented by level), its page number right-aligned in the second. No lines:
 * it reads as a list. Not lines with a right tab, as Hangul makes them: rhwp writes a new
 * tab without the width Hangul keeps in it, and Hangul then shows the tab as nothing.
 */
function tocHtml(rows, widthPt) {
  const textOf = ({ font }) =>
    [
      font.family ? `font-family:${font.family};mso-fareast-font-family:${font.family}` : '',
      `font-size:${font.points}pt`,
    ]
      .filter(Boolean)
      .join(';')
  const headingWidth = Math.max(50, widthPt - TOC_PAGE_COLUMN_PT)
  const cellStyle = TOC_CELL_STYLE
  const row = ({ text: heading, look, page }) =>
    '<tr>' +
    `<td style="${cellStyle};width:${headingWidth}pt">` +
    `<p style="margin-left:${look.indentPt}pt"><span style="${textOf(look)}">${escapeHtml(heading)}</span></p></td>` +
    `<td style="${cellStyle};width:${TOC_PAGE_COLUMN_PT}pt">` +
    `<p style="text-align:right"><span style="${textOf(look)}">${page}</span></p></td>` +
    '</tr>'
  return `<table>${rows.map(row).join('')}</table>`
}

/** Hangul's paragraph styles of a table of contents: its title, and a style for each level. */
const TOC_TITLE_STYLE = '차례 제목'
const tocLevelStyle = (level) => `차례 ${level}`

/**
 * How a table of contents looks. In the document's own 차례 styles when it has one for
 * every level used: each level in its style's font and indent, the title in 차례 제목.
 * Else in the body font (bodyFontOf), indented per level, the title in bold body text.
 * `levels` maps a level to its style id (null without), font and indent.
 */
function tocLookOf(doc, entries) {
  const used = [...new Set(entries.map((entry) => entry.level))]
  const ids = used.map((level) => styleIdOf(doc, tocLevelStyle(level)))
  const styled = ids.every((id) => id !== null)
  const charsOf = (id) => parse(doc.getStyleDetail(id))
  if (styled) {
    const levels = new Map(
      used.map((level, index) => {
        const { charProps, paraProps } = charsOf(ids[index])
        const font = fontOf(() => JSON.stringify(charProps))
        return [level, { style: ids[index], font, indentPt: ptOfPx(paraProps.marginLeft) }]
      }),
    )
    const titleId = styleIdOf(doc, TOC_TITLE_STYLE)
    if (titleId !== null) {
      const { charProps } = charsOf(titleId)
      const font = fontOf(() => JSON.stringify(charProps))
      return {
        levels,
        title: { style: titleId, font, bold: charProps.bold === true, color: charProps.textColor },
      }
    }
    return { levels, title: bodyTitleOf(doc, bodyFontOf(doc)) }
  }
  const font = bodyFontOf(doc)
  const levels = new Map(
    used.map((level) => [level, { style: null, font, indentPt: (level - 1) * TOC_INDENT_PT }]),
  )
  return { levels, title: bodyTitleOf(doc, font) }
}

/** The title of a table of contents in bold body text, in the body style. */
function bodyTitleOf(doc, font) {
  const style = styleIdOf(doc, BODY_STYLE) ?? 0
  return { style, font, bold: true, color: parse(doc.getStyleDetail(style)).charProps.textColor }
}

const TOC_TITLES = ['차례', '목차']
const TOC_TITLE_CHARS = 12

const isTocTitle = (text) => TOC_TITLES.includes(text.replace(/\s/g, ''))

function headingColumnOf(doc, table) {
  if (table.path.length !== 1 || table.cols !== 2) return null
  const grid = gridOf(doc, table)
  const rows = []
  for (let row = 0; row < table.rows; row++) {
    const cell = cellOf(grid, row, 0)
    if (!cell) return null
    rows.push(squash(paragraphsOf(cellBox(doc, table, cell.cell)).join(' ')))
  }
  return rows
}

/** Whether `table` is contents insertToc made; `made` holds the squashed heading rows each call wrote. */
function isMadeContents(doc, made, table) {
  const rows = headingColumnOf(doc, table)
  return (
    rows !== null &&
    made.some(
      (record) => record.length === rows.length && record.every((text, i) => text === rows[i]),
    )
  )
}

/**
 * The text of the paragraph right above `para`, or '' when that is empty or holds a table:
 * refresh_toc writes the table right after the line it is given, which past a table is not
 * this one.
 */
function lineAbove(doc, tables, sec, para) {
  if (para === 0 || tables.some((table) => table.sec === sec && table.para === para - 1)) return ''
  return bodyText(doc, sec, para - 1).trim()
}

/**
 * Contents the document has already: a table insertToc made since the document was opened
 * (its number and the line of text right above it), or Hangul's own contents under a 차례 or
 * 목차 line, whose first line with text ends in a tab and a page number.
 */
function contentsOf(doc, made) {
  if (made.length > 0) {
    const { tables } = tablesOf(doc)
    for (let i = 0; i < tables.length; i++) {
      if (!isMadeContents(doc, made, tables[i])) continue
      // the line as it reads now: a title retyped since is still the line refresh_toc takes
      const { sec, para } = tables[i]
      const title = lineAbove(doc, tables, sec, para)
      return {
        table: i + 1,
        ...(title ? { title } : {}),
        ...(sec === 0 && para === 0 ? { first: true } : {}),
      }
    }
  }
  const sections = doc.getSectionCount()
  for (let sec = 0; sec < sections; sec++) {
    const count = doc.getParagraphCount(sec)
    for (let para = 0; para < count; para++) {
      if (doc.getParagraphLength(sec, para) > TOC_TITLE_CHARS) continue
      const title = bodyText(doc, sec, para)
      if (!isTocTitle(title)) continue
      let next = para + 1
      while (next < count && !bodyText(doc, sec, next).trim()) next += 1
      if (next < count && /\t\s*\d+\s*$/.test(bodyText(doc, sec, next))) {
        return { lines: true, title: title.trim() }
      }
    }
  }
  return null
}

/** Width of a character in ems, roughly: full width for Hangul and CJK, about half for the rest. */
const emsOf = (ch) => (ch.codePointAt(0) > 0x2e7f ? 1 : 0.55)

/**
 * A heading cut to what fits on one line of the contents table. A row whose text wraps is
 * laid out taller by rhwp but drawn at its stored height by Hangul, the lines on top of one
 * another, and the two then also count different pages. Headings are short; a whole
 * paragraph taken for one is not, and is cut.
 */
function oneLine(text, look, widthPt) {
  const room = (widthPt - TOC_PAGE_COLUMN_PT - look.indentPt - TOC_CELL_SLACK_PT) / look.font.points
  let used = 0
  let out = ''
  for (const ch of text) {
    used += emsOf(ch)
    if (used > room - 1) return `${out.trimEnd()}…`
    out += ch
  }
  return out
}

/** The cell at a row and column of a table (zero-based), as gridOf lists it. */
const cellOf = (grid, row, col) => grid.find((cell) => cell.row === row && cell.col === col)

/** Replace the text of the first paragraph of a cell. */
function setCellText(doc, table, cell, value) {
  const box = cellBox(doc, table, cell)
  const length = box.length(0)
  if (length > 0) box.deleteText(0, length)
  box.insert(0, value)
}

// ---- tab widths ----

/** Page positions are in pixels of 75 HWPUNIT each. */
const HWPUNIT_PER_PX = 75
/** Tab stop positions and paragraph margins come from the engine at twice their HWPUNIT. */
const PARA_UNIT_SCALE = 2
/** A tab stop counts as passed when the tab starts this close to it, as the engine lays it out. */
const TAB_STOP_SLACK_PX = 0.5
/** Most tabs measured in one call. */
const MAX_MEASURED_TABS = 5000
/** Kinds of tab stop as the engine numbers them. */
const TAB_LEFT = 0
const TAB_RIGHT = 1

/**
 * The table at `ordinal` among the tables of a paragraph, as a path: in a body paragraph
 * (`outer` empty) its objects are listed, in a cell paragraph (`outer` its address) the
 * first few objects are tried, as tablesOf does.
 */
function tableAt(doc, sec, para, outer, ordinal) {
  const tried =
    outer.length === 0
      ? parse(doc.getControlTextPositions(sec, para)).length
      : NESTED_CONTROLS_TRIED
  let seen = 0
  for (let control = 0; control < tried; control++) {
    const path = [...outer, { controlIndex: control, cellIndex: 0, cellParaIndex: 0 }]
    let dims = null
    try {
      dims = parse(doc.getTableDimensionsByPath(sec, para, JSON.stringify(path)))
    } catch {
      // not a table
    }
    if (dims && seen++ === ordinal) return { control, cells: dims.cellCount }
  }
  return null
}

/** The paragraph a tab sits in, with the engine calls that read it; null when it is not there. */
function tabParagraph(doc, spot) {
  const { sec, para } = spot
  if (spot.cells.length === 0) {
    return {
      length: doc.getParagraphLength(sec, para),
      text: (length) => doc.getTextRange(sec, para, 0, length),
      rect: (offset) => parse(doc.getCursorRect(sec, para, offset)),
      props: () => parse(doc.getParaPropertiesAt(sec, para)),
    }
  }
  let outer = []
  for (const step of spot.cells) {
    const table = tableAt(doc, sec, para, outer, step.table)
    if (!table || step.cell >= table.cells) return null
    outer = [...outer, { controlIndex: table.control, cellIndex: step.cell, cellParaIndex: 0 }]
    const count = doc.getCellParagraphCountByPath(sec, para, JSON.stringify(outer))
    if (step.para >= count) return null
    outer[outer.length - 1].cellParaIndex = step.para
  }
  const json = JSON.stringify(outer)
  const last = outer[outer.length - 1]
  return {
    length: doc.getCellParagraphLengthByPath(sec, para, json),
    text: (length) => doc.getTextInCellByPath(sec, para, json, 0, length),
    rect: (offset) => parse(doc.getCursorRectByPath(sec, para, json, offset)),
    // the engine reads a cell paragraph's formatting by table and cell number only
    props: () =>
      outer.length === 1
        ? parse(
            doc.getCellParaPropertiesAt(
              sec,
              para,
              last.controlIndex,
              last.cellIndex,
              last.cellParaIndex,
            ),
          )
        : null,
  }
}

/**
 * The kind and leader of the tab stop a tab goes to: the first stop past where the tab
 * starts, as the engine looks it up; past the last stop, the right edge when the paragraph
 * says so, and otherwise the plain left tab every so often. Tab stops are measured from
 * where the paragraph's margin starts: the start of the first line less its indent.
 */
function tabStopOf(props, firstX, startX) {
  if (!props) return { type: TAB_LEFT, fill: 0 }
  const toPx = (value) => (Number(value) || 0) / PARA_UNIT_SCALE / HWPUNIT_PER_PX
  const indent = toPx(props.indent)
  const origin = firstX - toPx(props.marginLeft) - Math.max(indent, 0)
  const at = startX - origin
  for (const stop of props.tabStops ?? []) {
    if (toPx(stop.position) > at + TAB_STOP_SLACK_PX) {
      return { type: Number(stop.type) || 0, fill: Number(stop.fill) || 0 }
    }
  }
  return props.tabAutoRight ? { type: TAB_RIGHT, fill: 0 } : { type: TAB_LEFT, fill: 0 }
}

/**
 * How wide the editor lays a tab out, in HWPUNIT, and the kind and leader of its stop; null
 * when the tab is not where the file says (another paragraph, another number of tabs), or
 * cannot be measured (it ends a line, its caret positions are not on one line).
 */
function measureTab(doc, spot) {
  const paragraph = tabParagraph(doc, spot)
  if (!paragraph || paragraph.length <= 0) return null
  const text = paragraph.text(paragraph.length)
  const offsets = []
  for (let i = text.indexOf('\t'); i >= 0; i = text.indexOf('\t', i + 1)) offsets.push(i)
  if (offsets.length !== spot.tabs || spot.tab >= offsets.length) return null
  const offset = offsets[spot.tab]
  const before = paragraph.rect(offset)
  const after = paragraph.rect(offset + 1)
  if (before.pageIndex !== after.pageIndex || Math.abs(before.y - after.y) > 1) return null
  const width = Math.round((after.x - before.x) * HWPUNIT_PER_PX)
  if (!(width > 0)) return null
  const first = paragraph.rect(0)
  const { type, fill } = tabStopOf(paragraph.props(), first.x, before.x)
  return { width, type, fill }
}

// ---- marks of changes ----

/** The run of a mark within a paragraph of `length` characters: its own, or the whole paragraph. */
function spanOf(mark, length) {
  const offset = Math.min(Math.max(0, Number.isInteger(mark.offset) ? mark.offset : 0), length)
  const want = Number.isInteger(mark.length) ? mark.length : 0
  return want > 0 ? [offset, Math.min(length, offset + want)] : [0, length]
}

/**
 * Where a marked place is on the pages: rectangles in page pixels with their page. A place
 * without text of its own (a table on a line of its own) is the tables of its paragraph.
 * Nothing for a place that is no longer there.
 */
function markRects(doc, mark) {
  const { sec, para } = mark
  if (sec >= doc.getSectionCount()) return []
  const path = Array.isArray(mark.path) && mark.path.length > 0 ? mark.path : null
  if (!path) {
    if (para >= doc.getParagraphCount(sec)) return []
    const [start, end] = spanOf(mark, doc.getParagraphLength(sec, para))
    const rects = end > start ? parse(doc.getSelectionRects(sec, para, start, para, end)) : []
    if (rects.length > 0) return rects
    const tables = []
    const controls = parse(doc.getControlTextPositions(sec, para)).length
    for (let control = 0; control < controls; control++) {
      try {
        tables.push(parse(doc.getTableBBox(sec, para, control)))
      } catch {
        // not a table
      }
    }
    return tables
  }
  const json = JSON.stringify(path)
  const cellPara = path[path.length - 1].cellParaIndex
  const [start, end] = spanOf(mark, doc.getCellParagraphLengthByPath(sec, para, json))
  return end > start
    ? parse(doc.getSelectionRectsInCellByPath(sec, para, json, cellPara, start, cellPara, end))
    : []
}

/** Body paragraphs per section. */
function paragraphCounts(doc) {
  const counts = []
  const sections = doc.getSectionCount()
  for (let sec = 0; sec < sections; sec++) counts.push(doc.getParagraphCount(sec))
  return counts
}

/**
 * The marks of earlier changes, moved for a change that added or removed body paragraphs:
 * `at` is where it did (the first paragraph it made, or the one it removed). Marks inside
 * table cells keep their place: a change in a cell does not move the body.
 */
function shiftMarks(marks, before, after, at) {
  return marks.flatMap((mark) => {
    const delta = (after[mark.sec] ?? 0) - (before[mark.sec] ?? 0)
    if (delta === 0 || !at || at.sec !== mark.sec) return [mark]
    if (delta > 0) return [mark.para >= at.para ? { ...mark, para: mark.para + delta } : mark]
    if (mark.para < at.para) return [mark]
    if (mark.para < at.para - delta) return []
    return [{ ...mark, para: mark.para + delta }]
  })
}

/** What the studio tells a 'document-mutated' for that is no edit: a deferred layout finished. */
const LAYOUT_ONLY_MUTATIONS = new Set(['input-handler-resumable-pagination'])

/**
 * Calls `fn` once for every edit of the document, whoever made it; answers the function that
 * stops it. Everything in this plugin that follows the document listens here, not to one event:
 * the studio tells of an edit as 'document-changed', but typing that redraws only its page
 * (input-handler.ts afterPageLocalEdit) fires 'document-mutated' and 'document-page-invalidated'
 * alone, and in a document of more than 30 pages no layout follows that would say it changed.
 * Most edits fire both, the mutation first, in the same task: the 'document-changed' right after
 * a mutation that was told is that same edit. The mutation a finished deferred layout fires is
 * no edit (its 'document-changed' is told as before). `fn` runs while the event is told, so what
 * it reads of the plugin's state (its own change running) is as it was then.
 */
function onDocumentEdit(host, fn) {
  let told = false
  const offMutated = host.events.on('document-mutated', (reason) => {
    if (LAYOUT_ONLY_MUTATIONS.has(reason)) return
    told = true
    queueMicrotask(() => {
      told = false
    })
    fn()
  })
  const offChanged = host.events.on('document-changed', () => {
    if (told) {
      told = false
      return
    }
    fn()
  })
  return () => {
    for (const off of [offMutated, offChanged]) {
      try {
        if (typeof off === 'function') off()
      } catch {
        // the host already took it off
      }
    }
  }
}

/** Takes the plugin's double-click listener off the page again. */
let stopListening = null
/** A drag begun with a double click, kept on whole words (wordDrag); null when there is none. */
let wordDragState = null
/** Takes the marks off the page again, with what keeps them in place. */
let stopMarking = null
/** Takes the memo anchors off the page again, with what keeps them in place. */
let stopMemoLayer = null
/** Takes the input lock of an open memo modal off the editor again. */
let stopMemoLock = null
/** Takes the copy/paste listeners that advise about memos off the editor again. */
let stopMemoClipboard = null
/** Closes the channel a copy of memo-bearing text is told on. */
let stopMemoChannel = null
/** Stops the status bar's character count (showCharCount). */
let stopCharCount = null
/** A redraw of the memo anchors after a change settles, and the probe for pasted memos. */
let memoSettleTimer = null
let memoProbeTimer = null

/**
 * Run `fn` with the text widths every PC lays out the same (the editor's print and export
 * do so): with the widths measured on this screen on, pages could break differently. They
 * are put back afterwards.
 */
function withPortableWidths(doc, fn) {
  const measured = doc.canvasMetricsActive?.() ?? false
  if (measured) doc.selectCanvasMetrics(false)
  try {
    return fn()
  } finally {
    if (measured) doc.selectCanvasMetrics(true)
  }
}

/**
 * Run `fn` to lay out and draw the pages for print. Where the screen can answer for the
 * fonts it draws with (`screen`, print-fonts.mjs) and the engine lets an export keep the
 * widths the screen measured (vendor/rhwp-core patch 0050), the pages keep the screen's
 * layout: the same lines and the same page breaks as the page the user edits, drawn in the
 * fonts those widths were measured on. Otherwise they are laid out with the widths every
 * PC lays out the same, as the editor's own print does.
 */
function withPrintWidths(doc, screen, fn) {
  const measured = doc.canvasMetricsActive?.() ?? false
  if (!measured || !screen || typeof doc.setExportKeepsCanvasMetrics !== 'function') {
    return withPortableWidths(doc, fn)
  }
  doc.setExportKeepsCanvasMetrics(true)
  try {
    return fn()
  } finally {
    doc.setExportKeepsCanvasMetrics(false)
  }
}

export const agentPlugin = {
  id: AGENT_PLUGIN_ID,
  apiVersion: 1,

  deactivate() {
    if (stopListening) stopListening()
    stopListening = null
    if (stopMarking) stopMarking()
    stopMarking = null
    if (stopMemoLayer) stopMemoLayer()
    stopMemoLayer = null
    if (stopMemoLock) stopMemoLock()
    stopMemoLock = null
    if (stopMemoClipboard) stopMemoClipboard()
    stopMemoClipboard = null
    if (stopMemoChannel) stopMemoChannel()
    stopMemoChannel = null
    if (stopCharCount) stopCharCount()
    stopCharCount = null
    if (memoSettleTimer) clearTimeout(memoSettleTimer)
    memoSettleTimer = null
    if (memoProbeTimer) clearTimeout(memoProbeTimer)
    memoProbeTimer = null
  },

  activate(host) {
    // The app's dialog skin (studio-plugin/dialog-theme.mjs). It is installed
    // when the plugin comes up, not when the AI panel opens: a settings dialog
    // can be opened on a document the panel never touched.
    installDialogTheme()

    // the unsaved state as the editor sets it, in the same task as the edit: the app's close
    // prompt reads its copy of this, and a key typed just before closing must be in it
    host.events.on('document-dirty-changed', (change) => {
      globalThis.dispatchEvent?.(new CustomEvent(DIRTY_EVENT, { detail: change?.dirty === true }))
    })

    // counts the changes this plugin did not make (the user typing, the editor's own undo):
    // the panel takes back a run only while this has not moved since the run ended, because
    // the editor's history is one stack and anything on top of the run would be undone first
    let foreign = 0
    let own = false
    // counts every edit, whoever made it, and every document swapped in: the print preview
    // keeps the pages it gathered while this has not moved
    let revision = 0
    // the contents insertToc made in this document: the heading rows each wrote, squashed.
    // The document keeps no mark of them, so another document opened here starts with none.
    let contentsMade = []
    // the head tables across the columns as the last change left them, by control, each with
    // the key of what they were drawn from (headTablesOf), and the revision they are of
    let headsKnown = new Map()
    let headsRevision = -1
    host.events.on('document-swapped', () => {
      revision += 1
      contentsMade = []
    })
    // the text is read for every request; it only changes when the document does
    let text = null
    // the pictures of the document, in reading order, as the last listPictures read them
    let pictures = null
    // the places this plugin changed since the panel last cleared them, as they are now
    let marks = []
    // the memo panel: the memos as last read, whether its anchors are shown, which one is
    // picked, and how many memos the last copy in this editor would bring with it
    let memoKnown = null
    let memoShown = false
    let memoSelected = null
    let memoLayer = null
    let memoCopied = 0
    let memoLocked = false
    // a copy of memo-bearing text made in this instance, and one told on the channel by
    // another instance: a paste that brings neither still needs the app's notice
    const memoInstance = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    let memoChannel = null
    let memoCrossCopy = null

    /** Read the memo list again; with `notify`, tell the app about memos the user's edit took. */
    const syncMemos = ({ notify = false } = {}) => {
      let entries
      try {
        entries = host.read(memoEntriesOf)
      } catch {
        return null
      }
      // no document yet (or a host that cannot read one): nothing to compare
      if (!Array.isArray(entries)) return null
      const before = memoKnown
      memoKnown = entries.map(memoSummaryOf)
      if (notify && before && before.length > 0) {
        const left = new Set(entries.map((entry) => entry.id))
        const gone = before.filter((memo) => !left.has(memo.id))
        if (gone.length > 0) {
          announce(MEMO_REMOVED_EVENT, {
            kind: 'memo-removed',
            count: gone.length,
            memos: gone,
          })
        }
      }
      return entries
    }

    /** Draw the memo anchors again now, and once more after the editor re-lays the pages. */
    const refreshMemoAnchors = () => {
      try {
        host.automation.execute(MEMO_MARK_COMMAND)
      } catch {
        // an editor without commands: the panel still lists the memos
      }
      if (memoSettleTimer) clearTimeout(memoSettleTimer)
      memoSettleTimer = setTimeout(() => {
        memoSettleTimer = null
        try {
          host.automation.execute(MEMO_MARK_COMMAND)
        } catch {
          // as above
        }
      }, MARK_SETTLE_MS)
    }

    /** Put the memo anchors where the editor lays their places out, as it draws its selection. */
    const drawMemoAnchors = (services) => {
      const page = globalThis.document
      const content = page ? page.querySelector('#scroll-content') : null
      if (!content) return
      if (!memoShown) {
        if (stopMemoLayer) stopMemoLayer()
        stopMemoLayer = null
        return
      }
      if (!memoLayer || memoLayer.parentElement !== content) {
        if (stopMemoLayer) stopMemoLayer()
        memoLayer = page.createElement('div')
        memoLayer.className = 'ieum-memo-anchors'
        memoLayer.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:${MEMO_LAYER_Z};`
        content.appendChild(memoLayer)
        // the content is resized when the zoom changes: the anchors are placed again
        const Observer = globalThis.ResizeObserver
        const observer = Observer ? new Observer(() => refreshMemoAnchors()) : null
        if (observer) observer.observe(content)
        // the pages are re-laid out after a change; a scroll only asks for a fresh look
        const scrolling = page.querySelector('#scroll-container')
        let scrollTimer = null
        const onScroll = () => {
          if (scrollTimer) return
          scrollTimer = setTimeout(() => {
            scrollTimer = null
            refreshMemoAnchors()
          }, 100)
        }
        if (scrolling) scrolling.addEventListener('scroll', onScroll, { passive: true })
        const own = memoLayer
        stopMemoLayer = () => {
          if (observer) observer.disconnect()
          if (scrolling) scrolling.removeEventListener('scroll', onScroll)
          if (scrollTimer) clearTimeout(scrollTimer)
          own.remove()
          if (memoLayer === own) memoLayer = null
        }
      }
      memoLayer.replaceChildren()
      const input = services && services.getInputHandler ? services.getInputHandler() : null
      const scroll = input ? input.virtualScroll : null
      const viewport =
        services && services.getViewportManager ? services.getViewportManager() : null
      if (!scroll || !viewport) return
      let memos
      try {
        memos = host.read(memoListOf)
      } catch {
        return
      }
      const zoom = viewport.getZoom()
      const width = content.clientWidth
      for (const memo of memos) {
        const selected = memoSelected !== null && memo.id === memoSelected
        for (const rect of memo.rects) {
          const box = page.createElement('div')
          const caret = rect.width === 0
          const left = scroll.getPageLeftResolved(rect.pageIndex, width) + rect.x * zoom
          const top = scroll.getPageOffset(rect.pageIndex) + rect.y * zoom
          // one property at a time: a style string is dropped whole where one part is not understood
          Object.assign(box.style, {
            position: 'absolute',
            left: `${left.toFixed(2)}px`,
            top: `${top.toFixed(2)}px`,
            width: `${Math.max(caret ? MEMO_CARET_WIDTH : rect.width * zoom, 1).toFixed(2)}px`,
            height: `${Math.max(rect.height * zoom, 2).toFixed(2)}px`,
            background: selected ? MEMO_SELECTED_FILL : MEMO_FILL,
            boxShadow: `inset 0 -${selected ? 2 : 1}px 0 ${selected ? MEMO_SELECTED_LINE : MEMO_LINE}`,
            borderRadius: '2px',
          })
          box.className = `ieum-memo-anchor${selected ? ' selected' : ''}${caret ? ' caret' : ''}`
          memoLayer.appendChild(box)
        }
      }
    }

    /** A change the user made: memos may have gone, and their anchors moved. */
    const memosAfterUserEdit = () => {
      if (memoKnown && memoKnown.length > 0) {
        syncMemos({ notify: true })
      } else if (!memoProbeTimer) {
        // nothing was known to watch: look again after the typing stops, for memos pasted in
        memoProbeTimer = setTimeout(() => {
          memoProbeTimer = null
          syncMemos({ notify: false })
          refreshMemoAnchors()
        }, MEMO_PROBE_MS)
      }
      refreshMemoAnchors()
    }

    /** The list command's answer: a command returns nothing itself. */
    let listedMemos = null
    /** The selection command's answer for the memo panel. */
    let memoAnchorAnswer = null

    /** Whether the current selection (or caret) may carry a memo anchor, and what is there. */
    const memoAnchorSelection = (services) => {
      const input = services && services.getInputHandler ? services.getInputHandler() : null
      const cursor = input ? input.cursor : null
      if (!cursor) return { ok: false, reason: 'none' }
      try {
        if (cursor.isInHeaderFooter?.() || cursor.isInFootnote?.()) {
          return { ok: false, reason: 'unsupported_place' }
        }
        if (cursor.isInPictureObjectSelection?.() || cursor.isInTableObjectSelection?.()) {
          return { ok: false, reason: 'unsupported_place' }
        }
        if (cursor.isInCellSelectionMode?.()) return { ok: false, reason: 'unsupported_place' }
      } catch {
        return { ok: false, reason: 'unsupported_place' }
      }
      let seen
      try {
        seen = cursorSelection(services)
      } catch {
        return { ok: false, reason: 'unsupported_place' }
      }
      const first = seen ? seen.start : cursor.getPosition ? cursor.getPosition() : null
      const last = seen ? seen.end : first
      const start = endOf(first)
      const end = endOf(last)
      if (!start || !end) return { ok: false, reason: 'unsupported_place' }
      if (start.sec !== end.sec) return { ok: false, reason: 'multi_paragraph' }
      if (start.path || end.path) {
        if (!start.path || !end.path || !sameTable(start, end, true) || start.k !== end.k) {
          return { ok: false, reason: 'multi_paragraph' }
        }
      } else if (start.para !== end.para) {
        return { ok: false, reason: 'multi_paragraph' }
      }
      return host.read((doc) => {
        try {
          if (memoProtected(doc)) {
            return { ok: false, reason: 'protected' }
          }
          const place = start.path ? (start.textBox ? 'textBox' : 'tableCell') : 'body'
          const box = containerOf(doc, { sec: start.sec, para: start.para, cellPath: start.path })
          const length = box.length(start.k)
          const from = Math.max(0, Math.min(start.offset, length))
          const to = Math.max(from, Math.min(end.offset, length))
          const path = start.path ?? null
          const key = `${start.sec}:${start.para}:${memoPathKey(path)}`
          if (memoOverlaps(memoEntriesOf(doc), key, from, to)) {
            return { ok: false, reason: 'overlap' }
          }
          const text = box.text(start.k, length)
          // the offsets are the engine's characters, not a JavaScript string's units
          const shown =
            from < to
              ? engineSlice(text, from, to)
              : engineSlice(
                  text,
                  Math.max(0, from - MEMO_CARET_CHARS),
                  Math.min(length, from + MEMO_CARET_CHARS),
                )
          const anchor = {
            place,
            sectionIndex: start.sec,
            paraIndex: start.para,
            startCharIdx: from,
            endCharIdx: to,
            path,
          }
          return {
            ok: true,
            ...anchor,
            preview: clip(shown.replace(/\s+/g, ' ').trim(), MEMO_PREVIEW_CHARS),
            anchor,
          }
        } catch {
          return { ok: false, reason: 'unsupported_place' }
        }
      })
    }

    /** The engine's refusal of a memo call as the panel's answer. */
    const memoRefusal = (thrown) => {
      const error = memoErrorOf(thrown)
      if (!error) throw thrown
      return { ok: false, reason: error.code }
    }

    /** The paragraph of a memo box a checked anchor's offsets count from. */
    const checkedK = (anchor) =>
      anchor.path ? anchor.path[anchor.path.length - 1].cellParaIndex : anchor.paraIndex

    /** The memo insert/edit/remove calls the panel makes; each is one undo step. */
    const memoCommand = (label, options, run) => {
      try {
        return change(label, run, options)
      } catch (thrown) {
        return memoRefusal(thrown)
      }
    }

    /** Block the editor's input while a memo modal is open in the app. */
    const setMemoLock = (locked) => {
      memoLocked = locked === true
      if (memoLocked) {
        const target = globalThis.document
        if (target && !stopMemoLock) {
          const block = (event) => {
            if (!memoLocked) return
            event.preventDefault()
            event.stopPropagation()
            event.stopImmediatePropagation?.()
          }
          const names = ['keydown', 'beforeinput', 'paste', 'drop', 'pointerdown']
          for (const name of names) target.addEventListener(name, block, true)
          stopMemoLock = () => {
            for (const name of names) target.removeEventListener(name, block, true)
          }
        }
      } else if (stopMemoLock) {
        stopMemoLock()
        stopMemoLock = null
      }
      return { ok: true, locked: memoLocked }
    }

    /** Tell the other editor instances that this one copied memo-bearing text. */
    const startMemoChannel = () => {
      if (stopMemoChannel) stopMemoChannel()
      const Channel = globalThis.BroadcastChannel
      if (!Channel) return
      try {
        const channel = new Channel(MEMO_COPY_CHANNEL)
        channel.onmessage = (event) => {
          const detail = event?.data
          if (!detail || detail.kind !== 'memo-copied') return
          if (detail.source === memoInstance) return
          if (!Number.isInteger(detail.count) || detail.count < 1) return
          if (typeof detail.at !== 'number' || !Number.isFinite(detail.at)) return
          if (Date.now() - detail.at > MEMO_COPY_WINDOW_MS) return
          if (!memoCrossCopy || detail.at >= memoCrossCopy.at) {
            memoCrossCopy = { count: detail.count, at: detail.at, source: detail.source }
          }
        }
        memoChannel = channel
        stopMemoChannel = () => {
          try {
            channel.close()
          } catch {
            // already closed
          }
          if (memoChannel === channel) memoChannel = null
        }
      } catch {
        // an editor window without BroadcastChannel: the same-editor path still works
      }
    }

    /** Remember how many memos a copy in this editor would bring, for the paste that follows. */
    const noteMemoCopy = () => {
      try {
        picked = null
        host.automation.execute(SELECTION_COMMAND)
        const seen = picked
        if (!seen) {
          memoCopied = 0
          memoCrossCopy = null
          return
        }
        const start = endOf(seen.start)
        const end = endOf(seen.end)
        memoCopied = start && end ? host.read((doc) => memosWithin(doc, start, end)) : 0
        if (memoCopied === 0) {
          // a local copy without memos is not the cross-instance one the channel told about
          memoCrossCopy = null
          return
        }
        if (memoChannel) {
          try {
            memoChannel.postMessage({
              kind: 'memo-copied',
              count: memoCopied,
              at: Date.now(),
              source: memoInstance,
            })
          } catch {
            // the channel is closed: the other instance cannot be told
          }
        }
      } catch {
        memoCopied = 0
      }
    }

    /**
     * A paste that did not bring the memos copied with the text is told to the app once.
     * The copy may have been made in this editor (the engine then duplicates the memos, or
     * drops an anchor-only one) or in another instance, which only told this one on the
     * channel that memo-bearing text was copied: a system-clipboard paste carries text only.
     */
    const noteMemoPaste = () => {
      const local = memoCopied
      memoCopied = 0
      const cross =
        local < 1 && memoCrossCopy && Date.now() - memoCrossCopy.at <= MEMO_COPY_WINDOW_MS
          ? memoCrossCopy
          : null
      memoCrossCopy = null
      const count = local > 0 ? local : cross ? cross.count : 0
      if (count < 1) return
      let before = 0
      try {
        before = host.read((doc) => memoEntriesOf(doc).length)
      } catch {
        return
      }
      setTimeout(() => {
        try {
          const after = host.read((doc) => memoEntriesOf(doc).length)
          // fewer memos came than were copied: the rest were lost to the text-only paste
          if (after - before < count) {
            announce(MEMO_NOT_COPIED_EVENT, { kind: 'memo-not-copied', count })
          }
          syncMemos({ notify: false })
          refreshMemoAnchors()
        } catch {
          // the editor is gone: nothing to tell
        }
      }, 0)
    }

    {
      const page = globalThis.document
      if (page) {
        if (stopMemoClipboard) stopMemoClipboard()
        const onCopy = () => noteMemoCopy()
        for (const name of ['copy', 'cut']) page.addEventListener(name, onCopy, true)
        page.addEventListener('paste', noteMemoPaste, true)
        stopMemoClipboard = () => {
          for (const name of ['copy', 'cut']) page.removeEventListener(name, onCopy, true)
          page.removeEventListener('paste', noteMemoPaste, true)
        }
        startMemoChannel()
      }
    }

    onDocumentEdit(host, () => {
      revision += 1
      text = null
      pictures = null
      if (!own) {
        foreign += 1
        // an edit of the user's own moves text under the marks: they would point astray
        if (marks.length > 0) {
          marks = []
          refreshMarks()
        }
        // the user's own edit can take a memo away and moves the memo anchors
        memosAfterUserEdit()
      }
    })

    // the toolbar's style list is filled once, when the document opens. Styles made, renamed
    // or removed since (the style dialog, this plugin, an undo) are put in after a pause, so
    // typing does not pay for it: a stale list names the old styles at the old numbers, and
    // after a removal picking one there applied another style
    let styleListTimer = null
    const scheduleStyleList = () => {
      if (styleListTimer) clearTimeout(styleListTimer)
      styleListTimer = setTimeout(() => {
        styleListTimer = null
        const select = globalThis.document?.querySelector(STYLE_LIST_SELECTOR)
        if (!select) return
        try {
          if (
            syncStyleList(
              select,
              host.read((doc) => parse(doc.getStyleList())),
            )
          ) {
            // the number shown may be a style that moved: the caret's style, as the editor
            // reads it, is what the list is to show
            host.automation.execute(CARET_STATE_COMMAND)
          }
        } catch {
          // no document, or the editor is gone: the list stays as it is
        }
      }, STYLE_LIST_PAUSE_MS)
    }
    onDocumentEdit(host, scheduleStyleList)

    let layer = null
    let settle = null
    /** Draw the marks again (a command, for the editor's own services); later once more. */
    const refreshMarks = () => {
      try {
        host.automation.execute(MARK_COMMAND)
      } catch {
        // an editor without commands: no marks
      }
      if (settle) clearTimeout(settle)
      settle = setTimeout(() => {
        settle = null
        try {
          host.automation.execute(MARK_COMMAND)
        } catch {
          // as above
        }
      }, MARK_SETTLE_MS)
    }

    /** Draws the marks where the editor lays their places out, as it draws its selection. */
    const drawMarks = (services) => {
      const page = globalThis.document
      const content = page ? page.querySelector('#scroll-content') : null
      if (!content) return
      if (!layer || layer.parentElement !== content) {
        if (stopMarking) stopMarking()
        layer = page.createElement('div')
        layer.className = 'ieum-change-marks'
        layer.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:${MARK_LAYER_Z};`
        content.appendChild(layer)
        // the content is resized when the zoom changes: the marks are placed again
        const Observer = globalThis.ResizeObserver
        const observer = Observer ? new Observer(() => refreshMarks()) : null
        if (observer) observer.observe(content)
        const own = layer
        stopMarking = () => {
          if (observer) observer.disconnect()
          own.remove()
          if (layer === own) layer = null
        }
      }
      layer.replaceChildren()
      if (marks.length === 0) return
      const input = services && services.getInputHandler ? services.getInputHandler() : null
      const scroll = input ? input.virtualScroll : null
      const viewport =
        services && services.getViewportManager ? services.getViewportManager() : null
      if (!scroll || !viewport) return
      const zoom = viewport.getZoom()
      const width = content.clientWidth
      const rects = host.read((doc) =>
        marks.flatMap((mark) => {
          try {
            return markRects(doc, mark)
          } catch {
            return []
          }
        }),
      )
      for (const rect of rects) {
        const box = page.createElement('div')
        const left = scroll.getPageLeftResolved(rect.pageIndex, width) + rect.x * zoom
        const top = scroll.getPageOffset(rect.pageIndex) + rect.y * zoom
        // one property at a time: a style string is dropped whole where one part is not understood
        Object.assign(box.style, {
          position: 'absolute',
          left: `${left.toFixed(2)}px`,
          top: `${top.toFixed(2)}px`,
          width: `${(rect.width * zoom).toFixed(2)}px`,
          height: `${(rect.height * zoom).toFixed(2)}px`,
          background: MARK_FILL,
          boxShadow: `inset 0 -2px 0 ${MARK_LINE}`,
          borderRadius: '2px',
        })
        layer.appendChild(box)
      }
    }

    try {
      host.automation.registerCommand({
        id: MARK_COMMAND,
        label: 'Mark the changes',
        execute: (services) => {
          try {
            drawMarks(services)
          } catch {
            // marks are a help; a page that cannot take them stays as it is
          }
        },
      })
    } catch {
      // registered by an earlier activation of this plugin, or a host without commands
    }

    try {
      host.automation.registerCommand({
        id: CARET_STATE_COMMAND,
        label: 'Show the caret state',
        execute: (services) => {
          try {
            services.getInputHandler()?.emitCursorFormatState()
          } catch {
            // without a caret the toolbar keeps what it shows
          }
        },
      })
    } catch {
      // registered by an earlier activation of this plugin, or a host without commands
    }

    /** What a change leaves to mark, and the earlier marks moved for it. */
    const noteChange = (label, result, before, after) => {
      if (!result || result.ok === false) return
      const places = Array.isArray(result.marks) ? result.marks : result.place ? [result.place] : []
      marks = shiftMarks(marks, before, after, result.shiftAt ?? places[0] ?? result.place ?? null)
      if (!UNMARKED_CHANGES.has(label)) marks = [...marks, ...places].slice(0, MAX_MARKS)
      // the memos may have changed with the text, and their anchors may have moved
      syncMemos({ notify: false })
      refreshMemoAnchors()
      refreshMarks()
    }

    // the answer of the reveal command: a command of the editor returns nothing itself
    let shown = false
    try {
      host.automation.registerCommand({
        id: REVEAL_COMMAND,
        label: 'Show a change',
        execute: (services, place) => {
          try {
            shown = showPlace(services, place)
          } catch {
            // a place that is no longer there (the change was undone) is not an error
            shown = false
          }
        },
      })
    } catch {
      // registered by an earlier activation of this plugin, or a host without commands
    }

    // what the selection command saw, and the selection this plugin made itself by showing
    // a change: that one is not something the user picked
    let picked = null
    let shownKey = null
    try {
      host.automation.registerCommand({
        id: SELECTION_COMMAND,
        label: 'Read the selection',
        execute: (services) => {
          try {
            picked = cursorSelection(services)
          } catch {
            picked = null
          }
        },
      })
    } catch {
      // as above
    }

    // the document's characters as the status bar counts them, read through the editor's own
    // bridge as the 문서 정보 dialog reads them
    let counted = null
    try {
      host.automation.registerCommand({
        id: COUNT_COMMAND,
        label: 'Count the characters',
        execute: (services) => {
          try {
            const stats = documentStats(services.wasm, { textOnly: true })
            counted = { chars: stats.chars, charsNoSpace: stats.charsNoSpace }
          } catch {
            counted = null
          }
        },
      })
    } catch {
      // as above
    }

    /** The characters of what is selected now, or null when nothing (or no place) is. */
    const selectedCharacters = () => {
      picked = null
      host.automation.execute(SELECTION_COMMAND)
      const seen = picked
      if (!seen) return null
      return host.read((doc) => {
        const out = countCollector()
        return gatherSelection(doc, seen, out).ok ? out.counts() : null
      })
    }

    // the status bar's count: put off until typing or the selection rests (char-count.mjs)
    let charCountLabels = null
    let charCount = null
    const startCharCount = () => {
      const page = globalThis.document
      if (!charCountItem(page)) return false
      if (charCount) {
        charCount.refresh()
        return true
      }
      const counter = charCounter({
        readTotal: () => {
          counted = null
          host.automation.execute(COUNT_COMMAND)
          return counted
        },
        readSelection: selectedCharacters,
        render: (total, selected) => {
          const item = charCountItem(page)
          if (!item || !charCountLabels) return
          const { text, title } = charCountText(charCountLabels, total, selected)
          if (item.textContent !== text) item.textContent = text
          if (item.title !== title) item.title = title
        },
      })
      charCount = counter
      const offEdit = onDocumentEdit(host, () => counter.documentChanged())
      const offCaret = host.events.on('cursor-rect-updated', () => counter.selectionChanged())
      // another document opened in the same editor (a restored copy, a file dropped in)
      const offSwapped = host.events.on('document-swapped', () => counter.documentSwapped())
      // a cell block grows with the keys or the mouse without the caret moving: a key or a
      // button let go is when to look again
      const onRest = () => counter.selectionChanged()
      page.addEventListener('keyup', onRest, true)
      page.addEventListener('mouseup', onRest, true)
      stopCharCount = () => {
        counter.stop()
        page.removeEventListener('keyup', onRest, true)
        page.removeEventListener('mouseup', onRest, true)
        offEdit()
        for (const off of [offCaret, offSwapped]) {
          try {
            off?.()
          } catch {
            // the host already took it off
          }
        }
        charCount = null
      }
      counter.start()
      return true
    }

    /** The text of a body or cell paragraph the caret is in, as the word commands read it. */
    const readParagraph = (at) =>
      host.read((doc) => {
        const box = containerOf(doc, { sec: at.sec, para: at.para, cellPath: at.path })
        return box.text(at.k, box.length(at.k))
      })

    try {
      host.automation.registerCommand({
        id: WORD_COMMAND,
        label: 'Select the word',
        execute: (services) => {
          try {
            selectWord(services, readParagraph)
          } catch {
            // a place the caret cannot be read at: nothing is selected, as before
          }
        },
      })
    } catch {
      // as above
    }

    try {
      host.automation.registerCommand({
        id: PARAGRAPH_COMMAND,
        label: 'Select the paragraph',
        execute: (services) => {
          try {
            selectParagraph(services, readParagraph)
          } catch {
            // as for the word
          }
        },
      })
    } catch {
      // as above
    }

    try {
      host.automation.registerCommand({
        id: WORD_DRAG_COMMAND,
        label: 'Select by words while dragging',
        execute: (services, params) => {
          try {
            const phase = params && params.phase === 'start' ? 'start' : 'move'
            wordDragState = wordDrag(services, readParagraph, wordDragState, phase)
          } catch {
            // the studio's own drag selection stays
          }
        },
      })
    } catch {
      // as above
    }

    // the memo panel's commands: the list with its page rectangles, the selection an anchor
    // may be put on, the drawing of the anchors, and the input lock of an open modal
    try {
      host.automation.registerCommand({
        id: MEMO_LIST_COMMAND,
        label: 'List the memos',
        execute: () => {
          listedMemos = host.read(memoListOf)
        },
      })
    } catch {
      // registered by an earlier activation of this plugin, or a host without commands
    }

    try {
      host.automation.registerCommand({
        id: MEMO_SELECTION_COMMAND,
        label: 'Read the memo selection',
        execute: (services) => {
          memoAnchorAnswer = memoAnchorSelection(services)
        },
      })
    } catch {
      // as above
    }

    try {
      host.automation.registerCommand({
        id: MEMO_MARK_COMMAND,
        label: 'Draw the memo anchors',
        execute: (services) => {
          try {
            drawMemoAnchors(services)
          } catch {
            // the anchors are a help; a page that cannot take them stays as it is
          }
        },
      })
    } catch {
      // as above
    }

    try {
      host.automation.registerCommand({
        id: MEMO_LOCK_COMMAND,
        label: 'Lock the editor for a memo',
        execute: () => setMemoLock(true),
      })
    } catch {
      // as above
    }

    try {
      host.automation.registerCommand({
        id: MEMO_UNLOCK_COMMAND,
        label: 'Unlock the editor after a memo',
        execute: () => setMemoLock(false),
      })
    } catch {
      // as above
    }

    const page = globalThis.document
    if (page) {
      const inPage = (event) => {
        const target = event.target
        return Boolean(target && target.closest && target.closest('#scroll-container'))
      }
      const run = (id, params) => {
        try {
          host.automation.execute(id, params)
        } catch {
          // no such command in this editor: the click stays what it was
        }
      }
      let dragFrame = 0
      const onDoubleClick = (event) => {
        // the studio handled it (a header, a text box, a picture), or it was not in the page
        if (event.defaultPrevented || !inPage(event)) return
        // a double click that dragged on has its words selected already
        if (wordDragState && wordDragState.widened) return
        run(WORD_COMMAND)
      }
      // Hangul's other clicks: a triple click selects the paragraph, and a drag begun with a
      // double click selects whole words. Both run after the studio has put the caret down.
      // (The studio cancels every press in the page to keep its focus, so that says nothing.)
      const onMouseDown = (event) => {
        wordDragState = null
        if (event.button !== 0 || event.detail !== 2) return
        if (!inPage(event)) return
        run(WORD_DRAG_COMMAND, { phase: 'start' })
      }
      const onMouseMove = (event) => {
        if (!wordDragState || (event.buttons & 1) === 0 || dragFrame) return
        // after the studio's own frame, which moved the selection's end to the pointer
        dragFrame = globalThis.requestAnimationFrame(() => {
          dragFrame = 0
          if (wordDragState) run(WORD_DRAG_COMMAND, { phase: 'move' })
        })
      }
      const onMouseUp = () => {
        if (!wordDragState) return
        // the studio sets the drag's last end on release; widen it once more after that
        setTimeout(() => {
          if (wordDragState && wordDragState.widened) run(WORD_DRAG_COMMAND, { phase: 'move' })
        }, 0)
      }
      const onClick = (event) => {
        if (event.button !== 0 || event.detail !== 3 || event.defaultPrevented) return
        if (!inPage(event)) return
        run(PARAGRAPH_COMMAND)
      }
      if (stopListening) stopListening()
      page.addEventListener('dblclick', onDoubleClick)
      page.addEventListener('mousedown', onMouseDown)
      page.addEventListener('mousemove', onMouseMove)
      page.addEventListener('mouseup', onMouseUp)
      page.addEventListener('click', onClick)
      stopListening = () => {
        page.removeEventListener('dblclick', onDoubleClick)
        page.removeEventListener('mousedown', onMouseDown)
        page.removeEventListener('mousemove', onMouseMove)
        page.removeEventListener('mouseup', onMouseUp)
        page.removeEventListener('click', onClick)
        if (dragFrame) globalThis.cancelAnimationFrame(dragFrame)
        wordDragState = null
      }
    }

    const guarded =
      (fn) =>
      (...args) => {
        try {
          return fn(...args)
        } catch (thrown) {
          throw asError(thrown)
        }
      }

    /**
     * One change of this plugin: one undo step, not counted as foreign (the memo panel's
     * changes are: they are the user's). An AI change that
     * would take a memo away is rolled back and answered as needing approval; the memo
     * panel's own calls (`MEMO_CHANGES`) remove what they were asked to, and a call given
     * `allowMemoRemoval` goes through after the user said yes to that one change. A call
     * given `approvedMemoIds` may take only those memos: when the document changed while the
     * user was asked and the change would now take another one, it is refused again.
     */
    /**
     * The head tables as measured before a change, by control: as the last change left them
     * while nothing was edited since, or where the document still holds them as it did
     * then, so a change of the body reads no layout.
     */
    const headsBefore = (doc) => {
      if (headsRevision === revision) return headsKnown
      const heads = new Map()
      for (const { control, key } of headTablesOf(doc)) {
        const known = headsKnown.get(control)
        heads.set(
          control,
          known?.key === key ? known : { key, measured: measureHead(doc, control) },
        )
      }
      return heads
    }

    const change = (label, fn, options) => {
      const allowMemoRemoval = options?.allowMemoRemoval === true || options?.memoPolicy === 'allow'
      const approvedMemos = Array.isArray(options?.approvedMemoIds)
        ? new Set(options.approvedMemoIds)
        : null
      own = true
      // not left to the editor's event alone: a stale text would send the model after
      // words that are no longer there
      text = null
      pictures = null
      try {
        let done
        try {
          done = host.transaction(label, (tx) => {
            tx.deferPagination()
            const doc = tx.doc()
            const before = paragraphCounts(doc)
            const watched = MEMO_CHANGES.has(label) || allowMemoRemoval ? null : memoEntriesOf(doc)
            const known = headsBefore(doc)
            const changed = fn(doc)
            const { heads, taller } = settleHeads(doc, known)
            const result = options?.settled ? options.settled(changed, heads) : changed
            if (watched && watched.length > 0) {
              const left = new Set(memoEntriesOf(doc).map((entry) => entry.id))
              const gone = watched.filter(
                (entry) => !left.has(entry.id) && !(approvedMemos && approvedMemos.has(entry.id)),
              )
              if (gone.length > 0) {
                const failure = fail(
                  'MEMO_REMOVAL_REQUIRES_APPROVAL',
                  'the change would remove memos of the document',
                )
                failure.memos = gone
                throw failure
              }
            }
            return {
              result:
                taller.length > 0 && result?.ok === true
                  ? { ...result, tallerRows: taller }
                  : result,
              before,
              after: paragraphCounts(doc),
              heads,
            }
          })
        } catch (thrown) {
          if (thrown && thrown.code === 'MEMO_REMOVAL_REQUIRES_APPROVAL') {
            // the editor rolled the change back; the list is what it was
            syncMemos({ notify: false })
            refreshMemoAnchors()
            return {
              ok: false,
              reason: 'memo_removal_requires_approval',
              count: thrown.memos.length,
              memos: thrown.memos.map(memoSummaryOf),
            }
          }
          throw thrown
        }
        headsKnown = done.heads
        headsRevision = revision
        noteChange(label, done.result, done.before, done.after)
        // a memo the user added, changed or removed in the panel is the user's own edit: an
        // AI run's undo must not take it back in place of the run's changes
        if (MEMO_CHANGES.has(label)) foreign += 1
        if (
          done.result &&
          typeof done.result === 'object' &&
          ('marks' in done.result || 'shiftAt' in done.result)
        ) {
          const { marks: _places, shiftAt: _at, ...rest } = done.result
          return rest
        }
        return done.result
      } finally {
        own = false
      }
    }

    const listMatches = (doc, hits) =>
      hits.slice(0, MAX_LISTED_MATCHES).map((hit, index) => describe(doc, hit, index))

    /**
     * A new paragraph is made by splitting the one next to it, the way Enter does, so that
     * it takes that paragraph's formatting. Where an object sits at the split, though, the
     * engine may carry it into the new paragraph (it depends on the kind of object). So:
     * "before" is only done in a paragraph without objects, and "after" a paragraph whose
     * object sits at its end (a table on a line of its own, typically) adds an empty
     * paragraph behind it instead of splitting (`plain`). The page setup the first
     * paragraph of a document holds (`onlyPageSetup`) is no such object: it stays in front
     * when that paragraph is split at its start.
     */
    const guardObjects = (box, where, count, onlyPageSetup = false) => {
      const positions = box.objectPositions(box.index)
      if (where === 'before') {
        return positions.length > 0 && !onlyPageSetup
          ? { refusal: { ok: false, reason: 'has_objects', count } }
          : { box }
      }
      const plain = positions.some((position) => position >= box.length(box.index))
      return { box, plain }
    }

    /**
     * Whether `box` is the one empty paragraph a new document starts with: no text in it,
     * nothing else in the document, and no control but those that set up the page (the
     * section and column definitions every first paragraph carries, and a page number or a
     * header set before any text). Text added at the end of such a document goes into that
     * paragraph, as typing would, instead of leaving it in front as an empty first line.
     */
    const isEmptyDocument = (doc, box) =>
      !box.inTable &&
      doc.getSectionCount() === 1 &&
      doc.getParagraphCount(0) === 1 &&
      box.length(box.index) === 0 &&
      parse(doc.getControls()).every((control) => PAGE_CONTROLS.has(control.ctrlId))

    /** Make an empty paragraph after paragraph `k` of `box`; its index is k + 1. */
    const openAfter = (box, k, plain) => {
      if (plain) box.addAfter(k)
      else box.splitEnd(k)
    }

    /**
     * Whether paragraphs added after paragraph `k` of the body should be made in front of
     * the one that follows it instead, so that they take that one's formatting. Paragraphs
     * the AI adds are body text, and after a heading Enter would give them the heading's
     * look: so where `k` stands out from the next paragraph (larger text, bold over plain,
     * or an outline level over none), the next one is taken to be the body. Anything else
     * (the same look, a list item before its sub-item, a heading after body text) keeps
     * Enter's way. Not in a cell, where a paragraph's objects cannot be asked for, and not
     * next to an object, where a split may carry it along.
     */
    const opensBeforeBody = (doc, box, plain) => {
      const k = box.index
      if (box.inTable || plain || k + 1 >= box.count()) return false
      if (box.objectPositions(k + 1).length > 0) return false
      const { sec } = box.place(k, 0)
      try {
        // the text Enter carries over (the end of `k`) against the text the next one starts with
        const own = parse(doc.getCharPropertiesAt(sec, k, box.length(k)))
        const next = parse(doc.getCharPropertiesAt(sec, k + 1, 0))
        const outline = (p) => parse(doc.getParaPropertiesAt(sec, p)).headType === 'Outline'
        return (
          own.fontSize > next.fontSize ||
          (own.fontSize === next.fontSize && own.bold && !next.bold) ||
          (outline(k) && !outline(k + 1))
        )
      } catch {
        return false
      }
    }

    /**
     * The paragraph a paragraph edit works on: the one `anchor` occurs in, or for "end" the
     * last paragraph of the document. `box` addresses it; without one, `refusal` says why.
     */
    const locate = (doc, anchor, occurrence, where) => {
      if (where === 'end') {
        const sec = doc.getSectionCount() - 1
        return guardObjects(
          containerOf(doc, { sec, para: doc.getParagraphCount(sec) - 1 }),
          where,
          1,
        )
      }
      const hits = searchAll(doc, anchor)
      const picked = pickHit(hits, occurrence)
      const reason = !picked.hit
        ? picked.reason
        : !isReplaceable(picked.hit)
          ? 'unsupported_place'
          : null
      if (reason) {
        return {
          refusal: {
            ok: false,
            reason,
            count: hits.length,
            ...(reason === 'ambiguous' ? { matches: listMatches(doc, hits) } : {}),
          },
        }
      }
      const box = containerOf(doc, picked.hit)
      return guardObjects(
        box,
        where,
        hits.length,
        where === 'before' && !box.inTable && !holdsContentObject(doc, picked.hit.sec, box),
      )
    }

    /**
     * Run a paragraph edit that must not cost the document an object or a field value. The
     * edit calls `mustKeep(before, after)`; when something is gone it throws, the editor
     * rolls the whole change back, and the call answers `has_objects` instead of failing.
     */
    const keepingObjects = (edit) => {
      const mustKeep = (before, after) => {
        if (before.controls === after.controls && before.fields === after.fields) return
        throw fail('HAS_OBJECTS', 'the change would remove an object of the document')
      }
      try {
        return edit(mustKeep)
      } catch (thrown) {
        if (thrown?.code === 'HAS_OBJECTS') return { ok: false, reason: 'has_objects', count: 1 }
        throw thrown
      }
    }

    // the list the panel starts from: a change is watched against it, so a user's edit that
    // takes a memo away can be told apart from the memos that were there
    try {
      syncMemos({ notify: false })
    } catch {
      // no document yet: the first read fills it
    }

    /** The pictures of the document, read again after the document changed. */
    const pictureList = () =>
      host.read((doc) => {
        pictures ??= picturesOf(doc)
        return pictures
      })

    const api = {
      foreignChanges: () => foreign,

      /** Moves with every edit of the document and every document swapped in; reads nothing. */
      documentRevision: () => revision,

      /** The whole document as plain text, table cells included, in reading order. */
      readText: guarded(() => {
        text ??= host.read(textOf)
        return text
      }),

      /** The pictures of the document, in reading order, with the words beside each one. */
      listPictures: guarded(() => {
        const all = pictureList()
        return {
          count: all.length,
          limited: all.length >= MAX_LISTED_PICTURES,
          pictures: all.map((picture, index) => ({
            picture: index + 1,
            type: picture.mime,
            page: picture.page,
            near: picture.near,
            table: picture.table,
          })),
        }
      }),

      /** One picture (its number from listPictures) as base64, for the model to look at. */
      readPicture: guarded((number) => {
        if (!Number.isInteger(number) || number < 1) {
          throw fail('BAD_ARGUMENT', 'picture must be a positive integer from listPictures')
        }
        const picture = pictureList()[number - 1]
        if (!picture) return { ok: false, reason: 'no_such_picture', count: pictureList().length }
        return host.read((doc) => {
          const bytes = doc.getControlImageData(
            picture.sec,
            picture.para,
            JSON.stringify(picture.cellPath ?? []),
            picture.control,
          )
          if (bytes.length > MAX_PICTURE_BYTES) {
            return { ok: false, reason: 'too_large', bytes: bytes.length }
          }
          return { ok: true, mime: picture.mime, base64: base64Of(bytes) }
        })
      }),

      /**
       * What the document is made of, for the format checks (`@genoffice/doc-rules`):
       * paragraphs, tables with their cells, pictures, and every character shape in use.
       * Reads only; no model is called.
       */
      documentProfile: guarded(() => host.read(profileOf)),

      /** Where a piece of text occurs. Exact, case-sensitive. */
      findText: guarded((find) =>
        host.read((doc) => {
          const hits = searchAll(doc, find)
          return { count: hits.length, matches: listMatches(doc, hits) }
        }),
      ),

      /**
       * Replace one occurrence of `find`. Without `occurrence` the text must occur exactly
       * once; with it (1-based) that occurrence is replaced. Formatting around the replaced
       * span stays as it was.
       */
      replaceText: guarded((find, replacement, occurrence, options) => {
        checkLineText(replacement)
        // decided on a read first: a transaction is only opened for a change that will happen
        const refusal = host.read((doc) => {
          const hits = searchAll(doc, find)
          const picked = pickHit(hits, occurrence)
          const reason = !picked.hit
            ? picked.reason
            : !isReplaceable(picked.hit)
              ? 'unsupported_place'
              : spansObject(doc, picked.hit)
                ? 'spans_object'
                : null
          if (!reason) return null
          return {
            ok: false,
            reason,
            count: hits.length,
            ...(reason === 'ambiguous' ? { matches: listMatches(doc, hits) } : {}),
          }
        })
        if (refusal) return refusal
        return change(
          'replace',
          (doc) => {
            const hits = searchAll(doc, find)
            const { hit } = pickHit(hits, occurrence)
            if (!hit || !isReplaceable(hit) || spansObject(doc, hit)) {
              throw fail('CHANGED', 'the document changed mid-call')
            }
            replaceHit(doc, hit, replacement)
            return {
              ok: true,
              count: hits.length,
              inTable: Boolean(hit.cellContext),
              place: placeOf(hit, replacement.length),
            }
          },
          options,
        )
      }),

      /**
       * Replace every occurrence of `find` outside equations, last match first. A match
       * that lies across an object of its line is left as it is and counted in `skipped`.
       */
      replaceAllText: guarded((find, replacement, options) => {
        checkLineText(replacement)
        const sorted = (doc) => {
          const hits = []
          let skipped = 0
          for (const hit of searchAll(doc, find).filter(isReplaceable)) {
            if (spansObject(doc, hit)) skipped += 1
            else hits.push(hit)
          }
          return { hits, skipped }
        }
        const found = host.read((doc) => {
          const { hits, skipped } = sorted(doc)
          return { total: hits.length, skipped }
        })
        if (found.total === 0) {
          return found.skipped > 0
            ? { ok: false, reason: 'spans_object', count: found.skipped }
            : { ok: false, reason: 'not_found', count: 0 }
        }
        return change(
          'replace-all',
          (doc) => {
            const { hits: inOrder, skipped } = sorted(doc)
            // back to front, so replacing one match never moves the offset of one still to do
            const hits = inOrder.reverse()
            for (const hit of hits) replaceHit(doc, hit, replacement)
            // the first in reading order is the last one done; nothing in front of it moved.
            // A later match in the same paragraph moved by what the earlier ones changed.
            const shifted = new Map()
            const marks = [...hits].reverse().map((hit) => {
              const key = JSON.stringify([hit.sec, hit.para, cellPathOf(hit)])
              const moved = shifted.get(key) ?? 0
              shifted.set(key, moved + replacement.length - hit.length)
              return placeOf({ ...hit, charOffset: hit.charOffset + moved }, replacement.length)
            })
            return {
              ok: true,
              count: hits.length,
              ...(skipped > 0 ? { skipped } : {}),
              place: placeOf(hits[hits.length - 1], replacement.length),
              marks,
            }
          },
          options,
        )
      }),

      /**
       * Add new paragraphs next to the paragraph `anchor` occurs in (`where` "after" or
       * "before"), or after the last paragraph of the document ("end"). They are made the way
       * Enter makes one, so they take the paragraph and character formatting of that paragraph,
       * except after a heading, where they take the body's (opensBeforeBody). "before" a
       * heading is left as it is: what goes there may be the end of the part above it or a
       * new heading, and neither can be told from the document.
       */
      insertParagraphs: guarded((anchor, occurrence, where, paragraphs, options) => {
        checkWhere(where)
        checkParagraphs(paragraphs)
        const refusal = host.read((doc) => locate(doc, anchor, occurrence, where).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'insert-paragraphs',
            (doc) => {
              const { box, plain } = locate(doc, anchor, occurrence, where)
              if (!box) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              const texts = [...paragraphs]
              let at = box.index
              // the first text of a new document is written into its empty paragraph: an
              // empty line in front would also push a title box or a head table down from
              // the top of the page
              const intoEmpty = where === 'end' && isEmptyDocument(doc, box)
              if (intoEmpty) {
                const first = texts.shift()
                if (first) box.insert(at, first)
              }
              if (where === 'before') {
                // splitting at the start leaves an empty paragraph in front, formatted like this one
                box.split(at, 0)
                const first = texts.shift()
                if (first) box.insert(at, first)
              }
              // after a heading the first one is split off the front of the body paragraph
              // that follows; the rest are made after it and so look like it too
              const beforeBody = where === 'after' && opensBeforeBody(doc, box, plain)
              for (const text of texts) {
                // only the anchor can hold an object; the paragraphs made here are plain text
                if (beforeBody && at === box.index) box.split(at + 1, 0)
                else openAfter(box, at, plain && at === box.index)
                at += 1
                if (text) box.insert(at, text)
              }
              mustKeep(before, objectsOf(doc))
              const first = where === 'before' || intoEmpty ? box.index : box.index + 1
              return {
                ok: true,
                count: paragraphs.length,
                inTable: box.inTable,
                place: box.place(first, paragraphs[0].length),
                marks: paragraphs.map((text, k) => box.place(first + k, text.length)),
              }
            },
            options,
          ),
        )
      }),

      /**
       * Remove the paragraph `find` occurs in. A paragraph that holds a table, a picture or
       * a form field is left alone: removing it would take the object with it. One whose
       * whole text is among `options.protectTexts` is left alone too (`protected`): the panel
       * names the paragraphs its run added, which a stale occurrence number would hit.
       */
      deleteParagraph: guarded((find, occurrence, options) => {
        const protectTexts = Array.isArray(options?.protectTexts)
          ? new Set(
              options.protectTexts
                .filter((text) => typeof text === 'string')
                .map(squash)
                .filter(Boolean),
            )
          : null
        const refusal = host.read((doc) => {
          const { box, refusal: why } = locate(doc, find, occurrence, 'after')
          if (!box) return why
          if (protectTexts) {
            const whole = box.text(box.index, box.length(box.index))
            if (protectTexts.has(squash(whole))) {
              return {
                ok: false,
                reason: 'protected',
                count: 1,
                text: whole.slice(0, MAX_REPORTED_CHARS),
              }
            }
          }
          // the first paragraph is only emptied, which the check after the change covers
          const removed = box.index > 0 && box.count() > 1
          return removed && box.objectPositions(box.index).length > 0
            ? { ok: false, reason: 'has_objects', count: 1 }
            : null
        })
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'delete-paragraph',
            (doc) => {
              const { box } = locate(doc, find, occurrence, 'after')
              if (!box) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              const k = box.index
              const length = box.length(k)
              const text = box.text(k, Math.min(length, MAX_REPORTED_CHARS))
              // the first paragraph of a cell or section has nothing in front to close up
              // against, and joining it with the next one would hand that one its formatting:
              // it keeps its place as an empty line
              const emptied = k === 0 || box.count() === 1
              if (emptied) box.deleteText(k, length)
              else box.remove(k)
              mustKeep(before, objectsOf(doc))
              return {
                ok: true,
                text,
                emptied,
                inTable: box.inTable,
                place: box.place(emptied ? k : k - 1, 0),
                // the marks below move up from the paragraph that went
                shiftAt: box.place(k, 0),
              }
            },
            options,
          ),
        )
      }),

      /**
       * Add a table of plain-text cells, placed like insertParagraphs places a paragraph,
       * in the body text only: the engine does not lay out a table made inside the cell of
       * another one (its cells come out in one row, without lines).
       */
      insertTable: guarded((anchor, occurrence, where, rows, header, options) => {
        checkWhere(where)
        const table = tableOf(rows)
        // `header` is the header row alone (a boolean) or the whole look of the table
        const look = tableLookOf(header, table[0].length)
        const refusal = host.read((doc) => {
          const { box, refusal: why } = locate(doc, anchor, occurrence, where)
          if (!box) return why
          if (box.inTable) return { ok: false, reason: 'in_table', count: 1 }
          // a table across the columns is the head of the document: it goes in front of
          // the first paragraph. Anywhere else the text before it would stand in the first
          // column only, beside the table's place.
          const { sec, para } = box.place(box.index, 0)
          const columns = columnsAt(doc, sec, para)
          if (!columns) return { ok: false, reason: 'columns_unknown', count: 1 }
          const head = where === 'before' && sec === 0 && box.index === 0
          return look.across && columns.count > 1 && !head
            ? { ok: false, reason: 'not_at_start', count: 1 }
            : null
        })
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'insert-table',
            (doc) => {
              const { box, plain } = locate(doc, anchor, occurrence, where)
              if (!box) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              let at = box.index
              const { sec: here } = box.place(at, 0)
              const beside = where === 'before' ? at - 1 : at
              const body =
                look.font && look.size
                  ? null
                  : bodyFontOf(doc, beside >= 0 ? { sec: here, para: beside } : null, () =>
                      fontOf(() => doc.getCharPropertiesAt(here, at, 0)),
                    )
              const font = {
                family: look.font ?? body.family,
                points: look.size ?? body.points,
              }
              // body cells are left-aligned unless told: a justified cell that wraps
              // stretches the spaces between its words
              const aligns = look.aligns ?? Array(table[0].length).fill('left')
              // floated in one column too, so that columns set later start below it
              const head = where === 'before' && here === 0 && at === 0 && !box.inTable
              // the columns where the anchor is, which the new paragraph lies in too
              const zone = box.inTable ? null : columnsAt(doc, here, box.place(at, 0).para)
              if (where === 'before') box.split(at, 0)
              else {
                openAfter(box, at, plain)
                at += 1
              }
              const place = box.place(at, 0)
              // where the text runs in columns a table is one column wide, or as wide as
              // the page when it is to lie across them; in one column the paste shares the
              // text width by itself
              const inColumns = zone?.count ?? 1
              const across = look.across && (inColumns > 1 || head)
              // a table narrower than the text (an approval box, a small list) takes its
              // share of the width; one across the columns is always as wide as the page
              const narrow = !across && look.widthShare < 1
              const room =
                (across || inColumns === 1 ? textWidthPt(doc, place.sec) : zone.widthPt) *
                (across ? 1 : look.widthShare)
              const shares =
                look.shares ??
                (inColumns > 1 || narrow || across
                  ? Array(table[0].length).fill(1 / table[0].length)
                  : null)
              const columns = {
                widths: shares ? shares.map((share) => Math.round(room * share * 10) / 10) : null,
                aligns,
              }
              let headerTextColor = null
              // in the body the header's grey goes on after the paste, cell by cell (shadeHeaderCells)
              box.pasteHtml(at, tableHtml(table, font, look.header, box.inTable, columns))
              if (!box.inTable) {
                if (look.header && look.headerColor !== 'none') {
                  const fill = look.headerColor ?? TABLE_HEADER_FILL
                  shadeHeaderCells(doc, place, table[0].length, fill)
                  headerTextColor = textColorOnFill(fill)
                }
                // the lines of a look other than the plain grid, over the thin line the paste gave every cell
                const blocks = tableLookBlocks(look.look, look.header)
                const empty = table.some((row) => row.includes(''))
                const made =
                  blocks.length > 0 || across || look.repeatHeader || headerTextColor || empty
                    ? pastedTableAt(doc, place)
                    : null
                if (made && empty) formatEmptyCells(doc, made, table, font, aligns, look.header)
                if (made && headerTextColor) {
                  formatCellText(
                    doc,
                    made,
                    gridOf(doc, made),
                    { top: 0, left: 0, bottom: 0, right: made.cols - 1 },
                    { chars: JSON.stringify({ textColor: headerTextColor }) },
                  )
                }
                // the table stands in its paragraph like a character: the paragraph's
                // alignment puts a narrow one at the left, in the middle or at the right
                if (look.place && !across) {
                  expectOk(
                    doc.applyParaFormat(
                      place.sec,
                      place.para,
                      JSON.stringify({ alignment: look.place }),
                    ),
                    'place the table',
                  )
                }
                if (made && look.repeatHeader) {
                  expectOk(
                    doc.setTableProperties(
                      made.sec,
                      made.para,
                      made.path[0].controlIndex,
                      JSON.stringify({ repeatHeader: true }),
                    ),
                    'repeat the header row',
                  )
                }
                if (made && across) {
                  floatAcrossColumns(doc, made.sec, made.para, made.path[0].controlIndex)
                  // the empty paragraph the table was made in and the first words become
                  // one paragraph (they are formatted alike: the one was split off the
                  // other). Hangul gives a head that sits in an empty paragraph of its own
                  // a gap as high as the head under it, in the first column.
                  expectOk(
                    doc.mergeParagraph(made.sec, made.para + 1),
                    'join the head and the text',
                  )
                }
                if (made) {
                  const grid = gridOf(doc, made)
                  for (const block of blocks) {
                    setCellBorders(
                      doc,
                      made,
                      grid,
                      {
                        top: 0,
                        left: 0,
                        bottom: block.header ? 0 : made.rows - 1,
                        right: made.cols - 1,
                      },
                      block.rules,
                    )
                  }
                }
              }
              const after = objectsOf(doc)
              // the new table is an object of its own; nothing that was there may be gone
              mustKeep(before, { ...after, controls: Math.min(after.controls, before.controls) })
              return {
                ok: true,
                rows: table.length,
                cols: table[0].length,
                inTable: box.inTable,
                place,
                ...(box.inTable ? {} : tableNumberOf(doc, place.sec, place.para)),
                ...(across ? { acrossColumns: true } : {}),
                ...(headerTextColor ? { headerTextColor } : {}),
                ...(look.standIns.length > 0 ? { standIn: look.standIns } : {}),
              }
            },
            options,
          ),
        )
      }),

      /**
       * Add a picture (base64 PNG, JPEG or GIF) in a new paragraph at the anchor, placed the
       * way insertTable places a table. `widthPt` is the width the picture takes on the page;
       * the aspect comes from the natural pixel size. The picture is a new object of the
       * document, so the object-count check permits exactly that one addition and nothing lost.
       */
      insertPicture: guarded(
        (
          anchor,
          occurrence,
          where,
          base64,
          widthPt,
          naturalWidthPx,
          naturalHeightPx,
          extension,
          options,
        ) => {
          checkWhere(where)
          const picture = pictureOf(base64, extension)
          const naturalW = Math.max(1, Math.round(Number(naturalWidthPx) || 1))
          const naturalH = Math.max(1, Math.round(Number(naturalHeightPx) || 1))
          // width is in HWPUNIT (1pt = 200); a tall picture is pulled in so it cannot run
          // past a page, keeping the aspect the natural pixel size gives it
          let width = Math.round(Math.min(Math.max(Number(widthPt) || 240, 24), 600) * 200)
          let height = Math.max(200, Math.round((width * naturalH) / naturalW))
          const maxHeight = 600 * 200
          if (height > maxHeight) {
            height = maxHeight
            width = Math.max(1, Math.round((height * naturalW) / naturalH))
          }
          const refusal = host.read((doc) => {
            const { box, refusal: why } = locate(doc, anchor, occurrence, where)
            return box ? null : why
          })
          if (refusal) return refusal
          return keepingObjects((mustKeep) =>
            change(
              'insert-picture',
              (doc) => {
                const { box, plain } = locate(doc, anchor, occurrence, where)
                if (!box) throw fail('CHANGED', 'the document changed mid-call')
                const before = objectsOf(doc)
                let at = box.index
                if (where === 'before') box.split(at, 0)
                else {
                  openAfter(box, at, plain)
                  at += 1
                }
                const place = box.place(at, 0)
                expectOk(
                  doc.insertPictureEx(
                    JSON.stringify({
                      sectionIdx: place.sec,
                      paraIdx: place.para,
                      charOffset: 0,
                      ...(place.path ? { cellPath: JSON.stringify(place.path) } : {}),
                      width,
                      height,
                      naturalWidthPx: naturalW,
                      naturalHeightPx: naturalH,
                      extension: picture.extension,
                    }),
                    picture.bytes,
                  ),
                  'insert the picture',
                )
                const after = objectsOf(doc)
                // the new picture is an object of its own; nothing that was there may be gone
                mustKeep(before, { ...after, controls: Math.min(after.controls, before.controls) })
                return { ok: true, inTable: box.inTable, place: box.place(at, 0) }
              },
              options,
            ),
          )
        },
      ),

      /**
       * Change every run of text whose Hangul font is `from` to `to`, in the body and in
       * table cells. The format check's font fix: one transaction, so one undo step, and
       * only character shapes change. Says how many runs it changed, and whether it
       * stopped early at the cap.
       */
      replaceFont: guarded((from, to) => {
        const fromName = typeof from === 'string' ? from.trim() : ''
        const toName = typeof to === 'string' ? to.trim() : ''
        if (fromName === '' || toName === '') {
          throw fail('BAD_ARGUMENT', 'both font names are needed')
        }
        if (fromName === toName) return { ok: true, ranges: 0, paragraphs: 0 }
        return change('replace-font', (doc) => {
          const chars = resolveFormat(doc, { chars: {}, font: toName }).chars
          let ranges = 0
          let paragraphs = 0
          let truncated = false

          /** Runs of one paragraph or cell paragraph that name the font, changed one by one. */
          const applyRuns = (runs, read, format) => {
            let touched = false
            for (const run of Array.isArray(runs) ? runs : []) {
              if (ranges >= MAX_FONT_RANGES) {
                truncated = true
                break
              }
              const start = run.startOffset ?? 0
              const end = run.endOffset ?? 0
              if (end <= start) continue
              let props
              try {
                props = parse(read(start))
              } catch {
                continue
              }
              if (hangulFontOf(props) !== fromName) continue
              format(start, end)
              ranges += 1
              touched = true
            }
            if (touched) paragraphs += 1
          }

          for (let sec = 0; sec < doc.getSectionCount(); sec++) {
            const count = doc.getParagraphCount(sec)
            for (let para = 0; para < count; para++) {
              let length
              try {
                length = doc.getParagraphLength(sec, para)
              } catch {
                length = 0
              }
              if (length <= 0) continue
              let runs
              try {
                runs = parse(doc.getCharShapeRuns(sec, para, 0, length))
              } catch {
                runs = []
              }
              applyRuns(
                runs,
                (offset) => doc.getCharPropertiesAt(sec, para, offset),
                (start, end) =>
                  expectOk(doc.applyCharFormat(sec, para, start, end, chars), 'change the font'),
              )
            }
          }

          for (const table of tablesOf(doc).tables) {
            for (let cell = 0; cell < table.cells; cell++) {
              let count
              try {
                count = doc.getCellParagraphCountByPath(
                  table.sec,
                  table.para,
                  JSON.stringify(cellAt(table.path, cell, 0)),
                )
              } catch {
                continue
              }
              for (let k = 0; k < count; k++) {
                const path = cellAt(table.path, cell, k)
                const json = JSON.stringify(path)
                let length
                try {
                  length = doc.getCellParagraphLengthByPath(table.sec, table.para, json)
                } catch {
                  length = 0
                }
                if (length <= 0) continue
                let runs
                try {
                  runs = parse(
                    doc.getCharShapeRunsInCellByPath(table.sec, table.para, json, 0, length),
                  )
                } catch {
                  runs = []
                }
                applyRuns(
                  runs,
                  (offset) =>
                    doc.getCellCharPropertiesAtByPath(table.sec, table.para, json, offset),
                  (start, end) =>
                    expectOk(
                      doc.applyCharFormatInCellByPath(
                        table.sec,
                        table.para,
                        json,
                        start,
                        end,
                        chars,
                      ),
                      'change the font',
                    ),
                )
              }
            }
          }

          const result = { ok: true, ranges, paragraphs }
          if (truncated) result.truncated = true
          return result
        })
      }),

      /**
       * Change the character formatting of one occurrence of `find`, or with `all` of every
       * occurrence. Only the named properties change; the text itself is not touched.
       */
      formatText: guarded((find, occurrence, all, format, options) => {
        const spec = formatOf(format, false)
        const targets = (doc) => {
          const hits = searchAll(doc, find)
          if (all === true) {
            const usable = hits.filter(isReplaceable)
            return usable.length > 0
              ? { hits: usable }
              : { refusal: { ok: false, reason: 'not_found', count: 0 } }
          }
          const picked = pickHit(hits, occurrence)
          if (picked.hit && isReplaceable(picked.hit)) return { hits: [picked.hit] }
          const reason = picked.hit ? 'unsupported_place' : picked.reason
          return {
            refusal: {
              ok: false,
              reason,
              count: hits.length,
              ...(reason === 'ambiguous' ? { matches: listMatches(doc, hits) } : {}),
            },
          }
        }
        const refusal = host.read((doc) => targets(doc).refusal ?? missingStyle(doc, spec))
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'format-text',
            (doc) => {
              const { hits } = targets(doc)
              if (!hits) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              const { chars, charShape } = resolveFormat(doc, spec)
              for (const hit of hits) {
                const box = containerOf(doc, hit)
                const end = hit.charOffset + hit.length
                // the style first: what was asked for besides goes over it
                if (charShape !== null) box.setCharShape(box.index, hit.charOffset, end, charShape)
                if (chars) box.formatChars(box.index, hit.charOffset, end, chars)
              }
              mustKeep(before, objectsOf(doc))
              return { ok: true, count: hits.length, place: placeOf(hits[0], hits[0].length) }
            },
            options,
          ),
        )
      }),

      /**
       * Change the formatting of the whole paragraph `find` occurs in: its alignment and
       * line spacing, and the character formatting of all its text.
       */
      formatParagraph: guarded((find, occurrence, format, options) => {
        const spec = formatOf(format, true)
        const plan = (doc) => {
          const hits = searchAll(doc, find)
          const picked = pickHit(hits, occurrence)
          const refuse = (reason) => ({
            refusal: {
              ok: false,
              reason,
              count: hits.length,
              ...(reason === 'ambiguous' ? { matches: listMatches(doc, hits) } : {}),
            },
          })
          if (!picked.hit) return refuse(picked.reason)
          if (!isReplaceable(picked.hit)) return refuse('unsupported_place')
          const box = containerOf(doc, picked.hit)
          if ((spec.paragraph && !box.formatParagraph) || (spec.style && !box.applyStyle))
            return refuse('unsupported_place')
          const missing = missingStyle(doc, spec) ?? wordsSetApart(spec, [[box, box.index]])
          if (missing) return { refusal: missing }
          return { box }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'format-paragraph',
            (doc) => {
              const { box } = plan(doc)
              if (!box) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              const length = box.length(box.index)
              const { chars, paragraph, style, charShape } = resolveFormat(doc, spec)
              // the styles first: what was asked for besides goes over them
              const keptOwnLook = style !== null && keepsOwnLook(doc, box, box.index) === true
              if (style !== null) box.applyStyle(box.index, style)
              if (charShape !== null && length > 0)
                box.setCharShape(box.index, 0, length, charShape)
              if (paragraph) box.formatParagraph(box.index, paragraph)
              if (chars && length > 0) box.formatChars(box.index, 0, length, chars)
              mustKeep(before, objectsOf(doc))
              return {
                ok: true,
                inTable: box.inTable,
                place: box.place(box.index, length),
                ...(keptOwnLook ? { keptOwnLook: 1 } : {}),
              }
            },
            options,
          ),
        )
      }),

      /**
       * The table cells whose text does not fit where it is drawn (cut off on the page and
       * in print), with the table number listTables gives, the 1-based row and column, the
       * page and how far past the edge in mm. Starts at table `fromTable`, row `fromRow`
       * (1-based, default the first) and measures for about two seconds; `next` is where
       * the next call goes on. The pages are laid out with the widths printPages and the
       * PDF export use, so a listed cell is the one cut off in print. Given `toRow`, only
       * table `fromTable` is measured, up to that row: what an edit of that table cut off.
       * Reads only.
       */
      checkLayout: guarded((fromTable, fromRow, toRow) =>
        host.read((doc) =>
          withPrintWidths(doc, screenFonts(), () =>
            overflowsOf(doc, fromTable, fromRow, toRow ?? null),
          ),
        ),
      ),

      cutCells: guarded(() =>
        host.read((doc) => withPrintWidths(doc, screenFonts(), () => cutCellsOf(doc))),
      ),

      /**
       * The tables of the document in reading order, numbered from 1; a table inside a cell
       * comes right after the table it sits in. The number is what readTable and fillCells
       * take.
       */
      listTables: guarded(() =>
        host.read((doc) => {
          const { tables, partial } = tablesOf(doc)
          const near = (table) => {
            if (table.parent !== null) return ''
            // the line the table follows usually says what it is
            for (let k = table.para; k >= 0 && k > table.para - 4; k--) {
              const length = doc.getParagraphLength(table.sec, k)
              if (length > 0) {
                return clip(doc.getTextRange(table.sec, k, 0, length).trim(), PREVIEW_CHARS * 2)
              }
            }
            return ''
          }
          const preview = (table) => {
            const texts = []
            for (let cell = 0; cell < table.cells && cell < 12; cell++) {
              const text = paragraphsOf(cellBox(doc, table, cell))
                .join(' ')
                .trim()
              if (text) texts.push(clip(text, PREVIEW_CHARS))
              if (texts.length === PREVIEW_CELLS) break
            }
            return texts
          }
          return {
            count: tables.length,
            partial,
            tables: tables.slice(0, MAX_LISTED_TABLES).map((table, index) => ({
              table: index + 1,
              rows: table.rows,
              cols: table.cols,
              ...(table.parent === null ? {} : { inTable: table.parent + 1 }),
              near: near(table),
              preview: preview(table),
            })),
          }
        }),
      ),

      /**
       * The cells of table `number` row by row, from row `fromRow` (1-based). A merged cell
       * is listed once, at its first place, with its spans. A long table comes in parts:
       * `nextRow` is the row to go on from.
       */
      readTable: guarded((number, fromRow) =>
        host.read((doc) => {
          const { tables } = tablesOf(doc)
          const table = Number.isInteger(number) ? tables[number - 1] : undefined
          if (!table) return { ok: false, reason: 'no_such_table', count: tables.length }
          const first = Number.isInteger(fromRow) && fromRow > 1 ? fromRow - 1 : 0
          const grid = gridOf(doc, table)
            .filter((cell) => cell.row >= first)
            .sort((a, b) => a.row - b.row || a.col - b.col)
          // whole rows only, and always at least one
          let end = grid.length
          if (grid.length > MAX_READ_CELLS) {
            const cut = grid[MAX_READ_CELLS].row
            end = grid.findIndex((cell) => cell.row === cut)
            if (end === 0) end = grid.findIndex((cell) => cell.row !== cut)
            if (end < 0) end = grid.length
          }
          const fields = fieldsByCell(doc)
          const covered = coveredCells(doc, table)
          const bullets = table.path.length > 1 ? new Map() : bulletChars(doc)
          const key = tableKey(table.sec, table.para, table.path)
          const cells = grid.slice(0, end).map((place) => {
            const held = fields.get(`${key}:${place.cell}`)
            const box = boxBulletsOf(doc, table, place.cell, bullets).find(
              (entry) => !entry.checked,
            )
            return {
              row: place.row + 1,
              col: place.col + 1,
              ...(place.rowSpan > 1 ? { rowSpan: place.rowSpan } : {}),
              ...(place.colSpan > 1 ? { colSpan: place.colSpan } : {}),
              text: clip(paragraphsOf(cellBox(doc, table, place.cell)).join('\n'), MAX_CELL_CHARS),
              ...(held ? { fields: held.map((field) => field.number) } : {}),
              ...(box ? { box: box.char } : {}),
              ...(!held && (covered.has(place.cell) || cellHoldsObject(doc, table, place.cell))
                ? { object: true }
                : {}),
            }
          })
          return {
            ok: true,
            table: number,
            rows: table.rows,
            cols: table.cols,
            cells,
            ...(end < grid.length ? { nextRow: grid[end].row + 1 } : {}),
          }
        }),
      ),

      /**
       * Write text into cells of table `number`, all of them in one undo step or none.
       * `cells` is a list of { row, col, text } with 1-based places; a place inside a merged
       * cell means that cell. A line break in the text starts a new paragraph in the cell.
       * The text takes the formatting the cell already has. A cell that holds text is only
       * written over with `overwrite`; a cell that holds one click-here field is filled
       * through the field; a cell that holds a picture or another object is never written.
       */
      /**
       * The pages as the editor prints them, from page `from` (0-based): SVG drawn for
       * print and each page's size in CSS pixels, as many pages as are drawn in about two
       * seconds (always one). Called again from where it stopped until `pageCount`. Pages
       * are laid out as withPrintWidths says (the screen's layout where the editor can
       * answer for its fonts, else the portable text widths) and drawn in the fonts the
       * screen shows (printSvgOf); the screen's state is put back before the call returns.
       */
      printPages: guarded((from) =>
        host.read((doc) => {
          const screen = screenFonts()
          return withPrintWidths(doc, screen, () => {
            const pageCount = doc.pageCount()
            const start = Number.isInteger(from) && from > 0 ? Math.min(from, pageCount) : 0
            const began = Date.now()
            const pages = []
            for (let page = start; page < pageCount; page++) {
              pages.push(printPageOf(doc, page, screen))
              if (Date.now() - began > PRINT_BATCH_MS) break
            }
            return { pageCount, from: start, pages }
          })
        }),
      ),

      /**
       * Each page's size in CSS pixels as the print path lays it out, from page `from`
       * (0-based), without drawing any: the print preview's layout diagram needs every
       * page's paper before it has drawn them. As many pages as are measured in about two
       * seconds (always one); called again from where it stopped until `pageCount`. The
       * call lays the pages out the way printPages does (withPrintWidths) and puts the
       * screen's state back before it returns.
       */
      /**
       * Resolves, once the start-up look at the PC's fonts is over, with whether the
       * pages for print can be drawn in the fonts the screen shows. A print, its page sizes
       * and the preview ask first: a print asked for in the first seconds of a document
       * would otherwise go out in the engine's fonts and layout. Reads nothing.
       */
      printFontsReady: guarded(() => printFontsReady()),

      printPageSizes: guarded((from) =>
        host.read((doc) =>
          withPrintWidths(doc, screenFonts(), () => {
            const pageCount = doc.pageCount()
            const start = Number.isInteger(from) && from > 0 ? Math.min(from, pageCount) : 0
            const began = Date.now()
            const sizes = []
            for (let page = start; page < pageCount; page++) {
              const info = JSON.parse(doc.getPageInfo(page))
              sizes.push({ width: info.width, height: info.height })
              if (Date.now() - began > PRINT_BATCH_MS) break
            }
            return { pageCount, from: start, sizes }
          }),
        ),
      ),

      /**
       * One page as the print path draws it, for the print preview. `page` is 0-based.
       * The page count comes back with it, so the preview can show "1 / N" before any
       * other page is drawn. The call lays the page out the way printPages does
       * (withPrintWidths) and puts the screen's state back before it returns.
       */
      previewPage: guarded((page) =>
        host.read((doc) => {
          const screen = screenFonts()
          return withPrintWidths(doc, screen, () => {
            const pageCount = doc.pageCount()
            if (!Number.isInteger(page) || page < 0 || page >= pageCount) {
              throw fail('BAD_ARGUMENT', 'page out of range')
            }
            const info = JSON.parse(doc.getPageInfo(page))
            return {
              pageCount,
              page,
              svg: printSvgOf(doc, page, screen),
              width: info.width,
              height: info.height,
              margins: {
                left: info.marginLeft,
                top: info.marginTop,
                right: info.marginRight,
                bottom: info.marginBottom,
              },
            }
          })
        }),
      ),

      /**
       * The first body paragraph that starts on `page` (0-based), as the target
       * focusTarget takes. Ctrl+Enter in the preview closes it and puts the caret
       * there. A page whose text is one long paragraph starting earlier has no
       * target: the caller keeps the preview open and says so.
       */
      pageTarget: guarded((page) =>
        host.read((doc) => {
          const pageCount = doc.pageCount()
          if (!Number.isInteger(page) || page < 0 || page >= pageCount) {
            throw fail('BAD_ARGUMENT', 'page out of range')
          }
          const sections = doc.getSectionCount()
          for (let sec = 0; sec < sections; sec++) {
            const paragraphs = doc.getParagraphCount(sec)
            for (let para = 0; para < paragraphs; para++) {
              const at = parse(doc.getPageOfPosition(sec, para))
              if (!at.ok || !Number.isInteger(at.page)) continue
              if (at.page > page) break
              if (at.page !== page) continue
              return {
                ok: true,
                page,
                target: {
                  kind: 'body_paragraph',
                  section: sec,
                  paragraph: para,
                  charOffset: 0,
                  length: doc.getParagraphLength(sec, para),
                },
              }
            }
          }
          return { ok: false, reason: 'no_paragraph' }
        }),
      ),

      /**
       * The styles of the document by name: paragraph styles (what a format's style takes)
       * and character styles (what its charStyle takes).
       */
      listStyles: guarded(() =>
        host.read((doc) => {
          const styles = parse(doc.getStyleList())
          const named = (type) =>
            styles.filter((style) => style.type === type).map((style) => style.name)
          return { paragraph: named(PARAGRAPH_STYLE), character: named(CHARACTER_STYLE) }
        }),
      ),

      /** One style: its kind, names, the style that follows it, and what it looks like. */
      readStyle: guarded((name) => {
        const wanted = styleNameOf(name, 'name')
        return host.read((doc) => {
          const style = styleNamed(doc, wanted, null)
          if (!style) return noSuchStyle(doc, null)
          const next =
            style.type === PARAGRAPH_STYLE
              ? parse(doc.getStyleList()).find((other) => other.id === style.nextStyleId)
              : null
          return {
            ok: true,
            name: style.name,
            ...(style.englishName ? { englishName: style.englishName } : {}),
            kind: kindOf(style),
            ...(next ? { nextStyle: next.name } : {}),
            look: styleLookOf(doc, style),
          }
        })
      }),

      /**
       * Add a style. It starts from the look of `basedOn` (a style of the document, 바탕글
       * when not given) and takes `format` over that. A paragraph style is followed by
       * itself unless `nextStyle` names another paragraph style, as Hangul makes them. One
       * undo step.
       */
      createStyle: guarded((spec, options) => {
        if (!spec || typeof spec !== 'object') throw fail('BAD_ARGUMENT', 'spec must be an object')
        const name = styleNameOf(spec.name, 'name')
        const englishName =
          spec.englishName == null ? '' : styleNameOf(spec.englishName, 'englishName')
        const kind = spec.kind ?? 'paragraph'
        if (kind !== 'paragraph' && kind !== 'character') {
          throw fail('BAD_ARGUMENT', 'kind must be "paragraph" or "character"')
        }
        const type = kind === 'character' ? CHARACTER_STYLE : PARAGRAPH_STYLE
        if (type === CHARACTER_STYLE && spec.nextStyle != null) {
          throw fail('BAD_ARGUMENT', 'only a paragraph style has a next style')
        }
        const basedOn = spec.basedOn == null ? null : styleNameOf(spec.basedOn, 'basedOn')
        const nextStyle = spec.nextStyle == null ? null : styleNameOf(spec.nextStyle, 'nextStyle')
        const look = styleFormatOf(spec.format, type === PARAGRAPH_STYLE)
        const plan = (doc) => {
          if (styleNameTaken(doc, name) || (englishName && styleNameTaken(doc, englishName))) {
            return { refusal: { ok: false, reason: 'style_exists' } }
          }
          const base = basedOn ? styleNamed(doc, basedOn, null) : parse(doc.getStyleList())[0]
          if (!base) return { refusal: noSuchStyle(doc, null) }
          const next = nextStyle ? styleNamed(doc, nextStyle, PARAGRAPH_STYLE) : null
          if (nextStyle && !next) return { refusal: noSuchStyle(doc) }
          return { base, next }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return change(
          'create-style',
          (doc) => {
            const { base, next } = plan(doc)
            if (!base) throw fail('CHANGED', 'the document changed mid-call')
            const id = doc.createStyle(
              JSON.stringify({
                name,
                englishName,
                type,
                nextStyleId: 0,
                baseParaShapeId: base.paraShapeId,
                baseCharShapeId: base.charShapeId,
              }),
            )
            if (!Number.isInteger(id) || id < 0) throw fail('ENGINE', 'the style could not be made')
            if (
              type === PARAGRAPH_STYLE &&
              !doc.updateStyle(id, JSON.stringify({ nextStyleId: next ? next.id : id }))
            ) {
              throw fail('ENGINE_REFUSED', 'the editor refused to set the next style')
            }
            setStyleLook(doc, id, look)
            return { ok: true, name, kind }
          },
          options,
        )
      }),

      /**
       * Change a style: its names, the style that follows it, and its look (`format`, only
       * what is passed). Paragraphs of the body and of the tables in it that use the style
       * take the new look where they had none of their own; text that already has a
       * character style keeps its former look. One undo step.
       */
      editStyle: guarded((name, spec, options) => {
        const wanted = styleNameOf(name, 'name')
        if (!spec || typeof spec !== 'object') throw fail('BAD_ARGUMENT', 'spec must be an object')
        const rename = spec.name == null ? null : styleNameOf(spec.name, 'the new name')
        const englishName =
          spec.englishName == null ? null : styleNameOf(spec.englishName, 'englishName')
        const nextStyle = spec.nextStyle == null ? null : styleNameOf(spec.nextStyle, 'nextStyle')
        const plan = (doc) => {
          const style = styleNamed(doc, wanted, null)
          if (!style) return { refusal: noSuchStyle(doc, null) }
          const paragraphStyle = style.type === PARAGRAPH_STYLE
          if (nextStyle && !paragraphStyle) {
            throw fail('BAD_ARGUMENT', 'only a paragraph style has a next style')
          }
          const look = styleFormatOf(spec.format, paragraphStyle)
          if (!rename && englishName === null && !nextStyle && !look) {
            throw fail(
              'BAD_ARGUMENT',
              'name nothing to change: name, englishName, nextStyle or format',
            )
          }
          if (
            (rename && styleNameTaken(doc, rename, style.id)) ||
            (englishName && styleNameTaken(doc, englishName, style.id))
          ) {
            return { refusal: { ok: false, reason: 'style_exists' } }
          }
          const next = nextStyle ? styleNamed(doc, nextStyle, PARAGRAPH_STYLE) : null
          if (nextStyle && !next) return { refusal: noSuchStyle(doc) }
          return { style, next, look }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return change(
          'edit-style',
          (doc) => {
            const { style, next, look } = plan(doc)
            if (!style) throw fail('CHANGED', 'the document changed mid-call')
            const names = {
              ...(rename ? { name: rename } : {}),
              ...(englishName !== null ? { englishName } : {}),
              ...(next ? { nextStyleId: next.id } : {}),
            }
            if (
              Object.keys(names).length > 0 &&
              !doc.updateStyle(style.id, JSON.stringify(names))
            ) {
              throw fail('ENGINE_REFUSED', 'the editor refused to change the style')
            }
            setStyleLook(doc, style.id, look)
            return { ok: true, name: rename ?? style.name, kind: kindOf(style) }
          },
          options,
        )
      }),

      /**
       * Change how cells of table `number` (as listTables numbers them) look: their
       * background colour ("none" takes it away), their border lines, and where their text
       * sits between top and bottom, the height of their rows (`heightMm`) and the format of
       * the text in them (`text`, as a style's format: bold, size, font, colour, align …).
       * `cells` names them by row and column, from 1 (a merged
       * cell by any of the places it covers), or is a block `{ fromRow, fromCol, toRow, toCol }`,
       * or is left out for the whole table. `look` is a background alone (a string) or
       * `{ background, borders, verticalAlign }`. A border rule's sides are those of the
       * block; of a list of cells each one is a block of its own. A table inside another
       * table's cell cannot be changed: the engine sets cell properties by table and cell
       * number only.
       */
      formatCells: guarded((number, cells, look, options) => {
        const whole = cells === undefined || cells === null
        const block = !whole && !Array.isArray(cells) && typeof cells === 'object' ? cells : null
        if (block) {
          const corners = [block.fromRow, block.fromCol, block.toRow, block.toCol]
          if (
            !corners.every((value) => Number.isInteger(value) && value >= 1) ||
            block.fromRow > block.toRow ||
            block.fromCol > block.toCol
          ) {
            throw fail(
              'BAD_ARGUMENT',
              'a block needs fromRow, fromCol, toRow and toCol, counted from 1, from the top left to the bottom right',
            )
          }
        } else if (!whole) {
          if (!Array.isArray(cells) || cells.length === 0 || cells.length > MAX_FORMATTED_CELLS) {
            throw fail('BAD_ARGUMENT', `cells must be 1 to ${MAX_FORMATTED_CELLS} places`)
          }
          for (const cell of cells) {
            if (!cell || !Number.isInteger(cell.row) || !Number.isInteger(cell.col)) {
              throw fail('BAD_ARGUMENT', 'each cell needs a row and a col, counted from 1')
            }
          }
        }
        const { props, rules, text, shares, standIns } = cellLookOf(look)
        const plan = (doc) => {
          const found = cellsPlan(doc)
          if (found.refusal || !shares) return found
          const { table } = found
          if (shares.length !== table.cols) {
            return { refusal: { ok: false, reason: 'column_count', cols: table.cols } }
          }
          const columns = columnPlanOf(doc, table, shares)
          if (!columns)
            return { refusal: { ok: false, reason: 'merged_columns', cols: table.cols } }
          return { ...found, columns }
        }
        const cellsPlan = (doc) => {
          const { tables } = tablesOf(doc)
          const table = Number.isInteger(number) ? tables[number - 1] : undefined
          if (!table) {
            return { refusal: { ok: false, reason: 'no_such_table', count: tables.length } }
          }
          if (table.path.length > 1) {
            return { refusal: { ok: false, reason: 'unsupported_place', count: tables.length } }
          }
          const grid = gridOf(doc, table)
          const outside = (missing) => ({
            refusal: {
              ok: false,
              reason: 'no_such_cell',
              cells: missing,
              rows: table.rows,
              cols: table.cols,
            },
          })
          if (whole) {
            return {
              table,
              grid,
              blocks: [{ top: 0, left: 0, bottom: table.rows - 1, right: table.cols - 1 }],
            }
          }
          if (block) {
            if (block.toRow > table.rows || block.toCol > table.cols) {
              return outside([{ row: block.toRow, col: block.toCol }])
            }
            return {
              table,
              grid,
              blocks: [
                {
                  top: block.fromRow - 1,
                  left: block.fromCol - 1,
                  bottom: block.toRow - 1,
                  right: block.toCol - 1,
                },
              ],
            }
          }
          const targets = new Map()
          const missing = []
          for (const want of cells) {
            const place = grid.find(
              (cell) =>
                want.row - 1 >= cell.row &&
                want.row - 1 < cell.row + cell.rowSpan &&
                want.col - 1 >= cell.col &&
                want.col - 1 < cell.col + cell.colSpan,
            )
            if (place) targets.set(place.cell, place)
            else missing.push({ row: want.row, col: want.col })
          }
          if (missing.length > 0) return outside(missing)
          return {
            table,
            grid,
            // each named cell is a block of its own: its edges are its outline
            blocks: [...targets.values()].map((cell) => ({
              top: cell.row,
              left: cell.col,
              bottom: cell.row + cell.rowSpan - 1,
              right: cell.col + cell.colSpan - 1,
            })),
          }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        // the cells of a head table given a row height, for the answer once the change is done
        let sized = null
        return keepingObjects((mustKeep) =>
          change(
            'format-cells',
            (doc) => {
              const { table, grid, blocks, columns } = plan(doc)
              if (!blocks) throw fail('CHANGED', 'the document changed mid-call')
              sized = null
              const before = objectsOf(doc)
              if (columns && columns.updates.length > 0) {
                expectOk(
                  doc.resizeTableCells(
                    table.sec,
                    table.para,
                    table.path[0].controlIndex,
                    JSON.stringify(columns.updates),
                  ),
                  'set the column widths',
                )
              }
              let count = 0
              for (const rect of blocks)
                count += setCellBorders(doc, table, grid, rect, rules, props)
              if (text) {
                const format = resolveFormat(doc, text)
                for (const rect of blocks) formatCellText(doc, table, grid, rect, format)
                // cells whose text alone changed are counted too
                if (count === 0) {
                  count = grid.filter((cell) =>
                    blocks.some(
                      (rect) =>
                        cell.row + cell.rowSpan - 1 >= rect.top &&
                        cell.row <= rect.bottom &&
                        cell.col + cell.colSpan - 1 >= rect.left &&
                        cell.col <= rect.right,
                    ),
                  ).length
                }
              }
              if (count === 0 && columns) count = columns.updates.length
              mustKeep(before, objectsOf(doc))
              // a diagonal runs through the words of its cell: say which cells hold some
              const crossed = []
              if (props.diagonalSlash > 0 || props.diagonalBackSlash > 0) {
                const control = table.path[0].controlIndex
                for (const cell of grid) {
                  const inside = blocks.some(
                    (rect) =>
                      cell.row + cell.rowSpan - 1 >= rect.top &&
                      cell.row <= rect.bottom &&
                      cell.col + cell.colSpan - 1 >= rect.left &&
                      cell.col <= rect.right,
                  )
                  if (!inside) continue
                  const paragraphs = doc.getCellParagraphCount(
                    table.sec,
                    table.para,
                    control,
                    cell.cell,
                  )
                  let length = 0
                  for (let k = 0; k < paragraphs && length === 0; k++) {
                    length += doc.getCellParagraphLength(
                      table.sec,
                      table.para,
                      control,
                      cell.cell,
                      k,
                    )
                  }
                  if (length > 0 && crossed.length < MAX_LISTED_MATCHES) {
                    crossed.push({ row: cell.row + 1, col: cell.col + 1 })
                  }
                }
              }
              if (props.height !== undefined && table.sec === 0 && table.para === 0) {
                sized = {
                  control: table.path[0].controlIndex,
                  cells: grid
                    .filter((cell) =>
                      blocks.some(
                        (rect) =>
                          cell.row + cell.rowSpan - 1 >= rect.top &&
                          cell.row <= rect.bottom &&
                          cell.col + cell.colSpan - 1 >= rect.left &&
                          cell.col <= rect.right,
                      ),
                    )
                    .map((cell) => cell.cell),
                }
              }
              return {
                ok: true,
                count,
                place: { sec: table.sec, para: table.para, offset: 0, length: 0 },
                ...(standIns.length > 0 ? { standIn: standIns } : {}),
                ...(crossed.length > 0 ? { crossed } : {}),
                ...(columns ? { columnWidthsMm: columns.widths } : {}),
              }
            },
            {
              ...options,
              // a head row set lower than its text, once the change raised what it grew:
              // the engine starts the other columns below the stored heights, so over it
              settled: (result, heads) => {
                const measured = sized && heads.get(sized.control)?.measured
                if (!measured || result?.ok !== true) return result
                const overflowing = overflowingRowsOf(measured, sized.cells)
                return overflowing.length > 0 ? { ...result, overflowingRows: overflowing } : result
              },
            },
          ),
        )
      }),

      /**
       * Make or change paragraph styles and give them to paragraphs, in one undo step: the
       * look of a whole document in one call. `spec.styles` are paragraph styles with their
       * look (made from `basedOn`, 바탕글 when not given; a style the document already has by
       * that name is changed instead). `spec.apply` are rules: each gives a style to every
       * body paragraph that starts with `startsWith` (leading spaces aside), or to the one
       * paragraph `find` occurs in (a table cell too). A paragraph takes the first rule that
       * names it. A paragraph given a style of this call takes its whole look, also where it
       * had formatting of its own; one given a style the document already had keeps what it
       * had set differently, as applying a style does. A font this PC is known to lack is
       * written as one of the same kind that it has (`standIn` in the answer).
       */
      styleParagraphs: guarded((spec, options) => {
        const wanted = styleBatchOf(spec)
        const madeHere = new Set(wanted.styles.map((style) => style.name.toLowerCase()))
        const plan = (doc) => {
          // a style may start from one made earlier in the same call: they are made in order
          const earlier = new Set()
          for (const style of wanted.styles) {
            const found = styleNamed(doc, style.name, null)
            if (found && found.type !== PARAGRAPH_STYLE) {
              return { refusal: { ok: false, reason: 'style_exists' } }
            }
            if (
              !found &&
              style.basedOn &&
              !earlier.has(style.basedOn.toLowerCase()) &&
              !styleNamed(doc, style.basedOn, null)
            ) {
              return { refusal: noSuchStyle(doc, null) }
            }
            earlier.add(style.name.toLowerCase())
          }
          for (const rule of wanted.rules) {
            if (!madeHere.has(rule.style.toLowerCase()) && styleIdOf(doc, rule.style) === null) {
              return { refusal: noSuchStyle(doc) }
            }
          }
          const taken = new Set()
          const targets = []
          const counts = wanted.rules.map(() => 0)
          const take = (index, hit, key) => {
            if (taken.has(key)) return
            taken.add(key)
            targets.push({ rule: index, hit })
            counts[index] += 1
          }
          // the rules that name one paragraph first: a paragraph takes the first rule that
          // names it, and a named paragraph is meant more exactly than one told by its start
          for (const [index, rule] of wanted.rules.entries()) {
            if (rule.find === null) continue
            const hits = searchAll(doc, rule.find)
            const picked = pickHit(hits, rule.occurrence)
            const reason = !picked.hit
              ? picked.reason
              : !isReplaceable(picked.hit) || !containerOf(doc, picked.hit).applyStyle
                ? 'unsupported_place'
                : null
            if (reason) {
              return {
                refusal: {
                  ok: false,
                  reason,
                  find: rule.find,
                  count: hits.length,
                  ...(reason === 'ambiguous' ? { matches: listMatches(doc, hits) } : {}),
                },
              }
            }
            const path = cellPathOf(picked.hit)
            take(
              index,
              { sec: picked.hit.sec, para: picked.hit.para, ...(path ? { cellPath: path } : {}) },
              JSON.stringify([picked.hit.sec, picked.hit.para, path]),
            )
          }
          const starts = wanted.rules
            .map((rule, index) => ({
              index,
              text: rule.startsWith,
              mark: rule.numbered ? NUMBERED_MARKS[rule.numbered] : null,
            }))
            .filter((rule) => rule.text !== null || rule.mark !== null)
          if (starts.length > 0) {
            const sections = doc.getSectionCount()
            for (let sec = 0; sec < sections; sec++) {
              const paragraphs = doc.getParagraphCount(sec)
              for (let para = 0; para < paragraphs; para++) {
                const length = doc.getParagraphLength(sec, para)
                if (length <= 0) continue
                const head = doc
                  .getTextRange(sec, para, 0, Math.min(length, MAX_STARTS_WITH * 3))
                  // the controls a paragraph holds (its section definition, a table) come
                  // before its words without being part of them
                  .replace(LEADING_CONTROLS, '')
                const rule = starts.find((candidate) =>
                  candidate.mark ? candidate.mark.test(head) : head.startsWith(candidate.text),
                )
                if (rule) take(rule.index, { sec, para }, JSON.stringify([sec, para, null]))
                if (targets.length > MAX_STYLED_PARAGRAPHS) {
                  return {
                    refusal: { ok: false, reason: 'too_many', limit: MAX_STYLED_PARAGRAPHS },
                  }
                }
              }
            }
          }
          return { targets, counts }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'style-paragraphs',
            (doc) => {
              const before = objectsOf(doc)
              let made = 0
              let changed = 0
              // the styles first: the rules name them
              const looks = new Map()
              for (const style of wanted.styles) {
                const found = styleNamed(doc, style.name, PARAGRAPH_STYLE)
                let id = found?.id
                if (found) changed += 1
                else {
                  const base = style.basedOn
                    ? styleNamed(doc, style.basedOn, null)
                    : parse(doc.getStyleList())[0]
                  if (!base) throw fail('CHANGED', 'the document changed mid-call')
                  id = doc.createStyle(
                    JSON.stringify({
                      name: style.name,
                      englishName: '',
                      type: PARAGRAPH_STYLE,
                      nextStyleId: 0,
                      baseParaShapeId: base.paraShapeId,
                      baseCharShapeId: base.charShapeId,
                    }),
                  )
                  if (!Number.isInteger(id) || id < 0) {
                    throw fail('ENGINE', 'the style could not be made')
                  }
                  if (!doc.updateStyle(id, JSON.stringify({ nextStyleId: id }))) {
                    throw fail('ENGINE_REFUSED', 'the editor refused to set the next style')
                  }
                  made += 1
                }
                setStyleLook(doc, id, style.look)
                if (
                  style.keepWithNext !== null &&
                  !doc.updateStyleShapes(
                    id,
                    '{}',
                    JSON.stringify({ keepWithNext: style.keepWithNext }),
                  )
                ) {
                  throw fail('ENGINE_REFUSED', 'the editor refused to change the style')
                }
                looks.set(style.name.toLowerCase(), {
                  id,
                  format: style.look ? resolveFormat(doc, style.look) : null,
                })
              }
              const { targets, counts } = plan(doc)
              if (!targets) throw fail('CHANGED', 'the document changed mid-call')
              let keptOwnLook = 0
              const marks = []
              for (const target of targets) {
                const rule = wanted.rules[target.rule]
                const own = looks.get(rule.style.toLowerCase())
                const id = own ? own.id : styleIdOf(doc, rule.style)
                if (id === null || id === undefined) throw fail('CHANGED', 'the style is gone')
                const box = containerOf(doc, target.hit)
                const k = box.index
                const length = box.length(k)
                if (!own && keepsOwnLook(doc, box, k) === true) keptOwnLook += 1
                box.applyStyle(k, id)
                // a style of this call is its look: what the paragraph had of its own goes
                if (own?.format) {
                  if (own.format.paragraph) box.formatParagraph(k, own.format.paragraph)
                  if (own.format.chars && length > 0) {
                    box.formatChars(k, 0, length, own.format.chars)
                  }
                }
                marks.push(box.place(k, length))
              }
              mustKeep(before, objectsOf(doc))
              return {
                ok: true,
                made,
                changed,
                paragraphs: targets.length,
                rules: wanted.rules.map((rule, index) => ({
                  style: rule.style,
                  paragraphs: counts[index],
                })),
                ...(marks.length > 0 ? { place: marks[0], marks } : {}),
                ...(keptOwnLook > 0 ? { keptOwnLook } : {}),
                ...(wanted.standIns.length > 0 ? { standIn: wanted.standIns } : {}),
              }
            },
            options,
          ),
        )
      }),

      /**
       * Turn the body paragraph `find` occurs in into a title box: a one-column table as
       * wide as the text, in that paragraph, holding its words centred. `spec.look` is one
       * of TITLE_BOX_LOOKS (bands of colour above and below, heavy lines above and below, a
       * line all round, or a fill), `color` and `color2` its colours, and `font`, `size`,
       * `bold` and `textColor` the title's look over the one it has now. The table is a new
       * object of the document; nothing that was there may be gone. One undo step.
       */
      insertTitleBox: guarded((find, occurrence, spec, options) => {
        const wanted = titleBoxOf(spec)
        const plan = (doc) => {
          const hits = searchAll(doc, find)
          const picked = pickHit(hits, occurrence)
          const refuse = (reason, more = {}) => ({
            refusal: {
              ok: false,
              reason,
              count: hits.length,
              ...(reason === 'ambiguous' ? { matches: listMatches(doc, hits) } : {}),
              ...more,
            },
          })
          if (!picked.hit) return refuse(picked.reason)
          if (!isReplaceable(picked.hit)) return refuse('unsupported_place')
          if (cellPathOf(picked.hit)) {
            const { sec, para } = picked.hit
            const { table } = tableNumberOf(doc, sec, para, cellPathOf(picked.hit)[0].controlIndex)
            return refuse('in_table', table ? { table } : {})
          }
          const box = containerOf(doc, picked.hit)
          if (holdsContentObject(doc, picked.hit.sec, box)) return refuse('has_objects')
          const length = box.length(box.index)
          const text = box.text(box.index, length)
          if (!text.trim()) return refuse('not_found')
          const { sec, para } = box.place(box.index, 0)
          // the number Hangul puts in front of the paragraph would stay on an empty line
          // above the box
          if (NUMBERED_HEADS.has(parse(doc.getParaPropertiesAt(sec, para)).headType))
            return refuse('numbered')
          const columns = columnsAt(doc, sec, para, { line: true })
          if (!columns) return refuse('columns_unknown')
          return { box, text, length, columns }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'insert-title-box',
            (doc) => {
              const { box, text, length, columns } = plan(doc)
              if (!box) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              const k = box.index
              const { sec } = box.place(k, 0)
              // the look the title has now goes into the box with it
              const now = parse(doc.getCharPropertiesAt(sec, k, 0))
              const points = Number(now.fontSize) / 100
              const look = formatOf(
                {
                  ...(typeof now.fontFamily === 'string' && now.fontFamily
                    ? { font: now.fontFamily }
                    : {}),
                  ...(points >= MIN_FONT_PT && points <= MAX_FONT_PT ? { size: points } : {}),
                  bold: now.bold === true,
                  ...(typeof now.textColor === 'string' && HEX_COLOR.test(now.textColor)
                    ? { color: now.textColor }
                    : {}),
                  ...(wanted.text ?? {}),
                },
                false,
              )
              const whitened = wanted.fillUnderOwnColour
                ? textColorOnFill(wanted.fillUnderOwnColour, look.chars?.textColor)
                : null
              if (whitened) look.chars = { ...look.chars, textColor: whitened }
              const titlePoints = look.chars?.fontSize ? look.chars.fontSize / 100 : points
              box.deleteText(k, length)
              const layout = titleBoxCells(wanted.look, wanted.color, wanted.color2)
              // where the text runs in columns the box is as wide as one of them
              const inColumns = columns.count > 1
              const made = parse(
                doc.createTableEx(
                  JSON.stringify({
                    sectionIdx: sec,
                    paraIdx: k,
                    charOffset: 0,
                    rowCount: layout.rows,
                    colCount: 1,
                    treatAsChar: true,
                    ...(inColumns
                      ? {
                          colWidths: [
                            Math.round(
                              Math.min(columns.widthPt, columns.lineWidthPt ?? Infinity) * 100,
                            ),
                          ],
                        }
                      : {}),
                  }),
                ),
              )
              if (!made || made.ok !== true || !Number.isInteger(made.controlIdx)) {
                throw fail('ENGINE', 'the title box could not be made')
              }
              const control = made.controlIdx
              if (inColumns) {
                // the box stands its outer margins further in than its line starts: as wide
                // as the line less them, it ends inside the column
                const { outerLeft, outerRight } = parse(doc.getTableProperties(sec, k, control))
                const margins = (outerLeft ?? 0) + (outerRight ?? 0)
                if (margins > 0) {
                  expectOk(
                    doc.resizeTableCells(
                      sec,
                      k,
                      control,
                      JSON.stringify(
                        layout.cells.map((_, cellIdx) => ({ cellIdx, widthDelta: -margins })),
                      ),
                    ),
                    'fit the title box in its column',
                  )
                }
              }
              // a title cell as high as its lines and some air: the engine does not grow a
              // row whose height is set, so the height follows the lines the title takes
              const titleHeight = (lines, spacing) =>
                Math.round(titlePoints * 100 * (1.9 + spacing * (lines - 1)))
              layout.cells.forEach((props, cell) => {
                const shape =
                  cell === layout.title ? { ...props, height: titleHeight(1, 0) } : props
                expectOk(
                  doc.setCellProperties(sec, k, control, cell, JSON.stringify(shape)),
                  'shape the title box',
                )
              })
              expectOk(
                doc.insertTextInCell(sec, k, control, layout.title, 0, 0, text),
                'write the title',
              )
              const written = doc.getCellParagraphLength(sec, k, control, layout.title, 0)
              const { chars } = resolveFormat(doc, look)
              if (chars && written > 0) {
                expectOk(
                  doc.applyCharFormatInCell(sec, k, control, layout.title, 0, 0, written, chars),
                  'format the title',
                )
              }
              expectOk(
                doc.applyParaFormatInCell(
                  sec,
                  k,
                  control,
                  layout.title,
                  0,
                  JSON.stringify({ alignment: 'center' }),
                ),
                'centre the title',
              )
              // a band is as high as its empty paragraph lets it be: make that one tiny
              for (const cell of layout.bands) {
                expectOk(
                  doc.applyCharFormatInCell(
                    sec,
                    k,
                    control,
                    cell,
                    0,
                    0,
                    0,
                    JSON.stringify({ fontSize: 100 }),
                  ),
                  'shape the band',
                )
                expectOk(
                  doc.applyParaFormatInCell(
                    sec,
                    k,
                    control,
                    cell,
                    0,
                    JSON.stringify({ lineSpacing: 100, lineSpacingType: 'Percent' }),
                  ),
                  'shape the band',
                )
              }
              const lines = parse(
                doc.getLineInfoInCell(sec, k, control, layout.title, 0, 0),
              ).lineCount
              if (Number.isInteger(lines) && lines > 1) {
                const para = parse(doc.getCellParaPropertiesAt(sec, k, control, layout.title, 0))
                const spacing =
                  para.lineSpacingType === 'Percent' && para.lineSpacing > 0
                    ? para.lineSpacing / 100
                    : 1.6
                expectOk(
                  doc.setCellProperties(
                    sec,
                    k,
                    control,
                    layout.title,
                    JSON.stringify({ height: titleHeight(lines, spacing) }),
                  ),
                  'fit the title box to its title',
                )
              }
              const after = objectsOf(doc)
              // the box is an object of its own; nothing that was there may be gone
              mustKeep(before, { ...after, controls: Math.min(after.controls, before.controls) })
              return {
                ok: true,
                look: wanted.look,
                rows: layout.rows,
                place: box.place(k, 0),
                ...tableNumberOf(doc, sec, k, control),
                ...(wanted.textColorDropped ? { textColorDropped: true } : {}),
                ...(whitened ? { textColor: whitened } : {}),
                ...(wanted.standIns.length > 0 ? { standIn: wanted.standIns } : {}),
              }
            },
            options,
          ),
        )
      }),

      /**
       * Which of the fonts Korean documents are written in this PC has and lacks, when the
       * editor knows its fonts (`known`); for the AI to pick a look it can show.
       */
      documentFonts: guarded(() => {
        const onPc = []
        const missing = []
        for (const name of DOCUMENT_FONTS) {
          const has = fontOnPc(name)
          if (has === true) onPc.push(name)
          else if (has === false) missing.push(name)
        }
        return { known: onPc.length + missing.length > 0, onPc, missing }
      }),

      /** How many pages the document has as the editor lays it out now. */
      pageCount: guarded(() => host.read((doc) => doc.pageCount())),

      /**
       * The page number, header and footer of the document (its first section): the page
       * number's place, shape and dashes, and the text of the header and of the footer with
       * `plain` saying whether setHeaderFooter may rewrite it; and the page map (pageMapOf).
       * The pages are counted and mapped with the widths print and checkLayout use.
       */
      pageLayout: guarded(() =>
        host.read((doc) => {
          const read = (isHeader) => {
            const found = parse(doc.getHeaderFooter(0, isHeader, 0))
            if (found.exists !== true) return { exists: false }
            const plain = plainHeader(found)
            return {
              exists: true,
              text: headerTextOf(found.text),
              plain,
              ...(plain ? headerLookOf(doc, isHeader, String(found.text ?? '')) : {}),
            }
          }
          let pageNumber = null
          try {
            pageNumber = pageNumberSettingOf(parse(doc.getPageNumberPos(0)).pageNumber)
          } catch {
            // an engine without the call: the page number is not known
          }
          const columns = columnsOf(doc, 0)
          const { pages, map } = withPrintWidths(doc, screenFonts(), () => ({
            pages: doc.pageCount(),
            map: pageMapOf(doc),
          }))
          let pageBorder = null
          try {
            const line = parse(doc.getPageBorderFill(0)).borderTop
            const name = Object.keys(BORDER_LINES).find((key) => BORDER_LINES[key] === line?.type)
            pageBorder = name && name !== 'none' ? { line: name, color: line.color } : null
          } catch {
            // an engine without the call: the border is not known
          }
          return {
            sections: doc.getSectionCount(),
            pages,
            pageBorder,
            columns: {
              count: columns.count,
              gapMm: Math.round(((columns.gapPt * 25.4) / 72) * 10) / 10,
              ...(columns.line ? { line: columns.line } : {}),
              ...(columnsChangeWithin(doc) ? { changesWithin: true } : {}),
            },
            pageNumber,
            header: read(true),
            footer: read(false),
            map,
          }
        }),
      ),

      /**
       * Lay the body text out in columns (Hangul's 다단): `spec.count` columns of one width
       * with `spec.gapMm` between them, in every section; one column takes the columns
       * away. `spec.line` draws a thin line between the columns (COLUMN_LINES; "none" takes
       * it away, and without it the line stays as it is). Tables that are already there keep
       * their width, so it is called before the tables are made. One undo step.
       */
      setColumns: guarded((spec, options) => {
        const given = spec ?? {}
        const count = typeof given === 'object' ? given.count : null
        if (!Number.isInteger(count) || count < 1 || count > MAX_COLUMNS) {
          throw fail('BAD_ARGUMENT', `count must be a whole number from 1 to ${MAX_COLUMNS}`)
        }
        const gapMm = given.gapMm ?? DEFAULT_COLUMN_GAP_MM
        if (typeof gapMm !== 'number' || !(gapMm >= 0 && gapMm <= MAX_COLUMN_GAP_MM)) {
          throw fail('BAD_ARGUMENT', `gapMm must be 0 to ${MAX_COLUMN_GAP_MM} millimetres`)
        }
        const gap = count > 1 ? Math.round((gapMm * 7200) / 25.4) : 0
        const lineName = given.line ?? null
        if (lineName !== null && !COLUMN_LINES.includes(lineName)) {
          throw fail('BAD_ARGUMENT', `line must be one of ${COLUMN_LINES.join(', ')}`)
        }
        if (count === 1 && lineName !== null && lineName !== 'none') {
          throw fail(
            'BAD_ARGUMENT',
            'a line is drawn between columns, and count 1 leaves none: leave line out, or give count 2 or more',
          )
        }
        const line = lineName === null ? null : borderRuleOf({ line: lineName }).line
        const done = change(
          'set-columns',
          (doc) => {
            const sections = doc.getSectionCount()
            const was = columnsOf(doc, 0).count
            for (let sec = 0; sec < sections; sec++) {
              expectOk(doc.setColumnDef(sec, count, 0, 1, gap), 'set the columns')
              if (line) {
                expectOk(
                  doc.setColumnSeparator(sec, JSON.stringify(line)),
                  'draw the line between the columns',
                )
              }
            }
            return {
              ok: true,
              count,
              gapMm: count > 1 ? gapMm : 0,
              was,
              sections,
              ...(lineName !== null ? { line: lineName } : keptLine(doc)),
            }
          },
          options,
        )
        if (!done.ok || count === 1) return done
        const wide = host.read((doc) => tablesWiderThanColumn(doc))
        return wide.length > 0 ? { ...done, wide } : done
      }),

      /**
       * Draw a line round every page (Hangul's 쪽 테두리), inside the margins, in every
       * section: a certificate, a cover, a notice to post. `spec` is `{ line, width, color }`
       * as a cell's border line is told; line "none" takes the border away. One undo step.
       */
      setPageBorder: guarded((spec, options) => {
        const given = spec ?? {}
        if (typeof given !== 'object' || Array.isArray(given)) {
          throw fail('BAD_ARGUMENT', 'the page border must be an object: { line, width, color }')
        }
        let line
        try {
          line = borderRuleOf({ line: given.line, width: given.width, color: given.color }).line
        } catch (thrown) {
          throw fail('BAD_ARGUMENT', thrown.message)
        }
        const border = JSON.stringify({
          borderLeft: line,
          borderRight: line,
          borderTop: line,
          borderBottom: line,
        })
        return change(
          'set-page-border',
          (doc) => {
            const sections = doc.getSectionCount()
            for (let sec = 0; sec < sections; sec++) {
              expectOk(doc.setPageBorderFill(sec, border), 'set the page border')
            }
            return { ok: true, sections, drawn: line.type !== BORDER_LINES.none }
          },
          options,
        )
      }),

      /**
       * Put equations into the body text (Hangul's 수식): each item names text of the
       * document (`find`, with `occurrence` when it occurs more than once) and the
       * equation's script in Hangul's equation language. The equation takes the place of
       * that text (a placeholder the text was written with) unless `replace` is false, when
       * it goes right after it. It is as large as the text it stands in. Text in a table
       * cell is refused: the engine puts equations into body paragraphs. One undo step.
       */
      insertEquations: guarded((items, options) => {
        if (!Array.isArray(items) || items.length === 0 || items.length > MAX_EQUATIONS) {
          throw fail('BAD_ARGUMENT', `equations must be 1 to ${MAX_EQUATIONS} items`)
        }
        const wanted = items.map((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw fail('BAD_ARGUMENT', 'each equation needs find and script')
          }
          const script = typeof item.script === 'string' ? item.script.trim() : ''
          if (!script || script.length > MAX_EQUATION_SCRIPT || CONTROL_CHARS.test(script)) {
            throw fail(
              'BAD_ARGUMENT',
              `script must be one line of 1 to ${MAX_EQUATION_SCRIPT} characters`,
            )
          }
          if (typeof item.find !== 'string' || !item.find || CONTROL_CHARS.test(item.find)) {
            throw fail('BAD_ARGUMENT', 'find must be text of one paragraph')
          }
          return {
            find: item.find,
            occurrence: item.occurrence ?? null,
            script,
            replace: item.replace !== false,
          }
        })
        const plan = (doc) => {
          const targets = []
          for (const [index, item] of wanted.entries()) {
            const hits = searchAll(doc, item.find)
            const picked = pickHit(hits, item.occurrence)
            const refuse = (reason) => ({
              refusal: {
                ok: false,
                reason,
                index,
                find: item.find,
                count: hits.length,
                ...(reason === 'ambiguous' ? { matches: listMatches(doc, hits) } : {}),
              },
            })
            if (!picked.hit) return refuse(picked.reason)
            if (!isReplaceable(picked.hit)) return refuse('unsupported_place')
            if (cellPathOf(picked.hit)) return refuse('in_table')
            targets.push({ item, hit: picked.hit })
          }
          return { targets }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'insert-equations',
            (doc) => {
              const { targets } = plan(doc)
              if (!targets) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              // from the end of the document backwards: an equation put in moves nothing
              // that is still to be done
              const ordered = [...targets].sort(
                (a, b) =>
                  b.hit.sec - a.hit.sec ||
                  b.hit.para - a.hit.para ||
                  b.hit.charOffset - a.hit.charOffset,
              )
              const marks = []
              for (const { item, hit } of ordered) {
                // as large as the text it stands in, in hundredths of a point
                const chars = parse(doc.getCharPropertiesAt(hit.sec, hit.para, hit.charOffset))
                const size = Number.isFinite(chars?.fontSize) ? chars.fontSize : 1000
                let at = hit.charOffset + hit.length
                if (item.replace) {
                  expectOk(
                    doc.deleteText(hit.sec, hit.para, hit.charOffset, hit.length),
                    'take the placeholder out',
                  )
                  at = hit.charOffset
                }
                const made = parse(doc.insertEquation(hit.sec, hit.para, at, item.script, size, 0))
                if (!made || made.ok !== true) {
                  throw fail('ENGINE', 'the equation could not be made')
                }
                marks.push({ sec: hit.sec, para: hit.para, offset: at, length: 1 })
              }
              // the equations are objects of their own; nothing that was there may be gone
              mustKeep({ ...before, controls: before.controls + ordered.length }, objectsOf(doc))
              return { ok: true, count: ordered.length, place: marks.at(-1), marks }
            },
            options,
          ),
        )
      }),

      /**
       * Give a picture of the body text (its number from listPictures) another width,
       * its height following so that it keeps its shape. A picture inside a table cell is
       * refused, and one wider than the text is made as wide as the text. One undo step.
       */
      resizePicture: guarded((number, spec, options) => {
        if (!Number.isInteger(number) || number < 1) {
          throw fail('BAD_ARGUMENT', 'picture must be a positive integer from listPictures')
        }
        const mm = spec?.widthMm
        const { min, max } = PICTURE_WIDTH_MM
        if (typeof mm !== 'number' || !(mm >= min && mm <= max)) {
          throw fail('BAD_ARGUMENT', `widthMm must be ${min} to ${max} millimetres`)
        }
        const picture = pictureList()[number - 1]
        if (!picture) return { ok: false, reason: 'no_such_picture', count: pictureList().length }
        if (picture.cellPath) return { ok: false, reason: 'unsupported_place', count: 1 }
        return change(
          'resize-picture',
          (doc) => {
            const now = parse(doc.getPictureProperties(picture.sec, picture.para, picture.control))
            if (!(now?.width > 0) || !(now?.height > 0)) {
              throw fail('ENGINE', 'the size of the picture could not be read')
            }
            // no wider than the text of its page
            const room = Math.round(textWidthPt(doc, picture.sec) * 100)
            const width = Math.min(Math.round((mm * 7200) / 25.4), room)
            const height = Math.max(1, Math.round((now.height * width) / now.width))
            expectOk(
              doc.setPictureProperties(
                picture.sec,
                picture.para,
                picture.control,
                JSON.stringify({ width, height }),
              ),
              'resize the picture',
            )
            const toMm = (units) => Math.round(((units * 25.4) / 7200) * 10) / 10
            return {
              ok: true,
              widthMm: toMm(width),
              heightMm: toMm(height),
              fitted: width === room && width < Math.round((mm * 7200) / 25.4),
              place: { sec: picture.sec, para: picture.para, offset: 0, length: 0 },
            }
          },
          options,
        )
      }),

      /**
       * Start the body paragraph `find` occurs in on a new page or in the next column
       * (`kind`, one of BREAK_KINDS), as Hangul's 쪽 나누기 and 단 나누기 do in front of a
       * paragraph. A paragraph inside a table, and the first one of the document, cannot
       * start anew. The break is put on the paragraph itself: no empty paragraph is left in
       * front of it, except one behind a table, which keeps the table's paragraph as it was
       * laid out; a numbering restart the paragraph had is set on it again. One that
       * starts a page already (or a column, when a column is asked for) is left as it is and
       * answered `already`; one that starts a part of the document with other columns is
       * refused, since the break would take that start away (breakOutcome), and so is one
       * that holds a mark of its place (`holds_mark`), which would move a page up. One undo
       * step.
       */
      insertBreak: guarded((find, occurrence, kind, options) => {
        if (!BREAK_KINDS.includes(kind)) {
          throw fail('BAD_ARGUMENT', `kind must be one of ${BREAK_KINDS.join(', ')}`)
        }
        const plan = (doc) => {
          const hits = searchAll(doc, find)
          const picked = pickHit(hits, occurrence)
          const refuse = (reason) => ({
            refusal: {
              ok: false,
              reason,
              count: hits.length,
              ...(reason === 'ambiguous' ? { matches: listMatches(doc, hits) } : {}),
            },
          })
          if (!picked.hit) return refuse(picked.reason)
          if (!isReplaceable(picked.hit)) return refuse('unsupported_place')
          if (cellPathOf(picked.hit)) return refuse('in_table')
          // the first paragraph already starts its page, and holds the page setup
          if (picked.hit.para === 0) return refuse('at_start')
          return { hit: picked.hit }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        try {
          return keepingObjects((mustKeep) =>
            change(
              'insert-break',
              (doc) => {
                const { hit } = plan(doc)
                if (!hit) throw fail('CHANGED', 'the document changed mid-call')
                const before = objectsOf(doc)
                // the join below lays the paragraph in front out again, and the line of a
                // table's paragraph then takes the height the table has now. The engine keeps
                // that line when a cell is emptied later, and moves the table to the next
                // page though it fits (docs/tracking/findings.md). An empty paragraph between
                // the two takes the join instead, and stays behind the table.
                let para = hit.para
                if (holdsTable(doc, hit.sec, para - 1)) {
                  expectOk(doc.insertParagraph(hit.sec, para), 'keep the table apart')
                  para += 1
                }
                const controlsInFront = () =>
                  parse(doc.getControlTextPositions(hit.sec, para - 1)).length
                const inFrontBefore = controlsInFront()
                const made = parse(
                  kind === 'page'
                    ? doc.insertPageBreak(hit.sec, para, 0)
                    : doc.insertColumnBreak(hit.sec, para, 0),
                )
                if (!made || made.ok !== true) throw fail('ENGINE', 'the break could not be made')
                // the engine splits the paragraph at its start and puts the break on the
                // second half. The empty first half keeps the break the paragraph had, and
                // every call would leave one more empty paragraph (a second call an empty
                // page). Joined to the paragraph in front, it is gone, and the engine's
                // answer says which break it carried: the only way to read a paragraph's.
                const joined = parse(doc.mergeParagraph(hit.sec, para))
                if (!joined || joined.ok !== true) {
                  throw fail('ENGINE', 'the break could not be made')
                }
                const outcome = breakOutcome(joined.removedParaMeta, kind)
                // the first half also keeps what the engine ties to the place of a paragraph
                // (a page number that starts anew, a hidden page number, a bookmark), and
                // the join hands it to the paragraph in front: one page too early
                const marksLeftBehind = controlsInFront() !== inFrontBefore
                const unchangedAnswer = outcome.already
                  ? { ok: true, kind, already: outcome.already }
                  : outcome.refuse || marksLeftBehind
                    ? { ok: false, reason: outcome.refuse ?? 'holds_mark', count: 1 }
                    : null
                if (unchangedAnswer) {
                  const unchanged = fail('BREAK_NOT_MADE', 'the paragraph is left as it is')
                  unchanged.answer = unchangedAnswer
                  throw unchanged
                }
                if (outcome.restart) {
                  expectOk(
                    doc.setNumberingRestart(hit.sec, para, ...outcome.restart),
                    'keep the numbering of the paragraph',
                  )
                }
                mustKeep(before, objectsOf(doc))
                return {
                  ok: true,
                  kind,
                  columns: columnsOf(doc, hit.sec).count,
                  place: {
                    sec: hit.sec,
                    para,
                    offset: 0,
                    length: doc.getParagraphLength(hit.sec, para),
                  },
                }
              },
              options,
            ),
          )
        } catch (thrown) {
          if (thrown?.code !== 'BREAK_NOT_MADE') throw thrown
          return thrown.answer
        }
      }),

      /**
       * Number the pages (Hangul's 쪽 번호 매기기): where the number goes (`position`, a
       * name of PAGE_NUMBER_PLACES; "none" hides it), its shape (`format`, default digit)
       * and whether it has dashes around it (`dashes`, default true: - 1 -). Set in the first
       * section, from where it holds for the document, and in each later section that has a
       * page number of its own. One undo step.
       */
      setPageNumber: guarded((spec, options) => {
        const given = spec ?? {}
        if (typeof given !== 'object' || !Object.hasOwn(PAGE_NUMBER_PLACES, given.position)) {
          throw fail(
            'BAD_ARGUMENT',
            `position must be one of ${Object.keys(PAGE_NUMBER_PLACES).join(', ')}`,
          )
        }
        const shape = given.format ?? 'digit'
        if (!Object.hasOwn(PAGE_NUMBER_SHAPES, shape)) {
          throw fail(
            'BAD_ARGUMENT',
            `format must be one of ${Object.keys(PAGE_NUMBER_SHAPES).join(', ')}`,
          )
        }
        if (
          given.dashes !== undefined &&
          given.dashes !== null &&
          typeof given.dashes !== 'boolean'
        ) {
          throw fail('BAD_ARGUMENT', 'dashes must be true or false')
        }
        const position = PAGE_NUMBER_PLACES[given.position]
        const format = PAGE_NUMBER_SHAPES[shape]
        const dash = given.dashes !== false
        return change(
          'set-page-number',
          (doc) => {
            const sections = doc.getSectionCount()
            let set = 0
            for (let sec = 0; sec < sections; sec++) {
              if (sec > 0 && parse(doc.getPageNumberPos(sec)).pageNumber == null) continue
              expectOk(doc.setPageNumberPos(sec, format, position, dash), 'number the pages')
              set += 1
            }
            return {
              ok: true,
              sections: set,
              pageNumber: pageNumberSettingOf({ format, position, dash }),
            }
          },
          options,
        )
      }),

      /**
       * Write the header or the footer of the document (its first section, on every page):
       * one line of text, in which `{page}` is the page number and `{pages}` the number of
       * pages. `spec.align` is left, center or right (left out, a line that is there keeps
       * its alignment and a new one is centred), and `spec.size` the font size in points. An
       * empty text removes it. A header or footer that holds more than one line
       * of text and fields (a table, a picture, several paragraphs) was laid out by hand and
       * is refused (`not_plain`). One undo step.
       */
      setHeaderFooter: guarded((kind, spec, options) => {
        if (kind !== 'header' && kind !== 'footer') {
          throw fail('BAD_ARGUMENT', 'kind must be "header" or "footer"')
        }
        const given = spec ?? {}
        if (typeof given !== 'object' || typeof given.text !== 'string') {
          throw fail('BAD_ARGUMENT', 'text must be a string; an empty one removes it')
        }
        const text = given.text
        if (text.length > MAX_HEADER_TEXT || CONTROL_CHARS.test(text)) {
          throw fail(
            'BAD_ARGUMENT',
            `text must be one line of at most ${MAX_HEADER_TEXT} characters`,
          )
        }
        const align = given.align ?? null
        if (align !== null && !TABLE_ALIGNS.includes(align)) {
          throw fail('BAD_ARGUMENT', `align must be one of ${TABLE_ALIGNS.join(', ')}`)
        }
        let size = null
        if (given.size !== undefined && given.size !== null) {
          if (
            typeof given.size !== 'number' ||
            !(given.size >= MIN_FONT_PT && given.size <= MAX_FONT_PT)
          ) {
            throw fail('BAD_ARGUMENT', `size must be ${MIN_FONT_PT} to ${MAX_FONT_PT} points`)
          }
          size = given.size
        }
        const isHeader = kind === 'header'
        const plan = (doc) => {
          const found = parse(doc.getHeaderFooter(0, isHeader, 0))
          const exists = found.exists === true
          if (exists && !plainHeader(found)) return { refusal: { ok: false, reason: 'not_plain' } }
          if (!exists && text === '') return { refusal: { ok: false, reason: 'not_there' } }
          return { exists, old: String(found.text ?? '') }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return change(
          'set-header-footer',
          (doc) => {
            const { exists, old, refusal: why } = plan(doc)
            if (why) throw fail('CHANGED', 'the document changed mid-call')
            if (text === '') {
              expectOk(doc.deleteHeaderFooter(0, isHeader, 0), `remove the ${kind}`)
              return { ok: true, kind, removed: true }
            }
            if (!exists) expectOk(doc.createHeaderFooter(0, isHeader, 0), `make the ${kind}`)
            else if (old.length > 0) {
              expectOk(
                doc.deleteTextInHeaderFooter(0, isHeader, 0, 0, 0, old.length),
                `clear the ${kind}`,
              )
            }
            let offset = 0
            for (const piece of headerPieces(text)) {
              const done = parse(
                piece.field
                  ? doc.insertFieldInHf(0, isHeader, 0, 0, offset, piece.field)
                  : doc.insertTextInHeaderFooter(0, isHeader, 0, 0, offset, piece.text),
              )
              if (!done || done.ok !== true || !Number.isInteger(done.charOffset)) {
                throw fail('ENGINE_REFUSED', `the editor refused to write the ${kind}`)
              }
              offset = done.charOffset
            }
            if (align !== null || !exists) {
              expectOk(
                doc.applyParaFormatInHf(
                  0,
                  isHeader,
                  0,
                  0,
                  JSON.stringify({ alignment: align ?? 'center' }),
                ),
                `align the ${kind}`,
              )
            }
            if (size !== null && offset > 0) {
              expectOk(
                doc.applyCharFormatInHeaderFooter(
                  0,
                  isHeader,
                  0,
                  0,
                  0,
                  0,
                  offset,
                  JSON.stringify({ fontSize: Math.round(size * 100) }),
                ),
                `format the ${kind}`,
              )
            }
            return { ok: true, kind, removed: false, text }
          },
          options,
        )
      }),

      /**
       * Merge the cells of table `number` from one corner to the other (rows and columns
       * from 1, both corners included) into one cell; their text goes into it one cell after
       * another, as Hangul merges. A merged cell must lie wholly inside the range or wholly
       * outside it. Cells of a table inside another table's cell cannot be merged here.
       */
      mergeCells: guarded((number, from, to, options) => {
        const corner = (at) =>
          at && Number.isInteger(at.row) && Number.isInteger(at.col) && at.row >= 1 && at.col >= 1
        if (!corner(from) || !corner(to)) {
          throw fail('BAD_ARGUMENT', 'from and to need a row and a col, counted from 1')
        }
        const top = Math.min(from.row, to.row) - 1
        const bottom = Math.max(from.row, to.row) - 1
        const left = Math.min(from.col, to.col) - 1
        const right = Math.max(from.col, to.col) - 1
        if (top === bottom && left === right) {
          throw fail('BAD_ARGUMENT', 'from and to name one cell: there is nothing to merge')
        }
        const plan = (doc) => {
          const found = bodyTable(doc, number)
          if (found.refusal) return found
          const { table, grid } = found
          if (bottom >= table.rows || right >= table.cols) {
            return {
              refusal: { ok: false, reason: 'no_such_cell', rows: table.rows, cols: table.cols },
            }
          }
          const inside = []
          const crossing = []
          for (const cell of grid) {
            const lastRow = cell.row + cell.rowSpan - 1
            const lastCol = cell.col + cell.colSpan - 1
            const overlaps =
              cell.row <= bottom && lastRow >= top && cell.col <= right && lastCol >= left
            if (!overlaps) continue
            const within =
              cell.row >= top && lastRow <= bottom && cell.col >= left && lastCol <= right
            if (within) inside.push(cell)
            else crossing.push({ row: cell.row + 1, col: cell.col + 1 })
          }
          if (crossing.length > 0) {
            return { refusal: { ok: false, reason: 'crosses_merged', cells: crossing } }
          }
          // a named cell other than the first would lose its name, which a form fills it by
          const control = table.path[0].controlIndex
          const named = inside
            .filter((cell) => !(cell.row === top && cell.col === left))
            .filter((cell) => {
              const props = parse(doc.getCellProperties(table.sec, table.para, control, cell.cell))
              return typeof props.fieldName === 'string' && props.fieldName !== ''
            })
            .map((cell) => ({ row: cell.row + 1, col: cell.col + 1 }))
          if (named.length > 0)
            return { refusal: { ok: false, reason: 'named_cells', cells: named } }
          return { table, control, merged: inside.length }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'merge-cells',
            (doc) => {
              const { table, control, merged } = plan(doc)
              if (!table) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              expectOk(
                doc.mergeTableCells(table.sec, table.para, control, top, left, bottom, right),
                'merge the cells',
              )
              mustKeep(before, objectsOf(doc))
              return {
                ok: true,
                merged,
                place: { sec: table.sec, para: table.para, offset: 0, length: 0 },
              }
            },
            options,
          ),
        )
      }),

      /**
       * Split the cell of table `number` at `row` and `col` (from 1): into `rows` by
       * `cols` cells, or, with neither, a merged cell back into the cells it covers. The
       * text stays in the first of them.
       */
      splitCell: guarded((number, row, col, rows, cols, options) => {
        if (!Number.isInteger(row) || !Number.isInteger(col) || row < 1 || col < 1) {
          throw fail('BAD_ARGUMENT', 'row and col count from 1')
        }
        const count = (value) => (value === undefined || value === null ? 1 : value)
        const down = count(rows)
        const across = count(cols)
        for (const value of [down, across]) {
          if (!Number.isInteger(value) || value < 1 || value > MAX_SPLIT) {
            throw fail('BAD_ARGUMENT', `rows and cols must be 1 to ${MAX_SPLIT}`)
          }
        }
        const plan = (doc) => {
          const found = bodyTable(doc, number)
          if (found.refusal) return found
          const { table, grid } = found
          const cell = grid.find(
            (candidate) =>
              row - 1 >= candidate.row &&
              row - 1 < candidate.row + candidate.rowSpan &&
              col - 1 >= candidate.col &&
              col - 1 < candidate.col + candidate.colSpan,
          )
          if (!cell) {
            return {
              refusal: { ok: false, reason: 'no_such_cell', rows: table.rows, cols: table.cols },
            }
          }
          // a picture or a table in the cell (or lying on it) would stay in the first, smaller
          // part, cut off
          if (cellHoldsObject(doc, table, cell.cell) || coveredCells(doc, table).has(cell.cell)) {
            return { refusal: { ok: false, reason: 'holds_object' } }
          }
          const merged = cell.rowSpan > 1 || cell.colSpan > 1
          if (down === 1 && across === 1 && !merged) {
            return { refusal: { ok: false, reason: 'not_merged' } }
          }
          return { table, cell, unmerge: down === 1 && across === 1 }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'split-cell',
            (doc) => {
              const { table, cell, unmerge } = plan(doc)
              if (!table) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              const control = table.path[0].controlIndex
              const result = unmerge
                ? doc.splitTableCell(table.sec, table.para, control, cell.row, cell.col)
                : doc.splitTableCellInto(
                    table.sec,
                    table.para,
                    control,
                    cell.row,
                    cell.col,
                    down,
                    across,
                    true,
                    false,
                  )
              expectOk(result, 'split the cell')
              mustKeep(before, objectsOf(doc))
              return {
                ok: true,
                unmerged: unmerge,
                place: { sec: table.sec, para: table.para, offset: 0, length: 0 },
              }
            },
            options,
          ),
        )
      }),

      fillCells: guarded((number, cells, overwrite, options) => {
        const wanted = checkCells(cells)
        const plan = (doc) => {
          const { tables } = tablesOf(doc)
          const table = Number.isInteger(number) ? tables[number - 1] : undefined
          if (!table)
            return { refusal: { ok: false, reason: 'no_such_table', count: tables.length } }
          const grid = gridOf(doc, table)
          const fields = fieldsByCell(doc)
          const covered = coveredCells(doc, table)
          const key = tableKey(table.sec, table.para, table.path)
          const targets = []
          const missing = []
          const occupied = []
          const fielded = []
          const holding = []
          const taken = new Set()
          for (const want of wanted) {
            const at = { row: want.row, col: want.col }
            const place = grid.find(
              (cell) =>
                want.row - 1 >= cell.row &&
                want.row - 1 < cell.row + cell.rowSpan &&
                want.col - 1 >= cell.col &&
                want.col - 1 < cell.col + cell.colSpan,
            )
            if (!place) {
              missing.push(at)
              continue
            }
            if (taken.has(place.cell)) {
              throw fail('BAD_ARGUMENT', `two entries name the same cell (${want.row}.${want.col})`)
            }
            taken.add(place.cell)
            const held = fields.get(`${key}:${place.cell}`) ?? []
            if (held.length > 1) {
              fielded.push({ ...at, fields: held.map((field) => field.number) })
              continue
            }
            if (held.length === 1) {
              const field = held[0]
              if (!fieldIsEmpty(field) && overwrite !== true) {
                occupied.push({ ...at, text: clip(field.value, MAX_REPORTED_CHARS) })
              } else targets.push({ ...want, cell: place.cell, field })
              continue
            }
            if (covered.has(place.cell) || cellHoldsObject(doc, table, place.cell)) {
              holding.push(at)
              continue
            }
            const texts = paragraphsOf(cellBox(doc, table, place.cell))
            if (texts.join('').trim() !== '' && overwrite !== true) {
              occupied.push({ ...at, text: clip(texts.join(' ').trim(), MAX_REPORTED_CHARS) })
            } else {
              // blanks typed into a cell to be filled in are written over like an empty cell
              targets.push({ ...want, cell: place.cell, clear: texts.some((text) => text !== '') })
            }
          }
          const refuse = (reason, list) => ({
            refusal: { ok: false, reason, cells: list, rows: table.rows, cols: table.cols },
          })
          if (missing.length > 0) return refuse('no_such_cell', missing)
          if (fielded.length > 0) return refuse('has_fields', fielded)
          if (holding.length > 0) return refuse('holds_object', holding)
          if (occupied.length > 0) return refuse('occupied', occupied)
          return { table, targets }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'fill-cells',
            (doc) => {
              const { table, targets } = plan(doc)
              if (!targets) throw fail('CHANGED', 'the document changed mid-call')
              const own = new Set(targets.filter((t) => t.field).map((t) => t.field.fieldId))
              const before = objectsOf(doc, own)
              for (const target of targets) {
                if (target.field) {
                  // a field holds one line
                  setFieldAt(doc, target.field.key, target.lines.join(' '))
                  continue
                }
                const box = cellBox(doc, table, target.cell)
                if (target.clear) {
                  const last = box.count() - 1
                  if (last > 0) box.deleteRange(0, 0, last, box.length(last))
                  else box.deleteText(0, box.length(0))
                }
                target.lines.forEach((line, k) => {
                  // a further line is a further paragraph, made like Enter makes one
                  if (k > 0 && k >= box.count()) box.splitEnd(k - 1)
                  if (line) box.insert(k, line)
                })
                target.lines.forEach((line, k) => {
                  // the look of a guide does not become the look of the answer
                  if (line) plainAnswerInCell(doc, table, target.cell, k, [...line].length)
                })
              }
              plainAnswerFields(
                doc,
                null,
                new Set(targets.filter((t) => t.field).map((t) => t.field.key)),
              )
              mustKeep(before, objectsOf(doc, own))
              const first = targets[0]
              return {
                ok: true,
                table: number,
                count: targets.length,
                place: cellBox(doc, table, first.cell).place(
                  0,
                  first.field ? 0 : first.lines[0].length,
                ),
              }
            },
            options,
          ),
        )
      }),

      /**
       * Tick choice boxes of table `number`, all of them in one undo step or none. `cells`
       * is a list of { row, col, choice } with 1-based places; a place inside a merged cell
       * means that cell. A box is either the paragraph's bullet (a form's □, which is not in
       * the cell's text and cannot be replaced) or a □ typed into the text. `choice` names
       * the words beside the box when the cell has more than one.
       */
      checkBoxes: guarded((number, cells, options) => {
        const wanted = checkBoxCells(cells)
        const plan = (doc) => {
          const { tables } = tablesOf(doc)
          const table = Number.isInteger(number) ? tables[number - 1] : undefined
          if (!table)
            return { refusal: { ok: false, reason: 'no_such_table', count: tables.length } }
          const grid = gridOf(doc, table)
          const bullets = bulletChars(doc)
          const targets = []
          const missing = []
          const unboxed = []
          const ambiguous = []
          const taken = new Set()
          for (const want of wanted) {
            const at = { row: want.row, col: want.col }
            const place = grid.find(
              (cell) =>
                want.row - 1 >= cell.row &&
                want.row - 1 < cell.row + cell.rowSpan &&
                want.col - 1 >= cell.col &&
                want.col - 1 < cell.col + cell.colSpan,
            )
            if (!place) {
              missing.push(at)
              continue
            }
            if (taken.has(place.cell)) {
              throw fail('BAD_ARGUMENT', `two entries name the same cell (${want.row}.${want.col})`)
            }
            taken.add(place.cell)
            const texts = paragraphsOf(cellBox(doc, table, place.cell))
            const picked = pickBox(boxesOf(doc, table, place.cell, texts, bullets), want.choice)
            if (picked.box) targets.push({ cell: place.cell, ...picked.box })
            else if (picked.choices) ambiguous.push({ ...at, choices: picked.choices })
            else unboxed.push(at)
          }
          const refuse = (reason, list) => ({
            refusal: { ok: false, reason, cells: list, rows: table.rows, cols: table.cols },
          })
          if (missing.length > 0) return refuse('no_such_cell', missing)
          if (ambiguous.length > 0) return refuse('ambiguous_box', ambiguous)
          if (unboxed.length > 0) return refuse('no_box', unboxed)
          return { table, targets }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'check-boxes',
            (doc) => {
              const { table, targets } = plan(doc)
              if (!targets) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              let checkedId = null
              for (const target of targets) {
                if (target.checked) continue
                if (target.kind === 'bullet') {
                  if (checkedId === null) checkedId = doc.ensureDefaultBullet(CHECKED_BOX)
                  if (!Number.isInteger(checkedId) || checkedId < 1) {
                    throw fail('ENGINE', 'the tick box could not be made')
                  }
                  expectOk(
                    doc.applyParaFormatInCell(
                      table.sec,
                      table.para,
                      table.path[0].controlIndex,
                      target.cell,
                      target.k,
                      JSON.stringify({ headType: 'Bullet', numberingId: checkedId }),
                    ),
                    'tick the box',
                  )
                } else {
                  const path = JSON.stringify(cellAt(table.path, target.cell, target.k))
                  expectOk(
                    doc.deleteTextInCellByPath(table.sec, table.para, path, target.offset, 1),
                    'tick the box',
                  )
                  expectOk(
                    doc.insertTextInCellByPath(
                      table.sec,
                      table.para,
                      path,
                      target.offset,
                      CHECKED_BOX,
                    ),
                    'tick the box',
                  )
                }
              }
              mustKeep(before, objectsOf(doc))
              const first = targets[0]
              const marked = cellBox(doc, table, first.cell)
              return {
                ok: true,
                table: number,
                count: targets.length,
                place: marked.place(first.k, Math.min(1, marked.length(first.k))),
              }
            },
            options,
          ),
        )
      }),

      /**
       * Add `count` empty rows or columns to table `number`, after or before row or column
       * `at` (1-based). The new ones are shaped like the one they are added next to: the
       * engine copies its cells, and the alignment of each new cell is set to match. Only
       * for a table of the body: the engine has no such call for a table inside a cell.
       */
      addTableLines: guarded((number, what, at, where, count, options) => {
        const rows = checkLines(what, at, count)
        if (where !== 'after' && where !== 'before') {
          throw fail('BAD_ARGUMENT', 'where must be "after" or "before"')
        }
        const plan = (doc) => {
          const { tables } = tablesOf(doc)
          const table = Number.isInteger(number) ? tables[number - 1] : undefined
          if (!table)
            return { refusal: { ok: false, reason: 'no_such_table', count: tables.length } }
          const size = { rows: table.rows, cols: table.cols }
          if (table.parent !== null) return { refusal: { ok: false, reason: 'nested', ...size } }
          if (at > (rows ? table.rows : table.cols)) {
            return { refusal: { ok: false, reason: 'no_such_line', ...size } }
          }
          return { table }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'add-table-lines',
            (doc) => {
              const { table } = plan(doc)
              if (!table) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              const { sec, para } = table
              const ctrl = table.path[0].controlIndex
              const after = where === 'after'
              // the engine copies the row it adds next to, its lines too: the bottom line
              // of the table would stay under the old last row
              const lines = rows ? rowEdgesOf(doc, table, gridOf(doc, table)) : null
              for (let n = 0; n < count; n++) {
                // "before" pushes the line it copies down by one each time
                const beside = after ? at - 1 : at - 1 + n
                expectOk(
                  rows
                    ? doc.insertTableRow(sec, para, ctrl, beside, after)
                    : doc.insertTableColumn(sec, para, ctrl, beside, after),
                  rows ? 'add a row' : 'add a column',
                )
              }
              const first = after ? at : at - 1
              const model = after ? at - 1 : at - 1 + count
              const grown = {
                ...table,
                cells: parse(doc.getTableDimensions(sec, para, ctrl)).cellCount,
              }
              const grid = gridOf(doc, grown)
              const edges =
                lines &&
                rowEdgesAfterAdding(lines.edges, lines.flagged, lines.verticals, first, count)
              if (edges) setRowEdges(doc, grown, grid, edges)
              const line = (cell) => (rows ? cell.row : cell.col)
              const across = (cell) => (rows ? cell.col : cell.row)
              const alignment = (cell) =>
                parse(doc.getCellParaPropertiesAt(sec, para, ctrl, cell.cell, 0)).alignment
              for (const cell of grid) {
                if (line(cell) < first || line(cell) >= first + count) continue
                const like = grid.find((c) => line(c) === model && across(c) === across(cell))
                if (!like) continue
                const wanted = alignment(like)
                if (wanted && wanted !== alignment(cell)) {
                  expectOk(
                    doc.applyParaFormatInCell(
                      sec,
                      para,
                      ctrl,
                      cell.cell,
                      0,
                      JSON.stringify({ alignment: wanted }),
                    ),
                    'format the new cell',
                  )
                }
              }
              // the engine copies the height of the row it adds next to, which in a head table
              // across the columns may be one raised for its text or none under a merged
              // cell: a new row gets what its own text needs, and no less than the lowest row
              if (
                rows &&
                sec === 0 &&
                para === 0 &&
                headTablesOf(doc).some((h) => h.control === ctrl)
              ) {
                const measured = measureHead(doc, ctrl)
                if (measured) fitAddedRows(doc, ctrl, measured, first, count)
              }
              mustKeep(before, objectsOf(doc))
              const dims = parse(doc.getTableDimensions(sec, para, ctrl))
              const shown = grid.find((cell) => line(cell) === first)
              return {
                ok: true,
                table: number,
                rows: dims.rowCount,
                cols: dims.colCount,
                first: first + 1,
                count,
                ...(shown ? { place: cellBox(doc, grown, shown.cell).place(0, 0) } : {}),
              }
            },
            options,
          ),
        )
      }),

      /**
       * Remove `count` rows or columns of table `number`, from row or column `at`
       * (1-based), with what is in them. Not all of them: a table keeps one row and one
       * column. A row or column with a cell that holds a picture or another object is left
       * alone, and so is the whole call.
       */
      removeTableLines: guarded((number, what, at, count, options) => {
        const rows = checkLines(what, at, count)
        const plan = (doc) => {
          const { tables } = tablesOf(doc)
          const table = Number.isInteger(number) ? tables[number - 1] : undefined
          if (!table)
            return { refusal: { ok: false, reason: 'no_such_table', count: tables.length } }
          const size = { rows: table.rows, cols: table.cols }
          if (table.parent !== null) return { refusal: { ok: false, reason: 'nested', ...size } }
          const total = rows ? table.rows : table.cols
          if (at + count - 1 > total)
            return { refusal: { ok: false, reason: 'no_such_line', ...size } }
          if (count >= total) return { refusal: { ok: false, reason: 'would_empty', ...size } }
          const covered = coveredCells(doc, table)
          const going = gridOf(doc, table).filter((cell) => {
            const line = rows ? cell.row : cell.col
            return line >= at - 1 && line < at - 1 + count
          })
          const holding = going
            .filter((cell) => covered.has(cell.cell) || cellHoldsObject(doc, table, cell.cell))
            .map((cell) => ({ row: cell.row + 1, col: cell.col + 1 }))
          if (holding.length > 0) {
            return { refusal: { ok: false, reason: 'holds_object', cells: holding, ...size } }
          }
          return { table, going }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'remove-table-lines',
            (doc) => {
              const { table, going } = plan(doc)
              if (!table) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc, new Set())
              const { sec, para } = table
              const ctrl = table.path[0].controlIndex
              const text = clip(
                going
                  .map((cell) =>
                    paragraphsOf(cellBox(doc, table, cell.cell))
                      .join(' ')
                      .trim(),
                  )
                  .filter(Boolean)
                  .join(' | '),
                MAX_REPORTED_CHARS,
              )
              for (let n = 0; n < count; n++) {
                // the next one moves up into the place of the one just removed
                expectOk(
                  rows
                    ? doc.deleteTableRow(sec, para, ctrl, at - 1)
                    : doc.deleteTableColumn(sec, para, ctrl, at - 1),
                  rows ? 'remove the row' : 'remove the column',
                )
              }
              // the value of a named cell goes with its cell; nothing else may be lost
              mustKeep(before, objectsOf(doc, new Set()))
              const dims = parse(doc.getTableDimensions(sec, para, ctrl))
              const shrunk = { ...table, cells: dims.cellCount }
              return {
                ok: true,
                table: number,
                rows: dims.rowCount,
                cols: dims.colCount,
                count,
                text,
                place: cellBox(doc, shrunk, 0).place(0, 0),
              }
            },
            options,
          ),
        )
      }),

      /**
       * Remove table `number` (as listTables numbers them) with what is in it, the tables
       * inside its cells included. A table with a picture or another object in a cell is left
       * alone: that would go with it unseen. The paragraph the table stood in goes too when
       * nothing is left in it and a paragraph before it takes its place, so that removing a
       * table does not leave an empty line no tool can reach.
       */
      deleteTable: guarded((number, options) => {
        const plan = (doc) => {
          const { tables } = tablesOf(doc)
          const table = Number.isInteger(number) ? tables[number - 1] : undefined
          if (!table)
            return { refusal: { ok: false, reason: 'no_such_table', count: tables.length } }
          // the tables inside it come right after it in the list, each inside one already seen
          const inside = new Set([number - 1])
          for (let i = number; i < tables.length && inside.has(tables[i].parent); i++) inside.add(i)
          const members = [...inside].map((i) => tables[i])
          const top = gridOf(doc, table)
          const holding = new Set()
          for (const member of members) {
            for (const cell of gridOf(doc, member)) {
              if (!cellHoldsOtherObject(doc, member, cell.cell)) continue
              // named by the cell of this table it lies in
              holding.add(
                member === table ? cell.cell : member.path[table.path.length - 1].cellIndex,
              )
            }
          }
          if (holding.size > 0) {
            const cells = top
              .filter((cell) => holding.has(cell.cell))
              .map((cell) => ({ row: cell.row + 1, col: cell.col + 1 }))
            return { refusal: { ok: false, reason: 'holds_object', cells } }
          }
          // the form fields in its cells go with it
          const keys = members.map((member) => `${tableKey(member.sec, member.para, member.path)}:`)
          const going = new Set()
          for (const [key, fields] of fieldsByCell(doc)) {
            if (keys.some((prefix) => key.startsWith(prefix))) {
              for (const field of fields) going.add(field.fieldId)
            }
          }
          return { table, top, inner: members.length - 1, going }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'delete-table',
            (doc) => {
              const { table, top, inner, going } = plan(doc)
              if (!table) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc, going)
              const text = clip(
                top
                  .map((cell) =>
                    paragraphsOf(cellBox(doc, table, cell.cell))
                      .join(' ')
                      .trim(),
                  )
                  .filter(Boolean)
                  .join(' | '),
                MAX_REPORTED_CHARS,
              )
              const { sec, para, path } = table
              const last = path[path.length - 1]
              const cellPath = path.slice(0, -1)
              expectOk(
                cellPath.length === 0
                  ? doc.deleteTableControl(sec, para, last.controlIndex)
                  : doc.deleteCellTableControlByPath(
                      sec,
                      para,
                      JSON.stringify(cellPath),
                      last.controlIndex,
                    ),
                'remove the table',
              )
              const box = containerOf(
                doc,
                cellPath.length === 0 ? { sec, para } : { sec, para, cellPath },
              )
              const k = box.index
              const bare =
                box.length(k) === 0 &&
                (cellPath.length === 0
                  ? box.objectPositions(k).length === 0
                  : !paragraphHoldsObject(doc, sec, para, cellPath))
              if (k > 0 && bare) box.remove(k)
              // only this table and the tables inside it may be gone
              mustKeep({ ...before, controls: before.controls - 1 - inner }, objectsOf(doc, going))
              return {
                ok: true,
                table: number,
                rows: table.rows,
                cols: table.cols,
                inner,
                text,
                place: box.place(k > 0 && bare ? k - 1 : k, 0),
              }
            },
            options,
          ),
        )
      }),

      /**
       * Put Open, Save, Save As, Import PDF, Export as PDF, Print Preview and Print at the top
       * of the editor's File menu. The embedded editor leaves out its own (the app owns the
       * file), which left the menu with no way to open or save, and no way to its PDF import.
       * Open is the app's: it asks for a file and opens it in a tab of its own, as Ctrl+O
       * does, and never swaps the document inside this editor. Each item fires
       * FILE_COMMAND_EVENT on the editor's window and the app does the rest. `labels` holds
       * the seven names in the app's language, by command. A second call puts the items back
       * where they were; the names stay the first ones.
       */
      installFileMenu: guarded((labels) => {
        for (const item of FILE_MENU) {
          if (typeof labels?.[item.command] !== 'string' || !labels[item.command]) {
            throw fail('BAD_ARGUMENT', `labels.${item.command} must be a non-empty string`)
          }
        }
        if (!host.automation.registerCommand || !host.automation.addMenuItem) return { ok: false }
        for (const item of FILE_MENU) {
          try {
            host.automation.registerCommand({
              id: item.id,
              label: labels[item.command],
              ...(item.shortcut ? { shortcutLabel: item.shortcut } : {}),
              execute: () => {
                globalThis.dispatchEvent?.(
                  new CustomEvent(FILE_COMMAND_EVENT, { detail: item.command }),
                )
              },
            })
          } catch {
            // registered by an earlier call
          }
        }
        try {
          // each item goes on top, so the last one put there comes first
          for (const item of [...FILE_MENU].reverse()) {
            host.automation.addMenuItem({ menuId: 'file', commandId: item.id, position: 'top' })
          }
        } catch {
          // an editor without a File menu
          return { ok: false }
        }
        return { ok: true }
      }),

      /**
       * Name the editor's right-click item 쉬운 말로 풀기 (EASY_WORDS_COMMAND) in the app's
       * language. The item is off while nothing is selected. A click reads the selection as
       * selection() does and fires EASY_WORDS_EVENT with its text, a line per paragraph; it
       * changes nothing in the document. A later call gives the item its new name.
       */
      /**
       * Show the characters of the block and of the document in the editor's status bar,
       * beside the insert/overwrite mode (issue #295), counted as the 문서 정보 dialog counts
       * them. `labels` are the app's words: `total` ("{total}"), `selected` ("{selected}" and
       * "{total}"), and the tooltips `hint` and `hintSelected` (those and "{totalNoSpace}",
       * "{selectedNoSpace}", the counts without blanks), with the `locale` the numbers are
       * written in. A later call changes the words.
       */
      showCharCount: guarded((labels) => {
        const checked = checkCharCountLabels(labels)
        if (!checked)
          throw fail(
            'BAD_ARGUMENT',
            'total, selected, hint and hintSelected must be non-empty strings',
          )
        charCountLabels = checked
        return { ok: startCharCount() }
      }),

      installEasyWords: guarded((label) => {
        if (typeof label !== 'string' || !label.trim()) {
          throw fail('BAD_ARGUMENT', 'label must be a non-empty string')
        }
        if (!host.automation.registerCommand) return { ok: false }
        try {
          // the studio's registry overwrites an id; a host that refuses one is cleared first
          host.automation.unregisterCommand?.(EASY_WORDS_COMMAND)
        } catch {
          // nothing registered yet
        }
        try {
          host.automation.registerCommand({
            id: EASY_WORDS_COMMAND,
            label,
            canExecute: (ctx) =>
              ctx?.hasDocument === true &&
              (ctx.hasSelection === true || ctx.inCellSelectionMode === true),
            execute: () => {
              let read
              try {
                read = api.selection()
              } catch {
                return
              }
              if (!read?.ok) return
              const text = read.segments
                .map((segment) => segment.text)
                .join('\n')
                .trim()
              if (!text) return
              globalThis.dispatchEvent?.(new CustomEvent(EASY_WORDS_EVENT, { detail: { text } }))
            },
          })
        } catch {
          return { ok: false }
        }
        return { ok: true }
      }),

      /**
       * Take the right-click item 쉬운 말로 풀기 away again (AI turned off in Settings): the
       * menus leave out a command nobody registered. installEasyWords brings it back.
       */
      removeEasyWords: guarded(() => {
        if (!host.automation.unregisterCommand) return { ok: false }
        try {
          host.automation.unregisterCommand(EASY_WORDS_COMMAND)
        } catch {
          // it was not registered
        }
        return { ok: true }
      }),

      /**
       * Mark the fonts that are not on this PC in the editor's font menu and font box, with
       * the app's words (`tag` beside a menu entry, `hint` as the tooltip), and tell which of
       * the document's fonts are not on this PC: once the editor's start-up look at the PC's
       * fonts is over, MISSING_FONTS_EVENT fires with the names the text uses. Reads only.
       */
      watchMissingFonts: guarded((given) => {
        if (
          typeof given?.tag !== 'string' ||
          !given.tag.trim() ||
          typeof given.hint !== 'string' ||
          !given.hint.trim()
        ) {
          throw fail('BAD_ARGUMENT', 'tag and hint must be non-empty strings')
        }
        setMissingFontLabels({ tag: given.tag, hint: given.hint })
        void whenPcFontsSettled().then(() => {
          let used
          try {
            used = host.read((doc) => parse(doc.getDocumentInfo()).fontsUsed)
          } catch {
            return
          }
          const fonts = missingFonts(Array.isArray(used) ? used : [])
          globalThis.dispatchEvent?.(new CustomEvent(MISSING_FONTS_EVENT, { detail: { fonts } }))
        })
        return { ok: true }
      }),

      /**
       * Show a place in the editor: its caret goes there, the run is selected, and the view
       * scrolls to it. `place` is what a change handed back. Answers false when the editor
       * cannot (no caret yet, or the place is gone).
       */
      reveal: guarded((place) => {
        shown = false
        try {
          host.automation.execute(REVEAL_COMMAND, place)
        } catch {
          return { ok: false }
        }
        if (shown) shownKey = placeKey(place)
        return { ok: shown }
      }),

      /**
       * What the user has selected in the editor, as runs of text: one per paragraph
       * touched, in reading order. A selection inside one paragraph or one cell is its
       * text; one that runs over paragraphs takes the tables between them whole; a block
       * of cells is the text of those cells. `contiguous` says the runs are the paragraphs
       * of one stretch (the body, or one cell), which is what a rewrite into more or fewer
       * paragraphs needs. `own` marks the selection this plugin made itself when it
       * showed a change.
       */
      selection: guarded(() => {
        picked = null
        try {
          host.automation.execute(SELECTION_COMMAND)
        } catch {
          return { ok: false, reason: 'none' }
        }
        const seen = picked
        if (!seen) return { ok: false, reason: 'none' }
        return host.read((doc) => {
          const out = runCollector()
          const gathered = gatherSelection(doc, seen, out)
          if (!gathered.ok) return gathered
          const { inTable } = gathered
          if (out.tooLong()) return { ok: false, reason: 'too_long' }
          if (out.segments.length === 0) return { ok: false, reason: 'none' }
          return {
            ok: true,
            inTable,
            contiguous: isContiguous(out.segments),
            own: out.segments.length === 1 && placeKey(out.segments[0]) === shownKey,
            segments: out.segments,
          }
        })
      }),

      /**
       * Replace the selected runs in one undo step. With as many texts as runs, each text
       * takes the place of its run. With more or fewer (only for a contiguous selection),
       * the selection is rewritten: further texts become new paragraphs after the last
       * run, made like Enter makes them, and runs left without a text are removed, a
       * wholly selected paragraph with them. `segments` is the selection as selection()
       * handed it out; when a run no longer holds its text (the user typed there, or the
       * place moved) nothing changes. A run that lies across an object of its line is not
       * rewritten (`spans_object`): the new text has no place for the object. The runs come
       * back as they are now, for a further change of the same selection.
       */
      replaceSelection: guarded((segments, texts, options) => {
        checkSegments(segments)
        if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_SELECTED_RUNS) {
          throw fail('BAD_ARGUMENT', 'texts must be a list of one or more strings')
        }
        texts.forEach(checkReplacement)
        if (texts.length !== segments.length && !isContiguous(segments)) {
          return { ok: false, reason: 'count', count: segments.length }
        }
        const asHit = (segment) => ({
          sec: segment.sec,
          para: segment.para,
          cellPath: segment.path,
          charOffset: segment.offset,
          length: segment.length,
        })
        const kept = Math.min(segments.length, texts.length)
        const stands = (doc) =>
          !segmentsStand(doc, segments)
            ? 'changed'
            : segments.slice(0, kept).some((segment) => spansObject(doc, asHit(segment)))
              ? 'spans_object'
              : null
        const reason = host.read(stands)
        if (reason) return { ok: false, reason, ...(reason === 'spans_object' ? { count: 1 } : {}) }
        return keepingObjects((mustKeep) =>
          change(
            'replace-selection',
            (doc) => {
              if (stands(doc)) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              // runs left without a text go first, from the end, so that the paragraphs in
              // front of them keep their numbers
              for (let index = segments.length - 1; index >= kept; index--) {
                const segment = segments[index]
                const { box, k } = segmentBox(doc, segment)
                const whole = segment.offset === 0 && segment.length === box.length(k)
                if (whole && k > 0 && box.objectPositions(k).length === 0) box.remove(k)
                else replaceHit(doc, asHit(segment), '')
              }
              // each run is in a paragraph of its own, so one does not move another
              for (let index = 0; index < kept; index++) {
                replaceHit(doc, asHit(segments[index]), texts[index])
              }
              const now = segments.slice(0, kept).map((segment, index) => ({
                ...segment,
                length: texts[index].length,
                text: texts[index],
              }))
              if (texts.length > segments.length) {
                // what stood behind the selection in its last paragraph ends up behind the
                // last new paragraph, as when text of several paragraphs is typed there
                const last = segments[segments.length - 1]
                const { box, k } = segmentBox(doc, last)
                let at = k
                let offset = last.offset + texts[kept - 1].length
                for (let index = kept; index < texts.length; index++) {
                  box.split(at, offset)
                  at += 1
                  if (texts[index]) box.insert(at, texts[index])
                  offset = texts[index].length
                  now.push({ ...box.place(at, texts[index].length), text: texts[index] })
                }
              }
              mustKeep(before, objectsOf(doc))
              const { text: _text, ...place } = now[0]
              return { ok: true, segments: now, place }
            },
            options,
          ),
        )
      }),

      /**
       * Change the formatting of the selected runs: character formatting for the runs, and
       * with align or lineSpacing the paragraphs they are in.
       */
      formatSelection: guarded((segments, format, options) => {
        checkSegments(segments)
        const spec = formatOf(format, true)
        const plan = (doc) => {
          if (!segmentsStand(doc, segments)) return { refusal: { ok: false, reason: 'changed' } }
          const boxes = segments.map((segment) => segmentBox(doc, segment))
          if (
            boxes.some(
              ({ box }) =>
                (spec.paragraph && !box.formatParagraph) || (spec.style && !box.applyStyle),
            )
          ) {
            return { refusal: { ok: false, reason: 'unsupported_place' } }
          }
          const missing = missingStyle(doc, spec)
          if (missing) return { refusal: missing }
          return { boxes }
        }
        const refusal = host.read((doc) => plan(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'format-selection',
            (doc) => {
              const { boxes } = plan(doc)
              if (!boxes) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              const { chars, paragraph, style, charShape } = resolveFormat(doc, spec)
              let keptOwnLook = 0
              segments.forEach((segment, index) => {
                const { box, k } = boxes[index]
                const end = segment.offset + segment.length
                if (style !== null) {
                  if (keepsOwnLook(doc, box, k) === true) keptOwnLook += 1
                  box.applyStyle(k, style)
                }
                if (charShape !== null && segment.length > 0) {
                  box.setCharShape(k, segment.offset, end, charShape)
                }
                if (paragraph) box.formatParagraph(k, paragraph)
                if (chars && segment.length > 0) box.formatChars(k, segment.offset, end, chars)
              })
              mustKeep(before, objectsOf(doc))
              const { text: _text, ...place } = segments[0]
              return {
                ok: true,
                count: segments.length,
                place,
                ...(keptOwnLook > 0 ? { keptOwnLook } : {}),
              }
            },
            options,
          ),
        )
      }),

      /**
       * The form fields of the document in document order. Names repeat in real forms (a
       * field nobody named carries its guide text), so a field is addressed by its number.
       */
      listFields: guarded(() =>
        host.read((doc) =>
          formFieldsOf(doc).map((field, index) => ({
            field: index + 1,
            name: field.name ?? '',
            guide: field.guide ?? '',
            value: field.value ?? '',
            // a named table cell is filled like a field but is not one the user clicks into
            inCell: field.cellField === true,
          })),
        ),
      ),

      /** Set the value of the field with this number (1-based, as listed by listFields). */
      fillField: guarded((number, value, options) => {
        checkReplacement(value)
        const count = host.read((doc) => formFieldsOf(doc).length)
        if (!Number.isInteger(number) || number < 1 || number > count) {
          return { ok: false, reason: 'no_such_field', count }
        }
        return change(
          'fill-field',
          (doc) => {
            const field = formFieldsOf(doc)[number - 1]
            if (!field) throw fail('CHANGED', 'the document changed mid-call')
            setFieldAt(doc, fieldKey(field), value)
            plainAnswerFields(doc, null, new Set([fieldKey(field)]))
            const place = fieldPlace(field)
            return { ok: true, name: field.name ?? '', ...(place ? { place } : {}) }
          },
          options,
        )
      }),

      /**
       * Add a table of contents next to the paragraph `anchor` occurs in (or at the end): a
       * title line when `title` is given, then a table with a row per heading and its page
       * number. A heading is named by text it contains (`find`, with `occurrence` when
       * that text occurs more than once) and shown as its whole paragraph; headings are body
       * paragraphs. The page numbers are those with the table of contents in place.
       */
      insertToc: guarded((anchor, occurrence, where, title, entries, options) => {
        checkWhere(where)
        checkTocEntries(entries)
        if (title !== null && title !== undefined) checkReplacement(title)
        const titled = typeof title === 'string' && title.trim() !== ''
        const headingsOf = (doc) =>
          entries.map((entry) => {
            const hits = searchAll(doc, entry.find)
            const picked = pickHit(hits, entry.occurrence ?? null)
            const reason = !picked.hit
              ? picked.reason
              : !isReplaceable(picked.hit) || cellPathOf(picked.hit)
                ? 'unsupported_place'
                : null
            const hit = reason ? null : picked.hit
            const text = hit ? bodyText(doc, hit.sec, hit.para) : ''
            return { entry, hits, hit, text, reason }
          })
        const refusal = host.read((doc) => {
          const located = locate(doc, anchor, occurrence, where)
          if (located.refusal) return located.refusal
          if (located.box.inTable) return { ok: false, reason: 'in_table', count: 1 }
          const there = contentsOf(doc, contentsMade)
          if (there) return { ok: false, reason: 'toc_exists', count: 1, ...there }
          const missing = headingsOf(doc).find((heading) => heading.reason)
          if (!missing) return null
          return {
            ok: false,
            reason: 'no_heading',
            heading: missing.entry.find,
            why: missing.reason,
            count: missing.hits.length,
            ...(missing.reason === 'ambiguous' ? { matches: listMatches(doc, missing.hits) } : {}),
          }
        })
        if (refusal) return refusal
        let written = null
        const result = keepingObjects((mustKeep) =>
          change(
            'insert-toc',
            (doc) => {
              const { box, plain } = locate(doc, anchor, occurrence, where)
              if (!box || box.inTable) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              const { sec } = box.place(box.index, 0)
              const headings = headingsOf(doc)
              if (headings.some((heading) => !heading.hit)) {
                throw fail('CHANGED', 'the document changed mid-call')
              }
              const look = tocLookOf(doc, entries)
              const width = textWidthPt(doc, sec)
              const rows = headings.map(({ entry, text }) => {
                const level = look.levels.get(entry.level)
                return {
                  text: oneLine(clip(text.replace(/\s+/g, ' ').trim(), MAX_TOC_TEXT), level, width),
                  look: level,
                  page: 0,
                }
              })
              let first = box.index
              if (where === 'before') box.split(first, 0)
              else {
                openAfter(box, first, plain)
                first += 1
              }
              let holder = first
              if (titled) {
                const text = title.trim()
                box.insert(first, text)
                // the title is split off the anchor, often a heading: it takes its own look
                box.applyStyle(first, look.title.style)
                const { font, bold, color } = look.title
                const { chars } = resolveFormat(
                  doc,
                  formatOf(
                    {
                      ...(font.family ? { font: font.family } : {}),
                      size: font.points,
                      bold,
                      ...(HEX_COLOR.test(color ?? '') ? { color } : {}),
                    },
                    false,
                  ),
                )
                box.formatChars(first, 0, box.length(first), chars)
                openAfter(box, first, false)
                holder = first + 1
              }
              box.applyStyle(holder, styleIdOf(doc, BODY_STYLE) ?? 0)
              box.pasteHtml(holder, tocHtml(rows, width))
              const { tables } = tablesOf(doc)
              const number =
                tables.findIndex(
                  (candidate) =>
                    candidate.sec === sec &&
                    candidate.para === holder &&
                    candidate.path.length === 1,
                ) + 1
              const table = tables[number - 1]
              if (!table) throw fail('ENGINE', 'the table of contents could not be made')
              // the pages as they are now: every paragraph from the first new one moved down
              const added = holder - first + 1
              const grid = gridOf(doc, table)
              const control = table.path[0].controlIndex
              const pages = headings.map(({ entry, hit }, index) => {
                const para = hit.sec === sec && hit.para >= first ? hit.para + added : hit.para
                const page = pageNumberOf(doc, hit.sec, para)
                const cell = cellOf(grid, index, 1)
                if (!cell) throw fail('ENGINE', 'the table of contents came out in another shape')
                setCellText(doc, table, cell.cell, String(page))
                const { style } = look.levels.get(entry.level)
                if (style !== null) {
                  for (const col of [0, 1]) {
                    expectOk(
                      doc.applyCellStyle(
                        sec,
                        holder,
                        control,
                        cellOf(grid, index, col).cell,
                        0,
                        style,
                      ),
                      'style the table of contents',
                    )
                  }
                }
                return page
              })
              if (titled) {
                expectOk(
                  doc.applyParaFormat(sec, first, JSON.stringify({ alignment: 'center' })),
                  'center the title',
                )
              }
              const after = objectsOf(doc)
              // the table is an object of its own; nothing that was there may be gone
              mustKeep(before, { ...after, controls: Math.min(after.controls, before.controls) })
              written = rows.map((row) => squash(row.text))
              return {
                ok: true,
                count: entries.length,
                pages,
                table: number,
                tables: tables.length,
                place: { sec, para: first, offset: 0, length: titled ? title.trim().length : 0 },
              }
            },
            options,
          ),
        )
        if (result.ok && written) contentsMade.push(written)
        return result
      }),

      /**
       * Write the page numbers of a table of contents again: the two-column table in the
       * paragraph after the one `title` occurs in. Each row's heading is looked up by its
       * text in the body; a row whose heading is gone, or whose second cell is not a page
       * number, is left alone.
       */
      refreshToc: guarded((title, occurrence, options) => {
        const find = (doc) => {
          const located = locate(doc, title, occurrence, 'after')
          if (located.refusal) return { refusal: located.refusal }
          if (located.box.inTable) return { refusal: { ok: false, reason: 'in_table', count: 1 } }
          const { sec } = located.box.place(located.box.index, 0)
          const table = tablesOf(doc).tables.find(
            (candidate) =>
              candidate.sec === sec &&
              candidate.para === located.box.index + 1 &&
              candidate.path.length === 1 &&
              candidate.cols === 2,
          )
          return table ? { table } : { refusal: { ok: false, reason: 'no_toc', count: 0 } }
        }
        const refusal = host.read((doc) => find(doc).refusal ?? null)
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'refresh-toc',
            (doc) => {
              const { table } = find(doc)
              if (!table) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              const grid = gridOf(doc, table)
              let rows = 0
              let changed = 0
              const missing = []
              for (let row = 0; row < table.rows; row++) {
                const headingCell = cellOf(grid, row, 0)
                const pageCell = cellOf(grid, row, 1)
                if (!headingCell || !pageCell) continue
                const shown = PAGE_NUMBER.exec(
                  paragraphsOf(cellBox(doc, table, pageCell.cell)).join(''),
                )
                if (!shown) continue
                rows += 1
                const heading = paragraphsOf(cellBox(doc, table, headingCell.cell))
                  .join(' ')
                  .trim()
                // looked up by the start of its text (a long one was cut short in the table); a
                // body paragraph that starts with it is preferred to a mention elsewhere
                const key = heading.replace(/…$/, '').slice(0, TOC_KEY_CHARS)
                const body = key
                  ? searchAll(doc, key).filter((hit) => !cellPathOf(hit) && isReplaceable(hit))
                  : []
                const hit =
                  body.find((candidate) =>
                    bodyText(doc, candidate.sec, candidate.para).trim().startsWith(key),
                  ) ?? body[0]
                if (!hit) {
                  missing.push(heading)
                  continue
                }
                const page = pageNumberOf(doc, hit.sec, hit.para)
                if (page === Number(shown[1])) continue
                setCellText(doc, table, pageCell.cell, String(page))
                changed += 1
              }
              mustKeep(before, objectsOf(doc))
              return {
                ok: true,
                lines: rows,
                changed,
                ...(missing.length > 0 ? { missing } : {}),
                place: { sec: table.sec, para: table.para, offset: 0, length: 0 },
              }
            },
            options,
          ),
        )
      }),

      /**
       * The equations of the body text in reading order: number in this list (what
       * editEquation takes), the words in front of it and after it, and its script.
       */
      listEquations: guarded(() =>
        host.read((doc) => {
          const { equations, elsewhere } = equationsOf(doc)
          const kinds = new Map()
          return {
            count: equations.length,
            elsewhere,
            equations: equations.slice(0, MAX_LISTED_EQUATIONS).map((equation, index) => ({
              equation: index + 1,
              ...equationContext(doc, equation, kinds),
              script: equation.script,
            })),
          }
        }),
      ),

      /**
       * Give an equation of the body text (its number from listEquations) a new script, or
       * remove it when `script` is null; the text round it stays as it is. One undo step.
       */
      editEquation: guarded((number, script, options) => {
        const removing = script === null
        if (
          !removing &&
          (typeof script !== 'string' ||
            !script.trim() ||
            script.length > MAX_EQUATION_SCRIPT ||
            CONTROL_CHARS.test(script))
        ) {
          throw fail(
            'BAD_ARGUMENT',
            `script must be one line of 1 to ${MAX_EQUATION_SCRIPT} characters`,
          )
        }
        const refusal = host.read((doc) => {
          const { equations } = equationsOf(doc)
          return Number.isInteger(number) && equations[number - 1]
            ? null
            : { ok: false, reason: 'no_such_equation', count: equations.length }
        })
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            removing ? 'remove-equation' : 'edit-equation',
            (doc) => {
              const equation = equationsOf(doc).equations[number - 1]
              if (!equation) throw fail('CHANGED', 'the document changed mid-call')
              const { sec, para, control, offset } = equation
              const before = objectsOf(doc)
              if (removing) {
                expectOk(doc.deleteEquationControl(sec, para, control), 'remove the equation')
                mustKeep({ ...before, controls: before.controls - 1 }, objectsOf(doc))
              } else {
                expectOk(
                  doc.setEquationProperties(
                    sec,
                    para,
                    control,
                    -1,
                    -1,
                    JSON.stringify({ script: script.trim() }),
                  ),
                  'change the equation',
                )
                mustKeep(before, objectsOf(doc))
              }
              return {
                ok: true,
                removed: removing,
                was: equation.script,
                place: { sec, para, offset, length: removing ? 0 : 1 },
              }
            },
            options,
          ),
        )
      }),

      /**
       * The footnotes and endnotes of the body in reading order: number in this list (what
       * editNote and deleteNote take), kind, the document's own number, the text in front of
       * the mark, and the note's text.
       */
      listNotes: guarded(() =>
        host.read((doc) => {
          const { notes, elsewhere } = notesOf(doc)
          return {
            count: notes.length,
            elsewhere,
            notes: notes.slice(0, MAX_LISTED_NOTES).map((note, index) => ({
              note: index + 1,
              ...noteSummary(note),
              after: noteContext(doc, note),
              text: clip(note.lines.join('\n'), MAX_LISTED_NOTE_CHARS),
              ...(note.plain ? {} : { objects: true }),
              ...(note.numbered ? {} : { noAutoNumber: true }),
            })),
          }
        }),
      ),

      /**
       * Add a footnote or an endnote whose mark goes right after `anchor` (the text must
       * occur once, or `occurrence` picks one), with `text` as its content; a line break
       * starts a new paragraph of the note. Notes go in the body text only.
       */
      insertNote: guarded((kind, anchor, occurrence, text, options) => {
        if (!NOTE_KINDS.includes(kind))
          throw fail('BAD_ARGUMENT', 'kind must be footnote or endnote')
        const lines = checkNoteText(text)
        const pick = (doc) => {
          const hits = searchAll(doc, anchor)
          const picked = pickHit(hits, occurrence)
          const reason = !picked.hit
            ? picked.reason
            : !isReplaceable(picked.hit) || cellPathOf(picked.hit)
              ? 'unsupported_place'
              : null
          return { hits, hit: reason ? null : picked.hit, reason }
        }
        const refusal = host.read((doc) => {
          const { hits, reason } = pick(doc)
          if (!reason) return null
          return {
            ok: false,
            reason,
            count: hits.length,
            ...(reason === 'ambiguous' ? { matches: listMatches(doc, hits) } : {}),
          }
        })
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'insert-note',
            (doc) => {
              const { hit } = pick(doc)
              if (!hit) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              const offset = hit.charOffset + hit.length
              const made = parse(
                kind === 'endnote'
                  ? doc.insertEndnote(hit.sec, hit.para, offset)
                  : doc.insertFootnote(hit.sec, hit.para, offset),
              )
              if (!made.ok || !Number.isInteger(made.controlIdx)) {
                throw fail('ENGINE', `could not add the ${kind}`)
              }
              const at = { sec: hit.sec, para: made.paraIdx ?? hit.para, control: made.controlIdx }
              // a new note holds its number only: everything in it is the number
              const prefix = parse(doc.getFootnoteInfo(at.sec, at.para, at.control)).totalTextLen
              writeNote(doc, at, prefix, lines)
              // the one control more is the note itself
              mustKeep({ ...before, controls: before.controls + 1 }, objectsOf(doc))
              return {
                ok: true,
                kind,
                number: made.footnoteNumber ?? made.endnoteNumber ?? null,
                place: placeOf(hit, hit.length),
              }
            },
            options,
          ),
        )
      }),

      /** Replace the whole text of a note (its number from listNotes); a line break starts a paragraph. */
      editNote: guarded((number, text, options) => {
        const lines = checkNoteText(text)
        const refusal = host.read((doc) => {
          const { notes } = notesOf(doc)
          const note = notes[number - 1]
          if (!Number.isInteger(number) || !note) {
            return { ok: false, reason: 'no_such_note', count: notes.length }
          }
          return note.plain ? null : { ok: false, reason: 'has_objects', count: 1 }
        })
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'edit-note',
            (doc) => {
              const note = notesOf(doc).notes[number - 1]
              if (!note || !note.plain) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              // one paragraph holding the number only, then the new text
              for (let k = note.lines.length - 1; k > 0; k--) {
                expectOk(
                  doc.mergeParagraphInFootnote(note.sec, note.para, note.control, k),
                  'merge the note',
                )
              }
              const first = parse(
                doc.getFootnoteInfo(note.sec, note.para, note.control),
              ).totalTextLen
              if (first > note.prefix) {
                expectOk(
                  doc.deleteTextInFootnote(
                    note.sec,
                    note.para,
                    note.control,
                    0,
                    note.prefix,
                    first - note.prefix,
                  ),
                  'clear the note',
                )
              }
              writeNote(doc, note, note.prefix, lines)
              mustKeep(before, objectsOf(doc))
              return {
                ok: true,
                ...noteSummary(note),
                was: clip(note.lines.join('\n'), MAX_REPORTED_CHARS),
                place: { sec: note.sec, para: note.para, offset: note.offset, length: 0 },
              }
            },
            options,
          ),
        )
      }),

      /** Remove a note (its number from listNotes), mark and text. */
      deleteNote: guarded((number, options) => {
        const refusal = host.read((doc) => {
          const { notes } = notesOf(doc)
          return Number.isInteger(number) && notes[number - 1]
            ? null
            : { ok: false, reason: 'no_such_note', count: notes.length }
        })
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'delete-note',
            (doc) => {
              const note = notesOf(doc).notes[number - 1]
              if (!note) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              expectOk(doc.deleteFootnote(note.sec, note.para, note.control), 'remove the note')
              mustKeep({ ...before, controls: before.controls - 1 }, objectsOf(doc))
              return {
                ok: true,
                ...noteSummary(note),
                text: clip(note.lines.join('\n'), MAX_REPORTED_CHARS),
                place: { sec: note.sec, para: note.para, offset: note.offset, length: 0 },
              }
            },
            options,
          ),
        )
      }),

      /**
       * The footnote and endnote settings of the document (its first section's: a new
       * section copies them), and whether this engine can change the footnote ones.
       */
      noteSettings: guarded(() =>
        host.read((doc) => ({
          sections: doc.getSectionCount(),
          footnote: noteShapeOf(doc, 'footnote', 0),
          endnote: noteShapeOf(doc, 'endnote', 0),
        })),
      ),

      /**
       * Change the footnote or endnote settings of every section: only what `spec` names
       * (number format, decoration, superscript, start, numbering, placement, separator).
       * The notes are numbered again with the new format. One undo step.
       */
      setNoteSettings: guarded((kind, spec, options) => {
        const wanted = noteSettingsChangeOf(kind, spec)
        const applyName = kind === 'footnote' ? 'applyFootnoteShape' : 'applyEndnoteShape'
        const supported = host.read((doc) => typeof doc[applyName] === 'function')
        if (!supported) return { ok: false, reason: 'unsupported' }
        return change(
          'note-settings',
          (doc) => {
            const sections = doc.getSectionCount()
            for (let sec = 0; sec < sections; sec++) {
              const json = JSON.stringify(noteShapeChangeFor(doc, kind, sec, wanted))
              expectOk(doc[applyName](sec, json), `change the ${kind} settings`)
            }
            return { ok: true, kind, settings: noteShapeOf(doc, kind, 0) }
          },
          options,
        )
      }),

      /** The page setup of each section: paper, orientation and margins, in millimetres. */
      pageSetup: guarded(() =>
        host.read((doc) => {
          const sections = []
          for (let sec = 0; sec < doc.getSectionCount(); sec++) sections.push(pageSetupOf(doc, sec))
          return { sections }
        }),
      ),

      /**
       * Change the page setup of one section (`section`, from 1) or of all of them: only
       * what `spec` names. Refused when the margins would leave no room for text. One undo
       * step.
       */
      setPageSetup: guarded((spec, section, options) => {
        const wanted = pageSetupChangeOf(spec)
        const targets = (doc) => {
          const count = doc.getSectionCount()
          if (section === undefined || section === null) {
            return Array.from({ length: count }, (_, index) => index)
          }
          return Number.isInteger(section) && section >= 1 && section <= count
            ? [section - 1]
            : null
        }
        const refusal = host.read((doc) => {
          const secs = targets(doc)
          if (!secs) return { ok: false, reason: 'no_such_section', count: doc.getSectionCount() }
          for (const sec of secs) {
            if (!leavesTextArea(parse(doc.getPageDef(sec)), wanted)) {
              return { ok: false, reason: 'no_text_area', section: sec + 1 }
            }
          }
          return null
        })
        if (refusal) return refusal
        return change(
          'page-setup',
          (doc) => {
            const secs = targets(doc)
            if (!secs) throw fail('CHANGED', 'the document changed mid-call')
            for (const sec of secs) {
              expectOk(doc.setPageDef(sec, JSON.stringify(wanted)), 'change the page setup')
            }
            return {
              ok: true,
              sections: secs.length,
              pageSetup: pageSetupOf(doc, secs[0]),
            }
          },
          options,
        )
      }),

      /**
       * The body paragraphs in reading order with their look ids (paragraphLooksOf), from
       * the `from`-th on. Reads only.
       */
      paragraphLooks: guarded((from) => host.read((doc) => paragraphLooksOf(doc, from))),

      /**
       * What a document's formatting is made of (formattingOf): this document's, or that of
       * another HWP / HWPX document handed over as base64 (an attachment), opened with this
       * editor's engine and freed again. The looks of another document have no id: only
       * this document's looks can be changed (formatLook).
       */
      formatting: guarded((base64) =>
        host.read((doc) => {
          if (base64 === undefined || base64 === null) return { ok: true, ...formattingOf(doc) }
          if (typeof base64 !== 'string' || base64 === '') {
            throw fail('BAD_ARGUMENT', 'the document must come as base64')
          }
          // the class of the editor's own document: the same engine opens the other one
          const Document = doc.constructor
          let other
          try {
            other = new Document(bytesOfBase64(base64))
          } catch (thrown) {
            return { ok: false, reason: 'unreadable', message: clip(asError(thrown).message, 200) }
          }
          try {
            const formatting = formattingOf(other)
            return {
              ok: true,
              ...formatting,
              looks: formatting.looks.map(({ id: _id, ...look }) => look),
            }
          } finally {
            other.free?.()
          }
        }),
      ),

      /**
       * Change every body paragraph of one look (an id from formatting) at once: the paragraph
       * style, paragraph formatting and list, and the character formatting of all their text,
       * as formatParagraph does for one. Refused with the current looks when the id is not one
       * of them (the paragraphs changed look since). One undo step.
       */
      formatLook: guarded((id, format, options) => {
        const spec = formatOf(format, true)
        const find = (doc) => looksOf(doc).looks.find((group) => group.id === id) ?? null
        const refusal = host.read((doc) => {
          const group = find(doc)
          if (!group) {
            return {
              ok: false,
              reason: 'no_such_look',
              looks: looksOf(doc)
                .looks.slice(0, MAX_LISTED_LOOKS)
                .map((other) => ({
                  id: other.id,
                  paragraphs: other.places.length,
                  sample: other.samples[0],
                })),
            }
          }
          return (
            missingStyle(doc, spec) ??
            wordsSetApart(
              spec,
              group.places.map(({ sec, para }) => [containerOf(doc, { sec, para }), para]),
            )
          )
        })
        if (refusal) return refusal
        return keepingObjects((mustKeep) =>
          change(
            'format-look',
            (doc) => {
              const group = find(doc)
              if (!group) throw fail('CHANGED', 'the document changed mid-call')
              const before = objectsOf(doc)
              const { chars, paragraph, style, charShape } = resolveFormat(doc, spec)
              let keptOwnLook = 0
              const marks = []
              for (const { sec, para } of group.places) {
                const box = containerOf(doc, { sec, para, charOffset: 0 })
                const length = box.length(para)
                if (style !== null && keepsOwnLook(doc, box, para) === true) keptOwnLook += 1
                if (style !== null) box.applyStyle(para, style)
                if (charShape !== null && length > 0) box.setCharShape(para, 0, length, charShape)
                if (paragraph) box.formatParagraph(para, paragraph)
                if (chars && length > 0) box.formatChars(para, 0, length, chars)
                marks.push(box.place(para, length))
              }
              mustKeep(before, objectsOf(doc))
              return {
                ok: true,
                paragraphs: group.places.length,
                place: marks[0],
                marks,
                ...(keptOwnLook > 0 ? { keptOwnLook } : {}),
              }
            },
            options,
          ),
        )
      }),

      /**
       * The memos of the document in document order, each with the page its anchor starts
       * on and the rectangles it covers, or the caret bar of one with no text range.
       */
      listMemos: guarded(() => {
        listedMemos = null
        // An older engine has no memo API. Say so instead of pretending the
        // document has no memos: the panel then keeps its screen closed.
        let supported = true
        try {
          supported = host.read((doc) => typeof doc.getMemoList === 'function') !== false
        } catch {
          // no document yet: let the list read answer
        }
        try {
          host.automation.execute(MEMO_LIST_COMMAND)
        } catch {
          // an editor without commands: the list is read here
        }
        const memos = listedMemos ?? host.read(memoListOf)
        memoKnown = memos.map(memoSummaryOf)
        return { count: memos.length, memos, supported }
      }),

      /**
       * Whether the selection (or the caret, when nothing is selected) may carry a memo
       * anchor: one paragraph, a place this app edits, no existing memo there, and an
       * unprotected document. What it holds is the preview the panel shows.
       */
      memoSelection: guarded(() => {
        memoAnchorAnswer = null
        try {
          host.automation.execute(MEMO_SELECTION_COMMAND)
        } catch {
          return { ok: false, reason: 'none' }
        }
        return memoAnchorAnswer ?? { ok: false, reason: 'none' }
      }),

      /** Add a memo at an anchor the selection gave, in one undo step. */
      insertMemo: guarded((anchor, author, text, options) => {
        const checked = checkMemoAnchor(anchor)
        if (typeof text !== 'string') throw fail('BAD_ARGUMENT', 'text must be a string')
        if (text.length > MAX_MEMO_TEXT) return { ok: false, reason: 'memo_text_too_long' }
        const refusal = host.read((doc) => {
          if (memoProtected(doc)) {
            return { ok: false, reason: 'protected' }
          }
          const box = containerOf(doc, {
            sec: checked.sectionIndex,
            para: checked.paraIndex,
            cellPath: checked.path,
          })
          if (box.length(checkedK(checked)) < checked.endCharIdx) {
            return { ok: false, reason: 'memo_invalid_range' }
          }
          const key = `${checked.sectionIndex}:${checked.paraIndex}:${memoPathKey(checked.path)}`
          if (memoOverlaps(memoEntriesOf(doc), key, checked.startCharIdx, checked.endCharIdx)) {
            return { ok: false, reason: 'memo_overlap' }
          }
          return null
        })
        if (refusal) return refusal
        return memoCommand('memo-insert', options, (doc) => {
          const json = JSON.stringify({ author: memoAuthorOf(author), text })
          const made = parse(
            checked.path
              ? doc.insertMemoByPath(
                  checked.sectionIndex,
                  checked.paraIndex,
                  JSON.stringify(checked.path),
                  checked.startCharIdx,
                  checked.endCharIdx,
                  json,
                )
              : doc.insertMemo(
                  checked.sectionIndex,
                  checked.paraIndex,
                  checked.startCharIdx,
                  checked.endCharIdx,
                  json,
                ),
          )
          if (!made || made.ok !== true) {
            throw fail('ENGINE_REFUSED', 'the editor refused to add the memo')
          }
          return { ok: true, id: made.id, index: made.index }
        })
      }),

      /** Replace the whole text of a memo, keeping its author and date, in one undo step. */
      setMemo: guarded((id, text, options) => {
        if (!Number.isInteger(id)) return { ok: false, reason: 'memo_not_found' }
        if (typeof text !== 'string') throw fail('BAD_ARGUMENT', 'text must be a string')
        if (text.length > MAX_MEMO_TEXT) return { ok: false, reason: 'memo_text_too_long' }
        const refusal = host.read((doc) => {
          if (memoProtected(doc)) {
            return { ok: false, reason: 'memo_read_only', why: 'protected' }
          }
          const memo = memoEntriesOf(doc).find((entry) => entry.id === id)
          if (!memo) return { ok: false, reason: 'memo_not_found' }
          if (memo.editable !== true) {
            return { ok: false, reason: 'memo_read_only', why: memo.readOnlyReason ?? null }
          }
          return null
        })
        if (refusal) return refusal
        return memoCommand('memo-set', options, (doc) => {
          expectOk(doc.setMemoText(id, text), 'change the memo')
          return { ok: true }
        })
      }),

      /** Remove a memo and its text, keeping the text it was put on, in one undo step. */
      removeMemo: guarded((id, options) => {
        if (!Number.isInteger(id)) return { ok: false, reason: 'memo_not_found' }
        const refusal = host.read((doc) => {
          if (memoProtected(doc)) {
            return { ok: false, reason: 'memo_read_only', why: 'protected' }
          }
          const memo = memoEntriesOf(doc).find((entry) => entry.id === id)
          if (!memo) return { ok: false, reason: 'memo_not_found' }
          if (memo.readOnlyReason === 'protected' || memo.readOnlyReason === 'unsupported_place') {
            return { ok: false, reason: 'memo_read_only', why: memo.readOnlyReason }
          }
          return null
        })
        if (refusal) return refusal
        return memoCommand('memo-remove', options, (doc) => {
          expectOk(doc.removeMemo(id), 'remove the memo')
          return { ok: true }
        })
      }),

      /** Show the memo anchors on the pages while the panel is open, or take them off. */
      showMemoAnchors: guarded((shown) => {
        memoShown = shown === true
        if (!memoShown && stopMemoLayer) {
          stopMemoLayer()
          stopMemoLayer = null
        }
        refreshMemoAnchors()
        return { ok: true, shown: memoShown }
      }),

      /** Make one memo's anchor stronger on the pages, or none. */
      selectMemo: guarded((id) => {
        memoSelected = Number.isInteger(id) ? id : null
        refreshMemoAnchors()
        return { ok: true, id: memoSelected }
      }),

      /** Take the editor's input away while the app's memo modal is open. */
      setMemoLock: guarded((locked) => setMemoLock(locked === true)),

      /** Take the marks of the changes made so far off the pages. */
      clearMarks: guarded(() => {
        marks = []
        refreshMarks()
        return { ok: true }
      }),

      /**
       * Whether the pages carry marks of changes now. They go by themselves when the user
       * edits the document, and the AI panel asks so its button to clear them goes too.
       */
      hasMarks: guarded(() => ({ ok: true, shown: marks.length > 0 })),

      /**
       * How the editor lays out the tabs a save found without a width (`spots`, from the
       * saved file): for each, its width in HWPUNIT and the kind and leader of its tab stop,
       * or null where it cannot tell. Reads only.
       */
      measureTabs: guarded((spots) => {
        if (!Array.isArray(spots) || spots.length > MAX_MEASURED_TABS) {
          throw fail('BAD_ARGUMENT', 'spots must be a list of tab places')
        }
        return host.read((doc) => ({
          tabs: spots.map((spot) => {
            try {
              return measureTab(doc, spot)
            } catch {
              return null
            }
          }),
        }))
      }),

      /**
       * The preview a save writes over the one the engine kept from the opened file
       * (decision 0146): the first lines and the first page of the document as it is now.
       * A page that cannot be drawn comes back as null; the text is always read. Reads only.
       */
      savePreview: guarded(() =>
        host.read((doc) => ({
          text: previewTextOf(doc),
          png: tryOr(() => previewPngOf(doc), null),
        })),
      ),

      /**
       * Undo the last `steps` changes through the editor's own history, but only while
       * `expectedForeign` still equals foreignChanges(): the check and the undo happen here,
       * in one go, so nothing can slip in between them.
       */
      undo: guarded((steps, expectedForeign) => {
        if (!Number.isInteger(steps) || steps < 1 || steps > MAX_UNDO_STEPS) {
          throw fail('BAD_ARGUMENT', 'steps must be a small positive integer')
        }
        if (expectedForeign !== foreign) return { ok: false, reason: 'changed', undone: 0 }
        let undone = 0
        own = true
        text = null
        try {
          for (let i = 0; i < steps; i++) {
            const result = host.automation.execute('edit:undo')
            if (!result || result.ok !== true) break
            undone += 1
          }
        } finally {
          own = false
        }
        // an undo can bring memos back, and moves their anchors
        syncMemos({ notify: false })
        refreshMemoAnchors()
        return { ok: undone === steps, undone }
      }),
    }

    // The three changes the panel makes are editor commands too: a caller that has only the
    // command line of the editor passes the same arguments as the method. A command returns
    // nothing itself, so the panel calls the methods when it needs the answer.
    for (const [id, label, call] of [
      [
        MEMO_INSERT_COMMAND,
        'Add a memo',
        (params) => api.insertMemo(params?.anchor, params?.author, params?.text, params?.options),
      ],
      [
        MEMO_SET_COMMAND,
        'Change the memo',
        (params) => api.setMemo(params?.id, params?.text, params?.options),
      ],
      [
        MEMO_REMOVE_COMMAND,
        'Remove the memo',
        (params) => api.removeMemo(params?.id, params?.options),
      ],
    ]) {
      try {
        host.automation.registerCommand({
          id,
          label,
          execute: (_services, params) => {
            try {
              call(params)
            } catch {
              // a failed call leaves the document as it was; the panel reads the list again
            }
          },
        })
      } catch {
        // registered by an earlier activation of this plugin, or a host without commands
      }
    }

    return api
  },
}

export default agentPlugin
