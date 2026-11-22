/** @vitest-environment jsdom */
import React, { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiScrollToBottom, useScrollToBottom } from '../src/AiScrollToBottom'

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

function Harness() {
  const ref = useRef<HTMLDivElement | null>(null)
  const scroll = useScrollToBottom(ref, 80)
  return (
    <>
      <div ref={ref} className="chat-box" onScroll={scroll.onScroll} />
      <AiScrollToBottom lang="ko" visible={scroll.showButton} onClick={scroll.scrollToBottom} />
    </>
  )
}

describe('AiScrollToBottom & useScrollToBottom', () => {
  it('stays hidden near bottom, appears when scrolled up > threshold, and scrolls back on click', () => {
    act(() => {
      root.render(<Harness />)
    })
    const box = container.querySelector<HTMLDivElement>('.chat-box')!
    const scrollTo = vi.fn()
    box.scrollTo = scrollTo
    Object.defineProperty(box, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(box, 'clientHeight', { value: 400, configurable: true })
    Object.defineProperty(box, 'scrollTop', { value: 550, writable: true, configurable: true })

    // Distance = 1000 - 550 - 400 = 50 <= 80 -> hidden
    act(() => {
      box.dispatchEvent(new Event('scroll'))
    })
    expect(container.querySelector('.ai-scroll-bottom-btn')).toBeNull()

    // Distance = 1000 - 200 - 400 = 400 > 80 -> visible
    box.scrollTop = 200
    act(() => {
      box.dispatchEvent(new Event('scroll'))
    })
    const btn = container.querySelector<HTMLButtonElement>('.ai-scroll-bottom-btn')!
    expect(btn).not.toBeNull()

    act(() => {
      btn.click()
    })
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' })
    expect(container.querySelector('.ai-scroll-bottom-btn')).toBeNull()
  })
})
