/**
 * The print pages in the fonts the screen shows (studio-plugin/print-fonts.mjs): the
 * engine's font lists become the ones the studio's canvas resolves, the fonts the studio
 * loaded from the PC are named to the print document, and a glyph is not stretched to the
 * slot the engine measured for another font.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPatch, STUDIO_PATCHES } from '../scripts/rhwp-patches.mjs'
import { isEquationSvgFamily } from '../studio-plugin/equation-fonts.mjs'

type PrintFonts = typeof import('../studio-plugin/print-fonts.mjs')
type PcFonts = typeof import('../studio-plugin/pc-fonts.mjs')

let print: PrintFonts
let pc: PcFonts
beforeEach(async () => {
  vi.resetModules()
  pc = await import('../studio-plugin/pc-fonts.mjs')
  print = await import('../studio-plugin/print-fonts.mjs')
})

/** The engine's list for a font, as it writes it into a print page. */
const ENGINE = '&apos;궁서&apos;,&apos;Haansoft Batang&apos;,&apos;Batang&apos;,serif'

/** One character of a print page, with the slot the engine fits a letter to. */
const glyph = (char: string, slot?: number, more = '') =>
  `<text x="10" y="20" font-family="${ENGINE}" font-size="14.667"${more} fill="#000000"` +
  (slot === undefined ? '' : ` textLength="${slot.toFixed(4)}" lengthAdjust="spacingAndGlyphs"`) +
  `>${char}</text>`

const page = (...texts: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">\n${texts.join('\n')}\n</svg>`

/** A screen that resolves every list to Gungsuh then Batang, each character 7 px wide. */
function screen(widths: Record<string, number> = {}, faces: unknown[] = []) {
  const asked: string[] = []
  return {
    asked,
    font(descriptor: string) {
      asked.push(descriptor)
      return {
        families: ['Gungsuh', 'Haansoft Batang', 'Batang', 'serif'],
        measure: (text: string) => widths[text] ?? 7,
      }
    },
    faces: (names: string[]) =>
      faces.filter((face) => names.includes((face as { family: string }).family)),
  }
}

describe('font-family lists', () => {
  it('are read without their quotes and written back quoted', () => {
    const names = print.parseFamilies(`'KoPub바탕체 Medium', "It's", Batang , serif`)
    expect(names).toEqual(['KoPub바탕체 Medium', "It's", 'Batang', 'serif'])
    expect(print.formatFamilies(names)).toBe(`'KoPub바탕체 Medium','It\\'s','Batang',serif`)
  })

  it('keep a comma inside a quoted name', () => {
    expect(print.parseFamilies(`"A, B", C`)).toEqual(['A, B', 'C'])
  })
})

describe('a print page for this PC', () => {
  it('takes the font list the screen resolves, asked the way a paint asks', () => {
    const fonts = screen()
    const out = print.printSvgForThisPc(page(glyph('가')), fonts)
    expect(fonts.asked).toEqual(["14.667px '궁서','Haansoft Batang','Batang',serif"])
    expect(out).toContain(`font-family="'Gungsuh','Haansoft Batang','Batang',serif"`)
    expect(out).not.toContain('궁서')
    expect(out).toContain('>가</text>')
  })

  it('asks with the weight and the slant of the text', () => {
    const fonts = screen()
    print.printSvgForThisPc(
      page(glyph('가', undefined, ' font-weight="bold" font-style="italic"')),
      fonts,
    )
    expect(fonts.asked[0]).toMatch(/^italic bold 14\.667px /)
  })

  it('no longer stretches a glyph to a slot wider than it', () => {
    // the engine measured 11.9 px for another 궁서; this PC's glyph is 7 px
    const out = print.printSvgForThisPc(page(glyph('M', 11.8933)), screen())
    expect(out).not.toContain('textLength')
    expect(out).not.toContain('lengthAdjust')
    expect(out).toContain(' fill="#000000">M</text>')
  })

  it('keeps a glyph wider than its slot squeezed, so it does not run into the next', () => {
    const out = print.printSvgForThisPc(page(glyph('W', 7.36)), screen({ W: 13.2 }))
    expect(out).toContain('textLength="7.3600" lengthAdjust="spacingAndGlyphs"')
  })

  it('draws a glyph as it is when it fits its slot but for a rounding', () => {
    const out = print.printSvgForThisPc(page(glyph('2', 8.0533)), screen({ 2: 8.06 }))
    expect(out).not.toContain('textLength')
  })

  it('measures the character, not its XML spelling', () => {
    const measured: string[] = []
    const fonts = {
      font: () => ({
        families: ['Batang'],
        measure: (text: string) => (measured.push(text), 5),
      }),
      faces: () => [],
    }
    print.printSvgForThisPc(page(glyph('&amp;', 9), glyph('&#x41;', 9)), fonts)
    expect(measured).toEqual(['&', 'A'])
  })

  it('leaves an equation’s text to the equation rules', () => {
    const equation = `<text x="1" y="2" font-family="HYhwpEQ" font-size="12"></text>`
    const fonts = screen()
    const out = print.printSvgForThisPc(page(equation, glyph('가')), fonts, isEquationSvgFamily)
    expect(out).toContain(equation)
    expect(fonts.asked).toHaveLength(1)
  })

  it('leaves text the screen cannot answer for as the engine wrote it', () => {
    const silent = { font: () => null, faces: () => [] }
    const source = page(glyph('M', 11.8933))
    expect(print.printSvgForThisPc(source, silent)).toBe(source)
    expect(print.printSvgForThisPc(source, null)).toBe(source)
  })

  it('names the fonts the studio loaded from the PC, once, at the top of the page', () => {
    const faces = [
      { family: 'Gungsuh', local: ['Gungsuh'], unicodeRange: 'U+0-10FFFF' },
      {
        family: 'Haansoft Batang',
        local: ['HaansoftBatang', '한컴바탕'],
        unicodeRange: 'U+0-20A8, U+20AA-10FFFF',
      },
      { family: 'Not Used', local: ['NotUsed'] },
    ]
    const out = print.printSvgForThisPc(page(glyph('가'), glyph('나')), screen({}, faces))
    const style = /<svg[^>]*><style>([^<]*)<\/style>/.exec(out)?.[1]
    expect(style).toBe(
      '@font-face{font-family:&quot;Gungsuh&quot;;src:local(&quot;Gungsuh&quot;);}' +
        '@font-face{font-family:&quot;Haansoft Batang&quot;;' +
        'src:local(&quot;HaansoftBatang&quot;),local(&quot;한컴바탕&quot;);' +
        'unicode-range:U+0-20A8,U+20AA-10FFFF;}',
    )
    expect(out.split('<style>')).toHaveLength(2)
  })

  it('writes no rule for a name or a range CSS cannot carry safely', () => {
    expect(
      print.fontFaceCss([
        { family: 'A\nB', local: ['Fine'] },
        { family: 'Fine', local: ['x\u0000y'] },
        { family: 'Quoted "name"', local: ['back\\slash'], unicodeRange: 'U+0-7F;}body{}' },
      ]),
    ).toBe('@font-face{font-family:"Quoted \\"name\\"";src:local("back\\\\slash");}')
  })
})

describe('what the screen answers', () => {
  /** A document whose canvas resolves a font as the studio's substitution would. */
  function editor(
    resolved: string,
    loaded: { family: string; status: string; unicodeRange: string }[],
  ) {
    const fonts: string[] = []
    return {
      fonts: loaded,
      set: fonts,
      createElement: () => ({
        getContext: () => {
          let font = ''
          return {
            get font() {
              return font
            },
            set font(value: string) {
              fonts.push(value)
              font = value.startsWith('10px') ? value : resolved
            },
            measureText: (text: string) => ({ width: text.length * 6 }),
          }
        },
      }),
    }
  }

  it('is the canvas font after the studio’s substitution, without an alias nothing stands behind', () => {
    const doc = editor(
      'bold 14.667px "__rhwp_ttf__KoPub바탕체 Medium", KoPubBatang, "Haansoft Batang", serif',
      [],
    )
    const fonts = print.screenFonts(doc as never, () => true)!
    const font = fonts.font("bold 14.667px 'KoPub바탕체 Medium',serif")!
    // no record of the font's file on this PC: the alias is dropped
    expect(font.families).toEqual(['KoPubBatang', 'Haansoft Batang', 'serif'])
    expect(font.measure('ab')).toBe(12)
    // one canvas per font, asked once
    fonts.font("bold 14.667px 'KoPub바탕체 Medium',serif")
    expect(doc.set.filter((value) => !value.startsWith('10px'))).toHaveLength(1)
  })

  it('turns the alias the screen draws through into the document’s font, named to its file', () => {
    // the studio found the font's file on this PC; in Electron the print window does not
    // find the font by its family name KoPubBatang, the next name of the screen's list
    pc.installFontPresence({
      resolveLocalFont: (name: string) =>
        name === 'KoPub바탕체 Medium'
          ? {
              family: 'KoPubBatang',
              fullName: 'KoPubBatang Medium',
              postscriptName: 'KoPubBatangMedium',
              detectionSource: 'local-font-access',
            }
          : null,
      records: () => [],
      detected: () => new Set<string>(),
      state: () => ({ source: 'local-font-access', count: 1, detectedAt: 1 }),
    } as never)
    const doc = editor(
      '14.667px "__rhwp_ttf__KoPub바탕체 Medium", KoPubBatang, "Haansoft Batang", serif',
      [],
    )
    const fonts = print.screenFonts(doc as never)!
    const font = fonts.font("14.667px 'KoPub바탕체 Medium',serif")!
    expect(font.families).toEqual(['KoPub바탕체 Medium', 'KoPubBatang', 'Haansoft Batang', 'serif'])
    // the studio holds that font as the alias's file, not as a FontFace of its own name
    expect(fonts.faces(font.families)).toEqual([
      {
        family: 'KoPub바탕체 Medium',
        local: ['KoPubBatangMedium', 'KoPubBatang Medium'],
        unicodeRange: undefined,
      },
    ])
    const page = print.printSvgForThisPc(
      '<svg xmlns="http://www.w3.org/2000/svg"><text x="1" y="2" font-family="\'KoPub바탕체 Medium\',serif" font-size="14.667">가</text></svg>',
      fonts,
    )
    expect(page).toContain(
      "font-family=\"'KoPub바탕체 Medium','KoPubBatang','Haansoft Batang',serif\"",
    )
    expect(page).toContain(
      'src:local(&quot;KoPubBatangMedium&quot;),local(&quot;KoPubBatang Medium&quot;)',
    )
  })

  it('has no answer for a font the canvas refuses', () => {
    const doc = editor('10px sans-serif', [])
    expect(print.screenFonts(doc as never, () => true)!.font('not a font')).toBeNull()
    expect(print.screenFonts(undefined as never, () => true)).toBeNull()
  })

  it('names a loaded font by the installed face the studio draws it with', () => {
    pc.installFontPresence({
      resolveLocalFont: (name: string) =>
        name === 'KoPub바탕체 Medium'
          ? {
              family: 'KoPubBatang',
              fullName: 'KoPubBatang Medium',
              postscriptName: 'KoPubBatangMedium',
              detectionSource: 'local-font-access',
            }
          : name === 'Probed'
            ? {
                family: 'Probed',
                fullName: 'Probed',
                postscriptName: '',
                detectionSource: 'font-presence-probe',
              }
            : null,
      records: () => [],
      detected: () => new Set<string>(),
      state: () => ({ source: 'local-font-access', count: 1, detectedAt: 1 }),
    } as never)
    const doc = editor('14px serif', [
      { family: '"KoPub바탕체 Medium"', status: 'loaded', unicodeRange: 'U+0-10FFFF' },
      { family: 'Probed', status: 'loaded', unicodeRange: 'U+0-10FFFF' },
      { family: 'Loading', status: 'loading', unicodeRange: 'U+0-10FFFF' },
    ])
    const faces = print
      .screenFonts(doc as never)!
      .faces(['KoPub바탕체 Medium', 'Probed', 'Loading', 'Batang'])
    expect(faces).toEqual([
      {
        family: 'KoPub바탕체 Medium',
        local: ['KoPubBatangMedium', 'KoPubBatang Medium'],
        unicodeRange: 'U+0-10FFFF',
      },
    ])
  })

  it('has no answer at all while the PC’s own font list is not known', () => {
    const doc = editor('14px Batang', [])
    // nothing handed over yet
    expect(pc.pcFontsKnown()).toBe(false)
    expect(print.screenFonts(doc as never)).toBeNull()
    expect(pc.localFontFace('맑은 고딕')).toBeNull()
    pc.installFontPresence({
      resolveLocalFont: () => ({ family: 'x', fullName: 'x', postscriptName: 'x' }),
      records: () => [],
      detected: () => new Set<string>(),
      state: () => ({ source: 'font-presence-probe', count: 1, detectedAt: 1 }),
    } as never)
    // the studio's name probe alone is not the PC's list
    expect(pc.pcFontsKnown()).toBe(false)
    expect(print.screenFonts(doc as never)).toBeNull()
    expect(pc.localFontFace('맑은 고딕')).toBeNull()
  })
})

describe('the engine’s alias for a document’s font program', () => {
  it('is told from a font name', () => {
    expect(pc.isEngineFontAlias('__rhwp_ttf__함초롬바탕')).toBe(true)
    expect(pc.isEngineFontAlias('__rhwp_intrinsic__HY견고딕')).toBe(true)
    expect(pc.isEngineFontAlias('함초롬바탕')).toBe(false)
    expect(pc.isEngineFontAlias(undefined as never)).toBe(false)
  })

  // the studio's text around the patch, as the pinned release has it
  const bridge = [
    "import { rememberRawCanvasFontDescriptor } from './canvas-font-raw';",
    "import type { FileSystemFileHandleLike } from '@/command/file-system-access';",
    '',
    'function substituteCssFontFamily(cssFont: string): string {',
    '  const incoming = parseCssFontFamilyList(familyPart);',
    '  const primary = incoming[0];',
    '  if (!primary) return cssFont;',
    '  const localFontsEnabled = getLocalFontState().stored;',
    '  return prefix + formatCssFontFamilyList(completeFontFamilyList(merged, studioChain.slice(1)));',
    '}',
    '',
  ].join('\n')

  it('is kept out of the substitution’s choice of the document’s font, and stays first', () => {
    const patched = applyPatch('studio-source-font-alias', bridge)
    expect(patched).toContain("import { isEngineFontAlias } from '@ieum/pc-fonts';")
    expect(patched).toContain('const incoming = listed.filter(name => !isEngineFontAlias(name));')
    expect(patched).toContain(
      'formatCssFontFamilyList([...engineAliases, ...completeFontFamilyList(',
    )
    // the list is still weighed by its first name: now the first real one
    expect(patched).toContain('  const primary = incoming[0];')
    expect(STUDIO_PATCHES).toContain('studio-source-font-alias')
    expect(() => applyPatch('studio-source-font-alias', 'export const x = 1')).toThrow(/rhwp patch/)
  })

  it('goes on the same file as the equation patch, in either order', () => {
    const one = applyPatch('studio-source-font-alias', applyPatch('studio-equation-fonts', bridge))
    const other = applyPatch(
      'studio-equation-fonts',
      applyPatch('studio-source-font-alias', bridge),
    )
    for (const patched of [one, other]) {
      expect(patched).toContain('if (isEquationGlyphFont(primary)) return cssFont;')
      expect(patched).toContain(
        'const engineAliases = listed.filter(name => isEngineFontAlias(name));',
      )
    }
  })
})

describe('waiting for the PC’s fonts before a print', () => {
  const known = (source: string) =>
    ({
      resolveLocalFont: () => null,
      records: () => [],
      detected: () => new Set<string>(),
      state: () => ({ source, count: 1, detectedAt: 1 }),
    }) as never

  it('waits for the start-up look, then says whether the screen’s fonts are known', async () => {
    let finish!: () => void
    const listed = new Promise<{ family: string; fullName: string; postscriptName: string }[]>(
      (resolve) => {
        finish = () => {
          pc.installFontPresence(known('local-font-access'))
          resolve([])
        }
      },
    )
    const visible = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
    void pc.refreshPcFonts({
      queryLocalFonts: () => listed,
      loadStored: async () => {},
      records: () => [],
      detect: async () => {},
      changed: () => {},
      document: visible as never,
    })
    let answer: boolean | undefined
    const ready = pc.printFontsReady({ doc: visible as never }).then((value) => (answer = value))
    await new Promise((resolve) => setTimeout(resolve, 20))
    // still reading the PC's fonts: the print waits
    expect(answer).toBeUndefined()
    finish()
    await ready
    expect(answer).toBe(true)
  })

  it('answers at once for a page that is not shown, which never gets the PC’s list', async () => {
    void pc.refreshPcFonts({
      queryLocalFonts: () => new Promise(() => {}),
      loadStored: async () => {},
      records: () => [],
      detect: async () => {},
      changed: () => {},
    })
    const hidden = { visibilityState: 'hidden' }
    await expect(pc.printFontsReady({ doc: hidden as never })).resolves.toBe(false)
    // hidden BrowserWindow in Electron reports visibilityState === 'visible'; headless skips wait
    const visible = { visibilityState: 'visible' }
    await expect(pc.printFontsReady({ doc: visible as never, headless: true })).resolves.toBe(false)
  })

  it('goes on after the wait when the look takes too long', async () => {
    void pc.refreshPcFonts({
      queryLocalFonts: () => new Promise(() => {}),
      loadStored: async () => {},
      records: () => [],
      detect: async () => {},
      changed: () => {},
    })
    const visible = { visibilityState: 'visible' }
    await expect(pc.printFontsReady({ wait: 10, doc: visible as never })).resolves.toBe(false)
  })
})
