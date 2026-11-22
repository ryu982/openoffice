import { execFile } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { closeAndSaveVideo, launchShell, SHELL_DIR } from './helpers'

const execFileAsync = promisify(execFile)

interface ShellApis {
  aiOfficeTabs: {
    list(): Promise<
      Array<{ id: string; kind: string; title: string; active: boolean; filePath?: string }>
    >
  }
  aiOffice: {
    openPath(path: string): Promise<void>
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

test.describe('Whiteboard Excalidraw import and headless export', () => {
  test('imports .excalidraw as untitled clean board, shows dismissible skipped banner, proposes .whiteboard without touching source, and exports via --headless-export', async () => {
    test.setTimeout(240_000)
    const dir = await mkdtemp(join(tmpdir(), 'genoffice-wb-import-'))
    const excalidrawPath = join(dir, 'architecture.excalidraw')
    const excalidrawPayload = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      elements: [
        {
          id: 'rect-1',
          type: 'rectangle',
          x: 40,
          y: 60,
          width: 220,
          height: 110,
          strokeColor: '#1e1e1e',
          backgroundColor: '#a5d8ff',
        },
        {
          id: 'text-1',
          type: 'text',
          x: 60,
          y: 95,
          width: 180,
          height: 36,
          text: 'Excalidraw Box',
          fontSize: 20,
          strokeColor: '#1e1e1e',
        },
        {
          id: 'embed-1',
          type: 'embeddable',
          x: 320,
          y: 60,
          width: 200,
          height: 120,
          link: 'https://example.com',
        },
      ],
    })
    await writeFile(excalidrawPath, excalidrawPayload, 'utf8')
    const originalExcalidrawBytes = await readFile(excalidrawPath)

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'whiteboard-import-export',
      settings: { defaultSaveDir: dir },
    })
    const { app, page: shell } = launched
    const savedWhiteboardPath = join(dir, 'architecture.whiteboard')

    try {
      const before = new Set(app.windows())
      await shell.evaluate(
        (p) => (window as unknown as ShellApis).aiOffice.openPath(p),
        excalidrawPath,
      )
      const board = await waitWhiteboardPage(app, before)

      // Tab is untitled, clean (`dirty: false`), and shows skipped-elements banner
      const tabs = await shell.evaluate(() => (window as unknown as ShellApis).aiOfficeTabs.list())
      const wbTab = tabs.find((t) => t.kind === 'whiteboard')
      expect(wbTab).toBeDefined()
      expect(wbTab!.filePath).toBeUndefined()
      expect(wbTab!.title).toBe('architecture')

      await expect(board.locator('.wb-status-group')).toContainText('Saved')
      await expect(board.locator('.wb-banner')).toContainText('Skipped 1 unsupported element(s)')
      await board.locator('.wb-banner').getByRole('button', { name: 'Dismiss' }).click()
      await expect(board.locator('.wb-banner')).toHaveCount(0)

      // First save proposes `<same-folder>/<name>.whiteboard` and never modifies `.excalidraw`
      await app.evaluate(({ dialog }, target) => {
        const calls: Array<{ defaultPath?: string }> = []
        ;(
          globalThis as unknown as { __wbSaveCalls?: Array<{ defaultPath?: string }> }
        ).__wbSaveCalls = calls
        dialog.showSaveDialog = (async (...args: unknown[]) => {
          const opts = (args.length === 2 ? args[1] : args[0]) as
            { defaultPath?: string } | undefined
          calls.push({ defaultPath: opts?.defaultPath })
          return { canceled: false, filePath: target }
        }) as typeof dialog.showSaveDialog
      }, savedWhiteboardPath)

      await clickMenu(app, 'File', '^Save$')
      await expect.poll(() => existsSync(savedWhiteboardPath), { timeout: 20_000 }).toBe(true)

      const calls = await app.evaluate(
        () =>
          (globalThis as unknown as { __wbSaveCalls?: Array<{ defaultPath?: string }> })
            .__wbSaveCalls ?? [],
      )
      expect(calls[0]?.defaultPath).toBe(savedWhiteboardPath)
      expect((await readFile(excalidrawPath)).equals(originalExcalidrawBytes)).toBe(true)

      const wbBytes = await readFile(savedWhiteboardPath)
      const zip = await JSZip.loadAsync(wbBytes)
      const boardJsonText = await zip.file('board.json')?.async('string')
      expect(boardJsonText).toBeTruthy()
      expect(boardJsonText).toContain('Excalidraw Box')
    } finally {
      await closeAndSaveVideo(launched, 'whiteboard-import-export')
    }

    // Headless export: `.whiteboard` -> PDF & SVG via `--headless-export`
    try {
      const require = createRequire(join(SHELL_DIR, 'package.json'))
      const electronExe = require('electron') as unknown as string
      const { ELECTRON_RUN_AS_NODE: _drop, ...cleanEnv } = process.env
      const pdfOut = join(dir, 'out.pdf')
      const svgOut = join(dir, 'out.svg')
      const extraFlags = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []

      const pdfRes = await execFileAsync(
        electronExe,
        [
          ...extraFlags,
          SHELL_DIR,
          '--headless-export',
          savedWhiteboardPath,
          '--to',
          'pdf',
          '--out',
          pdfOut,
          '--json',
        ],
        { env: { ...cleanEnv, GENOFFICE_USER_DATA: join(dir, 'ud-pdf') }, timeout: 60_000 },
      )
      const pdfJson = JSON.parse(pdfRes.stdout.trim()) as { status: string; output_path: string }
      expect(pdfJson.status).toBe('ok')
      const pdfBytes = await readFile(pdfOut)
      expect(pdfBytes.subarray(0, 5).toString('ascii')).toBe('%PDF-')

      const svgRes = await execFileAsync(
        electronExe,
        [
          ...extraFlags,
          SHELL_DIR,
          '--headless-export',
          savedWhiteboardPath,
          '--to',
          'svg',
          '--page',
          '1',
          '--out',
          svgOut,
          '--json',
        ],
        { env: { ...cleanEnv, GENOFFICE_USER_DATA: join(dir, 'ud-svg') }, timeout: 60_000 },
      )
      const svgJson = JSON.parse(svgRes.stdout.trim()) as { status: string }
      expect(svgJson.status).toBe('ok')
      const svgText = await readFile(svgOut, 'utf8')
      expect(svgText).toContain('<svg')
      expect(svgText).toContain('#FFFFFF')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
