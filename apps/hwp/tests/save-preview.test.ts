/**
 * A save writes the preview of the document as it is now (decision 0146). The engine
 * carries the opened file's `PrvText` and `PrvImage` into every save, so text deleted
 * before saving stayed readable in the file and the first-page picture showed the old
 * page. These run the real engine and the plugin's savePreview, then the save's fixes.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import * as CFB from 'cfb'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { agentPlugin, type AgentPluginHost } from '../studio-plugin/agent-plugin.mjs'
import { applySaveFixes } from '../src/main/save-fixes'
import { BLANK_PNG, PREVIEW_TEXT_CHARS, writePreview } from '../src/main/preview-parts'

const require = createRequire(import.meta.url)
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name))

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

function pluginOf(doc: HwpDocument) {
  const host = {
    read: (fn: (d: never) => unknown) => fn(doc as never),
    transaction: () => {
      throw new Error('the preview changes nothing')
    },
    events: { on: () => 0 },
    automation: { registerCommand: () => {}, execute: () => ({ ok: false }) },
  } as unknown as AgentPluginHost
  return agentPlugin.activate(host)
}

/** Every body paragraph emptied, as a user who deleted the document's text. */
function emptied(doc: HwpDocument): void {
  for (let sec = 0; sec < doc.getSectionCount(); sec++) {
    for (let para = 0; para < doc.getParagraphCount(sec); para++) {
      const length = doc.getParagraphLength(sec, para)
      if (length > 0) doc.deleteText(sec, para, 0, length)
    }
  }
}

async function hwpxPreview(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  return {
    text: await zip.file('Preview/PrvText.txt')!.async('string'),
    image: Buffer.from(await zip.file('Preview/PrvImage.png')!.async('uint8array')),
  }
}

function hwpPreview(bytes: Uint8Array) {
  const cfb = CFB.read(Buffer.from(bytes), { type: 'buffer' })
  return {
    text: Buffer.from(CFB.find(cfb, '/PrvText')!.content as Uint8Array).toString('utf16le'),
    image: Buffer.from(CFB.find(cfb, '/PrvImage')!.content as Uint8Array),
  }
}

describe('the plugin makes the preview text the way Hangul writes it', () => {
  it('a line per paragraph and a table row as <cell><cell>', () => {
    const doc = HwpDocument.createEmpty()
    doc.createBlankDocument()
    doc.insertText(0, 0, 0, '첫 줄')
    doc.splitParagraph(0, 0, doc.getParagraphLength(0, 0))
    doc.pasteHtml(
      0,
      1,
      0,
      '<table><tr><td>이름</td><td>값</td></tr><tr><td>가</td><td>나</td></tr></table>',
    )
    const { text, png } = pluginOf(doc).savePreview()
    expect(text.startsWith('첫 줄\r\n')).toBe(true)
    expect(text).toContain('<이름><값>\r\n<가><나>\r\n')
    // no DOM here: no picture, and the save writes the blank one
    expect(png).toBeNull()
  })

  it.each([
    // a press release: tables of merged cells under a title table
    'memo-source.hwp',
    // a form whose cell holds a table of its own
    'nested-form.hwp',
    'memo-short-header-tail.hwp',
    // text boxes stand where they are in the paragraph
    'paper-topbottom-box-stale-ladder.hwpx',
    // a table and the text after it share a line
    'square-picture-after-page-reset.hwpx',
    'para-float-tail-table.hwpx',
  ])('matches the preview Hangul 2024 wrote into %s', async (name) => {
    const bytes = fixture(name)
    const hancom = name.endsWith('.hwpx')
      ? await (await JSZip.loadAsync(bytes)).file('Preview/PrvText.txt')!.async('string')
      : hwpPreview(bytes).text
    const { text } = pluginOf(new HwpDocument(bytes)).savePreview()
    expect(text).toBe(Array.from(hancom).slice(0, PREVIEW_TEXT_CHARS).join(''))
  })

  it('stops at the length Hangul keeps', () => {
    const doc = HwpDocument.createEmpty()
    doc.createBlankDocument()
    doc.insertText(0, 0, 0, '가'.repeat(3000))
    const { text } = pluginOf(doc).savePreview()
    expect(Array.from(text).length).toBe(PREVIEW_TEXT_CHARS)
  })
})

describe('a save of an edited HWPX', () => {
  it('the engine alone keeps the opened file’s preview text', async () => {
    const doc = new HwpDocument(fixture('hancom-page-number-no-dash.hwpx'))
    emptied(doc)
    expect((await hwpxPreview(doc.exportHwpx())).text).toBe('a\r\nb\r\n')
  })

  it('writes the text and picture of the document as it is now', async () => {
    const doc = new HwpDocument(fixture('hancom-page-number-no-dash.hwpx'))
    const before = (await hwpxPreview(doc.exportHwpx())).image
    expect(before.length).toBeGreaterThan(1000)
    emptied(doc)
    doc.insertText(0, 0, 0, '새 글')
    const preview = pluginOf(doc).savePreview()
    const saved = applySaveFixes(
      doc.exportHwpx(),
      'hwpx',
      undefined,
      {},
      {
        text: preview.text,
        image: null,
      },
    ).bytes
    const after = await hwpxPreview(saved)
    expect(after.text.startsWith('새 글\r\n')).toBe(true)
    expect(after.text).not.toContain('a\r\nb')
    expect(after.image.equals(BLANK_PNG)).toBe(true)
    expect(after.image.equals(before)).toBe(false)
    // the rest of the file reads back the same
    const back = new HwpDocument(saved)
    expect(back.pageCount()).toBe(doc.pageCount())
    expect(back.getTextRange(0, 0, 0, back.getParagraphLength(0, 0))).toBe('새 글')
  })

  it('puts in a drawn page as given and leaves every other entry’s bytes alone', async () => {
    const doc = new HwpDocument(fixture('hancom-page-number-no-dash.hwpx'))
    const exported = doc.exportHwpx()
    const page = Buffer.concat([BLANK_PNG, Buffer.from('page')])
    const saved = writePreview(exported, 'hwpx', { text: 'x\r\n', image: page })!
    const after = await hwpxPreview(saved)
    expect(after.text).toBe('x\r\n')
    expect(after.image.equals(page)).toBe(true)
    const was = await JSZip.loadAsync(exported)
    const now = await JSZip.loadAsync(saved)
    expect(Object.keys(now.files)).toEqual(Object.keys(was.files))
    for (const name of Object.keys(was.files)) {
      if (name.startsWith('Preview/')) continue
      const a = await was.file(name)?.async('uint8array')
      const b = await now.file(name)?.async('uint8array')
      expect(Buffer.from(b ?? []).equals(Buffer.from(a ?? []))).toBe(true)
    }
  })

  it('a picture that is not a PNG becomes the blank one', async () => {
    const doc = new HwpDocument(fixture('hancom-page-number-no-dash.hwpx'))
    const saved = writePreview(doc.exportHwpx(), 'hwpx', {
      text: '',
      image: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    })!
    expect((await hwpxPreview(saved)).image.equals(BLANK_PNG)).toBe(true)
  })
})

describe('a save of an edited HWP', () => {
  it('the engine alone keeps the opened file’s preview text', () => {
    const doc = new HwpDocument(fixture('memo-short-header-tail.hwp'))
    emptied(doc)
    expect(hwpPreview(doc.exportHwp()).text).toContain('설 차례 상')
  })

  it('writes the text and picture of the document as it is now, uncompressed', () => {
    const doc = new HwpDocument(fixture('memo-short-header-tail.hwp'))
    emptied(doc)
    doc.insertText(0, 0, 0, '새 글')
    const preview = pluginOf(doc).savePreview()
    const saved = applySaveFixes(
      doc.exportHwp(),
      'hwp',
      undefined,
      {},
      {
        text: preview.text,
        image: null,
      },
    ).bytes
    const after = hwpPreview(saved)
    expect(after.text.startsWith('새 글\r\n')).toBe(true)
    expect(after.text).not.toContain('설 차례 상')
    expect(after.image.equals(BLANK_PNG)).toBe(true)
    const back = new HwpDocument(saved)
    expect(back.pageCount()).toBe(doc.pageCount())
    expect(back.getTextRange(0, 0, 0, back.getParagraphLength(0, 0))).toBe('새 글')
  })
})

describe('a save without a preview', () => {
  it('(a recovery copy) leaves the bytes the engine wrote', () => {
    const doc = new HwpDocument(fixture('hancom-page-number-no-dash.hwpx'))
    const exported = doc.exportHwpx()
    const saved = applySaveFixes(exported, 'hwpx', undefined, {}).bytes
    expect(Buffer.from(saved).equals(Buffer.from(exported))).toBe(true)
  })
})
