import { describe, expect, it, vi } from 'vitest'
import type { AgentBridge } from '../src/renderer/ai/agent-bridge'
import { createHwpSkill } from '../src/renderer/ai/hwp-skill'

function stubBridge(): AgentBridge {
  return new Proxy({} as AgentBridge, {
    get: () => vi.fn().mockResolvedValue({}),
  })
}

describe('open_generated_hwp tool (kordoc → Hangul editor bridge)', () => {
  it('omits open_generated_hwp when loadGeneratedHwpx is not provided (CLI headless mode)', () => {
    const { skill } = createHwpSkill({
      bridge: stubBridge(),
      label: (k) => String(k),
      onChange: vi.fn(),
      confirmMemoRemoval: vi.fn().mockResolvedValue(false),
    })
    expect(skill.tools.map((t) => t.name)).not.toContain('open_generated_hwp')
    expect(skill.systemPrompt).not.toContain('open_generated_hwp')
  })

  it('loads a valid .hwpx file into the current blank tab or opens in a new tab', async () => {
    const loader = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, mode: 'current' as const, title: '보고서.hwpx' })
      .mockResolvedValueOnce({ ok: true as const, mode: 'new-tab' as const, title: '보고서2.hwpx' })

    const { skill } = createHwpSkill({
      bridge: stubBridge(),
      label: (k) => String(k),
      onChange: vi.fn(),
      confirmMemoRemoval: vi.fn().mockResolvedValue(false),
      loadGeneratedHwpx: loader,
    })

    expect(skill.tools.map((t) => t.name)).toContain('open_generated_hwp')
    expect(skill.systemPrompt).toContain('open_generated_hwp')

    // Rejects non-hwp files
    const badExt = await skill.executeTool(
      { id: '1', name: 'open_generated_hwp', input: { path: 'C:/tmp/notes.docx' } },
      new AbortController().signal,
    )
    expect(badExt.isError).toBe(true)

    // Loads into blank tab
    const res1 = await skill.executeTool(
      { id: '2', name: 'open_generated_hwp', input: { path: 'C:/tmp/보고서.hwpx' } },
      new AbortController().signal,
    )
    expect(res1.isError).toBeFalsy()
    expect(res1.output).toContain('directly into this Hangul editor tab')
    expect(loader).toHaveBeenCalledWith('C:/tmp/보고서.hwpx')

    // Opens in new tab when current tab has content
    const res2 = await skill.executeTool(
      { id: '3', name: 'open_generated_hwp', input: { path: 'C:/tmp/보고서2.hwpx' } },
      new AbortController().signal,
    )
    expect(res2.isError).toBeFalsy()
    expect(res2.output).toContain('new Hangul tab')
  })
})
