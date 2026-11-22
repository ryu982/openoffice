import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNewArchive, createNewBoard } from '@genoffice/whiteboard-engine/node'
import { describe, expect, it } from 'vitest'
import { pageFilePaths } from '../src/main/export-paths'
import { parseLinkPreviewHtml } from '../src/main/link-preview'
import { excalidrawOpenRefusal, whiteboardOpenRefusal } from '../src/main/open-check'
import { buildPrintHtml, inertSvg, isPrintPage } from '../src/main/print-document'
import {
  detectWhiteboardFormat,
  isExcalidrawFormat,
  whiteboardBaseName,
} from '../src/shared/formats'
import { WHITEBOARD_CHANNELS } from '../src/shared/ipc'
import { openableLink } from '../src/shared/links'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('whiteboard main security, open-check, links, export paths & print HTML', () => {
  it('all editor IPC channels use the whiteboard: prefix and preload never exposes subscription logout/off', () => {
    for (const channel of Object.values(WHITEBOARD_CHANNELS)) {
      expect(channel.startsWith('whiteboard:')).toBe(true)
    }
    const preloadSrc = readFileSync(join(APP_DIR, 'src/preload/index.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(preloadSrc).not.toContain('subscription-logout')
    expect(preloadSrc).not.toContain('subscription-off')
    expect(preloadSrc).not.toContain('.logout')
  })

  it('openableLink allows only http, https, and mailto', () => {
    expect(openableLink('https://example.com/a')).toBe('https://example.com/a')
    expect(openableLink('http://example.com')).toBe('http://example.com')
    expect(openableLink('mailto:team@example.com')).toBe('mailto:team@example.com')
    expect(openableLink('javascript:alert(1)')).toBeNull()
    expect(openableLink('file:///etc/passwd')).toBeNull()
    expect(openableLink('data:text/html,<script>alert(1)</script>')).toBeNull()
  })

  it('parses og:title, og:description, and absolute og:image from link preview HTML', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Roadmap &amp; Notes" />
        <meta name="description" content="Quarterly plan" />
        <meta property="og:image" content="/thumb.png" />
      </head><body></body></html>
    `
    const parsed = parseLinkPreviewHtml(html, 'https://example.com/docs/1')
    expect(parsed.title).toBe('Roadmap & Notes')
    expect(parsed.description).toBe('Quarterly plan')
    expect(parsed.pictureUrl).toBe('https://example.com/thumb.png')
  })

  it('open-check accepts valid .whiteboard and .excalidraw and rejects corrupt/plain files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-check-'))
    try {
      const validPath = join(dir, 'ok.whiteboard')
      const arch = createNewArchive(createNewBoard('b1', 'p1', 'Test'))
      try {
        writeFileSync(validPath, arch.save())
      } finally {
        arch.dispose()
      }
      expect(whiteboardOpenRefusal(validPath)).toBeNull()

      const badPath = join(dir, 'bad.whiteboard')
      writeFileSync(badPath, 'not a zip')
      expect(whiteboardOpenRefusal(badPath)).not.toBeNull()

      const exOk = join(dir, 'sketch.excalidraw')
      writeFileSync(
        exOk,
        JSON.stringify({ type: 'excalidraw', version: 2, elements: [], files: {} }),
      )
      expect(excalidrawOpenRefusal(exOk)).toBeNull()

      const plainSvg = join(dir, 'plain.excalidraw.svg')
      writeFileSync(plainSvg, '<svg xmlns="http://www.w3.org/2000/svg"></svg>')
      expect(excalidrawOpenRefusal(plainSvg)).not.toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('formats multi-page export paths and strips scripts from print SVG HTML', () => {
    expect(detectWhiteboardFormat('a.excalidraw.png')).toBe('excalidraw.png')
    expect(isExcalidrawFormat(detectWhiteboardFormat('a.excalidraw.svg'))).toBe(true)
    expect(whiteboardBaseName('/tmp/foo.excalidraw.png')).toBe('foo')

    expect(pageFilePaths('/out/board.png', 'png', [1], false)).toEqual(['/out/board.png'])
    expect(pageFilePaths('/out/board.png', 'png', [1, 2], true)).toEqual([
      join('/out', 'board-p1.png'),
      join('/out', 'board-p2.png'),
    ])

    const dirtySvg =
      '<svg onclick="alert(1)"><style>body{background:url(https://evil.example/a)}</style><foreignObject><img src="https://evil.example/x"/></foreignObject><script>evil()</script><image href="https://evil.example/p.png"/><image href="data:image/png;base64,AA==" /><rect width="10" height="10"/></svg>'
    const clean = inertSvg(dirtySvg)
    expect(clean).not.toContain('<script')
    expect(clean).not.toContain('<style')
    expect(clean).not.toContain('<foreignObject')
    expect(clean).not.toContain('onclick=')
    expect(clean).not.toContain('https://evil.example')
    expect(clean).toContain('data:image/png;base64,AA==')

    const page = {
      svg: '<svg width="100" height="100"></svg>',
      width: 100,
      height: 100,
      pageWidth: 100,
      pageHeight: 100,
    }
    expect(isPrintPage(page)).toBe(true)
    const html = buildPrintHtml([page], 'Demo')
    expect(html).toContain('color-scheme: light')
    expect(html).toContain('<title>Demo</title>')
  })
})
