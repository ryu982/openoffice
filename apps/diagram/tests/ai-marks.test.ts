// The marks around the cells the last AI run changed: which cells a call
// changed, what a run marks and counts, the colours handed to draw.io, and the
// bridge's marks, drawn for the page on screen only and never a change.
import { describe, expect, it, vi } from 'vitest'
import {
  cellChangesOf,
  parseMarkColor,
  RunCellChanges,
  type DiagramCellChanges,
} from '../src/shared/ai-marks'
import { createCellMarks, type CellMarkHost } from '../src/bridge/ai-marks'
import { parseBridgeMessage } from '../src/shared/bridge-protocol'

const cell = (id: string) => ({
  id,
  parent: '1',
  value: '',
  style: '',
  kind: 'vertex' as const,
  geometry: { x: 0, y: 0, width: 10, height: 10 },
})

describe('the cells a call changed', () => {
  it('reads them off the steps and the ids each step made', () => {
    const changes = cellChangesOf(
      [
        {
          kind: 'primitives',
          primitives: [
            { kind: 'add_page', id: 'p9', name: 'New' },
            { kind: 'add_cell', page: 'p9', cell: cell('planned') },
            { kind: 'update_cell', page: 'p1', id: 'a', value: 'x' },
            { kind: 'remove_cells', page: 'p1', ids: ['b', 'e'] },
            { kind: 'rename_page', page: 'p1', name: 'Renamed' },
          ],
        },
        { kind: 'mermaid', page: 'p1', xml: '<mxGraphModel/>', x: 0, y: 0 },
        { kind: 'primitives', primitives: [{ kind: 'remove_page', page: 'p2' }] },
      ],
      [['p9', 'real'], ['m1', 'm2'], []],
    )
    expect(changes).toEqual({
      // a new cell has the id draw.io gave it
      added: [
        { page: 'p9', id: 'real' },
        { page: 'p1', id: 'm1' },
        { page: 'p1', id: 'm2' },
      ],
      updated: [{ page: 'p1', id: 'a' }],
      removed: [
        { page: 'p1', id: 'b' },
        { page: 'p1', id: 'e' },
      ],
      removedPages: ['p2'],
    })
  })
})

describe('what a run marks and counts', () => {
  const none: DiagramCellChanges = { added: [], updated: [], removed: [], removedPages: [] }

  it('marks what it added or changed; a cell it added and removed again is neither', () => {
    const run = new RunCellChanges()
    run.add({
      ...none,
      added: [
        { page: 'p1', id: 'n' },
        { page: 'p1', id: 'm' },
      ],
    })
    run.add({
      ...none,
      updated: [
        { page: 'p1', id: 'a' },
        { page: 'p1', id: 'n' },
      ],
    })
    expect(run.marked().map((c) => c.id)).toEqual(['n', 'm', 'a'])
    expect(run.count).toBe(3)
    run.add({
      ...none,
      removed: [
        { page: 'p1', id: 'n' },
        { page: 'p1', id: 'a' },
      ],
    })
    // n came and went; a was there before, so its removal is a change
    expect(run.marked().map((c) => c.id)).toEqual(['m'])
    expect(run.count).toBe(2)
    // a page removed takes its cells with it
    run.add({ ...none, added: [{ page: 'p2', id: 'q' }] })
    run.add({ ...none, removedPages: ['p2'] })
    expect(run.marked().map((c) => c.id)).toEqual(['m'])
    expect(run.count).toBe(2)
    // the same id on another page is another cell
    run.add({ ...none, updated: [{ page: 'p3', id: 'm' }] })
    expect(run.count).toBe(3)
  })
})

describe('the mark colours', () => {
  it('reads the tokens as draw.io colours with an opacity', () => {
    expect(parseMarkColor('rgb(255 193 7 / 24%)')).toEqual({ color: '#ffc107', opacity: 24 })
    expect(parseMarkColor(' rgba(214, 140, 0, 0.85) ')).toEqual({ color: '#d68c00', opacity: 85 })
    expect(parseMarkColor('rgb(240 176 48)')).toEqual({ color: '#f0b030', opacity: 100 })
    expect(parseMarkColor('#FFC107')).toEqual({ color: '#ffc107', opacity: 100 })
    expect(parseMarkColor('#ffc10780')).toEqual({ color: '#ffc107', opacity: 50 })
    for (const bad of ['', 'yellow', 'url(x)', 'rgb(1 2)', 'var(--x)']) {
      expect(parseMarkColor(bad), bad).toBeNull()
    }
  })
})

describe('the marks in the frame', () => {
  function frame(page = 'p1') {
    const live = new Map<string, () => void>()
    const host: CellMarkHost & { page: string } = {
      page,
      currentPageId: () => host.page,
      stateOf: (id) => (id === 'gone' ? null : { id }),
      draw: vi.fn((state: unknown) => {
        const id = (state as { id: string }).id
        const remove = vi.fn(() => void live.delete(id))
        live.set(id, remove)
        return remove
      }),
    }
    return { host, live, marks: createCellMarks(host) }
  }
  const FILL = 'rgb(255 193 7 / 24%)'
  const LINE = 'rgb(214 140 0 / 85%)'

  it('draws the page on screen only, again when a page comes on screen, and takes them off', () => {
    const { host, live, marks } = frame()
    const cells = [
      { page: 'p1', id: 'a' },
      { page: 'p1', id: 'gone' },
      { page: 'p2', id: 'c' },
    ]
    marks.set(cells, FILL, LINE)
    expect([...live.keys()]).toEqual(['a'])
    expect(host.draw).toHaveBeenCalledWith(
      { id: 'a' },
      { fill: { color: '#ffc107', opacity: 24 }, line: { color: '#d68c00', opacity: 85 } },
    )
    host.page = 'p2'
    marks.redraw()
    expect([...live.keys()]).toEqual(['c'])
    marks.set([], FILL, LINE)
    expect(live.size).toBe(0)
  })

  it('draws nothing without colours it can read', () => {
    const { live, marks } = frame()
    marks.set([{ page: 'p1', id: 'a' }], '', '')
    expect(live.size).toBe(0)
  })

  it('is a request the bridge reads', () => {
    expect(
      parseBridgeMessage({
        ieum: 1,
        kind: 'request',
        id: '1',
        op: 'markCells',
        args: { cells: [], fill: FILL, line: LINE },
      }),
    ).not.toBeNull()
  })
})
