import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isFileUrlOf } from '../src/drivers/file-url'

const dir = join(process.cwd(), 'tmp-한글 폴더')
const page = join(dir, 'chunk.html')

describe('isFileUrlOf', () => {
  it('accepts the page itself however the URL spells it', () => {
    const href = pathToFileURL(page).href
    expect(isFileUrlOf(href, page)).toBe(true)
    expect(isFileUrlOf(`${href}?v=1#top`, page)).toBe(true)
    expect(isFileUrlOf(href.replace('chunk.html', 'sub/../chunk.html'), page)).toBe(true)
    if (process.platform === 'win32') {
      expect(
        isFileUrlOf(
          href.replace(/^file:\/\/\/(\w):/, (_, d) => `file:///${d.toLowerCase()}:`),
          page,
        ),
      ).toBe(true)
    }
  })

  it('refuses every other file, the folder, and other schemes', () => {
    expect(isFileUrlOf(pathToFileURL(join(dir, 'other.txt')).href, page)).toBe(false)
    expect(isFileUrlOf(pathToFileURL(join(dir, '..', 'chunk.html')).href, page)).toBe(false)
    expect(isFileUrlOf(pathToFileURL(dir).href, page)).toBe(false)
    expect(isFileUrlOf(`http://127.0.0.1/${encodeURIComponent(page)}`, page)).toBe(false)
    expect(isFileUrlOf('about:blank', page)).toBe(false)
    expect(isFileUrlOf('file://not a url', page)).toBe(false)
  })
})
