import { describe, expect, it } from 'vitest'
import {
  applyTemplate,
  boardToMarkdown,
  checkExcalidraw,
  checkWhiteboard,
  computePageBounds,
  computeStrokeOutline,
  createNewArchive,
  createNewBoard,
  extractMarkdown,
  extractThumbnail,
  importExcalidraw,
  openWhiteboardArchive,
  orderBetween,
  planBoardEdit,
  readBoardTable,
  sniffImage,
  WhiteboardOpenError,
} from '../src/node'

const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

describe('@genoffice/whiteboard-engine WASM', () => {
  it('creates, saves, opens, and preserves byte-identical archives on no-op save', () => {
    const doc = createNewBoard('board-1', 'page-1', 'Planning')
    const arch = createNewArchive(doc)
    try {
      const meta = arch.addImageResource('img-1', TINY_PNG)
      expect(meta.mime).toBe('image/png')
      expect(meta.width).toBe(1)
      expect(meta.height).toBe(1)
      arch.setThumbnail(TINY_PNG)
      const bytes = arch.save()

      const checked = checkWhiteboard(bytes)
      expect(checked.ok).toBe(true)
      if (checked.ok) {
        expect(checked.pageCount).toBe(1)
        expect(checked.title).toBe('Planning')
      }

      const reopened = openWhiteboardArchive(bytes)
      try {
        expect(reopened.isChanged()).toBe(false)
        const resaved = reopened.save()
        expect(resaved).toEqual(bytes)
        expect(reopened.getResource('img-1')).toEqual(TINY_PNG)
        expect(extractThumbnail(bytes)).toEqual(TINY_PNG)
      } finally {
        reopened.dispose()
      }
    } finally {
      arch.dispose()
    }
  })

  it('rejects malformed input with structured OpenError codes', () => {
    const bad = checkWhiteboard(new TextEncoder().encode('not a zip'))
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.error.code).toBe('not_zip')
    }
    expect(() => openWhiteboardArchive(new Uint8Array([1, 2, 3]))).toThrow(WhiteboardOpenError)
  })

  it('plans edits atomically, applies declarative templates, computes bounds/strokes, and exports markdown', () => {
    const base = createNewBoard('board-2', 'page-1', 'Sprint')
    const edited = planBoardEdit(
      base,
      [
        { op: 'rename_page', pageId: 'page-1', title: 'Kickoff' },
        { op: 'add', id: 's1', kind: 'sticky', text: 'Ship Rust WASM' },
        { op: 'add', id: 's2', kind: 'link', url: 'https://example.com', title: 'Docs' },
      ],
      { defaultPageId: 'page-1' },
    )
    expect(edited.ok).toBe(true)
    expect(edited.changed).toBe(true)
    expect(edited.created).toEqual(['s1', 's2'])

    const rejected = planBoardEdit(
      edited.doc,
      [
        { op: 'add', kind: 'sticky', text: 'Rolled back' },
        { op: 'delete_page', pageId: 'page-1' },
      ],
      { defaultPageId: 'page-1' },
    )
    expect(rejected.ok).toBe(false)
    expect(rejected.changed).toBe(false)
    expect(rejected.doc.objects.length).toBe(2)

    const tpl = applyTemplate(
      edited.doc,
      {
        schemaVersion: 1,
        target: 'new_pages',
        pages: [
          {
            key: 'p-retro',
            title: 'Retro',
            blocks: [
              { type: 'title', key: 't', text: 'Retrospective' },
              {
                type: 'grid',
                key: 'g',
                columns: 2,
                children: [
                  { type: 'card', key: 'c1', title: 'Good', body: 'Fast' },
                  { type: 'card', key: 'c2', title: 'Next', body: 'Polish' },
                ],
              },
              { type: 'connector', key: 'arrow', from: 'c1', to: 'c2' },
            ],
          },
        ],
      },
      'page-1',
    )
    expect(tpl.ok).toBe(true)
    if (tpl.ok) {
      expect(tpl.result.createdPageIds.length).toBe(1)
      expect(tpl.result.createdObjectIds.length).toBe(4)

      const table = readBoardTable(tpl.result.doc, 'Kickoff', ['s1'])
      expect(table?.text).toContain('[SELECTED]')
      expect(table?.text).toContain('Ship Rust WASM')

      const md = boardToMarkdown(tpl.result.doc)
      expect(md).toContain('# Sprint')
      expect(md).toContain('## Kickoff')
      expect(md).toContain('## Retro')
      expect(md).toContain('[Docs](https://example.com)')

      const bounds = computePageBounds(tpl.result.doc, 'page-1', 48)
      expect(bounds).not.toBeNull()
      expect(bounds!.width).toBeGreaterThan(200)

      const arch = createNewArchive(tpl.result.doc)
      try {
        const extracted = extractMarkdown(arch.save())
        expect(extracted.ok).toBe(true)
      } finally {
        arch.dispose()
      }
    }

    const strokePath = computeStrokeOutline(
      [
        [0, 0, 0.4],
        [12, 8, 0.7],
        [28, 12, 0.5],
      ],
      4,
    )
    expect(strokePath.startsWith('M ')).toBe(true)
    expect(orderBetween('A', 'Z') > 'A').toBe(true)
    expect(sniffImage(TINY_PNG)?.mime).toBe('image/png')
  })

  it('imports Excalidraw JSON and rejects plain PNG without embedded scene', () => {
    const plainPng = checkExcalidraw(TINY_PNG, 'plain.excalidraw.png')
    expect(plainPng.ok).toBe(false)
    if (!plainPng.ok) {
      expect(plainPng.error.code).toBe('no_excalidraw_scene')
    }

    const sceneBytes = new TextEncoder().encode(
      JSON.stringify({
        type: 'excalidraw',
        version: 2,
        elements: [
          { id: 'r1', type: 'rectangle', x: 10, y: 10, width: 120, height: 80 },
          { id: 'e1', type: 'embeddable', x: 0, y: 0, width: 100, height: 100 },
        ],
        files: {},
      }),
    )
    const { archive, summary } = importExcalidraw(sceneBytes, {
      filenameHint: 'demo.excalidraw',
      boardId: 'b-ex',
      pageId: 'p-ex',
      title: 'Imported',
    })
    try {
      expect(summary.importedCount).toBe(1)
      expect(summary.skippedCount).toBe(1)
      expect(summary.skippedByKind.embeddable).toBe(1)
      expect(archive.getDocument().pages[0].format).toBe('freeform')
    } finally {
      archive.dispose()
    }
  })
})
