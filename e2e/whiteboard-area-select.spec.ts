import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeAndSaveVideo, launchShell } from './helpers'

interface NoteBox {
  id: string
  x: number
  y: number
  w: number
  h: number
}

async function waitWhiteboardPage(app: ElectronApplication, before: Set<Page>): Promise<Page> {
  let found: Page | undefined
  await expect
    .poll(
      () => {
        found = app.windows().find((p) => !before.has(p) && p.url().includes('://whiteboard/'))
        return found !== undefined
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  await expect(found!.locator('.wb-stage-svg')).toHaveCount(1, { timeout: 30_000 })
  return found!
}

/** Screen box of each sticky note's paper (not its selection frame), in board order. */
function notes(board: Page): Promise<NoteBox[]> {
  return board.$$eval('g[data-object-kind="sticky"]', (groups) =>
    groups.map((g) => {
      const r = g.querySelector('rect')!.getBoundingClientRect()
      return { id: g.getAttribute('data-object-id')!, x: r.x, y: r.y, w: r.width, h: r.height }
    }),
  )
}

async function drag(
  board: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifier?: 'Shift',
): Promise<void> {
  if (modifier) await board.keyboard.down(modifier)
  await board.mouse.move(from.x, from.y)
  await board.mouse.down()
  await board.mouse.move(to.x, to.y, { steps: 8 })
  await board.mouse.up()
  if (modifier) await board.keyboard.up(modifier)
}

test.describe('Whiteboard area selection', () => {
  test('drag an area, move the group, toggle with Shift, area tool, select all, duplicate and delete', async () => {
    test.setTimeout(180_000)
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'whiteboard-area-select' })
    const { app, page: shell } = launched
    try {
      const card = shell.locator('.quick-card', {
        has: shell.locator('.quick-title', { hasText: /^Whiteboard$/ }),
      })
      const before = new Set(app.windows())
      await card.click()
      const board = await waitWhiteboardPage(app, before)

      // The area tool sits right under Select in the left rail.
      const rail = board.locator('.wb-toolbar .wb-tool-btn')
      await expect(rail.nth(0)).toHaveAttribute('aria-label', 'Select')
      await expect(rail.nth(1)).toHaveAttribute('aria-label', 'Area select')

      // Zoom out so four notes fit whatever the stage width, then place them:
      // three in a row and one under the middle one.
      const zoomOut = board.getByRole('button', { name: '-', exact: true })
      for (let i = 0; i < 3; i++) await zoomOut.click()
      const svg = (await board.locator('.wb-stage-svg').boundingBox())!
      const spots = [
        { x: svg.x + 180, y: svg.y + 150 },
        { x: svg.x + 330, y: svg.y + 150 },
        { x: svg.x + 480, y: svg.y + 150 },
        { x: svg.x + 330, y: svg.y + 330 },
      ]
      for (const spot of spots) {
        await board.getByRole('button', { name: 'Sticky note' }).click()
        await board.mouse.click(spot.x, spot.y)
      }
      await expect(board.locator('[data-object-kind="sticky"]')).toHaveCount(4)
      await board.keyboard.press('Escape')
      const [n1, n2, n3, n4] = await notes(board)

      // 1. A drag from empty paper selects the notes wholly inside it.
      await drag(
        board,
        { x: n1!.x - 20, y: n1!.y - 20 },
        { x: n2!.x + n2!.w + 15, y: n2!.y + n2!.h + 15 },
      )
      const count = board.locator('.wb-format-count')
      await expect(count).toHaveText('2 selected')
      await expect(board.locator('.wb-group-rect')).toHaveCount(1)
      await expect(board.locator('.wb-marquee-rect')).toHaveCount(0)

      // 2. Dragging one selected note moves both; one undo puts both back.
      await drag(
        board,
        { x: n1!.x + n1!.w / 2, y: n1!.y + n1!.h / 2 },
        { x: n1!.x + n1!.w / 2 + 40, y: n1!.y + n1!.h / 2 + 60 },
      )
      const moved = await notes(board)
      expect(Math.round(moved[0]!.x - n1!.x)).toBe(40)
      expect(Math.round(moved[0]!.y - n1!.y)).toBe(60)
      expect(Math.round(moved[1]!.x - n2!.x)).toBe(40)
      expect(Math.round(moved[1]!.y - n2!.y)).toBe(60)
      expect(Math.round(moved[2]!.x - n3!.x)).toBe(0)
      await expect(count).toHaveText('2 selected')
      await board.keyboard.press('Control+z')
      await expect.poll(async () => Math.round((await notes(board))[0]!.x - n1!.x)).toBe(0)
      expect(Math.round((await notes(board))[1]!.y - n2!.y)).toBe(0)

      // 3. Shift+click adds a note and takes it out again.
      await drag(
        board,
        { x: n1!.x - 20, y: n1!.y - 20 },
        { x: n2!.x + n2!.w + 15, y: n2!.y + n2!.h + 15 },
      )
      await board.keyboard.down('Shift')
      await board.mouse.click(n3!.x + n3!.w / 2, n3!.y + n3!.h / 2)
      await expect(count).toHaveText('3 selected')
      await board.mouse.click(n3!.x + n3!.w / 2, n3!.y + n3!.h / 2)
      await board.keyboard.up('Shift')
      await expect(count).toHaveText('2 selected')

      // 4. The area tool starts a drag on top of a note without moving it, selects only
      //    what lies wholly inside, and hands back to Select.
      await board.getByRole('button', { name: 'Area select' }).click()
      await expect(rail.nth(1)).toHaveAttribute('aria-pressed', 'true')
      await drag(board, { x: n4!.x + 10, y: n4!.y + n4!.h - 10 }, { x: n1!.x - 20, y: n1!.y - 20 })
      const afterArea = await notes(board)
      expect(Math.round(afterArea[3]!.x - n4!.x)).toBe(0)
      expect(Math.round(afterArea[3]!.y - n4!.y)).toBe(0)
      await expect(count).toHaveCount(0)
      const handled = await board.$$eval('g[data-object-kind="sticky"]', (groups) =>
        groups
          .filter((g) => g.querySelector('rect[style*="resize"]'))
          .map((g) => g.getAttribute('data-object-id')),
      )
      expect(handled).toEqual([n1!.id])
      await expect(rail.nth(0)).toHaveAttribute('aria-pressed', 'true')

      // 5. Ctrl+A selects every note on the page; Duplicate copies them all and selects the
      //    copies; Delete removes the copies.
      await board.keyboard.press('Control+a')
      await expect(count).toHaveText('4 selected')
      await board.locator('.wb-format-bar').getByRole('button', { name: 'Duplicate' }).click()
      await expect(board.locator('[data-object-kind="sticky"]')).toHaveCount(8)
      await expect(count).toHaveText('4 selected')
      await board.keyboard.press('Delete')
      await expect(board.locator('[data-object-kind="sticky"]')).toHaveCount(4)
      const kept = (await notes(board)).map((n) => n.id).sort()
      expect(kept).toEqual([n1!.id, n2!.id, n3!.id, n4!.id].sort())
    } finally {
      await closeAndSaveVideo(launched, 'whiteboard-area-select')
    }
  })
})
