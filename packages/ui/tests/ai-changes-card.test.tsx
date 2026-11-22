/** @vitest-environment jsdom */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiChangesCard, type AiChangeLine } from '../src/AiChangesCard'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('AiChangesCard', () => {
  const lines: AiChangeLine[] = [
    { kind: 'insert', to: 'Added heading', showable: true },
    { kind: 'delete', from: 'Removed note', showable: false },
  ]

  it('renders jump button with arrow icon on showable rows and invokes onShowLine with index', () => {
    const onShowLine = vi.fn()
    act(() => {
      root.render(
        <AiChangesCard
          lang="ko"
          count={2}
          state="applied"
          canRevert
          lines={lines}
          onShowLine={onShowLine}
          onRevert={vi.fn()}
        />,
      )
    })

    const showButtons = container.querySelectorAll<HTMLButtonElement>('.ai-run-change-go')
    expect(showButtons).toHaveLength(1)
    expect(showButtons[0]!.querySelector('.ai-run-change-jump svg')).not.toBeNull()

    act(() => {
      showButtons[0]!.click()
    })
    expect(onShowLine).toHaveBeenCalledWith(0)
  })

  it('disables jump buttons when changes are reverted', () => {
    act(() => {
      root.render(
        <AiChangesCard
          lang="en"
          count={2}
          state="reverted"
          canRevert={false}
          lines={lines}
          onShowLine={vi.fn()}
        />,
      )
    })
    expect(container.querySelector('.ai-run-change-go')).toBeNull()
  })
})
