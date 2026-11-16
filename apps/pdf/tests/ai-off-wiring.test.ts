import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * AI turned off (Settings) in the PDF viewer. The viewer is too large to
 * mount here, so this pins its wiring: every AI entrance renders only while
 * `aiOn` holds (its parts are tested on their own: the jobs' `hidden`, the
 * convert dialog's fill, the job list and the main side), and the preload
 * exposes the choice to read and follow only.
 */
describe('PDF AI-off wiring', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
  const preload = readFileSync(resolve(process.cwd(), 'src/preload/index.ts'), 'utf8')

  it('reads the choice once and follows it', () => {
    expect(source).toContain('const aiOn = useAiOn()')
  })

  it('hides the AI window and its rail', () => {
    expect(source).toMatch(/\{aiOn && \(\s*<div\s+className=\{`ai-dock/)
  })

  it('hides the AI ribbon groups of the home, annotate and form tabs', () => {
    expect(source).toMatch(/AI \(first slot[^\n]*\n\s*\{aiOn && \(/)
    expect(source).toMatch(/ribbonTab === 'annotate' && \(\s*<>\s*\{aiOn && \(/)
    expect(source).toMatch(
      /\{aiOn && \(\s*<button\s+className="rb-big ai-entry"\s+disabled=\{readOnly\}\s+data-tip=\{t\('aiFillFormBtn'\)\}/,
    )
  })

  it('hides the view tab switches of AI results and closes the side-by-side view', () => {
    expect(source).toMatch(/\{aiOn && \(\s*<button\s+className=\{`rb-big\$\{bilingualOn/)
    expect(source).toMatch(/\{aiOn && \(\s*<>\s*<button\s+className=\{`rb-big\$\{passageMarks/)
    expect(source).toContain('if (!aiOn) setBilingualOn(false)')
    expect(source).toContain(
      'const highlightPreview = aiOn && previewShown(highlightPreviewSwitch)',
    )
    expect(source).toContain('{aiOn && passageMarks && (')
  })

  it('hides the document jobs and passage cards, which stay mounted for saves', () => {
    for (const name of ['AiPageReading', 'PassageReading', 'DocumentTranslation', 'AiHighlights'])
      expect(source).toMatch(new RegExp(`<${name}\\s+ref=\\{\\w+\\}\\s+hidden=\\{!aiOn\\}`))
  })

  it('drops the Ask AI entry of the selection bar and its keys', () => {
    expect(source).toMatch(/\{aiOn && \(\s*<button\s+type="button"\s+className="pdf-sel-ask"/)
    expect(source).toContain('{aiOn && askPop && (')
    expect(source).toContain('if (!aiOn && AI_SELECTION_ACTIONS.has(action)) return')
    expect(source).toMatch(/new Set\(\[\s*'explain',\s*'translate',\s*'ask',\s*\]\)/)
  })

  it('puts each document job on the shell list', () => {
    expect(source).toContain('new DocumentJobSession(undefined, window.pdfApi?.aiJob ?? null)')
  })

  it('exposes only reading and following the choice to this tab', () => {
    expect(preload).toMatch(
      /exposeInMainWorld\(APP_CHOICE_BRIDGE_KEY, \{\s*get: appChoice\.get,\s*onChange: appChoice\.onChange,\s*\}\)/,
    )
    expect(preload).not.toContain('appChoice.set')
    expect(preload).not.toContain('stopAllAiJobs')
  })
})
