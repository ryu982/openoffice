/** @vitest-environment jsdom */
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiComposer } from '../src/AiComposer'
import type { AiComposerSkills } from '../src/use-composer-skills'

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

function makeSkills(overrides?: Partial<AiComposerSkills>): AiComposerSkills {
  return {
    lang: 'ko',
    items: [
      {
        id: 'builtin:summary',
        name: 'summary',
        title: '문서 요약',
        description: '핵심 내용을 요약합니다',
        source: 'builtin',
      },
    ],
    chips: [],
    notice: null,
    onOpen: vi.fn(),
    onPick: vi.fn(),
    onRemove: vi.fn(),
    onManage: vi.fn(),
    ...overrides,
  }
}

function ComposerHarness({
  skills,
  showSkillButton,
  footerEnd,
  footerBelowEnd,
  initialValue = '기존 문장',
}: {
  skills: AiComposerSkills
  showSkillButton?: boolean
  footerEnd?: React.ReactNode
  footerBelowEnd?: React.ReactNode
  initialValue?: string
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <AiComposer
      value={value}
      busy={false}
      placeholder="Ask"
      hintIdle=""
      hintBusy=""
      sendLabel="Send"
      stopLabel="Stop"
      iconOnly
      showSkillButton={showSkillButton}
      footerEnd={footerEnd}
      footerBelowEnd={footerBelowEnd}
      skills={skills}
      onChange={setValue}
      onSend={vi.fn()}
      onStop={vi.fn()}
    />
  )
}

describe('AiComposer skill button & two-zone footer', () => {
  it('omits the `/` trigger button by default (KbAskPanel backward compatibility)', () => {
    act(() => {
      root.render(<ComposerHarness skills={makeSkills()} />)
    })
    expect(container.querySelector('.ai-skill-trigger-btn')).toBeNull()
    expect(container.querySelector('.ai-input-footer-start')).toBeNull()
  })

  it('opens SkillPicker standalone without inserting `/` into draft and picks a skill', () => {
    const skills = makeSkills()
    act(() => {
      root.render(
        <ComposerHarness
          skills={skills}
          showSkillButton
          footerEnd={<span className="model-slot">Model</span>}
          footerBelowEnd={<span className="usage-slot">Σ 1.2K</span>}
        />,
      )
    })

    const trigger = container.querySelector<HTMLButtonElement>('.ai-skill-trigger-btn')!
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    expect(trigger).not.toBeNull()
    expect(container.querySelector('.ai-input-footer-end .model-slot')).not.toBeNull()
    expect(
      container.querySelector('.ai-input-below .ai-input-below-end .usage-slot'),
    ).not.toBeNull()

    act(() => {
      trigger.click()
    })
    expect(skills.onOpen).toHaveBeenCalledTimes(1)
    expect(textarea.value).toBe('기존 문장')
    const options = container.querySelectorAll<HTMLButtonElement>('[role="option"]')
    expect(options.length).toBeGreaterThanOrEqual(2)

    act(() => {
      options[0]!.click()
    })
    expect(skills.onPick).toHaveBeenCalledWith(skills.items[0])
    expect(textarea.value).toBe('기존 문장')
    expect(container.querySelector('.ai-skill-picker')).toBeNull()
  })

  it('opens with empty note and Manage skills row even when 0 skills are enabled', () => {
    const skills = makeSkills({ items: [] })
    act(() => {
      root.render(<ComposerHarness skills={skills} showSkillButton />)
    })
    const trigger = container.querySelector<HTMLButtonElement>('.ai-skill-trigger-btn')!
    act(() => {
      trigger.click()
    })
    expect(container.querySelector('.ai-skill-picker-empty')).not.toBeNull()
    const manage = container.querySelector<HTMLButtonElement>('.ai-skill-picker-manage')!
    expect(manage).not.toBeNull()
    act(() => {
      manage.click()
    })
    expect(skills.onManage).toHaveBeenCalledTimes(1)
  })

  it('closes standalone SkillPicker on Escape without propagating to run-stop handlers', () => {
    const skills = makeSkills()
    act(() => {
      root.render(<ComposerHarness skills={skills} showSkillButton />)
    })
    const trigger = container.querySelector<HTMLButtonElement>('.ai-skill-trigger-btn')!
    act(() => {
      trigger.click()
    })
    expect(container.querySelector('.ai-skill-picker')).not.toBeNull()

    const bubbleEscape = vi.fn()
    window.addEventListener('keydown', bubbleEscape, false)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    window.removeEventListener('keydown', bubbleEscape, false)

    expect(container.querySelector('.ai-skill-picker')).toBeNull()
    expect(bubbleEscape).not.toHaveBeenCalled()
  })

  it('uses data-tip instead of native title on iconOnly send and stop buttons', () => {
    act(() => {
      root.render(<ComposerHarness skills={makeSkills()} showSkillButton />)
    })
    const sendBtn = container.querySelector<HTMLButtonElement>('.ai-send-btn')!
    expect(sendBtn.getAttribute('data-tip')).toBe('Send')
    expect(sendBtn.getAttribute('aria-label')).toBe('Send')
    expect(sendBtn.getAttribute('title')).toBeNull()

    act(() => {
      root.render(
        <AiComposer
          value=""
          busy
          placeholder="Ask"
          hintIdle=""
          hintBusy=""
          sendLabel="Send"
          stopLabel="Stop"
          iconOnly
          onChange={vi.fn()}
          onSend={vi.fn()}
          onStop={vi.fn()}
        />,
      )
    })
    const stopBtn = container.querySelector<HTMLButtonElement>('.ai-stop-btn')!
    expect(stopBtn.getAttribute('data-tip')).toBe('Stop')
    expect(stopBtn.getAttribute('aria-label')).toBe('Stop')
    expect(stopBtn.getAttribute('title')).toBeNull()
  })
})
