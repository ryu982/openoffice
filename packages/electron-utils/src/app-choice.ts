/**
 * Which editors are on and whether AI features are on (Settings, the
 * first-run picker). The values live in userData/app-settings.json and only
 * the shell's main process reads and writes them; it sets the source here,
 * and the editor mains read the same answer through `appChoice()` and its
 * shorthands instead of reading the file themselves. With no source set (an
 * editor running on its own) everything is on and AI is on.
 *
 * The item ids live here, not in the shell, so the editor mains and preloads
 * can import them without depending on the shell; the shell's
 * `src/shared/editor-choice.ts` re-exports them and adds the mapping to its
 * tab and new-document kinds. Node-free and import-free: preloads and
 * renderers may import it.
 */

/** the eleven items in the order they are shown: ten editors and the PDF tools */
export const EDITOR_ITEM_IDS = [
  'docs',
  'sheets',
  'slides',
  'pdf',
  'pdfTools',
  'markdown',
  'html',
  'mindmap',
  'diagram',
  'hwp',
  'epub',
] as const

export type EditorItemId = (typeof EDITOR_ITEM_IDS)[number]

/** the one item that is a tool with no file format of its own */
export type ToolItemId = 'pdfTools'
export type EditorOnlyItemId = Exclude<EditorItemId, ToolItemId>

export const EDITOR_ONLY_ITEM_IDS: readonly EditorOnlyItemId[] = EDITOR_ITEM_IDS.filter(
  (id): id is EditorOnlyItemId => id !== 'pdfTools',
)

export function isEditorItemId(value: unknown): value is EditorItemId {
  return typeof value === 'string' && (EDITOR_ITEM_IDS as readonly string[]).includes(value)
}

export function isToolItem(id: EditorItemId): id is ToolItemId {
  return id === 'pdfTools'
}

/**
 * The choice that applies. `locked` stays false until an administrator
 * policy can override and lock the choice (not read yet).
 */
export interface AppChoice {
  /** items turned off, in the fixed order */
  off: EditorItemId[]
  aiFeatures: boolean
  locked: false
}

/** what a screen asks to change; absent fields stay as they are */
export interface AppChoicePatch {
  off?: EditorItemId[]
  aiFeatures?: boolean
}

/** everything on, AI on: the state when nothing was chosen (read-only; copy before changing) */
export const ALL_ON_APP_CHOICE: {
  readonly off: readonly EditorItemId[]
  readonly aiFeatures: boolean
  readonly locked: false
} = Object.freeze({ off: Object.freeze([]), aiFeatures: true, locked: false })

function allOn(): AppChoice {
  return { off: [], aiFeatures: true, locked: false }
}

/** the keys in userData/app-settings.json */
export const APP_CHOICE_KEYS = {
  /** `{ "off": [<id>…] }`; absent or empty = everything on */
  editors: 'editors',
  /** written only as false; absent = on */
  aiFeatures: 'aiFeatures',
  /** true once the one-time editor picker was passed */
  editorPickSeen: 'editorPickSeen',
} as const

/** the window property the preloads expose the bridge (app-choice-bridge.ts) under */
export const APP_CHOICE_BRIDGE_KEY = 'aiOfficeEditorChoice'

export const APP_CHOICE_CHANNELS = {
  /** renderer → main: the choice that applies (AppChoice) */
  get: 'app:get-editor-choice',
  /** renderer → main: change it (AppChoicePatch); answers the choice that applies after */
  set: 'app:set-editor-choice',
  /** main → every window: the choice changed (AppChoice) */
  changed: 'app:editor-choice-changed',
  /** renderer → main: whether the one-time picker is due (boolean) */
  pickDue: 'app:editor-pick-due',
  /** renderer → main: the one-time picker was passed */
  markPickSeen: 'app:mark-editor-pick-seen',
  /** renderer → main: how many AI jobs the screens started are running (number) */
  aiJobCount: 'app:ai-job-count',
  /** main → every window: the running AI job count changed (number) */
  aiJobsChanged: 'app:ai-jobs-changed',
  /** renderer → main: stop every running AI job; answers how many were stopped */
  stopAllAiJobs: 'app:stop-all-ai-jobs',
} as const

/**
 * The known ids of an `editors` value (`{ off: [...] }`), each once, in the
 * fixed order. All ten editors off stays as it is here; see normalizeEditorOff.
 */
export function editorOffList(raw: unknown): EditorItemId[] {
  const off =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as { off?: unknown }).off
      : undefined
  if (!Array.isArray(off)) return []
  return EDITOR_ITEM_IDS.filter((id) => off.includes(id))
}

/** no editor left on (the PDF tools alone do not count as one) */
export function allEditorsOff(off: readonly EditorItemId[]): boolean {
  return EDITOR_ONLY_ITEM_IDS.every((id) => off.includes(id))
}

/**
 * Read an `editors` value: unknown ids dropped, and a value with all ten
 * editors off reads as everything on, since at least one editor is always on.
 */
export function normalizeEditorOff(raw: unknown): EditorItemId[] {
  const off = editorOffList(raw)
  return allEditorsOff(off) ? [] : off
}

/** AI is on unless the value is exactly false */
export function normalizeAiFeatures(raw: unknown): boolean {
  return raw !== false
}

/** The choice stored in the whole app-settings object */
export function appChoiceFromSettings(settings: Record<string, unknown>): AppChoice {
  return {
    off: normalizeEditorOff(settings[APP_CHOICE_KEYS.editors]),
    aiFeatures: normalizeAiFeatures(settings[APP_CHOICE_KEYS.aiFeatures]),
    locked: false,
  }
}

/** A choice sent over IPC */
export function normalizeAppChoice(raw: unknown): AppChoice {
  const obj =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    off: normalizeEditorOff({ off: obj.off }),
    aiFeatures: normalizeAiFeatures(obj.aiFeatures),
    locked: false,
  }
}

let source: (() => AppChoice) | null = null

/** The shell sets this once; null clears it (tests, an editor on its own) */
export function setAppChoiceSource(next: (() => AppChoice) | null): void {
  source = next
}

/** The choice that applies now; everything on when no source is set or it fails */
export function appChoice(): AppChoice {
  if (!source) return allOn()
  try {
    return normalizeAppChoice(source())
  } catch {
    return allOn()
  }
}

export function aiFeaturesOn(): boolean {
  return appChoice().aiFeatures
}

export function isEditorItemOff(item: EditorItemId): boolean {
  return appChoice().off.includes(item)
}
