/**
 * vendor/rhwp-core patch 0050: an export may keep the widths the screen measured.
 *
 * For a font it has no widths for, the engine asks the canvas (the screen lays the text out
 * with what the canvas measured) and refuses to export while those widths are on: a print
 * then lays the same text out with stand-in widths, half an em for every letter. The patch
 * lets the host say that it draws the export with the fonts those widths were measured on;
 * the pages then keep the screen's layout. This runs the real engine in node, with the
 * canvas's answers made up.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

/** A font no PC has and the engine has no widths for. */
const UNKNOWN_FONT = 'Ieum No Such Font'
const TEXT = 'WiWiWi'
/** What the made-up canvas measures, in px at the text's size. */
const WIDE = 15
const NARROW = 3

interface MetricDocument {
  collectCanvasMetricRequests(document: number, fonts: number): string
  registerCanvasMetricReplies(
    document: number,
    fonts: number,
    revision: number,
    json: string,
  ): boolean
  selectCanvasMetrics(on: boolean): boolean
  canvasMetricsActive(): boolean
  setExportKeepsCanvasMetrics(on: boolean): void
}

/** One paragraph of TEXT in the unknown font. */
function open() {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.insertText(0, 0, 0, TEXT)
  const fontIds = []
  for (let lang = 0; lang < 7; lang++)
    fontIds.push(doc.findOrCreateFontIdForLang(lang, UNKNOWN_FONT))
  doc.applyCharFormat(0, 0, 0, TEXT.length, JSON.stringify({ fontIds, fontSize: 1000 }))
  return doc as HwpDocument & MetricDocument
}

/** The x of every character of TEXT on the print page, in drawing order. */
function placesOf(svg: string): { char: string; x: number }[] {
  return [...svg.matchAll(/<text\b[^>]*\sx="([\d.]+)"[^>]*>([Wi])<\/text>/g)].map((match) => ({
    char: match[2]!,
    x: Number(match[1]),
  }))
}

/** Turns the screen's measured widths on, as the studio does once its canvas answered. */
function measureOnScreen(doc: MetricDocument) {
  const batch = JSON.parse(doc.collectCanvasMetricRequests(1, 1)) as {
    revision: number
    requests: { key: string; cluster: string; font: string }[]
  }
  const replies = batch.requests.map(({ key, cluster, font }) => ({
    key,
    cluster,
    font,
    resolvedFont: font,
    measuredAdvancePx: cluster === 'W' ? WIDE : NARROW,
  }))
  doc.registerCanvasMetricReplies(1, 1, batch.revision, JSON.stringify(replies))
  doc.selectCanvasMetrics(true)
  return batch.requests.map((request) => request.cluster)
}

describe('a print page of text in a font the engine has no widths for', () => {
  it('is laid out with stand-in widths, the same for a wide and a narrow letter', () => {
    const doc = open()
    const places = placesOf(doc.renderPageSvgWithProfile(0, 'print'))
    expect(places.map((place) => place.char).join('')).toBe(TEXT)
    const steps = places.slice(1).map((place, index) => place.x - places[index]!.x)
    // every letter takes the same room, whatever its shape
    for (const step of steps) expect(step).toBeCloseTo(steps[0]!, 3)
  })

  it('asks the screen for the widths, and refuses an export while they are on', () => {
    const doc = open()
    const asked = measureOnScreen(doc)
    expect(asked).toEqual(expect.arrayContaining(['W', 'i']))
    expect(doc.canvasMetricsActive()).toBe(true)
    expect(() => doc.renderPageSvgWithProfile(0, 'print')).toThrow(/portable metrics/)
  })

  it('keeps the screen’s widths in an export the host asks to keep them', () => {
    const doc = open()
    measureOnScreen(doc)
    doc.setExportKeepsCanvasMetrics(true)
    const places = placesOf(doc.renderPageSvgWithProfile(0, 'print'))
    doc.setExportKeepsCanvasMetrics(false)
    expect(places.map((place) => place.char).join('')).toBe(TEXT)
    // W i W i W i: after a W the next letter is WIDE further, after an i NARROW further
    const steps = places.slice(1).map((place, index) => place.x - places[index]!.x)
    expect(steps[0]).toBeCloseTo(WIDE, 1)
    expect(steps[1]).toBeCloseTo(NARROW, 1)
    expect(steps[2]).toBeCloseTo(WIDE, 1)
    expect(steps[3]).toBeCloseTo(NARROW, 1)
    // the opt-in ends with the export: the guard is back
    expect(() => doc.renderPageSvgWithProfile(0, 'print')).toThrow(/portable metrics/)
    // and the portable layout is still there for an export that asks for it
    doc.selectCanvasMetrics(false)
    const portable = placesOf(doc.renderPageSvgWithProfile(0, 'print'))
    const even = portable.slice(1).map((place, index) => place.x - portable[index]!.x)
    for (const step of even) expect(step).toBeCloseTo(even[0]!, 3)
  })

  it('writes the same file with the opt-in on or off', () => {
    const plain = open()
    const kept = open()
    measureOnScreen(kept)
    kept.setExportKeepsCanvasMetrics(true)
    kept.renderPageSvgWithProfile(0, 'print')
    kept.setExportKeepsCanvasMetrics(false)
    expect(Buffer.from(kept.exportHwpx()).equals(Buffer.from(plain.exportHwpx()))).toBe(true)
    expect(Buffer.from(kept.exportHwp()).equals(Buffer.from(plain.exportHwp()))).toBe(true)
  })
})
