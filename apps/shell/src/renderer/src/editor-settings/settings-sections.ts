// The settings sections and where a request to open settings lands (spec
// §6, §8.1). While AI is off the AI sections (account, AI, skills) are not
// shown: settings with no target opens General, and a request for a hidden
// section opens Editors and AI, where the switch that brings them back is.
// Pure, no React.

/** every section, in the order the navigation lists them ('aiMedia' is a target inside the AI entry) */
export const SETTINGS_SECTION_IDS = [
  'account',
  'aiModel',
  'aiMedia',
  'skills',
  'general',
  'editorChoice',
  'integrations',
  'about',
] as const

export type SectionId = (typeof SETTINGS_SECTION_IDS)[number]

/** the sections that exist only for AI: hidden while AI is off */
export const AI_ONLY_SECTIONS: ReadonlySet<SectionId> = new Set<SectionId>([
  'account',
  'aiModel',
  'aiMedia',
  'skills',
])

export function isSectionId(value: unknown): value is SectionId {
  return typeof value === 'string' && (SETTINGS_SECTION_IDS as readonly string[]).includes(value)
}

export function sectionShown(id: SectionId, aiOn: boolean): boolean {
  return aiOn || !AI_ONLY_SECTIONS.has(id)
}

export function shownSettingsSections(aiOn: boolean): SectionId[] {
  return SETTINGS_SECTION_IDS.filter((id) => sectionShown(id, aiOn))
}

/** settings opened with no target: the account page, or General while AI is off */
export function defaultSettingsSection(aiOn: boolean): SectionId {
  return aiOn ? 'account' : 'general'
}

/**
 * The section to show for a request. No target (or a name this version does
 * not know, e.g. sent by the main process) opens the default; a section
 * hidden while AI is off opens Editors and AI.
 */
export function settingsSectionFor(requested: string | null | undefined, aiOn: boolean): SectionId {
  if (!isSectionId(requested)) return defaultSettingsSection(aiOn)
  return sectionShown(requested, aiOn) ? requested : 'editorChoice'
}

/** the navigation entry lit for a section: the media area is part of the AI entry */
export function navSectionOf(section: SectionId): SectionId {
  return section === 'aiMedia' ? 'aiModel' : section
}
