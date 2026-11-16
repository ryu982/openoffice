/// <reference types="vite/client" />
import type { SlidesApi } from '../shared/ipc'
import type { ProjectApi, ProjectFolderApi } from '@genoffice/project-store'
import type { SplitPaneBridge } from '@genoffice/electron-utils/split-pane-bridge'
import type { AppChoiceSource } from '@genoffice/ui'

declare global {
  interface Window {
    /** project folders (decision 0088); absent outside the shell or with an older preload */
    projectFolderApi?: ProjectFolderApi
    slidesApi: SlidesApi
    projectApi: ProjectApi
    /** absent when the preload predates the split-pane bridge (or outside the shell) */
    aiOfficeSplit?: SplitPaneBridge
    /** Settings' editor choice and AI switch, read-only here; absent outside the shell */
    aiOfficeEditorChoice?: AppChoiceSource
  }
}

export {}
