import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron as electron, type ElectronApplication } from '@playwright/test'

const USAGE =
  'usage: benchmark-open-scroll.ts --file <xlsx> --sheet <name of the sheet the workbook opens on> [--app <folder with package.json, default: this workspace>] [--sidecar exe] [--label side] [--tag text] [--settle ms] [--throttle n] [--profile out.cpuprofile] [--out results.jsonl]'

type Sample = [at: number, duration: number]

interface BenchState {
  sheet: string
  longTasks: Sample[]
  frameGaps: Sample[]
  marks: Record<string, number>
  t0: number | null
  patches: number[]
  probeError?: string
}

interface UniverRange {
  getValue(): unknown
  getRow(): number
  getColumn(): number
  getHeight(): number
  getWidth(): number
}

interface UniverSheet {
  getSheetName(): string
  getRange(row: number, column: number): UniverRange
  getDataRange?(): UniverRange | null
  getMaxRows(): number
  getMaxColumns(): number
  getRowHeight(row: number): number
  getVisibleRange(): { startRow: number } | null
}

interface UniverApi {
  getActiveWorkbook(): { getActiveSheet(): UniverSheet } | null
  onCommandExecuted(listener: (command: { id: string }) => void): unknown
}

interface EditorDebugHooks {
  __genofficeSpareViewReady?: () => boolean
  __genofficeDebug?: { univerAPI?: UniverApi }
}

interface BenchWindow extends EditorDebugHooks {
  __openBench: BenchState
}

interface WheelStats {
  frameGapCount: number
  frameGapMax: number
  frameGapSum: number
  longTaskCount: number
  longTaskSum: number
  longTaskMax: number
  patches: number
  rowsMoved: number | null
}

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

async function main(): Promise<void> {
  const file = option('file')
  const sheet = option('sheet')
  if (!file || !existsSync(file) || !sheet) {
    console.error(USAGE)
    process.exit(2)
  }
  const workbook = resolve(file)
  const label = option('label') ?? 'base'
  const tag = option('tag') ?? null
  const settle = Number(option('settle') ?? 15000)
  const throttle = Number(option('throttle') ?? 1)
  const out = option('out')
  const profilePath = option('profile')
  const sidecar = option('sidecar')
  const here = dirname(fileURLToPath(import.meta.url))
  const appDir = resolve(option('app') ?? join(here, '..'))

  const userData = mkdtempSync(join(tmpdir(), 'sheets-open-bench-data-'))
  const codexHome = mkdtempSync(join(tmpdir(), 'sheets-open-bench-codex-'))
  // ELECTRON_RUN_AS_NODE (set by editor and CI hosts) would start Electron as plain Node.
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...hostEnv } = process.env as Record<string, string>
  const env: Record<string, string> = {
    ...hostEnv,
    GENOFFICE_DEBUG_HOOKS: '1',
    GENOFFICE_USER_DATA: userData,
    GENOFFICE_LANG: 'ko',
    CODEX_HOME: codexHome,
    XLSX_OPEN_PATH: workbook,
  }
  if (sidecar) env.XLSX_SIDECAR_PATH = resolve(sidecar)

  let app: ElectronApplication | undefined
  let result: Record<string, unknown>
  try {
    app = await electron.launch({
      executablePath: createRequire(import.meta.url)('electron') as string,
      args: [appDir],
      env,
    })
    const page = await app.firstWindow()
    await page.waitForFunction(
      () => (window as unknown as BenchWindow).__genofficeSpareViewReady?.(),
      null,
      { timeout: 120000 },
    )
    await page.waitForTimeout(1500)

    const cdp = await page.context().newCDPSession(page)
    if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })

    // tsx compiles with esbuild's keepNames, which wraps every named function in
    // a __name() call; functions sent to the page need that helper to exist there.
    await page.evaluate('globalThis.__name = (target) => target')

    await page.evaluate((sheetName) => {
      const bench = window as unknown as BenchWindow
      const state: BenchState = {
        sheet: sheetName,
        longTasks: [],
        frameGaps: [],
        marks: {},
        t0: null,
        patches: [],
      }
      bench.__openBench = state
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks.push([entry.startTime, entry.duration])
        }
      }).observe({ type: 'longtask', buffered: false })
      let last = performance.now()
      const mark = (name: string): void => {
        if (state.marks[name] === undefined) state.marks[name] = performance.now()
      }
      let counting: UniverApi | null = null
      const countPatches = (): void => {
        const api = bench.__genofficeDebug?.univerAPI
        if (!api || counting === api) return
        counting = api
        api.onCommandExecuted((command) => {
          if (command.id === 'sheet.mutation.set-range-values') {
            state.patches.push(performance.now())
          }
        })
      }
      const probe = (): void => {
        const ws = bench.__genofficeDebug?.univerAPI?.getActiveWorkbook()?.getActiveSheet()
        if (!ws || ws.getSheetName() !== sheetName) return
        mark('sheetActive')
        const a1 = ws.getRange(0, 0).getValue()
        if (a1 !== null && a1 !== undefined && a1 !== '') mark('firstCell')
      }
      const tick = (): void => {
        const now = performance.now()
        if (now - last > 50) state.frameGaps.push([last, now - last])
        last = now
        countPatches()
        if (state.t0 !== null && state.marks.firstCell === undefined) {
          try {
            probe()
          } catch (error) {
            state.probeError = String(error)
          }
        } else if (
          state.marks.firstCell !== undefined &&
          state.marks.firstCellPainted === undefined
        ) {
          mark('firstCellPainted')
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, sheet)

    if (profilePath) {
      await cdp.send('Profiler.enable')
      await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
      await cdp.send('Profiler.start')
    }

    await page.evaluate(() => {
      const bench = window as unknown as BenchWindow
      bench.__openBench.t0 = performance.now()
    })
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('menu:action', 'open')
    })
    await page.waitForFunction(
      () => (window as unknown as BenchWindow).__openBench.marks.firstCellPainted !== undefined,
      null,
      { timeout: 600000, polling: 250 },
    )
    await page.waitForTimeout(settle)

    const opened = await page.evaluate(() => {
      const bench = window as unknown as BenchWindow
      const s = bench.__openBench
      const ws = bench.__genofficeDebug?.univerAPI?.getActiveWorkbook()?.getActiveSheet()
      const { sheetActive, firstCell, firstCellPainted: painted } = s.marks
      if (
        !ws ||
        s.t0 === null ||
        sheetActive === undefined ||
        firstCell === undefined ||
        painted === undefined
      ) {
        throw new Error('the open marks are incomplete')
      }
      const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
      let lastUsed: [number, number] | null = null
      try {
        const r = ws.getDataRange?.()
        if (r) lastUsed = [r.getRow() + r.getHeight(), r.getColumn() + r.getWidth()]
      } catch {}
      const rowHeights: number[] = []
      for (let row = 0; row < Math.min(400, ws.getMaxRows()); row += 1) {
        rowHeights.push(Math.round(ws.getRowHeight(row) * 100) / 100)
      }
      return {
        t0: s.t0,
        sheetActive,
        firstCell,
        painted,
        longTasks: s.longTasks,
        frameGaps: s.frameGaps,
        probeError: s.probeError ?? null,
        rows: ws.getMaxRows(),
        columns: ws.getMaxColumns(),
        a1: ws.getRange(0, 0).getValue(),
        lastUsed,
        heapUsed: heap?.usedJSHeapSize ?? null,
        rowHeights,
      }
    })

    const grid = await page.evaluate(() => {
      for (const c of document.querySelectorAll('canvas')) {
        const r = c.getBoundingClientRect()
        if (r.width > 500 && r.height > 300) return { x: r.x, y: r.y, w: r.width, h: r.height }
      }
      return null
    })
    const topRow = (): Promise<number | null> =>
      page.evaluate(
        () =>
          (window as unknown as BenchWindow).__genofficeDebug?.univerAPI
            ?.getActiveWorkbook()
            ?.getActiveSheet()
            .getVisibleRange()?.startRow ?? null,
      )
    const wheel = async (
      steps: number,
      deltaY: number,
      pauseMs: number,
    ): Promise<WheelStats | null> => {
      if (!grid) return null
      const from = await page.evaluate(() => performance.now())
      const startRow = await topRow()
      await page.mouse.move(grid.x + grid.w / 2, grid.y + grid.h / 2)
      for (let i = 0; i < steps; i += 1) {
        await page.mouse.wheel(0, deltaY)
        await page.waitForTimeout(pauseMs)
      }
      await page.waitForTimeout(1500)
      const endRow = await topRow()
      const stats = await page.evaluate((since) => {
        const s = (window as unknown as BenchWindow).__openBench
        const gaps = s.frameGaps.filter(([at]) => at >= since).map(([, d]) => d)
        const tasks = s.longTasks.filter(([at]) => at >= since).map(([, d]) => d)
        return {
          frameGapCount: gaps.length,
          frameGapMax: gaps.length ? Math.max(...gaps) : 0,
          frameGapSum: gaps.reduce((a, b) => a + b, 0),
          longTaskCount: tasks.length,
          longTaskSum: tasks.reduce((a, b) => a + b, 0),
          longTaskMax: tasks.length ? Math.max(...tasks) : 0,
          patches: s.patches.filter((at) => at >= since).length,
        }
      }, from)
      return {
        ...stats,
        rowsMoved: endRow === null || startRow === null ? null : endRow - startRow,
      }
    }
    const scroll = await wheel(40, 600, 50)
    const slowScroll = await wheel(60, 100, 30)

    if (profilePath) {
      const { profile } = await cdp.send('Profiler.stop')
      writeFileSync(profilePath, JSON.stringify(profile))
    }

    const metrics = await app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().map((m) => ({
        type: m.type,
        peakKb: m.memory?.peakWorkingSetSize ?? null,
      })),
    )

    const { t0, painted, longTasks, frameGaps, rowHeights } = opened
    const between = (list: Sample[], from: number, to: number): Sample[] =>
      list.filter(([at]) => at >= from && at < to)
    const sum = (list: Sample[]): number => list.reduce((a, [, d]) => a + d, 0)
    const max = (list: Sample[]): number => (list.length ? Math.max(...list.map(([, d]) => d)) : 0)
    const round = Math.round
    const rounded = (stats: WheelStats | null): Record<string, number | null> | null =>
      stats &&
      Object.fromEntries(
        Object.entries(stats).map(([key, value]) => [key, value === null ? null : round(value)]),
      )
    const peakMb = (type: string): number =>
      round(Math.max(...metrics.filter((m) => m.type === type).map((m) => m.peakKb ?? 0)) / 1024)
    const loadTasks = between(longTasks, t0, painted)
    const settleTasks = between(longTasks, painted, painted + settle)
    const settleGaps = between(frameGaps, painted, painted + settle)
    const lastSettleTask = settleTasks.at(-1)
    result = {
      label,
      tag,
      file: basename(workbook),
      throttle,
      a1: opened.a1,
      rows: opened.rows,
      columns: opened.columns,
      lastUsed: opened.lastUsed,
      probeError: opened.probeError,
      openToSheetMs: round(opened.sheetActive - t0),
      openToFirstCellMs: round(opened.firstCell - t0),
      openToPaintMs: round(painted - t0),
      loadBlockedMs: round(sum(loadTasks)),
      loadLongestTaskMs: round(max(loadTasks)),
      settleBlockedMs: round(sum(settleTasks)),
      settleLongestTaskMs: round(max(settleTasks)),
      settleTaskCount: settleTasks.length,
      settleFrameGapMaxMs: round(max(settleGaps)),
      quietAfterPaintMs: lastSettleTask
        ? round(lastSettleTask[0] + lastSettleTask[1] - painted)
        : 0,
      scroll: rounded(scroll),
      slowScroll: rounded(slowScroll),
      rowHeightsDigest: createHash('sha1')
        .update(JSON.stringify(rowHeights))
        .digest('hex')
        .slice(0, 12),
      rowHeightsSum: round(rowHeights.reduce((a, b) => a + b, 0)),
      heapUsedMb: opened.heapUsed === null ? null : round(opened.heapUsed / 1048576),
      rendererPeakMb: peakMb('Tab'),
      browserPeakMb: peakMb('Browser'),
    }
  } catch (error) {
    result = { label, file: basename(workbook), error: String(error) }
  } finally {
    await app?.close().catch(() => {})
    rmSync(userData, { recursive: true, force: true })
    rmSync(codexHome, { recursive: true, force: true })
  }
  console.log(JSON.stringify(result))
  if (out) appendFileSync(out, JSON.stringify(result) + '\n')
}

void main()
