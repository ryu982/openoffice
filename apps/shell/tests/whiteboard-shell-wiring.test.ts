import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { appForPath, documentExtension, renameStaysInApp } from '../src/main/app-routing'
import { availableConversions } from '../src/main/generate/request'
import { LAUNCHABLE_DOUBLE_EXTS, LAUNCHABLE_EXTS } from '../src/main/launch-paths'
import { createWhiteboardTools } from '../src/main/mcp/tools/whiteboard-tools'
import { openWhiteboardChecked } from '../src/main/whiteboard-open-gate'
import { EDITOR_ITEM_HOME_KIND, EDITOR_ITEM_TAB_KIND } from '../src/shared/editor-choice'
import { AI_TARGET_KINDS, CONVERT_KINDS } from '../src/shared/generate-api'
import { HOME_KINDS } from '../src/shared/home-kinds'
import { isQuickLookSupportedPath, quickLookFamilyOf } from '../src/shared/quick-look-api'

describe('Whiteboard shell wiring', () => {
  it('routes .whiteboard and .excalidraw* files cleanly and guards renames', () => {
    expect(appForPath('notes.whiteboard')).toBe('whiteboard')
    expect(appForPath('sketch.excalidraw')).toBe('whiteboard')
    expect(appForPath('sketch.excalidraw.png')).toBe('whiteboard')
    expect(appForPath('sketch.excalidraw.svg')).toBe('whiteboard')
    expect(documentExtension('sketch.excalidraw.png')).toBe('excalidraw.png')
    expect(documentExtension('sketch.excalidraw.svg')).toBe('excalidraw.svg')
    expect(renameStaysInApp('a.whiteboard', 'b.whiteboard')).toBe(true)
    expect(renameStaysInApp('a.whiteboard', 'b.excalidraw')).toBe(false)
    expect(LAUNCHABLE_EXTS).toContain('whiteboard')
    expect(LAUNCHABLE_EXTS).toContain('excalidraw')
    expect(LAUNCHABLE_DOUBLE_EXTS).toContain('excalidraw.png')
    expect(LAUNCHABLE_DOUBLE_EXTS).toContain('excalidraw.svg')
  })

  it('wires Home kinds, editor choice, Quick Look, and Generate conversions', () => {
    expect(HOME_KINDS).toContain('whiteboard')
    expect(EDITOR_ITEM_TAB_KIND.whiteboard).toBe('whiteboard')
    expect(EDITOR_ITEM_HOME_KIND.whiteboard).toBe('whiteboard')
    expect(quickLookFamilyOf('whiteboard')).toBe('whiteboard')
    expect(isQuickLookSupportedPath('board.whiteboard')).toBe(true)
    expect(AI_TARGET_KINDS).toContain('whiteboard')
    expect(CONVERT_KINDS).toContain('whiteboard-to-markdown')
    expect(availableConversions(['C:/docs/sprint.whiteboard'])).toEqual(['whiteboard-to-markdown'])
  })

  it('checks .whiteboard and .excalidraw* before opening a tab', () => {
    const open = vi.fn()
    const warn = vi.fn()
    expect(
      openWhiteboardChecked('bad.whiteboard', {
        refusal: () => 'corrupt zip',
        excalidrawRefusal: () => null,
        open,
        warn,
      }),
    ).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('corrupt zip', 'bad.whiteboard')

    expect(
      openWhiteboardChecked('scene.excalidraw.png', {
        refusal: () => null,
        excalidrawRefusal: () => 'no scene chunk',
        open,
        warn,
      }),
    ).toBe(false)
    expect(warn).toHaveBeenCalledWith('no scene chunk', 'scene.excalidraw.png')

    expect(
      openWhiteboardChecked('good.whiteboard', {
        refusal: () => null,
        excalidrawRefusal: () => null,
        open,
        warn,
      }),
    ).toBe(true)
    expect(open).toHaveBeenCalledWith('good.whiteboard')
  })

  it('registers read_whiteboard and apply_whiteboard_ops MCP tools', async () => {
    const read = vi.fn(async () => ({ text: 'Page 1\n- Sticky' }))
    const apply = vi.fn(async () => ({ ok: true, changed: true }))
    const tools = createWhiteboardTools({
      control: {
        list: async () => [
          {
            id: 't1',
            kind: 'whiteboard',
            title: 'Sprint.whiteboard',
            filePath: 'C:/Sprint.whiteboard',
            active: true,
            dirty: false,
          },
        ],
        read,
        apply,
      },
    })
    expect(tools.map((t) => t.name)).toEqual(['read_whiteboard', 'apply_whiteboard_ops'])
    const readRes = await tools[0]!.handler({})
    expect(readRes).toMatchObject({ text: 'Page 1\n- Sticky' })
    const applyRes = await tools[1]!.handler({ ops: [{ op: 'add', kind: 'sticky' }] })
    expect(applyRes).toMatchObject({ ok: true, changed: true })
  })

  it('registers .excalidraw as Open-With only in NSIS installer without hijacking default', () => {
    const nsh = readFileSync(join(__dirname, '../build/installer.nsh'), 'utf8')
    expect(nsh).toContain('GENOFFICE_EXCALIDRAW_PROGID "IeumOffice.ExcalidrawDrawing"')
    expect(nsh).toContain('Software\\Classes\\.excalidraw\\OpenWithProgids')
    expect(nsh).toContain('GenOfficeRegisterOpenWithExcalidraw')
    expect(nsh).toContain('GenOfficeUnregisterOpenWithExcalidraw')
  })
})
