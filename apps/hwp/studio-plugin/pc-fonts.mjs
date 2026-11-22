/**
 * The PC's fonts in the editor's font lists from the start.
 *
 * The studio reads only the fonts it found last time; looking at the PC again is the
 * 찾기 button in its options dialog, so a user who never pressed it saw the seven base
 * fonts and the document's own, and a font installed later stayed out of the list. On a
 * website that is deliberate (the browser asks the user before listing the fonts); the app
 * already lets its pages list them, as the Word, Excel and PowerPoint pickers do.
 *
 * At start-up the editor asks the PC for its font list. That answer is cheap: names only.
 * The studio's own detection then reads each font file's name table for the Korean names,
 * which touches every installed file, so it runs only when the list differs from what the
 * studio kept (first run, a font installed or removed). Nothing is shown or asked; a refused
 * or failed look leaves the kept list and the 찾기 button as they were.
 *
 * A font that is not on the PC is drawn with another one, while the document keeps its
 * name: a document from Hancom Office shows its 함초롬 fonts on a PC without Hancom Office
 * in a look-alike. The font lists and the font box mark such a font (markFontOption,
 * watchFontBox), and the app tells which of a document's fonts are drawn that way
 * (missingFonts). Until the start-up look is over, and when the kept records did not come
 * from the PC's own list, whether a font is there is not known and nothing is marked.
 */

import { forgetEquationFonts } from './equation-fonts.mjs'

/** Module specifier the studio-pc-fonts patches import; build-studio.mjs aliases it. */
export const PC_FONTS_MODULE = '@ieum/pc-fonts'

// the studio's canvas font substitution imports these from the same module (equation-fonts.mjs)
export { installEquationFonts, isEquationGlyphFont } from './equation-fonts.mjs'

/** The studio's names that are not one font: its generic families and its font sets. */
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace'])
const FONT_SET_PREFIX = '__fontset__'

/**
 * What the studio knows of the PC's fonts (installFontPresence): its lookup of a name, its
 * records, the fonts its canvas probe found, and where and when its kept records came from.
 * @type {null | {
 *   resolveLocalFont: (name: string) => unknown,
 *   records: () => ReadonlyArray<{ family?: string; fullName?: string; postscriptName?: string; displayName?: string; aliases?: readonly string[] }>,
 *   detected: () => Iterable<string>,
 *   state: () => { source: string | null; count?: number; detectedAt?: unknown },
 * }}
 */
let presence = null
/** Every name of the studio's records, compared as the studio does, for the records it had then. */
let recordNames = { key: '', names: new Set() }
/** Settles when the start-up look at the PC's fonts is over, however it ended. */
let settled = Promise.resolve()
/**
 * The studio's work on the document's fonts that a font change set off (noteFontsApplying),
 * while the change is being told; null when it set none off.
 * @type {null | Promise<unknown>}
 */
let applying = null
/**
 * The words a missing font is marked with, in the app's language (setMissingFontLabels).
 * @type {null | { tag: string, hint: string }}
 */
let labels = null
/**
 * The toolbar's font box, once watchFontBox has it.
 * @type {null | HTMLSelectElement}
 */
let fontBox = null

/** A font name the way the studio compares them (its `normalizeFontAlias`). */
const alias = (value) =>
  typeof value === 'string'
    ? value
        .replaceAll('\u0000', '')
        .normalize('NFC')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('en-US')
    : ''

/** The name the studio keys one listed face by: PostScript name, else full name, else family. */
const faceKey = (face) => alias(face.postscriptName) || alias(face.fullName) || alias(face.family)

/**
 * Whether the kept records already hold exactly the faces the PC lists now: as many faces,
 * and each listed one known under some name of a record (a record merges the names the
 * enumeration gave with those read from the file). Records the studio found by trying a
 * name (a presence probe) are not part of the list and are left out.
 */
export function sameFaces(listed, kept) {
  const faces = kept.filter((record) => record.detectionSource !== 'font-presence-probe')
  const now = new Set(listed.map(faceKey).filter(Boolean))
  if (now.size !== faces.length) return false
  const known = new Set(
    faces.flatMap((record) =>
      [record.postscriptName, record.fullName, record.family, ...(record.aliases ?? [])].map(alias),
    ),
  )
  for (const key of now) if (!known.has(key)) return false
  return true
}

/**
 * How many of the PC's fonts one detection reads the file of, on Linux, when the app did
 * not say. There the page keeps each font file it read open until its next garbage
 * collection, and a detection does not pause: on a PC with thousands of fonts the page ran
 * into the open-file limit a desktop session starts programs with (1024) and stopped for
 * good (#488). The app reads the page's own limit and passes half of it in the editor's
 * address (`fontReads`, src/main/font-file-reads.ts); this is half of that common limit,
 * for an editor started without it.
 */
export const LINUX_FONT_FILE_READS = 512

/** The share the app passed in the editor's address, else LINUX_FONT_FILE_READS. */
export function linuxFontFileReads(search = globalThis.location?.search ?? '') {
  const given = Number(new URLSearchParams(search).get('fontReads') ?? '')
  return Number.isSafeInteger(given) && given > 0 ? given : LINUX_FONT_FILE_READS
}

/**
 * Whether this editor runs inside a hidden `--headless-export` window (`&headless=1`).
 * Electron keeps `document.visibilityState === 'visible'` on hidden windows with
 * `backgroundThrottling: false`, so headless runs carry an explicit marker instead of
 * relying on visibility alone.
 */
export function isHeadlessStudio(search = globalThis.location?.search ?? '') {
  return new URLSearchParams(search).get('headless') === '1'
}

/** The host window's IPC reader for per-face SFNT metadata, when hosted inside the app. */
function defaultHostFontNamesReader() {
  try {
    const fn = globalThis.parent?.hwpApi?.readFontNames
    return typeof fn === 'function' ? (faces) => fn(faces) : null
  } catch {
    return null
  }
}

/**
 * Reads per-face SFNT name and style metadata from the host main process when running inside
 * the app, so the renderer never calls `FontData.blob()` across every installed font (#488,
 * #591). Returns null only when no host reader exists (standalone browser), letting the
 * caller fall back to blob reads there; inside the app a failed lookup returns empty slots
 * and never falls back to renderer blob reads.
 * @param {ReadonlyArray<{ family?: string; fullName?: string; postscriptName?: string; style?: string }>} fontDataList
 * @param {null | ((faces: ReadonlyArray<{ family: string; fullName: string; postscriptName: string; style: string }>) => Promise<ReadonlyArray<unknown>>)} [reader]
 */
export async function readHostFontNames(fontDataList, reader = defaultHostFontNamesReader()) {
  if (!reader) return null
  if (fontDataList.length === 0) return []
  try {
    const queries = fontDataList.map((face) => ({
      family: typeof face?.family === 'string' ? face.family : '',
      fullName: typeof face?.fullName === 'string' ? face.fullName : '',
      postscriptName: typeof face?.postscriptName === 'string' ? face.postscriptName : '',
      style: typeof face?.style === 'string' ? face.style : '',
    }))
    const resolved = await reader(queries)
    if (!Array.isArray(resolved)) return new Array(fontDataList.length).fill(null)
    return Array.from({ length: fontDataList.length }, (_, index) => {
      const entry = resolved[index]
      return entry && typeof entry === 'object' ? entry : null
    })
  } catch (error) {
    console.warn('[pc-fonts] Host font metadata lookup failed; using enumerated names only:', error)
    return new Array(fontDataList.length).fill(null)
  }
}

/** A name with a letter beyond ASCII: the PC's list gives a font's name in the PC's language first. */
const LOCAL_NAME = /[\u0080-\uffff]/

/**
 * Which fonts of the PC's list the studio's detection reads the file of, by their place in
 * the list (the studio-font-file-reads patch asks): every one, except on Linux past
 * `reads` (linuxFontFileReads). There the fonts the list names in the PC's language go first (on
 * a Korean PC the Korean fonts, whose other name a document may use), then the rest in
 * the list's order. A font that is not read keeps the names the list gives, without those
 * in its file. The choice follows from the list alone: a detection run again reads the same
 * files, and a file read again is not opened again.
 * @param {ReadonlyArray<{ family?: string; fullName?: string }>} listed
 * @returns {(index: number) => boolean}
 */
export function fontFilesToRead(
  listed,
  platform = globalThis.navigator?.platform ?? '',
  reads = linuxFontFileReads(),
) {
  if (!/Linux/.test(platform) || listed.length <= reads) return () => true
  const local = (face) => LOCAL_NAME.test(`${face.family ?? ''}${face.fullName ?? ''}`)
  const read = new Set()
  for (const first of [true, false]) {
    for (let index = 0; index < listed.length && read.size < reads; index += 1) {
      if (local(listed[index]) === first) read.add(index)
    }
  }
  return (index) => read.has(index)
}

/** Resolves once the page is visible: the enumeration refuses a hidden page (a tab opened behind another). */
function whenVisible(doc) {
  if (!doc || doc.visibilityState === 'visible') return Promise.resolve()
  return new Promise((resolve) => {
    const onShow = () => {
      if (doc.visibilityState !== 'visible') return
      doc.removeEventListener('visibilitychange', onShow)
      resolve()
    }
    doc.addEventListener('visibilitychange', onShow)
  })
}

/**
 * @param {{
 *   queryLocalFonts?: () => Promise<ReadonlyArray<{ family?: string; fullName?: string; postscriptName?: string }>>,
 *   loadStored: () => Promise<unknown>,
 *   records: () => ReadonlyArray<{ family?: string; fullName?: string; postscriptName?: string; aliases?: readonly string[]; detectionSource?: string }>,
 *   detect: () => Promise<unknown>,
 *   changed: () => void,
 *   document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>,
 * }} studio
 * @returns {Promise<boolean>} whether the studio's list was detected anew
 */
export function refreshPcFonts(studio) {
  const run = refresh(studio)
  settled = run.then(() => remarkFontBox())
  return run
}

async function refresh(studio) {
  const headless = studio.headless ?? isHeadlessStudio()
  if (headless) {
    try {
      await studio.loadStored()
    } catch (error) {
      console.warn('[pc-fonts] Stored font list not loaded in headless mode:', error)
    }
    return false
  }
  if (!studio.queryLocalFonts) return false
  try {
    await whenVisible(studio.document)
    await studio.loadStored()
    const listed = await studio.queryLocalFonts()
    if (listed.length === 0 || sameFaces(listed, studio.records())) return false
    await studio.detect()
    // the PC's fonts changed: an equation font may have come or gone
    forgetEquationFonts()
    // The studio hears of the change at once and works the document's fonts out again on
    // its own time: until then its substitution and its lookup of a document's font name
    // answer as before the look, so the look is over only once that work is.
    applying = null
    studio.changed()
    const work = applying
    applying = null
    if (work) await work.catch(() => {})
    return true
  } catch (error) {
    console.warn('[pc-fonts] PC font list not refreshed; the kept list stays:', error)
    return false
  }
}

/**
 * Takes the work the studio starts on the document's fonts when told the PC's fonts changed
 * (the studio-pc-fonts patch hands it over from the studio's own listener) and gives it back.
 */
export function noteFontsApplying(work) {
  applying = Promise.resolve(work)
  return work
}

/** Hands over what the studio knows of the PC's fonts; the studio-pc-fonts patch calls it at start-up. */
export function installFontPresence(probe) {
  presence = probe
}

/** How long a print waits for the start-up look at the PC's fonts before it goes on. */
export const PRINT_FONTS_WAIT_MS = 30_000

/**
 * Whether the pages for print can be drawn in the fonts the screen shows (print-fonts.mjs),
 * once the start-up look at the PC's fonts is over: a print asked for in the first seconds
 * of a document would otherwise go out in the engine's fonts. A page that is not shown (a
 * headless export, a tab behind another) is never given the PC's list, so it is answered
 * at once; a look that takes longer than `wait` ms is not waited for further.
 */
export async function printFontsReady({
  wait = PRINT_FONTS_WAIT_MS,
  doc = globalThis.document,
  headless = isHeadlessStudio(),
} = {}) {
  if (headless || (doc?.visibilityState && doc.visibilityState !== 'visible')) return pcFontsKnown()
  let timer
  try {
    await Promise.race([
      settled.catch(() => {}),
      new Promise((resolve) => {
        timer = setTimeout(resolve, wait)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
  return pcFontsKnown()
}

/** Resolves once the start-up look at the PC's fonts is over. */
export function whenPcFontsSettled() {
  return settled
}

/**
 * Whether a font is on this PC: true or false, or undefined while that is not known (before
 * the start-up look, with records from the studio's name probe alone, or for a generic
 * family or a font set). A font is there when the studio finds a record by that name, a
 * record carries the name (the studio's own font list shows records by names its lookup
 * does not take, a variable font's for one), or its canvas probe found it.
 */
export function fontOnPc(name) {
  if (!presence || typeof name !== 'string') return undefined
  const key = alias(name)
  if (!key || name.trim().startsWith(FONT_SET_PREFIX) || GENERIC_FAMILIES.has(key)) {
    return undefined
  }
  const state = presence.state()
  if (state.source !== 'local-font-access') return undefined
  if (presence.resolveLocalFont(name.trim())) return true
  if (namesOfRecords(state).has(key)) return true
  for (const found of presence.detected()) if (alias(found) === key) return true
  return false
}

/**
 * Whether the studio holds the PC's own font list. Until it does (the first seconds of a
 * document, a window that was never shown, a PC that refuses the list) its substitution
 * leaves out fonts it cannot vouch for, installed ones too.
 */
export function pcFontsKnown() {
  return Boolean(presence) && presence.state().source === 'local-font-access'
}

/**
 * The names an installed font goes by to the browser (its PostScript name, its full name),
 * for the font the studio draws `name` with from this PC; null when the PC's own list does
 * not hold it. A print document names the same face with them (`local()`), so the paper
 * shows the font file the page showed.
 */
export function localFontFace(name) {
  if (!presence || typeof name !== 'string' || !name.trim()) return null
  if (presence.state().source !== 'local-font-access') return null
  const record = presence.resolveLocalFont(name.trim())
  if (!record || record.detectionSource === 'font-presence-probe') return null
  const names = []
  for (const value of [record.postscriptName, record.fullName]) {
    if (typeof value === 'string' && value.trim() && !names.includes(value.trim())) {
      names.push(value.trim())
    }
  }
  return names.length > 0 ? names : null
}

/** The names of the studio's records, gathered again only when it detected anew. */
function namesOfRecords(state) {
  const key = `${state.count ?? ''}|${String(state.detectedAt ?? '')}`
  if (recordNames.key === key && recordNames.names.size > 0) return recordNames.names
  const names = new Set()
  for (const record of presence.records()) {
    const all = [record.family, record.fullName, record.postscriptName, record.displayName]
    for (const value of [...all, ...(record.aliases ?? [])]) {
      const name = alias(value)
      if (name) names.add(name)
    }
  }
  recordNames = { key, names }
  return names
}

/** The names, once each and in their order, of the fonts known not to be on this PC. */
export function missingFonts(names) {
  const seen = new Set()
  const missing = []
  for (const name of names) {
    if (typeof name !== 'string') continue
    const trimmed = name.trim()
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    if (fontOnPc(trimmed) === false) missing.push(trimmed)
  }
  return missing
}

/** Sets the words a missing font is marked with and marks the font box anew. */
export function setMissingFontLabels(given) {
  labels = { tag: given.tag, hint: given.hint }
  remarkFontBox()
}

/** Marks one entry of the studio's font menu when its font is not on this PC. */
export function markFontOption(button, name) {
  if (!labels || fontOnPc(name) !== false) return
  const tag = button.ownerDocument.createElement('span')
  tag.textContent = labels.tag
  tag.style.marginInlineStart = '8px'
  tag.style.color = 'var(--color-text-muted)'
  tag.style.fontSize = 'var(--font-size-sm)'
  button.append(tag)
  button.title = `${name}: ${labels.hint}`
}

/**
 * Marks the font box when the font it shows is not on this PC: a dotted underline, and the
 * hint as its tooltip. The box keeps its own tooltip otherwise.
 */
export function markFontBox(box, name) {
  const missing = labels !== null && fontOnPc(name) === false
  if (box.dataset.ieumTitle === undefined) box.dataset.ieumTitle = box.title
  box.title = missing && labels ? `${name}: ${labels.hint}` : box.dataset.ieumTitle
  box.style.textDecoration = missing ? 'underline dotted' : ''
}

/**
 * Marks the toolbar's font box whenever the studio sets the font it shows. The studio sets
 * it in several places (the caret's font, the language choice, the menu, a refreshed list),
 * all through the box's value, so the box's own value property passes each one on.
 */
export function watchFontBox(box) {
  const own = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value')
  if (!own?.get || !own.set) return
  Object.defineProperty(box, 'value', {
    configurable: true,
    get: () => own.get.call(box),
    set: (value) => {
      own.set.call(box, value)
      markFontBox(box, own.get.call(box))
    },
  })
  fontBox = box
}

function remarkFontBox() {
  if (fontBox) markFontBox(fontBox, fontBox.value)
}

/** The engine's own names for a document's font program, as it leads a canvas font list with. */
const ENGINE_FONT_ALIAS = /^__rhwp_(?:ttf|intrinsic)__/

/**
 * Whether a name in a canvas font list is the engine's alias for the document's font
 * program (`__rhwp_ttf__함초롬바탕`) and not a font. Only a host that hands the studio font
 * files turns such a name into a font; this app draws with the PC's fonts, where it names
 * nothing. Weighed as the document's font it is "not on this PC", and the studio then put
 * its stand-in (바탕, 맑은 고딕) before the font the document names: the page showed every
 * such font in the stand-in, while a print or a PDF drew the font itself.
 */
export function isEngineFontAlias(name) {
  return typeof name === 'string' && ENGINE_FONT_ALIAS.test(name)
}

/** The document's font name an engine alias stands for (`__rhwp_ttf__함초롬바탕` → 함초롬바탕). */
export function engineAliasTarget(name) {
  return isEngineFontAlias(name) ? name.replace(ENGINE_FONT_ALIAS, '') : null
}
