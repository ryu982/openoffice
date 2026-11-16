import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AUTO_FLOOR_DPI,
  AUTO_PIXEL_BUDGET,
  AUTO_TARGET_DPI,
  encodePng,
  pdfiumWasmPath,
  rasterDpiFor,
  rasterizePdf,
  type RasterFace,
  type RasterizeOptions,
} from '../src/index'
import { makeBoxJob } from './helpers/boxes'
import { decodePng, meanLevel } from './helpers/png'
import { A4 } from './helpers/pdf'

const A4_AREA = A4.w * A4.h

interface Captured {
  face: Omit<RasterFace, 'pixels'>
  image: ReturnType<typeof decodePng>
}

async function render(
  pdf: Uint8Array,
  options: Partial<RasterizeOptions> = {},
): Promise<Captured[]> {
  const out: Captured[] = []
  await rasterizePdf(
    pdf,
    { dpi: 'auto', grayscale: false, rotateLandscape: false, ...options },
    (face) => {
      const { pixels, ...rest } = face
      out.push({
        face: rest,
        image: decodePng(encodePng(pixels, face.widthPx, face.heightPx, face.channels)),
      })
    },
  )
  return out
}

const px = (pt: number, dpi: number) => Math.round((pt * dpi) / 72)

describe('raster density', () => {
  it('uses 200 dpi automatically while the job fits the pixel budget', () => {
    expect(rasterDpiFor('auto', [A4_AREA, A4_AREA])).toBe(AUTO_TARGET_DPI)
    expect(rasterDpiFor('auto', [])).toBe(AUTO_TARGET_DPI)
  })

  it('lowers the automatic density toward 150 dpi for a large job, never below', () => {
    const perPage = A4_AREA * (AUTO_TARGET_DPI / 72) ** 2
    const pages = Math.ceil(AUTO_PIXEL_BUDGET / perPage) * 1.2
    const areas = Array.from({ length: Math.ceil(pages) }, () => A4_AREA)
    const dpi = rasterDpiFor('auto', areas)
    expect(dpi).toBeLessThan(AUTO_TARGET_DPI)
    expect(dpi).toBeGreaterThan(AUTO_FLOOR_DPI)
    const total = areas.length * A4_AREA * (dpi / 72) ** 2
    expect(total).toBeCloseTo(AUTO_PIXEL_BUDGET, -3)
    const huge = Array.from({ length: 2000 }, () => A4_AREA)
    expect(rasterDpiFor('auto', huge)).toBe(AUTO_FLOOR_DPI)
  })

  it('uses a chosen density as it is, however large the job', () => {
    const huge = Array.from({ length: 2000 }, () => A4_AREA)
    expect(rasterDpiFor(600, huge)).toBe(600)
    expect(rasterDpiFor(300, huge)).toBe(300)
    expect(rasterDpiFor(150, [A4_AREA])).toBe(150)
  })
})

describe('rasterizing faces', () => {
  it('finds pdfium.wasm for development and tests', () => {
    const path = pdfiumWasmPath()
    expect(path.endsWith('pdfium.wasm')).toBe(true)
    expect(existsSync(path)).toBe(true)
  })

  it('renders automatic density at 200 dpi and a chosen one as chosen', async () => {
    const pdf = await makeBoxJob([{ w: A4.w, h: A4.h }])
    const [auto] = await render(pdf, { dpi: 'auto' })
    expect(auto.face.widthPx).toBe(px(A4.w, 200))
    expect(auto.face.heightPx).toBe(px(A4.h, 200))
    const [chosen] = await render(pdf, { dpi: 150 })
    expect(chosen.face.widthPx).toBe(px(A4.w, 150))
    expect(chosen.face.heightPx).toBe(px(A4.h, 150))
    expect(chosen.image.width).toBe(px(A4.w, 150))
  })

  it('turns landscape faces a quarter clockwise for printing and leaves portrait faces', async () => {
    const pdf = await makeBoxJob([
      { w: A4.w, h: A4.h },
      { w: A4.h, h: A4.w },
    ])
    const [portrait, landscape] = await render(pdf, { dpi: 150, rotateLandscape: true })
    expect(portrait.face.rotated).toBe(false)
    expect(portrait.image.width).toBe(px(A4.w, 150))
    expect(portrait.image.height).toBe(px(A4.h, 150))
    // the box stays at the top left
    expect(meanLevel(portrait.image, 0.02, 0.02, 0.2, 0.2)).toBeLessThan(20)
    expect(meanLevel(portrait.image, 0.8, 0.02, 0.98, 0.2)).toBeGreaterThan(235)

    expect(landscape.face.rotated).toBe(true)
    expect(landscape.face.widthPt).toBeCloseTo(A4.h, 3)
    expect(landscape.face.heightPt).toBeCloseTo(A4.w, 3)
    expect(landscape.image.width).toBe(px(A4.w, 150))
    expect(landscape.image.height).toBe(px(A4.h, 150))
    // clockwise: the face's top-left corner ends up at the top right
    expect(meanLevel(landscape.image, 0.8, 0.02, 0.98, 0.2)).toBeLessThan(20)
    expect(meanLevel(landscape.image, 0.02, 0.02, 0.2, 0.2)).toBeGreaterThan(235)
  })

  it('keeps landscape faces as they are when not printing', async () => {
    const pdf = await makeBoxJob([{ w: A4.h, h: A4.w }])
    const [face] = await render(pdf, { dpi: 150 })
    expect(face.face.rotated).toBe(false)
    expect(face.image.width).toBe(px(A4.h, 150))
    expect(face.image.height).toBe(px(A4.w, 150))
    expect(meanLevel(face.image, 0.02, 0.02, 0.2, 0.2)).toBeLessThan(20)
  })

  it('renders gray with one channel and colour with three', async () => {
    const pdf = await makeBoxJob([{ w: A4.w, h: A4.h, color: [1, 0, 0] }])
    const [color] = await render(pdf, { dpi: 150 })
    expect(color.face.channels).toBe(3)
    const at = (Math.floor(color.image.height * 0.1) * color.image.width + 10) * 3
    expect(color.image.pixels[at]).toBeGreaterThan(200)
    expect(color.image.pixels[at + 1]).toBeLessThan(60)
    const [gray] = await render(pdf, { dpi: 150, grayscale: true })
    expect(gray.face.channels).toBe(1)
    expect(gray.image.channels).toBe(1)
    // pure red is mid gray (luma about 0.3)
    expect(meanLevel(gray.image, 0.02, 0.02, 0.2, 0.2)).toBeGreaterThan(60)
    expect(meanLevel(gray.image, 0.02, 0.02, 0.2, 0.2)).toBeLessThan(100)
  })

  it('fits each face to a long side for small renders', async () => {
    const pdf = await makeBoxJob([
      { w: A4.w, h: A4.h },
      { w: A4.h, h: A4.w },
    ])
    const faces = await render(pdf, { longSidePx: 400, dpi: 600 })
    expect(faces.map((f) => [f.face.widthPx, f.face.heightPx])).toEqual([
      [Math.round((400 * A4.w) / A4.h), 400],
      [400, Math.round((400 * A4.w) / A4.h)],
    ])
  })

  it('hands out one face at a time and reports progress', async () => {
    const pdf = await makeBoxJob([
      { w: A4.w, h: A4.h },
      { w: A4.w, h: A4.h },
      { w: A4.w, h: A4.h },
    ])
    const events: string[] = []
    const count = await rasterizePdf(
      pdf,
      {
        dpi: 150,
        grayscale: true,
        rotateLandscape: false,
        onProgress: (p) => events.push(`progress ${p.done}/${p.total}`),
      },
      async (face) => {
        events.push(`face ${face.index} start`)
        await new Promise((r) => setTimeout(r, 5))
        events.push(`face ${face.index} end`)
      },
    )
    expect(count).toBe(3)
    expect(events).toEqual([
      'progress 0/3',
      'face 0 start',
      'face 0 end',
      'progress 1/3',
      'face 1 start',
      'face 1 end',
      'progress 2/3',
      'face 2 start',
      'face 2 end',
      'progress 3/3',
    ])
  })

  it('stops between faces when canceled', async () => {
    const pdf = await makeBoxJob([
      { w: A4.w, h: A4.h },
      { w: A4.w, h: A4.h },
      { w: A4.w, h: A4.h },
    ])
    const controller = new AbortController()
    const seen: number[] = []
    await expect(
      rasterizePdf(
        pdf,
        { dpi: 150, grayscale: false, rotateLandscape: false, signal: controller.signal },
        (face) => {
          seen.push(face.index)
          controller.abort()
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(seen).toEqual([0])
  })

  it('refuses bytes that are not a PDF', async () => {
    await expect(
      rasterizePdf(
        new TextEncoder().encode('not a pdf'),
        { dpi: 150, grayscale: false, rotateLandscape: false },
        () => undefined,
      ),
    ).rejects.toThrow(/could not be read/)
  })
})
