/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRunStop } from '@genoffice/agent-core'
import { LANGS } from '@genoffice/i18n'
import { AiRunStopNotice } from '../src/AiRunStopNotice'
import { runContinueNote, runStopCode, runStopNotice, runStopText } from '../src/run-stop'
import { AI_RUN_STOP_LABELS } from '../src/strings-run-stop'

const CUT_OFF: AgentRunStop = {
  kind: 'tool-input',
  faults: { truncated: 2, missing: 1 },
  tools: ['insert_table', 'unknown'],
  executed: 4,
  mutated: true,
}
const NOTHING_DONE: AgentRunStop = {
  kind: 'tool-input',
  faults: { unparseable: 3 },
  tools: ['insert_paragraphs'],
  executed: 0,
  mutated: false,
}

describe('what a stopped run says', () => {
  it('gives the reason, each cause once, and what to do next', () => {
    const ko = AI_RUN_STOP_LABELS.ko
    expect(runStopNotice(CUT_OFF, 'ko')).toEqual({
      reason: ko.toolInput,
      cause: `${ko.truncated} ${ko.malformed}`,
      next: ko.keptChanges,
      canContinue: true,
      code: 'tool-input: truncated 2, missing 1 (insert_table, unknown); 4 calls ran',
    })
    expect(runStopNotice(NOTHING_DONE, 'ko')).toEqual({
      reason: ko.toolInput,
      cause: ko.malformed,
      next: ko.unchanged,
      canContinue: false,
      code: 'tool-input: unparseable 3 (insert_paragraphs); 0 calls ran',
    })
  })

  it('has no cause line for the other two rules', () => {
    const en = AI_RUN_STOP_LABELS.en
    expect(runStopNotice({ kind: 'tool-errors', executed: 0, mutated: false }, 'en')).toEqual({
      reason: en.toolErrors,
      next: en.unchanged,
      canContinue: false,
      code: 'tool-errors; 0 calls ran',
    })
    expect(runStopNotice({ kind: 'repeating', executed: 1, mutated: true }, 'en')).toEqual({
      reason: en.repeating,
      next: en.keptChanges,
      canContinue: true,
      code: 'repeating; 1 call ran',
    })
  })

  it('is one text for a panel that shows a single message', () => {
    const ko = AI_RUN_STOP_LABELS.ko
    expect(runStopText(NOTHING_DONE, 'ko')).toBe(
      [ko.toolInput, ko.malformed, ko.unchanged, `(${runStopCode(NOTHING_DONE)})`].join('\n\n'),
    )
  })

  it('is written in every screen language, with the Continue button named in its sentence', () => {
    expect(Object.keys(AI_RUN_STOP_LABELS).sort()).toEqual([...LANGS].sort())
    const keys = Object.keys(AI_RUN_STOP_LABELS.en).sort()
    for (const lang of LANGS) {
      const labels = AI_RUN_STOP_LABELS[lang]
      expect(Object.keys(labels).sort()).toEqual(keys)
      for (const text of Object.values(labels)) expect(text.trim().length).toBeGreaterThan(0)
      expect(labels.keptChanges).toContain(labels.continueAction)
      if (lang === 'en') continue
      // a translation, not the English line
      for (const key of ['toolInput', 'truncated', 'malformed', 'unchanged'] as const) {
        expect(labels[key]).not.toBe(AI_RUN_STOP_LABELS.en[key])
      }
    }
  })
})

describe('what Continue tells the model', () => {
  it('says the document already holds part of the work and names the fault to avoid', () => {
    const note = runContinueNote(CUT_OFF)
    expect(note).toContain('not written by the person')
    expect(note).toContain('do only what is left')
    expect(note).toContain('Do not add again what is already there')
    expect(note).toContain('cut off by the output length limit')
    expect(note).toContain('malformed or incomplete')
    const plain = runContinueNote({ kind: 'repeating', executed: 2, mutated: true })
    expect(plain).toContain('do only what is left')
    expect(plain).not.toContain('cut off')
    expect(plain).not.toContain('malformed')
  })
})

describe('the notice in a panel', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  const render = (stop: AgentRunStop, onContinue?: () => void): void =>
    act(() => root.render(createElement(AiRunStopNotice, { stop, lang: 'ko', onContinue })))

  it('offers Continue for a run that had changed the document', () => {
    const onContinue = vi.fn()
    render(CUT_OFF, onContinue)
    const ko = AI_RUN_STOP_LABELS.ko
    expect(host.querySelector('[data-stop="tool-input"]')).not.toBeNull()
    expect(host.querySelector('.ai-sub-blocked-reason')!.textContent).toBe(ko.toolInput)
    expect(host.querySelector('[data-note="code"]')!.textContent).toBe(runStopCode(CUT_OFF))
    const button = host.querySelector<HTMLButtonElement>('[data-action="continue-run"]')!
    expect(button.textContent).toBe(ko.continueAction)
    act(() => button.click())
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('has no button when nothing was changed, or where going on is not offered', () => {
    render(NOTHING_DONE, vi.fn())
    expect(host.querySelector('[data-action="continue-run"]')).toBeNull()
    expect(host.querySelector('[data-note="next"]')!.textContent).toBe(
      AI_RUN_STOP_LABELS.ko.unchanged,
    )
    render(CUT_OFF)
    expect(host.querySelector('[data-action="continue-run"]')).toBeNull()
  })
})
