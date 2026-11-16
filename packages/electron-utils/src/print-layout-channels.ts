/// Channel names and answer shapes of the advanced print layout, shared by the
/// editors' main processes (`print-arranged.ts`) and their preloads
/// (`print-layout-bridge.ts`). No runtime imports: preloads load this.
import type {
  LabelSpec,
  PrintLayoutErrorCode,
  PrintLayoutOptions,
} from '@genoffice/print-layout/plan'

/** App-wide channels: the typed-in label grid, one for every editor. */
export const PRINT_LAYOUT_SHARED_CHANNELS = {
  labelSpecGet: 'print-layout:label-spec-get',
  labelSpecSet: 'print-layout:label-spec-set',
} as const

export interface PrintLayoutEditorChannels {
  preview: string
  print: string
  save: string
  cancel: string
  /** main → the requesting window only: `PrintLayoutProgress` */
  progress: string
}

const PREFIX = /^[a-z][a-z0-9-]*$/

/** One editor's channels, named after its prefix (`docs`, `pdf`, `sheets` ...). */
export function printLayoutChannels(prefix: string): PrintLayoutEditorChannels {
  if (!PREFIX.test(prefix)) throw new Error(`invalid print layout channel prefix: ${prefix}`)
  return {
    preview: `${prefix}:print-layout-preview`,
    print: `${prefix}:print-layout-print`,
    save: `${prefix}:print-layout-save`,
    cancel: `${prefix}:print-layout-cancel`,
    progress: `${prefix}:print-layout-progress`,
  }
}

/** Faces rendered so far out of all faces of the running job. */
export interface PrintLayoutProgress {
  done: number
  total: number
}

/**
 * What a screen sends. `options` is checked again in the main process;
 * `editor` is the editor's own request (range, selection ...) handed to its
 * `buildJobPdf` as it is.
 */
export interface PrintLayoutRequestBase<E = unknown> {
  options: PrintLayoutOptions | Record<string, unknown>
  editor?: E
}

export interface PrintLayoutPreviewRequest<E = unknown> extends PrintLayoutRequestBase<E> {
  /** long side of each preview image in pixels; default 800 */
  longSidePx?: number
}

export interface PrintLayoutPrintRequest<E = unknown> extends PrintLayoutRequestBase<E> {
  /**
   * The in-app printer choice in the shape `print-job.ts` reads
   * (`PrintJobOptions`); absent or `deviceName: null` opens the system dialog.
   */
  job?: unknown
}

export type PrintLayoutSaveRequest<E = unknown> = PrintLayoutRequestBase<E>

/**
 * A job that did not finish. `aborted`: the screen canceled it. `code`: the
 * layout options cannot be printed for this job (the screen shows its own
 * text for the code); `error` is an English detail.
 */
export type PrintLayoutFailure =
  { ok: false; aborted: true } | { ok: false; error: string; code?: PrintLayoutErrorCode }

export interface PrintLayoutPreviewFace {
  /** small PNG of the face, not turned */
  png: Uint8Array
  /** the face in points */
  widthPt: number
  heightPt: number
}

export type PrintLayoutPreviewResult =
  { ok: true; faces: PrintLayoutPreviewFace[] } | PrintLayoutFailure

/** `canceled`: the user closed the system print dialog, which is not a failure. */
export type PrintLayoutPrintResult = { ok: true; canceled?: true } | PrintLayoutFailure

/** `canceled`: the user closed the save dialog. */
export type PrintLayoutSaveResult =
  { ok: true; path: string } | { ok: true; canceled: true } | PrintLayoutFailure

export type LabelSpecSetResult =
  { ok: true; spec: LabelSpec } | { ok: false; error: string; code?: PrintLayoutErrorCode }
