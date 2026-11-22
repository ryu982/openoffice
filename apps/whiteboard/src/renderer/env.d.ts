/// <reference types="vite/client" />

import type { ProjectApi, ProjectFolderApi } from '@genoffice/project-store'
import type { AppChoiceSource, SplitPaneBridge } from '@genoffice/ui'
import type { WhiteboardApi } from '../shared/ipc'

declare global {
  interface Window {
    whiteboardApi: WhiteboardApi
    projectFolderApi?: ProjectFolderApi
    projectApi?: Pick<ProjectApi, 'resolveChat' | 'appendChat' | 'loadChat' | 'rebindChat'>
    aiOfficeSplit?: SplitPaneBridge
    aiOfficeEditorChoice?: AppChoiceSource
  }
}

export {}
