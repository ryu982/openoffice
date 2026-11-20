/**
 * Hangul habits a user asked for (2026-10-30 feedback): a double click selects the word under
 * the mouse (a triple click the paragraph, a double-click drag whole words), cells pasted onto a
 * dragged cell block fill those cells instead of landing in one, and copied cells pasted at a
 * caret in a cell go through the 셀 붙이기 dialog. Real mouse events and a real clipboard
 * against the production build.
 */
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Frame, Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { closeAndSaveVideo, launchShell, screenshotPath, waitForPageWithUrl } from './helpers'

const execFileAsync = promisify(execFile)
const REPO_ROOT = join(__dirname, '..')

const STUDIO_IFRAME = '.hwp-editor-host iframe'

interface Studio {
  plugins: {
    load(id: string): Promise<unknown>
    invoke(id: string, method: string, args: unknown[]): unknown
  }
}

interface CellBox {
  row: number
  col: number
  x: number
  y: number
  w: number
  h: number
}

async function openHwp(app: ElectronApplication, page: Page): Promise<Page> {
  await page.locator('.quick-card', { hasText: 'AI HWP' }).click()
  const hwp = await waitForPageWithUrl(app, '://hwp/')
  await hwp.waitForSelector('.hwp-app[data-phase="ready"]', { timeout: 90_000 })
  return hwp
}

async function studioFrame(hwp: Page): Promise<Frame> {
  const deadline = Date.now() + 60_000
  for (;;) {
    const frame = hwp.frames().find((f) => f.url().includes('/studio/'))
    if (frame) return frame
    if (Date.now() > deadline) throw new Error('studio frame never loaded')
    await hwp.waitForTimeout(100)
  }
}

async function canvasBox(hwp: Page) {
  const canvas = hwp.frameLocator(STUDIO_IFRAME).locator('#scroll-content canvas').first()
  await canvas.waitFor({ timeout: 60_000 })
  return (await canvas.boundingBox())!
}

async function selectedText(frame: Frame): Promise<string> {
  return frame.evaluate(async () => {
    const studio = (window as unknown as { rhwpStudio: Studio }).rhwpStudio
    await studio.plugins.load('ieum-agent')
    const read = (await studio.plugins.invoke('ieum-agent', 'selection', [])) as {
      segments?: { text: string }[]
    } | null
    return (read?.segments ?? []).map((segment) => segment.text).join('|')
  })
}

async function cellTexts(frame: Frame): Promise<string[]> {
  return frame.evaluate(async () => {
    const studio = (window as unknown as { rhwpStudio: Studio }).rhwpStudio
    await studio.plugins.load('ieum-agent')
    const read = (await studio.plugins.invoke('ieum-agent', 'readTable', [1])) as {
      cells: { row: number; col: number; text: string }[]
    }
    return read.cells.map((cell) => cell.text)
  })
}

/** The first table's cell boxes in page coordinates, from the engine. */
async function cellBoxes(frame: Frame): Promise<CellBox[]> {
  return frame.evaluate(() => {
    const studio = (
      window as unknown as {
        rhwpStudio: {
          automation: {
            registerCommand(def: { id: string; label: string; execute(s: unknown): void }): void
            execute(id: string): void
          }
          __cellBoxes?: boolean
        }
      }
    ).rhwpStudio
    if (!studio.__cellBoxes) {
      studio.automation.registerCommand({
        id: 'ext:e2e-cell-boxes',
        label: 'E2E cell boxes',
        execute(services) {
          const s = services as {
            wasm: { getTableCellBboxes(sec: number, ppi: number, ci: number): unknown }
            getInputHandler(): {
              getCursorPosition(): {
                sectionIndex: number
                parentParaIndex?: number
                controlIndex?: number
              }
            }
          }
          const pos = s.getInputHandler().getCursorPosition()
          ;(window as unknown as { __boxes: unknown }).__boxes = s.wasm.getTableCellBboxes(
            pos.sectionIndex,
            pos.parentParaIndex!,
            pos.controlIndex!,
          )
        },
      })
      studio.__cellBoxes = true
    }
    studio.automation.execute('ext:e2e-cell-boxes')
    return (window as unknown as { __boxes: CellBox[] }).__boxes
  })
}

async function caret(frame: Frame): Promise<{ paragraphIndex: number; charOffset: number }> {
  return frame.evaluate(() => {
    const studio = (
      window as unknown as {
        rhwpStudio: {
          automation: {
            registerCommand(def: { id: string; label: string; execute(s: unknown): void }): void
            execute(id: string): void
          }
          __caret?: boolean
        }
      }
    ).rhwpStudio
    if (!studio.__caret) {
      studio.automation.registerCommand({
        id: 'ext:e2e-caret',
        label: 'E2E caret',
        execute(services) {
          const s = services as {
            getInputHandler(): {
              getCursorPosition(): { paragraphIndex: number; charOffset: number }
            }
          }
          const pos = s.getInputHandler().getCursorPosition()
          ;(window as unknown as { __caret: unknown }).__caret = {
            paragraphIndex: pos.paragraphIndex,
            charOffset: pos.charOffset,
          }
        },
      })
      studio.__caret = true
    }
    studio.automation.execute('ext:e2e-caret')
    return (window as unknown as { __caret: { paragraphIndex: number; charOffset: number } })
      .__caret
  })
}

async function insertTable(frame: Frame, rows: number, cols: number): Promise<void> {
  await frame.locator('#menu-bar .menu-item[data-menu="table"] .menu-title').click()
  await frame.locator('.md-item[data-cmd="table:create"]').click()
  const grid = frame.locator(`div[data-row="${rows - 1}"][data-col="${cols - 1}"]`)
  await grid.hover()
  await grid.click()
}

test.describe('hwp: double click and cell paste', () => {
  test('double click selects a word; cells pasted onto a dragged block fill it', async () => {
    test.setTimeout(240_000)
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'hwp-cell-paste' })
    const { app, page } = launched
    try {
      const hwp = await openHwp(app, page)
      const frame = await studioFrame(hwp)
      const box = await canvasBox(hwp)

      // a body line, then a double click inside it: one whole word is selected
      await hwp.mouse.click(box.x + 160, box.y + 145)
      await hwp.keyboard.type('alpha bravo charlie delta echo foxtrot golf hotel india juliet')
      await hwp.mouse.dblclick(box.x + 160, box.y + 145)
      await expect
        .poll(() => selectedText(frame))
        .toMatch(/^(alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet)$/)

      // a 3×3 table on the next line
      await hwp.keyboard.press('End')
      await hwp.keyboard.press('Enter')
      await insertTable(frame, 3, 3)
      await hwp.keyboard.type('hello world')
      const cells = await cellBoxes(frame)
      const first = cells.find((cell) => cell.row === 0 && cell.col === 0)!
      const last = cells.find((cell) => cell.row === 2 && cell.col === 2)!

      // a double click on the first word of a cell selects that word only
      await hwp.mouse.dblclick(box.x + first.x + 14, box.y + first.y + first.h / 2)
      await expect.poll(() => selectedText(frame)).toBe('hello')

      // spreadsheet cells on the clipboard, the whole table dragged, Ctrl+V
      await app.evaluate(({ clipboard }) => {
        clipboard.write({
          text: '1\t2\t3\r\n4\t5\t6\r\n7\t8\t9\r\n',
          html:
            '<table><tr><td>1</td><td>2</td><td>3</td></tr>' +
            '<tr><td>4</td><td>5</td><td>6</td></tr>' +
            '<tr><td>7</td><td>8</td><td>9</td></tr></table>',
        })
      })
      await hwp.mouse.move(box.x + first.x + first.w / 2, box.y + first.y + first.h / 2)
      await hwp.mouse.down()
      await hwp.mouse.move(box.x + last.x + last.w / 2, box.y + last.y + last.h / 2, {
        steps: 10,
      })
      await hwp.mouse.up()
      await hwp.waitForTimeout(300)
      await hwp.keyboard.press('Control+v')
      await expect
        .poll(() => cellTexts(frame))
        .toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])

      // one undo step brings the old cells back
      await hwp.keyboard.press('Control+z')
      await expect
        .poll(() => cellTexts(frame))
        .toEqual(['hello world', '', '', '', '', '', '', '', ''])
    } finally {
      await closeAndSaveVideo(launched, 'hwp-cell-paste')
    }
  })
})

async function tableTexts(frame: Frame, table: number): Promise<string[][]> {
  return frame.evaluate(async (table) => {
    const studio = (window as unknown as { rhwpStudio: Studio }).rhwpStudio
    await studio.plugins.load('ieum-agent')
    const read = (await studio.plugins.invoke('ieum-agent', 'readTable', [table])) as {
      rows: number
      cells: { row: number; col: number; text: string }[]
    }
    const rows: string[][] = Array.from({ length: read.rows }, () => [])
    for (const cell of read.cells) rows[cell.row - 1]![cell.col - 1] = cell.text
    return rows.map((row) => Array.from(row, (text) => text ?? ''))
  }, table)
}

async function tableCount(frame: Frame): Promise<number> {
  return frame.evaluate(async () => {
    const studio = (window as unknown as { rhwpStudio: Studio }).rhwpStudio
    await studio.plugins.load('ieum-agent')
    const listed = (await studio.plugins.invoke('ieum-agent', 'listTables', [])) as {
      count: number
    }
    return listed.count
  })
}

test.describe('hwp: Hangul clicks and copied cells', () => {
  test('triple click and word drag; copied cells paste through 셀 붙이기 and as a table', async () => {
    test.setTimeout(300_000)
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'hwp-cell-paste-2' })
    const { app, page } = launched
    const scratchDir = await mkdtemp(join(tmpdir(), 'hwp-cell-paste-'))
    try {
      const hwp = await openHwp(app, page)
      const frame = await studioFrame(hwp)
      const box = await canvasBox(hwp)
      const lineY = box.y + 145

      // a triple click selects the paragraph
      await hwp.mouse.click(box.x + 160, lineY)
      await hwp.keyboard.type('alpha bravo charlie delta')
      await hwp.mouse.click(box.x + 160, lineY, { clickCount: 3 })
      await expect.poll(() => selectedText(frame)).toBe('alpha bravo charlie delta')

      // a double click held down and dragged selects whole words
      await hwp.mouse.click(box.x + 400, lineY)
      const first = hwp.mouse
      await first.move(box.x + 125, lineY)
      await first.down({ clickCount: 1 })
      await first.up({ clickCount: 1 })
      await first.down({ clickCount: 2 })
      await first.move(box.x + 215, lineY, { steps: 8 })
      await first.up({ clickCount: 2 })
      await expect.poll(() => selectedText(frame)).toMatch(/^alpha bravo( charlie)?$/)
      // on Linux CI the keys below outran the end of the word drag and the table never landed
      await hwp.waitForTimeout(300)

      // two 3×3 tables, the first filled
      await hwp.keyboard.press('End')
      await hwp.keyboard.press('Enter')
      await expect.poll(() => caret(frame)).toEqual({ paragraphIndex: 1, charOffset: 0 })
      await insertTable(frame, 3, 3)
      await expect.poll(() => tableCount(frame)).toBe(1)
      for (let i = 1; i <= 9; i += 1) {
        await hwp.keyboard.type(String(i))
        if (i < 9) await hwp.keyboard.press('Tab')
      }
      await expect.poll(async () => (await cellBoxes(frame)).length).toBe(9)
      const cells = await cellBoxes(frame)
      const topLeft = cells.find((cell) => cell.row === 0 && cell.col === 0)!
      const bottomRight = cells.find((cell) => cell.row === 2 && cell.col === 2)!
      await hwp.keyboard.press('Control+End')
      await hwp.keyboard.press('Enter')
      await insertTable(frame, 3, 3)
      const t2Top = bottomRight.y + bottomRight.h + 30

      // the whole first table dragged and copied: text and a table on the clipboard
      const drag = async () => {
        await hwp.mouse.move(box.x + topLeft.x + topLeft.w / 2, box.y + topLeft.y + topLeft.h / 2)
        await hwp.mouse.down()
        await hwp.mouse.move(
          box.x + bottomRight.x + bottomRight.w / 2,
          box.y + bottomRight.y + bottomRight.h / 2,
          { steps: 10 },
        )
        await hwp.mouse.up()
        await hwp.waitForTimeout(300)
      }
      await drag()
      await hwp.keyboard.press('Control+c')
      await expect
        .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
        .toBe('1\t2\t3\n4\t5\t6\n7\t8\t9')
      expect(await app.evaluate(({ clipboard }) => clipboard.readHTML())).toContain('<table')

      // the caret in the second table's first cell, Ctrl+V: the 셀 붙이기 dialog, overwrite
      const t2Cell = async () => {
        // somewhere in the second table, then exactly its first cell
        await hwp.mouse.click(box.x + topLeft.x + topLeft.w / 2, box.y + t2Top)
        await hwp.waitForTimeout(300)
        const t2 = (await cellBoxes(frame)).find((cell) => cell.row === 0 && cell.col === 0)!
        expect(t2.y).toBeGreaterThan(bottomRight.y)
        await hwp.mouse.click(box.x + t2.x + t2.w / 2, box.y + t2.y + t2.h / 2)
        await hwp.waitForTimeout(300)
      }
      await t2Cell()
      await hwp.keyboard.press('Control+v')
      const dialog = frame.locator('.dialog-wrap', {
        has: frame.locator('[name="ieum-cell-paste"]'),
      })
      await expect(dialog).toBeVisible()
      await expect(dialog.locator('[name="ieum-cell-paste"][value="overwrite"]')).toBeChecked()
      await expect(dialog.locator('[name="ieum-cell-paste"][value="nested"]')).toBeEnabled()
      await hwp.keyboard.press('Enter')
      await expect(dialog).toHaveCount(0)
      await expect
        .poll(() => tableTexts(frame, 2))
        .toEqual([
          ['1', '2', '3'],
          ['4', '5', '6'],
          ['7', '8', '9'],
        ])
      await hwp.keyboard.press('Control+z')
      await expect
        .poll(() => tableTexts(frame, 2))
        .toEqual([
          ['', '', ''],
          ['', '', ''],
          ['', '', ''],
        ])

      // again, inserting below the caret's row: three new rows under the first
      await t2Cell()
      await hwp.keyboard.press('Control+v')
      await dialog.locator('[name="ieum-cell-paste"][value="down"]').check()
      await dialog.locator('.dialog-btn-primary').click()
      await expect
        .poll(() => tableTexts(frame, 2))
        .toEqual([
          ['', '', ''],
          ['1', '2', '3'],
          ['4', '5', '6'],
          ['7', '8', '9'],
          ['', '', ''],
          ['', '', ''],
        ])
      await hwp.keyboard.press('Control+z')

      // again, 셀 안에 표로 넣기: the copied 3×3 goes into the caret's cell as a table
      await t2Cell()
      const host = await caretCell(frame)
      const hostBefore = await hostState(frame, host)
      expect(hostBefore.inner).toBeNull()
      await hwp.keyboard.press('Control+v')
      await dialog.locator('[name="ieum-cell-paste"][value="nested"]').check()
      await dialog.locator('.dialog-btn-primary').click()
      await expect(dialog).toHaveCount(0)
      const pasted = {
        cells: hostBefore.cells,
        inner: {
          dims: { rowCount: 3, colCount: 3, cellCount: 9 },
          texts: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
          widths: hostBefore.sourceWidths,
          treatAsChar: true,
          outer: [141, 141, 141, 141],
        },
      }
      await expect
        .poll(async () => {
          const now = await hostState(frame, host)
          return { cells: now.cells, inner: now.inner }
        })
        .toEqual(pasted)
      // the host row grows with the new table; the grid stays 3×3
      const hostAfter = await hostState(frame, host)
      expect(hostAfter.dims).toEqual(hostBefore.dims)
      expect(hostAfter.rowHeight).toBeGreaterThan(hostBefore.rowHeight + 1000)
      await hwp.screenshot({ path: screenshotPath('hwp-cell-paste-nested') })
      // one undo step takes it back, redo puts it again
      await hwp.keyboard.press('Control+z')
      await expect.poll(async () => (await hostState(frame, host)).inner).toBeNull()
      expect((await hostState(frame, host)).cells).toEqual(hostBefore.cells)
      await hwp.keyboard.press('Control+Shift+z')
      await expect.poll(async () => (await hostState(frame, host)).inner).toEqual(pasted.inner)
      // saved as .hwp and .hwpx, the document opens again with the table in the cell
      for (const kind of ['hwp', 'hwpx'] as const) {
        const file = join(scratchDir, `nested.${kind}`)
        await writeFile(file, Buffer.from(await exported(frame, kind), 'base64'))
        expect(await savedInner(file, host), kind).toEqual({
          host: { rowCount: 3, colCount: 3, cellCount: 9 },
          inner: { rowCount: 3, colCount: 3, cellCount: 9 },
        })
      }
      await hwp.keyboard.press('Control+z')
      await expect.poll(async () => (await hostState(frame, host)).inner).toBeNull()

      // in the body text, Ctrl+V makes the copied table again
      await hwp.mouse.click(box.x + 400, lineY)
      await hwp.keyboard.press('End')
      await hwp.keyboard.press('Control+v')
      await expect.poll(() => tableCount(frame)).toBe(3)
      await expect
        .poll(() => tableTexts(frame, 1))
        .toEqual([
          ['1', '2', '3'],
          ['4', '5', '6'],
          ['7', '8', '9'],
        ])
    } finally {
      await closeAndSaveVideo(launched, 'hwp-cell-paste-2')
      await rm(scratchDir, { recursive: true, force: true })
    }
  })
})

interface HostCell {
  sec: number
  ppi: number
  ci: number
  cell: number
}

interface TableDims {
  rowCount: number
  colCount: number
  cellCount: number
}

interface HostState {
  dims: TableDims
  /** The host table's cells' text, the caret's cell left out. */
  cells: string[]
  /** The caret cell's row height on the page, in HWPUNIT. */
  rowHeight: number
  /** The widths of the host's first row, as the copy's source was made, in HWPUNIT. */
  sourceWidths: number[]
  inner: {
    dims: TableDims
    texts: string[]
    widths: number[]
    treatAsChar: boolean
    outer: number[]
  } | null
}

type PasteProbe =
  { op: 'where' } | { op: 'state'; host: HostCell } | { op: 'export'; kind: 'hwp' | 'hwpx' }

/** Reads the document through the editor's own engine (a command the test registers). */
async function pasteProbe<T>(frame: Frame, call: PasteProbe): Promise<T> {
  return frame.evaluate((c) => {
    type W = Record<string, (...args: unknown[]) => unknown>
    const win = window as unknown as {
      rhwpStudio: {
        automation: {
          registerCommand(def: { id: string; label: string; execute(s: unknown): void }): void
          execute(id: string): void
        }
        __pasteProbe?: boolean
      }
      __pasteCall?: PasteProbe
      __pasteOut?: unknown
    }
    const studio = win.rhwpStudio
    if (!studio.__pasteProbe) {
      studio.automation.registerCommand({
        id: 'ext:e2e-nested-paste',
        label: 'E2E nested paste probe',
        execute(raw) {
          const services = raw as {
            wasm: W
            getInputHandler(): { getCursorPosition(): Record<string, number> }
          }
          const w = services.wasm
          const J = JSON.stringify
          const call = win.__pasteCall!
          if (call.op === 'where') {
            const pos = services.getInputHandler().getCursorPosition()
            win.__pasteOut = {
              sec: pos.sectionIndex,
              ppi: pos.parentParaIndex,
              ci: pos.controlIndex,
              cell: pos.cellIndex,
            }
            return
          }
          if (call.op === 'export') {
            const bytes = (call.kind === 'hwp' ? w.exportHwp() : w.exportHwpx()) as Uint8Array
            let binary = ''
            for (const byte of bytes) binary += String.fromCharCode(byte)
            win.__pasteOut = btoa(binary)
            return
          }
          const { sec, ppi, ci, cell } = call.host
          type Step = { controlIndex: number; cellIndex: number; cellParaIndex: number }
          const text = (path: Step[]) => {
            const count = w.getCellParagraphCountByPath(sec, ppi, J(path)) as number
            const lines = []
            for (let p = 0; p < count; p += 1) {
              const at = [...path.slice(0, -1), { ...path[path.length - 1]!, cellParaIndex: p }]
              lines.push(String(w.getTextInCellByPath(sec, ppi, J(at), 0, 200)))
            }
            return lines.join('\n')
          }
          const dims = w.getTableDimensions(sec, ppi, ci) as TableDims
          const cells: string[] = []
          for (let i = 0; i < dims.cellCount; i += 1) {
            if (i !== cell) cells.push(text([{ controlIndex: ci, cellIndex: i, cellParaIndex: 0 }]))
          }
          const boxes = w.getTableCellBboxes(sec, ppi, ci) as { h: number }[]
          // the copy's source was made as this table was: its columns are as wide as these
          const sourceWidths: number[] = []
          for (let i = 0; i < dims.colCount; i += 1) {
            const props = w.getCellProperties(sec, ppi, ci, i) as { width: number }
            sourceWidths.push(Number(props.width))
          }
          const innerAt = (i: number): Step[] => [
            { controlIndex: ci, cellIndex: cell, cellParaIndex: 0 },
            { controlIndex: 0, cellIndex: i, cellParaIndex: 0 },
          ]
          let inner: HostState['inner']
          try {
            const innerDims = w.getTableDimensionsByPath(sec, ppi, J(innerAt(0))) as TableDims
            const props = w.getTablePropertiesByPath(sec, ppi, J(innerAt(0))) as Record<
              string,
              number | boolean
            >
            const texts: string[] = []
            const widths: number[] = []
            for (let i = 0; i < innerDims.cellCount; i += 1) {
              texts.push(text(innerAt(i)))
              if (i < innerDims.colCount) {
                const own = w.getCellPropertiesByPath(sec, ppi, J(innerAt(0)), i) as {
                  width: number
                }
                widths.push(Number(own.width))
              }
            }
            inner = {
              dims: innerDims,
              texts,
              widths,
              treatAsChar: Boolean(props.treatAsChar),
              outer: [props.outerLeft, props.outerRight, props.outerTop, props.outerBottom].map(
                Number,
              ),
            }
          } catch {
            inner = null
          }
          // the boxes are page pixels; 75 HWPUNIT to the pixel
          win.__pasteOut = { dims, cells, rowHeight: boxes[cell]!.h * 75, sourceWidths, inner }
        },
      })
      studio.__pasteProbe = true
    }
    win.__pasteCall = c
    win.__pasteOut = undefined
    studio.automation.execute('ext:e2e-nested-paste')
    return win.__pasteOut as T
  }, call)
}

const caretCell = (frame: Frame) => pasteProbe<HostCell>(frame, { op: 'where' })
const hostState = (frame: Frame, host: HostCell) =>
  pasteProbe<HostState>(frame, { op: 'state', host })
const exported = (frame: Frame, kind: 'hwp' | 'hwpx') =>
  pasteProbe<string>(frame, { op: 'export', kind })

/** The host table and the table in its cell, as a saved file opens again in the engine. */
async function savedInner(file: string, host: HostCell): Promise<unknown> {
  const core = pathToFileURL(join(REPO_ROOT, 'vendor/rhwp-core/rhwp.js')).href
  const wasm = join(REPO_ROOT, 'vendor/rhwp-core/rhwp_bg.wasm')
  const inner = [
    { controlIndex: host.ci, cellIndex: host.cell, cellParaIndex: 0 },
    { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 },
  ]
  const script = [
    "import { readFileSync } from 'node:fs'",
    `const { default: init, HwpDocument } = await import(${JSON.stringify(core)})`,
    `await init({ module_or_path: readFileSync(${JSON.stringify(wasm)}) })`,
    'const doc = new HwpDocument(readFileSync(process.argv[1]))',
    `const host = JSON.parse(doc.getTableDimensions(${host.sec}, ${host.ppi}, ${host.ci}))`,
    `const inner = JSON.parse(doc.getTableDimensionsByPath(${host.sec}, ${host.ppi}, ${JSON.stringify(JSON.stringify(inner))}))`,
    'const pick = (d) => ({ rowCount: d.rowCount, colCount: d.colCount, cellCount: d.cellCount })',
    'process.stdout.write(JSON.stringify({ host: pick(host), inner: pick(inner) }))',
  ].join('\n')
  const { stdout } = await execFileAsync(process.execPath, [
    '--input-type=module',
    '-e',
    script,
    file,
  ])
  return JSON.parse(stdout) as unknown
}
