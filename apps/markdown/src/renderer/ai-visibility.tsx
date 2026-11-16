/**
 * Whether this editor shows its AI parts: off while AI is turned off in
 * Settings › Editors and AI. The App and the ribbon read it with
 * `useAiVisible()`, so a change shows at once, without a reload. Outside a
 * provider (an editor on its own, tests) the AI parts show as they always did.
 * Same as the docs editor's ai-visibility.tsx.
 */
import { createContext, useContext, type ReactNode } from 'react'
import {
  ALL_ON_APP_CHOICE_STATE,
  PENDING_APP_CHOICE_STATE,
  aiVisible,
  useAppChoice,
  type AppChoiceSource,
  type AppChoiceState,
} from '@genoffice/ui'

const AiVisibleContext = createContext(true)

export function useAiVisible(): boolean {
  return useContext(AiVisibleContext)
}

/** the shell's choice as this tab's preload exposes it (read and hear only); absent on its own */
export function editorChoiceSource(): AppChoiceSource | undefined {
  return typeof window === 'undefined' ? undefined : window.aiOfficeEditorChoice
}

/** the choice to draw the first frame with, so AI parts do not flash in while AI is off */
export async function initialAppChoice(
  source: AppChoiceSource | undefined,
): Promise<AppChoiceState> {
  if (!source) return ALL_ON_APP_CHOICE_STATE
  return source.get().catch(() => ALL_ON_APP_CHOICE_STATE)
}

export function AiVisibilityProvider({
  source,
  initial = ALL_ON_APP_CHOICE_STATE,
  children,
}: {
  source: AppChoiceSource | undefined
  /** used until the source's own first answer or change arrives */
  initial?: AppChoiceState
  children: ReactNode
}) {
  const live = useAppChoice(source)
  // useAppChoice hands out a shared constant until it heard the source
  const heard = live !== ALL_ON_APP_CHOICE_STATE && live !== PENDING_APP_CHOICE_STATE
  const visible = aiVisible(heard ? live : initial)
  return <AiVisibleContext.Provider value={visible}>{children}</AiVisibleContext.Provider>
}
