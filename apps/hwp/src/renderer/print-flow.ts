import type { AgentBridge } from './ai/agent-bridge'
import type { PrintJob, PrintMode, PrintPage } from '../shared/ipc'

/**
 * Gathering the pages for a PDF or a print: the plugin draws them a few at a time (each
 * call must finish well within the bridge's ten seconds), and every picture the pages
 * carry is kept once. A logo on every page of a long document is otherwise sent and
 * written once per page.
 */

/** A picture in a page, as the editor writes it into the SVG. */
const PICTURE = /\bhref="(data:image\/[^"]*)"/g

/** The page with its pictures moved into `images`, each picture once across the job. */
export function sharePictures(svg: string, images: string[], known: Map<string, number>): string {
  return svg.replace(PICTURE, (_, dataUrl: string) => {
    let index = known.get(dataUrl)
    if (index === undefined) {
      index = images.length
      images.push(dataUrl)
      known.set(dataUrl, index)
    }
    return `href="ieum-image:${index}"`
  })
}

/** Calls of printPages one job makes at most: a plugin that stops moving must not hang it. */
const MAX_PRINT_CALLS = 10_000

/** A bridge that may tell when the pages can be drawn in the screen's fonts. */
type FontsReady = Partial<Pick<AgentBridge, 'printFontsReady'>>

/**
 * Waits until the plugin can draw the pages for print in the fonts the screen shows: in
 * the first seconds of a document the editor is still reading the PC's fonts, and pages
 * drawn then go out in the engine's fonts and layout. A plugin without the call, or one
 * that fails it, draws the pages as it can.
 */
export async function whenPrintFontsReady(bridge: FontsReady): Promise<void> {
  if (typeof bridge.printFontsReady !== 'function') return
  try {
    await bridge.printFontsReady()
  } catch {
    // the pages are drawn as before
  }
}

export async function gatherPrintJob(
  bridge: Pick<AgentBridge, 'printPages'> & FontsReady,
  mode: PrintMode,
  onProgress: (done: number, total: number) => void,
): Promise<PrintJob> {
  await whenPrintFontsReady(bridge)
  const pages: PrintPage[] = []
  const images: string[] = []
  const known = new Map<string, number>()
  let total = 0
  for (let calls = 0; calls < MAX_PRINT_CALLS; calls++) {
    const batch = await bridge.printPages(pages.length)
    // a page count that moved under the job (an edit while gathering) stops it: the pages
    // gathered so far no longer belong with the ones still to come
    if (calls > 0 && batch.pageCount !== total) {
      throw new Error('the document changed while printing')
    }
    total = batch.pageCount
    if (batch.from !== pages.length) throw new Error('pages came back out of order')
    for (const page of batch.pages) {
      pages.push({ ...page, svg: sharePictures(page.svg, images, known) })
    }
    onProgress(pages.length, total)
    if (pages.length >= total) return { mode, pages, images }
    if (batch.pages.length === 0) break
  }
  throw new Error('the pages could not be drawn')
}

/**
 * Every page's size in CSS pixels as the print path lays the pages out, for the print
 * preview's layout diagram. The plugin measures without drawing, a call at most about
 * two seconds; a count that moves between calls stops it as it stops a print.
 */
export async function gatherPageSizes(
  bridge: Pick<AgentBridge, 'printPageSizes'> & FontsReady,
): Promise<{ width: number; height: number }[]> {
  await whenPrintFontsReady(bridge)
  const sizes: { width: number; height: number }[] = []
  let total = 0
  for (let calls = 0; calls < MAX_PRINT_CALLS; calls++) {
    const batch = await bridge.printPageSizes(sizes.length)
    if (calls > 0 && batch.pageCount !== total) throw new Error('the document changed')
    total = batch.pageCount
    if (batch.from !== sizes.length) throw new Error('page sizes came back out of order')
    sizes.push(...batch.sizes)
    if (sizes.length >= total) return sizes
    if (batch.sizes.length === 0) break
  }
  throw new Error('the page sizes could not be read')
}

/** The job one print preview gathered, handed out again while the document stays as it was. */
export interface JobCache {
  get(onProgress: (done: number, total: number) => void): Promise<PrintJob>
  /** Lets go of the job: the preview closed. */
  clear(): void
}

/**
 * Keeps the job a print preview gathered for its arranged preview, print and save: a long
 * document takes seconds to gather, and the preview asks for the same pages each time.
 * `revision` tells whether the document changed since (an AI call still landing can change
 * it under the preview); a job gathered while it moved is not kept, and with no revision to
 * read every ask gathers again. Two asks at once share one gathering.
 */
export function createJobCache(
  gather: (onProgress: (done: number, total: number) => void) => Promise<PrintJob>,
  revision: () => Promise<number>,
): JobCache {
  type Listener = (done: number, total: number) => void
  let kept: { revision: number; job: PrintJob } | null = null
  let running: { job: Promise<PrintJob>; join(listener: Listener): () => void } | null = null
  let generation = 0

  const revisionNow = async (): Promise<number | null> => {
    try {
      const value = await revision()
      return Number.isFinite(value) ? value : null
    } catch {
      return null
    }
  }

  /** One gathering, told to every ask that waits on it; one that joins late hears the last. */
  const start = (before: number | null): NonNullable<typeof running> => {
    const listeners = new Set<Listener>()
    let last: [number, number] | null = null
    const ownGeneration = generation
    const job = (async () => {
      const gathered = await gather((done, total) => {
        last = [done, total]
        for (const listener of listeners) listener(done, total)
      })
      const after = await revisionNow()
      kept =
        before !== null && after === before && ownGeneration === generation
          ? { revision: before, job: gathered }
          : null
      return gathered
    })()
    const gathering = {
      job,
      join(listener: Listener) {
        listeners.add(listener)
        if (last) listener(...last)
        return () => listeners.delete(listener)
      },
    }
    // the next ask after this one ends looks at the revision again
    const done = () => {
      if (running === gathering) running = null
    }
    job.then(done, done)
    return gathering
  }

  return {
    async get(onProgress) {
      const before = await revisionNow()
      if (before !== null && kept?.revision === before) return kept.job
      running ??= start(before)
      const current = running
      const leave = current.join(onProgress)
      try {
        return await current.job
      } finally {
        leave()
      }
    },
    clear() {
      generation += 1
      kept = null
    },
  }
}
