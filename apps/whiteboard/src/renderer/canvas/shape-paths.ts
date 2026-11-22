/**
 * SVG path outlines and inner text boxes for the 8 whiteboard shape kinds.
 */
import type { ShapeKind } from '@genoffice/whiteboard-engine'

type Pt = readonly [number, number]

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function polygon(points: readonly Pt[]): string {
  return `${points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`).join(' ')} Z`
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  return [
    `M${round(x + rr)} ${round(y)}`,
    `H${round(x + w - rr)}`,
    `A${round(rr)} ${round(rr)} 0 0 1 ${round(x + w)} ${round(y + rr)}`,
    `V${round(y + h - rr)}`,
    `A${round(rr)} ${round(rr)} 0 0 1 ${round(x + w - rr)} ${round(y + h)}`,
    `H${round(x + rr)}`,
    `A${round(rr)} ${round(rr)} 0 0 1 ${round(x)} ${round(y + h - rr)}`,
    `V${round(y + rr)}`,
    `A${round(rr)} ${round(rr)} 0 0 1 ${round(x + rr)} ${round(y)}`,
    'Z',
  ].join(' ')
}

export const SHAPE_KINDS: readonly ShapeKind[] = [
  'rectangle',
  'rounded_rectangle',
  'ellipse',
  'triangle',
  'diamond',
  'star',
  'speech_bubble',
  'block_arrow',
]

export function shapePath(kind: ShapeKind, width: number, height: number, inset = 0): string {
  const x = inset
  const y = inset
  const w = Math.max(1, width - inset * 2)
  const h = Math.max(1, height - inset * 2)
  switch (kind) {
    case 'rectangle':
      return polygon([
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ])
    case 'rounded_rectangle':
      return roundedRect(x, y, w, h, Math.min(32, Math.min(w, h) * 0.15))
    case 'ellipse': {
      const rx = w / 2
      const ry = h / 2
      const cx = x + rx
      const cy = y + ry
      return `M${round(cx - rx)} ${round(cy)} A${round(rx)} ${round(ry)} 0 1 0 ${round(cx + rx)} ${round(cy)} A${round(rx)} ${round(ry)} 0 1 0 ${round(cx - rx)} ${round(cy)} Z`
    }
    case 'triangle':
      return polygon([
        [x + w / 2, y],
        [x + w, y + h],
        [x, y + h],
      ])
    case 'diamond':
      return polygon([
        [x + w / 2, y],
        [x + w, y + h / 2],
        [x + w / 2, y + h],
        [x, y + h / 2],
      ])
    case 'star': {
      const cx = x + w / 2
      const cy = y + h / 2
      const points: Pt[] = []
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5
        const r = i % 2 === 0 ? 1 : 0.42
        points.push([
          cx + (Math.cos(angle) * r * w) / 2,
          cy + (Math.sin(angle) * r * h) / 2 + h * 0.04,
        ])
      }
      return polygon(points)
    }
    case 'speech_bubble': {
      const bodyH = h * 0.78
      const r = Math.min(w, bodyH) * 0.16
      const tailLeft = x + w * 0.18
      const tailRight = x + w * 0.36
      return [
        `M${round(x + r)} ${round(y)}`,
        `H${round(x + w - r)}`,
        `A${round(r)} ${round(r)} 0 0 1 ${round(x + w)} ${round(y + r)}`,
        `V${round(y + bodyH - r)}`,
        `A${round(r)} ${round(r)} 0 0 1 ${round(x + w - r)} ${round(y + bodyH)}`,
        `H${round(tailRight)}`,
        `L${round(x + w * 0.12)} ${round(y + h)}`,
        `L${round(tailLeft)} ${round(y + bodyH)}`,
        `H${round(x + r)}`,
        `A${round(r)} ${round(r)} 0 0 1 ${round(x)} ${round(y + bodyH - r)}`,
        `V${round(y + r)}`,
        `A${round(r)} ${round(r)} 0 0 1 ${round(x + r)} ${round(y)}`,
        'Z',
      ].join(' ')
    }
    case 'block_arrow': {
      const head = Math.min(w * 0.45, h * 0.9)
      return polygon([
        [x, y + h * 0.28],
        [x + w - head, y + h * 0.28],
        [x + w - head, y],
        [x + w, y + h / 2],
        [x + w - head, y + h],
        [x + w - head, y + h * 0.72],
        [x, y + h * 0.72],
      ])
    }
  }
}

export function shapeTextBox(
  kind: ShapeKind,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  const box = (l: number, t: number, r: number, b: number) => ({
    left: width * l,
    top: height * t,
    width: width * (1 - l - r),
    height: height * (1 - t - b),
  })
  switch (kind) {
    case 'ellipse':
      return box(0.15, 0.15, 0.15, 0.15)
    case 'triangle':
      return box(0.25, 0.4, 0.25, 0.05)
    case 'diamond':
      return box(0.22, 0.22, 0.22, 0.22)
    case 'star':
      return box(0.3, 0.32, 0.3, 0.22)
    case 'speech_bubble':
      return box(0.06, 0.04, 0.06, 0.26)
    case 'block_arrow':
      return box(0.04, 0.28, 0.3, 0.28)
    default:
      return box(0.05, 0.05, 0.05, 0.05)
  }
}
