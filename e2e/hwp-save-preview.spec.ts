/**
 * A save writes the preview of the document as it is now (decision 0146).
 *
 * The engine carried the opened file's preview (`Preview/PrvText.txt`, `PrvImage.png`) into
 * every save, so text deleted before saving stayed in the file for other programs to show,
 * and the home screen's quick look kept the old first page. The fixture is a file Hangul
 * 2024 saved, with "a" and "b" as its preview text and a drawn first page.
 */
import { test, expect } from '@playwright/test'
import type { Frame, Page } from '@playwright/test'
import { copyFile, mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

const HANCOM_HWPX = join(
  __dirname,
  '..',
  'apps',
  'hwp',
  'tests',
  'fixtures',
  'hancom-page-number-no-dash.hwpx',
)
const STUDIO_IFRAME = '.hwp-editor-host iframe'

interface StudioLike {
  plugins: {
    load(id: string): Promise<unknown>
    invoke(id: string, method: string, args: unknown[]): unknown
  }
}

async function hwpPage(page: Page): Promise<Page> {
  await page.waitForSelector('.hwp-app[data-phase="ready"]', { timeout: 90_000 })
  await expect(page.frameLocator(STUDIO_IFRAME).locator('[data-cmd="ext:ieum-save"]')).toHaveCount(
    1,
  )
  return page
}

async function studioFrame(page: Page): Promise<Frame> {
  const deadline = Date.now() + 60_000
  for (;;) {
    const frame = page.frames().find((f) => f.url().includes('/studio/'))
    if (frame) return frame
    if (Date.now() > deadline) throw new Error('studio frame never loaded')
    await page.waitForTimeout(100)
  }
}

/** File > Save, as the editor's own menu sends it. */
async function save(page: Page): Promise<void> {
  await page.evaluate(() => {
    const frame = document.querySelector('.hwp-editor-host iframe') as HTMLIFrameElement | null
    frame?.contentWindow?.dispatchEvent(new CustomEvent('ieum:file-command', { detail: 'save' }))
  })
}

async function previewOf(file: string): Promise<{ text: string; image: Buffer }> {
  const zip = await JSZip.loadAsync(await readFile(file))
  return {
    text: await zip.file('Preview/PrvText.txt')!.async('string'),
    image: Buffer.from(await zip.file('Preview/PrvImage.png')!.async('uint8array')),
  }
}

test('a saved HWPX carries the preview of the edited document, not the opened one', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'genoffice-hwp-preview-')), 'hancom.hwpx')
  await copyFile(HANCOM_HWPX, file)
  const opened = await previewOf(file)
  expect(opened.text).toBe('a\r\nb\r\n')

  const launched = await launchShell({
    onboardingSeen: true,
    lang: 'ko',
    openFile: file,
    videoDir: 'hwp-save-preview',
    recordVideo: false,
  })
  try {
    const page = await hwpPage(await waitForPageWithUrl(launched.app, '://hwp/'))
    const frame = await studioFrame(page)
    const replaced = await frame.evaluate(async () => {
      const studio = (window as unknown as { rhwpStudio: StudioLike }).rhwpStudio
      await studio.plugins.load('ieum-agent')
      return studio.plugins.invoke('ieum-agent', 'replaceAllText', ['a', '새 글'])
    })
    expect(replaced).toMatchObject({ ok: true })

    const written = (await stat(file)).mtimeMs
    await save(page)
    await expect.poll(async () => (await stat(file)).mtimeMs, { timeout: 20_000 }).not.toBe(written)
    await expect(page.locator('.hwp-notice-error')).toHaveCount(0)

    const saved = await previewOf(file)
    expect(saved.text).toBe('새 글\r\nb\r\n')
    // a page the editor drew: a PNG Hangul's size, not the opened file's
    expect(saved.image.subarray(1, 4).toString('latin1')).toBe('PNG')
    expect(saved.image.readUInt32BE(20)).toBe(1024)
    expect(saved.image.equals(opened.image)).toBe(false)
  } finally {
    await closeAndSaveVideo(launched, 'hwp-save-preview')
  }
})
