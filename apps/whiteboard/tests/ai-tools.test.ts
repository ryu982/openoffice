import { describe, expect, it, vi } from 'vitest'
import type { AiSettings } from '@genoffice/ai-provider/browser'
import { ensureWhiteboardEngineSync } from '@genoffice/whiteboard-engine/node'
import { WhiteboardSession } from '../src/renderer/document/session'
import { modelSupportsVision } from '../src/renderer/ai/vision-capability'
import {
  runWhiteboardTool,
  WHITEBOARD_TOOL_NAMES,
  type WhiteboardImageBackend,
} from '../src/renderer/ai/whiteboard-tools'

const ONE_BY_ONE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg=='

describe('Whiteboard AI tools & vision capability', () => {
  it('runs all 6 tools against WhiteboardSession with all-or-nothing rollback and user-edit undo guard', async () => {
    ensureWhiteboardEngineSync()
    const session = WhiteboardSession.createBlank('AI Test')
    const backend: WhiteboardImageBackend = {
      imageSearch: vi.fn(async () => ({
        images: [{ title: 'Sunset', url: 'https://example.com/sunset.png' }],
      })),
      fetchImage: vi.fn(async () => ({ base64: ONE_BY_ONE_PNG_B64, mime: 'image/png' })),
      generateImage: vi.fn(async () => ({ base64: ONE_BY_ONE_PNG_B64 })),
    }

    // 1. read_board
    const readRes = await runWhiteboardTool(session, WHITEBOARD_TOOL_NAMES.read, {}, backend)
    expect(readRes.isError).toBeFalsy()
    expect(readRes.output).toContain('AI Test')

    // 2. edit_board (all-or-nothing refusal leaves board untouched)
    const badEdit = await runWhiteboardTool(
      session,
      WHITEBOARD_TOOL_NAMES.edit,
      {
        ops: [
          { op: 'add', kind: 'sticky', x: 10, y: 10, width: 180, height: 120 },
          { op: 'delete', id: 'nonexistent-id' },
        ],
      },
      backend,
    )
    expect(badEdit.isError).toBe(true)
    expect(session.getDocument().objects).toHaveLength(0)

    // Valid edit_board
    const goodEdit = await runWhiteboardTool(
      session,
      WHITEBOARD_TOOL_NAMES.edit,
      {
        ops: [
          {
            op: 'add',
            kind: 'sticky',
            x: 20,
            y: 20,
            width: 180,
            height: 120,
            text: { paragraphs: [{ runs: [{ text: 'AI idea' }] }] },
          },
        ],
      },
      backend,
    )
    expect(goodEdit.isError).toBeFalsy()
    expect(goodEdit.mutated).toBe(true)
    expect(goodEdit.changedIds).toHaveLength(1)

    // 3. apply_template
    const tpl = await runWhiteboardTool(
      session,
      WHITEBOARD_TOOL_NAMES.applyTemplate,
      {
        template: {
          schemaVersion: 1,
          target: 'current_page',
          pages: [
            {
              key: 'p1',
              title: 'Sprint',
              blocks: [
                {
                  type: 'stack',
                  key: 'row',
                  direction: 'horizontal',
                  children: [
                    { type: 'sticky', key: 'n1', text: 'Task A' },
                    { type: 'sticky', key: 'n2', text: 'Task B' },
                  ],
                },
              ],
            },
          ],
        },
      },
      backend,
    )
    expect(tpl.isError).toBeFalsy()
    expect(tpl.mutated).toBe(true)

    // 4. search_images
    const searchRes = await runWhiteboardTool(
      session,
      WHITEBOARD_TOOL_NAMES.searchImages,
      { query: 'sunset' },
      backend,
    )
    expect(searchRes.isError).toBeFalsy()
    expect(searchRes.output).toContain('Sunset')

    // 5. insert_image
    const insRes = await runWhiteboardTool(
      session,
      WHITEBOARD_TOOL_NAMES.insertImage,
      { url: 'https://example.com/sunset.png', alt: 'Sunset' },
      backend,
    )
    expect(insRes.isError).toBeFalsy()
    expect(insRes.mutated).toBe(true)

    // 6. generate_image
    const genRes = await runWhiteboardTool(
      session,
      WHITEBOARD_TOOL_NAMES.generateImage,
      { prompt: 'minimal geometric icon' },
      backend,
    )
    expect(genRes.isError).toBeFalsy()
    expect(genRes.mutated).toBe(true)

    // User edits after AI turn -> undoBatches refuses rather than reverting user edit.
    session.addObject({ kind: 'sticky', x: 500, y: 500, width: 160, height: 120 })
    expect(await session.undoBatches(1)).toBe(false)

    // Undo user edit manually, then undoBatches succeeds on AI steps.
    expect(session.undo()).toBe(true)
    expect(await session.undoBatches(2)).toBe(true)

    session.dispose()
  })

  it('detects vision-capable vs text-only models accurately', () => {
    expect(modelSupportsVision({ provider: 'claude-subscription' } as AiSettings)).toBe(true)
    expect(
      modelSupportsVision({
        provider: 'custom',
        customEndpoint: 'ep-local',
        customEndpoints: [
          {
            id: 'ep-local',
            kind: 'local',
            name: 'Local',
            baseUrl: 'http://127.0.0.1:11434/v1',
            model: 'llama3-text',
            modelProfiles: { 'llama3-text': { vision: false } },
          },
        ],
      } as unknown as AiSettings),
    ).toBe(false)
    expect(
      modelSupportsVision({
        provider: 'custom',
        customEndpoint: 'ep-local',
        customEndpoints: [
          {
            id: 'ep-local',
            kind: 'local',
            name: 'Local',
            baseUrl: 'http://127.0.0.1:11434/v1',
            model: 'llava-vision',
            modelProfiles: { 'llava-vision': { vision: true } },
          },
        ],
      } as unknown as AiSettings),
    ).toBe(true)
  })
})
