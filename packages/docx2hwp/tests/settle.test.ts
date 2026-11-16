/**
 * A table placed like a character and filled inside the batch keeps the height
 * of its empty frame in the engine's layout, so the .hwp check finds other
 * pages than the engine counted. The converter then writes the .hwp from the
 * file opened again. Body tables no longer go that way (look.ts puts them
 * between the paragraphs); tables inside cells, headers and footers still are
 * placed like characters, so here the look is switched off to bring the case
 * about with a whole document.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../src/look', async (original) => ({
  ...(await original<typeof import('../src/look')>()),
  wordLook: (plan: unknown) => plan,
}))

import { convert } from '../src/convert'
import { Docx2HwpError, HwpEngine, docxToHwp } from '../src/index'
import { FIXTURES } from './helpers/paths'
import { readBack } from './helpers/read-back'

const MARKDOWN_DOCX = `${FIXTURES}/markdown-tables.docx`
const docx = (path: string) => new Uint8Array(readFileSync(path))

describe('a .hwp whose tables grew after they were laid out', () => {
  let engine: HwpEngine
  beforeAll(async () => {
    engine = await HwpEngine.start(
      readFileSync(createRequire(import.meta.url).resolve('@rhwp/core/rhwp_bg.wasm')),
    )
  })

  it('does not pass the check as first written', async () => {
    const core = await import('@rhwp/core')
    const verify = core.HwpDocument.prototype.exportHwpVerify
    const answers: Array<{ pageCountBefore: number; pageCountAfter: number }> = []
    core.HwpDocument.prototype.exportHwpVerify = function (this: unknown, ...args: never[]) {
      const out = (verify as (...a: never[]) => string).apply(this, args)
      answers.push(JSON.parse(out))
      return out
    }
    try {
      await docxToHwp(docx(MARKDOWN_DOCX), 'hwp', engine)
    } finally {
      core.HwpDocument.prototype.exportHwpVerify = verify
    }
    expect(answers).toHaveLength(2)
    expect(answers[0]!.pageCountAfter).not.toBe(answers[0]!.pageCountBefore)
    expect(answers[1]!.pageCountAfter).toBe(answers[1]!.pageCountBefore)
  })

  it('is written from the file opened again, with the pages that file has', async () => {
    const hwpx = await docxToHwp(docx(MARKDOWN_DOCX), 'hwpx', engine)
    const hwp = await docxToHwp(docx(MARKDOWN_DOCX), 'hwp', engine)
    expect([...hwp.bytes.subarray(0, 4)]).toEqual([0xd0, 0xcf, 0x11, 0xe0])
    const [fromHwpx, fromHwp] = [
      await readBack(engine, hwpx.bytes),
      await readBack(engine, hwp.bytes),
    ]
    expect(fromHwp.pages).toBe(fromHwpx.pages)
    expect(fromHwp.body.map((p) => p.text)).toEqual(fromHwpx.body.map((p) => p.text))
    expect(fromHwp.tables.map((t) => t.cells.map((c) => c.texts))).toEqual(
      fromHwpx.tables.map((t) => t.cells.map((c) => c.texts)),
    )
    expect(hwp.losses).toEqual(hwpx.losses)
  })

  it('matches the document written call by call, where the layout never went stale', async () => {
    const settled = await docxToHwp(docx(MARKDOWN_DOCX), 'hwp', engine)
    const slow = await convert(docx(MARKDOWN_DOCX), 'hwp', engine, { batch: false })
    const [a, b] = [await readBack(engine, settled.bytes), await readBack(engine, slow.bytes)]
    const outline = (back: typeof a) => back.body.map((p) => [p.text, p.style, p.controls])
    expect(a.pages).toBe(b.pages)
    expect(outline(a)).toEqual(outline(b))
    expect(a.body.map((p) => p.shape)).toEqual(b.body.map((p) => p.shape))
    expect(a.tables).toEqual(b.tables)
  })

  it('still refuses a .hwp that reads back differently after that', async () => {
    const core = await import('@rhwp/core')
    const verify = core.HwpDocument.prototype.exportHwpVerify
    core.HwpDocument.prototype.exportHwpVerify = () =>
      JSON.stringify({ ok: true, recovered: true, pageCountBefore: 3, pageCountAfter: 4 })
    try {
      const refusal = await docxToHwp(docx(MARKDOWN_DOCX), 'hwp', engine).catch((err) => err)
      expect(refusal).toBeInstanceOf(Docx2HwpError)
      expect(refusal.code).toBe('hwp-readback')
      expect(refusal.message).toBe('the .hwp reads back with 4 pages instead of 3')
    } finally {
      core.HwpDocument.prototype.exportHwpVerify = verify
    }
  })
})
