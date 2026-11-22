import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OBJECT_MOVE_STEP_MM,
  OBJECT_SIZE_STEP_MM,
  cycledObjects,
  hancomAltClickObject,
  hancomPictureObjectKey,
  objectsAtPoint,
} from '../studio-plugin/hancom-keys.mjs'

interface Ref {
  sec: number
  ppi: number
  ci: number
  type: string
  cellPath?: unknown[]
}

const picture: Ref = { sec: 0, ppi: 1, ci: 0, type: 'image' }
const textBox: Ref = { sec: 0, ppi: 3, ci: 0, type: 'shape' }

/** The page layout's entry for an object, in the engine's names. */
const control = (ref: Ref, extra: Record<string, unknown> = {}) => ({
  type: ref.type,
  secIdx: ref.sec,
  paraIdx: ref.ppi,
  controlIdx: ref.ci,
  stableIndex: [ref.sec, ref.ppi, ref.ci],
  ...extra,
})

function key(init: Partial<KeyboardEvent>) {
  return { preventDefault: vi.fn(), ...init } as unknown as KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>
  }
}

/** A studio input handler with one object selected, as much of it as the keys use. */
function handler(selected: Ref | null, options: { enabled?: string[]; props?: object } = {}) {
  let current = selected
  const props: Record<string, { treatAsChar: boolean; textWrap: string }> = {}
  const ih = {
    gridStepMm: 3,
    ieumGridStepSet: false,
    stepsSeen: [] as { what: string; key: string; step: number }[],
    cursor: {
      isInPictureObjectSelection: () => current !== null,
      getSelectedPictureRef: () => current,
      getSelectedPictureRefs: () => (current ? [current] : []),
      enterPictureObjectSelectionDirect: vi.fn(
        (sec: number, ppi: number, ci: number, type: string) => {
          current = { sec, ppi, ci, type }
        },
      ),
    },
    dispatcher: {
      dispatch: vi.fn(),
      isEnabled: (id: string) => (options.enabled ?? []).includes(id),
    },
    eventBus: { emit: vi.fn() },
    caret: { hide: vi.fn() },
    wasm: {
      getPageControlLayout: vi.fn(() => ({
        controls: [
          control(textBox),
          control(picture),
          { type: 'table', secIdx: 0, paraIdx: 2, controlIdx: 0 },
        ],
      })),
    },
    findPictureBbox: () => ({ pageIndex: 0 }),
    exitPictureObjectSelectionIfNeeded: vi.fn(),
    renderPictureObjectSelection: vi.fn(),
    getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 }),
    getObjectProperties: (ref: Ref) =>
      (props[`${ref.ppi}`] ??= { treatAsChar: false, textWrap: 'Square', ...options.props }),
    setObjectProperties: vi.fn((ref: Ref, change: Record<string, string>) => {
      Object.assign(props[`${ref.ppi}`], change)
    }),
    bridge: { changeShapeZOrder: vi.fn(() => ({ ok: true, moves: [{}] })) },
    executeOperation: vi.fn(),
    moveSelectedPicture: vi.fn(),
    resizeSelectedPicture: vi.fn(),
    _cellBlockLetterImeGuard: { arm: vi.fn() },
    _hancomChord: null as string | null,
    current: () => current,
  }
  ih.executeOperation.mockImplementation((desc: { operation: (bridge: unknown) => unknown }) =>
    desc.operation(ih.bridge),
  )
  ih.moveSelectedPicture.mockImplementation((k: string) =>
    ih.stepsSeen.push({ what: 'move', key: k, step: ih.gridStepMm }),
  )
  ih.resizeSelectedPicture.mockImplementation((k: string) =>
    ih.stepsSeen.push({ what: 'size', key: k, step: ih.gridStepMm }),
  )
  return ih
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("a selected object's Hancom keys (개체를 선택한 상태에서)", () => {
  it('take nothing without a picture or drawing object selected', () => {
    const ih = handler(null)
    const e = key({ key: 'ArrowLeft', code: 'ArrowLeft' })
    expect(hancomPictureObjectKey(ih, e)).toBe(false)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it("move 0.2 mm and size 1 mm with the studio's own commands, and put its step back", () => {
    const ih = handler(picture)
    expect(hancomPictureObjectKey(ih, key({ key: 'ArrowRight', code: 'ArrowRight' }))).toBe(true)
    expect(
      hancomPictureObjectKey(ih, key({ key: 'ArrowDown', code: 'ArrowDown', shiftKey: true })),
    ).toBe(true)
    expect(ih.stepsSeen).toEqual([
      { what: 'move', key: 'ArrowRight', step: OBJECT_MOVE_STEP_MM },
      { what: 'size', key: 'ArrowDown', step: OBJECT_SIZE_STEP_MM },
    ])
    expect([OBJECT_MOVE_STEP_MM, OBJECT_SIZE_STEP_MM]).toEqual([0.2, 1])
    expect(ih.gridStepMm).toBe(3)
  })

  it('leave the arrows to the studio once the user set its move step in 격자 설정', () => {
    const ih = handler(picture)
    ih.ieumGridStepSet = true
    const e = key({ key: 'ArrowRight', code: 'ArrowRight' })
    expect(hancomPictureObjectKey(ih, e)).toBe(false)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(ih.stepsSeen).toEqual([])
  })

  it('go through the objects of the page in document order with Tab and Shift+Tab', () => {
    const ih = handler(picture)
    expect(hancomPictureObjectKey(ih, key({ key: 'Tab', code: 'Tab' }))).toBe(true)
    expect(ih.current()).toMatchObject({ ppi: 3, type: 'shape' })
    // round the end, past the table
    expect(hancomPictureObjectKey(ih, key({ key: 'Tab', code: 'Tab' }))).toBe(true)
    expect(ih.current()).toMatchObject({ ppi: 1, type: 'image' })
    expect(hancomPictureObjectKey(ih, key({ key: 'Tab', code: 'Tab', shiftKey: true }))).toBe(true)
    expect(ih.current()).toMatchObject({ ppi: 3 })
    expect(ih.eventBus.emit).toHaveBeenCalledWith('picture-object-selection-changed', true)
  })

  it('cycle body objects only: no tables, lines, master page decorations or header objects', () => {
    const objects = cycledObjects([
      control({ sec: 0, ppi: 9, ci: 0, type: 'image' }),
      control({ sec: 0, ppi: 2, ci: 1, type: 'shape' }),
      control({ sec: 0, ppi: 2, ci: 0, type: 'group' }),
      control({ sec: 0, ppi: 0, ci: 0, type: 'image' }, { plane: 1 }),
      control({ sec: 0, ppi: 0, ci: 1, type: 'image' }, { headerFooter: { kind: 'header' } }),
      control({ sec: 0, ppi: 4, ci: 0, type: 'line' }),
      control({ sec: 0, ppi: 5, ci: 0, type: 'table' }),
    ])
    expect(objects.map((c) => [c.paraIdx, c.controlIdx, c.type])).toEqual([
      [2, 0, 'group'],
      [2, 1, 'shape'],
      [9, 0, 'image'],
    ])
  })

  it('order a drawing object or a picture in one undo step; an equation stays', () => {
    const box = handler(textBox)
    expect(
      hancomPictureObjectKey(box, key({ key: 'PageUp', code: 'PageUp', shiftKey: true })),
    ).toBe(true)
    expect(box.executeOperation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'snapshot', operationType: 'objectOrder' }),
    )
    expect(box.bridge.changeShapeZOrder).toHaveBeenCalledWith(0, 3, 0, 'front')

    // vendor/rhwp-core patch 0053 orders pictures with the shapes
    const pic = handler(picture)
    expect(
      hancomPictureObjectKey(pic, key({ key: 'PageDown', code: 'PageDown', shiftKey: true })),
    ).toBe(true)
    expect(pic.bridge.changeShapeZOrder).toHaveBeenCalledWith(0, 1, 0, 'back')

    const equation = handler({ ...picture, type: 'equation' })
    const e = key({ key: 'PageDown', code: 'PageDown', shiftKey: true })
    // the key is still taken: Shift+PageDown would otherwise scroll the page
    expect(hancomPictureObjectKey(equation, e)).toBe(true)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(equation.executeOperation).not.toHaveBeenCalled()
  })

  it('put the object in front of or behind the text with Shift+Home/End', () => {
    const ih = handler(picture)
    expect(hancomPictureObjectKey(ih, key({ key: 'Home', code: 'Home', shiftKey: true }))).toBe(
      true,
    )
    expect(ih.setObjectProperties).toHaveBeenLastCalledWith(picture, { textWrap: 'InFrontOfText' })
    expect(hancomPictureObjectKey(ih, key({ key: 'End', code: 'End', shiftKey: true }))).toBe(true)
    expect(ih.setObjectProperties).toHaveBeenLastCalledWith(picture, { textWrap: 'BehindText' })
    expect(ih.executeOperation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'snapshot', operationType: 'objectWrap' }),
    )
  })

  it('leave an object placed like a character where it is', () => {
    const ih = handler(picture, { props: { treatAsChar: true } })
    expect(hancomPictureObjectKey(ih, key({ key: 'Home', code: 'Home', shiftKey: true }))).toBe(
      true,
    )
    expect(ih.setObjectProperties).not.toHaveBeenCalled()
  })

  it('cut with Shift+Delete, copy with Ctrl+Insert and delete with Ctrl+E', () => {
    const cases = [
      [{ key: 'Delete', code: 'Delete', shiftKey: true }, 'edit:cut'],
      [{ key: 'Insert', code: 'Insert', ctrlKey: true }, 'edit:copy'],
      [{ key: 'e', code: 'KeyE', ctrlKey: true }, 'edit:delete'],
      [{ key: 'ㄷ', code: 'KeyE', ctrlKey: true }, 'edit:delete'],
    ] as const
    for (const [init, id] of cases) {
      const ih = handler(picture)
      const e = key(init)
      expect(hancomPictureObjectKey(ih, e), id).toBe(true)
      expect(e.preventDefault).toHaveBeenCalled()
      expect(ih.dispatcher.dispatch).toHaveBeenCalledWith(id)
    }
  })

  it('group with G, and ungroup a group with U', () => {
    const ih = handler(textBox, { enabled: ['insert:group-shapes', 'insert:ungroup-shapes'] })
    const g = key({ key: 'g', code: 'KeyG' })
    expect(hancomPictureObjectKey(ih, g)).toBe(true)
    expect(ih.dispatcher.dispatch).toHaveBeenCalledWith('insert:group-shapes')
    expect(ih._cellBlockLetterImeGuard.arm).toHaveBeenCalledWith(g)
    // not a group: U does nothing, and the letter stays out of the document
    const u = key({ key: 'u', code: 'KeyU' })
    expect(hancomPictureObjectKey(ih, u)).toBe(true)
    expect(u.preventDefault).toHaveBeenCalled()
    expect(ih.dispatcher.dispatch).not.toHaveBeenCalledWith('insert:ungroup-shapes')

    const group = handler({ ...textBox, type: 'group' }, { enabled: ['insert:ungroup-shapes'] })
    expect(hancomPictureObjectKey(group, key({ key: 'u', code: 'KeyU' }))).toBe(true)
    expect(group.dispatcher.dispatch).toHaveBeenCalledWith('insert:ungroup-shapes')
  })

  it("open the properties on the line tab with L, and a drawing object's fill tab with C", () => {
    const clicked: string[] = []
    vi.stubGlobal('document', {
      querySelectorAll: (selector: string) => [{ click: () => clicked.push(selector) }],
    })
    const box = handler(textBox, { enabled: ['format:object-properties'] })
    expect(hancomPictureObjectKey(box, key({ key: 'l', code: 'KeyL' }))).toBe(true)
    expect(hancomPictureObjectKey(box, key({ key: 'c', code: 'KeyC' }))).toBe(true)
    expect(box.dispatcher.dispatch).toHaveBeenCalledWith('format:object-properties')
    expect(clicked).toEqual(['.dialog-tab[data-tab="line"]', '.dialog-tab[data-tab="fill"]'])

    // a picture has no fill tab: C opens nothing
    const pic = handler(picture, { enabled: ['format:object-properties'] })
    expect(hancomPictureObjectKey(pic, key({ key: 'c', code: 'KeyC' }))).toBe(true)
    expect(pic.dispatcher.dispatch).not.toHaveBeenCalled()
  })

  it('keep the object selected for a sequence, so Ctrl+N,C can caption it', () => {
    const ih = handler(picture)
    const e = key({ key: 'n', code: 'KeyN', ctrlKey: true })
    expect(hancomPictureObjectKey(ih, e)).toBe(true)
    expect(ih._hancomChord).toBe('n')
    expect(ih.current()).toBe(picture)
  })

  it("leave the studio's own keys and Alt to the studio", () => {
    for (const init of [
      { key: 'p', code: 'KeyP' },
      { key: 'Delete', code: 'Delete' },
      { key: 'Enter', code: 'Enter' },
      { key: 'Escape', code: 'Escape' },
      { key: 'c', code: 'KeyC', ctrlKey: true },
      { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true },
      { key: 'x', code: 'KeyX' },
    ]) {
      const ih = handler(picture)
      const e = key(init)
      expect(hancomPictureObjectKey(ih, e), init.key).toBe(false)
      expect(e.preventDefault).not.toHaveBeenCalled()
    }
  })
})

describe('Alt+click (help: 개체 선택, <Alt>로 선택)', () => {
  // two objects over one point: a picture behind the text and a text box above it
  const under = control(picture, { x: 0, y: 0, w: 100, h: 100, wrap: 'behindText', zOrder: 0 })
  const over = control(textBox, { x: 50, y: 50, w: 100, h: 100, zOrder: 3 })

  it('finds the objects under a point, the top one first, behind the text too', () => {
    expect(objectsAtPoint([under, over], 60, 60).map((c) => c.type)).toEqual(['shape', 'image'])
    expect(objectsAtPoint([under, over], 10, 10).map((c) => c.type)).toEqual(['image'])
    expect(objectsAtPoint([under, over], 300, 300)).toEqual([])
  })

  /** A studio input handler whose page shows both objects at 100%, page 0 at the origin. */
  function clickable(selected: Ref | null) {
    const ih = handler(selected)
    ih.wasm.getPageControlLayout = vi.fn(() => ({ controls: [under, over] }))
    return Object.assign(ih, {
      container: {
        querySelector: () => ({
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
          clientWidth: 800,
        }),
      },
      viewportManager: { getZoom: () => 1 },
      virtualScroll: {
        getPageAtPoint: () => 0,
        getPageLeftResolved: () => 0,
        getPageOffset: () => 0,
      },
      textarea: { focus: vi.fn() },
      selectionRenderer: { clear: vi.fn() },
    })
  }
  const altClick = (x: number, y: number, extra: object = {}) =>
    ({
      altKey: true,
      button: 0,
      clientX: x,
      clientY: y,
      preventDefault: vi.fn(),
      ...extra,
    }) as never

  it('selects the top object, then the one below it, then the top again', () => {
    const ih = clickable(null)
    expect(hancomAltClickObject(ih, altClick(60, 60))).toBe(true)
    expect(ih.current()).toMatchObject({ type: 'shape' })
    expect(hancomAltClickObject(ih, altClick(60, 60))).toBe(true)
    expect(ih.current()).toMatchObject({ type: 'image' })
    expect(hancomAltClickObject(ih, altClick(60, 60))).toBe(true)
    expect(ih.current()).toMatchObject({ type: 'shape' })
    expect(ih.textarea.focus).toHaveBeenCalled()
  })

  it('leaves a plain click, another modifier and an empty spot to the studio', () => {
    const ih = clickable(null)
    expect(hancomAltClickObject(ih, altClick(60, 60, { altKey: false }))).toBe(false)
    expect(hancomAltClickObject(ih, altClick(60, 60, { shiftKey: true }))).toBe(false)
    expect(hancomAltClickObject(ih, altClick(60, 60, { button: 2 }))).toBe(false)
    expect(hancomAltClickObject(ih, altClick(400, 400))).toBe(false)
    expect(ih.current()).toBeNull()
  })
})
