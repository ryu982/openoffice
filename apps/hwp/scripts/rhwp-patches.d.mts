import type { Plugin } from 'vite'

export type RhwpPatchName =
  | 'sdk-scheme'
  | 'studio-scheme'
  | 'studio-password-flag'
  | 'studio-plugin-allow'
  | 'studio-option-keys'
  | 'studio-table-delete-at'
  | 'studio-nested-table-delete'
  | 'studio-nested-table-cut'
  | 'studio-nested-table-command'

export declare const APP_SCHEME: string
export declare const PASSWORD_FLAG: 'passwordProtected'
export declare const AGENT_PLUGIN_MODULE: string
export declare const OPTION_KEYS: ReadonlyArray<readonly [string, string]>
export declare const STUDIO_PATCHES: readonly RhwpPatchName[]
export declare function patchTargets(name: RhwpPatchName, file: string): boolean
export declare function applyPatch(name: RhwpPatchName, code: string): string
export declare function rhwpPatches(...names: RhwpPatchName[]): Plugin
