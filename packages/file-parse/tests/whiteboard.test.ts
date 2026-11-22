import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNewArchive, createNewBoard, planBoardEdit } from '@genoffice/whiteboard-engine/node'
import { describe, expect, it } from 'vitest'
import { attachableMaxBytes, isAttachableExt, parseFileToText, whiteboardToText } from '../src'

describe('file-parse whiteboard support', () => {
  it('marks .whiteboard attachable and size-free, and excludes .excalidraw', () => {
    expect(isAttachableExt('whiteboard')).toBe(true)
    expect(attachableMaxBytes('whiteboard')).toBe(Number.POSITIVE_INFINITY)
    expect(isAttachableExt('excalidraw')).toBe(false)
  })

  it('extracts deterministic markdown text from .whiteboard files', async () => {
    const base = createNewBoard('b1', 'p1', 'Architecture Notes')
    const planned = planBoardEdit(
      base,
      [
        { op: 'rename_page', pageId: 'p1', title: 'Overview' },
        { op: 'add', kind: 'sticky', text: 'Rust WASM Core' },
        { op: 'add', kind: 'link', url: 'https://example.com', title: 'Spec Link' },
      ],
      { defaultPageId: 'p1' },
    )
    expect(planned.ok).toBe(true)

    const arch = createNewArchive(planned.doc)
    let bytes: Uint8Array
    try {
      bytes = arch.save()
    } finally {
      arch.dispose()
    }

    const text = whiteboardToText(bytes)
    expect(text).toContain('# Architecture Notes')
    expect(text).toContain('## Overview')
    expect(text).toContain('Rust WASM Core')
    expect(text).toContain('[Spec Link](https://example.com)')

    const dir = mkdtempSync(join(tmpdir(), 'fp-wb-'))
    try {
      const filePath = join(dir, 'sample.whiteboard')
      writeFileSync(filePath, bytes)
      const parsed = await parseFileToText(filePath)
      expect(parsed.ok).toBe(true)
      expect(parsed.kind).toBe('text')
      expect(parsed.text).toContain('Rust WASM Core')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects non-zip files with .whiteboard extension', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-wb-bad-'))
    try {
      const filePath = join(dir, 'broken.whiteboard')
      writeFileSync(filePath, 'plain text')
      const parsed = await parseFileToText(filePath)
      expect(parsed.ok).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
