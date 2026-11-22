/** @vitest-environment jsdom */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AiPanelHeader } from '../src/AiPanelHeader'
import { aiSubscriptionText } from '../src/strings-ai-subscription'

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

describe('AiPanelHeader', () => {
  it('renders AiMark and AI Assistant title when no project chat menu is present', () => {
    act(() => {
      root.render(
        <AiPanelHeader
          lang="ko"
          actions={<button type="button" className="ai-panel-header-btn">New</button>}
        />,
      )
    })
    const title = container.querySelector('.ai-panel-title')
    expect(title).not.toBeNull()
    expect(title!.textContent).toContain(aiSubscriptionText('ko', 'aiAssistant'))
    expect(container.querySelector('.ai-panel-header-actions')).not.toBeNull()
  })

  it('replaces static AI Assistant text with chatMenu when a project chat is active', () => {
    act(() => {
      root.render(
        <AiPanelHeader
          lang="ko"
          chatMenu={<button type="button" className="project-chat-btn">Q3 Report</button>}
        />,
      )
    })
    expect(container.querySelector('.ai-panel-title')).toBeNull()
    expect(container.querySelector('.ai-panel-header-mark svg')).not.toBeNull()
    expect(container.querySelector('.project-chat-btn')?.textContent).toBe('Q3 Report')
  })
})
