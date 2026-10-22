import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { addElement, createBlankPptx, openPptx, savePptx } from '@genoffice/pptx-engine'
import { launchShell, closeAndSaveVideo, screenshotPath, waitForPageWithUrl } from './helpers'

/**
 * Hangul's formatting chords in Slides: ⌥⇧E / ⌥⇧R step the font size by 1 pt
 * and ⌥⇧Z / ⌥⇧A the line spacing by 0.1 line, on a selected text box and on
 * the paragraphs of a text edit; the result saves as sz and a:lnSpc.
 */

interface SlidesWindow {
  slidesApi: {
    getRenderSlides(): Promise<Array<{ nodes: Array<{ sourceId: string }> }> | null>
    getLineSpacing(slideIndex: number, sourceId: string): Promise<number[]>
    save(): Promise<{ ok: boolean; error?: string }>
  }
}

/** One centred two-paragraph 20 pt text box on a blank 16:9 slide */
async function textBoxDeck(dir: string): Promise<string> {
  const opened = await openPptx(await createBlankPptx())
  addElement(opened.deck.slides[0]!, {
    kind: 'textbox',
    offset: { x: 3048000, y: 2286000, cx: 6096000, cy: 2286000 },
    paragraphs: [
      { runs: [{ text: 'First paragraph', fontSize: 20 }] },
      { runs: [{ text: 'Second paragraph', fontSize: 20 }] },
    ],
  })
  const file = join(dir, 'hangul-keys.pptx')
  await writeFile(file, await savePptx(opened))
  return file
}

const lineSpacing = (page: Page) =>
  page.evaluate(async () => {
    const api = (window as unknown as SlidesWindow).slidesApi
    const id = (await api.getRenderSlides())![0]!.nodes[0]!.sourceId
    return api.getLineSpacing(0, id)
  })

test('Alt+Shift E/R and Z/A step size and line spacing in Slides', async () => {
  test.setTimeout(150_000)
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-e2e-slides-keys-'))
  const deck = await textBoxDeck(dir)
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'slides-hangul-format-keys',
    openFile: deck,
  })
  try {
    const page = await waitForPageWithUrl(launched.app, '://slides/')
    await page.waitForSelector('.stage-wrap canvas', { timeout: 30_000 })
    // the box is centred, so a click at the stage centre selects it
    await page.locator('.stage-wrap').first().click()
    expect(await lineSpacing(page)).toEqual([100, 100])

    // the selected box: two wider, one narrower = 1.1 lines on both paragraphs
    for (const key of ['Z', 'Z', 'A']) await page.keyboard.press(`Alt+Shift+Key${key}`)
    await expect.poll(() => lineSpacing(page)).toEqual([110, 110])

    // font size by one point: 20 → 22 → 21
    for (const key of ['E', 'E', 'R']) await page.keyboard.press(`Alt+Shift+Key${key}`)

    // inside the text edit (F2 selects all of it): the covered paragraphs, from the
    // first one's spacing, committed with the edit; the Mac's Option letter too
    await page.keyboard.press('F2')
    await expect(page.locator('.slide-text-editor')).toBeVisible()
    await page.evaluate(() =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '¸',
          code: 'KeyZ',
          altKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    )
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('.slide-text-editor [data-src-para]')].map(
            (el) => el.dataset.lineSpacingPct ?? null,
          ),
        ),
      )
      .toEqual(['120', '120'])
    await page.screenshot({ path: screenshotPath('slides-hangul-format-keys-editing') })
    await page.keyboard.press('Escape')
    await expect.poll(() => lineSpacing(page)).toEqual([120, 120])

    const saved = await page.evaluate(() => (window as unknown as SlidesWindow).slidesApi.save())
    expect(saved.ok, saved.error).toBe(true)
    const xml = await (
      await JSZip.loadAsync(await readFile(deck))
    )
      .file('ppt/slides/slide1.xml')!
      .async('string')
    expect(xml.match(/<a:lnSpc><a:spcPct val="120000"\/><\/a:lnSpc>/g)).toHaveLength(2)
    expect(xml.match(/ sz="2100"/g)).toHaveLength(2)
    expect(xml).not.toContain(' sz="2000"')
    expect(xml).toContain('First paragraph')
    await page.screenshot({ path: screenshotPath('slides-hangul-format-keys') })
  } finally {
    await closeAndSaveVideo(launched, 'slides-hangul-format-keys')
    await rm(dir, { recursive: true, force: true })
  }
})
