/**
 * The editor's font detection reads within the open-file limit of its own renderer
 * (src/main/font-file-reads.ts, studio-plugin/pc-fonts.mjs fontFilesToRead, #488).
 */
import { describe, expect, it } from 'vitest'
import {
  fontFileReadsFor,
  fontFileReadsOfProcess,
  softOpenFileLimit,
} from '../src/main/font-file-reads'

const limits = (soft: string, hard: string) =>
  [
    'Limit                     Soft Limit           Hard Limit           Units     ',
    'Max cpu time              unlimited            unlimited            seconds   ',
    `Max open files            ${soft.padEnd(21)}${hard.padEnd(21)}files     `,
    'Max locked memory         8388608              8388608              bytes     ',
    '',
  ].join('\n')

describe('the open-file limit of a renderer', () => {
  it('reads the soft limit of /proc/<pid>/limits', () => {
    expect(softOpenFileLimit(limits('1024', '524288'))).toBe(1024)
    expect(softOpenFileLimit(limits('524288', '524288'))).toBe(524288)
    expect(softOpenFileLimit(limits('unlimited', 'unlimited'))).toBe(Infinity)
    expect(softOpenFileLimit('Limit Soft Hard\n')).toBeNull()
    expect(softOpenFileLimit(limits('lots', '1'))).toBeNull()
  })

  it('gives the detection half, every file when unlimited, nothing when unknown', () => {
    expect(fontFileReadsFor(1024)).toBe(512)
    expect(fontFileReadsFor(524288)).toBe(262144)
    expect(fontFileReadsFor(Infinity)).toBe(Number.MAX_SAFE_INTEGER)
    expect(fontFileReadsFor(null)).toBeNull()
  })

  it("reads the renderer's own limit on Linux only", async () => {
    const asked: string[] = []
    const read = async (path: string) => {
      asked.push(path)
      return limits('1024', '4096')
    }
    expect(await fontFileReadsOfProcess(4242, 'linux', read)).toBe(512)
    expect(asked).toEqual(['/proc/4242/limits'])
    expect(await fontFileReadsOfProcess(4242, 'win32', read)).toBeNull()
    expect(await fontFileReadsOfProcess(4242, 'darwin', read)).toBeNull()
    expect(await fontFileReadsOfProcess(0, 'linux', read)).toBeNull()
    expect(asked).toHaveLength(1)
  })

  it('leaves the default to the detection when the limit cannot be read', async () => {
    const gone = async () => {
      throw new Error('ENOENT')
    }
    expect(await fontFileReadsOfProcess(4242, 'linux', gone)).toBeNull()
  })
})
