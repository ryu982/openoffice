import type { Lang } from '@genoffice/i18n'
import type { UiTheme } from '../shared/ipc'

/** localStorage key the studio reads its settings from before its first paint. */
export const STUDIO_SETTINGS_KEY = 'rhwp-settings'

type Json = Record<string, unknown>

const asObject = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}

function parseStored(stored: string | null): Json {
  try {
    return asObject(JSON.parse(stored ?? '{}'))
  } catch {
    return {}
  }
}

/**
 * The settings the studio must boot with, merged over whatever it stored itself.
 *
 * - theme: follows the app, so the editor chrome matches the tab around it.
 * - autosave: off. The studio keeps recovery drafts of the document in
 *   IndexedDB, and in embed mode it never offers them back, so a draft would
 *   only be a second copy of the user's document left in the app profile. The
 *   app's own autosave writes the user's file (renderer/autosave-flow.ts) and
 *   is separate from this draft autosave.
 */
export function seededStudioSettings(stored: string | null, theme: UiTheme): string {
  const settings = parseStored(stored)
  return JSON.stringify({
    ...settings,
    theme: { ...asObject(settings.theme), mode: theme },
    autosave: { ...asObject(settings.autosave), recoveryEnabled: false, idleSaveEnabled: false },
  })
}

/** The studio ships Korean and English; every other UI language gets English. */
export function studioLocale(lang: Lang): 'ko' | 'en' {
  return lang === 'ko' ? 'ko' : 'en'
}

/**
 * `chrome=embed` makes the studio drop its own document lifecycle (new, open,
 * save, print, document drops): the tab owns the file, and a document swapped
 * inside the editor would later be saved over the tab's file.
 *
 * `fontReads` is how many font files the editor's font detection may read, from this
 * view's open-file limit (studio-plugin/pc-fonts.mjs reads it as soon as it looks at the
 * PC's fonts, before anything else could tell it); none where it reads them all.
 *
 * `headless` marks a hidden `--headless-export` window: Electron keeps its initial
 * `document.visibilityState` as `visible` (especially with backgroundThrottling off),
 * so the studio needs an explicit flag to skip the start-up font enumeration.
 */
export function studioUrl(lang: Lang, fontReads: number | null = null, headless = false): string {
  const reads =
    fontReads !== null && Number.isInteger(fontReads) && fontReads > 0
      ? `&fontReads=${fontReads}`
      : ''
  const mode = headless ? '&headless=1' : ''
  return `./studio/index.html?chrome=embed&lang=${studioLocale(lang)}${reads}${mode}`
}
