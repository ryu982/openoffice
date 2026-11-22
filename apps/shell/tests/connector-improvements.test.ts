import { describe, expect, it } from 'vitest'
import { acceptFirstListing } from '../src/main/mcp-client/listing'
import { MCP_PRESETS, isPresetToolActiveByDefault } from '../src/main/mcp-client/presets'
import { newMcpServerConfig } from '../src/main/mcp-client/store'
import { formatPickerSubtitle } from '../src/renderer/src/connector-picker/ConnectorPickerWindow'

describe('Connector preset improvements', () => {
  it('sets LAW_RESPONSE_TYPE=JSON and keepResultsInside=false on korean-law preset', () => {
    expect(MCP_PRESETS['korean-law'].keepResultsInside).toBe(false)
    expect(MCP_PRESETS['korean-law'].defaultEnv).toEqual({ LAW_RESPONSE_TYPE: 'JSON' })
  })

  it('slims Notion and Canva tool defaults while keeping all tools available in Settings', () => {
    expect(isPresetToolActiveByDefault('notion', 'notion-search')).toBe(true)
    expect(isPresetToolActiveByDefault('notion', 'notion-fetch')).toBe(true)
    expect(isPresetToolActiveByDefault('notion', 'notion-spawn-session')).toBe(false)
    expect(isPresetToolActiveByDefault('notion', 'notion-upload-skill')).toBe(false)

    expect(isPresetToolActiveByDefault('canva', 'search-designs')).toBe(true)
    expect(isPresetToolActiveByDefault('canva', 'create-design')).toBe(true)
    expect(isPresetToolActiveByDefault('canva', 'export-design')).toBe(true)
    expect(isPresetToolActiveByDefault('canva', 'generate-design')).toBe(false)
    expect(isPresetToolActiveByDefault('canva', 'track-event-lifecycle')).toBe(false)

    const canvaServer = newMcpServerConfig({
      name: 'canva',
      kind: 'remote',
      presetId: 'canva',
      url: MCP_PRESETS.canva.url,
    })
    const listed = acceptFirstListing(canvaServer, {
      instructions: null,
      tools: [
        { name: 'search-designs', annotations: { readOnlyHint: true } },
        { name: 'create-design' },
        { name: 'generate-design', annotations: { readOnlyHint: true } },
        { name: 'track-event-lifecycle' },
      ],
    })
    expect(listed.tools['search-designs']?.permission).toBe('always')
    expect(listed.tools['create-design']?.permission).toBe('ask')
    expect(listed.tools['generate-design']?.permission).toBe('off')
    expect(listed.tools['track-event-lifecycle']?.permission).toBe('off')
  })

  it('provides model-facing workflow guidance on kordoc and canva presets', () => {
    expect(MCP_PRESETS.kordoc.presetInstructions).toContain('open_generated_hwp')
    expect(MCP_PRESETS.canva.presetInstructions).toContain('create-design')
  })

  it('formats ISO timestamps into readable local dates in the connector picker', () => {
    const formatted = formatPickerSubtitle(
      { id: 'p1', title: 'Test', subtitle: '2026-11-16T05:22:00.000Z', pageCount: 12 },
      'ko',
      '12쪽',
    )
    expect(formatted).toContain('12쪽')
    expect(formatted).not.toContain('T05:22:00.000Z')
    expect(formatted).toContain('2026')
  })
})
