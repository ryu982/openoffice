import type { EditorChoiceApi } from '../../../shared/editor-choice'

declare global {
  interface Window {
    /** which editors and whether AI are on (src/preload/index.ts); absent in tests */
    aiOfficeEditorChoice?: EditorChoiceApi
  }
}

export {}
