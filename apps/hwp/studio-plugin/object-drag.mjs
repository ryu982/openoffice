/**
 * Hancom Hangul's mouse rules for a selected picture or drawing object, as its help gives them
 * (개체 크기 조절, 개체 이동하기):
 *
 * - A picture's corner handle keeps its width to height ("그림의 크기를 조절할 때에는 그리기
 *   개체와는 달리, 각 모서리의 점을 잡고 끌면 너비와 높이가 비례적으로 조절됩니다"). A drawing
 *   object's corner keeps it with Shift held ("<Shift>를 누른 채로 각 모서리의 점을 잡고 끌면
 *   너비와 높이가 비례적으로 조절됩니다"). A side handle sizes one direction only.
 * - Shift while moving keeps the object on its row or its column ("현재 개체의 수평이나 수직
 *   위치로만 이동합니다").
 * - Esc while dragging puts the object back ("끄는 도중에 <Esc>를 누르면 개체 이동이 취소됩니다").
 * - Shift on a picture's corner crops it ("그림에서는 글자판의 <Shift>를 누른 채로 각 모서리의
 *   점을 잡고 끌면 [그림 자르기]가 실행됩니다"): the frame and the part of the image it shows
 *   change together, and the picture keeps its scale.
 * - Ctrl while moving copies the object ("<Ctrl>을 누른 채로 붙일 위치까지 마우스를 끕니다"): the
 *   object stays and its copy lands where the drag ends.
 *
 * The studio sized every object freely and had none of these keys.
 *
 * Bundled into the studio through hancom-keys.mjs and called from the studio's drag code by the
 * studio-hancom-object-drag, -drag-cancel and -copy patches. What these use of the studio's input
 * handler is listed in hancomHooks (scripts/rhwp-patches.mjs).
 */

const CORNERS = new Set(['nw', 'ne', 'sw', 'se'])

/**
 * Whether a resize drag keeps the width to height: a corner handle, on pictures alone, or on
 * anything with Shift. `state` is the studio's resize state: the handle (`dir`) and the object
 * (`ref`), or the objects of a multiple selection (`multiRefs`).
 */
export function dragKeepsRatio(state, shiftKey) {
  if (!CORNERS.has(state?.dir)) return false
  // a picture's Shift+corner crops it instead (cropsPicture)
  if (shiftKey && cropsPicture(state, shiftKey)) return false
  if (shiftKey) return true
  const refs = state.multiRefs ?? [state.ref]
  return refs.length > 0 && refs.every((ref) => ref?.type === 'image')
}

/**
 * The box a corner drag that keeps the ratio leaves (page px): the opposite corner stays where it
 * is, and the size follows the pointer's move along the box's diagonal, the way the studio sizes a
 * turned picture. The box does not go below one pixel on its longer side, nor turn over.
 */
export function ratioResizedBox(box, dir, dx, dy) {
  const { x, y, w, h } = box
  const signX = dir.includes('e') ? 1 : -1
  const signY = dir.includes('s') ? 1 : -1
  const diagonal = Math.hypot(w, h) || 1
  const along = (signX * dx * w + signY * dy * h) / diagonal
  const scale = Math.max((diagonal + along) / diagonal, 1 / Math.max(w, h, 1))
  const width = w * scale
  const height = h * scale
  return {
    x: signX > 0 ? x : x + w - width,
    y: signY > 0 ? y : y + h - height,
    width,
    height,
  }
}

/**
 * Where a Shift+drag takes the pointer: along the axis it went farther on from where the drag
 * started, the other one held at the start.
 */
export function axisLockedPoint(start, point) {
  return Math.abs(point.x - start.x) >= Math.abs(point.y - start.y)
    ? { x: point.x, y: start.y }
    : { x: start.x, y: point.y }
}

/**
 * Esc while a picture or drawing object is being moved or sized: the object goes back where it
 * was and the drag ends without an undo step. False when no such drag is on.
 */
export function cancelObjectDrag(ih) {
  if (ih?.isPictureResizeDragging && ih.pictureResizeState) {
    // the drag's journal puts back what the drag changed so far
    ih.cleanupPictureResizeDrag()
    ih.eventBus.emit('document-changed')
    ih.renderPictureObjectSelection()
    return true
  }
  if (ih?.isPictureMoveDragging && ih.pictureMoveState) {
    const state = ih.pictureMoveState
    const targets = state.multiRefs ?? [
      { ...state.ref, origHorzOffset: state.origHorzOffset, origVertOffset: state.origVertOffset },
    ]
    if (state.totalDeltaH !== 0 || state.totalDeltaV !== 0) {
      for (const ref of targets) {
        ih.setObjectProperties(ref, {
          horzOffset: ref.origHorzOffset,
          vertOffset: ref.origVertOffset,
        })
      }
      try {
        ih.wasm.updateConnectorsInSection(targets[0].sec)
      } catch {
        // a section without connectors
      }
      ih.eventBus.emit('document-changed')
    }
    ih.isPictureMoveDragging = false
    ih.pictureMoveState = null
    ih.container.style.cursor = ''
    if (ih.dragRafId) {
      globalThis.cancelAnimationFrame(ih.dragRafId)
      ih.dragRafId = 0
    }
    ih.renderPictureObjectSelection()
    return true
  }
  return false
}

/** HWPUNIT per page pixel at 100%. */
const HU_PER_PX = 75

/**
 * Whether a resize drag crops a picture: Shift on a corner of one picture that is not turned. A
 * turned picture's crop would not follow its frame on screen, so it keeps its ratio instead.
 */
export function cropsPicture(state, shiftKey) {
  return (
    Boolean(shiftKey) &&
    CORNERS.has(state?.dir) &&
    !state.multiRefs &&
    state.ref?.type === 'image' &&
    (((state.rotationAngle ?? 0) % 360) + 360) % 360 === 0
  )
}

/**
 * A crop drag (page px in, page px and crop amounts out). `crop` is the picture's state when the
 * drag began: the amounts cut off each side and the full image (`left`, `top`, `right`, `bottom`,
 * `extentW`, `extentH`, in the engine's crop units) and the frame (`width`, `height`, HWPUNIT). The
 * frame keeps showing the image at the same scale: moving a side in cuts off or brings back that
 * much of the image, and a side stops where the image ends. The opposite corner stays.
 */
export function croppedBox(box, dir, dx, dy, crop) {
  const visibleW = crop.extentW - crop.left - crop.right
  const visibleH = crop.extentH - crop.top - crop.bottom
  if (visibleW <= 0 || visibleH <= 0) return null
  // page px per crop unit, from the frame as it was
  const scaleX = crop.width / HU_PER_PX / visibleW
  const scaleY = crop.height / HU_PER_PX / visibleH
  const east = dir.includes('e')
  const south = dir.includes('s')
  const limitW = (crop.extentW - (east ? crop.left : crop.right)) * scaleX
  const limitH = (crop.extentH - (south ? crop.top : crop.bottom)) * scaleY
  const width = Math.min(Math.max(box.w + (east ? dx : -dx), 1), limitW)
  const height = Math.min(Math.max(box.h + (south ? dy : -dy), 1), limitH)
  const shownW = Math.round(width / scaleX)
  const shownH = Math.round(height / scaleY)
  return {
    box: {
      x: east ? box.x : box.x + box.w - width,
      y: south ? box.y : box.y + box.h - height,
      width,
      height,
    },
    crop: {
      cropLeft: east ? crop.left : Math.max(crop.extentW - crop.right - shownW, 0),
      cropRight: east ? Math.max(crop.extentW - crop.left - shownW, 0) : crop.right,
      cropTop: south ? crop.top : Math.max(crop.extentH - crop.bottom - shownH, 0),
      cropBottom: south ? Math.max(crop.extentH - crop.top - shownH, 0) : crop.bottom,
    },
  }
}

/**
 * The box of a crop drag, from the studio's resize state and the pointer; null when the drag does
 * not crop. Reads the picture's crop once per drag and keeps the crop amounts it settles on in
 * `state.ieumCrop.now`, for cropChange. The scale comes from the frame the drag began with
 * (`state.origWidth`): the studio may already have sized the picture before Shift went down.
 */
export function cropDragBox(ih, state, e, zoom) {
  if (!cropsPicture(state, e?.shiftKey)) {
    if (state?.ieumCrop) state.ieumCrop.now = null
    return null
  }
  if (!state.ieumCrop) {
    let props
    try {
      props = ih.getObjectProperties(state.ref)
    } catch {
      return null
    }
    if (!(props?.cropExtentWidth > 0) || !(props?.cropExtentHeight > 0)) return null
    state.ieumCrop = {
      start: {
        left: props.cropLeft ?? 0,
        top: props.cropTop ?? 0,
        right: props.cropRight ?? 0,
        bottom: props.cropBottom ?? 0,
        extentW: props.cropExtentWidth,
        extentH: props.cropExtentHeight,
        width: state.origWidth ?? props.width,
        height: state.origHeight ?? props.height,
      },
      now: null,
      written: false,
    }
  }
  const dx = (e.clientX - state.startClientX) / zoom
  const dy = (e.clientY - state.startClientY) / zoom
  const done = croppedBox(state.bbox, state.dir, dx, dy, state.ieumCrop.start)
  if (!done) return null
  state.ieumCrop.now = done.crop
  return done.box
}

/**
 * The crop amounts a crop drag changed, to write with the frame; empty when it crops nothing. Once
 * a crop was written every amount is written each time, so dragging back or letting Shift go (the
 * crop the drag began with) leaves nothing of an earlier step in the picture.
 */
export function cropChange(state) {
  const crop = state?.ieumCrop
  if (!crop) return {}
  const was = {
    cropLeft: crop.start.left,
    cropTop: crop.start.top,
    cropRight: crop.start.right,
    cropBottom: crop.start.bottom,
  }
  const now = crop.now ?? was
  if (crop.written) return { ...now }
  const change = Object.fromEntries(
    Object.entries(now).filter(([key, value]) => value !== was[key]),
  )
  if (Object.keys(change).length > 0) crop.written = true
  return change
}

/**
 * Ctrl when a move drag ends (Hangul's Ctrl+drag): the object goes back where it was, and a copy
 * is put where the drag took it, in one undo step. The copy anchors in the object's own paragraph
 * (the engine's duplicateFloatingControl), so the text around it does not move, and it is selected.
 * One floating object of the body on one page only; false leaves the drop to the studio, which
 * moves the object.
 */
export function copyObjectDrag(ih, e) {
  if (!(e?.ctrlKey || e?.metaKey) || !ih?.isPictureMoveDragging) return false
  const state = ih.pictureMoveState
  if (!state || (state.totalDeltaH === 0 && state.totalDeltaV === 0)) return false
  if (state.multiRefs && state.multiRefs.length > 1) return false
  if (state.dropPage !== undefined && state.dropPage !== state.pageIndex) return false
  const ref = state.ref
  if (!ref || (ref.cellPath?.length ?? 0) > 0 || ref.headerFooter || ref.type === 'equation') {
    return false
  }
  if (typeof ih.wasm?.duplicateFloatingControl !== 'function') return false
  const moved = {
    horzOffset: state.origHorzOffset + state.totalDeltaH,
    vertOffset: state.origVertOffset + state.totalDeltaV,
  }
  ih.setObjectProperties(ref, {
    horzOffset: state.origHorzOffset,
    vertOffset: state.origVertOffset,
  })
  let copy = null
  try {
    ih.executeOperation({
      kind: 'snapshot',
      operationType: 'copyObjectDrag',
      operation: (bridge) => {
        const done = bridge.duplicateFloatingControl(
          ref.sec,
          ref.ppi,
          ref.ci,
          state.totalDeltaH,
          state.totalDeltaV,
        )
        if (!done?.ok) return null
        copy = { sec: ref.sec, ppi: done.paraIdx, ci: done.controlIdx, type: ref.type }
        return ih.getCursorPosition()
      },
    })
  } catch {
    copy = null
  }
  if (!copy) {
    // nothing was copied: the drag stands as the move it was
    ih.setObjectProperties(ref, moved)
    return false
  }
  ih.isPictureMoveDragging = false
  ih.pictureMoveState = null
  ih.container.style.cursor = ''
  if (ih.dragRafId) {
    globalThis.cancelAnimationFrame(ih.dragRafId)
    ih.dragRafId = 0
  }
  try {
    ih.wasm.updateConnectorsInSection(ref.sec)
  } catch {
    // a section without connectors
  }
  ih.selectPictureObject(copy.sec, copy.ppi, copy.ci, copy.type)
  return true
}
