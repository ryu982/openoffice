// Main-process / worker side: the grayscale form of an arranged PDF, and the
// rotated copy the macOS printer queue receives.
// Uses the Rust WASM core by default and falls back to pdf-lib + node:zlib only
// on infrastructure failures or `GENOFFICE_PRINT_LAYOUT_RUST=0|off`.
import { deflateSync } from 'node:zlib'
import {
  concatTransformationMatrix,
  degrees,
  drawObject,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
} from 'pdf-lib'
import type { DpiChoice } from './options'
import { rasterizePdf, rasterizePdfBgrx, type RasterFace, type RasterProgress } from './raster'
import type { RasterPdfium } from './pdfium'
import { createWasmGrayPdfBuilder, wasmRotateLandscapeFaces } from './wasm'

export interface GrayPdfOptions {
  dpi: DpiChoice
  signal?: AbortSignal | undefined
  onProgress?: ((progress: RasterProgress) => void) | undefined
  wasmPath?: string | undefined
  pdfium?: RasterPdfium | undefined
}

/** Adds one page that is nothing but `face` as a DeviceGray image, face-sized. */
function addGrayPageJs(out: PDFDocument, face: RasterFace): void {
  const data = deflateSync(face.pixels)
  const image = out.context.stream(data, {
    Type: 'XObject',
    Subtype: 'Image',
    Width: face.widthPx,
    Height: face.heightPx,
    ColorSpace: 'DeviceGray',
    BitsPerComponent: 8,
    Filter: 'FlateDecode',
  })
  const ref = out.context.register(image)
  const page = out.addPage([face.widthPt, face.heightPt])
  const name = page.node.newXObject('Face', ref)
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(face.widthPt, 0, 0, face.heightPt, 0, 0),
    drawObject(name),
    popGraphicsState(),
  )
}

async function grayscalePdfJs(arranged: Uint8Array, options: GrayPdfOptions): Promise<Uint8Array> {
  const out = await PDFDocument.create({ updateMetadata: false })
  await rasterizePdf(
    arranged,
    {
      dpi: options.dpi,
      grayscale: true,
      rotateLandscape: false,
      signal: options.signal,
      onProgress: options.onProgress,
      wasmPath: options.wasmPath,
      pdfium: options.pdfium,
    },
    (face) => addGrayPageJs(out, face),
  )
  return out.save()
}

/**
 * Turns every face of `arranged` into one DeviceGray image at the chosen
 * density, on a page of the face's displayed size. No text or vector content
 * is left. Faces are rendered one at a time.
 */
export async function grayscalePdf(
  arranged: Uint8Array,
  options: GrayPdfOptions,
): Promise<Uint8Array> {
  const builder = createWasmGrayPdfBuilder(options.wasmPath)
  if (!builder) return grayscalePdfJs(arranged, options)

  let wasmInfraFailed = false
  try {
    await rasterizePdfBgrx(
      arranged,
      {
        dpi: options.dpi,
        grayscale: true,
        rotateLandscape: false,
        signal: options.signal,
        onProgress: options.onProgress,
        wasmPath: options.wasmPath,
        pdfium: options.pdfium,
      },
      (face) => {
        try {
          builder.addBgrxFace(
            face.bgrx,
            face.stride,
            face.widthPx,
            face.heightPx,
            face.widthPt,
            face.heightPt,
          )
        } catch (err) {
          if (err instanceof WebAssembly.RuntimeError || err instanceof RangeError) {
            wasmInfraFailed = true
            throw err
          }
          throw err
        }
      },
    )
    try {
      return builder.finish()
    } catch (err) {
      if (err instanceof WebAssembly.RuntimeError || err instanceof RangeError) {
        wasmInfraFailed = true
      } else {
        throw err
      }
    }
  } catch (err) {
    if (!wasmInfraFailed) throw err
  } finally {
    builder.free()
  }

  return grayscalePdfJs(arranged, options)
}

async function rotateLandscapeFacesJs(
  pdf: Uint8Array,
): Promise<{ pdf: Uint8Array; rotated: number }> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false })
  let rotated = 0
  for (const page of doc.getPages()) {
    // the visible box decides the orientation, as in the arranged layout
    const { width, height } = page.getCropBox()
    const angle = (((Math.round(page.getRotation().angle / 90) % 4) + 4) % 4) * 90
    const shown = angle % 180 === 0 ? { w: width, h: height } : { w: height, h: width }
    if (shown.w > shown.h) {
      page.setRotation(degrees((angle + 90) % 360))
      rotated++
    }
  }
  if (rotated === 0) return { pdf, rotated }
  return { pdf: await doc.save(), rotated }
}

/**
 * A copy of `pdf` for a printer queue: faces wider than tall get a quarter turn
 * clockwise (`/Rotate` + 90), so every face prints on upright paper. The page
 * content is not touched. Returns the bytes and how many faces turned.
 */
export async function rotateLandscapeFaces(
  pdf: Uint8Array,
): Promise<{ pdf: Uint8Array; rotated: number }> {
  const wasm = wasmRotateLandscapeFaces(pdf)
  if (wasm.ok) return wasm.value
  return rotateLandscapeFacesJs(pdf)
}
