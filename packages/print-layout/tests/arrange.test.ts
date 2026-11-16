import { describe, expect, it } from 'vitest'
import {
  arrangePrintJob,
  createDefaultOptions,
  LABEL_PRESETS,
  PrintLayoutError,
  readJobPageSizes,
  type LabelSpec,
  type NupCount,
  type PrintLayoutOptions,
} from '../src/index'
import {
  A3,
  A4,
  A5,
  MM,
  makeJob,
  markers,
  readFaces,
  readLines,
  visibleMarkers,
  type Face,
  type SourcePage,
} from './helpers/pdf'

function opts(patch: (o: PrintLayoutOptions) => void): PrintLayoutOptions {
  const o = createDefaultOptions()
  patch(o)
  return o
}

function a4Pages(n: number, from = 1): SourcePage[] {
  return Array.from({ length: n }, (_, i) => ({ ...A4, label: `P${from + i}` }))
}

async function arrange(pages: SourcePage[], o: PrintLayoutOptions): Promise<Face[]> {
  return readFaces(await arrangePrintJob(await makeJob(pages), o))
}

function expectSize(face: Face, w: number, h: number): void {
  expect(face.width).toBeCloseTo(w, 1)
  expect(face.height).toBeCloseTo(h, 1)
}

/** The single origin of `str` on the face sits at (x, y), top-left coordinates. */
function expectAt(face: Face, str: string, x: number, y: number): void {
  const found = markers(face, str)
  expect(found, `${str} on face`).toHaveLength(1)
  expect(found[0].x, `${str} x`).toBeCloseTo(x, 1)
  expect(found[0].y, `${str} y`).toBeCloseTo(y, 1)
}

/**
 * Like `expectAt`, but a position off the face must show no marker at all: the
 * reader drops text outside the page, the way the sheet clips it.
 */
function expectAtOrOff(face: Face, str: string, x: number, y: number): void {
  if (x >= 0 && y >= 0 && x <= face.width && y <= face.height) expectAt(face, str, x, y)
  else expect(markers(face, str), `${str} off the face`).toHaveLength(0)
}

async function rejection(p: Promise<unknown>): Promise<PrintLayoutError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(PrintLayoutError)
    return e as PrintLayoutError
  }
  throw new Error('expected a rejection')
}

describe('default route', () => {
  it('returns the input bytes unchanged when every option is default', async () => {
    const job = await makeJob(a4Pages(3))
    expect(await arrangePrintJob(job, createDefaultOptions())).toBe(job)
  })

  it('returns the input unchanged when only grayscale or dpi differ', async () => {
    const job = await makeJob(a4Pages(2))
    expect(
      await arrangePrintJob(
        job,
        opts((o) => (o.grayscale = true)),
      ),
    ).toBe(job)
    expect(
      await arrangePrintJob(
        job,
        opts((o) => (o.dpi = 300)),
      ),
    ).toBe(job)
  })

  it('rejects invalid options with a code', async () => {
    const job = await makeJob(a4Pages(3))
    const e = await rejection(
      arrangePrintJob(
        job,
        opts((o) => {
          o.mode = 'poster'
          o.poster.cols = 1
          o.poster.rows = 1
        }),
      ),
    )
    expect(e.code).toBe('poster-single-tile')
    const e2 = await rejection(
      arrangePrintJob(
        job,
        opts((o) => {
          o.mode = 'labels'
          o.labels.fill = 'repeat'
          o.labels.repeatPage = 4
        }),
      ),
    )
    expect(e2.code).toBe('label-repeat-page-out-of-range')
  })

  it('rejects a filter that leaves no face', async () => {
    const e = await rejection(
      arrangePrintJob(
        await makeJob(a4Pages(1)),
        opts((o) => (o.sides = 'even')),
      ),
    )
    expect(e.code).toBe('no-faces')
  })
})

describe('single page per sheet with a chosen paper', () => {
  const big = { w: 1000, h: 700, label: 'P3' }
  const job: SourcePage[] = [{ ...A3, label: 'P1' }, { ...A5, label: 'P2' }, big]

  it('fit shrinks only pages larger than the paper, centred, orientation follows the page', async () => {
    const faces = await arrange(
      job,
      opts((o) => {
        o.paper = 'A4'
        o.fitToPaper = true
      }),
    )
    expect(faces).toHaveLength(3)
    expectSize(faces[0], A4.w, A4.h)
    expectSize(faces[1], A4.w, A4.h)
    expectSize(faces[2], A4.h, A4.w)

    const s1 = Math.min(A4.w / A3.w, A4.h / A3.h)
    expectAt(faces[0], 'P1', A4.w / 2, A4.h / 2)
    expectAt(faces[0], 'Q1', (A4.w - s1 * A3.w) / 2 + 2 * s1, (A4.h + s1 * A3.h) / 2 - 2 * s1)

    // small page keeps 100%
    expectAt(faces[1], 'P2', A4.w / 2, A4.h / 2)
    expectAt(faces[1], 'Q2', (A4.w - A5.w) / 2 + 2, (A4.h + A5.h) / 2 - 2)

    const s3 = Math.min(A4.h / big.w, A4.w / big.h)
    expectAt(faces[2], 'P3', A4.h / 2, A4.w / 2)
    expectAt(faces[2], 'Q3', (A4.h - s3 * big.w) / 2 + 2 * s3, (A4.w + s3 * big.h) / 2 - 2 * s3)
  })

  it('without fit places pages at 100% centred (overflow is clipped)', async () => {
    const faces = await arrange(
      job,
      opts((o) => (o.paper = 'A4')),
    )
    expectSize(faces[0], A4.w, A4.h)
    expectAt(faces[0], 'P1', A4.w / 2, A4.h / 2)
    // at 100% the A3 page's corner marker lies off the A4 sheet
    expectAtOrOff(faces[0], 'Q1', (A4.w - A3.w) / 2 + 2, (A4.h + A3.h) / 2 - 2)
    expect(markers(faces[0], 'Q1')).toHaveLength(0)
    expectAt(faces[1], 'Q2', (A4.w - A5.w) / 2 + 2, (A4.h + A5.h) / 2 - 2)
  })

  it('honours /Rotate when sizing and placing', async () => {
    const rotated: SourcePage[] = [
      { ...A4, rotate: 90 },
      { ...A4, rotate: 180 },
      { ...A4, rotate: 270 },
    ]
    expect(
      (await readJobPageSizes(await makeJob(rotated))).map((s) => Math.round(s.widthPt)),
    ).toEqual([842, 595, 842])
    const faces = await arrange(
      rotated,
      opts((o) => {
        o.paper = 'A4'
        o.fitToPaper = true
      }),
    )
    expectSize(faces[0], A4.h, A4.w)
    expectSize(faces[1], A4.w, A4.h)
    expectSize(faces[2], A4.h, A4.w)
    expectAt(faces[0], 'P1', A4.h / 2, A4.w / 2)
    // unrotated lower-left corner: top-left after 90, top-right after 180, bottom-right after 270
    expectAt(faces[0], 'Q1', 2, 2)
    expectAt(faces[1], 'Q2', A4.w - 2, 2)
    expectAt(faces[2], 'Q3', A4.h - 2, A4.w - 2)
  })

  it('handles a MediaBox that does not start at the origin', async () => {
    const faces = await arrange(
      [{ ...A4, origin: { x: 100, y: 200 } }],
      opts((o) => (o.paper = 'A4')),
    )
    expectAt(faces[0], 'P1', A4.w / 2, A4.h / 2)
    expectAt(faces[0], 'Q1', 2, A4.h - 2)
  })
})

describe('N-up', () => {
  const grids: Record<NupCount, { landscape: boolean; cols: number; rows: number }> = {
    2: { landscape: true, cols: 2, rows: 1 },
    4: { landscape: false, cols: 2, rows: 2 },
    6: { landscape: true, cols: 3, rows: 2 },
    9: { landscape: false, cols: 3, rows: 3 },
    16: { landscape: false, cols: 4, rows: 4 },
  }
  for (const count of [2, 4, 6, 9, 16] as NupCount[]) {
    for (const order of ['row', 'column'] as const) {
      it(`${count}-up, ${order} order`, async () => {
        const g = grids[count]
        const n = count + 1
        const faces = await arrange(
          a4Pages(n),
          opts((o) => {
            o.mode = 'nup'
            o.nup = { count, order }
          }),
        )
        expect(faces).toHaveLength(2)
        const W = g.landscape ? A4.h : A4.w
        const H = g.landscape ? A4.w : A4.h
        for (const f of faces) expectSize(f, W, H)
        for (let k = 0; k < n; k++) {
          const face = faces[Math.floor(k / count)]
          const j = k % count
          const col = order === 'row' ? j % g.cols : Math.floor(j / g.rows)
          const row = order === 'row' ? Math.floor(j / g.cols) : j % g.rows
          expectAt(face, `P${k + 1}`, ((col + 0.5) * W) / g.cols, ((row + 0.5) * H) / g.rows)
        }
        expect(visibleMarkers(faces[1])).toEqual([`P${n}`])
      })
    }
  }

  it('2-up landscape pages stack on a portrait sheet', async () => {
    const land = { w: A4.h, h: A4.w }
    const faces = await arrange(
      [
        { ...land, label: 'P1' },
        { ...land, label: 'P2' },
      ],
      opts((o) => (o.mode = 'nup')),
    )
    expectSize(faces[0], A4.w, A4.h)
    expectAt(faces[0], 'P1', A4.w / 2, A4.h / 4)
    expectAt(faces[0], 'P2', A4.w / 2, (3 * A4.h) / 4)
  })

  it('4-up landscape pages use a landscape sheet', async () => {
    const land = { w: 960, h: 540 }
    const faces = await arrange(
      [1, 2, 3, 4].map((i) => ({ ...land, label: `P${i}` })),
      opts((o) => {
        o.mode = 'nup'
        o.nup.count = 4
      }),
    )
    expectSize(faces[0], 960, 540)
    expectAt(faces[0], 'P4', 720, 405)
  })

  it('uses the chosen paper as the sheet', async () => {
    const faces = await arrange(
      a4Pages(2),
      opts((o) => {
        o.mode = 'nup'
        o.paper = 'A3'
      }),
    )
    expectSize(faces[0], A3.h, A3.w)
    // A4 into half an A3 landscape: exactly 100%
    expectAt(faces[0], 'Q1', 2, A4.h - 2)
  })

  it('fits each page of a mixed-size document into its own cell', async () => {
    const land = { w: A3.h, h: A3.w }
    const small = { w: 100, h: 50 }
    const faces = await arrange(
      [
        { ...A4, label: 'P1' },
        { ...land, label: 'P2' },
        { ...small, label: 'P3' },
      ],
      opts((o) => (o.mode = 'nup')),
    )
    const W = A4.h
    const H = A4.w
    expectSize(faces[0], W, H)
    const cw = W / 2
    const s2 = Math.min(cw / land.w, H / land.h)
    expectAt(faces[0], 'P2', cw * 1.5, H / 2)
    expectAt(faces[0], 'Q2', cw + (cw - s2 * land.w) / 2 + 2 * s2, (H + s2 * land.h) / 2 - 2 * s2)
    const s3 = Math.min(cw / small.w, H / small.h)
    expectAt(faces[1], 'P3', cw / 2, H / 2)
    expectAt(faces[1], 'Q3', (cw - s3 * small.w) / 2 + 2 * s3, (H + s3 * small.h) / 2 - 2 * s3)
  })
})

describe('booklet', () => {
  function expected(n: number, binding: 'left' | 'right'): Array<[number | null, number | null]> {
    const P = Math.ceil(n / 4) * 4
    const faces: Array<[number | null, number | null]> = []
    for (let s = 0; s < P / 4; s++) {
      const front: [number, number] = [P - 2 * s, 2 * s + 1]
      const back: [number, number] = [2 * s + 2, P - 2 * s - 1]
      for (const side of [front, back]) {
        const pair = binding === 'left' ? side : [side[1], side[0]]
        faces.push([pair[0] <= n ? pair[0] : null, pair[1] <= n ? pair[1] : null])
      }
    }
    return faces
  }

  for (const n of [4, 5, 8, 9]) {
    for (const binding of ['left', 'right'] as const) {
      it(`${n} pages, ${binding} binding`, async () => {
        const faces = await arrange(
          a4Pages(n),
          opts((o) => {
            o.mode = 'booklet'
            o.booklet.binding = binding
          }),
        )
        const want = expected(n, binding)
        expect(faces).toHaveLength(want.length)
        const W = A4.h
        const H = A4.w
        faces.forEach((face, i) => {
          expectSize(face, W, H)
          const [l, r] = want[i]
          const shown = [l, r].filter((p): p is number => p !== null).map((p) => `P${p}`)
          expect(visibleMarkers(face).sort()).toEqual(shown.sort())
          if (l !== null) expectAt(face, `P${l}`, W / 4, H / 2)
          if (r !== null) expectAt(face, `P${r}`, (3 * W) / 4, H / 2)
        })
      })
    }
  }

  it('A3 paper makes an A4-size book', async () => {
    const faces = await arrange(
      a4Pages(4),
      opts((o) => {
        o.mode = 'booklet'
        o.paper = 'A3'
      }),
    )
    expectSize(faces[0], A3.h, A3.w)
    // face 1 is [4|1]; page 1 sits at 100% in the right half
    expectAt(faces[0], 'Q1', A3.h / 2 + 2, A3.w - 2)
  })
})

describe('poster', () => {
  async function poster(cols: number, rows: number, cutMarks: boolean) {
    const o = opts((x) => {
      x.mode = 'poster'
      x.poster = { cols, rows, overlapMm: 10, cutMarks }
    })
    const bytes = await arrangePrintJob(await makeJob(a4Pages(2)), o)
    return { faces: await readFaces(bytes), lines: await readLines(bytes) }
  }

  for (const [cols, rows] of [
    [2, 2],
    [3, 2],
  ]) {
    it(`${cols} x ${rows} tiles per page with overlap geometry and cut marks`, async () => {
      const { faces, lines } = await poster(cols, rows, true)
      const perPage = cols * rows
      expect(faces).toHaveLength(2 * perPage)
      const W = A4.w
      const H = A4.h
      const o = 10 * MM
      const PW = cols * W - (cols - 1) * o
      const PH = rows * H - (rows - 1) * o
      const s = Math.min(PW / A4.w, PH / A4.h)
      const offX = (PW - s * A4.w) / 2
      const offY = (PH - s * A4.h) / 2
      faces.forEach((face, t) => {
        expectSize(face, W, H)
        const page = Math.floor(t / perPage) + 1
        const i = (t % perPage) % cols
        const j = Math.floor((t % perPage) / cols)
        expectAtOrOff(
          face,
          `P${page}`,
          offX + (s * A4.w) / 2 - i * (W - o),
          offY + (s * A4.h) / 2 - j * (H - o),
        )
        expect(markers(face, `P${3 - page}`)).toHaveLength(0)
        const want: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
        if (i < cols - 1) want.push({ x1: W - o, y1: H, x2: W - o, y2: 0 })
        if (j < rows - 1) want.push({ x1: 0, y1: o, x2: W, y2: o })
        const got = lines[t]
        expect(got, `tile ${t} lines`).toHaveLength(want.length)
        for (const w of want) {
          expect(
            got.some(
              (g) =>
                (near(g.x1, w.x1) && near(g.y1, w.y1) && near(g.x2, w.x2) && near(g.y2, w.y2)) ||
                (near(g.x1, w.x2) && near(g.y1, w.y2) && near(g.x2, w.x1) && near(g.y2, w.y1)),
            ),
            `tile ${t} has line ${JSON.stringify(w)}`,
          ).toBe(true)
        }
      })
    })
  }

  it('draws no cut marks when they are off', async () => {
    const { faces, lines } = await poster(2, 2, false)
    expect(faces).toHaveLength(8)
    expect(lines.every((l) => l.length === 0)).toBe(true)
  })
})

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.05
}

describe('labels', () => {
  const preset = LABEL_PRESETS[0]

  function cellCentre(spec: LabelSpec, cell: number): [number, number] {
    const c = (cell - 1) % spec.cols
    const r = Math.floor((cell - 1) / spec.cols)
    return [
      (spec.leftMarginMm + c * spec.hPitchMm + spec.cellWidthMm / 2) * MM,
      (spec.topMarginMm + r * spec.vPitchMm + spec.cellHeightMm / 2) * MM,
    ]
  }

  it('sequence starts at the start cell and continues from cell 1', async () => {
    const faces = await arrange(
      a4Pages(5),
      opts((o) => {
        o.mode = 'labels'
        o.labels.startCell = 20
      }),
    )
    expect(faces).toHaveLength(2)
    for (const f of faces) expectSize(f, A4.w, A4.h)
    expectAt(faces[0], 'P1', ...cellCentre(preset, 20))
    expectAt(faces[0], 'P2', ...cellCentre(preset, 21))
    expectAt(faces[1], 'P3', ...cellCentre(preset, 1))
    expectAt(faces[1], 'P5', ...cellCentre(preset, 3))
    expect(visibleMarkers(faces[1])).toEqual(['P3', 'P4', 'P5'])
  })

  it('repeat fills one sheet from the start cell with one page', async () => {
    const faces = await arrange(
      a4Pages(3),
      opts((o) => {
        o.mode = 'labels'
        o.labels = { ...o.labels, fill: 'repeat', repeatPage: 2, startCell: 5 }
      }),
    )
    expect(faces).toHaveLength(1)
    const found = markers(faces[0], 'P2')
    expect(found).toHaveLength(17)
    for (let cell = 5; cell <= 21; cell++) {
      const [x, y] = cellCentre(preset, cell)
      expect(
        found.some((f) => near(f.x, x) && near(f.y, y)),
        `cell ${cell}`,
      ).toBe(true)
    }
    expect(markers(faces[0], 'P1')).toHaveLength(0)
    expect(markers(faces[0], 'P3')).toHaveLength(0)
  })

  it('uses a custom spec and its paper', async () => {
    const spec: LabelSpec = {
      paper: 'Letter',
      cols: 2,
      rows: 4,
      cellWidthMm: 95,
      cellHeightMm: 60,
      topMarginMm: 12,
      leftMarginMm: 10,
      hPitchMm: 100,
      vPitchMm: 65,
    }
    const faces = await arrange(
      a4Pages(3),
      opts((o) => {
        o.mode = 'labels'
        o.labels.spec = { kind: 'custom', spec }
      }),
    )
    expectSize(faces[0], 612, 792)
    expectAt(faces[0], 'P1', ...cellCentre(spec, 1))
    expectAt(faces[0], 'P3', ...cellCentre(spec, 3))
    // aspect kept: an A4 page in a 95 x 60 mm cell is height-bound
    const s = Math.min((95 * MM) / A4.w, (60 * MM) / A4.h)
    const [cx, cy] = cellCentre(spec, 1)
    expectAt(faces[0], 'Q1', cx - (s * A4.w) / 2 + 2 * s, cy + (s * A4.h) / 2 - 2 * s)
  })

  it('rejects a spec that runs off the paper', async () => {
    const e = await rejection(
      arrangePrintJob(
        await makeJob(a4Pages(1)),
        opts((o) => {
          o.mode = 'labels'
          o.labels.spec = { kind: 'custom', spec: { ...preset, leftMarginMm: 20 } }
        }),
      ),
    )
    expect(e.code).toBe('label-spec-off-paper')
  })
})

describe('sides and reverse', () => {
  // a 4-7 page range: the job's first page is document page 4
  const range: SourcePage[] = [
    { ...A4, label: 'P4' },
    { w: 400, h: 600, label: 'P5' },
    { ...A4, label: 'P6' },
    { w: 600, h: 400, label: 'P7' },
  ]
  const run = async (sides: 'all' | 'odd' | 'even', reverse: boolean) =>
    arrange(
      range,
      opts((o) => {
        o.sides = sides
        o.reverse = reverse
      }),
    )

  it('odd and even count arranged faces, not document pages', async () => {
    const odd = await run('odd', false)
    expect(odd.map((f) => visibleMarkers(f))).toEqual([['P4'], ['P6']])
    const even = await run('even', false)
    expect(even.map((f) => visibleMarkers(f))).toEqual([['P5'], ['P7']])
    // pages keep their own size
    expectSize(even[0], 400, 600)
    expectSize(even[1], 600, 400)
  })

  it('reverse alone and combined with odd/even', async () => {
    expect((await run('all', true)).map((f) => visibleMarkers(f))).toEqual([
      ['P7'],
      ['P6'],
      ['P5'],
      ['P4'],
    ])
    expect((await run('odd', true)).map((f) => visibleMarkers(f))).toEqual([['P6'], ['P4']])
    expect((await run('even', true)).map((f) => visibleMarkers(f))).toEqual([['P7'], ['P5']])
  })

  it('booklet odd faces are fronts, even faces are backs', async () => {
    const book = async (sides: 'odd' | 'even', reverse: boolean) =>
      (
        await arrange(
          a4Pages(8),
          opts((o) => {
            o.mode = 'booklet'
            o.sides = sides
            o.reverse = reverse
          }),
        )
      ).map((f) => visibleMarkers(f).sort())
    expect(await book('odd', false)).toEqual([
      ['P1', 'P8'],
      ['P3', 'P6'],
    ])
    expect(await book('even', true)).toEqual([
      ['P4', 'P5'],
      ['P2', 'P7'],
    ])
  })

  it('N-up even faces', async () => {
    const faces = await arrange(
      a4Pages(5),
      opts((o) => {
        o.mode = 'nup'
        o.sides = 'even'
      }),
    )
    expect(faces.map((f) => visibleMarkers(f))).toEqual([['P3', 'P4']])
  })
})
