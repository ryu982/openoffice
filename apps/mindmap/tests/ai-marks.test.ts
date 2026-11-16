/**
 * The marks on the topics the last AI run added or changed, and the runs
 * behind the cards under the chat. The marks are drawn topics' class only:
 * the file, the node data and every export copy stay unmarked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MapController } from '../src/renderer/map/controller'
import { AI_MARK_CLASS } from '../src/renderer/map/ai-marks'
import { DocumentSession } from '../src/renderer/document/session'
import { mapStrings } from '../src/renderer/i18n/map-strings'
import { copyDrawing } from '../src/renderer/export/snapshot'
import { snapshotPage, snapshotSvg } from '../src/renderer/export/render'
import {
  addRun,
  KEPT_RUNS,
  revertChain,
  revertsLater,
  type RunChange,
  settleRuns,
} from '../src/renderer/ai/run-changes'
import { documentOf, plainSheet } from './helpers/fixtures'

const ONE = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const TWO = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'

const mounted: MapController[] = []
afterEach(() => {
  mounted.splice(0).forEach((controller) => controller.destroy())
  document.body.innerHTML = ''
})

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function mount() {
  const doc = await documentOf(plainSheet())
  const original = await doc.save()
  const session = new DocumentSession(doc)
  const el = document.createElement('div')
  document.body.appendChild(el)
  const controller = new MapController({
    el,
    session,
    sheetKey: session.tabs()[0]!.key,
    strings: mapStrings('en'),
    host: {
      confirmDelete: vi.fn(async () => true),
      openLink: vi.fn(),
      onRequest: vi.fn(),
      onStateChange: vi.fn(),
    },
  })
  mounted.push(controller)
  await settle()
  const marked = (): string[] =>
    [...el.querySelectorAll<HTMLElement>(`me-tpc.${AI_MARK_CLASS}`)].map((topic) =>
      topic.dataset.nodeid!.slice(2),
    )
  return { doc, original, session, el, controller, marked }
}

describe('the marks on the map', () => {
  it('go on the named topics, stay through a new drawing, and come off', async () => {
    const { controller, marked } = await mount()
    controller.setAiMarks([ONE])
    expect(marked()).toEqual([ONE])
    // the library draws the topics anew; the marks come back with them
    controller.mind.refresh()
    await settle()
    expect(marked()).toEqual([ONE])
    controller.setAiMarks([ONE, TWO])
    expect(marked().sort()).toEqual([ONE, TWO].sort())
    controller.setAiMarks([])
    expect(marked()).toEqual([])
  })

  it('never reach the file, the node data or an export', async () => {
    const { doc, original, session, controller, marked } = await mount()
    controller.setAiMarks([ONE, TWO])
    expect(marked()).toHaveLength(2)
    controller.flush()
    // nothing changed: the save is the original bytes, and the drawing data knows no mark
    expect(session.dirty).toBe(false)
    expect(await doc.save()).toEqual(original)
    expect(controller.mind.getDataString()).not.toContain(AI_MARK_CLASS)

    const snapshot = await copyDrawing(
      { mind: controller.mind, readEntry: (name) => doc.readEntry(name) },
      { left: 0, top: 0, width: 400, height: 300 },
    )
    expect(snapshot.element.outerHTML).not.toContain(AI_MARK_CLASS)
    expect(snapshotPage(snapshot)).not.toContain(AI_MARK_CLASS)
    expect(snapshotSvg(snapshot, 1)).not.toContain(AI_MARK_CLASS)
    // the screen keeps them
    expect(marked()).toHaveLength(2)
  })
})

describe('the runs behind the cards', () => {
  const run = (id: number, state: RunChange<string>['state'] = 'applied'): RunChange<string> => ({
    id,
    point: state === 'applied' ? `p${id}` : null,
    state,
    count: id,
  })

  it('keeps the undo points of the newest runs only; the older ones expire', () => {
    let runs: RunChange<string>[] = []
    for (let id = 1; id <= KEPT_RUNS + 2; id++) runs = addRun(runs, run(id))
    expect(runs.slice(0, 2).map((each) => [each.state, each.point])).toEqual([
      ['expired', null],
      ['expired', null],
    ])
    expect(runs.slice(2).every((each) => each.state === 'applied' && each.point !== null)).toBe(
      true,
    )
    // an expired card keeps its count
    expect(runs[0]!.count).toBe(1)
  })

  it('a reverted run does not hold a place among the kept ones', () => {
    let runs: RunChange<string>[] = [run(1), run(2, 'reverted')]
    for (let id = 3; id <= KEPT_RUNS + 1; id++) runs = addRun(runs, run(id))
    expect(runs[0]!.state).toBe('applied')
    runs = addRun(runs, run(KEPT_RUNS + 2))
    expect(runs[0]!.state).toBe('expired')
  })

  it('reverting a run takes the later applied ones back first, and marks each with its outcome', () => {
    const runs = [run(1), run(2), run(3, 'reverted'), run(4)]
    expect(revertChain(runs, 2).map((each) => each.id)).toEqual([4, 2])
    expect(revertsLater(runs, 2)).toBe(true)
    expect(revertsLater(runs, 4)).toBe(false)
    const settled = settleRuns(
      runs,
      new Map([
        [4, 'reverted'],
        [2, 'partial'],
      ]),
    )
    expect(settled.map((each) => each.state)).toEqual([
      'applied',
      'partial',
      'reverted',
      'reverted',
    ])
    expect(settled.map((each) => each.point)).toEqual(['p1', null, null, null])
    expect(revertsLater(settled, 1)).toBe(false)
  })
})
