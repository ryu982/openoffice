// Editing only part of a line (AI edit_text with a fragment of a PDF text object).
// The engine rewrites the whole object from its own origin, so the text after the
// fragment moves; the pending edit must address the whole run, or the live page
// render (which erases the edit's run) redraws the moved rest under the preview and
// the two overlap. Fixture: plain-sample.pdf, three standard-Courier lines, one
// text object each.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyTextEdits,
  chainPdfium,
  eraseTextRuns,
  loadPdfium,
  saveDoc,
  validateTextEdits,
  withDocument,
} from '../src/main/text-edit'
import { executePdfTool, type PdfAiDeps } from '../src/renderer/ai/tools'
import { buildSearchIndex, type SearchIndex } from '../src/renderer/search'
import {
  foldIntoRunEdit,
  patchPendingEdits,
  planAiTextEdit,
  widenToRun,
} from '../src/renderer/text-edit-preview'
import type { FragmentRun, LocalTextEdit } from '../src/renderer/text-edit-preview'
import type { TextEditInput } from '../src/shared/ipc'

const LINE = 'This line must survive the round trip.'
const fixture = () => new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'plain-sample.pdf')))

/** Every text object of page 1: text and baseline origin */
async function textObjects(bytes: Uint8Array): Promise<{ text: string; x: number; y: number }[]> {
  const m = await loadPdfium()
  return chainPdfium(() =>
    withDocument(m, bytes, async (doc) => {
      const page = m._FPDF_LoadPage(doc, 0)
      const textPage = m._FPDFText_LoadPage(page)
      const matPtr = m._malloc(24)
      const out: { text: string; x: number; y: number }[] = []
      try {
        for (let i = 0; i < m._FPDFPage_CountObjects(page); i++) {
          const obj = m._FPDFPage_GetObject(page, i)
          if (m._FPDFPageObj_GetType(obj) !== 1) continue
          const len = m._FPDFTextObj_GetText(obj, textPage, 0, 0)
          let text = ''
          if (len > 2) {
            const buf = m._malloc(len)
            m._FPDFTextObj_GetText(obj, textPage, buf, len)
            text = Buffer.from(m.HEAPU8.buffer, buf, len - 2).toString('utf16le')
            m._free(buf)
          }
          m._FPDFPageObj_GetMatrix(obj, matPtr)
          out.push({ text, x: m.HEAPF32[(matPtr >> 2) + 4]!, y: m.HEAPF32[(matPtr >> 2) + 5]! })
        }
        return out
      } finally {
        m._free(matPtr)
        m._FPDFText_ClosePage(textPage)
        m._FPDF_ClosePage(page)
      }
    }),
  )
}

/** Erase probes the way the live page preview does, return what is still drawn */
async function afterErase(bytes: Uint8Array, probes: TextEditInput[]) {
  const m = await loadPdfium()
  const res = await chainPdfium(() =>
    withDocument(m, bytes, async (doc) => {
      const page = m._FPDF_LoadPage(doc, 0)
      try {
        const erased = await eraseTextRuns(m, doc, page, 0, bytes, probes)
        return { erased, bytes: saveDoc(m, doc) }
      } finally {
        m._FPDF_ClosePage(page)
      }
    }),
  )
  return { erased: res.erased, objects: await textObjects(res.bytes) }
}

/** The page's search index, built by pdf.js like the app's */
async function indexOf(bytes: Uint8Array): Promise<SearchIndex> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data: bytes.slice() }).promise
  try {
    return await buildSearchIndex(doc as never)
  } finally {
    await doc.loadingTask.destroy()
  }
}

/** Text items of page 1 as pdf.js reads the saved bytes */
async function pageLines(bytes: Uint8Array): Promise<string[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data: bytes.slice() }).promise
  try {
    const content = await (await doc.getPage(1)).getTextContent()
    return content.items.flatMap((i) => ('str' in i && i.str ? [i.str] : []))
  } finally {
    await doc.loadingTask.destroy()
  }
}

/** The app's pending-edit list driven through the real AI tool and engine dry-run */
function aiHarness(bytes: Uint8Array, index: SearchIndex) {
  const pending: LocalTextEdit[] = []
  let n = 0
  const validate = async (e: TextEditInput) => (await validateTextEdits(bytes, [e]))[0]
  const deps = {
    readOnly: () => false,
    pageCount: () => 1,
    isDeleted: () => false,
    editFonts: () => [],
    searchIndex: () => Promise.resolve(index),
    gotoPage: () => true,
    editText: async (raw: TextEditInput) => {
      const planned = await planAiTextEdit(() => pending, raw, validate)
      if ('reason' in planned) return planned.reason
      const { input, cover, owner, gone, moveBy } = planned
      const te: LocalTextEdit = owner
        ? { ...owner, input, cover: cover ?? owner.cover }
        : { id: `e${n++}`, input, cover, moveBy }
      const next = patchPendingEdits(pending, te, gone, owner ? 'replace' : 'upsert')
      pending.splice(0, pending.length, ...next)
      return null
    },
  } as unknown as PdfAiDeps
  const editText = (input: Record<string, unknown>) =>
    executePdfTool(deps, { id: 't', name: 'edit_text', input: { page: 1, ...input } })
  return { pending, editText }
}

describe('engine: a fragment of a larger text object', () => {
  const fragment = (index: SearchIndex): TextEditInput => {
    // The AI tool's rect: the occurrence's share of the pdf.js item
    const entry = index[0]!
    const pos = entry.text.indexOf('This line must survive')
    const it = entry.items.find((i) => i.start <= pos && i.end > pos)!
    const len = it.end - it.start
    const x1 = it.x + (it.w * (pos - it.start)) / len
    const x2 = it.x + (it.w * (pos + 22 - it.start)) / len
    return {
      pageIndex: 0,
      rect: [x1, it.y, x2, it.y + it.h],
      oldText: 'This line must survive',
      newText: 'This line was edited by AI',
      fontSize: it.h,
    }
  }

  it('reports the whole run the save rewrites', async () => {
    const bytes = fixture()
    const [v] = await validateTextEdits(bytes, [fragment(await indexOf(bytes))])
    expect(v!.reason).toBeNull()
    expect(v!.run).toMatchObject({
      oldText: LINE,
      newText: 'This line was edited by AI the round trip.',
      start: 0,
      oldEnd: 22,
      newEnd: 26,
    })
    // A whole-run edit reports no run
    const whole = widenToRun(fragment(await indexOf(bytes)), v!.run!)
    const [w] = await validateTextEdits(bytes, [whole])
    expect(w!.reason).toBeNull()
    expect(w!.run).toBeUndefined()
  })

  it('a fragment erase probe redraws the rest of the run moved to its start (the root cause)', async () => {
    const bytes = fixture()
    const frag = fragment(await indexOf(bytes))
    const { erased, objects } = await afterErase(bytes, [{ ...frag, newText: '' }])
    expect(erased).toEqual([true])
    const rest = objects.find((o) => o.text.includes('the round trip'))!
    // drawn from the line's origin, where the preview puts the replacement
    expect(rest.text.trim()).toBe('the round trip.')
    expect(rest.x).toBeCloseTo(56.8, 1)
  })

  it('the widened edit erases the whole line and saves byte-identically to the fragment', async () => {
    const bytes = fixture()
    const frag = fragment(await indexOf(bytes))
    const [v] = await validateTextEdits(bytes, [frag])
    const wide = widenToRun(frag, v!.run!)
    const { erased, objects } = await afterErase(bytes, [{ ...wide, newText: '' }])
    expect(erased).toEqual([true])
    expect(objects.map((o) => o.text)).toEqual([
      'Encrypted Edit Probe',
      'Second paragraph for text comparison.',
    ])
    const a = await applyTextEdits(bytes, [frag])
    const b = await applyTextEdits(bytes, [wide])
    expect(a.skipped).toEqual([])
    expect(b.skipped).toEqual([])
    expect(Buffer.compare(Buffer.from(a.bytes), Buffer.from(b.bytes))).toBe(0)
  })
})

describe('AI edit_text on part of a line', () => {
  it('queues one whole-run edit whose preview and save agree', async () => {
    const bytes = fixture()
    const { pending, editText } = aiHarness(bytes, await indexOf(bytes))
    const res = await editText({
      old_text: 'This line must survive',
      new_text: 'This line was edited by AI',
    })
    expect(res.isError).toBeUndefined()
    expect(pending).toHaveLength(1)
    const te = pending[0]!
    expect(te.input.oldText).toBe(LINE)
    expect(te.input.newText).toBe('This line was edited by AI the round trip.')
    // the preview box and the cover span the whole run, not the fragment
    expect(te.input.rect[2]).toBeGreaterThan(280)
    expect(te.cover![0]).toBeLessThan(58)
    expect(te.cover![2]).toBeGreaterThan(280)
    // the live render's erase probe takes the whole line away
    const { objects } = await afterErase(bytes, [{ ...te.input, newText: '' }])
    expect(objects.some((o) => o.text.includes('round trip'))).toBe(false)
    // saving writes exactly the edited line, and the other lines stay put
    const out = await applyTextEdits(bytes, [te.input])
    expect(out.skipped).toEqual([])
    expect(await pageLines(out.bytes)).toEqual([
      'Encrypted Edit Probe',
      'This line was edited by AI the round trip.',
      'Second paragraph for text comparison.',
    ])
    const after = await textObjects(out.bytes)
    expect(after.map((o) => [o.text, Math.round(o.x * 10) / 10, Math.round(o.y)])).toEqual([
      ['Encrypted Edit Probe', 56.8, 777],
      ['This line was edited by AI the round trip.', 56.8, 754],
      ['Second paragraph for text comparison.', 56.8, 743],
    ])
  })

  it('styles only the replaced fragment', async () => {
    const bytes = fixture()
    const { pending, editText } = aiHarness(bytes, await indexOf(bytes))
    await editText({
      old_text: 'must survive',
      new_text: 'was edited',
      color: '#d32f2f',
    })
    const te = pending[0]!
    expect(te.input.newText).toBe('This line was edited the round trip.')
    expect(te.input.newColor).toBeUndefined()
    expect(te.input.styleRuns).toEqual([{ start: 10, end: 20, color: [211, 47, 47] }])
  })

  it('folds a second fragment of the same line into the pending edit', async () => {
    const bytes = fixture()
    const { pending, editText } = aiHarness(bytes, await indexOf(bytes))
    await editText({ old_text: 'This line must survive', new_text: 'This line was edited by AI' })
    const second = await editText({ old_text: 'round trip', new_text: 'whole journey' })
    expect(second.isError).toBeUndefined()
    expect(pending).toHaveLength(1)
    expect(pending[0]!.input.newText).toBe('This line was edited by AI the whole journey.')
    const out = await applyTextEdits(
      bytes,
      pending.map((e) => e.input),
    )
    expect(out.skipped).toEqual([])
    expect(await pageLines(out.bytes)).toContain('This line was edited by AI the whole journey.')
  })

  it('refuses a fragment inside text a pending edit already changed', async () => {
    const bytes = fixture()
    const { pending, editText } = aiHarness(bytes, await indexOf(bytes))
    await editText({ old_text: 'must survive', new_text: 'was edited' })
    const again = await editText({ old_text: 'survive the', new_text: 'X' })
    expect(again.isError).toBe(true)
    expect(again.output).toContain('This line was edited the round trip.')
    expect(pending).toHaveLength(1)
  })

  it('a whole-line edit replaces a pending edit of the same line', async () => {
    const bytes = fixture()
    const { pending, editText } = aiHarness(bytes, await indexOf(bytes))
    await editText({ old_text: 'must survive', new_text: 'was edited' })
    await editText({ old_text: LINE, new_text: 'A new line.' })
    expect(pending).toHaveLength(1)
    expect(pending[0]!.input.newText).toBe('A new line.')
  })

  it('leaves whole-run edits as they were', async () => {
    const bytes = fixture()
    const { pending, editText } = aiHarness(bytes, await indexOf(bytes))
    await editText({ old_text: 'Second paragraph for text comparison.', new_text: 'Changed.' })
    expect(pending[0]!.input).toMatchObject({
      oldText: 'Second paragraph for text comparison.',
      newText: 'Changed.',
    })
    expect(pending[0]!.input.styleRuns).toBeUndefined()
  })
})

describe('foldIntoRunEdit', () => {
  const run: FragmentRun = {
    bounds: [0, 0, 100, 10],
    oldText: 'Alpha beta gamma',
    newText: 'Alpha beta GAMMA',
    start: 11,
    oldEnd: 16,
    newEnd: 16,
  }
  const owner = (newText: string, extra: Partial<TextEditInput> = {}): LocalTextEdit => ({
    id: 'o',
    input: {
      pageIndex: 0,
      rect: [0, 0, 100, 10],
      oldText: 'Alpha beta gamma',
      newText,
      fontSize: 10,
      ...extra,
    },
  })
  const widened = (): TextEditInput => ({
    pageIndex: 0,
    rect: [0, 0, 100, 10],
    oldText: run.oldText,
    newText: run.newText,
    fontSize: 10,
  })

  it('maps the fragment past a change that grew the text and shifts style runs', () => {
    const res = foldIntoRunEdit(
      [owner('Alphabet soup beta gamma', { styleRuns: [{ start: 0, end: 13, bold: true }] })],
      widened(),
      run,
    )
    expect(res && 'input' in res && res.input.newText).toBe('Alphabet soup beta GAMMA')
    expect(res && 'input' in res && res.input.styleRuns).toEqual([
      { start: 0, end: 13, bold: true },
    ])
  })

  it('matches an owner whose original text differs only in spacing', () => {
    const res = foldIntoRunEdit(
      [owner('Alpha  beta  gamma!', { oldText: 'Alpha  beta  gamma' })],
      widened(),
      run,
    )
    expect(res && 'input' in res && res.input.newText).toBe('Alpha  beta  GAMMA!')
  })

  it('returns null with no pending edit of the run', () => {
    expect(foldIntoRunEdit([], widened(), run)).toBeNull()
  })
})
