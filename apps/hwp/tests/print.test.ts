/**
 * PDF and print: the plugin draws the pages for print with the real engine, the renderer
 * gathers them a few at a time keeping each picture once, and the main process puts them
 * in one HTML page sized page by page.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { agentPlugin, type AgentPluginHost } from '../studio-plugin/agent-plugin.mjs'
import { installFontPresence } from '../studio-plugin/pc-fonts.mjs'
import { badJob, imageFile, ownIds, printableHtml, sideMm } from '../src/main/print-document'
import {
  createJobCache,
  gatherPageSizes,
  gatherPrintJob,
  sharePictures,
} from '../src/renderer/print-flow'
import type { AgentBridge } from '../src/renderer/ai/agent-bridge'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

/** A blank document of `pages` pages, each starting with its number. */
function open(pages: number) {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  for (let page = 0; page < pages; page++) {
    if (page > 0) doc.insertPageBreak(0, page - 1, doc.getParagraphLength(0, page - 1))
    doc.insertText(0, page, 0, `쪽 ${page + 1}`)
  }
  const host = {
    read: (fn: (d: never) => unknown) => fn(doc as never),
    transaction: () => {
      throw new Error('printing changes nothing')
    },
    events: { on: () => 0 },
    automation: { registerCommand: () => {}, execute: () => null },
  } as unknown as AgentPluginHost
  return { plugin: agentPlugin.activate(host), doc }
}

/**
 * Three sections of one page each, the middle one landscape: the pages are not all the
 * same size, as a report with a wide table in the middle.
 */
function openMixed() {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  for (let para = 0; para < 3; para++) {
    if (para > 0) doc.splitParagraph(0, para - 1, doc.getParagraphLength(0, para - 1))
    doc.insertText(0, para, 0, `쪽 ${para + 1}`)
  }
  doc.splitSection(0, 1, 0)
  doc.splitSection(1, 1, 0)
  const def = JSON.parse(doc.getPageDef(1)) as Record<string, unknown>
  doc.setPageDef(1, JSON.stringify({ ...def, landscape: true }))
  const listeners = new Map<string, ((detail?: unknown) => void)[]>()
  const host = {
    read: (fn: (d: never) => unknown) => fn(doc as never),
    transaction: () => {
      throw new Error('printing changes nothing')
    },
    events: {
      on: (name: string, handler: (detail?: unknown) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), handler])
        return () => {}
      },
    },
    automation: { registerCommand: () => {}, execute: () => null },
  } as unknown as AgentPluginHost
  const emit = (name: string, detail?: unknown) => {
    for (const handler of listeners.get(name) ?? []) handler(detail)
  }
  return { plugin: agentPlugin.activate(host), doc, emit }
}

describe('the page sizes for print', () => {
  it('are every page’s size as the print path lays it out, without drawing', () => {
    const { plugin, doc } = openMixed()
    expect(doc.pageCount()).toBe(3)
    let drawn = 0
    const draw = doc.renderPageSvgWithProfile.bind(doc)
    Object.assign(doc, {
      renderPageSvgWithProfile: (page: number, profile: string) => {
        drawn += 1
        return draw(page, profile)
      },
    })
    const result = plugin.printPageSizes(0)
    expect(drawn).toBe(0)
    expect(result).toMatchObject({ pageCount: 3, from: 0 })
    expect(result.sizes).toHaveLength(3)
    for (let page = 0; page < 3; page++) {
      const preview = plugin.previewPage(page)
      expect(result.sizes[page]).toEqual({ width: preview.width, height: preview.height })
    }
    // portrait, landscape, portrait
    expect(result.sizes[0]!.width).toBeLessThan(result.sizes[0]!.height)
    expect(result.sizes[1]!.width).toBeGreaterThan(result.sizes[1]!.height)
    expect(result.sizes[2]!.width).toBeLessThan(result.sizes[2]!.height)
  })

  it('start at the page asked for', () => {
    const { plugin } = openMixed()
    const rest = plugin.printPageSizes(1)
    expect(rest).toMatchObject({ pageCount: 3, from: 1 })
    expect(rest.sizes).toHaveLength(2)
    expect(plugin.printPageSizes(9).sizes).toHaveLength(0)
  })

  it('lay out with the portable widths and put the screen’s back', () => {
    const { plugin, doc } = open(1)
    const calls: boolean[] = []
    Object.assign(doc, {
      canvasMetricsActive: () => true,
      selectCanvasMetrics: (on: boolean) => {
        calls.push(on)
        return true
      },
    })
    plugin.printPageSizes(0)
    expect(calls).toEqual([false, true])
  })

  it('are gathered call by call until the count, stopping on a count that moved', async () => {
    const { plugin } = openMixed()
    // one page a call
    const bridge: Pick<AgentBridge, 'printPageSizes'> = {
      printPageSizes: async (from) => {
        const batch = plugin.printPageSizes(from)
        return { ...batch, sizes: batch.sizes.slice(0, 1) }
      },
    }
    const sizes = await gatherPageSizes(bridge)
    expect(sizes).toEqual(plugin.printPageSizes(0).sizes)

    let count = 3
    const moving: Pick<AgentBridge, 'printPageSizes'> = {
      printPageSizes: async (from) => {
        const result = { pageCount: count, from, sizes: [{ width: 10, height: 10 }] }
        count = 4
        return result
      },
    }
    await expect(gatherPageSizes(moving)).rejects.toThrow(/changed/)
  })
})

describe('the document revision', () => {
  it('moves with every edit and a document swapped in, not with a layout alone', () => {
    const { plugin, emit } = openMixed()
    const start = plugin.documentRevision()
    emit('document-mutated', 'input-handler-resumable-pagination')
    expect(plugin.documentRevision()).toBe(start)
    emit('document-changed')
    const typed = plugin.documentRevision()
    expect(typed).toBeGreaterThan(start)
    emit('document-swapped')
    expect(plugin.documentRevision()).toBeGreaterThan(typed)
  })
})

describe('the pages for print', () => {
  it('are SVG at the page size, from the page asked for', () => {
    const { plugin, doc } = open(3)
    expect(doc.pageCount()).toBe(3)
    const all = plugin.printPages(0)
    expect(all).toMatchObject({ pageCount: 3, from: 0 })
    expect(all.pages).toHaveLength(3)
    for (const page of all.pages) {
      expect(page.svg.startsWith('<svg')).toBe(true)
      // A4 in CSS pixels
      expect(sideMm(page.width)).toBe(210)
      expect(sideMm(page.height)).toBe(297)
    }
    const rest = plugin.printPages(2)
    expect(rest).toMatchObject({ pageCount: 3, from: 2 })
    expect(rest.pages).toHaveLength(1)
    expect(plugin.printPages(7).pages).toHaveLength(0)
  })

  it('lay out with the portable widths and put the screen’s back', () => {
    const { plugin, doc } = open(1)
    // the screen's widths need a canvas the test does not have: only the calls are recorded
    const calls: boolean[] = []
    Object.assign(doc, {
      canvasMetricsActive: () => true,
      selectCanvasMetrics: (on: boolean) => {
        calls.push(on)
        return true
      },
    })
    plugin.printPages(0)
    expect(calls).toEqual([false, true])
  })

  it('are drawn in the fonts the editor’s canvas resolves, and so is the preview', () => {
    const { plugin } = open(1)
    const plain = plugin.printPages(0).pages[0]!.svg
    // the engine's own font list, and no editor to ask: the page stays as the engine wrote it
    expect(plain).toMatch(/font-family="[^"]*serif"/)
    expect(plain).not.toContain('Screen Font')
    // an editor that holds the PC's font list, whose canvas turns every font list into one font
    installFontPresence({
      resolveLocalFont: () => null,
      records: () => [],
      detected: () => new Set<string>(),
      state: () => ({ source: 'local-font-access', count: 0, detectedAt: 1 }),
    } as never)
    vi.stubGlobal('document', {
      fonts: [],
      createElement: () => ({
        getContext: () => {
          let font = ''
          return {
            get font() {
              return font
            },
            set font(value: string) {
              font = value.startsWith('10px')
                ? value
                : value.replace(/px .*$/, 'px "Screen Font", serif')
            },
            measureText: () => ({ width: 1 }),
          }
        },
      }),
    })
    try {
      for (const svg of [plugin.printPages(0).pages[0]!.svg, plugin.previewPage(0).svg]) {
        const families = [...svg.matchAll(/<text\b[^>]*\sfont-family="([^"]*)"/g)].map((m) => m[1])
        expect(families.length).toBeGreaterThan(0)
        expect(new Set(families)).toEqual(new Set(["'Screen Font',serif"]))
        // a glyph narrower than its slot is drawn as it is
        expect(svg).not.toContain('textLength')
      }
    } finally {
      vi.unstubAllGlobals()
      installFontPresence(null as never)
    }
  })

  it('keep the screen’s layout where the editor can answer for its fonts', () => {
    const { plugin, doc } = open(1)
    // the screen's measured widths are on, and the engine lets an export keep them
    const calls: string[] = []
    Object.assign(doc, {
      canvasMetricsActive: () => true,
      selectCanvasMetrics: (on: boolean) => {
        calls.push(`portable ${!on}`)
        return true
      },
      setExportKeepsCanvasMetrics: (on: boolean) => {
        calls.push(`keep ${on}`)
      },
    })
    // no editor to ask about fonts: the widths every PC lays out the same, as before
    plugin.printPages(0)
    expect(calls).toEqual(['portable true', 'portable false'])

    calls.length = 0
    installFontPresence({
      resolveLocalFont: () => null,
      records: () => [],
      detected: () => new Set<string>(),
      state: () => ({ source: 'local-font-access', count: 0, detectedAt: 1 }),
    } as never)
    vi.stubGlobal('document', {
      fonts: [],
      createElement: () => ({
        getContext: () => {
          let font = ''
          return {
            get font() {
              return font
            },
            set font(value: string) {
              font = value
            },
            measureText: () => ({ width: 1 }),
          }
        },
      }),
    })
    try {
      // the pages, their sizes and the preview page are all laid out the same way
      plugin.printPages(0)
      plugin.printPageSizes(0)
      plugin.previewPage(0)
      expect(calls).toEqual([
        'keep true',
        'keep false',
        'keep true',
        'keep false',
        'keep true',
        'keep false',
      ])
      // an engine without the opt-in: the portable widths, as before
      calls.length = 0
      Object.assign(doc, { setExportKeepsCanvasMetrics: undefined })
      plugin.printPages(0)
      expect(calls).toEqual(['portable true', 'portable false'])
    } finally {
      vi.unstubAllGlobals()
      installFontPresence(null as never)
    }
  })

  it('are gathered only after the plugin can draw them in the screen’s fonts', async () => {
    const { plugin } = open(2)
    const calls: string[] = []
    let ready!: () => void
    const bridge: Pick<AgentBridge, 'printPages' | 'printPageSizes' | 'printFontsReady'> = {
      printFontsReady: () =>
        new Promise<boolean>((resolve) => {
          calls.push('fonts?')
          ready = () => {
            calls.push('fonts ready')
            resolve(true)
          }
        }),
      printPages: async (from) => (calls.push(`pages ${from}`), plugin.printPages(from)),
      printPageSizes: async (from) => (calls.push(`sizes ${from}`), plugin.printPageSizes(from)),
    }
    const job = gatherPrintJob(bridge, 'pdf', () => {})
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls).toEqual(['fonts?'])
    ready()
    expect((await job).pages).toHaveLength(2)
    expect(calls.slice(0, 3)).toEqual(['fonts?', 'fonts ready', 'pages 0'])

    calls.length = 0
    const sizes = gatherPageSizes(bridge)
    await new Promise((resolve) => setTimeout(resolve, 10))
    ready()
    expect(await sizes).toHaveLength(2)
    expect(calls[0]).toBe('fonts?')
    expect(calls.indexOf('fonts ready')).toBeLessThan(calls.indexOf('sizes 0'))

    // a plugin without the call, or one that fails it, is printed from as before
    const failing = { ...bridge, printFontsReady: () => Promise.reject(new Error('no')) }
    expect((await gatherPrintJob(failing, 'pdf', () => {})).pages).toHaveLength(2)
  })

  it('are gathered call by call, and the job keeps each picture once', async () => {
    const { plugin } = open(5)
    const logo = 'data:image/png;base64,iVBORw0KGgo='
    // two pages a call, every page carrying the same picture
    const bridge: Pick<AgentBridge, 'printPages'> = {
      printPages: async (from) => {
        const batch = plugin.printPages(from)
        const pages = batch.pages.slice(0, 2).map((page) => ({
          ...page,
          svg: page.svg.replace('</svg>', `<image href="${logo}"/></svg>`),
        }))
        return { ...batch, pages }
      },
    }
    const progress: number[] = []
    const job = await gatherPrintJob(bridge, 'pdf', (done) => progress.push(done))
    expect(progress).toEqual([2, 4, 5])
    expect(job.pages).toHaveLength(5)
    expect(job.images).toEqual([logo])
    for (const page of job.pages) expect(page.svg).toContain('href="ieum-image:0"')
  })

  it('stop when the document changes under them', async () => {
    let count = 4
    const bridge: Pick<AgentBridge, 'printPages'> = {
      printPages: async (from) => {
        const result = {
          pageCount: count,
          from,
          pages: [{ svg: '<svg/>', width: 10, height: 10 }],
        }
        count = 6
        return result
      },
    }
    await expect(gatherPrintJob(bridge, 'print', () => {})).rejects.toThrow(/changed/)
  })
})

describe('the preview page', () => {
  it('draws one page as print, with the count it belongs to', () => {
    const { plugin } = open(3)
    const page = plugin.previewPage(1)
    expect(page).toMatchObject({ pageCount: 3, page: 1 })
    expect(page.svg.startsWith('<svg')).toBe(true)
    expect(sideMm(page.width)).toBe(210)
    expect(sideMm(page.height)).toBe(297)
  })

  it('refuses a page outside the document', () => {
    const { plugin } = open(2)
    expect(() => plugin.previewPage(-1)).toThrow()
    expect(() => plugin.previewPage(2)).toThrow()
  })

  it('lays the page out with the portable widths, then puts the screen’s back', () => {
    const { plugin, doc } = open(1)
    const calls: boolean[] = []
    Object.assign(doc, {
      canvasMetricsActive: () => true,
      selectCanvasMetrics: (on: boolean) => {
        calls.push(on)
        return true
      },
    })
    plugin.previewPage(0)
    expect(calls).toEqual([false, true])
  })
})

describe('the preview page target', () => {
  it('finds the first paragraph that starts on the page', () => {
    const { plugin } = open(3)
    const target = plugin.pageTarget(1)
    expect(target.ok).toBe(true)
    if (!target.ok) return
    expect(target.page).toBe(1)
    expect(target.target).toMatchObject({
      kind: 'body_paragraph',
      section: 0,
      paragraph: 1,
      charOffset: 0,
    })
    expect(target.target.length).toBeGreaterThan(0)
  })

  it('refuses a page outside the document', () => {
    const { plugin } = open(2)
    expect(() => plugin.pageTarget(2)).toThrow()
    expect(() => plugin.pageTarget(-1)).toThrow()
  })
})

describe('sharing pictures', () => {
  it('replaces each picture by its place in the job, the same picture by the same place', () => {
    const images: string[] = []
    const known = new Map<string, number>()
    const a = 'data:image/png;base64,AAAA'
    const b = 'data:image/jpeg;base64,BBBB'
    expect(sharePictures(`<image href="${a}"/><image href="${b}"/>`, images, known)).toBe(
      '<image href="ieum-image:0"/><image href="ieum-image:1"/>',
    )
    expect(sharePictures(`<image href="${b}"/>`, images, known)).toBe(
      '<image href="ieum-image:1"/>',
    )
    expect(images).toEqual([a, b])
    // links are not pictures
    expect(sharePictures('<a href="https://example.com/">x</a>', images, known)).toContain(
      'https://example.com/',
    )
  })
})

describe('the printable HTML', () => {
  it('puts the paper sizes on the standard sizes they are meant to be', () => {
    // 59528 × 84186 HWPUNIT as the editor reports them
    expect(sideMm(793.7)).toBe(210)
    expect(sideMm(1122.5)).toBe(297)
    expect(sideMm(1587.4)).toBe(420)
    expect(sideMm(740.8)).toBe(196.003)
  })

  it('gives every page its own ids, with the references that use them', () => {
    const svg =
      '<svg><defs><clipPath id="body-clip-2"><rect/></clipPath></defs>' +
      '<g clip-path="url(#body-clip-2)"><use href="#body-clip-2"/></g></svg>'
    expect(ownIds(svg, 'p3-')).toBe(
      '<svg><defs><clipPath id="p3-body-clip-2"><rect/></clipPath></defs>' +
        '<g clip-path="url(#p3-body-clip-2)"><use href="#p3-body-clip-2"/></g></svg>',
    )
  })

  it('sizes each page on its own and points the pictures at their files', () => {
    const html = printableHtml(
      [
        { svg: '<svg id="a"><image href="ieum-image:0"/></svg>', width: 793.7, height: 1122.5 },
        { svg: '<svg id="a"></svg>', width: 1122.5, height: 793.7 },
      ],
      (index) => `image-${index}.png`,
    )
    expect(html).toContain('@page p0 { size: 210mm 297mm; margin: 0; }')
    expect(html).toContain('@page p1 { size: 297mm 210mm; margin: 0; }')
    expect(html).toContain('<div class="page p0"><svg id="p0-a"><image href="image-0.png"/></svg>')
    expect(html).toContain('<svg id="p1-a">')
    // nothing in it may run or reach out
    expect(html).toContain("default-src 'none'")
    expect(html).not.toContain('<script')
  })

  it('writes the usual picture types out as files and keeps the rest in the page', () => {
    const png = imageFile('data:image/png;base64,iVBORw0KGgo=', 4)
    expect(png?.name).toBe('image-4.png')
    expect([...png!.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(imageFile('data:image/svg+xml;base64,PHN2Zy8+', 0)?.name).toBe('image-0.svg')
    expect(imageFile('data:image/x-wmf;base64,AAAA', 0)).toBeNull()
    expect(imageFile('data:text/html;base64,AAAA', 0)).toBeNull()
  })

  it('refuses jobs that are not pages', () => {
    const page = { svg: '<svg/>', width: 10, height: 10 }
    expect(badJob({ mode: 'pdf', pages: [page], images: [] })).toBeNull()
    expect(badJob({ mode: 'fax', pages: [page], images: [] })).toMatch(/mode/)
    expect(badJob({ mode: 'pdf', pages: [], images: [] })).toMatch(/no pages/)
    expect(badJob({ mode: 'pdf', pages: [{ ...page, svg: '<html>' }], images: [] })).toMatch(/page/)
    expect(badJob({ mode: 'pdf', pages: [{ ...page, width: -1 }], images: [] })).toMatch(/size/)
    expect(badJob({ mode: 'pdf', pages: [page], images: [3] })).toMatch(/pictures/)
    expect(badJob(null)).toMatch(/not a print job/)
  })
})

describe('the gathered job within one preview', () => {
  const JOB = { mode: 'pdf' as const, pages: [], images: [] }

  function setup() {
    let revision = 0
    const gather = vi.fn(async (onProgress: (done: number, total: number) => void) => {
      onProgress(1, 1)
      return { ...JOB }
    })
    const cache = createJobCache(gather, async () => revision)
    return {
      cache,
      gather,
      edit: () => {
        revision += 1
      },
    }
  }

  it('is gathered once for a preview, a print and a save', async () => {
    const { cache, gather } = setup()
    const first = await cache.get(() => {})
    expect(await cache.get(() => {})).toBe(first)
    expect(await cache.get(() => {})).toBe(first)
    expect(gather).toHaveBeenCalledTimes(1)
  })

  it('is gathered again after the document changed', async () => {
    const { cache, gather, edit } = setup()
    const first = await cache.get(() => {})
    edit()
    expect(await cache.get(() => {})).not.toBe(first)
    expect(gather).toHaveBeenCalledTimes(2)
  })

  it('is not kept when the document changed while it was gathered', async () => {
    let revision = 0
    const gather = vi.fn(async () => {
      revision += 1
      return { ...JOB }
    })
    const cache = createJobCache(gather, async () => revision)
    await cache.get(() => {})
    await cache.get(() => {})
    expect(gather).toHaveBeenCalledTimes(2)
  })

  it('is gathered every time when the revision cannot be read', async () => {
    const gather = vi.fn(async () => ({ ...JOB }))
    const cache = createJobCache(gather, async () => {
      throw new Error('no plugin')
    })
    await cache.get(() => {})
    await cache.get(() => {})
    expect(gather).toHaveBeenCalledTimes(2)
  })

  it('shares one gathering between two asks at once, and tells both of progress', async () => {
    const { cache, gather } = setup()
    const one: number[] = []
    const two: number[] = []
    const [a, b] = await Promise.all([
      cache.get((done) => one.push(done)),
      cache.get((done) => two.push(done)),
    ])
    expect(a).toBe(b)
    expect(gather).toHaveBeenCalledTimes(1)
    expect(one).toEqual([1])
    expect(two).toEqual([1])
  })

  it('lets go of the job when cleared, and a new cache gathers again', async () => {
    const { cache, gather } = setup()
    await cache.get(() => {})
    cache.clear()
    await cache.get(() => {})
    expect(gather).toHaveBeenCalledTimes(2)
  })

  it('passes a failed gathering on and keeps nothing', async () => {
    const gather = vi
      .fn<(onProgress: (done: number, total: number) => void) => Promise<typeof JOB>>()
      .mockRejectedValueOnce(new Error('the document changed while printing'))
      .mockResolvedValue({ ...JOB })
    const cache = createJobCache(gather, async () => 0)
    await expect(cache.get(() => {})).rejects.toThrow(/changed/)
    await cache.get(() => {})
    await cache.get(() => {})
    expect(gather).toHaveBeenCalledTimes(2)
  })
})
