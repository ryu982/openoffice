/**
 * Pasting into a footnote and putting a 문자표 symbol into one (2026-11-17 feedback: "각주에
 * 복사 붙여넣기가 안 되고 「」 기호가 입력되지 않는다"). The studio pasted and put symbols at
 * the body caret it froze when the footnote was opened, so both went into the body text.
 * Real keys and a real clipboard against the production build.
 */
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Frame, Page } from '@playwright/test'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

const STUDIO_IFRAME = '.hwp-editor-host iframe'

interface Studio {
  plugins: {
    load(id: string): Promise<unknown>
    invoke(id: string, method: string, args: unknown[]): unknown
  }
  automation: {
    registerCommand(def: { id: string; label: string; execute(s: unknown): void }): void
    execute(id: string): void
  }
  __bodyText?: boolean
}

async function openHwp(app: ElectronApplication, page: Page): Promise<Page> {
  await page.locator('.quick-card', { hasText: 'AI HWP' }).click()
  const hwp = await waitForPageWithUrl(app, '://hwp/')
  await hwp.waitForSelector('.hwp-app[data-phase="ready"]', { timeout: 90_000 })
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

async function canvasBox(hwp: Page) {
  const canvas = hwp.frameLocator(STUDIO_IFRAME).locator('#scroll-content canvas').first()
  await canvas.waitFor({ timeout: 60_000 })
  return (await canvas.boundingBox())!
}

/** The footnotes' texts, a line per paragraph. */
async function noteTexts(frame: Frame): Promise<string[]> {
  return frame.evaluate(async () => {
    const studio = (window as unknown as { rhwpStudio: Studio }).rhwpStudio
    await studio.plugins.load('ieum-agent')
    const listed = (await studio.plugins.invoke('ieum-agent', 'listNotes', [])) as {
      notes: { text: string }[]
    }
    return listed.notes.map((note) => note.text)
  })
}

/** Whether the first footnote still has its automatic number. */
async function noteNumbered(frame: Frame): Promise<boolean> {
  return frame.evaluate(async () => {
    const studio = (window as unknown as { rhwpStudio: Studio }).rhwpStudio
    await studio.plugins.load('ieum-agent')
    const listed = (await studio.plugins.invoke('ieum-agent', 'listNotes', [])) as {
      notes: { noAutoNumber?: true }[]
    }
    return listed.notes.length > 0 && listed.notes[0]!.noAutoNumber !== true
  })
}

/** The first header paragraph's info, as the engine gives it. */
async function headerInfo(frame: Frame): Promise<string> {
  return frame.evaluate(() => {
    const studio = (window as unknown as { rhwpStudio: Studio & { __hf?: boolean } }).rhwpStudio
    if (!studio.__hf) {
      studio.automation.registerCommand({
        id: 'ext:e2e-hf',
        label: 'E2E header',
        execute(services) {
          const s = services as {
            wasm: { getHeaderFooterParaInfo(sec: number, h: boolean, a: number, p: number): string }
            getInputHandler(): { cursor: { hfSectionIdx: number; hfApplyTo: number } }
          }
          const c = s.getInputHandler().cursor
          ;(window as unknown as { __hf: string }).__hf = s.wasm.getHeaderFooterParaInfo(
            c.hfSectionIdx,
            true,
            c.hfApplyTo,
            0,
          )
        },
      })
      studio.__hf = true
    }
    studio.automation.execute('ext:e2e-hf')
    return (window as unknown as { __hf: string }).__hf
  })
}

/** The first body paragraph's text. */
async function bodyText(frame: Frame): Promise<string> {
  return frame.evaluate(() => {
    const studio = (window as unknown as { rhwpStudio: Studio }).rhwpStudio
    if (!studio.__bodyText) {
      studio.automation.registerCommand({
        id: 'ext:e2e-body-text',
        label: 'E2E body text',
        execute(services) {
          const wasm = (
            services as {
              wasm: {
                getParagraphLength(sec: number, para: number): number
                getTextRange(sec: number, para: number, from: number, count: number): string
              }
            }
          ).wasm
          ;(window as unknown as { __bodyText: string }).__bodyText = wasm.getTextRange(
            0,
            0,
            0,
            wasm.getParagraphLength(0, 0),
          )
        },
      })
      studio.__bodyText = true
    }
    studio.automation.execute('ext:e2e-body-text')
    return (window as unknown as { __bodyText: string }).__bodyText
  })
}

/** Where a place of the open note is on the page, from the engine. */
async function notePoint(
  frame: Frame,
  para: number,
  offset: number,
): Promise<{ x: number; y: number; height: number }> {
  return frame.evaluate(
    ([para, offset]) => {
      const studio = (window as unknown as { rhwpStudio: Studio & { __notePoint?: boolean } })
        .rhwpStudio
      const w = window as unknown as { __noteAt: number[]; __notePoint: unknown }
      w.__noteAt = [para!, offset!]
      if (!studio.__notePoint) {
        studio.automation.registerCommand({
          id: 'ext:e2e-note-point',
          label: 'E2E note point',
          execute(services) {
            const s = services as {
              wasm: {
                getCursorRectInFootnote(pg: number, fi: number, p: number, o: number): unknown
              }
              getInputHandler(): { cursor: { fnPageNum: number; fnFootnoteIndex: number } }
            }
            const c = s.getInputHandler().cursor
            const [p, o] = (window as unknown as { __noteAt: number[] }).__noteAt
            ;(window as unknown as { __notePoint: unknown }).__notePoint =
              s.wasm.getCursorRectInFootnote(c.fnPageNum, c.fnFootnoteIndex, p!, o!)
          },
        })
        studio.__notePoint = true
      }
      studio.automation.execute('ext:e2e-note-point')
      return w.__notePoint as { x: number; y: number; height: number }
    },
    [para, offset],
  )
}

/** A screen point of a note place; the page may have scrolled to keep the caret in view. */
async function noteScreenPoint(hwp: Page, frame: Frame, para: number, offset: number) {
  const at = await notePoint(frame, para, offset)
  const box = await canvasBox(hwp)
  // a little left of the caret line: the hit test rounds to the nearer side of a character
  return { x: box.x + at.x - 2, y: box.y + at.y + at.height / 2 }
}

async function clickNote(hwp: Page, frame: Frame, para: number, offset: number): Promise<void> {
  const at = await noteScreenPoint(hwp, frame, para, offset)
  await hwp.mouse.click(at.x, at.y)
}

/** A triple click on a line of the open note selects that paragraph (as in Hangul). */
async function selectNoteLine(hwp: Page, frame: Frame, para: number): Promise<void> {
  const at = await noteScreenPoint(hwp, frame, para, 3)
  await hwp.mouse.click(at.x, at.y, { clickCount: 3 })
  await hwp.waitForTimeout(200)
}

/** The caret's place in the open note. */
async function noteCaret(frame: Frame): Promise<{ para: number; offset: number }> {
  return frame.evaluate(() => {
    const studio = (window as unknown as { rhwpStudio: Studio & { __noteCaret?: boolean } })
      .rhwpStudio
    if (!studio.__noteCaret) {
      studio.automation.registerCommand({
        id: 'ext:e2e-note-caret',
        label: 'E2E note caret',
        execute(services) {
          const c = (
            services as {
              getInputHandler(): { cursor: { fnInnerParaIdx: number; fnCharOffset: number } }
            }
          ).getInputHandler().cursor
          ;(window as unknown as { __noteCaret: unknown }).__noteCaret = {
            para: c.fnInnerParaIdx,
            offset: c.fnCharOffset,
          }
        },
      })
      studio.__noteCaret = true
    }
    studio.automation.execute('ext:e2e-note-caret')
    return (window as unknown as { __noteCaret: { para: number; offset: number } }).__noteCaret
  })
}

async function command(frame: Frame, id: string): Promise<void> {
  await frame.evaluate((id) => {
    ;(window as unknown as { rhwpStudio: Studio }).rhwpStudio.automation.execute(id)
  }, id)
}

test.describe('hwp: footnote paste and symbols', () => {
  test('a paste and a 문자표 symbol go into the footnote being edited', async () => {
    test.setTimeout(240_000)
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'hwp-footnote-paste' })
    const { app, page } = launched
    try {
      const hwp = await openHwp(app, page)
      const frame = await studioFrame(hwp)
      const box = await canvasBox(hwp)

      await hwp.mouse.click(box.x + 160, box.y + 145)
      await hwp.keyboard.type('body')
      await command(frame, 'insert:footnote')
      await expect.poll(() => noteTexts(frame)).toEqual([''])

      // typed text reaches the footnote (it always did)
      await hwp.keyboard.type('see ')

      // a plain-text paste of two lines: two footnote paragraphs, the body untouched
      await app.evaluate(({ clipboard }) => clipboard.writeText('Act 1\r\nAct 2'))
      await hwp.keyboard.press('Control+v')
      await expect.poll(() => noteTexts(frame)).toEqual(['see Act 1\nAct 2'])
      expect(await bodyText(frame)).toBe('body')

      // a paste that also carries HTML (a copy from a browser or a word processor) goes in as text
      await app.evaluate(({ clipboard }) =>
        clipboard.write({ text: ' (rich)', html: '<p><b> (rich)</b></p>' }),
      )
      await hwp.keyboard.press('Control+v')
      await expect.poll(() => noteTexts(frame)).toEqual(['see Act 1\nAct 2 (rich)'])
      expect(await bodyText(frame)).toBe('body')

      // one undo takes the last paste back out of the footnote
      await hwp.keyboard.press('Control+z')
      await expect.poll(() => noteTexts(frame)).toEqual(['see Act 1\nAct 2'])
      expect(await bodyText(frame)).toBe('body')

      // 문자표 by its Hangul key (Ctrl+F10): 「 from the CJK symbols block
      await hwp.keyboard.press('Control+F10')
      const dialog = frame.locator('.sym-dialog')
      await dialog.waitFor()
      await dialog.locator('.sym-block-item').nth(29).click()
      await dialog.locator('.sym-cell', { hasText: '「' }).first().click()
      await dialog.locator('.dialog-btn-primary').click()
      await expect.poll(() => noteTexts(frame)).toEqual(['see Act 1\nAct 2「'])
      expect(await bodyText(frame)).toBe('body')
      await dialog.locator('.dialog-close').click()

      // typing goes on in the footnote after the symbol
      await hwp.keyboard.type('x')
      await expect.poll(() => noteTexts(frame)).toEqual(['see Act 1\nAct 2「x'])

      // a click in the note, then typing, then a paste: the typed text stays (the click leaves
      // a selection anchor behind that the typed text must not count as a selection)
      await clickNote(hwp, frame, 1, 1)
      const at = await noteCaret(frame)
      expect(at.para).toBe(1)
      await hwp.keyboard.type('Q')
      await app.evaluate(({ clipboard }) => clipboard.writeText('P'))
      await hwp.keyboard.press('Control+v')
      const line = 'Act 2「x'.slice(0, at.offset) + 'QP' + 'Act 2「x'.slice(at.offset)
      await expect.poll(() => noteTexts(frame)).toEqual([`see Act 1\n${line}`])

      // the whole second line selected, Ctrl+C: the note's text is on the clipboard
      await selectNoteLine(hwp, frame, 1)
      await hwp.keyboard.press('Control+c')
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(line)
      // End leaves the selection; the copy goes in at the end of the line
      await hwp.keyboard.press('End')
      await hwp.keyboard.press('Control+v')
      await expect.poll(() => noteTexts(frame)).toEqual([`see Act 1\n${line}${line}`])

      // a paste over a selection replaces it
      await selectNoteLine(hwp, frame, 1)
      await app.evaluate(({ clipboard }) => clipboard.writeText('「법」'))
      await hwp.keyboard.press('Control+v')
      await expect.poll(() => noteTexts(frame)).toEqual(['see Act 1\n「법」'])

      // cut takes the selection out of the note, not the body
      await selectNoteLine(hwp, frame, 1)
      await hwp.keyboard.press('Control+x')
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('「법」')
      await expect.poll(async () => (await noteTexts(frame))[0]!.trimEnd()).toBe('see Act 1')
      expect(await bodyText(frame)).toBe('body')
    } finally {
      await closeAndSaveVideo(launched, 'hwp-footnote-paste')
    }
  })

  // The Hangul input method's symbol list (ㄴ, then the Hanja key) composes ㄴ and commits 「 in
  // its place; the browser sees a composition, as Chrome's IME emulation sends it here. A triple
  // click selects the first paragraph from its first place, which holds the note's number.
  test('composed 「법」 goes into the footnote; replacing its first line keeps the number', async () => {
    test.setTimeout(240_000)
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'hwp-footnote-ime' })
    const { app, page } = launched
    try {
      const hwp = await openHwp(app, page)
      const frame = await studioFrame(hwp)
      const box = await canvasBox(hwp)
      await hwp.mouse.click(box.x + 160, box.y + 145)
      await hwp.keyboard.type('body')
      await command(frame, 'insert:footnote')
      await expect.poll(() => noteTexts(frame)).toEqual([''])
      await hwp.keyboard.type('see ')

      const cdp = await hwp.context().newCDPSession(hwp)
      const compose = async (steps: string[], commit: string) => {
        for (const text of steps) {
          await cdp.send('Input.imeSetComposition', {
            text,
            selectionStart: text.length,
            selectionEnd: text.length,
          })
        }
        await cdp.send('Input.insertText', { text: commit })
      }
      await compose(['ㄴ'], '「')
      await compose(['ㅂ', '버', '법'], '법')
      await compose(['ㄴ'], '」')
      await expect.poll(() => noteTexts(frame)).toEqual(['see 「법」'])
      expect(await bodyText(frame)).toBe('body')

      // the whole first line selected, a symbol composed over it: the text goes, the number stays
      await selectNoteLine(hwp, frame, 0)
      await compose(['ㄴ'], '「')
      await expect.poll(() => noteTexts(frame)).toEqual(['「'])
      expect(await noteNumbered(frame)).toBe(true)

      // and a paste over the whole first line
      await hwp.keyboard.type('x')
      await selectNoteLine(hwp, frame, 0)
      await app.evaluate(({ clipboard }) => clipboard.writeText('「법」 제1조'))
      await hwp.keyboard.press('Control+v')
      await expect.poll(() => noteTexts(frame)).toEqual(['「법」 제1조'])
      expect(await noteNumbered(frame)).toBe(true)
      expect(await bodyText(frame)).toBe('body')
    } finally {
      await closeAndSaveVideo(launched, 'hwp-footnote-ime')
    }
  })

  test('문자표 while a header is open goes into the header', async () => {
    test.setTimeout(240_000)
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'hwp-header-symbol' })
    const { app, page } = launched
    try {
      const hwp = await openHwp(app, page)
      const frame = await studioFrame(hwp)
      const box = await canvasBox(hwp)
      await hwp.mouse.click(box.x + 160, box.y + 145)
      await hwp.keyboard.type('body')
      await command(frame, 'page:header-create')
      await hwp.keyboard.type('head ')
      await hwp.keyboard.press('Control+F10')
      const dialog = frame.locator('.sym-dialog')
      await dialog.waitFor()
      await dialog.locator('.sym-block-item').nth(29).click()
      await dialog.locator('.sym-cell', { hasText: '「' }).first().click()
      await dialog.locator('.dialog-btn-primary').click()
      await dialog.locator('.dialog-close').click()
      await hwp.keyboard.type('x')
      await expect.poll(() => headerInfo(frame)).toContain('"text":"head 「x"')
      expect(await bodyText(frame)).toBe('body')
    } finally {
      await closeAndSaveVideo(launched, 'hwp-header-symbol')
    }
  })
})
