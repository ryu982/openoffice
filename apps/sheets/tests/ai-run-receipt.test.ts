/**
 * The changes card's revert guard: which Univer undo entries a run pushed,
 * whether the card may undo them now, and what state the card shows.
 */
import { describe, expect, it } from 'vitest'

import {
  UNIVER_UNDO_CAPACITY,
  adapterRevertVerdict,
  joinUndoGuards,
  planChangeLines,
  receiptState,
  statusAfterRevert,
  univerApplyGuard,
  univerRevertOutcome,
  univerRevertVerdict,
} from '../src/renderer/ai/ai-run-receipt'

const entries = (count: number, tag: string) =>
  Array.from({ length: count }, (_, index) => ({ tag: `${tag}${index}` }))

describe('univerApplyGuard', () => {
  it('counts the entries pushed above the old newest one', () => {
    const user = entries(3, 'u')
    const ai = entries(2, 'a')
    const guard = univerApplyGuard(user, [...user, ...ai])
    expect(guard).toEqual({ kind: 'univer', base: user[2], top: ai[1], steps: 2, complete: true })
  })

  it('takes every entry of an empty stack as the run’s', () => {
    const ai = entries(4, 'a')
    expect(univerApplyGuard([], ai)).toMatchObject({ base: null, steps: 4, complete: true })
  })

  it('is incomplete when the run filled the stack and its first entries may have fallen out', () => {
    const user = entries(15, 'u')
    const ai = entries(10, 'a')
    // Univer keeps the newest 20: the oldest five user entries and nothing of the AI's went
    const after = [...user, ...ai].slice(-UNIVER_UNDO_CAPACITY)
    expect(univerApplyGuard(user, after).complete).toBe(true)
    const pushedOut = entries(25, 'a').slice(-UNIVER_UNDO_CAPACITY)
    expect(univerApplyGuard(user, pushedOut).complete).toBe(false)
    expect(univerApplyGuard([], entries(UNIVER_UNDO_CAPACITY, 'a')).complete).toBe(false)
  })

  it('counts nothing when the undo budget dropped the batch', () => {
    const user = entries(2, 'u')
    expect(univerApplyGuard(user, user)).toMatchObject({ steps: 0, complete: true })
  })
})

describe('joinUndoGuards', () => {
  it('adds up the applies of one run that sit one on another', () => {
    const user = entries(1, 'u')
    const first = entries(2, 'a')
    const second = entries(3, 'b')
    const a = univerApplyGuard(user, [...user, ...first])
    const b = univerApplyGuard([...user, ...first], [...user, ...first, ...second])
    expect(joinUndoGuards(a, b)).toEqual({
      kind: 'univer',
      base: user[0],
      top: second[2],
      steps: 5,
      complete: true,
    })
  })

  it('is incomplete when something else landed between two applies', () => {
    const user = entries(1, 'u')
    const first = entries(1, 'a')
    const between = entries(1, 'x')
    const second = entries(1, 'b')
    const a = univerApplyGuard(user, [...user, ...first])
    const b = univerApplyGuard(
      [...user, ...first, ...between],
      [...user, ...first, ...between, ...second],
    )
    expect(joinUndoGuards(a, b)).toMatchObject({ complete: false })
  })

  it('adds adapter steps and keeps the newest revision', () => {
    expect(
      joinUndoGuards(
        { kind: 'adapter', revision: 3, steps: 1 },
        { kind: 'adapter', revision: 5, steps: 2 },
      ),
    ).toEqual({ kind: 'adapter', revision: 5, steps: 3 })
  })
})

describe('univerRevertVerdict and univerRevertOutcome', () => {
  const user = entries(2, 'u')
  const ai = entries(2, 'a')
  const guard = univerApplyGuard(user, [...user, ...ai])

  it('lets the card undo while the run’s newest entry is the newest', () => {
    expect(univerRevertVerdict(guard, [...user, ...ai])).toBe('ok')
  })

  it('refuses after an edit since the run', () => {
    expect(univerRevertVerdict(guard, [...user, ...ai, { tag: 'edit' }])).toBe('refused')
  })

  it('has expired once the run’s entries are gone (a save swapped the session, ⌘Z undid them)', () => {
    expect(univerRevertVerdict(guard, user)).toBe('expired')
    expect(univerRevertVerdict(guard, [{ tag: 'carried' }])).toBe('expired')
    expect(univerRevertVerdict({ ...guard, complete: false }, [...user, ...ai])).toBe('expired')
    expect(univerRevertVerdict({ ...guard, steps: 0 }, [...user, ...ai])).toBe('expired')
  })

  it('reports a full revert only when the entry under the run is the newest again', () => {
    expect(univerRevertOutcome(guard, user)).toBe('reverted')
    expect(univerRevertOutcome(guard, [...user, ai[0]])).toBe('partial')
    const fromEmpty = univerApplyGuard([], ai)
    expect(univerRevertOutcome(fromEmpty, [])).toBe('reverted')
  })
})

describe('adapterRevertVerdict', () => {
  const guard = { kind: 'adapter', revision: 4, steps: 1 } as const
  it('needs the same revision and no grid edit since', () => {
    expect(adapterRevertVerdict(guard, 4, 0)).toBe('ok')
    expect(adapterRevertVerdict(guard, 5, 0)).toBe('refused')
    expect(adapterRevertVerdict(guard, 4, 1)).toBe('refused')
    expect(adapterRevertVerdict({ ...guard, steps: 0 }, 4, 0)).toBe('expired')
  })
})

describe('receiptState', () => {
  it('maps a receipt to the card state', () => {
    const guard = { kind: 'adapter', revision: 1, steps: 1 } as const
    expect(receiptState({ opCount: 3, undoSteps: 1, guard })).toBe('applied')
    // over the undo budget: no entry to go back to
    expect(receiptState({ opCount: 3, undoSteps: 0 })).toBe('expired')
    expect(
      receiptState({
        opCount: 3,
        undoSteps: 2,
        guard: { kind: 'univer', base: null, top: {}, steps: 2, complete: false },
      }),
    ).toBe('expired')
    for (const state of ['reverted', 'partial', 'refused', 'expired'] as const) {
      expect(receiptState({ opCount: 3, undoSteps: 1, guard, state })).toBe(state)
    }
  })
})

describe('statusAfterRevert', () => {
  it('replaces only the notice that offered undo for the run', () => {
    expect(
      statusAfterRevert('applied, undo with Ctrl+Z', 'applied, undo with Ctrl+Z', 'undone'),
    ).toBe('undone')
    expect(statusAfterRevert('saved', 'applied, undo with Ctrl+Z', 'undone')).toBe('saved')
  })
})

describe('planChangeLines', () => {
  it('builds clickable sheetnav lines from applied cell, format, and rename changes', () => {
    const lines = planChangeLines(
      {
        cellChanges: [
          {
            sheetId: 's1',
            address: 'B2',
            before: { value: null },
            after: { value: 42 },
          },
        ],
        formatChanges: [{ sheetId: 's1', range: 'A1:C1', label: 'Bold header', format: {} }],
        structuralChanges: [],
        sheetRenames: [{ sheetId: 's1', before: 'Sheet1', after: 'Summary' }],
      },
      (id) => (id === 's1' ? 'Summary' : undefined),
    )
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ kind: 'replace', from: 'Sheet1', to: 'Summary', showable: true })
    expect(lines[1]).toMatchObject({ kind: 'named', from: 'Summary!A1:C1', showable: true })
    expect(lines[2]).toMatchObject({ kind: 'insert', to: 'Summary!B2 = 42', showable: true })
    expect(lines[2]!.navHref).toBe('sheetnav://Summary!B2')
  })
})
