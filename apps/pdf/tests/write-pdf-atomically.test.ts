// @vitest-environment node
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { rename as renameFn } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SAVE_TARGET_LOCKED, writePdfAtomically } from '../src/main/atomic-write'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})

const realFsp = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
const rename = vi.mocked(renameFn)

const refused = (code: string) =>
  Object.assign(new Error(`${code}: operation not permitted, rename`), { code })

let dir: string | undefined

afterEach(() => {
  rename.mockClear()
  rename.mockImplementation(realFsp.rename)
  if (dir) {
    for (const name of readdirSync(dir)) chmodSync(join(dir, name), 0o666)
    rmSync(dir, { recursive: true, force: true })
  }
  dir = undefined
})

function fixture(name = 'doc.pdf', content = 'old content that is longer'): string {
  dir = mkdtempSync(join(tmpdir(), 'pdf-atomic-'))
  const target = join(dir, name)
  writeFileSync(target, content)
  return target
}

describe('writePdfAtomically', () => {
  it('replaces a file whose name is near the 255-byte file-name limit', async () => {
    // 80 Hangul letters + ".pdf" is 244 bytes; a temp name must not grow past 255
    const name = `${'가'.repeat(80)}.pdf`
    const target = fixture(name, 'old')
    await writePdfAtomically(target, new TextEncoder().encode('new'))
    expect(readFileSync(target, 'utf8')).toBe('new')
    // the temp file is renamed away, nothing is left beside the file
    expect(readdirSync(dir!)).toEqual([name])
  })

  it('retries a rename Windows refuses for a moment (antivirus scanning the temp)', async () => {
    const target = fixture()
    rename.mockRejectedValueOnce(refused('EPERM')).mockRejectedValueOnce(refused('EBUSY'))
    await writePdfAtomically(target, new TextEncoder().encode('new'))
    expect(rename).toHaveBeenCalledTimes(3)
    expect(readFileSync(target, 'utf8')).toBe('new')
    expect(readdirSync(dir!)).toEqual(['doc.pdf'])
  })

  it('writes into the existing file when the rename keeps being refused', async () => {
    const target = fixture()
    rename.mockRejectedValue(refused('EPERM'))
    await writePdfAtomically(target, new TextEncoder().encode('new'))
    // the old, longer content is cut to the new length
    expect(readFileSync(target, 'utf8')).toBe('new')
    expect(readdirSync(dir!)).toEqual(['doc.pdf'])
  })

  it.skipIf(process.platform !== 'win32' && process.getuid?.() === 0)(
    'leaves a read-only file untouched and reports it as locked',
    async () => {
      const target = fixture()
      chmodSync(target, 0o444)
      rename.mockRejectedValue(refused('EPERM'))
      const error = await writePdfAtomically(target, new TextEncoder().encode('new')).catch(
        (e: unknown) => e as Error,
      )
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toMatch(new RegExp(`^${SAVE_TARGET_LOCKED} code=EPERM: `))
      expect(readFileSync(target, 'utf8')).toBe('old content that is longer')
      expect(readdirSync(dir!)).toEqual(['doc.pdf'])
    },
  )

  it('does not retry or fall back on other rename failures', async () => {
    const target = fixture()
    rename.mockRejectedValue(Object.assign(new Error('EXDEV'), { code: 'EXDEV' }))
    await expect(writePdfAtomically(target, new TextEncoder().encode('new'))).rejects.toThrow(
      'EXDEV',
    )
    expect(rename).toHaveBeenCalledTimes(1)
    expect(readFileSync(target, 'utf8')).toBe('old content that is longer')
    expect(readdirSync(dir!)).toEqual(['doc.pdf'])
  })
})
