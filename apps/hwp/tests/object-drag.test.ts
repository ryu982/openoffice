import { describe, expect, it, vi } from 'vitest'
import {
  axisLockedPoint,
  cancelObjectDrag,
  copyObjectDrag,
  cropChange,
  cropDragBox,
  croppedBox,
  cropsPicture,
  dragKeepsRatio,
  ratioResizedBox,
} from '../studio-plugin/object-drag.mjs'

const picture = { sec: 0, ppi: 1, ci: 0, type: 'image' }
const shape = { sec: 0, ppi: 2, ci: 0, type: 'shape' }

describe('which drags keep the ratio (help: 개체 크기 조절)', () => {
  it("keeps a picture's on a corner handle; Shift crops it instead", () => {
    for (const dir of ['nw', 'ne', 'sw', 'se']) {
      expect(dragKeepsRatio({ dir, ref: picture }, false)).toBe(true)
      expect(dragKeepsRatio({ dir, ref: picture }, true)).toBe(false)
      expect(cropsPicture({ dir, ref: picture }, true)).toBe(true)
    }
    // a turned picture, or several, cannot crop with its frame: Shift keeps the ratio there
    expect(dragKeepsRatio({ dir: 'se', ref: picture, rotationAngle: 30 }, true)).toBe(true)
    expect(cropsPicture({ dir: 'se', ref: picture, rotationAngle: 30 }, true)).toBe(false)
    expect(cropsPicture({ dir: 'se', ref: picture, multiRefs: [picture, picture] }, true)).toBe(
      false,
    )
    expect(cropsPicture({ dir: 'e', ref: picture }, true)).toBe(false)
    expect(cropsPicture({ dir: 'se', ref: shape }, true)).toBe(false)
  })

  it("keeps a drawing object's on a corner handle only with Shift", () => {
    for (const type of ['shape', 'group', 'line', 'ole']) {
      const ref = { ...shape, type }
      expect(dragKeepsRatio({ dir: 'se', ref }, false)).toBe(false)
      expect(dragKeepsRatio({ dir: 'se', ref }, true)).toBe(true)
    }
  })

  it('never on a side handle, which sizes one direction', () => {
    for (const dir of ['n', 'e', 's', 'w']) {
      expect(dragKeepsRatio({ dir, ref: picture }, false)).toBe(false)
      expect(dragKeepsRatio({ dir, ref: shape }, true)).toBe(false)
    }
  })

  it('keeps it for several pictures, and for a mixed selection with Shift', () => {
    expect(dragKeepsRatio({ dir: 'ne', ref: picture, multiRefs: [picture, picture] }, false)).toBe(
      true,
    )
    expect(dragKeepsRatio({ dir: 'ne', ref: picture, multiRefs: [picture, shape] }, false)).toBe(
      false,
    )
    expect(dragKeepsRatio({ dir: 'ne', ref: picture, multiRefs: [picture, shape] }, true)).toBe(
      true,
    )
  })
})

describe('the box of a corner drag that keeps the ratio', () => {
  const box = { x: 100, y: 50, w: 200, h: 100 }
  const ratio = (b: { width: number; height: number }) => b.width / b.height

  it('grows along the diagonal and holds the opposite corner', () => {
    const se = ratioResizedBox(box, 'se', 40, 20)
    expect(ratio(se)).toBeCloseTo(2)
    expect(se.width).toBeCloseTo(240)
    expect([se.x, se.y]).toEqual([100, 50])

    const nw = ratioResizedBox(box, 'nw', -40, -20)
    expect(nw.width).toBeCloseTo(240)
    expect(nw.x + nw.width).toBeCloseTo(300)
    expect(nw.y + nw.height).toBeCloseTo(150)

    const ne = ratioResizedBox(box, 'ne', -20, 0)
    expect(ratio(ne)).toBeCloseTo(2)
    expect(ne.width).toBeLessThan(200)
    expect(ne.x).toBe(100)
    expect(ne.y + ne.height).toBeCloseTo(150)

    const sw = ratioResizedBox(box, 'sw', 0, 30)
    expect(ratio(sw)).toBeCloseTo(2)
    expect(sw.x + sw.width).toBeCloseTo(300)
    expect(sw.y).toBe(50)
  })

  it('keeps the ratio when the pointer moves one way only', () => {
    const across = ratioResizedBox(box, 'se', 100, 0)
    expect(ratio(across)).toBeCloseTo(2)
    expect(across.width).toBeGreaterThan(200)
  })

  it('does not go below a pixel or turn over when dragged past the other corner', () => {
    const past = ratioResizedBox(box, 'se', -1000, -1000)
    expect(past.width).toBeCloseTo(1)
    expect(past.height).toBeCloseTo(0.5)
    expect([past.x, past.y]).toEqual([100, 50])
  })
})

describe('Shift while moving (help: 개체 이동하기)', () => {
  const start = { x: 10, y: 10 }

  it('holds the axis the pointer went less far on', () => {
    expect(axisLockedPoint(start, { x: 50, y: 18 })).toEqual({ x: 50, y: 10 })
    expect(axisLockedPoint(start, { x: 4, y: -40 })).toEqual({ x: 10, y: -40 })
  })

  it('goes across when both are even', () => {
    expect(axisLockedPoint(start, { x: 20, y: 20 })).toEqual({ x: 20, y: 10 })
  })
})

function inputHandler(overrides: Record<string, unknown> = {}) {
  return {
    isPictureResizeDragging: false,
    pictureResizeState: null,
    isPictureMoveDragging: false,
    pictureMoveState: null,
    dragRafId: 0,
    container: { style: { cursor: 'move' } },
    eventBus: { emit: vi.fn() },
    wasm: { updateConnectorsInSection: vi.fn() },
    setObjectProperties: vi.fn(),
    cleanupPictureResizeDrag: vi.fn(),
    renderPictureObjectSelection: vi.fn(),
    ...overrides,
  }
}

describe('Esc while dragging an object', () => {
  it('leaves the key alone when no drag is on', () => {
    const ih = inputHandler()
    expect(cancelObjectDrag(ih)).toBe(false)
    expect(cancelObjectDrag(null)).toBe(false)
    expect(ih.setObjectProperties).not.toHaveBeenCalled()
  })

  it('puts a moved object back where it was, without an undo step', () => {
    const ih = inputHandler({
      isPictureMoveDragging: true,
      pictureMoveState: {
        ref: picture,
        origHorzOffset: 1000,
        origVertOffset: 2000,
        totalDeltaH: 750,
        totalDeltaV: -75,
      },
    })
    expect(cancelObjectDrag(ih)).toBe(true)
    expect(ih.setObjectProperties).toHaveBeenCalledWith(expect.objectContaining(picture), {
      horzOffset: 1000,
      vertOffset: 2000,
    })
    expect(ih.isPictureMoveDragging).toBe(false)
    expect(ih.pictureMoveState).toBeNull()
    expect(ih.container.style.cursor).toBe('')
    expect(ih.eventBus.emit).toHaveBeenCalledWith('document-changed')
    expect(ih.renderPictureObjectSelection).toHaveBeenCalled()
  })

  it('puts every object of a moved selection back', () => {
    const multiRefs = [
      { ...picture, origHorzOffset: 10, origVertOffset: 20 },
      { ...shape, origHorzOffset: 30, origVertOffset: 40 },
    ]
    const ih = inputHandler({
      isPictureMoveDragging: true,
      pictureMoveState: { ref: multiRefs[0], multiRefs, totalDeltaH: 5, totalDeltaV: 0 },
    })
    cancelObjectDrag(ih)
    expect(ih.setObjectProperties).toHaveBeenCalledTimes(2)
    expect(ih.setObjectProperties).toHaveBeenLastCalledWith(multiRefs[1], {
      horzOffset: 30,
      vertOffset: 40,
    })
    expect(ih.wasm.updateConnectorsInSection).toHaveBeenCalledWith(0)
  })

  it('writes nothing when the object has not moved yet', () => {
    const ih = inputHandler({
      isPictureMoveDragging: true,
      pictureMoveState: {
        ref: picture,
        origHorzOffset: 0,
        origVertOffset: 0,
        totalDeltaH: 0,
        totalDeltaV: 0,
      },
    })
    expect(cancelObjectDrag(ih)).toBe(true)
    expect(ih.setObjectProperties).not.toHaveBeenCalled()
    expect(ih.isPictureMoveDragging).toBe(false)
  })

  it("ends a size drag through the studio's clean-up, which puts the size back", () => {
    const ih = inputHandler({ isPictureResizeDragging: true, pictureResizeState: { dir: 'se' } })
    expect(cancelObjectDrag(ih)).toBe(true)
    expect(ih.cleanupPictureResizeDrag).toHaveBeenCalled()
    expect(ih.renderPictureObjectSelection).toHaveBeenCalled()
  })
})

describe("a picture's Shift+corner crops it (help: 개체 크기 조절, 그림 자르기)", () => {
  // a 100x50 px frame showing all of a 3000x1500 image (crop units), so 1 px = 30 units
  const box = { x: 10, y: 20, w: 100, h: 50 }
  const whole = {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    extentW: 3000,
    extentH: 1500,
    width: 7500,
    height: 3750,
  }

  it('cuts off what the frame gives up, at the same scale, and holds the opposite corner', () => {
    const se = croppedBox(box, 'se', -40, -10, whole)!
    expect(se.box).toEqual({ x: 10, y: 20, width: 60, height: 40 })
    expect(se.crop).toEqual({ cropLeft: 0, cropRight: 1200, cropTop: 0, cropBottom: 300 })

    const nw = croppedBox(box, 'nw', 30, 5, whole)!
    expect(nw.box).toEqual({ x: 40, y: 25, width: 70, height: 45 })
    expect(nw.crop).toEqual({ cropLeft: 900, cropRight: 0, cropTop: 150, cropBottom: 0 })
  })

  it('brings a cut side back, but no further than the image goes', () => {
    const cut = { ...whole, right: 1500, width: 3750 } // 50 px showing the left half
    const back = croppedBox({ ...box, w: 50 }, 'se', 20, 0, cut)!
    expect(back.box.width).toBe(70)
    expect(back.crop.cropRight).toBe(900)
    const past = croppedBox({ ...box, w: 50 }, 'se', 500, 0, cut)!
    expect(past.box.width).toBe(100)
    expect(past.crop.cropRight).toBe(0)
  })

  it('reads the crop once, from the picture, and writes only what changed', () => {
    const ih = {
      getObjectProperties: vi.fn(() => ({
        width: 7500,
        height: 3750,
        cropLeft: 0,
        cropTop: 0,
        cropRight: 0,
        cropBottom: 0,
        cropExtentWidth: 3000,
        cropExtentHeight: 1500,
      })),
    }
    const state: Record<string, unknown> = {
      dir: 'se',
      ref: picture,
      bbox: box,
      startClientX: 0,
      startClientY: 0,
    }
    const pointer = (x: number, y: number, shiftKey = true) => ({
      clientX: x,
      clientY: y,
      shiftKey,
    })
    expect(cropDragBox(ih, state, pointer(-40, 0), 1)).toEqual({
      x: 10,
      y: 20,
      width: 60,
      height: 50,
    })
    expect(cropChange(state)).toEqual({ cropRight: 1200 })
    expect(cropDragBox(ih, state, pointer(-20, 0), 1)).toEqual({
      x: 10,
      y: 20,
      width: 80,
      height: 50,
    })
    // written once, every amount goes with each step
    expect(cropChange(state)).toEqual({ cropLeft: 0, cropTop: 0, cropRight: 600, cropBottom: 0 })
    expect(ih.getObjectProperties).toHaveBeenCalledTimes(1)
    // Shift let go: a plain corner drag again, and the crop goes back to where it began
    expect(cropDragBox(ih, state, pointer(-20, 0, false), 1)).toBeNull()
    expect(cropChange(state)).toEqual({ cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 })
  })

  it('crops nothing until a step does, and writes nothing then', () => {
    const ih = {
      getObjectProperties: () => ({
        width: 7500,
        height: 3750,
        cropExtentWidth: 3000,
        cropExtentHeight: 1500,
      }),
    }
    const state: Record<string, unknown> = {
      dir: 'se',
      ref: picture,
      bbox: box,
      startClientX: 0,
      startClientY: 0,
    }
    expect(cropDragBox(ih, state, { clientX: 0, clientY: 0, shiftKey: true }, 1)).not.toBeNull()
    expect(cropChange(state)).toEqual({})
    expect(cropDragBox(ih, state, { clientX: 0, clientY: 0, shiftKey: false }, 1)).toBeNull()
    expect(cropChange(state)).toEqual({})
  })

  it('takes the scale from the frame the drag began with, not one the studio sized since', () => {
    // the studio sized the picture to half before Shift went down; the drag began at 100 px wide
    const ih = {
      getObjectProperties: () => ({
        width: 3750,
        height: 1875,
        cropExtentWidth: 3000,
        cropExtentHeight: 1500,
      }),
    }
    const state: Record<string, unknown> = {
      dir: 'se',
      ref: picture,
      bbox: box,
      origWidth: 7500,
      origHeight: 3750,
      startClientX: 0,
      startClientY: 0,
    }
    cropDragBox(ih, state, { clientX: -40, clientY: 0, shiftKey: true }, 1)
    expect(cropChange(state)).toEqual({ cropRight: 1200 })
  })

  it('leaves a picture whose image size the engine does not give alone', () => {
    const ih = { getObjectProperties: () => ({ width: 100, height: 100, cropExtentWidth: 0 }) }
    const state = { dir: 'se', ref: picture, bbox: box, startClientX: 0, startClientY: 0 }
    expect(cropDragBox(ih, state, { clientX: 5, clientY: 5, shiftKey: true }, 1)).toBeNull()
  })
})

describe('Ctrl while moving copies the object (help: 개체 복사하기/붙이기)', () => {
  function mover(
    stateExtra: Record<string, unknown> = {},
    done = { ok: true, paraIdx: 1, controlIdx: 1 },
  ) {
    const bridge = { duplicateFloatingControl: vi.fn(() => done) }
    const ih = {
      isPictureMoveDragging: true,
      pictureMoveState: {
        ref: picture,
        origHorzOffset: 1000,
        origVertOffset: 2000,
        totalDeltaH: 750,
        totalDeltaV: 300,
        pageIndex: 0,
        dropPage: 0,
        ...stateExtra,
      } as Record<string, unknown> | null,
      dragRafId: 0,
      container: { style: { cursor: 'move' } },
      wasm: { ...bridge, updateConnectorsInSection: vi.fn() },
      setObjectProperties: vi.fn(),
      getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 1, charOffset: 0 }),
      executeOperation: vi.fn((desc: { operation: (b: unknown) => unknown }) =>
        desc.operation(bridge),
      ),
      selectPictureObject: vi.fn(),
    }
    return { ih, bridge }
  }

  it('puts the object back and drops a copy where the drag ended, selected', () => {
    const { ih, bridge } = mover()
    expect(copyObjectDrag(ih, { ctrlKey: true })).toBe(true)
    expect(ih.setObjectProperties).toHaveBeenCalledWith(picture, {
      horzOffset: 1000,
      vertOffset: 2000,
    })
    expect(bridge.duplicateFloatingControl).toHaveBeenCalledWith(0, 1, 0, 750, 300)
    expect(ih.executeOperation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'snapshot', operationType: 'copyObjectDrag' }),
    )
    expect(ih.selectPictureObject).toHaveBeenCalledWith(0, 1, 1, 'image')
    expect(ih.isPictureMoveDragging).toBe(false)
    expect(ih.pictureMoveState).toBeNull()
  })

  it('leaves a plain drop, an unmoved one, another page and an object in a cell to the move', () => {
    for (const [extra, ctrlKey] of [
      [{}, false],
      [{ totalDeltaH: 0, totalDeltaV: 0 }, true],
      [{ dropPage: 1 }, true],
      [
        { ref: { ...picture, cellPath: [{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }] } },
        true,
      ],
      [{ multiRefs: [picture, shape] }, true],
    ] as const) {
      const { ih, bridge } = mover(extra as Record<string, unknown>)
      expect(copyObjectDrag(ih, { ctrlKey }), JSON.stringify(extra)).toBe(false)
      expect(bridge.duplicateFloatingControl).not.toHaveBeenCalled()
      expect(ih.isPictureMoveDragging).toBe(true)
    }
  })

  it('keeps the move when the engine copies nothing', () => {
    const { ih } = mover({}, { ok: false } as never)
    expect(copyObjectDrag(ih, { ctrlKey: true })).toBe(false)
    expect(ih.setObjectProperties).toHaveBeenLastCalledWith(picture, {
      horzOffset: 1750,
      vertOffset: 2300,
    })
    expect(ih.selectPictureObject).not.toHaveBeenCalled()
  })
})
