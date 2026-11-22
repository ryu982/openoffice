/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AiEmptyHints } from '../src/AiEmptyHints'
import { aiPanelText } from '../src/strings-ai-panel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('AiEmptyHints', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('renders nothing when neither hint is enabled', () => {
    act(() => {
      root.render(<AiEmptyHints lang="ko" showSkill={false} showDocMention={false} />)
    })
    expect(host.querySelector('.ai-chat-empty-hints')).toBeNull()
  })

  it('renders only the skill hint without separator or duplicated slash', () => {
    act(() => {
      root.render(<AiEmptyHints lang="ko" showSkill showDocMention={false} />)
    })
    const el = host.querySelector('.ai-chat-empty-hints')
    expect(el).not.toBeNull()
    expect(el?.textContent).toBe(aiPanelText('ko', 'hintSkill'))
    expect(el?.textContent?.startsWith('/ /')).toBe(false)
    expect(el?.querySelector('.ai-chat-empty-hint-sep')).toBeNull()
  })

  it('renders only the doc mention hint without separator or duplicated at-sign', () => {
    act(() => {
      root.render(<AiEmptyHints lang="en" showSkill={false} showDocMention />)
    })
    const el = host.querySelector('.ai-chat-empty-hints')
    expect(el).not.toBeNull()
    expect(el?.textContent).toBe(aiPanelText('en', 'hintDocMention'))
    expect(el?.textContent?.startsWith('@ @')).toBe(false)
    expect(el?.querySelector('.ai-chat-empty-hint-sep')).toBeNull()
  })

  it('renders both hints separated by a middle dot without duplicating trigger symbols', () => {
    act(() => {
      root.render(<AiEmptyHints lang="ko" showSkill showDocMention />)
    })
    const el = host.querySelector('.ai-chat-empty-hints')
    expect(el).not.toBeNull()
    const sep = el?.querySelector('.ai-chat-empty-hint-sep')
    expect(sep?.textContent).toBe('·')
    expect(sep?.getAttribute('aria-hidden')).toBe('true')
    expect(el?.textContent).toBe(
      `${aiPanelText('ko', 'hintSkill')}·${aiPanelText('ko', 'hintDocMention')}`,
    )
    expect(el?.textContent).not.toContain('/ /')
    expect(el?.textContent).not.toContain('@ @')
  })
})
