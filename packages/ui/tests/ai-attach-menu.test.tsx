/** @vitest-environment jsdom */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiAttachMenu, connectorPickedOf } from '../src/AiAttachMenu'
import { aiPanelText } from '../src/strings-ai-panel'
import { connectorAttachText } from '../src/strings-attach-menu'

const g = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean
  aiOfficeDocs?: { available: () => Promise<boolean>; pick: () => Promise<unknown> }
  aiOfficeDriveAi?: {
    driveConnected: () => Promise<boolean>
    onDriveConnectedChanged: (fn: (connected: boolean) => void) => () => void
    drivePickAttachments: () => Promise<unknown>
  }
  aiOfficeConnectorAttach?: {
    availableSources: () => Promise<{ obsidian: boolean; notion: boolean; canva?: boolean }>
    onSourcesChanged: (
      fn: (s: { obsidian: boolean; notion: boolean; canva?: boolean }) => void,
    ) => () => void
    pickObsidianNotes: () => Promise<unknown>
    pickNotionPages: () => Promise<unknown>
    pickCanvaDesigns?: () => Promise<unknown>
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  g.IS_REACT_ACT_ENVIRONMENT = true
  delete g.aiOfficeDocs
  delete g.aiOfficeDriveAi
  delete g.aiOfficeConnectorAttach
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete g.aiOfficeDocs
  delete g.aiOfficeDriveAi
  delete g.aiOfficeConnectorAttach
})

describe('AiAttachMenu', () => {
  it('renders nothing when no attachment source is available', () => {
    act(() => {
      root.render(<AiAttachMenu lang="ko" />)
    })
    expect(container.querySelector('.ai-attach-menu')).toBeNull()
  })

  it('opens popover with only PC option when docs/drive bridges are absent', () => {
    const onPickPc = vi.fn()
    act(() => {
      root.render(<AiAttachMenu lang="ko" onPickPc={onPickPc} />)
    })
    const trigger = container.querySelector<HTMLButtonElement>('.ai-attach-menu-btn')!
    expect(trigger).not.toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    act(() => {
      trigger.click()
    })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>('.ai-attach-menu-item'))
    expect(items).toHaveLength(1)
    expect(items[0]!.textContent).toContain(aiPanelText('ko', 'attachFromPc'))

    act(() => {
      items[0]!.click()
    })
    expect(onPickPc).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.ai-attach-menu-pop')).toBeNull()
  })

  it('shows all three sources when PC, Docs, and Drive are available and stops Escape from propagating', async () => {
    g.aiOfficeDocs = {
      available: vi.fn().mockResolvedValue(true),
      pick: vi.fn().mockResolvedValue({ paths: ['/a.docx'] }),
    }
    g.aiOfficeDriveAi = {
      driveConnected: vi.fn().mockResolvedValue(true),
      onDriveConnectedChanged: vi.fn(() => () => {}),
      drivePickAttachments: vi.fn().mockResolvedValue({ paths: ['/b.pdf'] }),
    }
    const onPickedDocs = vi.fn()
    const onPickedDrive = vi.fn()
    await act(async () => {
      root.render(
        <AiAttachMenu
          lang="en"
          onPickPc={vi.fn()}
          onPickedDocs={onPickedDocs}
          onPickedDrive={onPickedDrive}
        />,
      )
      await Promise.resolve()
    })

    const trigger = container.querySelector<HTMLButtonElement>('.ai-attach-menu-btn')!
    act(() => {
      trigger.click()
    })
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>('.ai-attach-menu-item'))
    expect(items).toHaveLength(3)

    // Bubble-phase window listener simulates a run-stop Escape handler
    const bubbleEscape = vi.fn()
    window.addEventListener('keydown', bubbleEscape, false)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    window.removeEventListener('keydown', bubbleEscape, false)

    expect(container.querySelector('.ai-attach-menu-pop')).toBeNull()
    expect(bubbleEscape).not.toHaveBeenCalled()
  })

  it('shows Obsidian, Notion, and Canva menu items when connector sources are available and forwards picked paths/notes', async () => {
    let emit: ((s: { obsidian: boolean; notion: boolean; canva?: boolean }) => void) | undefined
    const pickCanvaDesigns = vi.fn().mockResolvedValue({ ok: true, paths: ['/tmp/design.md'] })
    g.aiOfficeConnectorAttach = {
      availableSources: vi.fn().mockResolvedValue({ obsidian: true, notion: true, canva: true }),
      onSourcesChanged: vi.fn((fn) => {
        emit = fn
        return () => {}
      }),
      pickObsidianNotes: vi.fn().mockResolvedValue({ ok: true, paths: ['/vault/a.md'] }),
      pickNotionPages: vi.fn().mockResolvedValue({
        ok: true,
        paths: ['/tmp/page.md'],
        omittedNonText: 2,
      }),
      pickCanvaDesigns,
    }
    const onPickedDrive = vi.fn()
    await act(async () => {
      root.render(<AiAttachMenu lang="ko" onPickPc={vi.fn()} onPickedDrive={onPickedDrive} />)
      await Promise.resolve()
    })

    act(() => {
      container.querySelector<HTMLButtonElement>('.ai-attach-menu-btn')!.click()
    })
    const obsItem = container.querySelector<HTMLButtonElement>('[data-source="obsidian"]')
    const notionItem = container.querySelector<HTMLButtonElement>('[data-source="notion"]')
    const canvaItem = container.querySelector<HTMLButtonElement>('[data-source="canva"]')
    expect(obsItem?.textContent).toContain(connectorAttachText('ko', 'attachFromObsidian'))
    expect(notionItem?.textContent).toContain(connectorAttachText('ko', 'attachFromNotion'))
    expect(canvaItem?.textContent).toContain(connectorAttachText('ko', 'attachFromCanva'))

    await act(async () => {
      notionItem!.click()
      await Promise.resolve()
    })
    expect(onPickedDrive).toHaveBeenCalledWith({
      paths: ['/tmp/page.md'],
      notes: [connectorAttachText('ko', 'connectorOmittedNonText', { n: 2 })],
    })

    act(() => {
      container.querySelector<HTMLButtonElement>('.ai-attach-menu-btn')!.click()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-source="canva"]')!.click()
      await Promise.resolve()
    })
    expect(pickCanvaDesigns).toHaveBeenCalledTimes(1)
    expect(onPickedDrive).toHaveBeenCalledWith({ paths: ['/tmp/design.md'], notes: [] })

    // Dynamically hiding Notion & Canva removes their items
    await act(async () => {
      emit?.({ obsidian: true, notion: false, canva: false })
      await Promise.resolve()
    })
    act(() => {
      container.querySelector<HTMLButtonElement>('.ai-attach-menu-btn')!.click()
    })
    expect(container.querySelector('[data-source="obsidian"]')).not.toBeNull()
    expect(container.querySelector('[data-source="notion"]')).toBeNull()
    expect(container.querySelector('[data-source="canva"]')).toBeNull()

    expect(connectorPickedOf({ ok: false, reason: 'busy' }, 'en').notes).toHaveLength(1)
  })
})
