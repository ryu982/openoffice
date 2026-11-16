/**
 * Advanced print layout (decision 0141) in the built app, checked through the
 * "Save the arranged result as PDF" button so nothing ever reaches a printer:
 *
 * - Word: the "Selection" range lays the selected paragraph out in a hidden
 *   Docs window, and 2 pages per sheet puts it on one landscape face.
 * - PDF: a booklet of five pages is two sheets (four faces) in booklet order;
 *   grayscale saves every face as a gray picture with no text left.
 * - Diagram: Ctrl+P opens the small print dialog; a 2 x 2 poster of the one
 *   page is four pieces.
 * - With every option at its default the dialogs offer no PDF save: Print
 *   stays the print it always was.
 *
 * Save dialogs answer from the main process with paths in a scratch folder.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { PDFDict, PDFDocument, PDFName, PDFStream, StandardFonts } from 'pdf-lib'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'
import {
  answerSaveDialogs,
  copyAsset,
  openDiagramPage,
  openPath,
  saveDialogCalls,
  scratchDir,
} from './diagram-lib'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const ALPHA = 'Alpha paragraph stays out of the print'
const BRAVO = 'Bravo paragraph is the printed selection'
const CHARLIE = 'Charlie paragraph stays out as well'

/** A one-page Letter document of three short paragraphs. */
async function threeParagraphDocx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W_NS}"><w:body>` +
      para(ALPHA) +
      para(BRAVO) +
      para(CHARLIE) +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

/** An A4 portrait PDF whose pages say "P1", "P2", ... in large type. */
async function markedPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([595.28, 841.89])
    page.drawText(`P${i}`, { x: 220, y: 420, size: 96, font })
  }
  return doc.save({ useObjectStreams: false })
}

/** The text of each page of a PDF, read with pdf.js. */
async function pageTexts(path: string): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) })
  const doc = await task.promise
  const texts: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent()
    texts.push(
      content.items
        .map((item) => ('str' in item ? (item as { str: string }).str : ''))
        .join(' ')
        .trim(),
    )
  }
  await task.destroy()
  return texts
}

/** Each page's displayed size in points (its /Rotate applied). */
function pageSizes(doc: PDFDocument): Array<{ width: number; height: number }> {
  return doc.getPages().map((page) => {
    const { width, height } = page.getSize()
    const turned = page.getRotation().angle % 180 !== 0
    return turned ? { width: height, height: width } : { width, height }
  })
}

/** How many DeviceGray image XObjects a page draws from its resources. */
function grayImageCount(doc: PDFDocument, index: number): number {
  const xobjects = doc.getPage(index).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)
  if (!xobjects) return 0
  let count = 0
  for (const [, ref] of xobjects.entries()) {
    const object = doc.context.lookup(ref)
    if (!(object instanceof PDFStream)) continue
    if (
      object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image') &&
      object.dict.get(PDFName.of('ColorSpace')) === PDFName.of('DeviceGray')
    ) {
      count++
    }
  }
  return count
}

const loadPdf = (path: string) => PDFDocument.load(readFileSync(path))

const noSpace = (text: string) => text.replace(/\s+/g, '')

/** Selects the whole text of the first paragraph holding `text` through the editor. */
async function selectParagraph(docs: Page, text: string): Promise<void> {
  const hit = await docs.evaluate((wanted) => {
    const ed = (window as unknown as { __aidocs: { editor: any } }).__aidocs.editor
    let found: { from: number; to: number } | null = null
    ed.state.doc.descendants((node: any, pos: number) => {
      if (found || !node.isTextblock) return !found
      const idx = (node.textContent as string).indexOf(wanted)
      if (idx !== -1) found = { from: pos + 1 + idx, to: pos + 1 + idx + wanted.length }
      return false
    })
    if (found) ed.chain().focus().setTextSelection(found).run()
    return found
  }, text)
  expect(hit, `text not found: ${text}`).not.toBeNull()
  await expect
    .poll(() =>
      docs.evaluate(() => {
        const ed = (window as unknown as { __aidocs: { editor: any } }).__aidocs.editor
        const { from, to } = ed.state.selection
        return ed.state.doc.textBetween(from, to) as string
      }),
    )
    .toBe(text)
}

/** File › Print in the Word editor (the menu item Ctrl+P runs there). */
async function printFromDocsMenu(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ webContents }) => {
    webContents
      .getAllWebContents()
      .find((w) => w.getURL().includes('://docs/'))
      ?.send('menu:command', 'print')
  })
}

test.describe('advanced print layout', () => {
  test('Word: Selection with 2 pages per sheet saves only the selected paragraph on one landscape face', async () => {
    test.setTimeout(300_000)
    const dir = await mkdtemp(join(tmpdir(), 'genoffice-print-layout-docs-'))
    const docxPath = join(dir, 'paragraphs.docx')
    await writeFile(docxPath, await threeParagraphDocx())
    const target = join(dir, 'selection-2up.pdf')

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'print-layout-docs',
      openFile: docxPath,
    })
    const { app } = launched
    try {
      const docs = await waitForPageWithUrl(app, '://docs/')
      await docs.waitForFunction(
        () => Boolean((window as unknown as { __aidocs?: { editor?: unknown } }).__aidocs?.editor),
        undefined,
        { timeout: 60_000 },
      )
      await expect(docs.locator('.doc-page p', { hasText: CHARLIE }).first()).toBeVisible({
        timeout: 60_000,
      })
      await answerSaveDialogs(app, [target])

      await selectParagraph(docs, BRAVO)
      await printFromDocsMenu(app)
      const dialog = docs.locator('.print-dialog')
      await expect(dialog).toBeVisible({ timeout: 60_000 })
      const panel = dialog.locator('.gs-pl')
      await expect(panel).toBeVisible()
      // nothing on yet: Print is the print it always was, no arranged PDF to save
      await expect(panel.locator('[data-pl="save-pdf"]')).toHaveCount(0)

      // the selection is laid out in the hidden Docs window once
      const selectionRange = dialog.locator('input[data-print="range-selection"]')
      await expect(selectionRange).toBeEnabled({ timeout: 30_000 })
      await selectionRange.check()
      await expect(dialog.locator('.print-preview-schematic')).toBeVisible({ timeout: 120_000 })
      await expect(dialog.locator('[data-print="selection-state"]')).toHaveCount(0)
      await expect(dialog.locator('.print-page-count')).toHaveText(/^1\D/)

      await panel.locator('input[data-pl="mode"][value="nup"]').check()
      await expect(panel.locator('select[data-pl="nup-count"]')).toHaveValue('2')
      await expect(panel.locator('[data-pl="system-note"]')).toBeVisible()
      await expect(panel.locator('[data-pl="issue"]')).toHaveCount(0)
      const save = panel.locator('[data-pl="save-pdf"]')
      await expect(save).toBeEnabled()
      await save.click()

      await expect.poll(() => existsSync(target), { timeout: 120_000 }).toBe(true)
      expect(await saveDialogCalls(app)).toHaveLength(1)
      await expect(panel.locator('[data-pl="job-error"]')).toHaveCount(0)

      const saved = await loadPdf(target)
      expect(saved.getPageCount()).toBe(1)
      const [face] = pageSizes(saved)
      expect(face!.width).toBeGreaterThan(face!.height)
      const [text] = await pageTexts(target)
      expect(noSpace(text!)).toContain(noSpace(BRAVO))
      expect(text).not.toContain('Alpha')
      expect(text).not.toContain('Charlie')
    } finally {
      await closeAndSaveVideo(launched, 'print-layout-docs')
    }
  })

  test('PDF: a booklet of five pages saves four landscape faces in booklet order, and in gray', async () => {
    test.setTimeout(300_000)
    const dir = await mkdtemp(join(tmpdir(), 'genoffice-print-layout-pdf-'))
    const pdfPath = join(dir, 'five.pdf')
    const pageCount = 5
    await writeFile(pdfPath, await markedPdf(pageCount))
    const bookletPath = join(dir, 'booklet.pdf')
    const grayPath = join(dir, 'booklet-gray.pdf')
    const faceCount = Math.ceil(pageCount / 4) * 2

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'print-layout-pdf',
      openFile: pdfPath,
    })
    const { app } = launched
    try {
      const page = await waitForPageWithUrl(app, '://pdf/')
      const thumbs = page.locator('.pdf-thumb')
      await expect(thumbs).toHaveCount(pageCount, { timeout: 60_000 })
      await answerSaveDialogs(app, [bookletPath, grayPath])

      await thumbs.first().locator('.pdf-thumb-box').click()
      await page.keyboard.press('ControlOrMeta+p')
      const dialog = page.locator('.pdf-print-dialog')
      await expect(dialog).toBeVisible()
      const panel = dialog.locator('.gs-pl')
      await expect(panel.locator('[data-pl="save-pdf"]')).toHaveCount(0)

      await panel.locator('input[data-pl="mode"][value="booklet"]').check()
      await expect(panel.locator('[data-pl="booklet-hint"]')).toBeVisible()
      const save = panel.locator('[data-pl="save-pdf"]')
      await expect(save).toBeEnabled()
      await save.click()
      await expect.poll(() => existsSync(bookletPath), { timeout: 120_000 }).toBe(true)

      const booklet = await loadPdf(bookletPath)
      expect(booklet.getPageCount()).toBe(faceCount)
      for (const face of pageSizes(booklet)) expect(face.width).toBeGreaterThan(face.height)
      // 5 pages fill a booklet of 8: [8|1] [2|7] [6|3] [4|5], pages 6 to 8 blank
      const markers = (await pageTexts(bookletPath)).map((text) => text.match(/P\d/g) ?? [])
      expect(markers).toEqual([['P1'], ['P2'], ['P3'], ['P4', 'P5']])

      // grayscale: the same faces, each one gray picture and no text
      await expect(save).toBeEnabled({ timeout: 30_000 })
      await panel.locator('input[data-pl="grayscale"]').check()
      await expect(panel.locator('[data-pl="gray-note"]')).toBeVisible()
      await save.click()
      await expect.poll(() => existsSync(grayPath), { timeout: 180_000 }).toBe(true)
      expect(await saveDialogCalls(app)).toHaveLength(2)

      const gray = await loadPdf(grayPath)
      expect(gray.getPageCount()).toBe(faceCount)
      for (const face of pageSizes(gray)) expect(face.width).toBeGreaterThan(face.height)
      for (let i = 0; i < faceCount; i++) {
        expect(grayImageCount(gray, i), `face ${i + 1} is a gray picture`).toBeGreaterThan(0)
      }
      expect(await pageTexts(grayPath)).toEqual(Array.from({ length: faceCount }, () => ''))
      await expect(panel.locator('[data-pl="job-error"]')).toHaveCount(0)
    } finally {
      await closeAndSaveVideo(launched, 'print-layout-pdf')
    }
  })

  test('Diagram: Ctrl+P opens the print dialog and a 2 x 2 poster saves four pieces', async () => {
    test.setTimeout(300_000)
    const dir = await scratchDir('print-layout')
    const path = await copyAsset('sample.drawio', dir)
    const target = join(dir, 'poster.pdf')

    const launched = await launchShell({ onboardingSeen: true, videoDir: 'print-layout-diagram' })
    const { app, page: shell } = launched
    try {
      const page = await openDiagramPage(app, () => openPath(shell, path))
      await answerSaveDialogs(app, [target])

      // the editor's own key handler takes it, or draw.io's frame forwards it when it has the keyboard
      await page.keyboard.press('ControlOrMeta+p')
      const dialog = page.locator('.gs-pl-dialog')
      await expect(dialog).toBeVisible({ timeout: 30_000 })
      await expect(dialog.locator('input[data-pl="range"]')).toHaveCount(2)
      await expect(dialog.locator('input[data-pl="range"][value="all"]')).toBeChecked()
      await expect(dialog.locator('[data-pl="save-pdf"]')).toHaveCount(0)

      await dialog.locator('input[data-pl="mode"][value="poster"]').check()
      await expect(dialog.locator('input[data-pl="poster-cols"]')).toHaveValue('2')
      await expect(dialog.locator('input[data-pl="poster-rows"]')).toHaveValue('2')
      await expect(dialog.locator('[data-pl="issue"]')).toHaveCount(0)
      const save = dialog.locator('[data-pl="save-pdf"]')
      await expect(save).toBeEnabled()
      await save.click()

      await expect.poll(() => existsSync(target), { timeout: 120_000 }).toBe(true)
      // a saved PDF closes the dialog
      await expect(dialog).toHaveCount(0, { timeout: 30_000 })
      expect(await saveDialogCalls(app)).toHaveLength(1)
      const poster = await loadPdf(target)
      expect(poster.getPageCount()).toBe(4)
      const sizes = pageSizes(poster)
      for (const size of sizes) {
        expect(size.width).toBeCloseTo(sizes[0]!.width, 1)
        expect(size.height).toBeCloseTo(sizes[0]!.height, 1)
      }
    } finally {
      await closeAndSaveVideo(launched, 'print-layout-diagram')
    }
  })

  test('with every option at its default the print dialog offers no arranged PDF', async () => {
    test.setTimeout(180_000)
    const dir = await mkdtemp(join(tmpdir(), 'genoffice-print-layout-default-'))
    const pdfPath = join(dir, 'two.pdf')
    await writeFile(pdfPath, await markedPdf(2))

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'print-layout-default',
      openFile: pdfPath,
    })
    const { app } = launched
    try {
      const page = await waitForPageWithUrl(app, '://pdf/')
      const thumbs = page.locator('.pdf-thumb')
      await expect(thumbs).toHaveCount(2, { timeout: 60_000 })
      await answerSaveDialogs(app, [])

      await thumbs.first().locator('.pdf-thumb-box').click()
      await page.keyboard.press('ControlOrMeta+p')
      const dialog = page.locator('.pdf-print-dialog')
      await expect(dialog).toBeVisible()
      const panel = dialog.locator('.gs-pl')
      await expect(panel).toBeVisible()
      await expect(panel.locator('input[data-pl="mode"][value="single"]')).toBeChecked()
      for (const pl of ['save-pdf', 'preview', 'system-note', 'gray-note']) {
        await expect(panel.locator(`[data-pl="${pl}"]`), pl).toHaveCount(0)
      }

      // one option on shows the arranged route; turned off again it is gone
      const reverse = panel.locator('input[data-pl="reverse"]')
      await reverse.check()
      await expect(panel.locator('[data-pl="save-pdf"]')).toBeVisible()
      await expect(panel.locator('[data-pl="system-note"]')).toBeVisible()
      await reverse.uncheck()
      await expect(panel.locator('[data-pl="save-pdf"]')).toHaveCount(0)
      await expect(panel.locator('[data-pl="system-note"]')).toHaveCount(0)

      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      expect(await saveDialogCalls(app)).toHaveLength(0)
    } finally {
      await closeAndSaveVideo(launched, 'print-layout-default')
    }
  })
})
