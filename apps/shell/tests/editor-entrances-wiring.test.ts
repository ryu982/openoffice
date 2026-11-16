import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Where the entrances inside other features ask (editor choice spec 7.3).
 * index.ts, the PDF tools window and the editor mains need a running
 * Electron, so the wiring is pinned by reading the source: each asks before
 * its work (no dialog, read or write ahead of the question), a cancel ends
 * it, and an export into a turned-off editor shows its folder instead of a
 * tab. The questions themselves are tested in editor-entrances.test.ts.
 */

const read = (path: string) => readFileSync(join(__dirname, path), 'utf8')
const main = read('../src/main/index.ts')

function fnSource(text: string, head: string): string {
  const start = text.indexOf(head)
  if (start < 0) throw new Error(`no ${head}`)
  const end = text.indexOf('\n}\n', start)
  return text.slice(start, end < 0 ? undefined : end)
}

/** `first` comes before `then` in `text` (both present) */
function before(text: string, first: RegExp | string, then: RegExp | string): void {
  const a = typeof first === 'string' ? text.indexOf(first) : text.search(first)
  const b = typeof then === 'string' ? text.indexOf(then) : text.search(then)
  expect(a, String(first)).toBeGreaterThanOrEqual(0)
  expect(b, String(then)).toBeGreaterThanOrEqual(0)
  expect(a).toBeLessThan(b)
}

describe('the shell installs one set of entrances', () => {
  it('on the editor gate, and hands the asker to the editor mains', () => {
    expect(main).toMatch(/const entrances = createEditorEntrances\(\{\n {2}gate: \(\) => openGate,/)
    expect(main).toMatch(/setEditorEntranceAsker\(entrances\)/)
    before(main, 'installEditorGate(openGate)', 'const entrances = createEditorEntrances(')
  })
})

describe('exports: no question; the folder while the target editor is off', () => {
  it("the editors' openGeneratedPath hook answers false, so the editor shows the folder", () => {
    const fn = fnSource(main, 'function openGeneratedDocument(')
    expect(fn).toMatch(
      /function openGeneratedDocument\(filePath: string\): boolean \{\n {2}\/\/ [^\n]*\n {2}if \(!entrances\.opensInTab\(filePath\)\) return false\n/,
    )
  })

  it('HTML → PDF and Hangul → PDF show the folder when the hook says no', () => {
    const html = read('../../html/src/main/html-main.ts')
    expect(fnSource(html, 'function openExportedPdf(')).toMatch(
      /if \(runtime\.openGeneratedPath\?\.\(path\)\) return[\s\S]*shell\.showItemInFolder\(path\)/,
    )
    expect(read('../../hwp/src/main/hwp-main.ts')).toMatch(
      /if \(!runtime\.openGeneratedPath\?\.\(target\)\) shell\.showItemInFolder\(target\)/,
    )
  })

  it('PDF Save As and the Word results of HTML and Markdown open or show their folder', () => {
    expect(fnSource(main, 'async function savePdfAsPick(')).toMatch(/openMadeDocument\(target\)/)
    expect(main).toMatch(
      /setMarkdownDocxExportedHook\(\(path\) => \{\n {4}openMadeDocument\(path\)/,
    )
    expect(main).toMatch(/setHtmlDocxExportedHook\(\(path\) => \{\n {4}openMadeDocument\(path\)/)
  })
})

describe('PDF conversions ask before any dialog or conversion', () => {
  for (const [kind, item] of [
    ['Docx', 'docs'],
    ['Pptx', 'slides'],
    ['Xlsx', 'sheets'],
  ] as const) {
    it(`PDF → ${kind}: the menu and the converter ask; Save As does not`, () => {
      const fn = fnSource(main, `async function exportPdfAs${kind}Local(`)
      const ask = `if (!preset && (await entrances.makeAndOpen('${item}', { fileName: tab.filePath })) === 'cancel')`
      expect(fn).toContain(ask)
      before(fn, ask, 'flushPdfSave(')
      before(fn, ask, 'showSaveDialogWithMemory(')
      expect(fn).toContain('openMadeDocument(picked.filePath)')
      expect(fn).not.toMatch(/openDocumentPath\(picked\.filePath\)/)
    })
  }

  it('PDF → Hangul needs the Hangul editor itself', () => {
    const fn = fnSource(main, 'async function openPdfAsHwp(')
    before(fn, "await entrances.editorEntrance('hwp'", 'flushPdfSave(')
    before(fn, "await entrances.editorEntrance('hwp'", 'openPdfCopyAsHwp(')
  })
})

describe('the PDF tools window', () => {
  const tools = read('../src/main/pdf-tools/pdf-tools-window.ts')

  it("a result's open asks while its editor is off", () => {
    expect(tools).toMatch(
      /if \(d\.askBeforeOpenResult\) await d\.askBeforeOpenResult\(path, \(p\) => d\.openResult\(p\)\)\n {4}else d\.openResult\(path\)/,
    )
    expect(main).toMatch(
      /askBeforeOpenResult: \(path, open\) => entrances\.openExisting\(path, open\)/,
    )
  })

  it('"open in the editor" asks for the PDF editor before the file is picked', () => {
    const fn = fnSource(tools, 'async function openInEditor(')
    before(fn, "deps.askEditorOn('pdf')", 'showOpenDialogWithMemory(')
  })

  it('opening it from the PDF editor or Home asks for the PDF tools first', () => {
    const fn = fnSource(tools, 'export function openPdfToolsWithFile(')
    before(fn, "d.askEditorOn('pdfTools')", 'inputsFrom(')
    before(fn, "d.askEditorOn('pdfTools')", 'openPdfToolsWindow()')
    const home = tools.slice(tools.indexOf('PDF_TOOLS_HOME_CHANNELS.open'))
    before(home, "deps.askEditorOn('pdfTools')", 'openPdfToolsWindow()')
    expect(main).toMatch(/askEditorOn: \(item\) => entrances\.editorEntrance\(item\)/)
  })
})

describe('the generate window', () => {
  it('asks through the entrances and writes "file only" results where new documents go', () => {
    expect(main).toMatch(/askEditor: \(item, withFileOnly, source\) =>/)
    expect(main).toMatch(/\? entrances\.makeAndOpen\(item, \{ fileName: source \}\)/)
    expect(main).toMatch(/: entrances\.editorEntrance\(item\)\.then/)
    const save = main.slice(main.indexOf('saveConvertedFile: async (fileName, bytes) => {'))
    expect(save).toMatch(
      /const target = await writeInDefaultSaveFolder\(fileName, bytes\)\n {6}shell\.showItemInFolder\(target\)/,
    )
    expect(fnSource(main, 'async function writeInDefaultSaveFolder(')).toMatch(
      /const dir = defaultSaveDir\(\)[\s\S]*?uniquePathIn\(dir, fileName\)[\s\S]*?atomicWriteFile\(target/,
    )
  })

  it('its preload exposes the choice to read and hear, never to change', () => {
    const preload = read('../src/preload/generate.ts')
    expect(preload).toMatch(
      /contextBridge\.exposeInMainWorld\(GENERATE_CHOICE\.bridgeKey, \{\n {2}get:/,
    )
    expect(preload).toMatch(/onChange: /)
    expect(preload).not.toMatch(/choice\.set\b|stopAllAiJobs|markPickSeen|set-editor-choice/)
  })
})

describe('Markdown and HTML conversions that open in another editor', () => {
  const markdown = read('../../markdown/src/main/markdown-main.ts')
  const html = read('../../html/src/main/html-main.ts')

  it('Markdown → open in Word asks before anything is written; file only goes to the save folder', () => {
    const body = markdown.slice(markdown.indexOf("if (request.mode === 'openInDocs') {"))
    before(body, "askBeforeMakeAndOpen('docs'", 'writeMarkdownConversion(')
    expect(body).toMatch(/if \(answer === 'cancel'\) return \{ ok: true, canceled: true \}/)
    expect(body).toMatch(
      /if \(answer === 'file-only'\) \{[\s\S]*?configuredDefaultSaveDir\(app\)[\s\S]*?shell\.showItemInFolder\(target\)/,
    )
  })

  it('Markdown → Hangul from the File menu asks before its dialog; Save As does not', () => {
    const body = markdown.slice(markdown.indexOf('MARKDOWN_CHANNELS.exportHwp,'))
    expect(body).toMatch(/if \(!target && \(await askBeforeMakeAndOpen\('hwp'/)
    before(body, "askBeforeMakeAndOpen('hwp'", 'showSaveDialogWithMemory(')
    before(body, "askBeforeMakeAndOpen('hwp'", 'lent.convert(')
  })

  it('HTML → Word asks before its dialog, never in a headless export', () => {
    const body = html.slice(html.indexOf('HTML_CHANNELS.exportDocx,'))
    expect(body).toMatch(/!headless &&\n {8}\(await askBeforeMakeAndOpen\('docs'/)
    before(body, "askBeforeMakeAndOpen('docs'", 'showSaveDialogWithMemory(')
    before(body, "askBeforeMakeAndOpen('docs'", 'writeHtmlDocx(')
  })
})

describe("the PDF annotation list's Markdown / Word document", () => {
  const pdf = read('../../pdf/src/main/pdf-main.ts')

  it('has a channel of its own, apart from the AI create_document', () => {
    const app = read('../../pdf/src/renderer/App.tsx')
    expect(app).toMatch(/\(request\) => window\.pdfApi\.openAnnotDocument\(request\)/)
    expect(read('../../pdf/src/preload/index.ts')).toMatch(
      /openAnnotDocument: \(request\) => ipcRenderer\.invoke\(PDF_CHANNELS\.annotDocument, request\)/,
    )
  })

  it('asks before anything is made; "file only" never reaches the AI creator', () => {
    const body = pdf.slice(pdf.indexOf('PDF_CHANNELS.annotDocument,'))
    before(body, 'askBeforeMakeAndOpen(', 'await make(parsed')
    expect(body).toMatch(/if \(answer === 'cancel'\) return \{ ok: false, canceled: true \}/)
    expect(body).toMatch(
      /const make = answer === 'file-only' \? runtime\.writeDocumentFile : runtime\.createDocument/,
    )
    expect(main).toMatch(/writeDocumentFile: \(request, owner\) =>\n {4}writeDocumentFileOnly\(/)
  })
})
