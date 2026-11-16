/**
 * Reason codes for options or plans that cannot be printed. The screen maps a
 * code to its own translated text; `message` is an English detail for logs.
 */
export type PrintLayoutErrorCode =
  | 'invalid-options'
  | 'no-pages'
  | 'invalid-page-size'
  | 'invalid-mode'
  | 'invalid-nup-count'
  | 'invalid-nup-order'
  | 'invalid-booklet-binding'
  | 'poster-tiles-out-of-range'
  | 'poster-single-tile'
  | 'poster-overlap-out-of-range'
  | 'poster-overlap-too-large'
  | 'invalid-label-fill'
  | 'label-repeat-page-out-of-range'
  | 'label-start-cell-out-of-range'
  | 'label-unknown-preset'
  | 'label-spec-invalid'
  | 'label-pitch-below-cell'
  | 'label-spec-off-paper'
  | 'invalid-sides'
  | 'invalid-flag'
  | 'invalid-paper'
  | 'invalid-dpi'
  | 'fit-needs-paper'
  | 'fit-needs-single'
  | 'no-faces'

/** Plain, structured-clone friendly form (safe to send over IPC). */
export interface PrintLayoutIssue {
  code: PrintLayoutErrorCode
  message: string
}

export class PrintLayoutError extends Error {
  readonly code: PrintLayoutErrorCode

  constructor(issue: PrintLayoutIssue) {
    super(`${issue.code}: ${issue.message}`)
    this.name = 'PrintLayoutError'
    this.code = issue.code
  }

  toIssue(): PrintLayoutIssue {
    return { code: this.code, message: this.message.slice(this.code.length + 2) }
  }
}

export function issue(code: PrintLayoutErrorCode, message: string): PrintLayoutIssue {
  return { code, message }
}
