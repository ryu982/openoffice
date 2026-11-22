import React, { useCallback, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import { IconArrowDown } from './icons'
import { aiPanelText } from './strings-ai-panel'

const DEFAULT_THRESHOLD_PX = 80

export interface ScrollToBottomState {
  readonly showButton: boolean
  readonly onScroll: () => void
  readonly scrollToBottom: () => void
}

/**
 * Tracks whether a scrollable chat container has moved away from its bottom
 * edge and offers a smooth jump back down.
 */
export function useScrollToBottom(
  scrollRef: React.RefObject<HTMLElement | null>,
  thresholdPx = DEFAULT_THRESHOLD_PX,
): ScrollToBottomState {
  const [showButton, setShowButton] = useState(false)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowButton(distance > thresholdPx)
  }, [scrollRef, thresholdPx])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else {
      el.scrollTop = el.scrollHeight
    }
    setShowButton(false)
  }, [scrollRef])

  return { showButton, onScroll, scrollToBottom }
}

/**
 * Floating circular down-arrow button anchored above the composer when the
 * user has scrolled up into an earlier part of the conversation.
 */
export function AiScrollToBottom({
  lang,
  visible,
  onClick,
}: {
  readonly lang: Lang
  readonly visible: boolean
  readonly onClick: () => void
}): React.JSX.Element | null {
  if (!visible) return null
  const label = aiPanelText(lang, 'scrollToBottom')
  return (
    <div className="ai-scroll-bottom-wrap">
      <button
        type="button"
        className="ai-scroll-bottom-btn"
        onClick={onClick}
        data-tip={label}
        aria-label={label}
      >
        <IconArrowDown size={15} />
      </button>
    </div>
  )
}
