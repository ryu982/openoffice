/**
 * The slides AI run's receipt and marks: what changed is read by diffing the
 * deck before and after the run; the card's states follow the rollback ring.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { RenderNode, RenderSlide } from '@genoffice/pptx-render'
import {
  deckChanges,
  deckFingerprint,
  markedNodeIds,
  markRolledBack,
  markUnrevertable,
  revertsLater,
  type RunChanges,
} from '../src/renderer/ai/run-changes'

function node(
  durableId: string,
  sourceId: string,
  extra: Record<string, unknown> = {},
): RenderNode {
  return {
    id: `n-${sourceId}`,
    type: 'shape',
    sourceId,
    durableId,
    box: { x: 10, y: 10, w: 100, h: 50, rotationDeg: 0 },
    ...extra,
  } as unknown as RenderNode
}

function slide(partPath: string, nodes: RenderNode[], extra: Record<string, unknown> = {}) {
  return {
    widthPx: 960,
    heightPx: 540,
    scale: 1,
    background: { kind: 'solid', color: '#ffffff' },
    nodes,
    partPath,
    ...extra,
  } as unknown as RenderSlide
}

describe('deckChanges', () => {
  it('marks changed and added elements, counts removed ones, and leaves untouched slides out', () => {
    const before = [
      slide('s1.xml', [node('e_1', '1', { fill: 'a' }), node('e_2', '2'), node('e_3', '3')]),
      slide('s2.xml', [node('e_4', '4')]),
    ]
    const after = [
      // e_1 recoloured, e_3 removed, e_5 added
      slide('s1.xml', [node('e_1', '1', { fill: 'b' }), node('e_2', '2'), node('e_5', '5')]),
      slide('s2.xml', [node('e_4', '4')]),
    ]
    const { marks, count } = deckChanges(deckFingerprint(before), after)
    expect(count).toBe(3)
    expect([...marks.keys()]).toEqual(['s1.xml'])
    expect([...marks.get('s1.xml')!].sort()).toEqual(['e_1', 'e_5'])
    expect(markedNodeIds(after[0], 0, marks).sort()).toEqual(['1', '5'])
    expect(markedNodeIds(after[1], 1, marks)).toEqual([])
  })

  it('ignores parse ids: a reparse that renumbers every element changes nothing', () => {
    const before = [slide('s1.xml', [node('e_1', '1'), node('e_2', '2')])]
    const after = [slide('s1.xml', [node('e_1', '91'), node('e_2', '92')])]
    const { marks, count } = deckChanges(deckFingerprint(before), after)
    expect(count).toBe(0)
    expect(marks.size).toBe(0)
  })

  it('counts an element once when its first edit reissued its durable id', () => {
    // the engine gives an edited element a creation id: e_3 becomes e_5ef01f3a, parse id kept
    const before = [slide('s1.xml', [node('e_2', 'sp_0'), node('e_3', 'sp_1', { text: 'old' })])]
    const after = [
      slide('s1.xml', [node('e_2', 'sp_0'), node('e_5ef01f3a', 'sp_1', { text: 'new' })]),
    ]
    const { marks, count } = deckChanges(deckFingerprint(before), after)
    expect(count).toBe(1)
    expect([...marks.get('s1.xml')!]).toEqual(['e_5ef01f3a'])
  })

  it('a new slide is marked with all its elements; a removed slide counts once', () => {
    const before = [slide('s1.xml', [node('e_1', '1')]), slide('s2.xml', [node('e_2', '2')])]
    const after = [slide('s1.xml', [node('e_1', '1')]), slide('s3.xml', [node('e_7', '7')])]
    const { marks, count } = deckChanges(deckFingerprint(before), after)
    expect(count).toBe(2)
    expect([...marks.get('s3.xml')!]).toEqual(['e_7'])
    expect(marks.has('s2.xml')).toBe(false)
  })

  it('a slide-level change (background) marks the thumbnail without element marks', () => {
    const before = [slide('s1.xml', [node('e_1', '1')])]
    const after = [
      slide('s1.xml', [node('e_1', '1')], { background: { kind: 'solid', color: '#000000' } }),
    ]
    const { marks } = deckChanges(deckFingerprint(before), after)
    expect(marks.get('s1.xml')?.size).toBe(0)
    expect(markedNodeIds(after[0], 0, marks)).toEqual([])
  })

  it('reads a swapped picture even when its data URL is long', () => {
    const big = (tail: string) => `data:image/png;base64,${'A'.repeat(4000)}${tail}`
    const before = [slide('s1.xml', [node('e_1', '1', { dataUrl: big('xx') })])]
    const after = [slide('s1.xml', [node('e_1', '1', { dataUrl: big('yy') })])]
    expect(deckChanges(deckFingerprint(before), after).count).toBe(1)
  })

  it('decoration (master/layout) nodes are never marked', () => {
    const before = [slide('s1.xml', [])]
    const after = [slide('s1.xml', [node('e_9', '9', { decoration: true })])]
    const { marks, count } = deckChanges(deckFingerprint(before), after)
    expect(count).toBe(0)
    expect(marks.size).toBe(0)
  })
})

describe('card states', () => {
  const entry = (snapshotId: number, state: RunChanges['state'] = 'applied') => ({
    changes: { snapshotId, state },
  })

  it('rolling back an older run takes the later applied runs back too', () => {
    const chat: Array<{ changes?: RunChanges }> = [entry(3), {}, entry(5), entry(7, 'expired')]
    expect(revertsLater(chat, 3)).toBe(true)
    expect(revertsLater(chat, 5)).toBe(false)
    const next = markRolledBack(chat, 3)
    expect(next.map((e) => e.changes?.state ?? null)).toEqual([
      'reverted',
      null,
      'reverted',
      'expired',
    ])
  })

  it('an earlier run stays applied when a later one is rolled back', () => {
    const next = markRolledBack([entry(3), entry(5)], 5)
    expect(next.map((e) => e.changes.state)).toEqual(['applied', 'reverted'])
  })

  it('a point gone from the ring turns its card expired, and only that card', () => {
    const next = markUnrevertable([entry(3), entry(5)], new Set([3]), 'expired')
    expect(next.map((e) => e.changes.state)).toEqual(['expired', 'applied'])
  })
})

describe('marks stay on the screen', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

  it('only the edit canvas and the thumbnail list draw them', () => {
    for (const path of [
      '../src/renderer/SlideThumb.tsx',
      '../src/renderer/export-render.tsx',
      '../src/renderer/export-svg.ts',
      '../src/renderer/components/SlideShowView.tsx',
      '../src/renderer/components/PresenterView.tsx',
      '../src/renderer/NodeBody.tsx',
    ]) {
      expect(read(path)).not.toMatch(/aiMarkedIds|AiChangedMarks|thumb-ai-changed|aiChangedMark/)
    }
    expect(read('../src/renderer/SlideCanvas.tsx')).toMatch(
      /listening=\{false\}>\s*<AiChangedMarks/,
    )
  })
})
