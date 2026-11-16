import { describe, expect, it } from 'vitest'
import { Context } from 'konva/lib/Context'
import { installCanvasKerning } from '../src/renderer/canvas-kerning'

describe('installCanvasKerning', () => {
  it('pins full kerning on every context that sets a font', () => {
    installCanvasKerning()
    const raw = { font: '', fontKerning: 'auto' } as unknown as CanvasRenderingContext2D
    const ctx = Object.create(Context.prototype) as {
      _context: CanvasRenderingContext2D
      setAttr(attr: string, val: unknown): void
    }
    ctx._context = raw
    ctx.setAttr('fillStyle', 'red')
    expect(raw.fontKerning).toBe('auto')
    ctx.setAttr('font', '16px Arial')
    expect(raw.font).toBe('16px Arial')
    expect(raw.fontKerning).toBe('normal')
  })
})
