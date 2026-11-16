// Main-process / worker side: one print layout job from the job PDF to what the
// sender needs (face image files, preview images, or a PDF). The same function
// runs in a worker thread in the app and directly in tests.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { arrangePrintJob } from './arrange'
import { PrintLayoutError, type PrintLayoutIssue } from './errors'
import { grayscalePdf, rotateLandscapeFaces } from './grayscale'
import type { PrintLayoutOptions } from './options'
import { encodePng } from './png'
import { rasterizePdf, type RasterProgress } from './raster'

/** Long side of a preview image when the caller names none. */
export const PREVIEW_LONG_SIDE_PX = 800
/** Bounds on a requested preview size. */
export const PREVIEW_LONG_SIDE_MIN_PX = 64
export const PREVIEW_LONG_SIDE_MAX_PX = 2400

export type RasterJobRequest =
  | {
      /** face images for printing: landscape faces turned upright, written to `outDir` */
      kind: 'print-images'
      jobPdf: Uint8Array
      options: PrintLayoutOptions
      outDir: string
      wasmPath?: string | undefined
    }
  | {
      /** small face images for the result preview, not turned */
      kind: 'preview'
      jobPdf: Uint8Array
      options: PrintLayoutOptions
      longSidePx: number
      wasmPath?: string | undefined
    }
  | {
      /** the arranged PDF (grayscale when asked); `rotateLandscape` for a printer queue */
      kind: 'pdf'
      jobPdf: Uint8Array
      options: PrintLayoutOptions
      rotateLandscape: boolean
      wasmPath?: string | undefined
    }

export interface PrintImageFace {
  /** file name inside `outDir` */
  file: string
  /** the printed face in points, after any turn (a turned face is the face's height wide) */
  widthPt: number
  heightPt: number
  rotated: boolean
}

export interface PreviewImageFace {
  png: Uint8Array
  /** the face in points as the arranged PDF shows it */
  widthPt: number
  heightPt: number
}

export type RasterJobResult =
  | { kind: 'print-images'; faces: PrintImageFace[] }
  | { kind: 'preview'; faces: PreviewImageFace[] }
  | { kind: 'pdf'; pdf: Uint8Array }

export interface RasterJobContext {
  signal?: AbortSignal | undefined
  onProgress?: ((progress: RasterProgress) => void) | undefined
}

function faceFileName(index: number): string {
  return `face-${String(index + 1).padStart(5, '0')}.png`
}

/** Runs one job. Throws `PrintLayoutError` for options the job cannot take. */
export async function runRasterJob(
  request: RasterJobRequest,
  context: RasterJobContext = {},
): Promise<RasterJobResult> {
  const { signal, onProgress } = context
  signal?.throwIfAborted()
  const arranged = await arrangePrintJob(request.jobPdf, request.options)
  signal?.throwIfAborted()
  const { options, wasmPath } = request

  if (request.kind === 'pdf') {
    let pdf = options.grayscale
      ? await grayscalePdf(arranged, { dpi: options.dpi, signal, onProgress, wasmPath })
      : arranged
    if (request.rotateLandscape) pdf = (await rotateLandscapeFaces(pdf)).pdf
    signal?.throwIfAborted()
    return { kind: 'pdf', pdf }
  }

  if (request.kind === 'preview') {
    const longSidePx = Math.round(
      Math.min(
        PREVIEW_LONG_SIDE_MAX_PX,
        Math.max(PREVIEW_LONG_SIDE_MIN_PX, request.longSidePx || PREVIEW_LONG_SIDE_PX),
      ),
    )
    const faces: PreviewImageFace[] = []
    await rasterizePdf(
      arranged,
      {
        dpi: options.dpi,
        longSidePx,
        grayscale: options.grayscale,
        rotateLandscape: false,
        signal,
        onProgress,
        wasmPath,
      },
      (face) => {
        faces.push({
          png: encodePng(face.pixels, face.widthPx, face.heightPx, face.channels),
          widthPt: face.widthPt,
          heightPt: face.heightPt,
        })
      },
    )
    return { kind: 'preview', faces }
  }

  // Grayscale faces are rendered gray here, once; the gray PDF is not built
  // and rendered again for printing.
  const faces: PrintImageFace[] = []
  const outDir = request.outDir
  await rasterizePdf(
    arranged,
    {
      dpi: options.dpi,
      grayscale: options.grayscale,
      rotateLandscape: true,
      signal,
      onProgress,
      wasmPath,
    },
    async (face) => {
      const file = faceFileName(face.index)
      await writeFile(
        join(outDir, file),
        encodePng(face.pixels, face.widthPx, face.heightPx, face.channels),
      )
      faces.push({
        file,
        widthPt: face.rotated ? face.heightPt : face.widthPt,
        heightPt: face.rotated ? face.widthPt : face.heightPt,
        rotated: face.rotated,
      })
    },
  )
  return { kind: 'print-images', faces }
}

/** Messages a raster worker sends back. */
export type RasterWorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: RasterJobResult }
  | { type: 'error'; message: string; issue?: PrintLayoutIssue }

/** Marks a worker started for raster jobs (its `workerData`). */
export const RASTER_WORKER_DATA = { genofficePrintLayoutRaster: true } as const

/** True for the `workerData` a raster worker is started with. */
export function isRasterWorkerData(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).genofficePrintLayoutRaster === true
  )
}

/** The part of a worker's `parentPort` the job server uses. */
export interface RasterWorkerPort {
  once(event: 'message', listener: (request: RasterJobRequest) => void): unknown
  postMessage(message: RasterWorkerMessage, transfer?: ArrayBuffer[]): void
}

function transferablesOf(result: RasterJobResult): ArrayBuffer[] {
  if (result.kind === 'pdf') return [result.pdf.buffer as ArrayBuffer]
  if (result.kind === 'preview') return result.faces.map((f) => f.png.buffer as ArrayBuffer)
  return []
}

/** Error to message, keeping a layout issue's code. */
export function rasterErrorMessage(err: unknown): RasterWorkerMessage {
  if (err instanceof PrintLayoutError) {
    return { type: 'error', message: err.message, issue: err.toIssue() }
  }
  return { type: 'error', message: err instanceof Error ? err.message : String(err) }
}

/**
 * Worker side: answers one job on `port`. The parent ends the worker when the
 * answer arrives, and terminates it to cancel.
 */
export function serveRasterJob(port: RasterWorkerPort): void {
  port.once('message', (request) => {
    void runRasterJob(request, {
      onProgress: ({ done, total }) => port.postMessage({ type: 'progress', done, total }),
    }).then(
      (result) => {
        // a result buffer may be a view into a larger one; send only copies this side owns
        const owned = ownedCopy(result)
        port.postMessage({ type: 'done', result: owned }, transferablesOf(owned))
      },
      (err: unknown) => port.postMessage(rasterErrorMessage(err)),
    )
  })
}

function ownedCopy(result: RasterJobResult): RasterJobResult {
  if (result.kind === 'pdf') return { kind: 'pdf', pdf: result.pdf.slice() }
  if (result.kind === 'preview') {
    return { kind: 'preview', faces: result.faces.map((f) => ({ ...f, png: f.png.slice() })) }
  }
  return result
}
