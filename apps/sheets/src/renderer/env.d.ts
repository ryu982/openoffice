declare module '*.md?raw' {
  const content: string
  export default content
}

import type { DesktopApi } from '../shared/desktop-api'
import type { ProjectApi, ProjectFolderApi } from '@genoffice/project-store'
import type { SplitPaneBridge } from '@genoffice/electron-utils/split-pane-bridge'
import type { AppChoiceSource } from '@genoffice/ui'

declare global {
  interface Window {
    /** project folders (decision 0088); absent outside the shell or with an older preload */
    projectFolderApi?: ProjectFolderApi
    readonly desktopApi: DesktopApi
    readonly projectApi: ProjectApi
    /** absent when the preload predates the split-pane bridge (or outside the shell) */
    readonly aiOfficeSplit?: SplitPaneBridge
    /** Settings' editor choice and AI switch, read-only here; absent outside the shell */
    readonly aiOfficeEditorChoice?: AppChoiceSource
    /** the frame's spell engine, bridged from webFrame in the preload */
    readonly nativeSpell?: {
      readonly isWordMisspelled: (word: string) => boolean
      readonly getWordSuggestions: (word: string) => string[]
    }
  }
}

export {}
