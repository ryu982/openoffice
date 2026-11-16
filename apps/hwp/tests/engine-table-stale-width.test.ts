/**
 * vendor/rhwp-core patch 0047 on a public reproduction of a court form (its text
 * replaced by filler, its title, author and preview emptied; issue #490).
 *
 * Hangul stores the size of a table object and the widths of its cells separately,
 * and this table's object width is stale: 41,563 HWPUNIT, while each of the seven
 * rows that close the grid on their own adds up to 46,971. The cell widths also
 * disagree about one boundary: the fifth cell of row 15 ends at 35,158, past the
 * 34,377 where the rows above put the boundary after it.
 *
 * Hangul 2024 draws the table from its cell widths and treats them as lower bounds.
 * Its print (saved as PDF, vertical rules measured from the table's left edge) has
 * the boundaries at 0, 6,920, 10,033, 14,245, 26,312, 35,158, 35,158, 38,891, 41,455
 * and 47,752: the boundary of the rows above moves out to 35,158, and the table ends
 * 781 beyond the width of its rows.
 *
 * Before the patch the engine dropped every closing row as wider than the table, so
 * nothing but the rows around it fixed the fifth column. The cell that has that
 * column to itself, stored 8,846 wide, was drawn 4,032 wide and its text ran into the
 * next cell.
 *
 * The engine keeps upstream's minimum column of 96 behind a pushed boundary, where
 * Hangul leaves none. Three boundaries therefore sit 96 (0.34 mm) right of Hangul's.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

/** The form's table: section 0, paragraph 0, control 2 (18 rows, 9 columns). */
const AT = [0, 0, 2] as const
/** Column boundaries Hangul 2024 prints, in HWPUNIT from the table's left edge. */
const HANCOM = [0, 6920, 10033, 14245, 26312, 35158, 35158, 38891, 41455, 47752]
/** Boundaries that lie behind the pushed one and so carry the engine's minimum column. */
const BEHIND_THE_PUSH = new Set([6, 8, 9])
const MINIMUM_COLUMN = 96
const HU_PER_PX = 7200 / 96
/** Boxes come back in pixels with one decimal; a tenth of a pixel is 7.5 HWPUNIT. */
const CLOSE = 12

interface Box {
  cellIdx: number
  row: number
  col: number
  colSpan: number
  x: number
  w: number
}

const open = () =>
  new HwpDocument(
    new Uint8Array(
      readFileSync(join(__dirname, 'fixtures', 'stale-table-width-pushed-boundary.hwpx')),
    ),
  )

const boxes = (doc: HwpDocument): Box[] => JSON.parse(doc.getTableCellBboxes(...AT))

/** For each boundary index, every position (HWPUNIT from the table's left edge) a cell edge has there. */
function boundaries(cells: Box[]): number[][] {
  const left = Math.min(...cells.map((cell) => cell.x))
  const at: number[][] = Array.from({ length: HANCOM.length }, () => [])
  for (const cell of cells) {
    at[cell.col].push((cell.x - left) * HU_PER_PX)
    at[cell.col + cell.colSpan].push((cell.x + cell.w - left) * HU_PER_PX)
  }
  return at
}

describe('a table whose object width is stale (patch 0047, issue #490)', () => {
  it('keeps what the file stores', () => {
    const doc = open()
    expect(JSON.parse(doc.getTableDimensions(...AT))).toMatchObject({ rowCount: 18, colCount: 9 })
    expect(JSON.parse(doc.getTableProperties(...AT)).tableWidth).toBe(41563)
    const lone = boxes(doc).find((cell) => cell.row === 15 && cell.col === 4)
    expect(lone?.colSpan).toBe(1)
    expect(JSON.parse(doc.getCellProperties(...AT, lone!.cellIdx)).width).toBe(8846)
  })

  it('draws the cell that has the fifth column to itself at its stored width', () => {
    const lone = boxes(open()).find((cell) => cell.row === 15 && cell.col === 4)
    // 4,032 before the patch: half of what the rows around it left for two columns
    expect(Math.abs(lone!.w * HU_PER_PX - 8846)).toBeLessThanOrEqual(CLOSE)
  })

  it('gives every column boundary one position, in order, in all rows', () => {
    const at = boundaries(boxes(open()))
    let previous = -1
    for (const [index, positions] of at.entries()) {
      expect(positions.length, `boundary ${index} has a cell edge`).toBeGreaterThan(0)
      const spread = Math.max(...positions) - Math.min(...positions)
      expect(spread, `boundary ${index} differs between rows`).toBeLessThanOrEqual(CLOSE)
      expect(Math.min(...positions), `boundary ${index} is not after ${index - 1}`).toBeGreaterThan(
        previous,
      )
      previous = Math.max(...positions)
    }
  })

  it('puts the boundaries where Hangul 2024 prints them, plus the minimum column behind the pushed one', () => {
    const at = boundaries(boxes(open()))
    const drawn = at.map((positions) => positions.reduce((sum, x) => sum + x, 0) / positions.length)
    const expected = HANCOM.map((x, index) => x + (BEHIND_THE_PUSH.has(index) ? MINIMUM_COLUMN : 0))
    for (const [index, x] of expected.entries()) {
      expect(
        Math.abs(drawn[index] - x),
        `boundary ${index}: ${drawn[index]} for ${x}`,
      ).toBeLessThanOrEqual(CLOSE)
    }
    // the table ends beyond both its stored width and the width of its rows, as in Hangul
    expect(drawn[9]).toBeGreaterThan(46971)
  })
})
