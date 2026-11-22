import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('whiteboard-engine browser entry safety', () => {
  it('src/index.ts and src/types.ts contain zero Node builtins, Buffer, or require()', () => {
    for (const rel of ['src/index.ts', 'src/types.ts']) {
      const raw = readFileSync(join(PKG_DIR, rel), 'utf8')
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(code, `${rel} must not import node:*`).not.toMatch(/['"]node:/)
      expect(code, `${rel} must not reference Buffer`).not.toMatch(/\bBuffer\b/)
      expect(code, `${rel} must not call require()`).not.toMatch(/\brequire\s*\(/)
    }
  })
})
