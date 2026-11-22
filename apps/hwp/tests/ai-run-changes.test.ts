import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  hwpChangeCount,
  hwpChangeLine,
  revertableIndex,
  undoOutcome,
} from '../src/renderer/ai/run-changes'
import type { HwpChange } from '../src/renderer/ai/hwp-skill'

const place = { section: 0, para: 1, start: 0, end: 2 } as unknown as NonNullable<
  HwpChange['place']
>

describe("a run's changes on the shared card", () => {
  it('lines up each kind of change as the card writes it', () => {
    const items: HwpChange[] = [
      { kind: 'insert', from: '', to: '새 문단', count: 1, place },
      { kind: 'table', from: '', to: '이름 | 점수', count: 1, place },
      { kind: 'image', from: '', to: '그림', count: 1 },
      { kind: 'delete', from: '지운 문단', to: '', count: 1 },
      { kind: 'replace', from: '홍길동', to: '김철수', count: 1, place },
      { kind: 'replaceAll', from: '가', to: '나', count: 3, place },
      { kind: 'field', from: '성명', to: '김철수', count: 1, place },
      { kind: 'format', from: '제목', to: '굵게', count: 1, place },
      { kind: 'cells', from: '표 1', to: '1, 2', count: 2, place },
      { kind: 'lines', from: '표 1', to: '행 2개 추가', count: 2, place },
      { kind: 'note', from: '각주 1', to: '출처', count: 1, place },
    ]
    expect(items.map(hwpChangeLine)).toEqual([
      { kind: 'insert', to: '새 문단', showable: true },
      { kind: 'insert', to: '이름 | 점수', glyph: '▦', showable: true },
      { kind: 'insert', to: '그림', glyph: '▣', showable: false },
      { kind: 'delete', from: '지운 문단', showable: false },
      { kind: 'replace', from: '홍길동', to: '김철수', count: 1, showable: true },
      { kind: 'replace', from: '가', to: '나', count: 3, showable: true },
      { kind: 'named', from: '성명', to: '김철수', count: 1, showable: true },
      { kind: 'named', from: '제목', to: '굵게', count: 1, showable: true },
      { kind: 'named', from: '표 1', to: '1, 2', count: 2, showable: true },
      { kind: 'named', from: '표 1', to: '행 2개 추가', count: 2, showable: true },
      { kind: 'named', from: '각주 1', to: '출처', count: 1, showable: true },
    ])
    expect(hwpChangeCount(items)).toBe(15)
  })

  it('names what an undo left: all taken back, part of it, or nothing', () => {
    expect(undoOutcome({ ok: true, undone: 3 })).toBe('reverted')
    expect(undoOutcome({ ok: false, undone: 2 })).toBe('partial')
    expect(undoOutcome({ ok: false, undone: 0 })).toBe('refused')
    // the call itself failed
    expect(undoOutcome(null)).toBe('refused')
  })

  it('offers only the newest run still in the document, and none under one that was not taken back whole', () => {
    expect(revertableIndex([undefined, 'applied', undefined, 'applied', undefined])).toBe(3)
    expect(revertableIndex([undefined, 'applied', 'reverted'])).toBe(1)
    expect(revertableIndex(['applied', 'refused'])).toBe(-1)
    expect(revertableIndex(['applied', 'partial'])).toBe(-1)
    expect(revertableIndex(['reverted', 'reverted'])).toBe(-1)
    expect(revertableIndex([])).toBe(-1)
  })
})

describe('the card in the Hangul AI panel', () => {
  const panel = readFileSync(join(__dirname, '..', 'src/renderer/ai/AiPanel.tsx'), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')

  it('is the shared card, with the marks button only while the pages carry marks', () => {
    expect(panel).toContain('<AiChangesCard lang={lang} state={entry.changes.state}')
    expect(panel).toContain('onClearMarks={i === revertableIdx && marksShown ? clearMarks : null}')
    expect(panel).not.toContain('RunChangesCard')
  })

  it('drops the marks button once the plugin says the pages carry none, without asking it', () => {
    expect(panel).toContain('if (!marksOnPage) setMarksShown(false)')
    // a run that only removed things marked nothing: no button for it
    expect(panel).toContain('setMarksShown(marksOnPageRef.current)')
    expect(panel).not.toContain('hasMarks')
  })

  it('follows a run with the caret, never a selection that would cover the last mark', () => {
    expect(panel).toContain('void bridgeRef.current.reveal({ ...change.place, length: 0 })')
  })
})
