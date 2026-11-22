/** @vitest-environment jsdom */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiReplyFooter } from '../src/AiReplyFooter'
import { aiPanelText } from '../src/strings-ai-panel'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('AiReplyFooter', () => {
  it('returns null when nothing is provided', () => {
    act(() => {
      root.render(<AiReplyFooter lang="ko" />)
    })
    expect(container.querySelector('.ai-reply-footer')).toBeNull()
  })

  it('renders Copy button, optional Retry button, and trailing Usage chip', () => {
    const onCopy = vi.fn()
    const onRetry = vi.fn()
    act(() => {
      root.render(
        <AiReplyFooter
          lang="ko"
          isLast
          copyText="Hello world"
          onCopy={onCopy}
          onRetry={onRetry}
          usage={{ inputTokens: 1200, outputTokens: 340 }}
        />,
      )
    })

    const footer = container.querySelector('.ai-reply-footer')!
    expect(footer.classList.contains('is-last')).toBe(true)
    const buttons = Array.from(footer.querySelectorAll<HTMLButtonElement>('.ai-reply-footer-btn'))
    expect(buttons).toHaveLength(2)
    expect(buttons[0]!.getAttribute('aria-label')).toBe(aiPanelText('ko', 'copyReply'))
    expect(buttons[1]!.getAttribute('aria-label')).toBe(aiPanelText('ko', 'regenerateReply'))
    expect(footer.querySelector('.ai-reply-footer-usage .ai-usage-chip')).not.toBeNull()

    act(() => {
      buttons[0]!.click()
    })
    expect(onCopy).toHaveBeenCalledTimes(1)
    expect(buttons[0]!.getAttribute('aria-label')).toBe(aiPanelText('ko', 'copiedReply'))

    act(() => {
      buttons[1]!.click()
    })
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('omits Retry when onRetry is undefined (Copy-only editors)', () => {
    act(() => {
      root.render(<AiReplyFooter lang="en" copyText="Answer" />)
    })
    const buttons = container.querySelectorAll('.ai-reply-footer-btn')
    expect(buttons).toHaveLength(1)
    expect(container.querySelector('.ai-reply-footer')!.classList.contains('is-last')).toBe(false)
  })
})
