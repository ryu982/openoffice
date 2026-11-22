/**
 * The PC's fonts in the Hangul editor's font lists from the start (studio-plugin/pc-fonts.mjs):
 * the editor looks at the PC when it starts and detects anew only when the list changed.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  LINUX_FONT_FILE_READS,
  fontFilesToRead,
  isHeadlessStudio,
  linuxFontFileReads,
  noteFontsApplying,
  readHostFontNames,
  refreshPcFonts,
  sameFaces,
} from '../studio-plugin/pc-fonts.mjs'

type Face = { family: string; fullName: string; postscriptName: string }
type Kept = Face & { aliases?: string[]; detectionSource?: string }

const malgun: Face = {
  family: 'Malgun Gothic',
  fullName: 'Malgun Gothic',
  postscriptName: 'MalgunGothicRegular',
}
const nanum: Face = {
  family: 'NanumGothic',
  fullName: 'NanumGothic',
  postscriptName: 'NanumGothic',
}

/** A record as the studio keeps it: the names it read from the file merged in. */
const kept = (face: Face, extra: Partial<Kept> = {}): Kept => ({
  ...face,
  aliases: [face.family, face.fullName, face.postscriptName, '맑은 고딕'],
  detectionSource: 'local-font-access',
  ...extra,
})

function studio(listed: Face[], records: Kept[], over: Record<string, unknown> = {}) {
  let current = records
  const calls: string[] = []
  const deps = {
    queryLocalFonts: vi.fn(async () => {
      calls.push('query')
      return listed
    }),
    loadStored: vi.fn(async () => {
      calls.push('stored')
    }),
    records: () => current,
    detect: vi.fn(async () => {
      calls.push('detect')
      current = listed.map((face) => kept(face))
    }),
    changed: vi.fn(() => calls.push('changed')),
    ...over,
  }
  return { deps, calls }
}

describe('sameFaces', () => {
  it('holds when every listed face is kept, under any of the names a record carries', () => {
    const record = kept(malgun, { postscriptName: 'malgungothicregular' })
    expect(sameFaces([malgun], [record])).toBe(true)
    // the enumeration gave a name the record keeps among its aliases only
    expect(sameFaces([{ ...malgun, postscriptName: '맑은 고딕' }], [kept(malgun)])).toBe(true)
  })

  it('fails for a font installed or removed since, even when the count stays', () => {
    expect(sameFaces([malgun, nanum], [kept(malgun)])).toBe(false)
    expect(sameFaces([malgun], [kept(malgun), kept(nanum)])).toBe(false)
    const gulim = { family: 'Gulim', fullName: 'Gulim', postscriptName: 'Gulim' }
    expect(sameFaces([malgun, gulim], [kept(malgun), kept(nanum)])).toBe(false)
  })

  it('leaves out the names the studio found by trying them, which the list never has', () => {
    const probed = kept(nanum, { detectionSource: 'font-presence-probe' })
    expect(sameFaces([malgun], [kept(malgun), probed])).toBe(true)
  })

  it('compares names as the studio does: case, spacing and Unicode form aside', () => {
    expect(
      sameFaces([{ ...malgun, postscriptName: ' MALGUNGOTHICREGULAR ' }], [kept(malgun)]),
    ).toBe(true)
    const spaced = { ...malgun, fullName: 'Malgun   Gothic', postscriptName: '' }
    expect(sameFaces([spaced], [kept(malgun)])).toBe(true)
    // a face without a PostScript name goes by its full name
    expect(
      sameFaces([{ ...nanum, postscriptName: '' }], [kept({ ...nanum, postscriptName: '' })]),
    ).toBe(true)
  })
})

describe('refreshPcFonts', () => {
  it('detects and tells the font lists on a first run, when nothing was kept', async () => {
    const { deps, calls } = studio([malgun, nanum], [])
    expect(await refreshPcFonts(deps)).toBe(true)
    expect(calls).toEqual(['stored', 'query', 'detect', 'changed'])
  })

  it('keeps the stored list, without reading the font files again, when the PC has the same fonts', async () => {
    const { deps, calls } = studio([malgun, nanum], [kept(malgun), kept(nanum)])
    expect(await refreshPcFonts(deps)).toBe(false)
    expect(calls).toEqual(['stored', 'query'])
  })

  it('detects anew when a font was installed since', async () => {
    const { deps } = studio([malgun, nanum], [kept(malgun)])
    expect(await refreshPcFonts(deps)).toBe(true)
    expect(deps.detect).toHaveBeenCalledTimes(1)
    expect(deps.changed).toHaveBeenCalledTimes(1)
  })

  it('leaves the kept list when the PC refuses or the runtime cannot list fonts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const refused = studio([], [kept(malgun)], {
      queryLocalFonts: vi.fn(async () => {
        throw new DOMException('Permission denied', 'NotAllowedError')
      }),
    })
    expect(await refreshPcFonts(refused.deps)).toBe(false)
    expect(refused.deps.detect).not.toHaveBeenCalled()
    expect(refused.deps.changed).not.toHaveBeenCalled()

    const empty = studio([], [kept(malgun)])
    expect(await refreshPcFonts(empty.deps)).toBe(false)
    expect(empty.deps.detect).not.toHaveBeenCalled()

    const none = studio([malgun], [], { queryLocalFonts: undefined })
    expect(await refreshPcFonts(none.deps)).toBe(false)
    expect(none.calls).toEqual([])
    warn.mockRestore()
  })

  it("is over only once the studio's work on the document's fonts the change set off is", async () => {
    let finish!: () => void
    const work = new Promise<void>((resolve) => {
      finish = resolve
    })
    const { deps } = studio([malgun], [], {
      changed: vi.fn(() => {
        noteFontsApplying(work)
      }),
    })
    let over = false
    const done = refreshPcFonts(deps).then((value) => {
      over = true
      return value
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(over).toBe(false)
    finish()
    expect(await done).toBe(true)

    // a failed one ends the look too, and work set off outside a look is not waited for
    noteFontsApplying(new Promise(() => {}))
    const failing = studio([malgun], [], {
      changed: vi.fn(() => {
        noteFontsApplying(Promise.reject(new Error('no')))
      }),
    })
    expect(await refreshPcFonts(failing.deps)).toBe(true)
    const quiet = studio([malgun], [])
    expect(await refreshPcFonts(quiet.deps)).toBe(true)
  })

  it('waits until a tab opened behind another is shown', async () => {
    let state = 'hidden'
    const listeners = new Set<() => void>()
    const document = {
      get visibilityState() {
        return state
      },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }
    const { deps, calls } = studio([malgun], [], { document })
    const done = refreshPcFonts(deps)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toEqual([])
    state = 'visible'
    for (const listener of [...listeners]) listener()
    expect(await done).toBe(true)
    expect(listeners.size).toBe(0)
  })

  it('loads stored fonts only and skips queryLocalFonts/detect in headless export mode', async () => {
    const { deps, calls } = studio([malgun], [], { headless: true })
    expect(await refreshPcFonts(deps)).toBe(false)
    expect(calls).toEqual(['stored'])
    expect(deps.queryLocalFonts).not.toHaveBeenCalled()
    expect(deps.detect).not.toHaveBeenCalled()
  })
})

describe('headless flag and host SFNT metadata lookup', () => {
  it('reads the headless flag from the studio query string', () => {
    expect(isHeadlessStudio('?chrome=embed&lang=ko&headless=1')).toBe(true)
    expect(isHeadlessStudio('?chrome=embed&lang=ko')).toBe(false)
    expect(isHeadlessStudio('?headless=0')).toBe(false)
  })

  it('returns null when no host reader is present so standalone browsers fall back', async () => {
    expect(await readHostFontNames([malgun], null)).toBeNull()
  })

  it('passes only plain face identifier fields to the host reader and preserves slot alignment', async () => {
    const reader = vi.fn(async (faces: ReadonlyArray<Record<string, string>>) => {
      expect(faces).toEqual([
        {
          family: 'Malgun Gothic',
          fullName: 'Malgun Gothic',
          postscriptName: 'MalgunGothicRegular',
          style: '',
        },
        {
          family: 'NanumGothic',
          fullName: 'NanumGothic',
          postscriptName: 'NanumGothic',
          style: '',
        },
      ])
      return [
        {
          families: ['맑은 고딕', 'Malgun Gothic'],
          fullNames: ['맑은 고딕'],
          postscriptNames: ['MalgunGothicRegular'],
          styles: ['Regular'],
          weightClass: 400,
          italic: false,
        },
      ]
    })
    const result = await readHostFontNames([malgun, nanum], reader)
    expect(result).toHaveLength(2)
    expect(result?.[0]).toMatchObject({ families: ['맑은 고딕', 'Malgun Gothic'] })
    expect(result?.[1]).toBeNull()
  })

  it('returns empty slots instead of falling back to renderer blobs when the host lookup fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failing = vi.fn(async () => {
      throw new Error('ipc failed')
    })
    const result = await readHostFontNames([malgun, nanum], failing)
    expect(result).toEqual([null, null])
    warn.mockRestore()
  })
})

describe('the font files a detection reads', () => {
  const latin = (index: number): Face => ({
    family: `Latin ${index}`,
    fullName: `Latin ${index} Regular`,
    postscriptName: `Latin${index}-Regular`,
  })
  const korean: Face = { family: '나눔고딕', fullName: '나눔고딕', postscriptName: 'NanumGothic' }
  const many = (count: number) => Array.from({ length: count }, (_, index) => latin(index))
  const readCount = (listed: Face[], platform: string) => {
    const reads = fontFilesToRead(listed, platform)
    return listed.filter((_, index) => reads(index)).length
  }

  it('reads every file where a read file does not stay open', () => {
    const listed = many(LINUX_FONT_FILE_READS * 4)
    expect(readCount(listed, 'Win32')).toBe(listed.length)
    expect(readCount(listed, 'MacIntel')).toBe(listed.length)
  })

  it('reads every file on Linux too while the PC has few enough fonts', () => {
    const listed = many(LINUX_FONT_FILE_READS)
    expect(readCount(listed, 'Linux x86_64')).toBe(listed.length)
  })

  it('stays under the open-file limit of a Linux desktop session on a PC with thousands', () => {
    const listed = many(LINUX_FONT_FILE_READS * 4)
    expect(readCount(listed, 'Linux x86_64')).toBe(LINUX_FONT_FILE_READS)
    // the limit is 1024, and the page has other files open
    expect(LINUX_FONT_FILE_READS).toBeLessThanOrEqual(512)
    // the same fonts each time, so a detection run again reads no other files
    const reads = fontFilesToRead(listed, 'Linux x86_64')
    expect(reads(0)).toBe(true)
    expect(reads(LINUX_FONT_FILE_READS - 1)).toBe(true)
    expect(reads(LINUX_FONT_FILE_READS)).toBe(false)
  })

  it("reads the fonts the list names in the PC's language first", () => {
    const listed = [...many(LINUX_FONT_FILE_READS * 2), korean]
    const reads = fontFilesToRead(listed, 'Linux x86_64')
    expect(reads(listed.length - 1)).toBe(true)
    expect(reads(LINUX_FONT_FILE_READS - 2)).toBe(true)
    expect(reads(LINUX_FONT_FILE_READS - 1)).toBe(false)
    expect(readCount(listed, 'Linux x86_64')).toBe(LINUX_FONT_FILE_READS)
  })

  it("reads as many as the app's share of the editor's own open-file limit", () => {
    const listed = [...many(3000), korean]
    // a launcher raised the limit (deb, rpm): every file is read
    const all = fontFilesToRead(listed, 'Linux x86_64', 262144)
    expect(listed.every((_, index) => all(index))).toBe(true)
    // a smaller limit: fewer, the Korean one still first
    const few = fontFilesToRead(listed, 'Linux x86_64', 100)
    expect(listed.filter((_, index) => few(index))).toHaveLength(100)
    expect(few(listed.length - 1)).toBe(true)
  })

  it("takes the share from the editor's address, and the common one without it", () => {
    expect(linuxFontFileReads('?chrome=embed&lang=ko&fontReads=262144')).toBe(262144)
    expect(linuxFontFileReads('?chrome=embed&lang=ko')).toBe(LINUX_FONT_FILE_READS)
    for (const bad of ['0', '-3', '1.5', 'x', '1e400']) {
      expect(linuxFontFileReads(`?fontReads=${bad}`)).toBe(LINUX_FONT_FILE_READS)
    }
  })
})
