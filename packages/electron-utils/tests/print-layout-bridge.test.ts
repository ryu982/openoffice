import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createPrintLayoutBridge, type PrintLayoutIpcRenderer } from '../src/print-layout-bridge'
import { PRINT_LAYOUT_SHARED_CHANNELS } from '../src/print-layout-channels'

function fakeIpc(answer: (channel: string, ...args: unknown[]) => Promise<unknown>) {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const ipc: PrintLayoutIpcRenderer & {
    emit(channel: string, payload: unknown): void
    count(channel: string): number
  } = {
    invoke: vi.fn(answer) as PrintLayoutIpcRenderer['invoke'],
    on(channel, listener) {
      if (!listeners.has(channel)) listeners.set(channel, new Set())
      listeners.get(channel)!.add(listener)
      return ipc
    },
    removeListener(channel, listener) {
      listeners.get(channel)?.delete(listener)
      return ipc
    },
    emit(channel, payload) {
      for (const l of listeners.get(channel) ?? []) l({}, payload)
    },
    count: (channel) => listeners.get(channel)?.size ?? 0,
  }
  return ipc
}

describe('print layout bridge', () => {
  it("calls the editor's own channels with the request as given", async () => {
    const ipc = fakeIpc(async () => ({ ok: true }))
    const bridge = createPrintLayoutBridge<{ range: string }>(ipc, 'docs')
    const request = { options: { reverse: true }, editor: { range: 'selection' } }
    await bridge.preview({ ...request, longSidePx: 300 })
    await bridge.print({ ...request, job: { deviceName: null } })
    await bridge.savePdf(request)
    await bridge.cancel()
    expect(vi.mocked(ipc.invoke).mock.calls).toEqual([
      ['docs:print-layout-preview', { ...request, longSidePx: 300 }],
      ['docs:print-layout-print', { ...request, job: { deviceName: null } }],
      ['docs:print-layout-save', request],
      ['docs:print-layout-cancel'],
    ])
  })

  it('reads a main process that does not answer as a failure', async () => {
    const ipc = fakeIpc(async () => {
      throw new Error('No handler registered')
    })
    const bridge = createPrintLayoutBridge(ipc, 'pdf')
    await expect(bridge.print({ options: {} })).resolves.toEqual({
      ok: false,
      error: 'No handler registered',
    })
    await expect(bridge.cancel()).resolves.toBeUndefined()
    await expect(bridge.getLabelSpec()).resolves.toBeNull()
    await expect(bridge.setLabelSpec({} as never)).resolves.toMatchObject({ ok: false })
  })

  it('passes progress on, drops malformed payloads, and unsubscribes', () => {
    const ipc = fakeIpc(async () => undefined)
    const bridge = createPrintLayoutBridge(ipc, 'sheets')
    const seen: unknown[] = []
    const off = bridge.onProgress((p) => seen.push(p))
    ipc.emit('sheets:print-layout-progress', { done: 1, total: 3, extra: 'x' })
    ipc.emit('sheets:print-layout-progress', { done: 'one' })
    expect(seen).toEqual([{ done: 1, total: 3 }])
    off()
    expect(ipc.count('sheets:print-layout-progress')).toBe(0)
  })

  it('reads and writes the label grid through the shared channels', async () => {
    const spec = { paper: 'A4', cols: 2, rows: 2 }
    const ipc = fakeIpc(async (channel) =>
      channel === PRINT_LAYOUT_SHARED_CHANNELS.labelSpecGet ? spec : { ok: true, spec },
    )
    const bridge = createPrintLayoutBridge(ipc, 'slides')
    await expect(bridge.getLabelSpec()).resolves.toEqual(spec)
    await bridge.setLabelSpec(spec as never)
    expect(vi.mocked(ipc.invoke).mock.calls).toEqual([
      ['print-layout:label-spec-get'],
      ['print-layout:label-spec-set', spec],
    ])
  })

  it('refuses a malformed editor prefix', () => {
    expect(() =>
      createPrintLayoutBridge(
        fakeIpc(async () => null),
        'docs:x',
      ),
    ).toThrow()
  })

  it('does not import the package root or Electron', () => {
    for (const file of ['print-layout-bridge.ts', 'print-layout-channels.ts']) {
      const text = readFileSync(join(__dirname, '..', 'src', file), 'utf8')
      const runtime = [...text.matchAll(/^import\s+(type\s+)?[^'"]*from\s+['"]([^'"]+)['"]/gm)]
        .filter((m) => !m[1])
        .map((m) => m[2])
      expect(
        runtime.every((spec) => spec === './print-layout-channels'),
        file,
      ).toBe(true)
      expect(text).not.toMatch(/from ['"](\.\/index|\.\.?\/?|@genoffice\/electron-utils)['"]/)
    }
  })
})
