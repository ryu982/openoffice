/** @vitest-environment jsdom */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AiWorkSteps, type AiWorkStep } from '../src/AiWorkSteps'
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

describe('AiWorkSteps', () => {
  it('returns null when steps is empty', () => {
    act(() => {
      root.render(<AiWorkSteps lang="ko" steps={[]} />)
    })
    expect(container.querySelector('.ai-work-group')).toBeNull()
  })

  it('auto-expands while running and auto-collapses once finished', () => {
    const runningSteps: AiWorkStep[] = [
      { name: 'read_doc', summary: 'Read document', running: false },
      { name: 'edit_doc', summary: 'Edit paragraph', running: true },
    ]
    act(() => {
      root.render(<AiWorkSteps lang="ko" steps={runningSteps} />)
    })
    const btn = container.querySelector<HTMLButtonElement>('.ai-work-group-summary')!
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.textContent).toContain(aiPanelText('ko', 'workingSteps'))

    const doneSteps: AiWorkStep[] = [
      { name: 'read_doc', summary: 'Read document', running: false, output: 'ok' },
      { name: 'edit_doc', summary: 'Edit paragraph', running: false },
    ]
    act(() => {
      root.render(<AiWorkSteps lang="ko" steps={doneSteps} />)
    })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.textContent).toContain(aiPanelText('ko', 'workedSteps', { n: 2 }))
  })

  it('honors manual toggle over automatic state and expands step output details', () => {
    const doneSteps: AiWorkStep[] = [
      { name: 'read_doc', summary: 'Read document', running: false, output: 'Paragraph 1' },
    ]
    act(() => {
      root.render(<AiWorkSteps lang="en" steps={doneSteps} />)
    })
    const summaryBtn = container.querySelector<HTMLButtonElement>('.ai-work-group-summary')!
    expect(summaryBtn.getAttribute('aria-expanded')).toBe('false')

    act(() => {
      summaryBtn.click()
    })
    expect(summaryBtn.getAttribute('aria-expanded')).toBe('true')

    const stepBtn = container.querySelector<HTMLButtonElement>('.ai-step-title.clickable')!
    expect(stepBtn).not.toBeNull()
    act(() => {
      stepBtn.click()
    })
    expect(container.querySelector('.ai-tool-output-pre')?.textContent).toBe('Paragraph 1')
  })
})
