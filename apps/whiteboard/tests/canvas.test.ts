import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { ensureWhiteboardEngineSync } from '@genoffice/whiteboard-engine/node'
import { WhiteboardSession } from '../src/renderer/document/session'
import { parsePdfPageRange } from '../src/renderer/export/pdf-import'
import { renderPageToSvg } from '../src/renderer/export/render-svg'
import { appStrings } from '../src/renderer/i18n/strings-app'
import { aiStrings } from '../src/renderer/i18n/strings-ai'

const ONE_BY_ONE_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
])

describe('WhiteboardSession & canvas rendering', () => {
  it('supports CRUD, undo/redo, page formats, PDF background import, and theme-invariant SVG', async () => {
    ensureWhiteboardEngineSync()
    const session = WhiteboardSession.createBlank('Sprint Board')
    expect(session.isDirty()).toBe(false)
    expect(session.getActivePage()?.format).toBe('freeform')

    const sticky = session.addObject({
      kind: 'sticky',
      x: 100,
      y: 120,
      width: 200,
      height: 150,
      backgroundColor: '#FEF08A',
      text: { paragraphs: [{ runs: [{ text: 'Hello board' }] }] },
    })
    expect(sticky?.kind).toBe('sticky')
    expect(session.isDirty()).toBe(true)

    const svg = renderPageToSvg(
      session.getDocument(),
      session.getActivePageId(),
      session.getAllResourceDataUrls(),
    )
    expect(svg).not.toBeNull()
    expect(svg!.svg).toContain('#FFFFFF')
    expect(svg!.svg).toContain('Hello board')
    expect(svg!.svg).not.toContain('var(--')

    // Undo and redo restore cleanly and keep dirty/unchanged-save state exact.
    expect(session.undo()).toBe(true)
    expect(session.getDocument().objects).toHaveLength(0)
    expect(session.isDirty()).toBe(false)
    expect(session.redo()).toBe(true)
    expect(session.getDocument().objects).toHaveLength(1)
    expect(session.isDirty()).toBe(true)

    // Mark saved, then edit -> undo -> must report clean & unchanged on save.
    session.markSaved('/tmp/saved.whiteboard')
    expect(session.isDirty()).toBe(false)
    session.addObject({
      kind: 'sticker',
      stickerId: 'star',
      tint: '" onload="alert(1)" data-x="',
      x: 20,
      y: 20,
      width: 64,
      height: 64,
    })
    expect(session.isDirty()).toBe(true)
    const stickerSvg = renderPageToSvg(
      session.getDocument(),
      session.getActivePageId(),
      session.getAllResourceDataUrls(),
    )
    expect(stickerSvg!.svg).not.toContain('onload=')
    expect(session.undo()).toBe(true)
    expect(session.isDirty()).toBe(false)
    const saved = await session.serializeForSave({ updateThumbnail: false })
    expect(saved.unchanged).toBe(true)

    // PDF background pages import in 1 undo step.
    const pdfPages = session.importPdfPages(
      [{ pageNumber: 1, width: 800, height: 600, pngBytes: ONE_BY_ONE_PNG }],
      'deck',
    )
    expect(pdfPages).toHaveLength(1)
    expect(pdfPages[0]!.background?.kind).toBe('image')
    expect(session.undo()).toBe(true)
    expect(session.getDocument().pages).toHaveLength(1)

    session.dispose()
  })

  it('parses PDF page ranges with clamping and deduplication', () => {
    expect(parsePdfPageRange('1-3, 5, 2, 100', 10)).toEqual([1, 2, 3, 5])
    expect(parsePdfPageRange('', 3)).toEqual([1, 2, 3])
    expect(parsePdfPageRange('1-100', 80, 50)).toHaveLength(50)
  })

  it('provides all UI languages in both appStrings and aiStrings with matching keys', () => {
    const appKeys = Object.keys(appStrings.zh).sort()
    const aiKeys = Object.keys(aiStrings.zh).sort()
    for (const lang of LANGS) {
      expect(Object.keys(appStrings[lang]).sort()).toEqual(appKeys)
      expect(Object.keys(aiStrings[lang]).sort()).toEqual(aiKeys)
      for (const k of appKeys) {
        expect(appStrings[lang][k as keyof typeof appStrings.zh].trim().length).toBeGreaterThan(0)
      }
      for (const k of aiKeys) {
        expect(aiStrings[lang][k as keyof typeof aiStrings.zh].trim().length).toBeGreaterThan(0)
      }
    }
  })
})
