/**
 * A Hangul document's PDF carries the fonts its page shows (decision 0144). The document is
 * written in two fonts every Windows PC has (바탕 and 궁서), one paragraph each. Before
 * decision 0144 the page drew both in the stand-in Batang, the PDF drew 궁서 with its Latin
 * letters stretched, and a PDF asked for in the first seconds went out in the engine's fonts.
 *
 * The File menu's PDF export runs as the user runs it, with the save dialog answered. The
 * fonts a PDF carries are read from its font dictionaries (`/BaseFont`).
 */
import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

const execFileAsync = promisify(execFile)
const REPO_ROOT = join(__dirname, '..')

/** the fonts (PostScript names, subset tags off) a PDF's font dictionaries name */
async function pdfFonts(path: string): Promise<string[]> {
  const text = (await readFile(path)).toString('latin1')
  const names = new Set<string>()
  for (const match of text.matchAll(/\/BaseFont\s*\/([^\s/>\]]+)/g)) {
    names.add(match[1]!.replace(/^[A-Z]{6}\+/, ''))
  }
  return [...names].sort()
}

/** an .hwpx of two paragraphs, one in each font, with the engine build the editor runs */
async function writeDocument(path: string): Promise<void> {
  const core = pathToFileURL(join(REPO_ROOT, 'vendor/rhwp-core/rhwp.js')).href
  const wasm = join(REPO_ROOT, 'vendor/rhwp-core/rhwp_bg.wasm')
  const script = [
    "import { readFileSync, writeFileSync } from 'node:fs'",
    `const { default: init, HwpDocument } = await import(${JSON.stringify(core)})`,
    `await init({ module_or_path: readFileSync(${JSON.stringify(wasm)}) })`,
    'const doc = HwpDocument.createEmpty()',
    'doc.createBlankDocument()',
    "const lines = [['바탕', '바탕 문단 Meeting Room 1,234,567'], ['궁서', '궁서 문단 Meeting Room 1,234,567']]",
    'lines.forEach(([font, text], para) => {',
    '  if (para > 0) doc.splitParagraph(0, para - 1, doc.getParagraphLength(0, para - 1))',
    '  doc.insertText(0, para, 0, text)',
    '  const ids = Array.from({ length: 7 }, (_, lang) => doc.findOrCreateFontIdForLang(lang, font))',
    '  doc.applyCharFormat(0, para, 0, doc.getParagraphLength(0, para), JSON.stringify({ fontIds: ids }))',
    '})',
    'writeFileSync(process.argv[1], doc.exportHwpx())',
  ].join('\n')
  await execFileAsync(process.execPath, ['--input-type=module', '-e', script, path])
}

test.skip(process.platform !== 'win32', 'the two fonts are Windows fonts')

test('the File menu PDF carries the fonts the page shows, even right after opening', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ieum-print-fonts-'))
  const file = join(dir, 'two-fonts.hwpx')
  const pdf = join(dir, 'two-fonts.pdf')
  await writeDocument(file)
  const launched = await launchShell({
    onboardingSeen: true,
    lang: 'ko',
    openFile: file,
    videoDir: 'hwp-print-fonts',
    recordVideo: false,
  })
  try {
    const hwp = await waitForPageWithUrl(launched.app, '://hwp/')
    await hwp.waitForSelector('.hwp-app[data-phase="ready"]', { timeout: 90_000 })
    await launched.app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as never
    }, pdf)
    // at once, while the editor may still be reading the PC's fonts: the print waits
    await launched.app.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((c) => c.getURL().includes('://hwp/'))
      page?.send('hwp:print-request', 'pdf')
    })
    await expect.poll(() => existsSync(pdf), { timeout: 120_000 }).toBe(true)
    const fonts = await pdfFonts(pdf)
    console.log('PDF fonts:', fonts.join(', '))
    expect(fonts).toContain('Batang')
    expect(fonts).toContain('Gungsuh')
  } finally {
    await closeAndSaveVideo(launched, 'hwp-print-fonts')
  }
})
