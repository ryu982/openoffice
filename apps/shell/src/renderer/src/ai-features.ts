import { aiVisible, useAppChoice, type AppChoiceSource } from '@genoffice/ui'

/**
 * Whether the home window shows its AI parts (editor choice spec 8.1): the
 * ask panel, the entry into the agent window, the project screen's chats and
 * memory tidy-up, the first-connection notice, the connection state on the
 * settings entry, and the AI reordering of search results. Read from the
 * shell preload's `window.aiOfficeEditorChoice`; a window without it shows
 * everything, as before the setting existed.
 */

/** the bridge the shell preload exposes; one object for the window's life */
function editorChoiceSource(): AppChoiceSource | undefined {
  return (window as { aiOfficeEditorChoice?: AppChoiceSource }).aiOfficeEditorChoice
}

/** AI features are on, kept current */
export function useAiFeaturesOn(): boolean {
  return aiVisible(useAppChoice(editorChoiceSource()))
}

export interface FirstConnectionNoticeInput {
  aiOn: boolean
  /** a subscription can be used and the notice was not acknowledged yet */
  noticeDue: boolean
  settingsVisited: boolean
  askMode: boolean
  projectsMode: boolean
  /** the project screen asked for the notice (a tidy-up waits behind it) */
  projectsNoticeAsked: boolean
}

/**
 * Home shows the first-connection notice where a connection is made or first
 * used from it: in Settings, on the ask panel, or when the project screen
 * asks. Never while AI is off.
 */
export function firstConnectionNoticeShown(input: FirstConnectionNoticeInput): boolean {
  if (!input.aiOn || !input.noticeDue) return false
  return input.settingsVisited || input.askMode || (input.projectsMode && input.projectsNoticeAsked)
}

/** the project screen's tab that holds its AI chats */
export const PROJECT_CHATS_TAB = 'chats'

/** The project screen's tabs as shown: no chats while AI is off */
export function projectTabsShown<T extends string>(tabs: readonly T[], aiOn: boolean): T[] {
  return aiOn ? [...tabs] : tabs.filter((tab) => tab !== PROJECT_CHATS_TAB)
}

/** The tab the project screen shows for the one asked: the first tab for chats while AI is off */
export function projectTabShown<T extends string>(tab: T, tabs: readonly T[], aiOn: boolean): T {
  const shown = projectTabsShown(tabs, aiOn)
  return shown.includes(tab) ? tab : (shown[0] ?? tab)
}
