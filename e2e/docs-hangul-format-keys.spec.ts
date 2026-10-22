import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { launchShell, closeAndSaveVideo, screenshotPath, waitForPageWithUrl } from './helpers'

/**
 * Hangul's formatting chords in Word: ⌥⇧E / ⌥⇧R font size by 1 pt, ⌥⇧W / ⌥⇧N
 * character spacing by 1% of the size, ⌥⇧Z / ⌥⇧A line spacing by 0.1 line.
 * Pressed on a selection they save as w:sz, the run's w:spacing and the
 * paragraphs' w:spacing w:line, and the shortcut sheet lists them.
 */

interface AidocsWindow {
  __aidocs?: { editor?: unknown; save?: () => Promise<unknown> }
}

async function minimalDocx(paras: string[]): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  const body = paras
    .map((text) => `<w:p><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`)
    .join('')
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function documentXml(path: string): Promise<string> {
  const zip = await JSZip.loadAsync(readFileSync(path))
  return zip.file('word/document.xml')!.async('string')
}

test.describe('docs Hangul formatting chords', () => {
  let dir: string
  let docPath: string

  test.beforeEach(async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'genoffice-e2e-hangul-keys-')))
    docPath = join(dir, 'steps.docx')
    writeFileSync(docPath, await minimalDocx(['First paragraph', 'Second paragraph']))
  })

  test.afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('Alt+Shift E/R, W/N and Z/A step size, spacing and line spacing', async () => {
    test.setTimeout(150_000)
    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'docs-hangul-format-keys',
      openFile: docPath,
    })
    const { app } = launched
    try {
      const editorPage = await waitForPageWithUrl(app, '://docs/')
      await editorPage.waitForFunction(
        () => Boolean((window as unknown as AidocsWindow).__aidocs?.editor),
        undefined,
        { timeout: 30_000 },
      )
      await editorPage.locator('.doc-page').click()
      await editorPage.keyboard.press('ControlOrMeta+a')
      const span = editorPage.locator('.doc-page span[data-doc-style]').first()
      const firstPara = editorPage.locator('.doc-page .ProseMirror > p').first()

      // font size: two up in a burst, one down — 12 → 14 → 13 pt
      await editorPage.keyboard.press('Alt+Shift+KeyE')
      await editorPage.keyboard.press('Alt+Shift+KeyE')
      await expect(span).toHaveCSS('font-size', `${(14 * 4) / 3}px`)
      await editorPage.keyboard.press('Alt+Shift+KeyR')
      await expect(span).toHaveCSS('font-size', `${(13 * 4) / 3}px`)

      // character spacing at 13 pt: three wider, one narrower = 2% of 13 pt (5 twips)
      for (const key of ['W', 'W', 'W', 'N']) await editorPage.keyboard.press(`Alt+Shift+Key${key}`)
      await expect
        .poll(() => span.evaluate((el) => parseFloat(getComputedStyle(el).letterSpacing)))
        .toBeCloseTo((5 / 20) * (4 / 3), 2)

      // line spacing: two wider, one narrower = 1.1 lines on both paragraphs
      const lineHeight = () => firstPara.evaluate((el) => getComputedStyle(el).lineHeight)
      const single = await lineHeight()
      for (const key of ['Z', 'Z', 'A']) await editorPage.keyboard.press(`Alt+Shift+Key${key}`)
      await expect.poll(lineHeight).not.toBe(single)

      // the Mac's Option turns ⌥⇧Z into "¸": the chord is read from the physical key
      await editorPage.waitForTimeout(600)
      await editorPage.evaluate(() => {
        document.querySelector('.doc-page .ProseMirror')!.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: '¸',
            code: 'KeyZ',
            altKey: true,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        )
      })

      // let the coalesced trailing applies land before saving
      await editorPage.waitForTimeout(600)
      expect(
        await editorPage.evaluate(() => (window as unknown as AidocsWindow).__aidocs!.save!()),
      ).toBe(true)
      await expect
        .poll(() => documentXml(docPath), { timeout: 15_000 })
        .toContain('<w:sz w:val="26"/>')
      const xml = await documentXml(docPath)
      expect(xml).toContain('<w:spacing w:val="5"/>')
      expect(xml).not.toContain('<w:sz w:val="24"/>')
      // 1.1 lines from the real presses, one more step from the Mac event: 1.2 (288 twips)
      expect(xml.match(/<w:spacing [^>]*w:line="288"[^>]*w:lineRule="auto"/g)).toHaveLength(2)

      // the shortcut sheet lists the new rows with the Windows/Linux chords
      await editorPage.locator('.doc-page').click()
      await editorPage.keyboard.press('ControlOrMeta+/')
      const sheet = editorPage.locator('.modal-shortcuts')
      await expect(sheet).toBeVisible()
      const keysOf = (label: string) =>
        sheet.locator('.sc-row').filter({ hasText: label }).locator('.sc-keys')
      await expect(keysOf('Increase Line Spacing')).toHaveText('Alt+Shift+Z')
      await expect(keysOf('Decrease Line Spacing')).toHaveText('Alt+Shift+A')
      await expect(keysOf('Expand Character Spacing')).toHaveText('Alt+Shift+W')
      await expect(keysOf('Condense Character Spacing')).toHaveText('Alt+Shift+N')
      await expect(keysOf('Increase Font Size 1 pt')).toHaveText('Ctrl+] / Alt+Shift+E')
      await expect(keysOf('Decrease Font Size 1 pt')).toHaveText('Ctrl+[ / Alt+Shift+R')
      await sheet.screenshot({ path: screenshotPath('docs-hangul-format-keys-sheet') })
    } finally {
      await closeAndSaveVideo(launched, 'docs-hangul-format-keys')
    }
  })
})
