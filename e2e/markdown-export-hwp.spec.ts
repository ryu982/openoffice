/**
 * File › Export as HWP Document… in the Markdown editor: the built app turns
 * the note into a Hangul document (.hwpx, .hwp) through the Word editor's
 * converter in its worker, asks first when something does not carry over, opens
 * the copy in a Hangul tab, and leaves the note, its file and its tab as they were.
 */
import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

const execFileAsync = promisify(execFile)
const REPO_ROOT = join(__dirname, '..')

const MARKDOWN = [
  '# 도서관 이용 안내',
  '',
  '봄 학기 도서관 이용 방법을 정리했습니다.',
  '',
  '## 1. 기본 정보',
  '',
  '| 항목 | 내용 |',
  '| --- | --- |',
  '| 위치 | 본관 2층 동쪽 끝, 계단을 올라와 오른쪽 복도를 따라가면 보이는 유리문 안쪽 |',
  '| 여는 시간 | 평일 오전 9시부터 오후 6시까지이며 시험 기간에는 오후 9시까지 연장해서 엽니다 |',
  '',
  '## 2. 자리 안내',
  '',
  '1. 조용한 구역: 말소리를 내지 않습니다.',
  '2. 모둠 구역: 낮은 목소리로 이야기할 수 있습니다.',
  '',
].join('\n')

/** the note's body paragraphs as the converter writes them; a table's paragraph has no text */
const BODY = [
  '도서관 이용 안내',
  '봄 학기 도서관 이용 방법을 정리했습니다.',
  '1. 기본 정보',
  '',
  '2. 자리 안내',
  '조용한 구역: 말소리를 내지 않습니다.',
  '모둠 구역: 낮은 목소리로 이야기할 수 있습니다.',
]

/** body paragraph texts of a Hangul file, read with the engine build the Hangul editor runs */
async function hangulTexts(path: string): Promise<string[]> {
  const core = pathToFileURL(join(REPO_ROOT, 'vendor/rhwp-core/rhwp.js')).href
  const wasm = join(REPO_ROOT, 'vendor/rhwp-core/rhwp_bg.wasm')
  const script = [
    "import { readFileSync } from 'node:fs'",
    `const { default: init, HwpDocument } = await import(${JSON.stringify(core)})`,
    `await init({ module_or_path: readFileSync(${JSON.stringify(wasm)}) })`,
    'const doc = new HwpDocument(readFileSync(process.argv[1]))',
    'const texts = []',
    'for (let p = 0; p < doc.getParagraphCount(0); p++) {',
    '  const n = doc.getParagraphLength(0, p)',
    "  texts.push(n ? doc.getTextRange(0, p, 0, n) : '')",
    '}',
    'process.stdout.write(JSON.stringify(texts))',
  ].join('\n')
  const { stdout } = await execFileAsync(process.execPath, [
    '--input-type=module',
    '-e',
    script,
    path,
  ])
  return JSON.parse(stdout) as string[]
}

/** the export's save dialog picks `target`; the loss confirmation is recorded and answered */
async function stubDialogs(app: ElectronApplication, target: string, answer: number) {
  await app.evaluate(
    ({ dialog }, [path, response]) => {
      const host = globalThis as unknown as { __hwpConfirms: unknown[] }
      host.__hwpConfirms = []
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as never
      dialog.showMessageBox = (async (...args: unknown[]) => {
        host.__hwpConfirms.push(args[args.length - 1])
        return { response, checkboxChecked: false }
      }) as never
    },
    [target, answer] as const,
  )
}

const confirms = (app: ElectronApplication) =>
  app.evaluate(
    () =>
      (globalThis as unknown as { __hwpConfirms: Array<{ message?: string; detail?: string }> })
        .__hwpConfirms,
  )

async function exportMenu(app: ElectronApplication, label: string) {
  await app.evaluate(({ Menu, BrowserWindow }, text) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const item of items) {
        if (item.label === text) return item
        const child = item.submenu && find(item.submenu.items)
        if (child) return child
      }
    }
    const menu = find(Menu.getApplicationMenu()!.items)
    if (!menu) throw new Error(`Missing File menu item: ${text}`)
    menu.click(undefined as never, BrowserWindow.getFocusedWindow()!, undefined as never)
  }, label)
}

/** the editor may or may not end the note with an empty paragraph */
function withoutTrailingBlanks(texts: string[]): string[] {
  let end = texts.length
  while (end > 0 && texts[end - 1] === '') end--
  return texts.slice(0, end)
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  )

test('Export as HWP Document writes .hwpx and .hwp copies and leaves the note alone', async () => {
  test.setTimeout(240_000)
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-markdown-export-hwp-'))
  const source = join(dir, 'guide.md')
  await writeFile(source, MARKDOWN)

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'markdown-export-hwp',
    openFile: source,
  })
  const { app } = launched
  try {
    const note = await waitForPageWithUrl(app, '://markdown/')
    await expect(note.locator('.doc-editor h1')).toHaveText('도서관 이용 안내', {
      timeout: 60_000,
    })
    const shell = await waitForPageWithUrl(app, 'shell/out')
    const tabs = shell.locator('.tab-bar .tab-item:not(.tab-home)')
    const noteTab = tabs.filter({ hasText: 'guide.md' })

    for (const ext of ['hwpx', 'hwp'] as const) {
      const target = join(dir, `guide.${ext}`)
      // the export opens its copy in a Hangul tab: the menu belongs to the note's tab again
      await noteTab.click()
      await stubDialogs(app, target, 0)
      await exportMenu(app, 'Export as HWP Document…')
      await expect.poll(() => exists(target), { timeout: 120_000 }).toBe(true)
      expect((await confirms(app)).length, `${ext}: the note loses nothing`).toBe(0)
      expect(withoutTrailingBlanks(await hangulTexts(target))).toEqual(BODY)
      await expect(
        tabs.locator('.tab-title').getByText(`guide.${ext}`, { exact: true }),
      ).toHaveCount(1, { timeout: 60_000 })
    }
    expect(await readFile(source, 'utf8')).toBe(MARKDOWN)
    await expect(noteTab).toHaveCount(1)
    await expect(noteTab).toHaveAttribute('title', `guide.md\n${source}`)
    expect(app.windows().some((w) => w.url().includes('://hwp/'))).toBe(true)
  } finally {
    await closeAndSaveVideo(launched, 'markdown-export-hwp')
  }
})

test('a copy that loses something is confirmed first: Cancel writes nothing, Save writes', async () => {
  test.setTimeout(240_000)
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-markdown-export-hwp-loss-'))
  const source = join(dir, 'link.md')
  await writeFile(source, '# 제목\n\n[누리집](https://example.com) 을 봅니다.\n')

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'markdown-export-hwp-loss',
    openFile: source,
  })
  const { app } = launched
  try {
    const note = await waitForPageWithUrl(app, '://markdown/')
    await expect(note.locator('.doc-editor h1')).toHaveText('제목', { timeout: 60_000 })
    const target = join(dir, 'link.hwpx')

    await stubDialogs(app, target, 1)
    await exportMenu(app, 'Export as HWP Document…')
    await expect.poll(async () => (await confirms(app)).length, { timeout: 120_000 }).toBe(1)
    const [asked] = await confirms(app)
    expect(asked.detail).toContain('Hyperlinks')
    await note.waitForTimeout(1000)
    expect(await exists(target)).toBe(false)

    await stubDialogs(app, target, 0)
    await exportMenu(app, 'Export as HWP Document…')
    await expect.poll(() => exists(target), { timeout: 120_000 }).toBe(true)
    expect(await hangulTexts(target)).toContain('누리집 을 봅니다.')
  } finally {
    await closeAndSaveVideo(launched, 'markdown-export-hwp-loss')
  }
})
