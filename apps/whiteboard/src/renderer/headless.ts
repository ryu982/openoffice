/**
 * Windowless `--headless-export` renderer entry (`?headless=1`).
 * Loads WASM, opens the `.whiteboard` bytes without recovery prompts, renders
 * theme-invariant light SVG/PNG pages, and reports them to `headless-main.ts`.
 */
import { initWhiteboardEngine, openWhiteboardArchive } from '@genoffice/whiteboard-engine'
import type { ExportPageImage, PrintPage } from '../shared/ipc'
import { renderPageToSvg, renderSvgToPngBytes, uint8ToDataUrl } from './export/render-svg'

export async function runWhiteboardHeadless(): Promise<void> {
  const api = window.whiteboardApi
  if (!api) return
  try {
    await initWhiteboardEngine()
    const [pending, job] = await Promise.all([
      api.core.consumePending(),
      api.headless.headlessJob(),
    ])
    if (!job) {
      api.headless.headlessDone({ ok: false, error: 'no headless export job found' })
      return
    }
    if (!pending.ok || pending.kind !== 'whiteboard') {
      api.headless.headlessDone({
        ok: false,
        error: pending.ok ? 'headless export requires a .whiteboard file' : pending.error,
      })
      return
    }

    const archive = openWhiteboardArchive(pending.bytes)
    try {
      const doc = archive.getDocument()
      const dataUrls = new Map<string, string>()
      for (const [id, meta] of Object.entries(doc.resources)) {
        const bytes = archive.getResource(id)
        if (bytes) dataUrls.set(id, uint8ToDataUrl(bytes, meta.mime))
      }

      const targets =
        job.page !== undefined
          ? doc.pages[job.page - 1]
            ? [{ index: job.page, page: doc.pages[job.page - 1]! }]
            : []
          : doc.pages.map((page, i) => ({ index: i + 1, page }))

      if (targets.length === 0) {
        api.headless.headlessDone({ ok: false, error: `page ${job.page ?? 1} not found` })
        return
      }

      if (job.format === 'pdf') {
        const pages: PrintPage[] = []
        for (const { page } of targets) {
          const rendered = renderPageToSvg(doc, page.id, dataUrls)
          if (!rendered) continue
          pages.push({
            svg: rendered.svg,
            width: rendered.width,
            height: rendered.height,
            pageWidth: rendered.width,
            pageHeight: rendered.height,
          })
        }
        api.headless.headlessDone({ ok: true, kind: 'pdf', pages })
        return
      }

      const encoder = new TextEncoder()
      const images: ExportPageImage[] = []
      for (const { index, page } of targets) {
        const rendered = renderPageToSvg(doc, page.id, dataUrls)
        if (!rendered) continue
        if (job.format === 'svg') {
          images.push({ number: index, bytes: encoder.encode(rendered.svg) })
        } else {
          const png = await renderSvgToPngBytes(rendered.svg, rendered.width, rendered.height)
          if (!png) throw new Error(`failed to rasterize page ${index}`)
          images.push({ number: index, bytes: png.bytes })
        }
      }
      api.headless.headlessDone({ ok: true, kind: 'images', format: job.format, pages: images })
    } finally {
      archive.dispose()
    }
  } catch (err) {
    api.headless.headlessDone({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
