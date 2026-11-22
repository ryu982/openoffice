import React, { useEffect, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { AgentTokenUsage } from '@genoffice/agent-core'
import { AiUsageChip } from './AiUsageChip'
import { IconCheck, IconCopy, IconRetry } from './icons'
import { aiPanelText } from './strings-ai-panel'

const COPIED_RESET_MS = 1600

export interface AiReplyFooterProps {
  readonly lang: Lang
  /** True on the final completed turn: action buttons remain full opacity */
  readonly isLast?: boolean | undefined
  /** Reply text copied on click (omit to hide the copy button) */
  readonly copyText?: string | undefined
  /** Optional custom copy handler; defaults to navigator.clipboard.writeText */
  readonly onCopy?: (() => void) | undefined
  /** Regenerate handler; button is only shown when provided */
  readonly onRetry?: (() => void) | undefined
  /** Per-reply token usage placed at the trailing edge of the row */
  readonly usage?: AgentTokenUsage | undefined
}

/**
 * Quiet footer row beneath a completed assistant reply: Copy (all 10 editors)
 * and optional Regenerate (supporting editors) on the left, per-reply token
 * usage chip on the right. Older turns dim action buttons until hover/focus.
 */
export function AiReplyFooter({
  lang,
  isLast = false,
  copyText,
  onCopy,
  onRetry,
  usage,
}: AiReplyFooterProps): React.JSX.Element | null {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    [],
  )

  const showCopy = Boolean(copyText) || typeof onCopy === 'function'
  const showRetry = typeof onRetry === 'function'
  const hasUsage =
    usage !== undefined && (usage.inputTokens !== undefined || usage.outputTokens !== undefined)

  if (!showCopy && !showRetry && !hasUsage) return null

  const handleCopy = () => {
    if (onCopy) {
      onCopy()
    } else if (copyText && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(copyText).catch(() => {})
    }
    setCopied(true)
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setCopied(false)
      timerRef.current = null
    }, COPIED_RESET_MS)
  }

  const copyLabel = aiPanelText(lang, copied ? 'copiedReply' : 'copyReply')
  const retryLabel = aiPanelText(lang, 'regenerateReply')

  return (
    <div className={`ai-reply-footer${isLast ? ' is-last' : ''}`}>
      {(showCopy || showRetry) && (
        <span className="ai-reply-footer-actions">
          {showCopy && (
            <button
              type="button"
              className="ai-reply-footer-btn ai-msg-tool-btn"
              onClick={handleCopy}
              data-tip={copyLabel}
              aria-label={copyLabel}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </button>
          )}
          {showRetry && (
            <button
              type="button"
              className="ai-reply-footer-btn ai-msg-tool-btn"
              onClick={onRetry}
              data-tip={retryLabel}
              aria-label={retryLabel}
            >
              <IconRetry size={14} />
            </button>
          )}
        </span>
      )}
      {hasUsage && usage && (
        <span className="ai-reply-footer-usage">
          <AiUsageChip usage={usage} lang={lang} />
        </span>
      )}
    </div>
  )
}
