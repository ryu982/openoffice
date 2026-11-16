import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import JSZip from 'jszip'
import {
  launchShell,
  closeAndSaveVideo,
  screenshotPath,
  stubAiReady,
  waitForPageWithUrl,
} from './helpers'

/**
 * Editor choice and AI off (Settings → Editors and AI): the first-run pick
 * step, the one-time picker for people who passed the guide before it had
 * one, and the question before a file of a turned-off editor opens. No real
 * subscription program is reached: AI is off, or `stubAiReady` answers for
 * it before it is turned back on, and the native question is stubbed in the
 * main process.
 */

interface TabSummaryOnWindow {
  kind: string
  active: boolean
}

interface ShellWindow {
  aiOfficeTabs: { list(): Promise<TabSummaryOnWindow[]>; activate(id: string): Promise<void> }
  aiOfficeEditorChoice: {
    pickDue(): Promise<boolean>
    set(patch: { off?: string[]; aiFeatures?: boolean }): Promise<unknown>
  }
}

interface StoredSettings {
  onboardingSeen?: boolean
  editorPickSeen?: boolean
  aiFeatures?: boolean
  editors?: { off?: string[] }
}

interface GateCall {
  message: string
  detail?: string
  buttons: string[]
}

async function storedSettings(userDataDir: string): Promise<StoredSettings> {
  const raw = await readFile(join(userDataDir, 'app-settings.json'), 'utf8').catch(() => '{}')
  return JSON.parse(raw) as StoredSettings
}

function tabKinds(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await (window as unknown as ShellWindow).aiOfficeTabs.list()).map((tab) => tab.kind),
  )
}

function quickCard(page: Page, title: string) {
  return page.locator('.quick-card').filter({
    has: page.locator('.quick-title', { hasText: new RegExp(`^${title}$`) }),
  })
}

/**
 * The labels of the next native menu the main process pops up (the tab bar's
 * "+" menu). The popup itself is swallowed, so no native menu is left open.
 */
async function captureNextMenu(app: ElectronApplication, open: () => Promise<void>) {
  await app.evaluate(({ Menu }) => {
    const store = globalThis as unknown as { __menuLabels?: string[] | null; __popup?: unknown }
    store.__menuLabels = null
    store.__popup = Menu.prototype.popup
    Menu.prototype.popup = function (this: { items: { label: string }[] }) {
      store.__menuLabels = this.items.map((item) => item.label)
    }
  })
  try {
    await open()
    await expect
      .poll(() =>
        app.evaluate(
          () => (globalThis as unknown as { __menuLabels?: string[] | null }).__menuLabels ?? null,
        ),
      )
      .not.toBeNull()
    return (await app.evaluate(
      () => (globalThis as unknown as { __menuLabels: string[] }).__menuLabels,
    )) as string[]
  } finally {
    await app.evaluate(({ Menu }) => {
      const store = globalThis as unknown as { __popup?: typeof Menu.prototype.popup }
      if (store.__popup) Menu.prototype.popup = store.__popup
    })
  }
}

/**
 * Replace the native message box: every question is recorded and answered
 * with "Turn on and open" (the first button) or Cancel (the cancel button).
 */
async function stubQuestion(app: ElectronApplication, answer: 'turn-on' | 'cancel') {
  await app.evaluate(({ dialog }, answer) => {
    const store = globalThis as unknown as { __gateCalls: GateCall[] }
    store.__gateCalls = []
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) as {
        message: string
        detail?: string
        buttons?: string[]
        cancelId?: number
      }
      const buttons = options.buttons ?? []
      store.__gateCalls.push({ message: options.message, detail: options.detail, buttons })
      const response = answer === 'turn-on' ? 0 : (options.cancelId ?? buttons.length - 1)
      return { response, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, answer)
}

function questions(app: ElectronApplication): Promise<GateCall[]> {
  return app.evaluate(
    () => (globalThis as unknown as { __gateCalls?: GateCall[] }).__gateCalls ?? [],
  )
}

/** a person opening a file from the OS (Finder's open-file route, the same gate as a double-click) */
async function openFromOs(app: ElectronApplication, path: string) {
  await app.evaluate(({ app: electronApp }, path) => {
    electronApp.emit('open-file', { preventDefault() {} }, path)
  }, path)
}

/** a one-slide deck zipped from the plain-text parts under assets/font-manager-rubik */
async function buildDeck(): Promise<string> {
  const root = resolve(__dirname, 'assets/font-manager-rubik')
  const zip = new JSZip()
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else zip.file(relative(root, full).split('\\').join('/'), await readFile(full))
    }
  }
  await walk(root)
  const out = join(await mkdtemp(join(tmpdir(), 'genoffice-e2e-editor-choice-')), 'deck.pptx')
  await writeFile(out, await zip.generateAsync({ type: 'nodebuffer' }))
  return out
}

test.describe('editor choice and AI off', () => {
  test('first run: PowerPoint and AI off leave every surface, and come back', async () => {
    test.setTimeout(240_000)
    const launched = await launchShell({ videoDir: 'editor-choice-first-run' })
    const { app, page, userDataDir } = launched
    try {
      // ---- first-run guide: welcome → pick → (no connect step with AI off) → done ----
      await expect(page.locator('.onb-overlay')).toBeVisible()
      await page.locator('.onb-next').click()
      const pick = page.locator('.onb-slide.active[data-step="pick"]')
      await expect(pick).toBeVisible()
      // everything starts on
      await expect(
        pick.locator('.ec-row[data-item] [role="switch"][aria-checked="false"]'),
      ).toHaveCount(0)
      await pick.locator('.ec-row[data-item="slides"] [role="switch"]').click()
      await pick.locator('.ec-row[data-item="ai"] [role="switch"]').click()
      await expect(pick.locator('.ec-row[data-item="slides"] [role="switch"]')).toHaveAttribute(
        'aria-checked',
        'false',
      )
      await expect(pick.locator('.ec-row[data-item="ai"] [role="switch"]')).toHaveAttribute(
        'aria-checked',
        'false',
      )
      // AI off drops the connect step: three dots, not four
      await expect(page.locator('.onb-dots .onb-dot')).toHaveCount(3)
      await page.screenshot({ path: screenshotPath('editor-choice-pick-step') })
      await page.locator('.onb-next').click()
      await expect(page.locator('.onb-slide.active')).toHaveAttribute('data-step', 'done')
      await page.locator('.onb-next').click()
      await expect(page.locator('.onb-overlay')).toBeHidden()

      await expect
        .poll(() => storedSettings(userDataDir))
        .toMatchObject({
          onboardingSeen: true,
          editorPickSeen: true,
          aiFeatures: false,
          editors: { off: ['slides'] },
        })

      // ---- Home: no PowerPoint card, the others stay ----
      await expect(page.locator('.home-hero')).toBeVisible()
      await expect(quickCard(page, 'AI Docs')).toHaveCount(1)
      await expect(quickCard(page, 'AI Slides')).toHaveCount(0)
      await page.screenshot({ path: screenshotPath('editor-choice-home-off') })

      // ---- the tab bar's "+" menu: no PowerPoint ----
      const plusMenu = await captureNextMenu(app, () =>
        page.locator('.tab-bar .tab-new-btn').click(),
      )
      expect(plusMenu).toContain('AI Docs')
      expect(plusMenu).not.toContain('AI Slides')

      // ---- Settings: opens on General, no account / AI / skills sections ----
      const settingsButton = page.getByRole('button', { name: 'Settings', exact: true })
      await settingsButton.click()
      const nav = page.locator('.set-nav-item')
      await expect(nav.filter({ hasText: /^Editors and AI$/ })).toHaveCount(1)
      await expect(page.locator('.set-nav-item.active')).toHaveText('General')
      const navLabels = (await nav.allTextContents()).map((label) => label.trim())
      expect(navLabels).not.toContain('Account')
      expect(navLabels).not.toContain('AI')
      expect(navLabels).not.toContain('Skills')
      await page.screenshot({ path: screenshotPath('editor-choice-settings-ai-off') })
      await page.locator('.set-close').click()

      // ---- a new Word document: no AI dock, no AI ribbon buttons ----
      await quickCard(page, 'AI Docs').click()
      const docs = await waitForPageWithUrl(app, '://docs/')
      await docs.locator('.doc-page[contenteditable="true"]').waitFor()
      // the ribbon is drawn: Home's spelling button sits beside where the AI buttons were
      await expect(docs.locator('.ribbon-group').first()).toBeVisible()
      await expect(docs.locator('.ai-dock')).toHaveCount(0)
      await expect(docs.locator('.ai-entry')).toHaveCount(0)
      await docs.screenshot({ path: screenshotPath('editor-choice-docs-ai-off') })

      // ---- back on Home, turn AI on again (no real program: the stub answers) ----
      await page.evaluate(() => (window as unknown as ShellWindow).aiOfficeTabs.activate('home'))
      await expect(page.locator('.home-hero')).toBeVisible()
      await stubAiReady(app)
      await settingsButton.click()
      await nav.filter({ hasText: /^Editors and AI$/ }).click()
      const section = page.getByTestId('editor-choice-section')
      await section.locator('.ec-row[data-item="ai"] [role="switch"]').click()
      await expect(section.locator('.ec-row[data-item="ai"] [role="switch"]')).toHaveAttribute(
        'aria-checked',
        'true',
      )
      // the AI sections come back
      await expect(nav.filter({ hasText: /^Account$/ })).toHaveCount(1)
      await expect(nav.filter({ hasText: /^AI$/ })).toHaveCount(1)
      await expect(nav.filter({ hasText: /^Skills$/ })).toHaveCount(1)
      // the open Word tab hears it without a reload
      await expect(docs.locator('.ai-dock')).toHaveCount(1)
      await expect(docs.locator('.ai-entry').first()).toBeAttached()

      // ---- PowerPoint on again: its card and menu entry return ----
      await section.locator('.ec-row[data-item="slides"] [role="switch"]').click()
      await expect(section.locator('.ec-row[data-item="slides"] [role="switch"]')).toHaveAttribute(
        'aria-checked',
        'true',
      )
      await page.locator('.set-close').click()
      await expect(quickCard(page, 'AI Slides')).toHaveCount(1)
      const plusAgain = await captureNextMenu(app, () =>
        page.locator('.tab-bar .tab-new-btn').click(),
      )
      expect(plusAgain).toContain('AI Slides')

      const saved = await storedSettings(userDataDir)
      expect(saved.aiFeatures).not.toBe(false)
      expect(saved.editors?.off ?? []).not.toContain('slides')
    } finally {
      await closeAndSaveVideo(launched, 'editor-choice-first-run')
    }
  })

  test('an existing user sees the one-time picker once', async () => {
    test.setTimeout(180_000)
    const first = await launchShell({
      onboardingSeen: true,
      editorPickSeen: false,
      videoDir: 'editor-choice-one-time',
    })
    try {
      const dialog = first.page.locator('.ec-pick-dialog')
      await expect(dialog).toBeVisible()
      await expect(first.page.locator('.onb-overlay')).toHaveCount(0)
      // everything starts on
      await expect(dialog.locator('.ec-row[data-item] [role="switch"]').first()).toBeVisible()
      await expect(dialog.locator('[role="switch"][aria-checked="false"]')).toHaveCount(0)
      await first.page.screenshot({ path: screenshotPath('editor-choice-one-time') })
      await dialog.locator('.ec-pick-close').click()
      await expect(dialog).toHaveCount(0)
      await expect
        .poll(async () => (await storedSettings(first.userDataDir)).editorPickSeen)
        .toBe(true)
      // closing keeps the choice as it was: all on
      const saved = await storedSettings(first.userDataDir)
      expect(saved.editors?.off ?? []).toEqual([])
      expect(saved.aiFeatures).not.toBe(false)
    } finally {
      await closeAndSaveVideo(first, 'editor-choice-one-time')
    }

    // the same data folder again (the file is not rewritten): no picker
    const again = await launchShell({
      userDataDir: first.userDataDir,
      videoDir: 'editor-choice-one-time-again',
    })
    try {
      await expect(again.page.locator('.home-hero')).toBeVisible()
      expect(
        await again.page.evaluate(() =>
          (window as unknown as ShellWindow).aiOfficeEditorChoice.pickDue(),
        ),
      ).toBe(false)
      // give the picker the time it would have taken to show
      await again.page.waitForTimeout(2_000)
      await expect(again.page.locator('.ec-pick-dialog')).toHaveCount(0)
    } finally {
      await closeAndSaveVideo(again, 'editor-choice-one-time-again')
    }
  })

  test('opening a file of a turned-off editor asks first', async () => {
    test.setTimeout(240_000)
    const deck = await buildDeck()
    const launched = await launchShell({
      onboardingSeen: true,
      settings: { editors: { off: ['slides'] } },
      videoDir: 'editor-choice-open-gate',
    })
    const { app, page, userDataDir } = launched
    try {
      await expect(page.locator('.home-hero')).toBeVisible()
      await expect(quickCard(page, 'AI Slides')).toHaveCount(0)

      // ---- Cancel: nothing opens, PowerPoint stays off ----
      await stubQuestion(app, 'cancel')
      await openFromOs(app, deck)
      await expect.poll(async () => (await questions(app)).length).toBe(1)
      const [asked] = await questions(app)
      expect(asked.message).toBe('PowerPoint editor is turned off. Turn it on and open?')
      expect(asked.buttons).toEqual(['Turn on and open', 'Cancel'])
      expect(asked.detail).toBe('deck.pptx')
      // the open has ended with nothing opened: Home is in front, no slides tab
      await page.waitForTimeout(1_500)
      expect(await tabKinds(page)).not.toContain('slides')
      expect((await storedSettings(userDataDir)).editors?.off).toEqual(['slides'])

      // ---- Turn on and open: PowerPoint goes on and the deck opens ----
      await stubQuestion(app, 'turn-on')
      await openFromOs(app, deck)
      await expect.poll(async () => (await questions(app)).length).toBe(1)
      await expect.poll(() => tabKinds(page), { timeout: 30_000 }).toContain('slides')
      const slides = await waitForPageWithUrl(app, '://slides/')
      await expect(slides.locator('.stage-wrap canvas').first()).toBeVisible({ timeout: 30_000 })
      await expect
        .poll(async () => (await storedSettings(userDataDir)).editors?.off ?? [])
        .not.toContain('slides')
      // the card is back on Home
      await page.evaluate(() => (window as unknown as ShellWindow).aiOfficeTabs.activate('home'))
      await expect(quickCard(page, 'AI Slides')).toHaveCount(1)

      // ---- off again with the deck open: the open deck stays, opening it again asks nothing ----
      await page.evaluate(() =>
        (window as unknown as ShellWindow).aiOfficeEditorChoice.set({ off: ['slides'] }),
      )
      await expect(quickCard(page, 'AI Slides')).toHaveCount(0)
      expect(await tabKinds(page)).toContain('slides')
      await stubQuestion(app, 'cancel')
      await openFromOs(app, deck)
      await expect
        .poll(
          async () =>
            (
              await page.evaluate(() => (window as unknown as ShellWindow).aiOfficeTabs.list())
            ).find((tab) => tab.active)?.kind,
        )
        .toBe('slides')
      expect(await questions(app)).toHaveLength(0)
      expect((await tabKinds(page)).filter((kind) => kind === 'slides')).toHaveLength(1)
    } finally {
      await closeAndSaveVideo(launched, 'editor-choice-open-gate')
    }
  })
})
