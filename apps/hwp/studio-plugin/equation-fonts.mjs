/**
 * Equations that read right with or without Hancom's equation fonts.
 *
 * The engine draws the letters, digits and signs of an equation as glyph runs of Hancom's
 * equation font: HyhwpEQ, or HancomEQN in documents of newer Hangul. A run is written in
 * the font's private code points (U+E034 is the digit 1, U+E0FC an italic x), which mean
 * nothing in any other font: drawn in another one, an equation shows other letters.
 *
 * Two things went wrong with that.
 *  - The studio keeps a font in a canvas font list only once it knows the PC has it, and it
 *    knows that when its look at the PC's fonts is over. Until then (seconds, on a first
 *    run) the equation font was dropped and the runs were drawn in the next font.
 *  - On a PC without Hancom Office the font is never there, so they stayed that way.
 *
 * So the canvas is asked directly whether the font is there (measuring a few of its glyphs
 * needs no font list), and the answer decides:
 *  - there: the font stays first in the list, from the first paint on;
 *  - not there: the run is decoded back to the characters it stands for and drawn in the
 *    serif and math fonts the PC has. Positions stay the engine's, so an equation keeps its
 *    layout; the glyphs are those of another font.
 * The pages the print path draws (SVG) are decoded the same way.
 *
 * The code points are those of the engine's own table (rhwp, src/renderer/equation/
 * hancom_glyphs.rs), which it reads from the font's cmap.
 */

/** The fonts whose glyph runs are written in private code points. */
const GLYPH_FONTS = new Set(['hyhwpeq', 'hancomeqn'])

/**
 * A family no PC has, first in the list a decoded run is drawn with: the text draw reads it
 * to know that the run in its hands is to be decoded.
 */
export const EQUATION_FALLBACK_MARK = 'Ieum Equation Fallback'
/** What an equation is drawn with when Hancom's fonts are missing: the engine's own chain. */
const FALLBACK_FAMILIES = ['Latin Modern Math', 'STIX Two Text', 'STIX Two Math', 'Times New Roman']
const CANVAS_FALLBACK = [
  `"${EQUATION_FALLBACK_MARK}"`,
  ...FALLBACK_FAMILIES.map((family) => `"${family}"`),
  'Times',
  'serif',
].join(', ')
const SVG_FALLBACK = [...FALLBACK_FAMILIES.map((family) => `'${family}'`), "'Times'", 'serif'].join(
  ', ',
)

const GREEK_LOWER = 'αβγδεζηθικλμνξοπρστυφχψω'
const GREEK_UPPER = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'

/**
 * Code point of a glyph → the character it stands for, whether the glyph itself is slanted
 * (a lower-case variable; the engine slants a capital with a shear of its own), and whether
 * it is a big operator, which stands on the baseline in Hancom's font and hangs below it in
 * a text font.
 * @type {Map<number, { text: string, italic: boolean, fit?: true }>}
 */
const GLYPHS = (() => {
  const map = new Map()
  const put = (code, text, italic = false) => map.set(code, { text, italic })
  for (let index = 0; index < 26; index++) {
    put(0xe000 + index, String.fromCharCode(65 + index))
    put(0xe0e5 + index, String.fromCharCode(97 + index), true)
  }
  put(0xe03d, '0')
  for (let digit = 1; digit <= 9; digit++) put(0xe033 + digit, String(digit))
  for (const [code, text] of [
    [0xe042, '%'],
    [0xe044, '('],
    [0xe045, ')'],
    [0xe046, '\u2212'],
    [0xe047, '='],
    [0xe048, '+'],
    [0xe04f, ':'],
    [0xe050, "'"],
    [0xe052, ','],
    [0xe055, '<'],
    [0xe056, '>'],
  ]) {
    put(code, text)
  }
  map.set(0xe067, { text: '\u2211', italic: false, fit: true })
  ;[...GREEK_UPPER].forEach((letter, index) => put(0xe085 + index, letter))
  ;[...GREEK_LOWER].forEach((letter, index) => put(0xe09d + index, letter))
  return map
})()

/** Every glyph code lies in U+E000 to U+E0FF: one shift tells most text apart. */
const mayBeGlyph = (code) => code >>> 8 === 0xe0

/** A family name as a font list writes it, without its quotes. */
const bare = (family) => family.trim().replace(/^(['"])(.*)\1$/, '$2')

/** Whether a family is one of Hancom's equation fonts. */
export function isEquationGlyphFont(family) {
  return typeof family === 'string' && GLYPH_FONTS.has(bare(family).toLowerCase())
}

/**
 * Whether a font list of a print page (the value of an SVG `font-family`) is an
 * equation's: Hancom's glyph font, or the fallback equationSvgForThisPc wrote in its
 * place. Such text is drawn by this module's own rules, not the page text's.
 */
export function isEquationSvgFamily(families) {
  if (typeof families !== 'string') return false
  if (families === SVG_FALLBACK) return true
  return isEquationGlyphFont(families.split(',')[0].replace(/&apos;|&quot;/g, "'"))
}

/**
 * A glyph run as the characters it stands for; null when it holds no glyph code. `italic`
 * is whether the run is one of slanted glyphs, `fit` whether it is a big operator to be
 * fitted onto the baseline (the engine writes one glyph a run).
 */
export function decodeEquationGlyphs(text) {
  if (typeof text !== 'string') return null
  let found = false
  let italic = false
  let fit = false
  let decoded = ''
  for (const char of text) {
    const code = char.codePointAt(0)
    const glyph = mayBeGlyph(code) ? GLYPHS.get(code) : undefined
    if (!glyph) {
      decoded += char
      continue
    }
    found = true
    italic ||= glyph.italic
    fit ||= glyph.fit === true
    decoded += glyph.text
  }
  return found ? { text: decoded, italic, ...(fit ? { fit: true } : {}) } : null
}

/**
 * How far a text font's sum sign hangs below the baseline, as a share of its height, when
 * the page cannot be measured (the print path's SVG): Times New Roman's, which the others
 * of the fallback list are close to.
 */
const BIG_OPERATOR_DESCENT = 0.26

/**
 * How the PC is asked about an equation font; the canvas by default. A test hands its own.
 * @type {null | ((family: string) => boolean | null)}
 */
let probe = null
/** What the PC answered, by font. */
const answers = new Map()
/** The canvas `font` property as the page had it before this module wrapped it. */
let nativeFont = null

/** Replaces the way the PC is asked (tests), and forgets what it answered. */
export function setEquationFontProbe(given) {
  probe = given
  answers.clear()
}

/** Forgets what the PC answered: its fonts may have changed. */
export function forgetEquationFonts() {
  answers.clear()
}

/**
 * Asks the canvas: four of the font's glyphs, in the font and without it. A PC that lacks
 * the font draws both the same; the font's own widths differ from one another and from any
 * fallback's. Null where there is no canvas to ask (the command line).
 */
function canvasProbe(family) {
  const page = globalThis.document
  if (!page?.createElement) return null
  try {
    const context = page.createElement('canvas').getContext('2d')
    if (!context) return null
    const setFont = (value) => {
      if (nativeFont?.set) nativeFont.set.call(context, value)
      else context.font = value
    }
    const glyphs = ['\ue034', '\ue0e5', '\ue0ed', '\ue0f1']
    const widths = (value) => {
      setFont(value)
      return glyphs.map((glyph) => context.measureText(glyph).width)
    }
    const own = widths(`64px "${family}", monospace`)
    const other = widths('64px monospace')
    return own.some((width, index) => Math.abs(width - other[index]) > 0.01)
  } catch {
    return null
  }
}

/** Whether this PC has an equation font: true or false, or null when it cannot be asked. */
export function equationFontOnPc(family) {
  const key = bare(family).toLowerCase()
  if (answers.has(key)) return answers.get(key)
  const answer = (probe ?? canvasProbe)(bare(family))
  // an answer is kept; "cannot be asked" is asked again
  if (answer !== null) answers.set(key, answer)
  return answer
}

/**
 * The canvas font for a glyph run: as the engine asked when the PC has the equation font,
 * else the fallback list with its mark in front. Any other font comes back as it is.
 */
export function equationCanvasFont(cssFont) {
  if (typeof cssFont !== 'string' || !/eq/i.test(cssFont)) return cssFont
  const at = cssFont.indexOf('px ')
  if (at < 0) return cssFont
  const families = cssFont.slice(at + 3).split(',')
  if (!isEquationGlyphFont(families[0])) return cssFont
  const wanted = families.filter(isEquationGlyphFont)
  if (wanted.some((family) => equationFontOnPc(family) !== false)) return cssFont
  return cssFont.slice(0, at + 3) + CANVAS_FALLBACK
}

let installed = false

/**
 * Puts the two decisions under the page's canvases: the font a glyph run is drawn with
 * (the `font` property) and the characters it is drawn as (fillText, strokeText). Called
 * once, before the studio wraps `font` with its own substitution, so that it sits between
 * the studio and the canvas. Returns whether it was installed now.
 */
export function installEquationFonts(scope = globalThis) {
  const proto = scope.CanvasRenderingContext2D?.prototype
  if (installed || !proto) return false
  const font = Object.getOwnPropertyDescriptor(proto, 'font')
  if (!font?.get || !font.set || font.configurable === false) return false
  nativeFont = font
  Object.defineProperty(proto, 'font', {
    configurable: true,
    enumerable: font.enumerable,
    get() {
      return font.get.call(this)
    },
    set(value) {
      font.set.call(this, equationCanvasFont(String(value)))
    },
  })
  for (const method of ['fillText', 'strokeText']) {
    const draw = proto[method]
    if (typeof draw !== 'function') continue
    proto[method] = function (text, ...rest) {
      // nearly every draw leaves here: its text holds no code of the glyph range
      if (typeof text !== 'string' || !holdsGlyphRange(text)) return draw.call(this, text, ...rest)
      const now = font.get.call(this)
      const decoded = now.includes(EQUATION_FALLBACK_MARK) ? decodeEquationGlyphs(text) : null
      if (!decoded) return draw.call(this, text, ...rest)
      if (decoded.fit) return drawFitted(this, draw, decoded.text, rest)
      if (!decoded.italic) return draw.call(this, decoded.text, ...rest)
      // a slanted glyph: the fallback's italic face, for this one draw
      font.set.call(this, `italic ${now}`)
      try {
        return draw.call(this, decoded.text, ...rest)
      } finally {
        font.set.call(this, now)
      }
    }
  }
  installed = true
  return true
}

/**
 * Draws a big operator squeezed onto the baseline: as tall as the part of the fallback
 * glyph above the baseline, which is where Hancom's glyph stands, so that the limit under
 * it stays clear. A glyph that does not hang below the baseline is drawn as it is.
 */
function drawFitted(context, draw, text, [x, y, ...rest]) {
  const box = context.measureText?.(text)
  const above = box?.actualBoundingBoxAscent
  const below = box?.actualBoundingBoxDescent
  if (!(above > 0) || !(below > 0) || typeof x !== 'number' || typeof y !== 'number') {
    return draw.call(context, text, x, y, ...rest)
  }
  const squeeze = above / (above + below)
  context.save()
  try {
    context.translate(x, y - below * squeeze)
    context.scale(1, squeeze)
    return draw.call(context, text, 0, 0, ...rest)
  } finally {
    context.restore()
  }
}

function holdsGlyphRange(text) {
  for (let index = 0; index < text.length; index++) {
    if (mayBeGlyph(text.charCodeAt(index))) return true
  }
  return false
}

/**
 * A big operator of the print path, squeezed onto the baseline as the canvas does it. The
 * page cannot be measured here, so the share is the fallback fonts' usual one. An element
 * without a size or with a transform this does not read comes back as it is.
 */
function fittedSvg(element) {
  const size = Number(/\sfont-size="([\d.]+)"/.exec(element)?.[1])
  if (!(size > 0)) return element
  const squeeze = 1 - BIG_OPERATOR_DESCENT
  const lift = (size * BIG_OPERATOR_DESCENT * squeeze).toFixed(2)
  const fit = `translate(0 -${lift}) scale(1 ${squeeze})`
  if (/\stransform="/.test(element)) {
    return element.replace(/\stransform="([^"]*)"/, (whole, own) => ` transform="${own} ${fit}"`)
  }
  return element.replace('<text', `<text transform="${fit}"`)
}

const escapeXml = (text) =>
  text.replace(/[&<>]/g, (char) => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;'))

/**
 * A page as the print path draws it (SVG), for this PC: where Hancom's equation font is
 * missing, its glyph runs are decoded and given the fallback fonts. With the font there, or
 * where the PC cannot be asked, the page comes back as it is.
 */
export function equationSvgForThisPc(svg) {
  if (typeof svg !== 'string' || !/font-family="['"]?(?:hyhwpeq|hancomeqn)/i.test(svg)) return svg
  return svg.replace(
    /<text\b([^>]*?)\sfont-family="([^"]*)"([^>]*)>([^<]*)<\/text>/g,
    (whole, before, families, after, body) => {
      const first = families.split(',')[0]
      if (!isEquationGlyphFont(first) || equationFontOnPc(first) !== false) return whole
      let italic = false
      let fit = false
      const text = [...body]
        .map((char) => {
          const code = char.codePointAt(0)
          const glyph = mayBeGlyph(code) ? GLYPHS.get(code) : undefined
          if (!glyph) return char
          italic ||= glyph.italic
          fit ||= glyph.fit === true
          return escapeXml(glyph.text)
        })
        .join('')
      const style = italic ? ' font-style="italic"' : ''
      const element = `<text${before} font-family="${SVG_FALLBACK}"${style}${after}>${text}</text>`
      return fit ? fittedSvg(element) : element
    },
  )
}
