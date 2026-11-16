/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import {
  AiChangesCard,
  aiChangesLabels,
  aiChangesNote,
  aiChangesTitle,
  type AiChangeLine,
} from '../src/AiChangesCard'
import { AI_CHANGES_LABELS } from '../src/strings-ai-changes'

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

const render = (props: Parameters<typeof AiChangesCard>[0]): void =>
  act(() => root.render(createElement(AiChangesCard, props)))

describe('AI_CHANGES_LABELS', () => {
  it('fills every label in every UI language, not copied from English', () => {
    expect(Object.keys(AI_CHANGES_LABELS).sort()).toEqual([...LANGS].sort())
    const keys = Object.keys(AI_CHANGES_LABELS.en).sort()
    for (const lang of LANGS) {
      const labels = AI_CHANGES_LABELS[lang]
      expect(Object.keys(labels).sort(), lang).toEqual(keys)
      expect(labels.changedCount(3), lang).toContain('3')
      for (const key of keys) {
        const value = (labels as unknown as Record<string, unknown>)[key]
        if (typeof value !== 'string') continue
        expect(value.trim().length, `${lang}.${key}`).toBeGreaterThan(0)
        if (lang !== 'en')
          expect(value, `${lang}.${key}`).not.toBe(
            (AI_CHANGES_LABELS.en as unknown as Record<string, string>)[key],
          )
      }
    }
  })

  it('names the undo key of the platform in the notes', () => {
    expect(aiChangesLabels('ko', false).refused).toContain('Ctrl+Z')
    expect(aiChangesLabels('ko', true).refused).toContain('⌘Z')
    expect(aiChangesLabels('ko', true).expired).not.toContain('Ctrl+Z')
  })
})

describe('title and note', () => {
  const ko = aiChangesLabels('ko', false)
  it('counts the places, or says the document was changed', () => {
    expect(aiChangesTitle(ko, 'applied', 4)).toBe('문서 4곳을 고쳤습니다')
    expect(aiChangesTitle(ko, 'applied', undefined)).toBe('문서를 고쳤습니다')
    expect(aiChangesTitle(ko, 'refused', 2)).toBe('문서 2곳을 고쳤습니다')
    expect(aiChangesTitle(ko, 'reverted', 4)).toBe('되돌렸습니다')
    expect(aiChangesTitle(ko, 'partial', 4)).toBe('되돌렸습니다')
  })
  it('adds a note only where the state needs one', () => {
    expect(aiChangesNote(ko, 'applied')).toBeNull()
    expect(aiChangesNote(ko, 'reverted')).toBeNull()
    expect(aiChangesNote(ko, 'refused')).toBe(ko.refused)
    expect(aiChangesNote(ko, 'expired')).toBe(ko.expired)
    expect(aiChangesNote(ko, 'partial')).toBe(ko.partial)
  })
})

describe('AiChangesCard', () => {
  const lines: AiChangeLine[] = [
    { kind: 'replace', from: '사과', to: '배', count: 3, showable: true },
    { kind: 'insert', to: '새 문단', glyph: '▦' },
    { kind: 'delete', from: '지운 글', showable: true },
    { kind: 'named', from: '굵게', to: '켬' },
  ]

  it('shows the count, both buttons and the lines of an applied run', () => {
    const onRevert = vi.fn()
    const onClearMarks = vi.fn()
    const onShowLine = vi.fn()
    render({
      lang: 'ko',
      state: 'applied',
      count: 6,
      lines,
      canRevert: true,
      onRevert,
      onClearMarks,
      onShowLine,
    })
    expect(host.querySelector('.ai-run-changes-title')?.textContent).toBe('문서 6곳을 고쳤습니다')
    host.querySelector<HTMLButtonElement>('[data-action="ai-changes-unmark"]')!.click()
    host.querySelector<HTMLButtonElement>('[data-action="ai-changes-revert"]')!.click()
    expect(onClearMarks).toHaveBeenCalledOnce()
    expect(onRevert).toHaveBeenCalledOnce()
    const go = host.querySelectorAll<HTMLButtonElement>('.ai-run-change-go')
    expect(go).toHaveLength(2)
    go[1]!.click()
    expect(onShowLine).toHaveBeenCalledWith(2)
    expect(host.querySelector('.ai-run-change-count')?.textContent).toBe('×3')
    expect(host.textContent).toContain('+ ▦')
    expect(host.querySelector('.ai-run-change-name')?.textContent).toBe('굵게')
    expect(host.querySelector('.ai-run-changes-note')).toBeNull()
  })

  it('disables the revert button while it cannot work, and says when later runs go too', () => {
    render({
      lang: 'en',
      state: 'applied',
      canRevert: false,
      revertsLater: true,
      onRevert: () => {},
    })
    const revert = host.querySelector<HTMLButtonElement>('[data-action="ai-changes-revert"]')!
    expect(revert.disabled).toBe(true)
    expect(revert.title).toBe(AI_CHANGES_LABELS.en.revertLaterTitle)
    expect(host.querySelector('[data-action="ai-changes-unmark"]')).toBeNull()
    expect(host.querySelector('.ai-run-changes-list')).toBeNull()
  })

  it('drops the buttons and the place links once the run is taken back', () => {
    render({
      lang: 'ko',
      state: 'reverted',
      count: 6,
      lines,
      canRevert: true,
      onRevert: () => {},
      onClearMarks: () => {},
      onShowLine: () => {},
    })
    expect(host.querySelector('.ai-run-changes-title')?.textContent).toBe('되돌렸습니다')
    expect(host.querySelector('button')).toBeNull()
    expect(host.querySelectorAll('.ai-run-change')).toHaveLength(4)
  })

  it('explains a run it cannot take back', () => {
    render({ lang: 'ko', state: 'expired', count: 2, canRevert: false, onRevert: () => {} })
    expect(host.querySelector('[data-action="ai-changes-revert"]')).toBeNull()
    expect(host.querySelector('.ai-run-changes-note')?.textContent).toContain('실행 취소')
  })
})
