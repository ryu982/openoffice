/**
 * Whether this screen shows its AI parts (Settings › Editors and AI). The
 * preload exposes the shell's choice to read and follow only; a standalone
 * run (or an older preload) has none and keeps AI on, as before the switch.
 */
import { aiVisible, useAppChoice, type AppChoiceSource } from '@genoffice/ui'
import { APP_CHOICE_BRIDGE_KEY } from '@genoffice/electron-utils/app-choice'

/** the window's bridge: one object for the window's life, so the hook subscribes once */
export function appChoiceSource(): AppChoiceSource | undefined {
  return (window as unknown as Record<string, AppChoiceSource | undefined>)[APP_CHOICE_BRIDGE_KEY]
}

/** true while AI features are on; every AI entrance of the editor follows it */
export function useAiOn(): boolean {
  return aiVisible(useAppChoice(appChoiceSource()))
}
