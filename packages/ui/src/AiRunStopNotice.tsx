import React from 'react'
import type { AgentRunStop } from '@genoffice/agent-core'
import type { Lang } from '@genoffice/i18n'
import { runStopNotice } from './run-stop'
import { AI_RUN_STOP_LABELS } from './strings-run-stop'
import './ai-subscription.css'

/**
 * Shown where the app stopped a run by its own rule: why, in the screen
 * language, what stays in the document, and (when the run had changed it) a
 * button that goes on from there. The last line is the stop in plain words
 * and counts, for a report.
 */
export function AiRunStopNotice({
  stop,
  lang,
  onContinue,
}: {
  readonly stop: AgentRunStop
  readonly lang: Lang
  /** absent where going on is not offered (an older reply, or a run in progress) */
  readonly onContinue?: (() => void) | undefined
}): React.JSX.Element {
  const notice = runStopNotice(stop, lang)
  return (
    <div className="ai-sub-blocked" role="alert" data-stop={stop.kind}>
      <p className="ai-sub-blocked-reason">{notice.reason}</p>
      {notice.cause && (
        <p className="ai-sub-note" data-note="cause">
          {notice.cause}
        </p>
      )}
      <p className="ai-sub-note" data-note="next">
        {notice.next}
      </p>
      {notice.canContinue && onContinue && (
        <button
          type="button"
          className="ai-sub-btn primary"
          data-action="continue-run"
          onClick={onContinue}
        >
          {(AI_RUN_STOP_LABELS[lang] ?? AI_RUN_STOP_LABELS.en).continueAction}
        </button>
      )}
      <p className="ai-sub-note" data-note="code" dir="ltr">
        {notice.code}
      </p>
    </div>
  )
}
