/**
 * The shell's side of the pdf conversion screen: what the dialog may ask
 * around a Markdown / EPUB job, and the File menu items that open it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { PDF_CHANNELS } from '../../pdf/src/shared/ipc'
import {
  createPdfConvertUiHandlers,
  type PdfConvertUiDeps,
} from '../src/main/pdf-convert-ui-handlers'

const VIEW = 7
const SOURCE = 'C:\\docs\\report.pdf'

function deps(overrides: Partial<PdfConvertUiDeps> = {}) {
  const open = new Map<string, string>()
  const d = {
    ownsSource: vi.fn((viewId: number, path: string) => viewId === VIEW && path === SOURCE),
    exists: vi.fn(() => true),
    showInFolder: vi.fn(),
    findMarkdownTab: vi.fn((path: string) => open.get(path)),
    closeTab: vi.fn(async (tabId: string) => {
      for (const [path, id] of open) if (id === tabId) open.delete(path)
    }),
    activateView: vi.fn(),
    openDocument: vi.fn(() => true),
    askBeforeConvert: vi.fn(async () => 'open' as const),
    ...overrides,
  }
  return { d, open, h: createPdfConvertUiHandlers(d) }
}

describe('pdf conversion screen: shell handlers', () => {
  it('answers only the view that owns the source PDF', async () => {
    const { d, h } = deps()
    const req = { source: 'C:\\other.pdf', path: 'C:\\out\\a.md' }
    expect(await h.releaseTarget(VIEW, req)).toBe(false)
    expect(h.openResult(VIEW, req)).toBe(false)
    expect(h.revealResult(VIEW, req)).toBe(false)
    expect(h.openResult(8, { source: SOURCE, path: 'C:\\out\\a.md' })).toBe(false)
    expect(h.openResult(VIEW, null)).toBe(false)
    expect(h.openResult(VIEW, { source: SOURCE })).toBe(false)
    expect(d.openDocument).not.toHaveBeenCalled()
    expect(d.showInFolder).not.toHaveBeenCalled()
  })

  it('opens only Markdown results, through the normal file routing', () => {
    const { d, h } = deps()
    expect(h.openResult(VIEW, { source: SOURCE, path: 'C:\\out\\a.md' })).toBe(true)
    expect(d.openDocument).toHaveBeenCalledWith('C:\\out\\a.md')
    expect(h.openResult(VIEW, { source: SOURCE, path: 'C:\\out\\a.epub' })).toBe(false)
    expect(h.openResult(VIEW, { source: SOURCE, path: 'C:\\out\\run.exe' })).toBe(false)
    expect(d.openDocument).toHaveBeenCalledTimes(1)
  })

  it('does not open a result that is not on disk', () => {
    const { d, h } = deps({ exists: vi.fn(() => false) })
    expect(h.openResult(VIEW, { source: SOURCE, path: 'C:\\out\\a.md' })).toBe(false)
    expect(d.openDocument).not.toHaveBeenCalled()
  })

  it('shows written results in the file manager', () => {
    const { d, h } = deps()
    for (const path of [
      'C:\\out\\a.epub',
      'C:\\out\\a.md',
      'C:\\out\\pics\\p1.png',
      'C:\\out\\a.ko.pdf',
    ]) {
      expect(h.revealResult(VIEW, { source: SOURCE, path })).toBe(true)
      expect(d.showInFolder).toHaveBeenLastCalledWith(path)
    }
    expect(h.revealResult(VIEW, { source: SOURCE, path: 'C:\\Windows\\notepad.exe' })).toBe(false)
  })

  it('closes a Markdown tab showing the target and brings the pdf tab back', async () => {
    const { d, h, open } = deps()
    open.set('C:\\out\\a.md', 't3')
    expect(await h.releaseTarget(VIEW, { source: SOURCE, path: 'C:\\out\\a.md' })).toBe(true)
    expect(d.closeTab).toHaveBeenCalledWith('t3')
    expect(d.activateView).toHaveBeenCalledWith(VIEW)
  })

  it('reports a target the user kept open (unsaved changes)', async () => {
    const { d, h, open } = deps()
    open.set('C:\\out\\a.md', 't3')
    d.closeTab.mockImplementation(async () => {})
    expect(await h.releaseTarget(VIEW, { source: SOURCE, path: 'C:\\out\\a.md' })).toBe(false)
  })

  it('has nothing to free when no tab shows the target', async () => {
    const { d, h } = deps()
    expect(await h.releaseTarget(VIEW, { source: SOURCE, path: 'C:\\out\\a.md' })).toBe(true)
    expect(d.closeTab).not.toHaveBeenCalled()
  })
})

describe('pdf conversion screen: wiring', () => {
  const main = (file: string) => readFileSync(join(__dirname, '../src/main', file), 'utf8')
  const index = main('index.ts')
  const wiring = main('pdf-convert-ui.ts')

  it('is registered once from the shell entry', () => {
    expect(index.match(/^registerPdfConvertUiIpc\(\{$/gm)).toHaveLength(1)
  })

  it('handles each of the dialog requests', () => {
    for (const key of ['convertReleaseTarget', 'convertOpenResult', 'convertRevealResult']) {
      expect(PDF_CHANNELS).toHaveProperty(key)
      expect(wiring).toContain(`ipcMain.handle(PDF_CHANNELS.${key},`)
    }
    expect(wiring).toContain('pdfPathGranted(viewId, path)')
  })

  it('offers every conversion in the pdf Save As dialog and hands the name to it', () => {
    const start = index.indexOf('async function savePdfAs(')
    const end = index.indexOf('let exportingPdfDocx', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const flow = index.slice(start, end)
    expect(flow).toContain('filters: pdfSaveAsFilters(tm)')
    expect(flow).toContain('defaultPath: pdfSaveAsDefaultPath(tab.filePath)')
    expect(flow).toContain("if (format === 'md' || format === 'epub')")
    expect(flow).toContain('grantPdfStructureTarget(tab.webContents, tab.filePath, target, format)')
    expect(flow).toContain('requestPdfConvertDialog(tab.webContents, format, target)')
    expect(flow).toContain('requestPdfPageImages(tab.webContents, target)')
    expect(flow).toContain('() => exportPdfAsDocxLocal(preset)')
    expect(flow).toContain('() => exportPdfAsPptxLocal(preset)')
    expect(flow).toContain('() => exportPdfAsXlsxLocal(preset)')
    // the PDF copy path is unchanged
    expect(flow).toContain('requestPdfSaveAsOutcome(tab.webContents, target)')
    // the conversion runs once the Save As flow (autosave pause) has ended
    expect(flow.indexOf('if (convert) await convert()')).toBeLessThan(
      flow.indexOf('setPdfSaveAsInFlight(tab.webContents, true)'),
    )
  })

  it('skips only the save dialog of a Word / PowerPoint / Excel conversion Save As picked', () => {
    for (const kind of ['Docx', 'Pptx', 'Xlsx']) {
      const start = index.indexOf(`async function exportPdfAs${kind}Local(`)
      expect(start).toBeGreaterThan(0)
      const flow = index.slice(start, index.indexOf('\n}\n', start))
      expect(flow).toContain('const tab = preset?.tab ?? activePdfTarget()')
      // pending edits are still saved first, then the picked name replaces the dialog
      expect(flow.indexOf('flushPdfSave(tab.webContents, true)')).toBeLessThan(
        flow.indexOf('const picked = preset'),
      )
      expect(flow).toContain('{ canceled: false, filePath: preset.target }')
      expect(flow).toContain('await showSaveDialogWithMemory(dialog, host, {')
      expect(flow).toContain('host.setProgressBar(2)')
      expect(flow).toContain('promptPdfPassword(host, {')
    }
    // the File menu and the converter dropdown still open the dialog
    expect(index).toContain('click: () => void exportPdfAsDocxLocal(),')
    expect(index).toContain("if (format === 'docx') await exportPdfAsDocxLocal()")
  })

  it('labels the page-image file type in every language', () => {
    expect(index.match(/^ {4}filterPdfPageImages: '.+',$/gm)).toHaveLength(LANGS.length)
  })

  it('adds Markdown and EPUB to the pdf File menu next to the existing conversions', () => {
    const items = [
      "label: tm('menuExportDocx')",
      "label: tm('menuExportPptx')",
      "label: tm('menuExportXlsx')",
      "label: tm('menuExportMd')",
      "label: tm('menuExportEpub')",
    ].map((label) => index.indexOf(label))
    expect(items.every((at) => at > 0)).toBe(true)
    expect([...items].sort((a, b) => a - b)).toEqual(items)
    // Markdown asks first while its editor is off (editor choice spec 7.3)
    expect(index).toContain("askThenRequestPdfConvertDialog(activePdfTarget(), 'md')")
    expect(index).toContain("requestPdfConvertDialog(activePdfTarget()?.webContents, 'epub')")
  })

  it('labels the new menu items in every language', () => {
    expect(index.match(/^ {4}menuExportMd: '.+',$/gm)).toHaveLength(LANGS.length)
    expect(index.match(/^ {4}menuExportEpub: '.+',$/gm)).toHaveLength(LANGS.length)
  })
})

describe('pdf conversion screen: the Markdown editor turned off (editor choice spec 7.3)', () => {
  it("asks for the view's own PDF before the converter's dialog opens", async () => {
    const askBeforeConvert = vi.fn(async () => 'file-only' as const)
    const { h } = deps({ askBeforeConvert })
    expect(await h.askBeforeConvert(VIEW, { source: SOURCE, format: 'md' })).toBe('file-only')
    expect(askBeforeConvert).toHaveBeenCalledWith('md', SOURCE)
  })

  it('answers cancel to another view or a malformed request, without asking', async () => {
    const askBeforeConvert = vi.fn(async () => 'open' as const)
    const { h } = deps({ askBeforeConvert })
    expect(await h.askBeforeConvert(8, { source: SOURCE, format: 'md' })).toBe('cancel')
    expect(await h.askBeforeConvert(VIEW, { source: SOURCE, format: 'docx' })).toBe('cancel')
    expect(await h.askBeforeConvert(VIEW, { format: 'md' })).toBe('cancel')
    expect(await h.askBeforeConvert(VIEW, null)).toBe('cancel')
    expect(askBeforeConvert).not.toHaveBeenCalled()
  })

  it('the File menu asks before the dialog, and a cancel opens no dialog', () => {
    const ui = readFileSync(join(__dirname, '../src/main/pdf-convert-ui.ts'), 'utf8')
    expect(ui).toMatch(
      /if \(\(await askBeforeConvert\(format, tab\.filePath\)\) === 'cancel'\) return\n {2}requestPdfConvertDialog\(tab\.webContents, format\)/,
    )
    expect(ui).toMatch(/ipcMain\.handle\(PDF_CHANNELS\.convertAskBeforeOpen,/)
    const main = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    expect(main).toMatch(
      /click: \(\) => void askThenRequestPdfConvertDialog\(activePdfTarget\(\), 'md'\)/,
    )
    // a Markdown result opens in its tab, or is shown in its folder while the editor is off
    expect(main).toMatch(
      /registerPdfConvertUiIpc\(\{[\s\S]*?openDocument: \(path\) => openMadeDocument\(path\)/,
    )
  })

  it("the converter's Markdown entry asks before the dialog; EPUB does not", () => {
    const app = readFileSync(join(__dirname, '../../pdf/src/renderer/App.tsx'), 'utf8')
    const start = app.indexOf('const openConvertDialog = async')
    const body = app.slice(start, app.indexOf('\n  }\n', start))
    expect(body).toMatch(/format === 'md' && filePath && window\.pdfApi\?\.askBeforeConvert/)
    expect(body).toMatch(
      /if \(answer === 'cancel'\) return\n {4}\}\n {4}setConvertDialog\(\{ format \}\)/,
    )
  })
})
