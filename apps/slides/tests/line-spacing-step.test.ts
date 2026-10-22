/**
 * Hangul's ⌥⇧Z / ⌥⇧A in the slide editor: the key mapping, the step, and the
 * main-process path that steps each selected element from its own first
 * paragraph and saves it as a:lnSpc.
 */
import { tmpdir } from 'node:os'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: never[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getName: () => 'slides-test',
    getVersion: () => '0',
    whenReady: () => Promise.resolve(),
  },
  dialog: {},
  clipboard: { writeBuffer: () => {} },
  ipcMain: {
    handle: (channel: string, fn: (...args: never[]) => unknown) => handlers.set(channel, fn),
    on: () => {},
    removeHandler: () => {},
  },
  BrowserWindow: class {},
  webContents: { getAllWebContents: () => [], fromId: () => null },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  session: { defaultSession: { protocol: {}, setDisplayMediaRequestHandler: () => {} } },
  nativeImage: {},
  shell: {},
  desktopCapturer: { getSources: async () => [] },
  WebContentsView: class {},
}))
// the shaping chain loads a harfbuzz wasm that cannot resolve in the unit-test env
vi.mock('../src/main/shaped-metrics', () => ({
  shapedMetricsReady: async () => {},
  refineComplexWidths: async () => {},
  complexScriptOf: () => null,
  initShapedMetrics: () => {},
  gtMeasure: (t: string) => ({ width: t.length * 8 }),
  shapedFamily: () => null,
  shapedMeasure: () => ({ width: 0 }),
}))

import JSZip from 'jszip'
import { createBlankPptx, openPptx, savePptx } from '@genoffice/pptx-engine'
import { runTxn } from '@genoffice/pptx-ops'
import { registerSlidesIpc } from '../src/main/slides-main'
import { sessions, type Session } from '../src/main/session-state'
import { formatStepForKey, lineSpacingPctOf, stepLineSpacingPct } from '../src/shared/format-step'

const WC = 1
const event = { sender: { id: WC } } as never

function ipc(channel: string, ...args: unknown[]): unknown {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return (fn as (...a: unknown[]) => unknown)(event, ...args)
}

const chord = (code: string, mods: Partial<KeyboardEventInit> = {}) =>
  formatStepForKey({
    code,
    altKey: true,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    ...mods,
  } as KeyboardEvent)

describe('formatStepForKey', () => {
  it('maps the four Hangul letters the slide editor takes', () => {
    expect(chord('KeyZ')).toEqual({ action: 'lineSpacing', dir: 1 })
    expect(chord('KeyA')).toEqual({ action: 'lineSpacing', dir: -1 })
    expect(chord('KeyE')).toEqual({ action: 'fontSize', dir: 1 })
    expect(chord('KeyR')).toEqual({ action: 'fontSize', dir: -1 })
  })

  it('reads the physical key and needs exactly Alt+Shift', () => {
    // ⌥⇧A types "Å" on a Mac; e.code stays KeyA
    const mac = new KeyboardEvent('keydown', {
      key: 'Å',
      code: 'KeyA',
      altKey: true,
      shiftKey: true,
    })
    expect(formatStepForKey(mac)).toEqual({ action: 'lineSpacing', dir: -1 })
    expect(chord('KeyZ', { shiftKey: false })).toBeNull()
    expect(chord('KeyZ', { ctrlKey: true })).toBeNull()
    expect(chord('KeyZ', { metaKey: true })).toBeNull()
    // character spacing is not offered here
    expect(chord('KeyW')).toBeNull()
    expect(chord('KeyN')).toBeNull()
  })
})

describe('line spacing step', () => {
  it('reads a percentage, and a fixed height or none as single', () => {
    expect(lineSpacingPctOf({ lineHeight: 150 })).toBe(150)
    expect(lineSpacingPctOf({ lineHeight: 150, lineExact: 24 })).toBe(100)
    expect(lineSpacingPctOf({})).toBe(100)
    expect(lineSpacingPctOf(undefined)).toBe(100)
  })

  it('moves a tenth of a line within the op range', () => {
    expect(stepLineSpacingPct(100, 1)).toBe(110)
    expect(stepLineSpacingPct(115, -1)).toBe(105)
    expect(stepLineSpacingPct(15, -1)).toBe(10)
    expect(stepLineSpacingPct(10, -1)).toBe(10)
    expect(stepLineSpacingPct(5, -1)).toBe(5)
    expect(stepLineSpacingPct(5, 1)).toBe(15)
    expect(stepLineSpacingPct(13195, 1)).toBe(13200)
  })
})

describe('slides:set-element-paragraph-format with lineSpacingStep', () => {
  let session: Session

  beforeAll(() => {
    registerSlidesIpc()
  })

  beforeEach(async () => {
    sessions.clear()
    session = {
      path: '',
      fitWidthPx: 1280,
      undoStack: [],
      redoStack: [],
      opened: await openPptx(await createBlankPptx()),
    }
    sessions.set(WC, session)
  })

  const addBox = (texts: string[]) => {
    const r = runTxn(session.opened, {
      ops: [
        {
          op: 'addElement',
          target: { slide: 0 },
          kind: 'textbox',
          offset: { x: 914400, y: 685800, cx: 7315200, cy: 1828800 },
          paragraphs: texts.map((text) => ({ runs: [{ text, fontSize: 24 }] })),
        },
      ],
    })
    expect(r.applied).toBe(true)
    const els = session.opened.deck.slides[0]!.elements
    return els[els.length - 1]!.id
  }

  const paragraphsOf = (id: string) =>
    (
      session.opened.deck.slides[0]!.elements.find((e) => e.id === id) as {
        text: { paragraphs: Array<{ lineHeight?: number }> }
      }
    ).text.paragraphs

  it('steps every paragraph from the first one and saves a:lnSpc', async () => {
    const id = addBox(['first', 'second'])
    expect(ipc('slides:get-line-spacing', 0, id)).toEqual([100, 100])

    for (const dir of [1, 1, -1] as const)
      expect(
        ipc('slides:set-element-paragraph-format', {
          slideIndex: 0,
          sourceIds: [id],
          lineSpacingStep: dir,
        }),
      ).not.toBeNull()

    expect(paragraphsOf(id).map((p) => p.lineHeight)).toEqual([110, 110])
    expect(ipc('slides:get-line-spacing', 0, id)).toEqual([110, 110])
    // one undo step per press
    expect(session.undoStack).toHaveLength(3)

    const zip = await JSZip.loadAsync(await savePptx(session.opened))
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string')
    expect(slideXml.match(/<a:lnSpc><a:spcPct val="110000"\/><\/a:lnSpc>/g)).toHaveLength(2)
  })

  it('steps each selected element from its own spacing', () => {
    const a = addBox(['a'])
    const b = addBox(['b'])
    ipc('slides:set-element-paragraph-format', {
      slideIndex: 0,
      sourceIds: [b],
      lineSpacingPct: 150,
    })
    ipc('slides:set-element-paragraph-format', {
      slideIndex: 0,
      sourceIds: [a, b],
      lineSpacingStep: 1,
    })
    expect(paragraphsOf(a)[0]!.lineHeight).toBe(110)
    expect(paragraphsOf(b)[0]!.lineHeight).toBe(160)
  })

  it('reads nothing for an element that is not there', () => {
    expect(ipc('slides:get-line-spacing', 0, 'missing')).toEqual([])
    expect(ipc('slides:get-line-spacing', 9, 'missing')).toEqual([])
  })
})
