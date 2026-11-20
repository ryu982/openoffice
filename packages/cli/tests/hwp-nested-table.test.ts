import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { run, tempDir } from './helpers'

/**
 * The table ops of `hwp apply` on a table inside a cell of another table. They are the in-app
 * AI's tools over the same plugin, so they reach such a table by its cell path as the app does
 * (rhwp patch 0055), with the same output and the same refusals as on a body table.
 *
 * nested-form.hwp (made in Hancom Hangul): a 5×2 table in body paragraph 2 whose last cell
 * holds an 8×9 table (table 2), a 6×2 (table 3) and a 4×2 table (table 4).
 */
const FORM = join(
  __dirname,
  '..',
  '..',
  '..',
  'apps',
  'hwp',
  'tests',
  'fixtures',
  'nested-form.hwp',
)
/** Table 3's cell path from body paragraph 2, and the outer table's. */
const INNER = JSON.stringify([
  { controlIndex: 0, cellIndex: 9, cellParaIndex: 11 },
  { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 },
])
const OUTER = JSON.stringify([{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }])

beforeAll(async () => {
  const wasm = createRequire(import.meta.url).resolve('@rhwp/core/rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

function prepare(list: unknown) {
  const dir = tempDir()
  const path = join(dir, 'form.hwp')
  writeFileSync(path, readFileSync(FORM))
  const opsPath = join(dir, 'ops.json')
  writeFileSync(opsPath, JSON.stringify(list))
  return { path, opsPath }
}

function dims(path: string, table: string) {
  const doc = new HwpDocument(readFileSync(path))
  try {
    return JSON.parse(doc.getTableDimensionsByPath(0, 2, table))
  } finally {
    doc.free()
  }
}

describe('ieumoffice hwp apply on a table inside a table', () => {
  it('adds rows, merges and colours its cells; the outer table stays and the answers keep their shape', async () => {
    const { path, opsPath } = prepare([
      { op: 'format_cells', table: 1, cells: [{ row: 1, col: 1 }], background: '#eeeeee' },
      { op: 'format_cells', table: 3, cells: [{ row: 1, col: 1 }], background: '#eeeeee' },
      { op: 'add_to_table', table: 3, what: 'rows', at: 6, count: 2 },
      { op: 'merge_cells', table: 3, from_row: 7, from_col: 1, to_row: 7, to_col: 2 },
      { op: 'remove_from_table', table: 3, what: 'columns', at: 2 },
    ])
    const outer = dims(path, OUTER)
    const r = await run(['hwp', 'apply', path, '--ops', opsPath, '--json'])
    expect(r.code, r.stdout).toBe(0)
    const { detail } = r.json()
    expect(detail.batch).toMatchObject({ total: 5, applied: 5, failed: 0 })
    const [flat, nested] = detail.results
    expect(Object.keys(nested).sort()).toEqual(Object.keys(flat).sort())
    expect(detail.results.every((step: { changed: boolean }) => step.changed)).toBe(true)
    expect(dims(path, INNER)).toMatchObject({ rowCount: 8, colCount: 1 })
    expect(dims(path, OUTER)).toEqual(outer)
  })

  it('refuses what a body table refuses, and writes nothing', async () => {
    const { path, opsPath } = prepare([
      { op: 'remove_from_table', table: 3, what: 'rows', at: 1, count: 6 },
    ])
    const before = readFileSync(path)
    const r = await run(['hwp', 'apply', path, '--ops', opsPath, '--json'])
    expect(r.code).toBe(1)
    expect(r.json().detail.failures[0]).toMatchObject({
      index: 0,
      op: 'remove_from_table',
      reason: 'op_rejected',
    })
    expect(readFileSync(path).equals(before)).toBe(true)
  })
})
