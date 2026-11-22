/**
 * Clicking a web or mailto hyperlink in an HWP document (or the preview button
 * in the hyperlink dialog) routes the validated URL to Electron's
 * shell.openExternal instead of triggering a browser "popup blocked" message.
 */
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Frame, Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

const execFileAsync = promisify(execFile)
const REPO_ROOT = join(__dirname, '..')
const STUDIO_IFRAME = '.hwp-editor-host iframe'

const WEB_URL = 'https://example.com/ieum-link'
const MAIL_URL = 'mailto:hello@example.com'

interface StudioLike {
  automation: {
    registerCommand(def: {
      id: string
      label: string
      execute(services: {
        wasm: {
          getSelectionRects(
            sec: number,
            startPara: number,
            startChar: number,
            endPara: number,
            endChar: number,
          ): Array<{ pageIndex: number; x: number; y: number; width: number; height: number }>
        }
        getInputHandler(): {
          container: HTMLElement
          virtualScroll: {
            getPageLeftResolved(page: number, containerWidth: number): number
            getPageOffset(page: number): number
          }
          viewportManager: { getZoom(): number }
          moveCursorTo(pos: {
            sectionIndex: number
            paragraphIndex: number
            charOffset: number
          }): void
        }
      }): void
    }): void
    execute(
      id: string,
      params?: Record<string, unknown>,
      options?: { allowDialog?: boolean },
    ): unknown
  }
}

async function writeHyperlinkDocument(path: string): Promise<void> {
  const core = pathToFileURL(join(REPO_ROOT, 'vendor/rhwp-core/rhwp.js')).href
  const wasm = join(REPO_ROOT, 'vendor/rhwp-core/rhwp_bg.wasm')
  const script = [
    "import { readFileSync, writeFileSync } from 'node:fs'",
    `const { default: init, HwpDocument } = await import(${JSON.stringify(core)})`,
    `await init({ module_or_path: readFileSync(${JSON.stringify(wasm)}) })`,
    'const doc = HwpDocument.createEmpty()',
    'doc.createBlankDocument()',
    `const webText = ${JSON.stringify(WEB_URL)}`,
    `const mailText = ${JSON.stringify(MAIL_URL)}`,
    'doc.insertText(0, 0, 0, webText)',
    `doc.insertHyperlinkEx(JSON.stringify({ target: { section: 0, para: 0, cellPath: [] }, start: 0, end: webText.length, uri: ${JSON.stringify(WEB_URL)} }))`,
    'doc.splitParagraph(0, 0, doc.getParagraphLength(0, 0))',
    'doc.insertText(0, 1, 0, mailText)',
    `doc.insertHyperlinkEx(JSON.stringify({ target: { section: 0, para: 1, cellPath: [] }, start: 0, end: mailText.length, uri: ${JSON.stringify(MAIL_URL)} }))`,
    'writeFileSync(process.argv[2], doc.exportHwp())',
  ].join('\n')
  const dir = await mkdtemp(join(tmpdir(), 'ieum-hwp-hyperlink-script-'))
  const file = join(dir, 'write.mjs')
  await writeFile(file, script)
  await execFileAsync(process.execPath, [file, path], { timeout: 120_000 })
}

async function hwpPage(app: ElectronApplication): Promise<Page> {
  const hwp = await waitForPageWithUrl(app, '://hwp/')
  await hwp.waitForSelector('.hwp-app[data-phase="ready"]', { timeout: 90_000 })
  await expect(hwp.frameLocator(STUDIO_IFRAME).locator('[data-cmd="ext:ieum-save"]')).toHaveCount(1)
  return hwp
}

async function studioFrame(hwp: Page): Promise<Frame> {
  const deadline = Date.now() + 60_000
  for (;;) {
    const frame = hwp.frames().find((f) => f.url().includes('/studio/'))
    if (frame) return frame
    if (Date.now() > deadline) throw new Error('studio frame never loaded')
    await hwp.waitForTimeout(100)
  }
}

test('HWP hyperlinks open via shell.openExternal without popup-blocked errors', async () => {
  test.setTimeout(180_000)
  const docDir = await mkdtemp(join(tmpdir(), 'ieum-hwp-hyperlink-'))
  const file = join(docDir, 'links.hwp')
  await writeHyperlinkDocument(file)

  const launched = await launchShell({
    openFile: file,
    onboardingSeen: true,
    lang: 'ko',
    videoDir: 'hwp-hyperlink-open',
  })

  try {
    await launched.app.evaluate(({ shell }) => {
      const g = globalThis as unknown as { __openedExternalUrls?: string[] }
      g.__openedExternalUrls = []
      shell.openExternal = (async (url: string) => {
        g.__openedExternalUrls!.push(url)
      }) as typeof shell.openExternal
    })

    const hwp = await hwpPage(launched.app)
    const frame = await studioFrame(hwp)

    const linkCenters = await frame.evaluate(
      ([webLen, mailLen]) => {
        const scope = window as unknown as {
          rhwpStudio: StudioLike
          __e2eLinkCenters?: Array<{ x: number; y: number }>
        }
        scope.rhwpStudio.automation.registerCommand({
          id: 'ext:e2e-link-centers',
          label: 'E2E link centers',
          execute(services) {
            const ih = services.getInputHandler()
            const content = ih.container.querySelector('#scroll-content')!
            const box = content.getBoundingClientRect()
            const zoom = ih.viewportManager.getZoom()
            const centerOf = (para: number, len: number) => {
              const rect = services.wasm.getSelectionRects(0, para, 0, para, len)[0]
              const pageLeft = ih.virtualScroll.getPageLeftResolved(
                rect.pageIndex,
                content.clientWidth,
              )
              const pageTop = ih.virtualScroll.getPageOffset(rect.pageIndex)
              return {
                x: box.left + pageLeft + (rect.x + rect.width / 2) * zoom,
                y: box.top + pageTop + (rect.y + rect.height / 2) * zoom,
              }
            }
            scope.__e2eLinkCenters = [centerOf(0, webLen), centerOf(1, mailLen)]
          },
        })
        scope.rhwpStudio.automation.registerCommand({
          id: 'ext:e2e-caret-link0',
          label: 'E2E caret on link 0',
          execute(services) {
            services.getInputHandler().moveCursorTo({
              sectionIndex: 0,
              paragraphIndex: 0,
              charOffset: 2,
            })
          },
        })
        scope.rhwpStudio.automation.execute('ext:e2e-link-centers')
        return scope.__e2eLinkCenters!
      },
      [WEB_URL.length, MAIL_URL.length],
    )

    const iframeBox = await hwp.locator(STUDIO_IFRAME).boundingBox()
    expect(iframeBox).not.toBeNull()

    const openedUrls = () =>
      launched.app.evaluate(
        () =>
          (globalThis as unknown as { __openedExternalUrls?: string[] }).__openedExternalUrls ?? [],
      )

    // 1. Clicking the web hyperlink opens it externally without a popup-blocked toast
    await hwp.mouse.click(iframeBox!.x + linkCenters[0].x, iframeBox!.y + linkCenters[0].y)
    await expect.poll(openedUrls).toEqual([WEB_URL])
    await expect(frame.locator('body')).not.toContainText('팝업이 차단되었습니다')

    // 2. Clicking the mailto hyperlink opens it externally and keeps the editor frame loaded
    const beforeFrameUrl = frame.url()
    await hwp.mouse.click(iframeBox!.x + linkCenters[1].x, iframeBox!.y + linkCenters[1].y)
    await expect.poll(openedUrls).toEqual([WEB_URL, MAIL_URL])
    expect(frame.url()).toBe(beforeFrameUrl)

    // 3. The hyperlink edit dialog's preview button opens the URL externally with no error
    await frame.evaluate(() => {
      const scope = window as unknown as { rhwpStudio: StudioLike }
      scope.rhwpStudio.automation.execute('ext:e2e-caret-link0')
      scope.rhwpStudio.automation.execute('hyperlink:edit', undefined, { allowDialog: true })
    })
    await expect(frame.locator('#hyperlink-preview')).toBeVisible()
    await frame.locator('#hyperlink-preview').click()
    await expect.poll(openedUrls).toEqual([WEB_URL, MAIL_URL, WEB_URL])
    await expect(frame.locator('#hyperlink-error')).toHaveText('')
  } finally {
    await closeAndSaveVideo(launched, 'hwp-hyperlink-open')
  }
})
