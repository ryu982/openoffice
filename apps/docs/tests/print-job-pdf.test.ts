// Advanced print route of the word editor (decision 0141): the job PDF is the
// chosen preview pages (the PDF export's own printToPDF per paper size), and a
// printed selection is a .docx of the selected content only, laid out as one
// section (the one the selection starts in) numbered from page 1.
import { afterEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { Editor } from '@tiptap/core'
import { buildBlankDocx, parseDocx, readSections, saveDocx } from '@genoffice/docx-engine'
import {
  mergePrintJobParts,
  printPdfDefaultName,
  readDocsPrintJob,
  selectionDocumentXml,
  selectionDocxForPrint,
  validSectPrXml,
} from '../src/main/print-job-pdf'
import {
  printJobGroups,
  previewPageSize,
  selectionPrintDoc,
  selectionSectPr,
} from '../src/renderer/print-job'
import { blocksToPmDoc, pmDocToSavePlan } from '../src/renderer/editor/convert'
import { sectionIndexAtBlock } from '../src/renderer/ai/pending-sections'

const A4 = { w: 11906, h: 16838 }
const LETTER_LANDSCAPE = { w: 15840, h: 12240 }

describe('job pages of the chosen range', () => {
  it('leaves pages outside the range out of every printToPDF call', () => {
    const sizes = [A4, A4, A4, A4, A4]
    expect(printJobGroups(sizes, [1, 3, 4])).toEqual([
      { ...A4, from: 1, to: 1 },
      { ...A4, from: 3, to: 4 },
    ])
  })

  it('splits runs at a paper change and at the chunk size', () => {
    const sizes = [A4, A4, LETTER_LANDSCAPE, LETTER_LANDSCAPE, A4]
    expect(printJobGroups(sizes, [0, 1, 2, 3, 4])).toEqual([
      { ...A4, from: 0, to: 1 },
      { ...LETTER_LANDSCAPE, from: 2, to: 3 },
      { ...A4, from: 4, to: 4 },
    ])
    expect(printJobGroups([A4, A4, A4, A4, A4], [0, 1, 2, 3, 4], 2)).toEqual([
      { ...A4, from: 0, to: 1 },
      { ...A4, from: 2, to: 3 },
      { ...A4, from: 4, to: 4 },
    ])
  })

  it('ignores duplicates and pages that do not exist', () => {
    expect(printJobGroups([A4, A4], [1, 1, 7, -1])).toEqual([{ ...A4, from: 1, to: 1 }])
  })

  it('reads a preview sheet in points', () => {
    expect(previewPageSize(816, 1056)).toEqual({ widthPt: 612, heightPt: 792 })
  })
})

async function pdfOf(sizes: Array<[number, number]>): Promise<string> {
  const doc = await PDFDocument.create()
  for (const [w, h] of sizes) doc.addPage([w, h])
  return Buffer.from(await doc.save()).toString('base64')
}

describe('job PDF from the renderer fragments', () => {
  it('merges the fragments in order', async () => {
    const merged = await PDFDocument.load(
      await mergePrintJobParts([
        await pdfOf([[612, 792]]),
        await pdfOf([
          [792, 612],
          [595, 842],
        ]),
      ]),
    )
    expect(merged.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([
      [612, 792],
      [792, 612],
      [595, 842],
    ])
  })

  it('checks the request', () => {
    expect(readDocsPrintJob({ parts: ['AA=='], name: 'a.docx' })).toEqual({
      parts: ['AA=='],
      name: 'a.docx',
    })
    for (const bad of [null, {}, { parts: [] }, { parts: [1] }, { parts: [''] }, 'x']) {
      expect(() => readDocsPrintJob(bad)).toThrow()
    }
  })

  it('names the saved PDF after the document', () => {
    expect(printPdfDefaultName('Report.docx')).toBe('Report.pdf')
    expect(printPdfDefaultName('C:\\x\\notes.odt')).toBe('notes.pdf')
    expect(printPdfDefaultName(undefined)).toBe('document.pdf')
  })
})

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const SECT_1 =
  '<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>' +
  '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>' +
  '<w:pgNumType w:start="7"/><w:titlePg/></w:sectPr>'
const SECT_2 =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
  '<w:pgNumType w:fmt="decimal" w:start="3"/></w:sectPr>'

describe('the selection as one section', () => {
  it('drops paragraph section breaks and numbers the body section from 1', () => {
    const xml =
      `<w:document ${W}><w:body>` +
      `<w:p><w:pPr>${SECT_1.replace('</w:sectPr>', `<w:sectPrChange w:id="1"><w:sectPr/></w:sectPrChange></w:sectPr>`)}</w:pPr><w:r><w:t>A</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>B</w:t></w:r></w:p>${SECT_2}</w:body></w:document>`
    const out = selectionDocumentXml(xml, null)
    expect(out).not.toContain('w:orient="landscape"')
    expect(out).not.toContain('sectPrChange')
    expect(out.match(/<w:sectPr>/g)).toHaveLength(1)
    expect(out).toContain('<w:pgNumType w:fmt="decimal" w:start="1"/></w:sectPr></w:body>')
    expect(out).toContain('<w:t>A</w:t>')
    expect(out).toContain('<w:t>B</w:t>')
  })

  it('takes the given section in place of the body section', () => {
    const xml = `<w:document ${W}><w:body><w:p><w:r><w:t>B</w:t></w:r></w:p>${SECT_2}</w:body></w:document>`
    const out = selectionDocumentXml(xml, SECT_1)
    expect(out).toContain('w:orient="landscape"')
    expect(out).not.toContain('w:w="11906"')
    expect(out).toContain('<w:pgNumType w:start="1"/>')
    expect(out.endsWith('</w:sectPr></w:body></w:document>')).toBe(true)
  })

  it('adds a given section to a body without one', () => {
    const xml = `<w:document ${W}><w:body><w:p/></w:body></w:document>`
    expect(selectionDocumentXml(xml, SECT_1)).toContain(
      `<w:p/>${SECT_1.replace('w:start="7"', 'w:start="1"')}</w:body>`,
    )
  })

  it('accepts only section properties as the section', () => {
    expect(validSectPrXml(SECT_1)).toBe(true)
    expect(validSectPrXml('<w:sectPr/>')).toBe(true)
    expect(validSectPrXml('<w:p/>')).toBe(false)
    expect(validSectPrXml(`${SECT_1}<w:p/>`)).toBe(false)
    expect(validSectPrXml(42)).toBe(false)
  })
})

const liveEditors: Editor[] = []
afterEach(() => {
  for (const editor of liveEditors.splice(0)) editor.destroy()
})

/** a two-section document: Alpha, Bravo | break (landscape, own numbering) | Charlie */
async function twoSectionDocx(): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await buildBlankDocx())
  const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
  const body =
    para('Alpha one') +
    para('Bravo two') +
    `<w:p><w:pPr>${SECT_1}</w:pPr></w:p>` +
    para('Charlie three') +
    SECT_2
  const docXml = (await zip.file('word/document.xml')!.async('string')).replace(
    /<w:body>[\s\S]*<\/w:body>/,
    `<w:body>${body}</w:body>`,
  )
  zip.file('word/document.xml', docXml)
  return zip.generateAsync({ type: 'uint8array' })
}

/** the text of every body paragraph, in order */
function paragraphTexts(xml: string): string[] {
  return [...xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map((m) =>
    [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''),
  )
}

describe('a printed selection', () => {
  it('holds only the selected text from its first character, in the starting section', async () => {
    const parsed = await parseDocx(await twoSectionDocx())
    const { editorExtensions } = await import('../src/renderer/editor/extensions')
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
    })
    liveEditors.push(editor)
    const sections = readSections(parsed)
    editor.commands.setContent(blocksToPmDoc(parsed.blocks, sections) as never)
    // select "one" … "Bra"
    let from = -1
    let to = -1
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return
      const text = node.text ?? ''
      if (text.startsWith('Alpha')) from = pos + text.indexOf('one')
      if (text.startsWith('Bravo')) to = pos + 'Bra'.length
    })
    expect(from).toBeGreaterThan(0)
    expect(to).toBeGreaterThan(from)

    const sel = selectionPrintDoc(editor.state.doc, from, to)!
    const saved = await saveDocx(parsed, pmDocToSavePlan(sel, parsed.blocks).saveBlocks, {})
    const start = sectionIndexAtBlock(
      editor.state.doc,
      sections,
      editor.state.doc.resolve(from).index(0),
    )
    expect(start).toBe(0)
    const sectPr = selectionSectPr(sections, start)
    expect(sectPr).not.toBeNull()
    const printed = await selectionDocxForPrint(Buffer.from(saved), sectPr)

    const xml = await (await JSZip.loadAsync(printed)).file('word/document.xml')!.async('string')
    expect(paragraphTexts(xml).filter((t) => t !== '')).toEqual(['one', 'Bra'])
    expect(xml).not.toContain('Alpha')
    expect(xml).not.toContain('Charlie')
    // one section, the first one's landscape paper, page numbers from 1
    expect(xml.match(/<w:sectPr[\s>]/g)).toHaveLength(1)
    expect(xml).toContain('w:orient="landscape"')
    expect(xml).toMatch(/<w:pgNumType w:start="1"\/>/)
    // the printed copy opens as a document of its own
    const reopened = await parseDocx(new Uint8Array(printed))
    const text = JSON.stringify(reopened.blocks)
    expect(text).toContain('one')
    expect(text).not.toContain('Charlie')
    expect(readSections(reopened)).toHaveLength(1)
  })

  it('keeps the last section as the body section when the selection starts there', async () => {
    const parsed = await parseDocx(await twoSectionDocx())
    const sections = readSections(parsed)
    expect(selectionSectPr(sections, sections.length - 1)).toBeNull()
  })

  it('has nothing to print for an empty selection', async () => {
    const parsed = await parseDocx(await buildBlankDocx())
    const { editorExtensions } = await import('../src/renderer/editor/extensions')
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
    })
    liveEditors.push(editor)
    editor.commands.setContent(blocksToPmDoc(parsed.blocks) as never)
    expect(selectionPrintDoc(editor.state.doc, 1, 1)).toBeNull()
  })
})
