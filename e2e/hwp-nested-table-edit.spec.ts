/**
 * A table inside a table's cell (at any depth) and a table inside a text box take the table keys,
 * menus and dialogs as a body table does: only that table changes, the tables above keep their
 * grid, widths and text, one Ctrl+Z puts the document back and Ctrl+Shift+Z does it again, and the
 * caret stays in the inner table. The commands that cannot reach an inner table yet still leave
 * the document alone and say why. Saved as .hwp and .hwpx the edited document opens again with
 * the edited grid.
 *
 * Fixtures (apps/hwp/tests/fixtures): nested-form.hwp (Hangul's 교과협의록 form, a 6×2 table in a
 * cell of the 5×2 form table), nested-depth2.hwp (2×2 tables two levels down) and
 * textbox-table.hwp (a 2×2 table in a text box).
 */
import { test, expect } from '@playwright/test'
import type { Frame, Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { closeAndSaveVideo, launchShell, screenshotPath, waitForPageWithUrl } from './helpers'

const execFileAsync = promisify(execFile)
const REPO_ROOT = join(__dirname, '..')
const FIXTURES = join(REPO_ROOT, 'apps/hwp/tests/fixtures')

interface Step {
  controlIndex: number
  cellIndex: number
  cellParaIndex: number
}

const step = (controlIndex: number, cellIndex = 0, cellParaIndex = 0): Step => ({
  controlIndex,
  cellIndex,
  cellParaIndex,
})

interface Fixture {
  file: string
  para: number
  /** The path the engine's table calls take to the inner table. */
  inner: Step[]
  /** The tables above it, outermost first. */
  above: Step[][]
  textBox?: boolean
}

const FIXTURES_UNDER_TEST: Fixture[] = [
  { file: 'nested-form.hwp', para: 2, inner: [step(0, 9, 11), step(0)], above: [[step(0)]] },
  {
    file: 'nested-depth2.hwp',
    para: 1,
    inner: [step(0), step(0), step(0)],
    above: [[step(0)], [step(0), step(0)]],
  },
  { file: 'textbox-table.hwp', para: 0, inner: [step(2), step(0)], above: [], textBox: true },
]

interface CellState {
  row: number
  col: number
  rowSpan: number
  colSpan: number
  text: string
  width: number
  height?: number
  fill?: string
  valign?: number
}

interface TableState {
  dims: { rowCount: number; colCount: number; cellCount: number }
  cells: CellState[]
}

interface State {
  inner: TableState
  innerFill: string
  above: TableState[]
  caret: Step[] | null
  block: boolean
  object: Step[] | null
}

type ProbeCall =
  | { op: 'caret'; fx: Fixture; cell: number }
  | { op: 'block'; fx: Fixture; cell: number; focus: [number, number] }
  | { op: 'object'; fx: Fixture }
  | { op: 'plain' }
  | { op: 'state'; fx: Fixture }
  | { op: 'export'; kind: 'hwp' | 'hwpx' }

interface StudioLike {
  automation: {
    execute(
      id: string,
      params?: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): unknown
    registerCommand(def: { id: string; label: string; execute(services: unknown): void }): void
  }
  __nestedEditProbe?: boolean
}

declare global {
  interface Window {
    __e2eCall?: ProbeCall
    __e2eOut?: unknown
  }
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

/** One automation command that places the caret or a block, and reads the document. */
async function installProbe(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    const studio = (window as unknown as { rhwpStudio: StudioLike }).rhwpStudio
    if (studio.__nestedEditProbe) return
    type Services = {
      wasm: Record<string, (...args: unknown[]) => unknown>
      eventBus: { emit(name: string, ...args: unknown[]): void }
      getInputHandler(): {
        cursor: Record<string, (...args: unknown[]) => unknown>
        updateCaret?(): void
        updateCellSelection?(): void
        caret?: { hide(): void }
      }
    }
    const J = JSON.stringify
    const cellPath = (table: Step[], cell: number): Step[] => [
      ...table.slice(0, -1),
      { controlIndex: table[table.length - 1].controlIndex, cellIndex: cell, cellParaIndex: 0 },
    ]
    const caretAt = (services: Services, fx: Fixture, cell: number) => {
      const ih = services.getInputHandler()
      if (ih.cursor.isInCellSelectionMode()) ih.cursor.exitCellSelectionMode()
      if (ih.cursor.isInTableObjectSelection()) {
        ih.cursor.exitTableObjectSelection()
        services.eventBus.emit('table-object-selection-changed', false)
      }
      const path = cellPath(fx.inner, cell)
      ih.cursor.moveTo({
        sectionIndex: 0,
        paragraphIndex: 0,
        charOffset: 0,
        parentParaIndex: fx.para,
        controlIndex: path[0].controlIndex,
        cellIndex: cell,
        cellParaIndex: 0,
        cellPath: path,
        ...(fx.textBox ? { isTextBox: true } : {}),
      })
      ih.updateCaret?.()
    }
    const table = (services: Services, para: number, path: Step[], full: boolean) => {
      const w = services.wasm
      const dims = w.getTableDimensionsByPath(0, para, J(path)) as TableState['dims']
      const cells: CellState[] = []
      for (let cell = 0; cell < dims.cellCount; cell += 1) {
        const at = J(cellPath(path, cell))
        const info = w.getCellInfoByPath(0, para, at) as Omit<CellState, 'text' | 'width'>
        const props = w.getCellPropertiesByPath(0, para, J(path), cell) as Record<string, unknown>
        cells.push({
          row: info.row,
          col: info.col,
          rowSpan: info.rowSpan,
          colSpan: info.colSpan,
          text: String(w.getTextInCellByPath(0, para, at, 0, 200)),
          width: Number(props.width),
          ...(full
            ? {
                height: Number(props.height),
                fill: `${String(props.fillType)}${String(props.fillColor ?? '')}`,
                valign: Number(props.verticalAlign),
              }
            : {}),
        })
      }
      return { dims, cells }
    }
    studio.automation.registerCommand({
      id: 'ext:e2e-nested-edit',
      label: 'E2E inner table probe',
      execute(raw) {
        const services = raw as Services
        const call = window.__e2eCall!
        const ih = services.getInputHandler()
        if (call.op === 'caret') {
          caretAt(services, call.fx, call.cell)
        } else if (call.op === 'block') {
          caretAt(services, call.fx, call.cell)
          ih.cursor.enterCellSelectionMode()
          ih.cursor.setCellSelectionFocus(call.focus[0], call.focus[1])
          ih.caret?.hide()
          ih.updateCellSelection?.()
        } else if (call.op === 'object') {
          caretAt(services, call.fx, 0)
          ih.cursor.enterTableObjectSelection()
          ih.caret?.hide()
          services.eventBus.emit('table-object-selection-changed', true)
        } else if (call.op === 'plain') {
          if (ih.cursor.isInCellSelectionMode()) ih.cursor.exitCellSelectionMode()
          if (ih.cursor.isInTableObjectSelection()) {
            ih.cursor.exitTableObjectSelection()
            services.eventBus.emit('table-object-selection-changed', false)
          }
          ih.updateCaret?.()
        } else if (call.op === 'state') {
          const fx = call.fx
          const pos = ih.cursor.getPosition() as { cellPath?: Step[] }
          const ref = ih.cursor.getSelectedTableRef() as { cellPath?: Step[] } | null
          // the inner table's own fill (a bridge without the path call reads as none)
          const props = (services.wasm.getTablePropertiesByPath?.(0, fx.para, J(fx.inner)) ??
            {}) as Record<string, unknown>
          window.__e2eOut = {
            inner: table(services, fx.para, fx.inner, true),
            innerFill: `${String(props.fillType)}${String(props.fillColor ?? '')}`,
            above: fx.above.map((path) => table(services, fx.para, path, false)),
            caret: pos.cellPath ?? null,
            block: Boolean(ih.cursor.isInCellSelectionMode()),
            object: ih.cursor.isInTableObjectSelection() ? (ref?.cellPath ?? []) : null,
          }
        } else if (call.op === 'export') {
          const bytes = (
            call.kind === 'hwp' ? services.wasm.exportHwp() : services.wasm.exportHwpx()
          ) as Uint8Array
          let binary = ''
          for (const byte of bytes) binary += String.fromCharCode(byte)
          window.__e2eOut = btoa(binary)
        }
      },
    })
    studio.__nestedEditProbe = true
  })
}

async function probe<T = unknown>(frame: Frame, call: ProbeCall): Promise<T> {
  return frame.evaluate((c) => {
    const studio = (window as unknown as { rhwpStudio: StudioLike }).rhwpStudio
    window.__e2eCall = c
    window.__e2eOut = undefined
    studio.automation.execute('ext:e2e-nested-edit')
    return window.__e2eOut as T
  }, call)
}

const state = (frame: Frame, fx: Fixture) => probe<State>(frame, { op: 'state', fx })

async function command(frame: Frame, id: string): Promise<unknown> {
  return frame.evaluate((cmd) => {
    const studio = (window as unknown as { rhwpStudio: StudioLike }).rhwpStudio
    return studio.automation.execute(cmd)
  }, id)
}

async function focusInput(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    const input = document.querySelector('textarea') as HTMLTextAreaElement | null
    input?.focus()
  })
}

async function toast(frame: Frame): Promise<string> {
  return frame.evaluate(
    () => document.getElementById('rhwp-toast-container')?.textContent?.trim() ?? '',
  )
}

async function clearToasts(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    const box = document.getElementById('rhwp-toast-container')
    if (box) box.textContent = ''
  })
}

/** The open dialog's OK. */
async function confirmDialog(frame: Frame): Promise<void> {
  const ok = frame.locator('.modal-overlay .dialog-btn-primary').last()
  await ok.waitFor({ timeout: 5_000 })
  await ok.click()
  await expect(frame.locator('.modal-overlay')).toHaveCount(0, { timeout: 5_000 })
}

/** In the open dialog: the background tab, a solid fill of `color`, OK. */
async function fillInDialog(frame: Frame, color: string): Promise<void> {
  await frame.locator('.modal-overlay').last().waitFor({ timeout: 5_000 })
  await frame.evaluate((value) => {
    const dialogs = document.querySelectorAll('.modal-overlay')
    const dialog = dialogs[dialogs.length - 1]
    const tab = dialog.querySelector('.dialog-tab[data-tab="background"]') as HTMLElement | null
    tab?.click()
    const panel = dialog.querySelector('.dialog-tab-panel[data-tab="background"]')!
    const picker = panel.querySelector('input[type="color"]') as HTMLInputElement
    picker.value = value
    picker.dispatchEvent(new Event('input', { bubbles: true }))
    picker.dispatchEvent(new Event('change', { bubbles: true }))
  }, color)
  await confirmDialog(frame)
}

/** In the open 표/셀 속성: the cell's vertical alignment to the bottom, OK. */
async function alignBottomInDialog(frame: Frame): Promise<void> {
  await frame.locator('.modal-overlay').last().waitFor({ timeout: 5_000 })
  await frame.evaluate(() => {
    const dialogs = document.querySelectorAll('.modal-overlay')
    const dialog = dialogs[dialogs.length - 1]
    const cellTab = dialog.querySelector('.dialog-tab[data-tab="cell"]') as HTMLElement | null
    cellTab?.click()
    const bottom = [...dialog.querySelectorAll('button')].find((b) => b.textContent === '아래쪽')
    bottom?.click()
  })
  await confirmDialog(frame)
}

/** In the open 줄/칸 추가하기 or 지우기: pick a mode (and a count), OK. */
async function rowColumnDialog(frame: Frame, mode: string, count?: number): Promise<void> {
  await frame.locator('.modal-overlay').last().waitFor({ timeout: 5_000 })
  await frame.evaluate(
    ([value, n]) => {
      const dialogs = document.querySelectorAll('.modal-overlay')
      const dialog = dialogs[dialogs.length - 1]
      const radio = dialog.querySelector(
        `input[type="radio"][value="${value}"]`,
      ) as HTMLInputElement
      radio.checked = true
      radio.dispatchEvent(new Event('change', { bubbles: true }))
      if (n !== undefined) {
        const input = dialog.querySelector('input[type="number"]') as HTMLInputElement
        input.value = String(n)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    },
    [mode, count] as const,
  )
  await confirmDialog(frame)
}

/** The inner table's cells by row and column. */
const at = (s: State, row: number, col: number) =>
  s.inner.cells.find((c) => c.row === row && c.col === col)!
const sum = (s: State, row: number) =>
  s.inner.cells.filter((c) => c.row === row).reduce((total, c) => total + c.width, 0)

/** Whether a cell path is in a cell of the fixture's inner table. */
function inInner(path: Step[] | null, fx: Fixture): boolean {
  if (!path || path.length !== fx.inner.length) return false
  const n = fx.inner.length
  return (
    path.slice(0, n - 1).every((s, i) => JSON.stringify(s) === JSON.stringify(fx.inner[i])) &&
    path[n - 1].controlIndex === fx.inner[n - 1].controlIndex
  )
}

/** Dimensions of tables in a saved file, read with the engine build the editor runs. */
async function savedDims(file: string, para: number, paths: Step[][]): Promise<unknown[]> {
  const core = pathToFileURL(join(REPO_ROOT, 'vendor/rhwp-core/rhwp.js')).href
  const wasm = join(REPO_ROOT, 'vendor/rhwp-core/rhwp_bg.wasm')
  const script = [
    "import { readFileSync } from 'node:fs'",
    `const { default: init, HwpDocument } = await import(${JSON.stringify(core)})`,
    `await init({ module_or_path: readFileSync(${JSON.stringify(wasm)}) })`,
    'const doc = new HwpDocument(readFileSync(process.argv[1]))',
    `const paths = ${JSON.stringify(paths)}`,
    `process.stdout.write(JSON.stringify(paths.map((p) => JSON.parse(doc.getTableDimensionsByPath(0, ${para}, JSON.stringify(p))))))`,
  ].join('\n')
  const { stdout } = await execFileAsync(process.execPath, [
    '--input-type=module',
    '-e',
    script,
    file,
  ])
  return JSON.parse(stdout) as unknown[]
}

interface Case {
  name: string
  /** Where the caret, block or selection is before the input. */
  place: (fx: Fixture) => ProbeCall
  act: (frame: Frame, hwp: Page, fx: Fixture) => Promise<void>
  /** What the input did to the inner table. */
  check: (before: State, after: State, fx: Fixture) => void
  /** Where the caret goes: in a cell of the inner table, or on a block or the table selected. */
  after?: 'caret' | 'block' | 'object'
}

const caret =
  (cell = 0) =>
  (fx: Fixture): ProbeCall => ({ op: 'caret', fx, cell })
const block =
  (cell: number, focus: [number, number]) =>
  (fx: Fixture): ProbeCall => ({
    op: 'block',
    fx,
    cell,
    focus,
  })
const object =
  () =>
  (fx: Fixture): ProbeCall => ({ op: 'object', fx })
const key = (combo: string) => async (frame: Frame, hwp: Page) => {
  await focusInput(frame)
  await hwp.keyboard.press(combo)
}
const rows = (delta: number) => (before: State, after: State) => {
  expect(after.inner.dims.rowCount).toBe(before.inner.dims.rowCount + delta)
  expect(after.inner.dims.colCount).toBe(before.inner.dims.colCount)
}
const cols = (delta: number) => (before: State, after: State) => {
  expect(after.inner.dims.colCount).toBe(before.inner.dims.colCount + delta)
  expect(after.inner.dims.rowCount).toBe(before.inner.dims.rowCount)
}
const lastCell = (fx: Fixture) => (fx.file === 'nested-form.hwp' ? 11 : 3)

const RED = '#ff0000'

const CASES: Case[] = [
  { name: 'Ctrl+Enter', place: caret(0), act: key('Control+Enter'), check: rows(1) },
  { name: 'Ctrl+Backspace', place: caret(0), act: key('Control+Backspace'), check: rows(-1) },
  {
    name: 'Tab in the last cell',
    place: (fx) => caret(lastCell(fx))(fx),
    act: key('Tab'),
    check: (before, after) => {
      rows(1)(before, after)
      // the caret goes to the new row's first cell
      const cell = after.caret![after.caret!.length - 1].cellIndex
      const placed = after.inner.cells[cell]
      expect([placed.row, placed.col]).toEqual([before.inner.dims.rowCount, 0])
    },
  },
  {
    name: 'Alt+Insert, two rows below (one undo step)',
    place: caret(0),
    act: async (frame, hwp) => {
      await key('Alt+Insert')(frame, hwp)
      await rowColumnDialog(frame, 'row-below', 2)
    },
    check: rows(2),
  },
  {
    name: 'Alt+Insert, a column on the left',
    place: caret(0),
    act: async (frame, hwp) => {
      await key('Alt+Insert')(frame, hwp)
      await rowColumnDialog(frame, 'col-left')
    },
    check: cols(1),
  },
  {
    name: 'Alt+Delete, the row',
    place: caret(0),
    act: async (frame, hwp) => {
      await key('Alt+Delete')(frame, hwp)
      await rowColumnDialog(frame, 'row')
    },
    check: rows(-1),
  },
  {
    name: 'Alt+Delete, the column',
    place: caret(0),
    act: async (frame, hwp) => {
      await key('Alt+Delete')(frame, hwp)
      await rowColumnDialog(frame, 'col')
    },
    check: cols(-1),
  },
  {
    name: 'the table menu’s 줄/칸 추가하기',
    place: caret(0),
    act: async (frame) => {
      await frame.locator('#menu-bar .menu-item[data-menu="table"] .menu-title').click()
      await frame.locator('.md-item[data-cmd="table:insert-row-col"]').click()
      await rowColumnDialog(frame, 'row-above')
    },
    check: rows(1),
  },
  {
    name: 'the right-click menu’s 줄/칸 추가하기',
    place: caret(0),
    act: async (frame, hwp) => {
      const box = await frame.locator('.caret').first().boundingBox()
      expect(box).toBeTruthy()
      await hwp.mouse.click(box!.x + 2, box!.y + box!.height / 2, { button: 'right' })
      await frame.locator('.context-menu .md-item[data-cmd="table:insert-row-col"]').click()
      await rowColumnDialog(frame, 'col-right')
    },
    check: cols(1),
  },
  ...(
    [
      ['table:insert-row-above', rows(1)],
      ['table:insert-row-below', rows(1)],
      ['table:insert-col-left', cols(1)],
      ['table:insert-col-right', cols(1)],
      ['table:delete-row', rows(-1)],
      ['table:delete-col', cols(-1)],
    ] as const
  ).map(([id, check]): Case => ({
    name: `the ${id} command`,
    place: caret(0),
    act: async (frame) => {
      expect(await command(frame, id)).toMatchObject({ ok: true })
    },
    check,
  })),
  {
    name: 'M on a block of two cells',
    place: block(0, [0, 1]),
    act: key('m'),
    check: (before, after) => {
      expect(after.inner.dims.cellCount).toBe(before.inner.dims.cellCount - 1)
      expect(at(after, 0, 0).colSpan).toBe(2)
    },
  },
  {
    name: 'S on a cell, through the split dialog',
    place: block(0, [0, 0]),
    act: async (frame, hwp) => {
      await key('s')(frame, hwp)
      await confirmDialog(frame)
    },
    check: (before, after) => {
      expect(after.inner.dims.cellCount).toBeGreaterThan(before.inner.dims.cellCount)
    },
  },
  ...(['l', 'c'] as const).map((letter): Case => ({
    name: `${letter.toUpperCase()} on a block (each cell)`,
    place: block(0, [0, 1]),
    act: async (frame, hwp) => {
      await key(letter)(frame, hwp)
      await fillInDialog(frame, RED)
    },
    check: (before, after) => {
      expect(at(after, 0, 0).fill).toContain('ff0000')
      expect(at(after, 0, 1).fill).toContain('ff0000')
      expect(at(after, 1, 0).fill).toBe(at(before, 1, 0).fill)
    },
    after: 'block',
  })),
  ...(['b', 'f'] as const).map((letter): Case => ({
    name: `${letter.toUpperCase()} on a block (as one cell)`,
    place: block(0, [0, 1]),
    act: async (frame, hwp) => {
      await key(letter)(frame, hwp)
      await fillInDialog(frame, RED)
    },
    check: (before, after) => {
      expect(at(after, 0, 0).fill).toContain('ff0000')
      expect(at(after, 1, 1).fill).toBe(at(before, 1, 1).fill)
    },
    after: 'block',
  })),
  {
    name: 'P on a block (표/셀 속성, every cell of the block)',
    place: block(0, [0, 1]),
    act: async (frame, hwp) => {
      await key('p')(frame, hwp)
      await alignBottomInDialog(frame)
    },
    check: (before, after) => {
      expect(at(after, 0, 0).valign).toBe(2)
      expect(at(after, 0, 1).valign).toBe(2)
      expect(at(after, 1, 0).valign).toBe(at(before, 1, 0).valign)
    },
    after: 'block',
  },
  {
    name: 'the table menu’s 표/셀 속성 from a cell',
    place: caret(0),
    act: async (frame) => {
      await frame.locator('#menu-bar .menu-item[data-menu="table"] .menu-title').click()
      await frame.locator('.md-item[data-cmd="table:cell-props"]').click()
      await alignBottomInDialog(frame)
    },
    check: (before, after) => {
      expect(at(after, 0, 0).valign).toBe(2)
      expect(at(after, 0, 1).valign).toBe(at(before, 0, 1).valign)
    },
  },
  ...(['p', 'l', 'c'] as const).map((letter): Case => ({
    name: `${letter.toUpperCase()} on the inner table selected as an object`,
    place: object(),
    act: async (frame, hwp) => {
      await key(letter)(frame, hwp)
      await fillInDialog(frame, RED)
    },
    check: (before, after) => {
      expect(after.innerFill).toContain('ff0000')
      expect(before.innerFill).not.toContain('ff0000')
    },
    after: 'object',
  })),
  {
    name: 'Shift+Right on a cell (one cell boundary)',
    place: block(0, [0, 0]),
    act: key('Shift+ArrowRight'),
    check: (before, after) => {
      expect(at(after, 0, 0).width).toBeGreaterThan(at(before, 0, 0).width)
      expect(sum(after, 0)).toBe(sum(before, 0))
    },
    after: 'block',
  },
  {
    name: 'Ctrl+Right on a block (the column and the table grow)',
    place: block(0, [1, 0]),
    act: key('Control+ArrowRight'),
    check: (before, after) => {
      expect(at(after, 0, 0).width).toBe(at(before, 0, 0).width + 300)
      expect(sum(after, 0)).toBe(sum(before, 0) + 300)
    },
    after: 'block',
  },
  {
    name: 'Alt+Right on a block (the table keeps its width)',
    place: block(0, [1, 0]),
    act: key('Alt+ArrowRight'),
    check: (before, after) => {
      expect(at(after, 0, 0).width).toBe(at(before, 0, 0).width + 300)
      expect(sum(after, 0)).toBe(sum(before, 0))
    },
    after: 'block',
  },
  {
    name: 'Shift+Right on the selected table (every column grows)',
    place: object(),
    act: key('Shift+ArrowRight'),
    check: (before, after) => {
      expect(at(after, 0, 0).width).toBe(at(before, 0, 0).width + 300)
      expect(at(after, 0, 1).width).toBe(at(before, 0, 1).width + 300)
    },
    after: 'object',
  },
]

/** Widths made unequal first, then H/W evens them (two steps, each undone on its own). */
const EQUALIZE: Case[] = [
  {
    name: 'W on the whole table',
    place: (fx) => block(0, [fx.file === 'nested-form.hwp' ? 5 : 1, 1])(fx),
    act: key('w'),
    check: (before, after) => {
      expect(Math.abs(at(after, 0, 0).width - at(after, 0, 1).width)).toBeLessThanOrEqual(1)
      expect(sum(after, 0)).toBe(sum(before, 0))
    },
    after: 'block',
  },
  {
    name: 'H on the whole table',
    place: (fx) => block(0, [fx.file === 'nested-form.hwp' ? 5 : 1, 1])(fx),
    act: key('h'),
    check: (before, after) => {
      expect(new Set(before.inner.cells.map((c) => c.height)).size).toBeGreaterThan(1)
      expect(new Set(after.inner.cells.map((c) => c.height)).size).toBe(1)
    },
    after: 'block',
  },
]

/** The commands that still cannot reach an inner table. */
const REFUSED: { name: string; place: (fx: Fixture) => ProbeCall; act: Case['act'] }[] = [
  {
    name: 'table:split',
    place: caret(0),
    act: async (frame) => void (await command(frame, 'table:split')),
  },
  {
    name: 'table:thousand-sep',
    place: caret(0),
    act: async (frame) => void (await command(frame, 'table:thousand-sep')),
  },
  { name: 'T (flip) on the selected table', place: object(), act: key('t') },
]

test.describe.configure({ timeout: 900_000 })

for (const fx of FIXTURES_UNDER_TEST) {
  test(`table keys, menus and dialogs edit the table inside ${fx.file} only`, async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'ieum-nested-edit-'))
    const file = join(scratch, fx.file)
    await copyFile(join(FIXTURES, fx.file), file)
    const launched = await launchShell({
      onboardingSeen: true,
      lang: 'ko',
      videoDir: 'hwp-nested-table-edit',
      recordVideo: false,
    })
    const { page } = launched
    try {
      await page.evaluate((path) => window.aiOffice.openPath(path), file)
      const hwp = await waitForPageWithUrl(launched.app, '://hwp/')
      await hwp.waitForSelector('.hwp-app[data-phase="ready"]', { timeout: 90_000 })
      const frame = await studioFrame(hwp)
      await frame.locator('#scroll-content canvas').first().waitFor({ timeout: 60_000 })
      await installProbe(frame)
      const original = await state(frame, fx)

      const undo = async () => {
        await probe(frame, { op: 'plain' })
        await focusInput(frame)
        await hwp.keyboard.press('Control+z')
        await hwp.waitForTimeout(250)
      }
      const redo = async () => {
        await probe(frame, { op: 'plain' })
        await focusInput(frame)
        await hwp.keyboard.press('Control+Shift+z')
        await hwp.waitForTimeout(250)
      }
      const document = (s: State) => ({ inner: s.inner, innerFill: s.innerFill, above: s.above })

      const runCase = async (c: Case, keep = false) => {
        await probe(frame, c.place(fx))
        const before = await state(frame, fx)
        await clearToasts(frame)
        await c.act(frame, hwp, fx)
        await hwp.waitForTimeout(300)
        const after = await state(frame, fx)
        console.log(
          `${fx.file} · ${c.name}:`,
          JSON.stringify(before.inner.dims),
          '->',
          JSON.stringify(after.inner.dims),
          (await toast(frame)) || '',
        )
        c.check(before, after, fx)
        // the tables above keep their grid, widths and text
        expect.soft(after.above, `${c.name}: tables above`).toEqual(before.above)
        // the caret (or the block, or the selection) stays on the inner table
        const where = c.after ?? 'caret'
        if (where === 'object') {
          expect.soft(inInner(after.object, fx), `${c.name}: selection`).toBe(true)
        } else {
          expect
            .soft(inInner(after.caret, fx), `${c.name}: caret ${JSON.stringify(after.caret)}`)
            .toBe(true)
          if (where === 'block') expect.soft(after.block, `${c.name}: block`).toBe(true)
        }
        // one undo step, and redo
        await undo()
        expect.soft(document(await state(frame, fx)), `${c.name}: undo`).toEqual(document(before))
        await redo()
        expect.soft(document(await state(frame, fx)), `${c.name}: redo`).toEqual(document(after))
        if (!keep) {
          await undo()
          expect(document(await state(frame, fx)), `${c.name}: back`).toEqual(document(before))
        }
      }

      for (const c of CASES) await runCase(c)
      await hwp.screenshot({ path: screenshotPath(`hwp-nested-edit-${fx.file}`) })

      // uneven columns and rows first, then W and H even them
      const uneven: Case = {
        name: 'Shift+Right on the first cell, Ctrl+Down on the first row',
        place: block(0, [0, 0]),
        act: async (frame2, page2) => {
          await key('Shift+ArrowRight')(frame2, page2)
          await hwp.waitForTimeout(150)
          await probe(frame2, { op: 'block', fx, cell: 0, focus: [0, 1] })
          await key('Control+ArrowDown')(frame2, page2)
          await hwp.waitForTimeout(150)
        },
        check: (before, after) => {
          expect(at(after, 0, 0).width).toBeGreaterThan(at(before, 0, 0).width)
        },
        after: 'block',
      }
      await probe(frame, uneven.place(fx))
      await uneven.act(frame, hwp, fx)
      for (const c of EQUALIZE) await runCase(c)

      // the commands that cannot reach the inner table yet leave the document alone and say why
      for (const r of REFUSED) {
        await probe(frame, r.place(fx))
        const before = await state(frame, fx)
        await clearToasts(frame)
        await r.act(frame, hwp, fx)
        await hwp.waitForTimeout(300)
        expect.soft(document(await state(frame, fx)), r.name).toEqual(document(before))
        expect.soft(await toast(frame), r.name).toMatch(/아직 할 수 없습니다|cannot be done/)
      }

      // an edited document saves as .hwp and .hwpx and opens with the edited grid
      await probe(frame, { op: 'caret', fx, cell: 0 })
      await key('Control+Enter')(frame, hwp)
      await probe(frame, { op: 'block', fx, cell: 0, focus: [0, 1] })
      await key('m')(frame, hwp)
      await hwp.waitForTimeout(300)
      const edited = await state(frame, fx)
      expect(edited.inner.dims.rowCount).toBe(original.inner.dims.rowCount + 1)
      for (const kind of ['hwp', 'hwpx'] as const) {
        const b64 = await probe<string>(frame, { op: 'export', kind })
        const saved = join(scratch, `edited.${kind}`)
        await writeFile(saved, Buffer.from(b64, 'base64'))
        expect(await savedDims(saved, fx.para, [fx.inner, ...fx.above]), kind).toEqual([
          edited.inner.dims,
          ...edited.above.map((t) => t.dims),
        ])
      }
    } finally {
      await closeAndSaveVideo(launched, 'hwp-nested-table-edit')
      await rm(scratch, { recursive: true, force: true })
    }
  })
}
