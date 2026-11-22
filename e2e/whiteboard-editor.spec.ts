import { existsSync, rmSync } from 'node:fs'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { closeAndSaveVideo, launchShell } from './helpers'

interface ShellApis {
  aiOfficeTabs: {
    list(): Promise<
      Array<{ id: string; kind: string; title: string; active: boolean; filePath?: string }>
    >
    close(id: string): Promise<void>
  }
  aiOffice: {
    openPath(path: string): Promise<void>
    setTheme(theme: 'light' | 'dark'): Promise<void>
  }
}

async function waitWhiteboardPage(app: ElectronApplication, before: Set<Page>): Promise<Page> {
  let found: Page | undefined
  await expect
    .poll(
      () => {
        found = app.windows().find((p) => !before.has(p) && p.url().includes('://whiteboard/'))
        return found !== undefined
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  await expect(found!.locator('.wb-stage-svg')).toHaveCount(1, { timeout: 30_000 })
  await expect(found!.locator('.wb-error-view')).toHaveCount(0)
  return found!
}

async function clickMenu(
  app: ElectronApplication,
  menuName: string,
  itemRegex: string,
): Promise<void> {
  await app.evaluate(
    ({ Menu }, { menuName: mName, itemRegex: pattern }) => {
      const appMenu = Menu.getApplicationMenu()
      if (!appMenu) throw new Error('no application menu')
      const top = appMenu.items.find((i) => i.label.replace(/&/g, '') === mName)
      if (!top?.submenu) throw new Error(`menu not found: ${mName}`)
      const re = new RegExp(pattern, 'i')
      const item = top.submenu.items.find((i) => re.test(i.label.replace(/&/g, '')))
      if (!item) throw new Error(`menu item not found: ${mName} -> ${pattern}`)
      item.click(undefined as never, undefined as never, undefined as never)
    },
    { menuName, itemRegex },
  )
}

async function stubSaveDialogs(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, targets) => {
    const queue = [...targets]
    const calls: Array<{ defaultPath?: string }> = []
    ;(globalThis as unknown as { __wbSaveCalls?: Array<{ defaultPath?: string }> }).__wbSaveCalls =
      calls
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      const opts = (args.length === 2 ? args[1] : args[0]) as { defaultPath?: string } | undefined
      calls.push({ defaultPath: opts?.defaultPath })
      const next = queue.shift()
      return next ? { canceled: false, filePath: next } : { canceled: true, filePath: '' }
    }) as typeof dialog.showSaveDialog
  }, paths)
}

test.describe('Whiteboard editor core workflows', () => {
  test('create from Home, add objects/link/pages, save, no-op save, reopen, dark theme paper invariance', async () => {
    test.setTimeout(180_000)
    const dir = await mkdtemp(join(tmpdir(), 'genoffice-wb-editor-'))
    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'whiteboard-editor',
      settings: { defaultSaveDir: dir },
    })
    const { app, page: shell } = launched
    try {
      // 1. Open new whiteboard from Home card
      const card = shell.locator('.quick-card', {
        has: shell.locator('.quick-title', { hasText: /^Whiteboard$/ }),
      })
      await expect(card).toHaveCount(1)
      await expect(card.locator('.quick-sub')).toHaveText('.whiteboard')

      const before = new Set(app.windows())
      await card.click()
      const board = await waitWhiteboardPage(app, before)

      // 2. Add a sticky note via toolbar + canvas click
      await board.getByRole('button', { name: 'Sticky note' }).click()
      const svgBox = await board.locator('.wb-stage-svg').boundingBox()
      expect(svgBox).not.toBeNull()
      await board.mouse.click(svgBox!.x + 220, svgBox!.y + 180)
      await expect(board.locator('[data-object-kind="sticky"]')).toHaveCount(1)

      // 3. Add a link card (preview fetch must default to OFF)
      await board.getByRole('button', { name: 'Link card' }).click()
      const dialog = board.locator('.wb-modal')
      await expect(dialog).toBeVisible()
      const fetchToggle = dialog.locator('input[type="checkbox"]')
      await expect(fetchToggle).not.toBeChecked()
      await dialog.locator('input[type="url"]').fill('https://example.com/docs')
      await dialog.locator('input[type="text"]').fill('Example Docs')
      await dialog.getByRole('button', { name: 'Add' }).click()
      await expect(board.locator('[data-object-kind="link"]')).toHaveCount(1)

      // 4. Switch page format to 16:9 Wide and add a second page
      await board.locator('.wb-pages select.wb-select').selectOption('wide_16_9')
      await board.getByRole('button', { name: '+ Add page' }).click()
      await expect(board.locator('.wb-page-tab')).toHaveCount(2)
      await board.locator('.wb-page-tab').first().click()

      // 5. Save to disk and validate .whiteboard archive
      const outFile = join(dir, 'sprint-board.whiteboard')
      await stubSaveDialogs(app, [outFile])
      await clickMenu(app, 'File', '^Save$')
      await expect.poll(() => existsSync(outFile), { timeout: 20_000 }).toBe(true)
      await expect(board.locator('.wb-status-group')).toContainText('Saved')

      const savedBytes = await readFile(outFile)
      const savedMtime = (await stat(outFile)).mtimeMs
      const zip = await JSZip.loadAsync(savedBytes)
      const boardJsonText = await zip.file('board.json')?.async('string')
      expect(boardJsonText).toBeTruthy()
      const parsedBoard = JSON.parse(boardJsonText!) as {
        schemaVersion: number
        pages: Array<{ id: string; format: string }>
        objects: Array<{ kind: string; props?: Record<string, unknown> }>
      }
      expect(parsedBoard.schemaVersion).toBe(1)
      expect(parsedBoard.pages).toHaveLength(2)
      expect(parsedBoard.pages[0]?.format).toBe('wide_16_9')
      expect(boardJsonText).toContain('Example Docs')
      expect(boardJsonText).toContain('https://example.com/docs')

      // 6. No-op save writes nothing (identical bytes & mtime)
      await clickMenu(app, 'File', '^Save$')
      await board.waitForTimeout(1_000)
      expect((await readFile(outFile)).equals(savedBytes)).toBe(true)
      expect((await stat(outFile)).mtimeMs).toBe(savedMtime)

      // 7. Close and reopen the saved .whiteboard
      const tabs = await shell.evaluate(() => (window as unknown as ShellApis).aiOfficeTabs.list())
      const wbTab = tabs.find((t) => t.kind === 'whiteboard')
      expect(wbTab?.filePath).toBe(outFile)
      await shell.evaluate(
        (id) => (window as unknown as ShellApis).aiOfficeTabs.close(id),
        wbTab!.id,
      )
      await expect
        .poll(
          async () =>
            (
              await shell.evaluate(() => (window as unknown as ShellApis).aiOfficeTabs.list())
            ).filter((t) => t.kind === 'whiteboard').length,
        )
        .toBe(0)

      const beforeReopen = new Set(app.windows())
      await shell.evaluate((p) => (window as unknown as ShellApis).aiOffice.openPath(p), outFile)
      const reopened = await waitWhiteboardPage(app, beforeReopen)
      await expect(reopened.locator('[data-object-kind="sticky"]')).toHaveCount(1)
      await expect(reopened.locator('[data-object-kind="link"]')).toHaveCount(1)
      await expect(reopened.locator('.wb-page-tab')).toHaveCount(2)

      // 8. Dark theme leaves board paper warm ivory (#FFFDF8)
      await shell.evaluate(() => (window as unknown as ShellApis).aiOffice.setTheme('dark'))
      await expect(reopened.locator('.wb-stage-svg rect[fill="#FFFDF8"]').first()).toBeVisible()
    } finally {
      await closeAndSaveVideo(launched, 'whiteboard-editor')
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
