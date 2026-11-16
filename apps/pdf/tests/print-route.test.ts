/**
 * The print dialog's route choice: with the shared layout options at their
 * defaults the current print path (`printDoc` → `printPdf`) runs with exactly
 * the arguments it got before advanced printing existed; any option sends the
 * job down the arranged route instead.
 */
import { describe, expect, it, vi } from 'vitest'
import { createDefaultOptions } from '@genoffice/print-layout/plan'
import {
  canPrintPicked,
  jobPageSizes,
  pickedVisiblePages,
  printTargets,
  routePrint,
  type PrintRangeInput,
} from '../src/renderer/print-route'

const input = (over: Partial<PrintRangeInput> = {}): PrintRangeInput => ({
  mode: 'all',
  customText: '',
  pageCount: 9,
  currentPage: 4,
  pickedPages: [],
  ...over,
})

function routes() {
  return { current: vi.fn(), arranged: vi.fn() }
}

describe('printTargets', () => {
  it('maps each range to the 1-based pages the current print path received before', () => {
    expect(printTargets(input({ mode: 'all' }))).toEqual({ ok: true, pages: undefined })
    expect(printTargets(input({ mode: 'current' }))).toEqual({ ok: true, pages: [4] })
    expect(printTargets(input({ mode: 'custom', customText: '5-6, 2' }))).toEqual({
      ok: true,
      pages: [2, 5, 6],
    })
    expect(printTargets(input({ mode: 'custom', customText: '12' }))).toEqual({ ok: false })
    expect(printTargets(input({ mode: 'custom', customText: '' }))).toEqual({ ok: false })
  })

  it('prints the picked pages only when two or more are picked, in document order', () => {
    expect(printTargets(input({ mode: 'picked', pickedPages: [7, 2, 5] }))).toEqual({
      ok: true,
      pages: [2, 5, 7],
    })
    expect(printTargets(input({ mode: 'picked', pickedPages: [3] }))).toEqual({ ok: false })
    expect(printTargets(input({ mode: 'picked', pickedPages: [] }))).toEqual({ ok: false })
  })
})

describe('canPrintPicked', () => {
  it('needs two or more picked pages (one picked page is the current page)', () => {
    expect(canPrintPicked([])).toBe(false)
    expect(canPrintPicked([4])).toBe(false)
    expect(canPrintPicked([4, 6])).toBe(true)
  })
})

describe('pickedVisiblePages', () => {
  it('turns picked original indices into visible 1-based page numbers', () => {
    // visible order after an unsaved reorder: original 2, 0, 1
    expect(pickedVisiblePages([1, 2], [2, 0, 1])).toEqual([1, 3])
    expect(pickedVisiblePages([5, 0], [2, 0, 1])).toEqual([2])
  })
})

describe('routePrint at default options (regression guard)', () => {
  it('"all" calls the current path with no arguments, as before', () => {
    const r = routes()
    expect(routePrint(createDefaultOptions(), undefined, r)).toBe('current')
    expect(r.current).toHaveBeenCalledTimes(1)
    expect(r.current.mock.calls[0]).toEqual([])
    expect(r.arranged).not.toHaveBeenCalled()
  })

  it('"current" and "custom" pass the same page list as before', () => {
    const r = routes()
    routePrint(createDefaultOptions(), [4], r)
    routePrint(createDefaultOptions(), [2, 5, 6], r)
    expect(r.current.mock.calls).toEqual([[[4]], [[2, 5, 6]]])
    expect(r.arranged).not.toHaveBeenCalled()
  })

  it('picked pages without layout options stay on the current path with the page list', () => {
    const r = routes()
    const t = printTargets(input({ mode: 'picked', pickedPages: [8, 3] }))
    if (!t.ok) throw new Error('expected targets')
    routePrint(createDefaultOptions(), t.pages, r)
    expect(r.current.mock.calls).toEqual([[[3, 8]]])
    expect(r.arranged).not.toHaveBeenCalled()
  })
})

describe('routePrint with a layout option on', () => {
  it('sends every range down the arranged route, whole document as null', () => {
    const r = routes()
    const nup = { ...createDefaultOptions(), mode: 'nup' as const }
    expect(routePrint(nup, undefined, r)).toBe('arranged')
    routePrint({ ...createDefaultOptions(), grayscale: true }, [3, 8], r)
    routePrint({ ...createDefaultOptions(), dpi: 300 }, [4], r)
    expect(r.arranged.mock.calls).toEqual([[null], [[3, 8]], [[4]]])
    expect(r.current).not.toHaveBeenCalled()
  })
})

describe('jobPageSizes', () => {
  const geom = (vis: number) =>
    [
      { width: 612, height: 792, rotate: 0, userUnit: 1 },
      { width: 612, height: 792, rotate: 90, userUnit: 1 },
      { width: 400, height: 300, rotate: 270, userUnit: 1 },
      { width: 1224, height: 1584, rotate: 0, userUnit: 2 },
    ][vis - 1] ?? null

  it('gives the displayed size of each job page in points, rotation applied', () => {
    expect(jobPageSizes(undefined, 4, geom)).toEqual([
      { widthPt: 612, heightPt: 792 },
      { widthPt: 792, heightPt: 612 },
      { widthPt: 300, heightPt: 400 },
      // pdf.js scales by UserUnit; the job PDF's boxes are in PDF units
      { widthPt: 612, heightPt: 792 },
    ])
    expect(jobPageSizes([2, 3], 4, geom)).toEqual([
      { widthPt: 792, heightPt: 612 },
      { widthPt: 300, heightPt: 400 },
    ])
  })

  it('is null while the range does not resolve to pages', () => {
    expect(jobPageSizes(undefined, 0, geom)).toBeNull()
    expect(jobPageSizes([], 4, geom)).toBeNull()
    expect(jobPageSizes([9], 4, geom)).toBeNull()
  })
})
