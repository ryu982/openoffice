/**
 * The print pages drawn with the fonts the page on screen shows.
 *
 * The engine writes a print page (SVG) with a font list of its own for every character and,
 * for letters and digits, a width the glyph is stretched or squeezed to. The screen draws
 * the same characters through the studio's font substitution, with the font files the
 * studio loaded for the document's fonts, and never stretches a glyph. So a print or a PDF
 * could show another font than the page (a font the browser cannot find by the document's
 * name, a font the studio stands in for), and letters pulled wide or pressed narrow where
 * the font drawn is not the one the engine measured.
 *
 * Here a page is made to draw as the screen does:
 *   - every font list becomes the one the studio's canvas resolves it to;
 *   - the fonts the studio loaded from the PC are named to the print document too, as
 *     `@font-face` rules that point at the same installed face (`local()`; no font bytes
 *     leave the editor);
 *   - a glyph is no longer stretched to its slot. One wider than its slot stays squeezed,
 *     so it does not run into the next.
 *
 * Nothing here lays text out again: places and line breaks stay the engine's.
 *
 * All of it waits for the PC's own font list (pcFontsKnown). Before the studio has it, its
 * substitution leaves installed fonts out of a list, and a page drawn after the screen
 * would lose fonts the engine's own list finds: such a page stays as the engine wrote it.
 */

import { engineAliasTarget, localFontFace, pcFontsKnown } from './pc-fonts.mjs'

const TEXT = /<text\b([^>]*)>([^<]*)<\/text>/g
const FAMILY = /\sfont-family="([^"]*)"/
const SIZE = /\sfont-size="([\d.]+)"/
const WEIGHT = /\sfont-weight="([^"]*)"/
const STYLE = /\sfont-style="([^"]*)"/
/** The slot the engine fits a glyph to, as it writes it (svg_text_length_attrs). */
const FIT = /\stextLength="([\d.]+)"\slengthAdjust="spacingAndGlyphs"/

/** How much wider than its slot a glyph may be and still be drawn as it is. */
const SLOT_SLACK = 0.02

/** CSS families that are keywords, written without quotes. */
const GENERIC = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
])

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function unescapeXml(text) {
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (whole, name) => {
    const lower = name.toLowerCase()
    if (lower in XML_ENTITIES) return XML_ENTITIES[lower]
    const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : Number(lower.slice(1))
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : whole
  })
}

const escapeXml = (text) =>
  text.replace(/[&<>"]/g, (char) =>
    char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&quot;',
  )

/** The names of a CSS font-family list, without their quotes. */
export function parseFamilies(list) {
  const names = []
  let name = ''
  let quote = ''
  for (let index = 0; index < list.length; index++) {
    const char = list[index]
    if (quote) {
      if (char === '\\' && index + 1 < list.length) name += list[++index]
      else if (char === quote) quote = ''
      else name += char
    } else if (char === '"' || char === "'") quote = char
    else if (char === ',') {
      if (name.trim()) names.push(name.trim())
      name = ''
    } else name += char
  }
  if (name.trim()) names.push(name.trim())
  return names
}

/** A CSS font-family list of the names, quoted as the engine quotes them. */
export function formatFamilies(names) {
  return names
    .map((name) =>
      GENERIC.has(name.toLowerCase())
        ? name.toLowerCase()
        : `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`,
    )
    .join(',')
}

const cssString = (text) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** A name CSS can carry in a string: no line break or control character. */
function printable(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > 200) return false
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

const UNICODE_RANGE = /^[Uu+0-9A-Fa-f?,\s-]+$/

/**
 * The `@font-face` rules that name the studio's loaded PC fonts to a print document.
 * `faces` is a list of { family, local: names of the installed face, unicodeRange? }.
 */
export function fontFaceCss(faces) {
  const rules = []
  for (const face of faces) {
    const sources = (face.local ?? []).filter(printable)
    if (!printable(face.family) || sources.length === 0) continue
    const range =
      typeof face.unicodeRange === 'string' &&
      UNICODE_RANGE.test(face.unicodeRange) &&
      !/^\s*U\+0+-10FFFF\s*$/i.test(face.unicodeRange)
        ? `unicode-range:${face.unicodeRange.replace(/\s+/g, '')};`
        : ''
    rules.push(
      `@font-face{font-family:${cssString(face.family)};` +
        `src:${sources.map((name) => `local(${cssString(name)})`).join(',')};${range}}`,
    )
  }
  return rules.join('')
}

/** The page with a style element as the first thing in it. */
function withStyle(svg, css) {
  const open = /<svg\b[^>]*>/.exec(svg)
  if (!open || !css) return svg
  const at = open.index + open[0].length
  return `${svg.slice(0, at)}<style>${escapeXml(css)}</style>${svg.slice(at)}`
}

/**
 * A page of the print path (SVG) as the screen draws its text. `screen` is what
 * screenFonts() gives; without one, or for text it cannot answer for, the page stays as
 * the engine wrote it. `kept` tells a font list that is left alone (an equation's).
 */
export function printSvgForThisPc(svg, screen, kept = () => false) {
  if (typeof svg !== 'string' || !screen) return svg
  const used = new Set()
  // a page writes one element per character, and a run of them shares its font: the
  // screen is asked once for a run, not once for a character
  let run = null
  const page = svg.replace(TEXT, (whole, attrs, body) => {
    const family = FAMILY.exec(attrs)
    if (!family) return whole
    const size = SIZE.exec(attrs)?.[1]
    const weight = WEIGHT.exec(attrs)?.[1]
    const style = STYLE.exec(attrs)?.[1]
    if (
      !run ||
      run.family !== family[1] ||
      run.size !== size ||
      run.weight !== weight ||
      run.style !== style
    ) {
      run = { family: family[1], size, weight, style, font: null, attr: '' }
      if (Number(size) > 0 && !kept(family[1])) {
        const descriptor =
          (/^(italic|oblique)/.test(style ?? '') ? 'italic ' : '') +
          (weight && /^(bold|[1-9]00)$/.test(weight) ? `${weight} ` : '') +
          `${size}px ${unescapeXml(family[1])}`
        const font = screen.font(descriptor)
        if (font && font.families.length > 0) {
          run.font = font
          run.attr = ` font-family="${escapeXml(formatFamilies(font.families))}"`
          for (const name of font.families) used.add(name)
        }
      }
    }
    if (!run.font) return whole
    let next =
      attrs.slice(0, family.index) + run.attr + attrs.slice(family.index + family[0].length)
    const fit = FIT.exec(next)
    if (fit) {
      const natural = run.font.measure(unescapeXml(body))
      if (natural > 0 && natural <= Number(fit[1]) * (1 + SLOT_SLACK)) {
        next = next.slice(0, fit.index) + next.slice(fit.index + fit[0].length)
      }
    }
    return `<text${next}>${body}</text>`
  })
  return withStyle(page, fontFaceCss(screen.faces([...used])))
}

const unquoted = (name) => String(name ?? '').replace(/^["']|["']$/g, '')

/**
 * What the screen answers about fonts, for printSvgForThisPc: the studio's canvas in
 * `doc` (the editor's document). `font(descriptor)` sets a canvas font the way a paint
 * does, through the studio's substitution, and gives the families it became and a ruler
 * for text in it; `faces(names)` gives the fonts among `names` the studio loaded from the
 * PC, with the names of the installed face. Null where there is no canvas to ask, and
 * while the studio does not hold the PC's own font list (`known`).
 */
export function screenFonts(doc = globalThis.document, known = pcFontsKnown) {
  if (!doc || typeof doc.createElement !== 'function' || !known()) return null
  /** @type {Map<string, { families: string[], measure(text: string): number } | null>} */
  const fonts = new Map()
  /** the document fonts an engine alias was turned into (lower case) */
  const aliasTargets = new Set()
  return {
    font(descriptor) {
      if (fonts.has(descriptor)) return fonts.get(descriptor)
      let font = null
      try {
        const context = doc.createElement('canvas').getContext('2d')
        // a canvas keeps its font when the new one cannot be read: start from a known one
        context.font = '10px sans-serif'
        context.font = descriptor
        const set = String(context.font)
        const at = set.indexOf('px ')
        if (set !== '10px sans-serif' && at >= 0) {
          // The engine's alias for the document's font program leads the list, and the
          // screen draws through it: the studio ties it to the font file it loaded for that
          // font. A print window has no such alias, so it is given the font by the name the
          // document uses, which faces() points at the installed file. Without a record of
          // that file the alias is only dropped, and the print draws the next names as the
          // screen then does.
          const families = []
          for (const name of parseFamilies(set.slice(at + 3))) {
            const target = engineAliasTarget(name)
            if (target === null) {
              if (!families.includes(name)) families.push(name)
            } else if (target && localFontFace(target)) {
              aliasTargets.add(target.toLowerCase())
              if (!families.includes(target)) families.push(target)
            }
          }
          const widths = new Map()
          font = {
            families,
            measure(text) {
              let width = widths.get(text)
              if (width === undefined) {
                width = context.measureText(text).width
                widths.set(text, width)
              }
              return width
            },
          }
        }
      } catch {
        // no canvas, or a font it refuses: the text keeps the engine's list
      }
      fonts.set(descriptor, font)
      return font
    },
    faces(names) {
      const loaded = new Map()
      try {
        for (const face of doc.fonts ?? []) {
          if (face.status === 'loaded') loaded.set(unquoted(face.family).toLowerCase(), face)
        }
      } catch {
        return []
      }
      const faces = []
      for (const name of names) {
        const face = loaded.get(name.toLowerCase())
        // a font the studio loaded, or the one an alias it draws through stands for
        if (!face && !aliasTargets.has(name.toLowerCase())) continue
        const installed = localFontFace(name)
        if (!installed) continue
        faces.push({ family: name, local: installed, unicodeRange: face?.unicodeRange })
      }
      return faces
    },
  }
}
