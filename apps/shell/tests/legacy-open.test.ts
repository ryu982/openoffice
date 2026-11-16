import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { convertLegacyFile, legacyEditorFor } from '../src/main/legacy-open'
import { collectLaunchPaths } from '../src/main/launch-paths'
import { KNOWN_UNSUPPORTED_DOC_RE, OPENABLE_DOC_RE } from '@genoffice/electron-utils/drop-open'

const FIXTURES = join(__dirname, '../../../packages/file-parse/tests/fixtures')
const DOC = join(FIXTURES, 'legacy-sample.doc')
const PPT = join(FIXTURES, 'legacy-sample.ppt')

describe('legacy .doc/.dot/.ppt open as converted copies', () => {
  it('routes Word 97-2003 to the Word tab and PowerPoint 97-2003 to the slides tab', () => {
    expect(legacyEditorFor('C:/a/report.doc')).toBe('docs')
    expect(legacyEditorFor('C:/a/letter.DOT')).toBe('docs')
    expect(legacyEditorFor('/a/deck.ppt')).toBe('slides')
    expect(legacyEditorFor('/a/deck.pptx')).toBeNull()
    expect(legacyEditorFor('/a/report.docx')).toBeNull()
    expect(legacyEditorFor('/a/show.pps')).toBeNull()
  })

  it('converts a .doc to a .docx copy named beside the original', async () => {
    const result = await convertLegacyFile(DOC)
    expect(result?.ok).toBe(true)
    if (!result?.ok) return
    expect(result.copy.editor).toBe('docs')
    expect(result.copy.fileName).toBe('legacy-sample.docx')
    expect(result.copy.saveAsDefaultPath).toBe(join(FIXTURES, 'legacy-sample.docx'))
    expect(result.copy.importedFrom).toBe('doc')
    const zip = await JSZip.loadAsync(result.copy.bytes)
    expect(zip.file('word/document.xml')).toBeTruthy()
  })

  it('converts a .ppt to a .pptx copy named beside the original', async () => {
    const result = await convertLegacyFile(PPT)
    expect(result?.ok).toBe(true)
    if (!result?.ok) return
    expect(result.copy.editor).toBe('slides')
    expect(result.copy.fileName).toBe('legacy-sample.pptx')
    expect(result.copy.importedFrom).toBe('ppt')
    const zip = await JSZip.loadAsync(result.copy.bytes)
    expect(zip.file('ppt/presentation.xml')).toBeTruthy()
  })

  it('reads the original only', async () => {
    const before = readFileSync(PPT)
    await convertLegacyFile(PPT)
    expect(readFileSync(PPT).equals(before)).toBe(true)
  })

  it('reports a file the converter refuses instead of throwing', async () => {
    const result = await convertLegacyFile(
      '/x/broken.ppt',
      async () => new Uint8Array([1, 2, 3, 4]),
    )
    expect(result).toMatchObject({ ok: false, reason: 'failed', from: 'ppt', to: 'pptx' })
  })

  it('accepts the three extensions from a drop and a command line, and no longer calls them unsupported', () => {
    for (const name of ['a.doc', 'a.dot', 'a.ppt']) {
      expect(OPENABLE_DOC_RE.test(name), name).toBe(true)
      expect(KNOWN_UNSUPPORTED_DOC_RE.test(name), name).toBe(false)
    }
    expect(collectLaunchPaths(['app.exe', 'C:/a/deck.ppt'], undefined, () => true)).toEqual([
      'C:/a/deck.ppt',
    ])
  })
})
