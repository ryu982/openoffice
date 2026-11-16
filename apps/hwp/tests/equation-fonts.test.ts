/**
 * Equations with or without Hancom's equation fonts (studio-plugin/equation-fonts.mjs): a
 * glyph run keeps its font when the PC has it, whatever the studio knows of the PC's fonts
 * yet, and is decoded to the characters it stands for when the PC has not.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  EQUATION_FALLBACK_MARK,
  decodeEquationGlyphs,
  equationCanvasFont,
  equationSvgForThisPc,
  installEquationFonts,
  isEquationGlyphFont,
  setEquationFontProbe,
} from '../studio-plugin/equation-fonts.mjs'
import { STUDIO_PATCHES, applyPatch } from '../scripts/rhwp-patches.mjs'

/** The fonts this PC is said to have, for a test. */
function pcHas(...families: string[]) {
  const known = families.map((family) => family.toLowerCase())
  setEquationFontProbe((family: string) => known.includes(family.toLowerCase()))
}

describe('the glyph codes of an equation', () => {
  it('stand for digits, variables, signs and Greek letters', () => {
    // 1 + 2 = 3, as the engine writes it in HyhwpEQ
    expect(decodeEquationGlyphs('\ue034\ue048\ue035\ue047\ue036')).toEqual({
      text: '1+2=3',
      italic: false,
    })
    expect(decodeEquationGlyphs('\ue03d')?.text).toBe('0')
    expect(decodeEquationGlyphs('\ue03c')?.text).toBe('9')
    // a lower-case variable is a slanted glyph; a capital is slanted by the engine's shear
    expect(decodeEquationGlyphs('\ue0fc')).toEqual({ text: 'x', italic: true })
    expect(decodeEquationGlyphs('\ue0e5')).toEqual({ text: 'a', italic: true })
    expect(decodeEquationGlyphs('\ue0fe')).toEqual({ text: 'z', italic: true })
    expect(decodeEquationGlyphs('\ue000')).toEqual({ text: 'A', italic: false })
    expect(decodeEquationGlyphs('\ue019')).toEqual({ text: 'Z', italic: false })
    expect(decodeEquationGlyphs('\ue046')?.text).toBe('−')
    expect(decodeEquationGlyphs('\ue044\ue045\ue052\ue04f\ue055\ue056\ue042')?.text).toBe('(),:<>%')
    expect(decodeEquationGlyphs('\ue09d')?.text).toBe('α')
    expect(decodeEquationGlyphs('\ue0ac')?.text).toBe('π')
    expect(decodeEquationGlyphs('\ue0b4')?.text).toBe('ω')
    expect(decodeEquationGlyphs('\ue085')?.text).toBe('Α')
    expect(decodeEquationGlyphs('\ue09c')?.text).toBe('Ω')
    // the sum sign is a big operator: it is fitted onto the baseline when drawn
    expect(decodeEquationGlyphs('\ue067')).toEqual({ text: '∑', italic: false, fit: true })
  })

  it('leaves alone what is no glyph code', () => {
    expect(decodeEquationGlyphs('sin')).toBeNull()
    expect(decodeEquationGlyphs('×')).toBeNull()
    expect(decodeEquationGlyphs('한글 abc 123')).toBeNull()
    // a private-use character of another range, or one the table does not hold
    expect(decodeEquationGlyphs('\uf000')).toBeNull()
    expect(decodeEquationGlyphs('\ue0ff')).toBeNull()
    // what is around a code stays as it is
    expect(decodeEquationGlyphs('±\ue034')?.text).toBe('±1')
  })

  it('knows the two fonts written that way, by any spelling', () => {
    for (const family of ['HyhwpEQ', 'HYhwpEQ', '"HyhwpEQ"', " 'HancomEQN' ", 'hancomeqn']) {
      expect(isEquationGlyphFont(family), family).toBe(true)
    }
    for (const family of ['Latin Modern Math', '함초롬바탕', 'HancomEQN2', '', 'serif']) {
      expect(isEquationGlyphFont(family), family).toBe(false)
    }
  })
})

describe('the canvas font of a glyph run', () => {
  it('stays the equation font when the PC has it', () => {
    pcHas('HyhwpEQ', 'HancomEQN')
    expect(equationCanvasFont('16px HyhwpEQ')).toBe('16px HyhwpEQ')
    expect(equationCanvasFont('10.88px HancomEQN')).toBe('10.88px HancomEQN')
    expect(equationCanvasFont('16px HYhwpEQ, Latin Modern Math, STIX Two Math, serif')).toBe(
      '16px HYhwpEQ, Latin Modern Math, STIX Two Math, serif',
    )
  })

  it('becomes the fallback list, with its mark, when the PC lacks the font', () => {
    pcHas()
    const font = equationCanvasFont('16px HyhwpEQ')
    expect(font.startsWith(`16px "${EQUATION_FALLBACK_MARK}", `)).toBe(true)
    expect(font).toContain('"Times New Roman"')
    expect(font.endsWith('serif')).toBe(true)
    // one of the two is enough only for a run that names it
    pcHas('HancomEQN')
    expect(equationCanvasFont('16px HyhwpEQ')).toContain(EQUATION_FALLBACK_MARK)
    expect(equationCanvasFont('16px HancomEQN')).toBe('16px HancomEQN')
  })

  it('stays as asked where the PC cannot be asked', () => {
    setEquationFontProbe(() => null)
    expect(equationCanvasFont('16px HyhwpEQ')).toBe('16px HyhwpEQ')
  })

  it('leaves every other font alone', () => {
    pcHas()
    for (const font of [
      '16px "함초롬바탕", serif',
      'bold 14px "Malgun Gothic", sans-serif',
      // an equation font that is not the run's own font
      '16px "Latin Modern Math", HyhwpEQ, serif',
      '16px sans-serif',
      'HyhwpEQ',
    ]) {
      expect(equationCanvasFont(font), font).toBe(font)
    }
  })
})

describe('under the canvases of a page', () => {
  /** What a canvas was asked to draw: the font it had then, and the text. */
  const drawn: { font: string; text: string }[] = []
  class Context {
    #font = '10px sans-serif'
    get font() {
      return this.#font
    }
    set font(value: string) {
      this.#font = value
    }
    fillText(text: string) {
      drawn.push({ font: this.font, text })
    }
    strokeText(text: string) {
      drawn.push({ font: this.font, text })
    }
  }
  const scope = { CanvasRenderingContext2D: Context } as unknown as typeof globalThis

  beforeAll(() => {
    expect(installEquationFonts(scope)).toBe(true)
    // once: a second call leaves the first in place
    expect(installEquationFonts(scope)).toBe(false)
  })
  beforeEach(() => {
    drawn.length = 0
  })

  it('draws a run in its own font, untouched, when the PC has the font', () => {
    pcHas('HyhwpEQ')
    const context = new Context()
    context.font = '16px HyhwpEQ'
    context.fillText('\ue034')
    expect(drawn).toEqual([{ font: '16px HyhwpEQ', text: '\ue034' }])
  })

  it('draws the characters a run stands for when the PC lacks the font', () => {
    pcHas()
    const context = new Context()
    context.font = '16px HyhwpEQ'
    expect(context.font).toContain(EQUATION_FALLBACK_MARK)
    context.fillText('\ue034')
    context.strokeText('\ue048')
    expect(drawn.map((draw) => draw.text)).toEqual(['1', '+'])
    expect(drawn.every((draw) => draw.font === context.font)).toBe(true)
  })

  it('draws a slanted glyph in the italic face, for that draw only', () => {
    pcHas()
    const context = new Context()
    context.font = '16px HyhwpEQ'
    const upright = context.font
    context.fillText('\ue0fc')
    expect(drawn).toEqual([{ font: `italic ${upright}`, text: 'x' }])
    expect(context.font).toBe(upright)
  })

  it('squeezes a big operator onto the baseline, so that its lower limit stays clear', () => {
    pcHas()
    const moves: string[] = []
    class Measured extends Context {
      measureText() {
        return { actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 }
      }
      save() {
        moves.push('save')
      }
      restore() {
        moves.push('restore')
      }
      translate(x: number, y: number) {
        moves.push(`translate ${x} ${y}`)
      }
      scale(x: number, y: number) {
        moves.push(`scale ${x} ${y}`)
      }
    }
    const context = new Measured()
    context.font = '24px HancomEQN'
    ;(context.fillText as (text: string, x: number, y: number) => void)('\ue067', 100, 50)
    // three quarters of its height, lifted by what would hang below the baseline
    expect(moves).toEqual(['save', 'translate 100 47', 'scale 1 0.75', 'restore'])
    expect(drawn.map((draw) => draw.text)).toEqual(['∑'])
  })

  it('leaves ordinary text alone, also text of the private range in another font', () => {
    pcHas()
    const context = new Context()
    context.font = '16px "함초롬바탕", serif'
    context.fillText('수식 1+2')
    // an old-Hangul or symbol glyph of the same range, in a font that is no equation font
    context.fillText('\ue034')
    expect(drawn).toEqual([
      { font: '16px "함초롬바탕", serif', text: '수식 1+2' },
      { font: '16px "함초롬바탕", serif', text: '\ue034' },
    ])
  })
})

describe('a page of the print path', () => {
  const page = [
    '<svg xmlns="http://www.w3.org/2000/svg">',
    '<text x="0" y="0" transform="matrix(1 0 -0 1 4.00 13.75)" font-size="16.00" fill="#000000" font-family="HyhwpEQ">\ue034</text>',
    '<text x="0" y="0" font-size="16.00" font-family="HyhwpEQ">\ue0fc</text>',
    '<text x="0" y="0" font-size="16.00" font-family="HancomEQN">\ue055</text>',
    '<text x="0" y="0" font-size="16.00" font-family="HyhwpEQ">×</text>',
    '<text x="0" y="0" font-size="12.00" font-family="\'함초롬바탕\',serif">본문 1</text>',
    '</svg>',
  ].join('')

  it('comes back as it is when the PC has the fonts, or cannot be asked', () => {
    pcHas('HyhwpEQ', 'HancomEQN')
    expect(equationSvgForThisPc(page)).toBe(page)
    setEquationFontProbe(() => null)
    expect(equationSvgForThisPc(page)).toBe(page)
  })

  it('is decoded for a PC without them, the rest of the page untouched', () => {
    pcHas()
    const out = equationSvgForThisPc(page)
    expect(out).not.toContain('HyhwpEQ')
    expect(out).not.toContain('HancomEQN')
    expect(out).not.toMatch(/[\ue000-\ue0ff]/)
    // the digit, in the fallback fonts, where it was
    expect(out).toContain(
      `<text x="0" y="0" transform="matrix(1 0 -0 1 4.00 13.75)" font-size="16.00" fill="#000000" font-family="'Latin Modern Math', 'STIX Two Text', 'STIX Two Math', 'Times New Roman', 'Times', serif">1</text>`,
    )
    // a variable in the italic face; a sign that would end the element, escaped
    expect(out).toMatch(/font-style="italic">x<\/text>/)
    expect(out).toContain('>&lt;</text>')
    expect(out).toContain('>×</text>')
    expect(out).toContain(
      `<text x="0" y="0" font-size="12.00" font-family="'함초롬바탕',serif">본문 1</text>`,
    )
  })

  it('squeezes a big operator of the print path the same way', () => {
    pcHas()
    const sum =
      '<svg><text x="0" y="0" transform="matrix(1 0 -0 1 4.00 20.00)" font-size="24.00" font-family="HancomEQN">\ue067</text></svg>'
    const out = equationSvgForThisPc(sum)
    expect(out).toContain(
      'transform="matrix(1 0 -0 1 4.00 20.00) translate(0 -4.62) scale(1 0.74)"',
    )
    expect(out).toContain('>∑</text>')
  })

  it('leaves a page without equations as it is, whatever the PC has', () => {
    pcHas()
    const plain = '<svg><text font-family="serif">가</text></svg>'
    expect(equationSvgForThisPc(plain)).toBe(plain)
    expect(equationSvgForThisPc(undefined as never)).toBeUndefined()
  })
})

describe('the studio patch for equation fonts', () => {
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
    '}',
    '',
  ].join('\n')

  it('puts the layer under the substitution and lets a glyph run through it', () => {
    const patched = applyPatch('studio-equation-fonts', bridge)
    expect(patched).toContain(
      "import { installEquationFonts, isEquationGlyphFont } from '@ieum/pc-fonts';",
    )
    // installed when the module loads, before the substitution wraps the canvas font
    expect(patched.indexOf('installEquationFonts();')).toBeLessThan(
      patched.indexOf('function substituteCssFontFamily'),
    )
    // the run's font is not weighed against what the studio knows of the PC's fonts
    expect(patched.indexOf('if (isEquationGlyphFont(primary)) return cssFont;')).toBeLessThan(
      patched.indexOf('getLocalFontState().stored'),
    )
    expect(STUDIO_PATCHES).toContain('studio-equation-fonts')
    expect(() => applyPatch('studio-equation-fonts', 'export const x = 1')).toThrow(/rhwp patch/)
  })
})
