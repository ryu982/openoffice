import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import type { Editor } from '@tiptap/core'
import { TextSelection, type Selection } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import { Dropdown, useImeEnterGuard } from '@genoffice/ui'
import { useI18n } from '../i18n/locale'
import {
  applyBlockStyle,
  BLOCK_STYLES,
  BLOCK_STYLE_LABEL,
  blockStyleShortcut,
  currentBlockStyle,
  INLINE_SHORTCUTS,
  LIST_SHORTCUTS,
  OPEN_SELECTION_LINK,
  toggleList,
  toggleStyle,
} from '../editor/formatting'
import { setInactiveSelectionShown } from '../editor/inactiveSelection'
import { uiOp } from '../editor/ops'
import { IconBullets, IconInlineCode, IconLink, IconNumbered, IconTaskList } from './icons'

const MARKS = [
  { mark: 'bold', label: 'bold', icon: <b>B</b> },
  { mark: 'italic', label: 'italic', icon: <i>I</i> },
  { mark: 'strike', label: 'strike', icon: <s>S</s> },
  { mark: 'highlight', label: 'highlight', icon: <mark>ab</mark> },
  { mark: 'code', label: 'inlineCode', icon: <IconInlineCode size={16} /> },
] as const

const LISTS = [
  { list: 'bullet', node: 'bulletList', label: 'bulletList', icon: <IconBullets size={16} /> },
  { list: 'ordered', node: 'orderedList', label: 'orderedList', icon: <IconNumbered size={16} /> },
  { list: 'task', node: 'taskList', label: 'taskList', icon: <IconTaskList size={16} /> },
] as const

const IS_MAC = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
const EDGE = 8

function shortcutText(shortcut: string): string {
  return shortcut
    .replace('Mod', IS_MAC ? '⌘' : 'Ctrl')
    .replace('Alt', IS_MAC ? '⌥' : 'Alt')
    .replace(/-([a-z])$/, (_, key: string) => `-${key.toUpperCase()}`)
    .replaceAll('-', '+')
}

function rangeAnchor(editor: Editor, scroller: HTMLElement) {
  const sel = editor.state.selection
  if (!(sel instanceof TextSelection) || sel.empty || !editor.isEditable || editor.isDestroyed) {
    return null
  }
  const start = editor.view.coordsAtPos(sel.from, 1)
  const end = editor.view.coordsAtPos(sel.to, -1)
  const bounds = scroller.getBoundingClientRect()
  const top = Math.min(start.top, end.top)
  const bottom = Math.max(start.bottom, end.bottom)
  const head = sel.head === sel.from ? start : end
  if (bottom <= bounds.top || top >= bounds.bottom) return null
  return { left: start.left, top, bottom, head: head.top }
}

function FormatButton({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  shortcut: string
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="md-format-btn"
      aria-label={label}
      aria-pressed={active}
      aria-keyshortcuts={shortcut.replace('Mod', IS_MAC ? 'Meta' : 'Control').replaceAll('-', '+')}
      data-tip={`${label} (${shortcutText(shortcut)})`}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  )
}

export function SelectionFormatBar({
  editor,
  scrollRef,
  zoom,
}: {
  editor: Editor
  scrollRef: RefObject<HTMLElement | null>
  zoom: number
}) {
  const { t } = useI18n()
  const barRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dismissed = useRef<Selection | null>(null)
  const [anchor, setAnchor] = useState<ReturnType<typeof rangeAnchor>>(null)
  const [linkUrl, setLinkUrl] = useState<string | null>(null)
  const linkOpen = linkUrl !== null
  const ime = useImeEnterGuard()

  const dismiss = useCallback(() => {
    dismissed.current = editor.state.selection
    setAnchor(null)
    setLinkUrl(null)
  }, [editor])

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const sel = e.state.selection
      if (!(sel instanceof TextSelection) || sel.empty) return null
      return {
        style: currentBlockStyle(e),
        marks: MARKS.map(({ mark }) => ({
          active: e.isActive(mark),
          enabled: e.can().setMark(mark),
        })),
        lists: LISTS.map(({ node }) => e.isActive(node)),
        link: e.isActive('link'),
        canLink: e.can().setMark('link'),
      }
    },
  })
  const hasTextSelection = state !== null

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const dom = editor.view.dom
    let selecting = false
    let frame = 0
    const update = () => {
      const sel = editor.state.selection
      if (dismissed.current && !sel.eq(dismissed.current)) dismissed.current = null
      const focus = document.activeElement
      const focused = dom.contains(focus) || barRef.current?.contains(focus)
      const next =
        !selecting && !dismissed.current && focused ? rangeAnchor(editor, scroller) : null
      setAnchor((previous) =>
        previous &&
        next &&
        previous.left === next.left &&
        previous.top === next.top &&
        previous.bottom === next.bottom &&
        previous.head === next.head
          ? previous
          : next,
      )
      if (!next) setLinkUrl(null)
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    const pointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (barRef.current?.contains(target)) return
      selecting = event.button === 0 && dom.contains(target)
      dismiss()
    }
    const pointerEnd = () => {
      if (!selecting) return
      selecting = false
      schedule()
    }
    const windowBlur = () => {
      selecting = false
      dismiss()
    }
    const keyDown = (event: KeyboardEvent) => {
      const bar = barRef.current
      if (!bar || event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        dismiss()
      } else if (
        event.key === 'F10' &&
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault()
        bar.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
      }
    }
    const openLink = (event: Event) => {
      const next = rangeAnchor(editor, scroller)
      if (!next || !editor.can().setMark('link')) return
      event.preventDefault()
      dismissed.current = null
      setAnchor(next)
      setLinkUrl(String(editor.getAttributes('link').href ?? ''))
    }
    const resize = new ResizeObserver(schedule)
    resize.observe(scroller)
    editor.on('transaction', schedule)
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    document.addEventListener('pointerdown', pointerDown, true)
    document.addEventListener('pointerup', pointerEnd, true)
    document.addEventListener('pointercancel', pointerEnd, true)
    dom.addEventListener('keydown', keyDown, true)
    dom.addEventListener(OPEN_SELECTION_LINK, openLink)
    scroller.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('blur', windowBlur)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      editor.off('transaction', schedule)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
      document.removeEventListener('pointerdown', pointerDown, true)
      document.removeEventListener('pointerup', pointerEnd, true)
      document.removeEventListener('pointercancel', pointerEnd, true)
      dom.removeEventListener('keydown', keyDown, true)
      dom.removeEventListener(OPEN_SELECTION_LINK, openLink)
      scroller.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('blur', windowBlur)
    }
  }, [dismiss, editor, scrollRef, zoom])

  useLayoutEffect(() => {
    const bar = barRef.current
    const scroller = scrollRef.current
    if (!anchor || !bar || !scroller || !hasTextSelection) return
    const place = () => {
      const { width, height } = bar.getBoundingClientRect()
      const viewport = scroller.getBoundingClientRect()
      const above = anchor.top - EDGE - height
      // The AI selection action uses the space just below the selection.
      const below = anchor.bottom + 40
      const top =
        above >= viewport.top + EDGE
          ? above
          : below + height <= viewport.bottom - EDGE
            ? below
            : Math.max(viewport.top + EDGE, anchor.head - height - EDGE)
      bar.style.left = `${Math.max(EDGE, Math.min(anchor.left, window.innerWidth - width - EDGE))}px`
      bar.style.top = `${Math.max(EDGE, Math.min(top, window.innerHeight - height - EDGE))}px`
    }
    place()
    const resize = new ResizeObserver(place)
    resize.observe(bar)
    return () => resize.disconnect()
  }, [anchor, scrollRef, hasTextSelection, zoom])

  useLayoutEffect(() => {
    if (!linkOpen) return
    setInactiveSelectionShown(editor, true)
    inputRef.current?.focus({ preventScroll: true })
    inputRef.current?.select()
    return () => setInactiveSelectionShown(editor, false)
  }, [editor, linkOpen])

  if (!anchor || !state) return null
  const saveLink = (href: string | null) => {
    if (uiOp(editor, { op: 'setLink', target: 'selection', href })) setLinkUrl(null)
  }

  return (
    <div
      ref={barRef}
      className="md-format-bar"
      role="group"
      aria-label={t('selectionFormatting')}
      aria-keyshortcuts="Alt+F10"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
        event.preventDefault()
        event.stopPropagation()
        editor.commands.focus()
        if (linkOpen) setLinkUrl(null)
        else dismiss()
      }}
    >
      <div className="md-format-row">
        <Dropdown
          className="md-format-style"
          value={state.style}
          options={BLOCK_STYLES.map((style) => ({
            value: style,
            label: t(BLOCK_STYLE_LABEL[style]),
            render: (
              <>
                <span>{t(BLOCK_STYLE_LABEL[style])}</span>
                <kbd>{shortcutText(blockStyleShortcut(style))}</kbd>
              </>
            ),
          }))}
          onPick={(style) => applyBlockStyle(editor, style)}
        />
        <div className="md-format-actions">
          {MARKS.map(({ mark, label, icon }, index) => (
            <FormatButton
              key={mark}
              label={t(label)}
              shortcut={INLINE_SHORTCUTS[mark]}
              active={state.marks[index]!.active}
              disabled={!state.marks[index]!.enabled}
              onClick={() => toggleStyle(editor, mark)}
            >
              {icon}
            </FormatButton>
          ))}
          <FormatButton
            label={t('link')}
            shortcut={INLINE_SHORTCUTS.link}
            active={linkOpen || state.link}
            disabled={!state.canLink}
            onClick={() => {
              if (linkOpen) editor.commands.focus()
              setLinkUrl(linkOpen ? null : String(editor.getAttributes('link').href ?? ''))
            }}
          >
            <IconLink size={16} />
          </FormatButton>
        </div>
        <div className="md-format-actions">
          {LISTS.map(({ list, label, icon }, index) => (
            <FormatButton
              key={list}
              label={t(label)}
              shortcut={LIST_SHORTCUTS[list]}
              active={state.lists[index]!}
              onClick={() => toggleList(editor, list)}
            >
              {icon}
            </FormatButton>
          ))}
        </div>
      </div>
      {linkUrl !== null && (
        <div className="md-format-link">
          <input
            ref={inputRef}
            value={linkUrl}
            aria-label={t('linkPlaceholder')}
            placeholder={t('linkPlaceholder')}
            onChange={(event) => setLinkUrl(event.target.value)}
            onCompositionStart={ime.handleCompositionStart}
            onCompositionEnd={ime.handleCompositionEnd}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || ime.isImeConfirm(event.nativeEvent)) return
              event.preventDefault()
              if (linkUrl.trim()) saveLink(linkUrl.trim())
            }}
          />
          {state.link && (
            <button type="button" onClick={() => saveLink(null)}>
              {t('linkRemove')}
            </button>
          )}
          <button type="button" disabled={!linkUrl.trim()} onClick={() => saveLink(linkUrl.trim())}>
            {t('linkApply')}
          </button>
        </div>
      )}
    </div>
  )
}
