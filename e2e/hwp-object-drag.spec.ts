/**
 * Dragging a picture or a text box in the HWP editor as Hancom Hangul does (help: 개체 크기 조절,
 * 개체 이동하기; 2026-11-16 feedback: Shift/Ctrl did not keep a picture's ratio).
 *
 * A picture's corner handle keeps its ratio; a text box's does with Shift; Shift while moving
 * keeps the object on one axis; Esc while dragging puts the object back. The mouse goes through
 * Playwright, whose pointer events carry the Shift it holds down.
 * `assets/hwp-picture-table.hwp` was written by the engine: "앞", a 96×72 picture, a 3×2 table,
 * a text box holding "상자 글", "뒤".
 */
import { test, expect } from '@playwright/test'
import type { Frame, Page } from '@playwright/test'
import { copyFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

const STUDIO_IFRAME = '.hwp-editor-host iframe'
const OBJECTS_ASSET = join(__dirname, 'assets', 'hwp-picture-table.hwp')

interface Box {
  type: string
  x: number
  y: number
  w: number
  h: number
}

interface Probe {
  controls: Box[]
  pageWidth: number
  selected: { type: string } | null
  props: {
    width: number
    height: number
    horzOffset: number
    vertOffset: number
    treatAsChar: boolean
    textWrap?: string
    hasCaption?: boolean
    cropLeft?: number
    cropTop?: number
    cropRight?: number
    cropBottom?: number
    cropExtentWidth?: number
  } | null
  paragraphs: number
}

interface Ref {
  type: string
}

interface StudioServices {
  wasm: {
    getPageControlLayout(page: number): { controls: Box[] }
    getPageInfo(page: number): { width: number }
    getParagraphCount(section: number): number
  }
  getInputHandler(): {
    cursor: { getSelectedPictureRef(): Ref | null }
    getObjectProperties(ref: Ref): Probe['props']
    setObjectProperties(ref: Ref, props: Record<string, unknown>): void
    renderPictureObjectSelection(): void
    eventBus: { emit(name: string): void }
  }
}

interface StudioLike {
  automation: {
    execute(id: string): unknown
    registerCommand(def: { id: string; label: string; execute(s: StudioServices): void }): void
  }
  __dragProbe?: boolean
}

/** What is on the first page and the selected object's size and place. */
async function probe(frame: Frame, set?: Record<string, unknown>): Promise<Probe> {
  return frame.evaluate((change) => {
    const w = window as unknown as {
      rhwpStudio: StudioLike
      __e2eDrag: Probe
      __e2eDragSet?: Record<string, unknown>
    }
    const studio = w.rhwpStudio
    if (!studio.__dragProbe) {
      studio.automation.registerCommand({
        id: 'ext:e2e-drag',
        label: 'E2E drag',
        execute(services) {
          const ih = services.getInputHandler()
          const ref = ih.cursor.getSelectedPictureRef()
          if (ref && w.__e2eDragSet) {
            ih.setObjectProperties(ref, w.__e2eDragSet)
            ih.eventBus.emit('document-changed')
            ih.renderPictureObjectSelection()
          }
          w.__e2eDrag = {
            controls: services.wasm
              .getPageControlLayout(0)
              .controls.filter((c) => c.type === 'image' || c.type === 'shape'),
            pageWidth: services.wasm.getPageInfo(0).width,
            selected: ref ? { type: ref.type } : null,
            props: ref ? ih.getObjectProperties(ref) : null,
            paragraphs: services.wasm.getParagraphCount(0),
          }
        },
      })
      studio.__dragProbe = true
    }
    w.__e2eDragSet = change
    studio.automation.execute('ext:e2e-drag')
    w.__e2eDragSet = undefined
    return w.__e2eDrag
  }, set)
}

async function openObjects(): Promise<{
  launched: Awaited<ReturnType<typeof launchShell>>
  hwp: Page
  frame: Frame
}> {
  const dir = await mkdtemp(join(tmpdir(), 'hwp-object-drag-'))
  const file = join(dir, 'objects.hwp')
  await copyFile(OBJECTS_ASSET, file)
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'hwp-object-drag',
    openFiles: [file],
  })
  const hwp = await waitForPageWithUrl(launched.app, '://hwp/')
  await hwp.waitForSelector('.hwp-app[data-phase="ready"]', { timeout: 90_000 })
  const deadline = Date.now() + 60_000
  let frame: Frame | undefined
  while (!(frame = hwp.frames().find((f) => f.url().includes('/studio/')))) {
    if (Date.now() > deadline) throw new Error('studio frame never loaded')
    await hwp.waitForTimeout(100)
  }
  await frame.locator('#scroll-content canvas').first().waitFor({ timeout: 60_000 })
  await expect.poll(async () => (await probe(frame)).controls.length).toBeGreaterThan(1)
  return { launched, hwp, frame }
}

/** The screen point of a page point, from the first page's canvas. */
async function screen(hwp: Page, frame: Frame, x: number, y: number) {
  const { pageWidth } = await probe(frame)
  const canvas = hwp.frameLocator(STUDIO_IFRAME).locator('#scroll-content canvas').first()
  const box = (await canvas.boundingBox())!
  const scale = box.width / pageWidth
  return { x: box.x + x * scale, y: box.y + y * scale }
}

/** Select the first drawn object of a type, floating so it can move as well as size. */
async function select(hwp: Page, frame: Frame, type: string): Promise<Box> {
  const target = (await probe(frame)).controls.find((c) => c.type === type)
  if (!target) throw new Error(`no ${type} on the page`)
  // a text box is selected on its border; a click inside it starts typing in it
  const at =
    type === 'shape'
      ? await screen(hwp, frame, target.x + 1, target.y + target.h / 2)
      : await screen(hwp, frame, target.x + target.w / 2, target.y + target.h / 2)
  await hwp.mouse.click(at.x, at.y)
  await expect.poll(async () => (await probe(frame)).selected?.type).toBe(type)
  if ((await probe(frame)).props?.treatAsChar) {
    await probe(frame, { treatAsChar: false, textWrap: 'InFrontOfText' })
  }
  return (await probe(frame)).controls.find((c) => c.type === type)!
}

/** Drag from a page point by a screen offset, holding Shift from the first move on. */
async function drag(
  hwp: Page,
  frame: Frame,
  from: { x: number; y: number },
  by: { x: number; y: number },
  options: { shift?: boolean; escape?: boolean } = {},
): Promise<void> {
  const start = await screen(hwp, frame, from.x, from.y)
  await hwp.mouse.move(start.x, start.y)
  await hwp.mouse.down()
  await hwp.mouse.move(start.x + by.x / 4, start.y + by.y / 4, { steps: 2 })
  if (options.shift) await hwp.keyboard.down('Shift')
  await hwp.mouse.move(start.x + by.x, start.y + by.y, { steps: 8 })
  // the studio applies a move on the next animation frame
  await hwp.waitForTimeout(100)
  if (options.escape) await hwp.keyboard.press('Escape')
  await hwp.mouse.up()
  if (options.shift) await hwp.keyboard.up('Shift')
  await hwp.waitForTimeout(100)
}

const ratio = (p: Probe['props']) => p!.width / p!.height

test.describe('HWP picture and text box drags as Hangul has them', () => {
  test.setTimeout(240_000)

  test("a picture's corner keeps its ratio, its side sizes one way", async () => {
    const { launched, hwp, frame } = await openObjects()
    try {
      const picture = await select(hwp, frame, 'image')
      const before = (await probe(frame)).props!
      await drag(
        hwp,
        frame,
        { x: picture.x + picture.w, y: picture.y + picture.h },
        { x: 60, y: 4 },
      )
      const grown = (await probe(frame)).props!
      expect(grown.width).toBeGreaterThan(before.width)
      expect(ratio(grown)).toBeCloseTo(ratio(before), 1)

      // a side handle still sizes one way
      const now = (await probe(frame)).controls.find((c) => c.type === 'image')!
      await drag(hwp, frame, { x: now.x + now.w, y: now.y + now.h / 2 }, { x: 40, y: 0 })
      const wider = (await probe(frame)).props!
      expect(wider.width).toBeGreaterThan(grown.width)
      // the studio rounds the drawn box back to HWPUNIT here: a few units (0.01 mm) may go
      expect(Math.abs(wider.height - grown.height)).toBeLessThan(30)
    } finally {
      await closeAndSaveVideo(launched, 'hwp-object-drag')
    }
  })

  // in a document of its own: the grown picture would lie over the text box
  test("a text box's corner keeps its ratio with Shift alone", async () => {
    const { launched, hwp, frame } = await openObjects()
    try {
      const box = await select(hwp, frame, 'shape')
      const boxBefore = (await probe(frame)).props!
      await drag(hwp, frame, { x: box.x + box.w, y: box.y + box.h }, { x: 60, y: 4 })
      const free = (await probe(frame)).props!
      expect(Math.abs(ratio(free) - ratio(boxBefore))).toBeGreaterThan(0.05)

      const boxNow = (await probe(frame)).controls.find((c) => c.type === 'shape')!
      const held = (await probe(frame)).props!
      await drag(
        hwp,
        frame,
        { x: boxNow.x + boxNow.w, y: boxNow.y + boxNow.h },
        { x: 60, y: 4 },
        { shift: true },
      )
      const kept = (await probe(frame)).props!
      expect(kept.width).toBeGreaterThan(held.width)
      expect(ratio(kept)).toBeCloseTo(ratio(held), 1)
    } finally {
      await closeAndSaveVideo(launched, 'hwp-object-drag')
    }
  })

  test('Shift while moving keeps one axis, and Esc puts a dragged object back', async () => {
    const { launched, hwp, frame } = await openObjects()
    try {
      const picture = await select(hwp, frame, 'image')
      const before = (await probe(frame)).props!
      const middle = { x: picture.x + picture.w / 2, y: picture.y + picture.h / 2 }
      await drag(hwp, frame, middle, { x: 50, y: 12 }, { shift: true })
      const across = (await probe(frame)).props!
      expect(across.horzOffset).toBeGreaterThan(before.horzOffset)
      expect(across.vertOffset).toBe(before.vertOffset)

      // Esc while moving: back where it was
      const moved = (await probe(frame)).controls.find((c) => c.type === 'image')!
      await drag(
        hwp,
        frame,
        { x: moved.x + moved.w / 2, y: moved.y + moved.h / 2 },
        { x: 30, y: 30 },
        { escape: true },
      )
      const back = (await probe(frame)).props!
      expect([back.horzOffset, back.vertOffset]).toEqual([across.horzOffset, across.vertOffset])

      // Esc while sizing: the size it had
      const sized = (await probe(frame)).controls.find((c) => c.type === 'image')!
      await drag(
        hwp,
        frame,
        { x: sized.x + sized.w, y: sized.y + sized.h },
        { x: 50, y: 40 },
        { escape: true },
      )
      const same = (await probe(frame)).props!
      expect([same.width, same.height]).toEqual([across.width, across.height])
    } finally {
      await closeAndSaveVideo(launched, 'hwp-object-drag')
    }
  })
})

/** A key as the OS delivers it, so the main process sees it first (as a person's key does). */
async function sendKey(
  launched: Awaited<ReturnType<typeof launchShell>>,
  keyCode: string,
  modifiers: string[] = [],
): Promise<void> {
  await launched.app.evaluate(
    async ({ webContents }, [code, mods]) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('://hwp/'))
      if (!wc) throw new Error('no hwp view')
      wc.sendInputEvent({ type: 'keyDown', keyCode: code, modifiers: mods as never })
      wc.sendInputEvent({ type: 'keyUp', keyCode: code, modifiers: mods as never })
    },
    [keyCode, modifiers] as const,
  )
}

// help: 단축키 일람, 개체를 선택한 상태에서
test.describe("HWP keys on a selected picture or text box, as Hangul's", () => {
  test.setTimeout(240_000)

  test('arrows step 0.2 mm and Shift+arrows 1 mm; Tab, Shift+End/Home and G keep to the object', async () => {
    const { launched, hwp, frame } = await openObjects()
    try {
      await select(hwp, frame, 'image')
      const before = (await probe(frame)).props!
      await sendKey(launched, 'Right')
      await expect
        .poll(async () => (await probe(frame)).props!.horzOffset)
        .toBe(before.horzOffset + 57)
      await sendKey(launched, 'Right', ['shift'])
      await expect.poll(async () => (await probe(frame)).props!.width).toBe(before.width + 283)

      await sendKey(launched, 'End', ['shift'])
      await expect.poll(async () => (await probe(frame)).props!.textWrap).toBe('BehindText')
      await sendKey(launched, 'Home', ['shift'])
      await expect.poll(async () => (await probe(frame)).props!.textWrap).toBe('InFrontOfText')

      // G on one object groups nothing, and the letter stays out of the document
      await sendKey(launched, 'G')
      expect((await probe(frame)).selected?.type).toBe('image')

      await sendKey(launched, 'Tab')
      await expect.poll(async () => (await probe(frame)).selected?.type).toBe('shape')
      await sendKey(launched, 'Tab', ['shift'])
      await expect.poll(async () => (await probe(frame)).selected?.type).toBe('image')
    } finally {
      await closeAndSaveVideo(launched, 'hwp-object-drag')
    }
  })

  test('Ctrl+N,C captions the selected picture, and Ctrl+E deletes it', async () => {
    const { launched, hwp, frame } = await openObjects()
    try {
      await select(hwp, frame, 'image')
      expect((await probe(frame)).props!.hasCaption).toBeFalsy()
      await sendKey(launched, 'N', ['control'])
      await sendKey(launched, 'C')
      // the caption is written and its text is open for typing
      await expect.poll(async () => (await probe(frame)).selected).toBeNull()
      await select(hwp, frame, 'image')
      expect((await probe(frame)).props!.hasCaption).toBe(true)

      await sendKey(launched, 'E', ['control'])
      await expect
        .poll(async () => (await probe(frame)).controls.filter((c) => c.type === 'image').length)
        .toBe(0)
    } finally {
      await closeAndSaveVideo(launched, 'hwp-object-drag')
    }
  })

  test('Alt+click goes round the objects lying over one another', async () => {
    const { launched, hwp, frame } = await openObjects()
    try {
      // lay the picture over the text box's top left corner
      await select(hwp, frame, 'image')
      // in front of the text, so moving it does not push the text box along
      await probe(frame, { textWrap: 'InFrontOfText' })
      const box = (await probe(frame)).controls.find((c) => c.type === 'shape')!
      await probe(frame, { horzOffset: Math.round(box.x * 75), vertOffset: Math.round(box.y * 75) })
      await hwp.keyboard.press('Escape')
      const at = await screen(hwp, frame, box.x + 20, box.y + 20)

      const seen: string[] = []
      for (let i = 0; i < 3; i += 1) {
        await hwp.keyboard.down('Alt')
        await hwp.mouse.click(at.x, at.y)
        await hwp.keyboard.up('Alt')
        await expect.poll(async () => (await probe(frame)).selected?.type).toBeTruthy()
        seen.push((await probe(frame)).selected!.type)
      }
      // both objects, one after the other, and round to the first again
      expect(new Set(seen.slice(0, 2))).toEqual(new Set(['image', 'shape']))
      expect(seen[2]).toBe(seen[0])
    } finally {
      await closeAndSaveVideo(launched, 'hwp-object-drag')
    }
  })
})

// vendor/rhwp-core patches 0052-0054: what Hangul does that needed the engine
test.describe("HWP object edits that needed the engine, as Hangul's", () => {
  test.setTimeout(240_000)

  test("a picture's Shift+corner crops it at the same scale, and undo puts it back", async () => {
    const { launched, hwp, frame } = await openObjects()
    try {
      const picture = await select(hwp, frame, 'image')
      const before = (await probe(frame)).props!
      expect([before.cropRight, before.cropBottom]).toEqual([0, 0])
      await drag(
        hwp,
        frame,
        { x: picture.x + picture.w, y: picture.y + picture.h },
        { x: -30, y: -20 },
        { shift: true },
      )
      const cropped = (await probe(frame)).props!
      expect(cropped.width).toBeLessThan(before.width)
      expect(cropped.height).toBeLessThan(before.height)
      expect(cropped.cropRight).toBeGreaterThan(0)
      expect(cropped.cropBottom).toBeGreaterThan(0)
      // the frame shows the image at the scale it had: width per shown image unit
      const extent = cropped.cropExtentWidth!
      const scale = (w: number, cut: number) => w / (extent - cut)
      expect(scale(cropped.width, cropped.cropRight!)).toBeCloseTo(scale(before.width, 0), 1)

      await sendKey(launched, 'Z', ['control'])
      await expect
        .poll(async () => {
          await select(hwp, frame, 'image')
          const back = (await probe(frame)).props!
          return [back.width, back.cropRight]
        })
        .toEqual([before.width, 0])
    } finally {
      await closeAndSaveVideo(launched, 'hwp-object-drag')
    }
  })

  test('Ctrl while moving leaves the object and drops a copy, without new paragraphs', async () => {
    const { launched, hwp, frame } = await openObjects()
    try {
      const picture = await select(hwp, frame, 'image')
      const start = await probe(frame)
      const before = start.props!
      const pictures = start.controls.filter((c) => c.type === 'image').length
      const at = await screen(hwp, frame, picture.x + picture.w / 2, picture.y + picture.h / 2)
      await hwp.mouse.move(at.x, at.y)
      await hwp.mouse.down()
      await hwp.mouse.move(at.x + 20, at.y + 10, { steps: 2 })
      await hwp.keyboard.down('Control')
      await hwp.mouse.move(at.x + 120, at.y + 60, { steps: 8 })
      await hwp.waitForTimeout(100)
      await hwp.mouse.up()
      await hwp.keyboard.up('Control')

      await expect
        .poll(async () => (await probe(frame)).controls.filter((c) => c.type === 'image').length)
        .toBe(pictures + 1)
      const after = await probe(frame)
      expect(after.paragraphs).toBe(start.paragraphs)
      // the copy is selected, where the drag ended; the object is where it was
      expect(after.props!.horzOffset).toBeGreaterThan(before.horzOffset)
      const offsets = after.controls
        .filter((c) => c.type === 'image')
        .map((c) => Math.round(c.x))
        .sort((a, b) => a - b)
      expect(offsets[0]).toBe(Math.round(picture.x))

      await sendKey(launched, 'Z', ['control'])
      await expect
        .poll(async () => (await probe(frame)).controls.filter((c) => c.type === 'image').length)
        .toBe(pictures)
    } finally {
      await closeAndSaveVideo(launched, 'hwp-object-drag')
    }
  })

  test('Shift+PageUp brings a picture in front of a text box, Shift+PageDown sends it back', async () => {
    const { launched, hwp, frame } = await openObjects()
    try {
      await select(hwp, frame, 'image')
      const z = async () => {
        const controls = (await probe(frame)).controls as (Box & { zOrder?: number })[]
        const pic = controls.find((c) => c.type === 'image')!
        const box = controls.find((c) => c.type === 'shape')!
        return Math.sign((pic.zOrder ?? 0) - (box.zOrder ?? 0))
      }
      await sendKey(launched, 'PageDown', ['shift'])
      await expect.poll(z).toBe(-1)
      await sendKey(launched, 'PageUp', ['shift'])
      await expect.poll(z).toBe(1)
    } finally {
      await closeAndSaveVideo(launched, 'hwp-object-drag')
    }
  })
})
