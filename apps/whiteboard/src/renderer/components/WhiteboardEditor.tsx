/**
 * Interactive whiteboard canvas editor in warm paper-craft style:
 * - Warm paper workspace chrome (clean header, left miniature page rail, floating vertical
 *   icon tool rail, bottom-left undo/zoom capsules, dark floating contextual format bar)
 * - Warm paper-craft canvas objects:
 *   - Ivory paper (#FFFDF8) with warm 32px dot grid on freeform pages
 *   - Borderless square sticky notes (rx=3, layered paper shadow, warm paper fills, rich text)
 *   - Editorial typography text objects (font size, bold/italic/underline/strike, ink color, align)
 *   - Soft warm-fill geometric shapes with shape-aware inner text boxes and solid/dashed borders
 *   - Geometric pulled-back arrowheads with drag-to-draw, object-edge snapping, and endpoint handles
 *   - Die-cut paper stickers, warm parchment tables, link cards, and multiply highlighters
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import {
  computeStrokeOutline,
  type BoardObject,
  type ConnectorEnd,
  type ConnectorProps,
  type ImageProps,
  type LineStyle,
  type LinkProps,
  type Page,
  type PageFormat,
  type Point,
  type RichText,
  type ShapeKind,
  type ShapeProps,
  type StickerProps,
  type StickyProps,
  type StrokeProps,
  type TableProps,
  type TextAlign,
  type TextProps,
} from '@genoffice/whiteboard-engine'
import { openableLink } from '../../shared/links'
import type { ExportFormat } from '../../shared/ipc'
import {
  computeConnectorGeometry,
  findAttachTarget,
  FONT_SIZE_PRESETS,
  LINE_WIDTH_PRESETS,
  livePaperColor,
  PAPER_COLORS,
  PAPER_FILL_SWATCHES,
  PAPER_INK_SWATCHES,
  plainRichText,
  resolveConnectorEnd,
  richTextFormatState,
  setRichTextColor,
  toggleRichTextMark,
  updateRichTextPreservingStyle,
  type RichMark,
  type SnapAttachTarget,
} from '../canvas/paper-style'
import {
  duplicateSelectionOps,
  freshIdMaker,
  layerOrderOps,
  mergeSelections,
  moveSelectionOps,
  objectsInArea,
  rectFromPoints,
  shiftedObject,
  toggleInSelection,
  unionExtent,
} from '../canvas/selection'
import { SHAPE_KINDS, shapePath, shapeTextBox } from '../canvas/shape-paths'
import { STICKER_IDS, StickerIcon } from '../canvas/stickers'
import type { WhiteboardSession } from '../document/session'
import {
  inspectPdfBytes,
  MAX_PDF_IMPORT_PAGES,
  parsePdfPageRange,
  renderPdfPagesToPng,
} from '../export/pdf-import'
import { renderPageToSvg, richTextPlain } from '../export/render-svg'
import { useI18n } from '../i18n/locale'
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AreaSelectIcon,
  ArrowEndIcon,
  ArrowStartIcon,
  BackIcon,
  ConnectorIcon,
  DashedLineIcon,
  DuplicateIcon,
  EraserIcon,
  ExportIcon,
  FitIcon,
  FrontIcon,
  HighlighterIcon,
  ImageIcon,
  LineEndIcon,
  LinkIcon,
  MinusIcon,
  PdfIcon,
  PenIcon,
  PlusIcon,
  PresentIcon,
  PrintIcon,
  RedoIcon,
  SelectIcon,
  ShapeIcon,
  ShapeKindGlyph,
  SolidLineIcon,
  StickerToolIcon,
  StickyIcon,
  TableIcon,
  TextIcon,
  TrashIcon,
  UndoIcon,
} from './icons'

type ToolKind =
  | 'select'
  | 'marquee'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'highlighter'
  | 'eraser'

/** Pointer travel, in screen pixels, under which a press counts as a click rather than a drag. */
const CLICK_SLOP = 3
/** Offset of the copies when a selection is duplicated. */
const DUPLICATE_OFFSET = 28

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'

const LINK_PREVIEW_PREF = 'whiteboardapp.linkPreview'
const IMAGE_DROP_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
const TOOLBAR_LEFT_CLEARANCE = 92
const THUMB_W = 136
const THUMB_H = 78

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function objectBounds(
  obj: BoardObject,
  byId: ReadonlyMap<string, BoardObject>,
): { x: number; y: number; width: number; height: number } {
  if (obj.kind === 'connector') {
    const p = obj.props as unknown as ConnectorProps
    const s = resolveConnectorEnd(p.start, byId)
    const e = resolveConnectorEnd(p.end, byId)
    const pts = [s, ...(p.waypoints ?? []), e]
    const xs = pts.map((pt) => pt.x)
    const ys = pts.map((pt) => pt.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    return {
      x: minX,
      y: minY,
      width: Math.max(24, Math.max(...xs) - minX),
      height: Math.max(24, Math.max(...ys) - minY),
    }
  }
  return {
    x: obj.x,
    y: obj.y,
    width: Math.max(obj.width, 24),
    height: Math.max(obj.height, 24),
  }
}

function thumbnailSwatch(obj: BoardObject): string {
  if (obj.kind === 'sticky') {
    const c = (obj.props as unknown as StickyProps).color
    return c || PAPER_FILL_SWATCHES[0]
  }
  if (obj.kind === 'shape') {
    const f = (obj.props as unknown as ShapeProps).fill
    return f && f !== 'transparent' ? f : PAPER_COLORS.zoneFill
  }
  if (obj.kind === 'stroke') {
    return (obj.props as unknown as StrokeProps).color || PAPER_COLORS.ink
  }
  if (obj.kind === 'connector') {
    return (obj.props as unknown as ConnectorProps).color || PAPER_COLORS.inkMuted
  }
  if (obj.kind === 'link') return '#F1E3D6'
  if (obj.kind === 'table') return '#EAE2D4'
  if (obj.kind === 'sticker') return '#F5C542'
  return PAPER_COLORS.lineStrong
}

function nextCycleValue<T>(list: readonly T[], current: T): T {
  const idx = list.indexOf(current)
  return list[(idx + 1) % list.length]!
}

function dashPattern(style: LineStyle | undefined, strokeWidth: number): string | undefined {
  if (style === 'dashed') return `${strokeWidth * 3} ${strokeWidth * 2.4}`
  if (style === 'dotted') return `${strokeWidth} ${strokeWidth * 2.2}`
  return undefined
}

export type WhiteboardEditorMenuAction = 'import-pdf' | 'zoom-in' | 'zoom-out' | 'zoom-fit'

export interface WhiteboardEditorProps {
  session: WhiteboardSession
  saveStatus: 'idle' | 'saving' | 'saved' | 'failed'
  autoSave: boolean
  onToggleAutoSave(): void
  onExport(format: ExportFormat, scope: 'all' | 'current'): void
  onPrint(): void
  exportModalFormat: ExportFormat | null
  onCloseExportModal(): void
  onOpenExportModal(format: ExportFormat): void
  presenting: boolean
  onSetPresenting(v: boolean): void
  onToast(message: string): void
  menuCommand?: { seq: number; cmd: WhiteboardEditorMenuAction } | null
}

export function WhiteboardEditor({
  session,
  saveStatus,
  autoSave,
  onToggleAutoSave,
  onExport,
  onPrint,
  exportModalFormat,
  onCloseExportModal,
  onOpenExportModal,
  presenting,
  onSetPresenting,
  onToast,
  menuCommand,
}: WhiteboardEditorProps): ReactElement {
  const { t } = useI18n()
  const [, setTick] = useState(0)
  const [tool, setTool] = useState<ToolKind>('select')
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rounded_rectangle')
  const [shapePopoverOpen, setShapePopoverOpen] = useState(false)
  const [activeColor, setActiveColor] = useState<string>(PAPER_FILL_SWATCHES[0])
  const [penColor, setPenColor] = useState<string>(PAPER_COLORS.ink)
  const [penWidth, setPenWidth] = useState<number>(4)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 96, y: 48 })
  const [stickerOpen, setStickerOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [exportScope, setExportScope] = useState<'all' | 'current'>('all')

  // Link card modal state (opt-in preview off by default, remembered per preference).
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [linkFetchPreview, setLinkFetchPreview] = useState(
    () => localStorage.getItem(LINK_PREVIEW_PREF) === '1',
  )
  const [linkBusy, setLinkBusy] = useState(false)

  // PDF import modal state.
  const [pdfPending, setPdfPending] = useState<{
    name: string
    bytes: Uint8Array
    pageCount: number
  } | null>(null)
  const [pdfRange, setPdfRange] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)

  // Active pointer interaction refs.
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    kind:
      | 'move'
      | 'pan'
      | 'draw'
      | 'resize'
      | 'connector-draw'
      | 'endpoint-drag'
      | 'marquee'
      | 'group-move'
    startClientX: number
    startClientY: number
    startPanX: number
    startPanY: number
    objectId?: string
    origX?: number
    origY?: number
    origW?: number
    origH?: number
    corner?: ResizeCorner
    points?: Array<[number, number, number]>
    startPoint?: Point
    startAttach?: SnapAttachTarget | null
    whichEnd?: 'start' | 'end'
    /** Marquee: the drag adds to the selection it started with instead of replacing it. */
    additive?: boolean
    /** Group move: every object that moves together. */
    groupIds?: readonly string[]
    /** Group move: the object a press without a drag narrows the selection to. */
    collapseTo?: string
  } | null>(null)

  const [liveStroke, setLiveStroke] = useState<Array<[number, number, number]> | null>(null)
  const [liveConnector, setLiveConnector] = useState<{
    start: Point
    end: Point
    startTargetId: string | null
    endTargetId: string | null
  } | null>(null)
  const [endpointPreview, setEndpointPreview] = useState<{
    id: string
    which: 'start' | 'end'
    end: ConnectorEnd
    targetId: string | null
  } | null>(null)
  const [dragDelta, setDragDelta] = useState<{
    id: string
    dx: number
    dy: number
    dw: number
    dh: number
  } | null>(null)
  // Area selection being dragged: its corners on the board, and the selection a Shift/Ctrl drag
  // adds to.
  const [marquee, setMarquee] = useState<{
    start: Point
    end: Point
    base: readonly string[]
  } | null>(null)
  // Several selected objects being dragged together.
  const [groupDelta, setGroupDelta] = useState<{
    ids: ReadonlySet<string>
    dx: number
    dy: number
  } | null>(null)

  useEffect(() => session.subscribe(() => setTick((n) => n + 1)), [session])

  const doc = session.getDocument()
  const activePage = session.getActivePage()
  const activePageId = activePage?.id ?? ''
  const selectedIds = session.getSelection()
  const highlights = session.getHighlights()
  const highlightSet = useMemo(() => new Set(highlights), [highlights])
  const importSummary = session.getImportSummary()

  const pageObjects = useMemo(
    () =>
      doc.objects
        .filter((o) => o.pageId === activePageId)
        .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0)),
    [doc, activePageId],
  )

  // Apply in-flight move/resize deltas so attached connectors follow objects live during drag.
  const displayedObjects = useMemo(() => {
    if (!dragDelta && !endpointPreview && !groupDelta) return pageObjects
    return pageObjects.map((o) => {
      if (groupDelta && groupDelta.ids.has(o.id)) {
        return shiftedObject(o, groupDelta.dx, groupDelta.dy)
      }
      if (dragDelta && dragDelta.id === o.id) {
        return {
          ...o,
          x: o.x + dragDelta.dx,
          y: o.y + dragDelta.dy,
          width: Math.max(32, o.width + dragDelta.dw),
          height: Math.max(24, o.height + dragDelta.dh),
        }
      }
      if (endpointPreview && endpointPreview.id === o.id && o.kind === 'connector') {
        return {
          ...o,
          props: {
            ...o.props,
            [endpointPreview.which]: endpointPreview.end,
          },
        }
      }
      return o
    })
  }, [dragDelta, endpointPreview, groupDelta, pageObjects])

  const objectsById = useMemo(
    () => new Map(displayedObjects.map((o) => [o.id, o])),
    [displayedObjects],
  )

  const selectedObj = selectedIds.length === 1 ? (objectsById.get(selectedIds[0]!) ?? null) : null
  const selectedObjects = useMemo(
    () => selectedIds.flatMap((id) => objectsById.get(id) ?? []),
    [objectsById, selectedIds],
  )
  const multiSelected = selectedObjects.length > 1

  // While an area is dragged, the objects it would select are drawn as selected.
  const marqueeRect = marquee ? rectFromPoints(marquee.start, marquee.end) : null
  const shownSelection = useMemo(() => {
    if (!marquee) return new Set(selectedIds)
    const area = rectFromPoints(marquee.start, marquee.end)
    return new Set(mergeSelections(marquee.base, objectsInArea(pageObjects, area, objectsById)))
  }, [marquee, objectsById, pageObjects, selectedIds])
  const shownMulti = shownSelection.size > 1
  const shownGroupBox = useMemo(
    () =>
      shownMulti
        ? unionExtent(
            displayedObjects.filter((o) => shownSelection.has(o.id)),
            objectsById,
          )
        : null,
    [displayedObjects, objectsById, shownMulti, shownSelection],
  )

  const clientToBoard = useCallback(
    (clientX: number, clientY: number) => {
      const rect = stageRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      }
    },
    [pan.x, pan.y, zoom],
  )

  const handleFitZoom = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect || !activePage) {
      setZoom(1)
      setPan({ x: TOOLBAR_LEFT_CLEARANCE, y: 48 })
      return
    }
    const leftPad = TOOLBAR_LEFT_CLEARANCE
    const rightPad = 40
    const topPad = 48
    const bottomPad = 76
    const availW = Math.max(240, rect.width - leftPad - rightPad)
    const availH = Math.max(180, rect.height - topPad - bottomPad)

    let minX = 0
    let minY = 0
    let maxX = activePage.width || 1280
    let maxY = activePage.height || 720
    if (activePage.format === 'freeform') {
      if (displayedObjects.length > 0) {
        const boxes = displayedObjects.map((o) => objectBounds(o, objectsById))
        minX = Math.min(...boxes.map((b) => b.x)) - 28
        minY = Math.min(...boxes.map((b) => b.y)) - 28
        maxX = Math.max(...boxes.map((b) => b.x + b.width)) + 28
        maxY = Math.max(...boxes.map((b) => b.y + b.height)) + 28
      } else {
        minX = 0
        minY = 0
        maxX = 1280
        maxY = 760
      }
    }
    const contentW = Math.max(200, maxX - minX)
    const contentH = Math.max(140, maxY - minY)
    const maxZ = activePage.format === 'freeform' ? 1 : 2
    const nextZoom = Math.max(0.2, Math.min(maxZ, Math.min(availW / contentW, availH / contentH)))
    const z = Number(nextZoom.toFixed(2))
    setZoom(z)
    setPan({
      x: Math.round(leftPad + (availW - contentW * z) / 2 - minX * z),
      y: Math.round(topPad + (availH - contentH * z) / 2 - minY * z),
    })
  }, [activePage, displayedObjects, objectsById])

  const selectTool = useCallback(
    (next: ToolKind) => {
      setTool(next)
      setStickerOpen(false)
      if (next !== 'shape') setShapePopoverOpen(false)
      if (next !== 'select' && next !== 'marquee') session.setSelection([])
    },
    [session],
  )

  // Keyboard shortcuts (Undo, Redo, Delete, F5, Escape, Present arrows, single-key tools).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null
      const typing =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.isContentEditable)

      if (presenting) {
        if (e.key === 'Escape' || e.key === 'F5') {
          e.preventDefault()
          onSetPresenting(false)
        } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
          e.preventDefault()
          const idx = doc.pages.findIndex((p) => p.id === activePageId)
          if (idx >= 0 && idx + 1 < doc.pages.length) {
            session.setActivePageId(doc.pages[idx + 1]!.id)
          }
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          e.preventDefault()
          const idx = doc.pages.findIndex((p) => p.id === activePageId)
          if (idx > 0) {
            session.setActivePageId(doc.pages[idx - 1]!.id)
          }
        }
        return
      }

      if (typing) return
      if (e.key === 'F5') {
        e.preventDefault()
        onSetPresenting(true)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) session.redo()
        else session.undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        session.redo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') {
        // Select every object on the page instead of the page's text.
        e.preventDefault()
        const pageId = session.getActivePageId()
        setTool('select')
        session.setSelection(
          session
            .getDocument()
            .objects.filter((o) => o.pageId === pageId)
            .map((o) => o.id),
        )
        return
      }
      if (e.key === 'Escape') {
        const drag = dragRef.current
        if (drag?.kind === 'marquee' || drag?.kind === 'group-move') {
          dragRef.current = null
          setMarquee(null)
          setGroupDelta(null)
        }
        setStickerOpen(false)
        setShapePopoverOpen(false)
        setTool('select')
        session.setSelection([])
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (session.getSelection().length > 0) {
          e.preventDefault()
          session.deleteSelected()
        }
        return
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'v') selectTool('select')
        else if (k === 'm') selectTool('marquee')
        else if (k === 'n') selectTool('sticky')
        else if (k === 't') selectTool('text')
        else if (k === 'r') selectTool('shape')
        else if (k === 'l') selectTool('connector')
        else if (k === 'p') selectTool('pen')
        else if (k === 'h') selectTool('highlighter')
        else if (k === 'e') selectTool('eraser')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activePageId, doc.pages, onSetPresenting, presenting, selectTool, session])

  // Inline text commit (preserves existing bold/italic/underline/strike/color marks).
  const commitInlineEdit = useCallback(() => {
    if (!editingId) return
    const obj = objectsById.get(editingId)
    const text = editingText
    setEditingId(null)
    if (!obj) return
    if (obj.kind === 'sticky' || obj.kind === 'text' || obj.kind === 'shape') {
      const existing = (obj.props as unknown as StickyProps | TextProps | ShapeProps).text
      const defaultAlign =
        (obj.props as unknown as StickyProps | TextProps | ShapeProps).align ??
        (obj.kind === 'shape' ? 'center' : 'left')
      const patch: Record<string, unknown> = {
        text: updateRichTextPreservingStyle(existing, text, defaultAlign),
      }
      if (obj.kind === 'text') {
        const fs = (obj.props as unknown as TextProps).fontSize ?? 24
        const lines = text.split('\n')
        const longest = Math.max(...lines.map((l) => l.length), 1)
        const neededW = Math.ceil(longest * fs * 0.92 + 28)
        const neededH = Math.ceil(lines.length * fs * 1.45 + 16)
        if (neededW > obj.width) patch.width = Math.min(960, neededW)
        if (neededH > obj.height) patch.height = neededH
      }
      session.updateObject(obj.id, patch)
    }
  }, [editingId, editingText, objectsById, session])

  const startInlineEdit = useCallback((obj: BoardObject) => {
    if (obj.kind !== 'sticky' && obj.kind !== 'text' && obj.kind !== 'shape') return
    const p = obj.props as unknown as StickyProps | TextProps | ShapeProps
    setEditingId(obj.id)
    setEditingText(richTextPlain(p.text))
  }, [])

  // Add helpers.
  const handleAddSticker = useCallback(
    (stickerId: string) => {
      session.addObject({
        kind: 'sticker',
        stickerId,
        width: 96,
        height: 96,
      })
      setStickerOpen(false)
      setTool('select')
    },
    [session],
  )

  const handleAddTable = useCallback(() => {
    session.addObject({
      kind: 'table',
      width: 390,
      height: 174,
      rows: 3,
      cols: 3,
      headerRow: true,
      fontSize: 15,
      data: [
        ['Column 1', 'Column 2', 'Column 3'],
        ['', '', ''],
        ['', '', ''],
      ],
    })
    setStickerOpen(false)
    setShapePopoverOpen(false)
    setTool('select')
  }, [session])

  const handlePickImage = useCallback(async () => {
    setStickerOpen(false)
    setShapePopoverOpen(false)
    const picked = await window.whiteboardApi.core.pickImageFile()
    if (!picked.ok || !picked.bytes) return
    const res = await session.insertEditorImage({ bytes: picked.bytes, alt: picked.name })
    if (!res.ok) onToast(res.error)
  }, [onToast, session])

  const openPdfBytesForImport = useCallback(
    async (bytes: Uint8Array, name: string) => {
      try {
        const info = await inspectPdfBytes(bytes)
        if (info.pageCount <= 0) {
          onToast(t('pdfImportFailed', { error: 'empty PDF' }))
          return
        }
        if (info.pageCount === 1) {
          const rendered = await renderPdfPagesToPng(bytes, [1])
          session.importPdfPages(rendered, name.replace(/\.pdf$/i, ''))
          return
        }
        setPdfPending({ name, bytes, pageCount: info.pageCount })
        setPdfRange(`1-${Math.min(info.pageCount, MAX_PDF_IMPORT_PAGES)}`)
      } catch (err) {
        onToast(
          t('pdfImportFailed', {
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    },
    [onToast, session, t],
  )

  const handlePickPdf = useCallback(async () => {
    const picked = await window.whiteboardApi.core.pickPdfFile()
    if (!picked.ok || !picked.bytes) return
    await openPdfBytesForImport(picked.bytes, picked.name ?? 'PDF')
  }, [openPdfBytesForImport])

  const lastMenuSeqRef = useRef(0)
  useEffect(() => {
    if (!menuCommand || menuCommand.seq === lastMenuSeqRef.current) return
    lastMenuSeqRef.current = menuCommand.seq
    if (menuCommand.cmd === 'import-pdf') {
      void handlePickPdf()
    } else if (menuCommand.cmd === 'zoom-in') {
      setZoom((z) => Math.min(3, Number((z + 0.15).toFixed(2))))
    } else if (menuCommand.cmd === 'zoom-out') {
      setZoom((z) => Math.max(0.2, Number((z - 0.15).toFixed(2))))
    } else if (menuCommand.cmd === 'zoom-fit') {
      handleFitZoom()
    }
  }, [handleFitZoom, handlePickPdf, menuCommand])

  const handleConfirmPdfImport = useCallback(async () => {
    if (!pdfPending || pdfBusy) return
    setPdfBusy(true)
    try {
      const nums = parsePdfPageRange(pdfRange, pdfPending.pageCount, MAX_PDF_IMPORT_PAGES)
      if (nums.length === 0) {
        onToast(t('pdfImportFailed', { error: 'no pages selected' }))
        return
      }
      const rendered = await renderPdfPagesToPng(pdfPending.bytes, nums)
      session.importPdfPages(rendered, pdfPending.name.replace(/\.pdf$/i, ''))
      setPdfPending(null)
    } catch (err) {
      onToast(
        t('pdfImportFailed', {
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    } finally {
      setPdfBusy(false)
    }
  }, [onToast, pdfBusy, pdfPending, pdfRange, session, t])

  const handleConfirmLinkCard = useCallback(async () => {
    const safe = openableLink(linkUrl)
    if (!safe) {
      onToast(t('linkInvalidUrl'))
      return
    }
    localStorage.setItem(LINK_PREVIEW_PREF, linkFetchPreview ? '1' : '0')
    let title = linkTitle.trim()
    let description: string | undefined
    let previewResourceId: string | undefined

    if (linkFetchPreview && /^https?:\/\//i.test(safe)) {
      setLinkBusy(true)
      try {
        const preview = await window.whiteboardApi.core.readLinkPreview(safe)
        if (preview.ok) {
          if (!title && preview.title) title = preview.title
          if (preview.description) description = preview.description
          if (preview.imageBytes && preview.imageBytes.length > 0) {
            const added = session.addImageResource(preview.imageBytes)
            previewResourceId = added.resourceId
          }
        } else {
          onToast(t('linkPreviewFailed'))
        }
      } catch {
        onToast(t('linkPreviewFailed'))
      } finally {
        setLinkBusy(false)
      }
    }

    session.addObject({
      kind: 'link',
      url: safe,
      title: title || safe,
      ...(description ? { description } : {}),
      ...(previewResourceId ? { previewResourceId } : {}),
      width: 300,
      height: previewResourceId ? 176 : 92,
    })
    setLinkModalOpen(false)
    setLinkUrl('')
    setLinkTitle('')
  }, [linkFetchPreview, linkTitle, linkUrl, onToast, session, t])

  // Drag & drop routing:
  // - `.pdf` dropped onto whiteboard -> PDF page background import
  // - raster image dropped onto whiteboard -> embed image on canvas
  // - other document types -> do NOT call preventDefault() so shell drop-open opens them in a new tab!
  const isBoardDroppable = useCallback((dt: DataTransfer | null): boolean => {
    if (!dt) return false
    const files = Array.from(dt.files ?? [])
    if (files.length === 0) return false
    return files.every((f) => {
      const ext = fileExt(f.name)
      return ext === 'pdf' || IMAGE_DROP_EXTS.has(ext)
    })
  }, [])

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (isBoardDroppable(e.dataTransfer)) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    },
    [isBoardDroppable],
  )

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      if (!isBoardDroppable(e.dataTransfer)) return
      e.preventDefault()
      e.stopPropagation()
      const files = Array.from(e.dataTransfer.files)
      const pt = clientToBoard(e.clientX, e.clientY)
      for (const file of files) {
        const ext = fileExt(file.name)
        const buf = new Uint8Array(await file.arrayBuffer())
        if (ext === 'pdf') {
          await openPdfBytesForImport(buf, file.name)
        } else if (IMAGE_DROP_EXTS.has(ext)) {
          const res = await session.insertEditorImage({
            bytes: buf,
            alt: file.name,
            x: pt.x,
            y: pt.y,
          })
          if (!res.ok) onToast(res.error)
        }
      }
    },
    [clientToBoard, isBoardDroppable, onToast, openPdfBytesForImport, session],
  )

  // Stage pointer handlers.
  const handleStagePointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      setStickerOpen(false)
      setShapePopoverOpen(false)
      if (editingId) commitInlineEdit()
      const pt = clientToBoard(e.clientX, e.clientY)

      if (e.button === 1 || (tool === 'select' && e.altKey)) {
        dragRef.current = {
          kind: 'pan',
          startClientX: e.clientX,
          startClientY: e.clientY,
          startPanX: pan.x,
          startPanY: pan.y,
        }
        return
      }

      if (tool === 'sticky') {
        session.addObject({
          kind: 'sticky',
          x: Math.round(pt.x - 100),
          y: Math.round(pt.y - 100),
          width: 200,
          height: 200,
          color: activeColor,
          fontSize: 18,
          text: plainRichText(t('defaultStickyText'), { color: PAPER_COLORS.ink }),
        })
        setTool('select')
        return
      }
      if (tool === 'text') {
        session.addObject({
          kind: 'text',
          x: Math.round(pt.x - 160),
          y: Math.round(pt.y - 26),
          width: 340,
          height: 56,
          fontSize: 24,
          color: PAPER_COLORS.ink,
          text: plainRichText(t('defaultText'), { color: PAPER_COLORS.ink }),
        })
        setTool('select')
        return
      }
      if (tool === 'shape') {
        session.addObject({
          kind: 'shape',
          shape: shapeKind,
          x: Math.round(pt.x - 95),
          y: Math.round(pt.y - 60),
          width: 190,
          height: 120,
          fill: PAPER_COLORS.zoneFill,
          stroke: penColor,
          strokeWidth: 2.5,
          fontSize: 18,
          align: 'center',
          text: plainRichText('', { color: PAPER_COLORS.ink, align: 'center' }),
        })
        setTool('select')
        return
      }
      if (tool === 'connector') {
        const hit = findAttachTarget(pageObjects, pt, 12 / zoom)
        const startPt = hit ? { x: hit.x, y: hit.y } : pt
        dragRef.current = {
          kind: 'connector-draw',
          startClientX: e.clientX,
          startClientY: e.clientY,
          startPanX: pan.x,
          startPanY: pan.y,
          startPoint: startPt,
          startAttach: hit,
        }
        setLiveConnector({
          start: startPt,
          end: startPt,
          startTargetId: hit?.objectId ?? null,
          endTargetId: null,
        })
        return
      }
      if (tool === 'pen' || tool === 'highlighter') {
        const pressure = e.pressure > 0 ? e.pressure : 0.5
        const pts: Array<[number, number, number]> = [[pt.x, pt.y, pressure]]
        dragRef.current = {
          kind: 'draw',
          startClientX: e.clientX,
          startClientY: e.clientY,
          startPanX: pan.x,
          startPanY: pan.y,
          points: pts,
        }
        setLiveStroke(pts)
        return
      }
      if ((tool === 'select' || tool === 'marquee') && e.button === 0) {
        // Drag out an area to select the objects inside it; Shift or Ctrl/⌘ adds to the
        // selection. A press without a drag clears the selection as before.
        const additive = e.shiftKey || e.ctrlKey || e.metaKey
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = {
          kind: 'marquee',
          startClientX: e.clientX,
          startClientY: e.clientY,
          startPanX: pan.x,
          startPanY: pan.y,
          startPoint: pt,
          additive,
        }
        setMarquee({ start: pt, end: pt, base: additive ? session.getSelection() : [] })
        return
      }

      // Click empty stage clears selection.
      session.setSelection([])
    },
    [
      activeColor,
      clientToBoard,
      commitInlineEdit,
      editingId,
      pageObjects,
      pan.x,
      pan.y,
      penColor,
      session,
      shapeKind,
      t,
      tool,
      zoom,
    ],
  )

  const handleObjectPointerDown = useCallback(
    (e: ReactPointerEvent, obj: BoardObject) => {
      if (tool === 'connector' || tool === 'pen' || tool === 'highlighter' || tool === 'marquee') {
        // Let pointer event bubble to the SVG stage so connectors can snap-start on objects,
        // pen/highlighter can draw freely over objects, and an area drag can start on one.
        return
      }
      e.stopPropagation()
      setStickerOpen(false)
      setShapePopoverOpen(false)
      if (editingId && editingId !== obj.id) commitInlineEdit()

      if (tool === 'eraser') {
        session.setSelection([obj.id])
        session.deleteSelected()
        return
      }
      if (tool !== 'select') return

      // Shift or Ctrl/⌘ adds the object to the selection or takes it out. Pressing an object
      // that is part of a larger selection drags the whole selection.
      const current = session.getSelection()
      // Other buttons leave a selection of several objects as it is.
      if (e.button !== 0 && current.length > 1 && current.includes(obj.id)) return
      const toggle = e.shiftKey || e.ctrlKey || e.metaKey
      const next = toggle
        ? toggleInSelection(current, obj.id)
        : current.length > 1 && current.includes(obj.id)
          ? current
          : [obj.id]
      session.setSelection(next)
      if (!next.includes(obj.id)) return
      if (next.length > 1) {
        dragRef.current = {
          kind: 'group-move',
          startClientX: e.clientX,
          startClientY: e.clientY,
          startPanX: pan.x,
          startPanY: pan.y,
          objectId: obj.id,
          groupIds: next,
          ...(toggle ? {} : { collapseTo: obj.id }),
        }
        return
      }
      if (obj.kind === 'connector') return
      dragRef.current = {
        kind: 'move',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        objectId: obj.id,
        origX: obj.x,
        origY: obj.y,
        origW: obj.width,
        origH: obj.height,
      }
    },
    [commitInlineEdit, editingId, pan.x, pan.y, session, tool],
  )

  const handleResizePointerDown = useCallback(
    (e: ReactPointerEvent, obj: BoardObject, corner: ResizeCorner) => {
      e.stopPropagation()
      dragRef.current = {
        kind: 'resize',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        objectId: obj.id,
        origX: obj.x,
        origY: obj.y,
        origW: obj.width,
        origH: obj.height,
        corner,
      }
    },
    [pan.x, pan.y],
  )

  const handleEndpointPointerDown = useCallback(
    (e: ReactPointerEvent, obj: BoardObject, which: 'start' | 'end') => {
      e.stopPropagation()
      dragRef.current = {
        kind: 'endpoint-drag',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        objectId: obj.id,
        whichEnd: which,
      }
    },
    [pan.x, pan.y],
  )

  const handleStagePointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current
      if (!drag) return
      if (drag.kind === 'pan') {
        setPan({
          x: drag.startPanX + (e.clientX - drag.startClientX),
          y: drag.startPanY + (e.clientY - drag.startClientY),
        })
        return
      }
      if (drag.kind === 'draw' && drag.points) {
        const pt = clientToBoard(e.clientX, e.clientY)
        const pressure = e.pressure > 0 ? e.pressure : 0.5
        drag.points.push([pt.x, pt.y, pressure])
        setLiveStroke([...drag.points])
        return
      }
      if (drag.kind === 'marquee') {
        const pt = clientToBoard(e.clientX, e.clientY)
        setMarquee((m) => (m ? { ...m, end: pt } : m))
        return
      }
      if (drag.kind === 'group-move' && drag.groupIds) {
        const ids = drag.groupIds
        const dx = (e.clientX - drag.startClientX) / zoom
        const dy = (e.clientY - drag.startClientY) / zoom
        setGroupDelta((g) => ({ ids: g?.ids ?? new Set(ids), dx, dy }))
        return
      }
      if (drag.kind === 'connector-draw' && drag.startPoint) {
        const pt = clientToBoard(e.clientX, e.clientY)
        const exclude = new Set(drag.startAttach ? [drag.startAttach.objectId] : [])
        const endHit = findAttachTarget(pageObjects, pt, 14 / zoom, exclude, drag.startPoint)
        const endPt = endHit ? { x: endHit.x, y: endHit.y } : pt
        let startPt = drag.startPoint
        if (drag.startAttach) {
          const startObj = pageObjects.find((o) => o.id === drag.startAttach!.objectId)
          if (startObj) {
            const refaced = findAttachTarget([startObj], startPt, 9999, new Set(), endPt)
            if (refaced) startPt = { x: refaced.x, y: refaced.y }
          }
        }
        setLiveConnector({
          start: startPt,
          end: endPt,
          startTargetId: drag.startAttach?.objectId ?? null,
          endTargetId: endHit?.objectId ?? null,
        })
        return
      }
      if (drag.kind === 'endpoint-drag' && drag.objectId && drag.whichEnd) {
        const pt = clientToBoard(e.clientX, e.clientY)
        const target = findAttachTarget(pageObjects, pt, 14 / zoom, new Set([drag.objectId]))
        const nextEnd: ConnectorEnd = target
          ? { objectId: target.objectId, anchorX: target.anchorX, anchorY: target.anchorY }
          : { x: Math.round(pt.x), y: Math.round(pt.y) }
        setEndpointPreview({
          id: drag.objectId,
          which: drag.whichEnd,
          end: nextEnd,
          targetId: target?.objectId ?? null,
        })
        return
      }
      if (drag.kind === 'move' && drag.objectId) {
        setDragDelta({
          id: drag.objectId,
          dx: (e.clientX - drag.startClientX) / zoom,
          dy: (e.clientY - drag.startClientY) / zoom,
          dw: 0,
          dh: 0,
        })
        return
      }
      if (drag.kind === 'resize' && drag.objectId) {
        const rawDx = (e.clientX - drag.startClientX) / zoom
        const rawDy = (e.clientY - drag.startClientY) / zoom
        const corner = drag.corner ?? 'se'
        const origW = drag.origW ?? 100
        const origH = drag.origH ?? 60
        let dx = 0
        let dy = 0
        let dw = 0
        let dh = 0
        if (corner === 'se') {
          dw = rawDx
          dh = rawDy
        } else if (corner === 'ne') {
          dw = rawDx
          dy = Math.min(rawDy, origH - 24)
          dh = -dy
        } else if (corner === 'sw') {
          dx = Math.min(rawDx, origW - 32)
          dw = -dx
          dh = rawDy
        } else if (corner === 'nw') {
          dx = Math.min(rawDx, origW - 32)
          dw = -dx
          dy = Math.min(rawDy, origH - 24)
          dh = -dy
        }
        setDragDelta({ id: drag.objectId, dx, dy, dw, dh })
      }
    },
    [clientToBoard, pageObjects, zoom],
  )

  const handleStagePointerUp = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag) return

      const travelled =
        Math.abs(e.clientX - drag.startClientX) > CLICK_SLOP ||
        Math.abs(e.clientY - drag.startClientY) > CLICK_SLOP

      if (drag.kind === 'marquee' && drag.startPoint) {
        setMarquee(null)
        if (!travelled) {
          if (!drag.additive) session.setSelection([])
          return
        }
        const area = rectFromPoints(drag.startPoint, clientToBoard(e.clientX, e.clientY))
        const inside = objectsInArea(pageObjects, area, objectsById)
        session.setSelection(
          drag.additive ? mergeSelections(session.getSelection(), inside) : inside,
        )
        if (tool === 'marquee') setTool('select')
        return
      }

      if (drag.kind === 'group-move' && drag.groupIds) {
        setGroupDelta(null)
        if (!travelled) {
          if (drag.collapseTo) session.setSelection([drag.collapseTo])
          return
        }
        const dx = Math.round((e.clientX - drag.startClientX) / zoom)
        const dy = Math.round((e.clientY - drag.startClientY) / zoom)
        if (dx !== 0 || dy !== 0) {
          session.applyEditorOps(moveSelectionOps(pageObjects, drag.groupIds, dx, dy))
        }
        return
      }

      if (drag.kind === 'connector-draw' && drag.startPoint) {
        const pt = clientToBoard(e.clientX, e.clientY)
        const distScreen = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY)
        let startEnd: ConnectorEnd = drag.startAttach
          ? {
              objectId: drag.startAttach.objectId,
              anchorX: drag.startAttach.anchorX,
              anchorY: drag.startAttach.anchorY,
            }
          : { x: Math.round(drag.startPoint.x), y: Math.round(drag.startPoint.y) }
        let endEnd: ConnectorEnd

        if (distScreen < 10) {
          endEnd = {
            x: Math.round(drag.startPoint.x + 220),
            y: Math.round(drag.startPoint.y),
          }
        } else {
          const exclude = new Set(drag.startAttach ? [drag.startAttach.objectId] : [])
          const endHit = findAttachTarget(pageObjects, pt, 14 / zoom, exclude, drag.startPoint)
          endEnd = endHit
            ? { objectId: endHit.objectId, anchorX: endHit.anchorX, anchorY: endHit.anchorY }
            : { x: Math.round(pt.x), y: Math.round(pt.y) }
          if (drag.startAttach) {
            const startObj = pageObjects.find((o) => o.id === drag.startAttach!.objectId)
            const refPt = endHit ? { x: endHit.x, y: endHit.y } : pt
            if (startObj) {
              const refaced = findAttachTarget([startObj], drag.startPoint, 9999, new Set(), refPt)
              if (refaced) {
                startEnd = {
                  objectId: refaced.objectId,
                  anchorX: refaced.anchorX,
                  anchorY: refaced.anchorY,
                }
              }
            }
          }
        }

        setLiveConnector(null)
        session.addObject({
          kind: 'connector',
          start: startEnd,
          end: endEnd,
          color: penColor,
          strokeWidth: 4,
          endHead: 'arrow',
          lineStyle: 'solid',
        })
        setTool('select')
        return
      }

      if (drag.kind === 'endpoint-drag' && drag.objectId && drag.whichEnd) {
        const preview = endpointPreview
        setEndpointPreview(null)
        if (preview && preview.id === drag.objectId) {
          session.updateObject(drag.objectId, {
            props: { [preview.which]: preview.end },
          })
        }
        return
      }

      if (drag.kind === 'draw' && drag.points && drag.points.length > 0) {
        const pts = drag.points
        const xs = pts.map((p) => p[0])
        const ys = pts.map((p) => p[1])
        const minX = Math.min(...xs)
        const minY = Math.min(...ys)
        const maxX = Math.max(...xs)
        const maxY = Math.max(...ys)
        const relPoints: Array<[number, number, number]> = pts.map(([px, py, pr]) => [
          px - minX,
          py - minY,
          pr,
        ])
        const isHi = tool === 'highlighter'
        session.addObject({
          kind: 'stroke',
          x: minX,
          y: minY,
          width: Math.max(8, maxX - minX),
          height: Math.max(8, maxY - minY),
          tool: isHi ? 'highlighter' : 'pen',
          color: isHi ? PAPER_COLORS.highlighterYellow : penColor,
          strokeWidth: isHi ? 22 : penWidth,
          opacity: isHi ? 0.35 : 1,
          points: relPoints,
        })
        setLiveStroke(null)
        return
      }

      if (dragDelta && drag.objectId) {
        const patch: Record<string, unknown> = {}
        if (drag.kind === 'move' && (dragDelta.dx !== 0 || dragDelta.dy !== 0)) {
          patch.x = Math.round((drag.origX ?? 0) + dragDelta.dx)
          patch.y = Math.round((drag.origY ?? 0) + dragDelta.dy)
        } else if (
          drag.kind === 'resize' &&
          (dragDelta.dx !== 0 || dragDelta.dy !== 0 || dragDelta.dw !== 0 || dragDelta.dh !== 0)
        ) {
          patch.x = Math.round((drag.origX ?? 0) + dragDelta.dx)
          patch.y = Math.round((drag.origY ?? 0) + dragDelta.dy)
          patch.width = Math.max(32, Math.round((drag.origW ?? 100) + dragDelta.dw))
          patch.height = Math.max(24, Math.round((drag.origH ?? 60) + dragDelta.dh))
        }
        setDragDelta(null)
        if (Object.keys(patch).length > 0) {
          session.updateObject(drag.objectId, patch)
        }
      }
    },
    [
      clientToBoard,
      dragDelta,
      endpointPreview,
      objectsById,
      pageObjects,
      penColor,
      penWidth,
      session,
      tool,
      zoom,
    ],
  )

  // A pointer that is cancelled or loses capture mid-drag drops the area or group drag.
  const handleStagePointerCancel = useCallback(() => {
    const kind = dragRef.current?.kind
    if (kind !== 'marquee' && kind !== 'group-move') return
    dragRef.current = null
    setMarquee(null)
    setGroupDelta(null)
  }, [])

  const handleOpenLinkCard = useCallback(
    (url: string) => {
      void window.whiteboardApi.core.openLink(url).then((opened) => {
        if (!opened) onToast(t('linkNotOpened'))
      })
    },
    [onToast, t],
  )

  const handleDuplicateSelected = useCallback(() => {
    const ids = session.getSelection()
    if (ids.length > 1) {
      const nextId = freshIdMaker(
        session.getDocument().objects.map((o) => o.id),
        () => `obj-${crypto.randomUUID().slice(0, 8)}`,
      )
      session.applyEditorOps(
        duplicateSelectionOps(
          pageObjects,
          ids,
          DUPLICATE_OFFSET,
          DUPLICATE_OFFSET,
          objectsById,
          nextId,
        ),
      )
      return
    }
    if (!selectedObj) return
    session.addObject({
      kind: selectedObj.kind,
      x: selectedObj.x + 28,
      y: selectedObj.y + 28,
      width: selectedObj.width,
      height: selectedObj.height,
      props: structuredClone(selectedObj.props),
    })
  }, [objectsById, pageObjects, selectedObj, session])

  // One user undo step for one object or many; the selection keeps its own stacking order.
  const handleLayerOrder = useCallback(
    (direction: 'front' | 'back') => {
      session.applyEditorOps(layerOrderOps(pageObjects, session.getSelection(), direction))
    },
    [pageObjects, session],
  )

  const handleToggleMark = useCallback(
    (mark: RichMark) => {
      if (
        !selectedObj ||
        (selectedObj.kind !== 'sticky' &&
          selectedObj.kind !== 'text' &&
          selectedObj.kind !== 'shape')
      ) {
        return
      }
      const p = selectedObj.props as unknown as StickyProps | TextProps | ShapeProps
      session.updateObject(selectedObj.id, { text: toggleRichTextMark(p.text, mark) })
    },
    [selectedObj, session],
  )

  const handleCycleFontSize = useCallback(() => {
    if (
      !selectedObj ||
      (selectedObj.kind !== 'sticky' && selectedObj.kind !== 'text' && selectedObj.kind !== 'shape')
    ) {
      return
    }
    const p = selectedObj.props as unknown as StickyProps | TextProps | ShapeProps
    const fallback = selectedObj.kind === 'text' ? 24 : 18
    const current = p.fontSize ?? fallback
    const nearest =
      FONT_SIZE_PRESETS.find((s) => s >= current) ??
      FONT_SIZE_PRESETS[FONT_SIZE_PRESETS.length - 1]!
    const nextSize = nextCycleValue(FONT_SIZE_PRESETS, nearest)
    const patch: Record<string, unknown> = { fontSize: nextSize }
    if (selectedObj.kind === 'text') {
      const plain = richTextPlain(p.text)
      const lines = plain.split('\n')
      const longest = Math.max(...lines.map((l) => l.length), 1)
      const neededW = Math.ceil(longest * nextSize * 0.92 + 28)
      const neededH = Math.ceil(lines.length * nextSize * 1.45 + 16)
      if (neededW > selectedObj.width) patch.width = Math.min(1100, neededW)
      if (neededH > selectedObj.height) patch.height = neededH
    }
    session.updateObject(selectedObj.id, patch)
  }, [selectedObj, session])

  const handleCycleAlign = useCallback(() => {
    if (
      !selectedObj ||
      (selectedObj.kind !== 'sticky' && selectedObj.kind !== 'text' && selectedObj.kind !== 'shape')
    ) {
      return
    }
    const p = selectedObj.props as unknown as StickyProps | TextProps | ShapeProps
    const current: TextAlign = p.align ?? (selectedObj.kind === 'shape' ? 'center' : 'left')
    const nextAlign = nextCycleValue(['left', 'center', 'right'] as const, current)
    session.updateObject(selectedObj.id, { align: nextAlign })
  }, [selectedObj, session])

  const presentSvg = useMemo(() => {
    if (!presenting || !activePage) return null
    return renderPageToSvg(doc, activePage.id, session.getAllResourceDataUrls())
  }, [presenting, activePage, doc, session])

  const statusText =
    saveStatus === 'saving'
      ? t('statusSaving')
      : saveStatus === 'failed'
        ? t('statusSaveFailed')
        : session.isDirty()
          ? t('statusUnsaved')
          : t('statusSaved')

  const editingObj = editingId ? (objectsById.get(editingId) ?? null) : null
  const isTextEditableSelected =
    selectedObj !== null &&
    (selectedObj.kind === 'sticky' || selectedObj.kind === 'text' || selectedObj.kind === 'shape')
  const selectedTextFormat = isTextEditableSelected
    ? richTextFormatState(
        (selectedObj.props as unknown as StickyProps | TextProps | ShapeProps).text,
      )
    : null
  const selectedTextAlign: TextAlign = isTextEditableSelected
    ? ((selectedObj.props as unknown as StickyProps | TextProps | ShapeProps).align ??
      (selectedObj.kind === 'shape' ? 'center' : 'left'))
    : 'left'
  const selectedFontSize: number = isTextEditableSelected
    ? ((selectedObj.props as unknown as StickyProps | TextProps | ShapeProps).fontSize ??
      (selectedObj.kind === 'text' ? 24 : 18))
    : 18

  // Compute floating dark format bar anchor above selected object (never shifts stage layout).
  // Hidden while an area is dragged, as the press used to clear the selection right away.
  const showFormatBar = Boolean(
    (tool === 'select' && !marquee && (selectedObj || multiSelected)) ||
    tool === 'sticky' ||
    tool === 'pen',
  )
  const formatBarPos = useMemo(() => {
    if (!showFormatBar) return null
    const stageW = stageRef.current?.clientWidth ?? 900
    if (tool === 'select' && (selectedObj || multiSelected)) {
      const box = selectedObj
        ? objectBounds(selectedObj, objectsById)
        : (unionExtent(selectedObjects, objectsById) ?? { x: 0, y: 0, width: 0, height: 0 })
      // The bar for several objects holds fewer buttons, so it is narrower.
      const half = selectedObj ? 210 : 130
      const cx = pan.x + (box.x + box.width / 2) * zoom
      const topY = pan.y + box.y * zoom - 60
      const fallbackY = pan.y + (box.y + box.height) * zoom + 16
      const clampedLeft = Math.max(
        TOOLBAR_LEFT_CLEARANCE,
        Math.min(cx - half, stageW - 2 * half - 20),
      )
      return { left: Math.round(clampedLeft), top: Math.round(topY < 10 ? fallbackY : topY) }
    }
    return { left: Math.max(TOOLBAR_LEFT_CLEARANCE, Math.round(stageW / 2 - 140)), top: 14 }
  }, [
    multiSelected,
    objectsById,
    pan.x,
    pan.y,
    selectedObj,
    selectedObjects,
    showFormatBar,
    tool,
    zoom,
  ])

  const snapHighlightIds = useMemo(() => {
    const ids = new Set<string>()
    if (liveConnector?.startTargetId) ids.add(liveConnector.startTargetId)
    if (liveConnector?.endTargetId) ids.add(liveConnector.endTargetId)
    if (endpointPreview?.targetId) ids.add(endpointPreview.targetId)
    return ids
  }, [endpointPreview, liveConnector])

  const paperFill = livePaperColor(
    activePage?.background?.kind === 'solid' || activePage?.background?.kind === 'grid'
      ? activePage.background.color
      : undefined,
  )

  return (
    <div className="wb-main" onDragOver={handleDragOver} onDrop={(e) => void handleDrop(e)}>
      {/* Clean Warm-Paper Header */}
      <header className="wb-header">
        <div className="wb-header-start">
          <h1 className="wb-title">{doc.title || t('untitled')}</h1>
          <div className="wb-status-group">
            <span className="wb-status-chip">{statusText}</span>
            <label className="wb-checkbox">
              <input type="checkbox" checked={autoSave} onChange={onToggleAutoSave} />
              <span>{t('autoSave')}</span>
            </label>
          </div>
        </div>
        <div className="wb-header-end">
          <button
            type="button"
            className="wb-header-btn"
            aria-label={t('toolExport')}
            data-tip={t('toolExport')}
            onClick={() => onOpenExportModal('png')}
          >
            <ExportIcon size={16} />
            <span>{t('toolExport')}</span>
          </button>
          <button
            type="button"
            className="wb-header-btn"
            aria-label={t('toolPrint')}
            data-tip={t('toolPrint')}
            onClick={onPrint}
          >
            <PrintIcon size={16} />
            <span>{t('toolPrint')}</span>
          </button>
          <button
            type="button"
            className="wb-header-btn wb-present-btn"
            aria-label={t('toolPresent')}
            data-tip={`${t('toolPresent')} (F5)`}
            onClick={() => onSetPresenting(true)}
          >
            <PresentIcon size={16} />
            <span>{t('toolPresent')}</span>
          </button>
        </div>
      </header>

      {/* Left Thumbnail Page Rail */}
      <nav className="wb-rail wb-pages" aria-label={t('appName')}>
        <div className="wb-rail-head">
          <span>{t('appName')}</span>
          <span className="wb-rail-count">{doc.pages.length}</span>
        </div>

        <ol className="wb-rail-list">
          {doc.pages.map((p, idx) => {
            const isCurrent = p.id === activePageId
            const pObjects = doc.objects.filter((o) => o.pageId === p.id)
            return (
              <li key={p.id} className="wb-rail-item">
                <button
                  type="button"
                  className={`wb-page-tab${isCurrent ? ' active' : ''}`}
                  aria-current={isCurrent ? 'page' : undefined}
                  onClick={() => session.setActivePageId(p.id)}
                >
                  <PageThumbnail page={p} objects={pObjects} />
                </button>
                <div className="wb-rail-label">
                  <span className="wb-rail-label-text">
                    <span className={`wb-rail-num${isCurrent ? ' active' : ''}`}>{idx + 1}</span>
                    {p.title || t('pageDefaultName', { n: idx + 1 })}
                  </span>
                  {doc.pages.length > 1 && (
                    <button
                      type="button"
                      className="wb-rail-del"
                      aria-label={t('pageDelete')}
                      data-tip={t('pageDelete')}
                      onClick={() => session.deletePage(p.id)}
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ol>

        <div className="wb-rail-controls">
          <button
            type="button"
            className="wb-add-page-btn"
            onClick={() =>
              session.addPage('freeform', t('pageDefaultName', { n: doc.pages.length + 1 }))
            }
          >
            + {t('pageAdd')}
          </button>
          {activePage && (
            <select
              className="wb-select"
              value={activePage.format}
              onChange={(e) => session.setPageFormat(activePage.id, e.target.value as PageFormat)}
            >
              <option value="freeform">{t('pageFormatFreeform')}</option>
              <option value="wide_16_9">{t('pageFormatWide')}</option>
              <option value="a4_portrait">{t('pageFormatA4P')}</option>
              <option value="a4_landscape">{t('pageFormatA4L')}</option>
            </select>
          )}
          <button
            type="button"
            className="wb-rail-pdf-btn"
            aria-label={t('toolImportPdf')}
            data-tip={t('toolImportPdf')}
            onClick={() => void handlePickPdf()}
          >
            <PdfIcon size={15} />
            <span>{t('toolImportPdf')}</span>
          </button>
        </div>
      </nav>

      {/* Main Canvas Stage Column */}
      <div className="wb-stage-column">
        {/* Excalidraw skipped elements banner */}
        {importSummary && importSummary.skippedCount > 0 && (
          <div className="wb-banner" role="status">
            <span>{t('excalidrawBanner', { count: importSummary.skippedCount })}</span>
            <button type="button" className="wb-btn" onClick={() => session.dismissImportBanner()}>
              {t('excalidrawBannerDismiss')}
            </button>
          </div>
        )}

        {/* Interactive SVG Canvas Stage + Floating Workspace Controls */}
        <div className="wb-stage-wrap" ref={stageRef}>
          {/* Left-Floating Vertical Icon Tool Rail */}
          <div className="wb-toolbar" role="toolbar" aria-orientation="vertical">
            <button
              type="button"
              className={`wb-tool-btn${tool === 'select' ? ' active' : ''}`}
              aria-label={t('toolSelect')}
              data-tip={`${t('toolSelect')} (V)`}
              aria-pressed={tool === 'select'}
              onClick={() => selectTool('select')}
            >
              <SelectIcon size={20} />
              <span className="wb-tool-key" aria-hidden="true">
                V
              </span>
            </button>
            <button
              type="button"
              className={`wb-tool-btn${tool === 'marquee' ? ' active' : ''}`}
              aria-label={t('toolAreaSelect')}
              data-tip={`${t('toolAreaSelect')} (M)`}
              aria-pressed={tool === 'marquee'}
              onClick={() => selectTool('marquee')}
            >
              <AreaSelectIcon size={20} />
              <span className="wb-tool-key" aria-hidden="true">
                M
              </span>
            </button>
            <button
              type="button"
              className={`wb-tool-btn${tool === 'sticky' ? ' active' : ''}`}
              aria-label={t('toolSticky')}
              data-tip={`${t('toolSticky')} (N)`}
              aria-pressed={tool === 'sticky'}
              onClick={() => selectTool('sticky')}
            >
              <StickyIcon size={20} />
              <span className="wb-tool-key" aria-hidden="true">
                N
              </span>
            </button>
            <button
              type="button"
              className={`wb-tool-btn${tool === 'text' ? ' active' : ''}`}
              aria-label={t('toolText')}
              data-tip={`${t('toolText')} (T)`}
              aria-pressed={tool === 'text'}
              onClick={() => selectTool('text')}
            >
              <TextIcon size={20} />
              <span className="wb-tool-key" aria-hidden="true">
                T
              </span>
            </button>
            <button
              type="button"
              className={`wb-tool-btn${tool === 'shape' ? ' active' : ''}`}
              aria-label={t('toolShape')}
              data-tip={`${t('toolShape')} (R)`}
              aria-pressed={tool === 'shape'}
              onClick={() => {
                if (tool === 'shape') {
                  setShapePopoverOpen((v) => !v)
                } else {
                  selectTool('shape')
                  setShapePopoverOpen(true)
                }
              }}
            >
              <ShapeIcon size={20} />
              <span className="wb-tool-key" aria-hidden="true">
                R
              </span>
            </button>
            <button
              type="button"
              className={`wb-tool-btn${tool === 'connector' ? ' active' : ''}`}
              aria-label={t('toolConnector')}
              data-tip={`${t('toolConnector')} (L)`}
              aria-pressed={tool === 'connector'}
              onClick={() => selectTool('connector')}
            >
              <ConnectorIcon size={20} />
              <span className="wb-tool-key" aria-hidden="true">
                L
              </span>
            </button>
            <button
              type="button"
              className={`wb-tool-btn${tool === 'pen' ? ' active' : ''}`}
              aria-label={t('toolPen')}
              data-tip={`${t('toolPen')} (P)`}
              aria-pressed={tool === 'pen'}
              onClick={() => selectTool('pen')}
            >
              <PenIcon size={20} />
              <span className="wb-tool-key" aria-hidden="true">
                P
              </span>
            </button>
            <button
              type="button"
              className={`wb-tool-btn${tool === 'highlighter' ? ' active' : ''}`}
              aria-label={t('toolHighlighter')}
              data-tip={`${t('toolHighlighter')} (H)`}
              aria-pressed={tool === 'highlighter'}
              onClick={() => selectTool('highlighter')}
            >
              <HighlighterIcon size={20} />
              <span className="wb-tool-key" aria-hidden="true">
                H
              </span>
            </button>
            <button
              type="button"
              className={`wb-tool-btn${tool === 'eraser' ? ' active' : ''}`}
              aria-label={t('toolEraser')}
              data-tip={`${t('toolEraser')} (E)`}
              aria-pressed={tool === 'eraser'}
              onClick={() => selectTool('eraser')}
            >
              <EraserIcon size={20} />
              <span className="wb-tool-key" aria-hidden="true">
                E
              </span>
            </button>

            <div className="wb-tool-sep" role="separator" />

            <button
              type="button"
              className="wb-tool-btn"
              aria-label={t('toolImage')}
              data-tip={t('toolImage')}
              onClick={() => void handlePickImage()}
            >
              <ImageIcon size={20} />
            </button>
            <button
              type="button"
              className="wb-tool-btn"
              aria-label={t('toolTable')}
              data-tip={t('toolTable')}
              onClick={handleAddTable}
            >
              <TableIcon size={20} />
            </button>
            <button
              type="button"
              className={`wb-tool-btn${stickerOpen ? ' active' : ''}`}
              aria-label={t('toolSticker')}
              data-tip={t('toolSticker')}
              aria-pressed={stickerOpen}
              onClick={() => {
                setShapePopoverOpen(false)
                setStickerOpen((v) => !v)
              }}
            >
              <StickerToolIcon size={20} />
            </button>
            <button
              type="button"
              className="wb-tool-btn"
              aria-label={t('toolLink')}
              data-tip={t('toolLink')}
              onClick={() => {
                setStickerOpen(false)
                setShapePopoverOpen(false)
                setLinkModalOpen(true)
              }}
            >
              <LinkIcon size={20} />
            </button>
          </div>

          {/* Shape Options Popover beside Vertical Tool Rail */}
          {shapePopoverOpen && (
            <div className="wb-tool-popover wb-shape-grid" role="menu">
              {SHAPE_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`wb-tool-btn${shapeKind === k ? ' active' : ''}`}
                  aria-label={k}
                  data-tip={k}
                  onClick={() => {
                    setShapeKind(k)
                    setShapePopoverOpen(false)
                  }}
                >
                  <ShapeKindGlyph kind={k} size={20} />
                </button>
              ))}
            </div>
          )}

          {/* Sticker Grid Popover beside Vertical Tool Rail */}
          {stickerOpen && (
            <div className="wb-tool-popover wb-sticker-popover" role="menu">
              {STICKER_IDS.map((sid) => (
                <button
                  key={sid}
                  type="button"
                  className="wb-sticker-btn"
                  aria-label={sid}
                  onClick={() => handleAddSticker(sid)}
                >
                  <StickerIcon stickerId={sid} size={26} />
                </button>
              ))}
            </div>
          )}

          {/* Floating Dark Contextual Format Bar (zero layout shift) */}
          {showFormatBar && formatBarPos && (
            <div
              className="wb-format-bar"
              style={{ left: formatBarPos.left, top: formatBarPos.top }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* Warm paper fills for sticky notes & shapes */}
              {(tool === 'sticky' ||
                (tool === 'select' &&
                  (selectedObj?.kind === 'sticky' || selectedObj?.kind === 'shape'))) &&
                PAPER_FILL_SWATCHES.slice(0, 6).map((c) => {
                  const currentFill =
                    tool === 'select' && selectedObj?.kind === 'sticky'
                      ? (selectedObj.props as unknown as StickyProps).color
                      : tool === 'select' && selectedObj?.kind === 'shape'
                        ? (selectedObj.props as unknown as ShapeProps).fill
                        : activeColor
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`wb-swatch${currentFill?.toUpperCase() === c ? ' active' : ''}`}
                      style={{ backgroundColor: c }}
                      onClick={() => {
                        setActiveColor(c)
                        if (tool === 'select' && selectedObj?.kind === 'sticky') {
                          session.updateObject(selectedObj.id, { color: c })
                        } else if (tool === 'select' && selectedObj?.kind === 'shape') {
                          session.updateObject(selectedObj.id, { fill: c })
                        }
                      }}
                    />
                  )
                })}

              {/* Warm ink colors for pen, connector, stroke, and text */}
              {(tool === 'pen' ||
                (tool === 'select' &&
                  (selectedObj?.kind === 'connector' ||
                    selectedObj?.kind === 'stroke' ||
                    selectedObj?.kind === 'text'))) &&
                PAPER_INK_SWATCHES.slice(0, 6).map((c) => {
                  const currentInk =
                    tool === 'select' && selectedObj?.kind === 'connector'
                      ? (selectedObj.props as unknown as ConnectorProps).color
                      : tool === 'select' && selectedObj?.kind === 'stroke'
                        ? (selectedObj.props as unknown as StrokeProps).color
                        : tool === 'select' && selectedObj?.kind === 'text'
                          ? (selectedTextFormat?.color ??
                            (selectedObj.props as unknown as TextProps).color ??
                            PAPER_COLORS.ink)
                          : penColor
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`wb-swatch${currentInk?.toUpperCase() === c ? ' active' : ''}`}
                      style={{ backgroundColor: c }}
                      onClick={() => {
                        setPenColor(c)
                        if (
                          tool === 'select' &&
                          (selectedObj?.kind === 'connector' || selectedObj?.kind === 'stroke')
                        ) {
                          session.updateObject(selectedObj.id, { color: c })
                        } else if (tool === 'select' && selectedObj?.kind === 'text') {
                          const tp = selectedObj.props as unknown as TextProps
                          session.updateObject(selectedObj.id, {
                            color: c,
                            text: setRichTextColor(tp.text, c),
                          })
                        }
                      }}
                    />
                  )
                })}

              {/* Rich text controls (size, B/I/U/S, align) for sticky, text, shape */}
              {tool === 'select' && isTextEditableSelected && selectedTextFormat && (
                <>
                  <span className="wb-format-sep" />
                  <button type="button" className="wb-format-btn" onClick={handleCycleFontSize}>
                    {selectedFontSize}
                  </button>
                  <button
                    type="button"
                    className={`wb-format-btn${selectedTextFormat.bold ? ' active' : ''}`}
                    aria-pressed={selectedTextFormat.bold}
                    onClick={() => handleToggleMark('bold')}
                  >
                    <strong>B</strong>
                  </button>
                  <button
                    type="button"
                    className={`wb-format-btn${selectedTextFormat.italic ? ' active' : ''}`}
                    aria-pressed={selectedTextFormat.italic}
                    onClick={() => handleToggleMark('italic')}
                  >
                    <em style={{ fontFamily: 'Georgia, serif' }}>I</em>
                  </button>
                  <button
                    type="button"
                    className={`wb-format-btn${selectedTextFormat.underline ? ' active' : ''}`}
                    aria-pressed={selectedTextFormat.underline}
                    onClick={() => handleToggleMark('underline')}
                  >
                    <span style={{ textDecoration: 'underline' }}>U</span>
                  </button>
                  <button
                    type="button"
                    className={`wb-format-btn${selectedTextFormat.strike ? ' active' : ''}`}
                    aria-pressed={selectedTextFormat.strike}
                    onClick={() => handleToggleMark('strike')}
                  >
                    <span style={{ textDecoration: 'line-through' }}>S</span>
                  </button>
                  <button type="button" className="wb-format-btn" onClick={handleCycleAlign}>
                    {selectedTextAlign === 'center' ? (
                      <AlignCenterIcon size={16} />
                    ) : selectedTextAlign === 'right' ? (
                      <AlignRightIcon size={16} />
                    ) : (
                      <AlignLeftIcon size={16} />
                    )}
                  </button>
                </>
              )}

              {/* Shape solid/dashed border toggle */}
              {tool === 'select' && selectedObj?.kind === 'shape' && (
                <>
                  <span className="wb-format-sep" />
                  <button
                    type="button"
                    className={`wb-format-btn${
                      (selectedObj.props as unknown as ShapeProps).lineStyle === 'dashed'
                        ? ' active'
                        : ''
                    }`}
                    onClick={() => {
                      const cur = (selectedObj.props as unknown as ShapeProps).lineStyle ?? 'solid'
                      session.updateObject(selectedObj.id, {
                        lineStyle: cur === 'dashed' ? 'solid' : 'dashed',
                      })
                    }}
                  >
                    {(selectedObj.props as unknown as ShapeProps).lineStyle === 'dashed' ? (
                      <DashedLineIcon size={17} />
                    ) : (
                      <SolidLineIcon size={17} />
                    )}
                  </button>
                </>
              )}

              {/* Connector width, arrowhead caps, and solid/dashed toggle */}
              {tool === 'select' && selectedObj?.kind === 'connector' && (
                <>
                  <span className="wb-format-sep" />
                  {LINE_WIDTH_PRESETS.map((w) => {
                    const curW = (selectedObj.props as unknown as ConnectorProps).strokeWidth ?? 4
                    const nearestW = LINE_WIDTH_PRESETS.reduce((best, cand) =>
                      Math.abs(cand - curW) < Math.abs(best - curW) ? cand : best,
                    )
                    const dotPx = w === 2 ? 5 : w === 4 ? 8 : 12
                    return (
                      <button
                        key={w}
                        type="button"
                        className={`wb-format-btn${nearestW === w ? ' active' : ''}`}
                        onClick={() => session.updateObject(selectedObj.id, { strokeWidth: w })}
                      >
                        <span className="wb-width-dot" style={{ width: dotPx, height: dotPx }} />
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    className={`wb-format-btn${
                      (selectedObj.props as unknown as ConnectorProps).startHead === 'arrow'
                        ? ' active'
                        : ''
                    }`}
                    onClick={() => {
                      const cur = (selectedObj.props as unknown as ConnectorProps).startHead
                      session.updateObject(selectedObj.id, {
                        props: { startHead: cur === 'arrow' ? 'none' : 'arrow' },
                      })
                    }}
                  >
                    {(selectedObj.props as unknown as ConnectorProps).startHead === 'arrow' ? (
                      <ArrowStartIcon size={17} />
                    ) : (
                      <LineEndIcon size={17} />
                    )}
                  </button>
                  <button
                    type="button"
                    className={`wb-format-btn${
                      (selectedObj.props as unknown as ConnectorProps).endHead !== 'none'
                        ? ' active'
                        : ''
                    }`}
                    onClick={() => {
                      const cur = (selectedObj.props as unknown as ConnectorProps).endHead
                      session.updateObject(selectedObj.id, {
                        props: { endHead: cur === 'none' ? 'arrow' : 'none' },
                      })
                    }}
                  >
                    {(selectedObj.props as unknown as ConnectorProps).endHead === 'none' ? (
                      <LineEndIcon size={17} />
                    ) : (
                      <ArrowEndIcon size={17} />
                    )}
                  </button>
                  <button
                    type="button"
                    className={`wb-format-btn${
                      (selectedObj.props as unknown as ConnectorProps).lineStyle === 'dashed'
                        ? ' active'
                        : ''
                    }`}
                    onClick={() => {
                      const cur =
                        (selectedObj.props as unknown as ConnectorProps).lineStyle ?? 'solid'
                      session.updateObject(selectedObj.id, {
                        lineStyle: cur === 'dashed' ? 'solid' : 'dashed',
                      })
                    }}
                  >
                    {(selectedObj.props as unknown as ConnectorProps).lineStyle === 'dashed' ? (
                      <DashedLineIcon size={17} />
                    ) : (
                      <SolidLineIcon size={17} />
                    )}
                  </button>
                </>
              )}

              {/* Pen stroke width picker */}
              {tool === 'pen' && (
                <>
                  <span className="wb-format-sep" />
                  {LINE_WIDTH_PRESETS.map((w) => {
                    const dotPx = w === 2 ? 5 : w === 4 ? 8 : 12
                    return (
                      <button
                        key={w}
                        type="button"
                        className={`wb-format-btn${penWidth === w ? ' active' : ''}`}
                        onClick={() => setPenWidth(w)}
                      >
                        <span className="wb-width-dot" style={{ width: dotPx, height: dotPx }} />
                      </button>
                    )
                  })}
                </>
              )}

              {/* Object actions: layer order, duplicate, delete */}
              {tool === 'select' && selectedObj && (
                <>
                  <span className="wb-format-sep" />
                  <button
                    type="button"
                    className="wb-format-btn"
                    aria-label={t('toolBringFront')}
                    data-tip={t('toolBringFront')}
                    onClick={() => handleLayerOrder('front')}
                  >
                    <FrontIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="wb-format-btn"
                    aria-label={t('toolSendBack')}
                    data-tip={t('toolSendBack')}
                    onClick={() => handleLayerOrder('back')}
                  >
                    <BackIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="wb-format-btn"
                    aria-label={t('toolDuplicate')}
                    data-tip={t('toolDuplicate')}
                    onClick={handleDuplicateSelected}
                  >
                    <DuplicateIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="wb-format-btn danger"
                    aria-label={t('toolDelete')}
                    data-tip={t('toolDelete')}
                    onClick={() => session.deleteSelected()}
                  >
                    <TrashIcon size={16} />
                  </button>
                </>
              )}

              {/* Several objects: how many, layer order, duplicate, delete */}
              {tool === 'select' && multiSelected && (
                <>
                  <span className="wb-format-count">
                    {t('selectionCount', { count: selectedObjects.length })}
                  </span>
                  <span className="wb-format-sep" />
                  <button
                    type="button"
                    className="wb-format-btn"
                    aria-label={t('toolBringFront')}
                    data-tip={t('toolBringFront')}
                    onClick={() => handleLayerOrder('front')}
                  >
                    <FrontIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="wb-format-btn"
                    aria-label={t('toolSendBack')}
                    data-tip={t('toolSendBack')}
                    onClick={() => handleLayerOrder('back')}
                  >
                    <BackIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="wb-format-btn"
                    aria-label={t('toolDuplicate')}
                    data-tip={t('toolDuplicate')}
                    onClick={handleDuplicateSelected}
                  >
                    <DuplicateIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="wb-format-btn danger"
                    aria-label={t('toolDelete')}
                    data-tip={t('toolDelete')}
                    onClick={() => session.deleteSelected()}
                  >
                    <TrashIcon size={16} />
                  </button>
                </>
              )}
            </div>
          )}

          {/* Bottom-Left Floating Undo/Redo + Zoom/Fit Pill Groups */}
          <div className="wb-bottom-left">
            <div className="wb-control-group" role="group">
              <button
                type="button"
                className="wb-ctrl-btn"
                aria-label={t('toolUndo')}
                data-tip={`${t('toolUndo')} (Ctrl+Z)`}
                disabled={!session.canUndo()}
                onClick={() => session.undo()}
              >
                <UndoIcon size={18} />
              </button>
              <button
                type="button"
                className="wb-ctrl-btn"
                aria-label={t('toolRedo')}
                data-tip={`${t('toolRedo')} (Ctrl+Y)`}
                disabled={!session.canRedo()}
                onClick={() => session.redo()}
              >
                <RedoIcon size={18} />
              </button>
            </div>

            <div className="wb-control-group" role="group">
              <button
                type="button"
                className="wb-ctrl-btn"
                aria-label="-"
                onClick={() => setZoom((z) => Math.max(0.2, Number((z - 0.15).toFixed(2))))}
              >
                <MinusIcon size={16} />
              </button>
              <button
                type="button"
                className="wb-zoom-level"
                data-tip={t('zoomFit')}
                onClick={handleFitZoom}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                className="wb-ctrl-btn"
                aria-label="+"
                onClick={() => setZoom((z) => Math.min(4, Number((z + 0.15).toFixed(2))))}
              >
                <PlusIcon size={16} />
              </button>
              <button
                type="button"
                className="wb-ctrl-btn"
                aria-label={t('zoomFit')}
                data-tip={t('zoomFit')}
                onClick={handleFitZoom}
              >
                <FitIcon size={16} />
              </button>
            </div>
          </div>

          <svg
            className="wb-stage-svg"
            style={{
              cursor:
                tool === 'connector' ||
                tool === 'shape' ||
                tool === 'sticky' ||
                tool === 'pen' ||
                tool === 'marquee'
                  ? 'crosshair'
                  : tool === 'text'
                    ? 'text'
                    : tool === 'eraser'
                      ? 'cell'
                      : 'default',
            }}
            onPointerDown={handleStagePointerDown}
            onPointerMove={handleStagePointerMove}
            onPointerUp={handleStagePointerUp}
            onPointerCancel={handleStagePointerCancel}
            onLostPointerCapture={handleStagePointerCancel}
            onWheel={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault()
                setZoom((z) =>
                  Math.max(0.2, Math.min(4, Number((z * (e.deltaY < 0 ? 1.1 : 0.9)).toFixed(2)))),
                )
              } else {
                setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
              }
            }}
          >
            <defs>
              <pattern id="wb-dot-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <circle cx="16" cy="16" r="1.5" fill="#221D17" fillOpacity="0.15" />
              </pattern>
              <filter id="wb-paper-card-shadow" x="-12%" y="-10%" width="124%" height="128%">
                <feDropShadow
                  dx="0"
                  dy="1"
                  stdDeviation="1.2"
                  floodColor="#221D17"
                  floodOpacity="0.12"
                />
                <feDropShadow
                  dx="0"
                  dy="3.5"
                  stdDeviation="4"
                  floodColor="#221D17"
                  floodOpacity="0.08"
                />
              </filter>
            </defs>

            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {/* Fixed or freeform page paper (theme-invariant warm ivory paper #FFFDF8) */}
              {activePage && activePage.format !== 'freeform' ? (
                <g className="wb-paper-shadow">
                  <rect
                    x={0}
                    y={0}
                    width={activePage.width}
                    height={activePage.height}
                    fill={paperFill}
                    rx={6}
                  />
                  {activePage.background?.kind === 'image' &&
                    (() => {
                      const href = session.getResourceDataUrl(activePage.background.resourceId)
                      return href ? (
                        <image
                          href={href}
                          x={0}
                          y={0}
                          width={activePage.width}
                          height={activePage.height}
                          preserveAspectRatio="xMidYMid meet"
                          style={{ pointerEvents: 'none' }}
                        />
                      ) : null
                    })()}
                </g>
              ) : (
                <>
                  <rect x={-4000} y={-4000} width={8000} height={8000} fill={paperFill} />
                  <rect
                    x={-4000}
                    y={-4000}
                    width={8000}
                    height={8000}
                    fill="url(#wb-dot-grid)"
                    style={{ pointerEvents: 'none' }}
                  />
                </>
              )}

              {/* Board objects */}
              {displayedObjects.map((obj) => {
                const isSelected = shownSelection.has(obj.id)
                const isHighlighted = highlightSet.has(obj.id)
                const isSnapTarget = snapHighlightIds.has(obj.id)
                const invZ = 1 / zoom
                const handleSize = 9 * invZ

                return (
                  <g
                    key={obj.id}
                    data-object-id={obj.id}
                    data-object-kind={obj.kind}
                    transform={
                      obj.rotation
                        ? `rotate(${obj.rotation} ${obj.x + obj.width / 2} ${obj.y + obj.height / 2})`
                        : undefined
                    }
                    onPointerDown={(e) => handleObjectPointerDown(e, obj)}
                    onDoubleClick={() => startInlineEdit(obj)}
                    style={{
                      cursor:
                        tool === 'eraser'
                          ? 'crosshair'
                          : tool === 'select'
                            ? obj.kind === 'connector'
                              ? 'pointer'
                              : 'move'
                            : 'inherit',
                    }}
                  >
                    {renderObjectElement(
                      obj,
                      objectsById,
                      session,
                      handleOpenLinkCard,
                      isSelected,
                      editingId === obj.id,
                    )}

                    {/* Teal dashed outline when dragging a connector end near this object */}
                    {isSnapTarget && (
                      <rect
                        className="wb-attach-rect"
                        x={obj.x - 3 * invZ}
                        y={obj.y - 3 * invZ}
                        width={obj.width + 6 * invZ}
                        height={obj.height + 6 * invZ}
                        rx={4 * invZ}
                        strokeWidth={2 * invZ}
                        strokeDasharray={`${5 * invZ} ${4 * invZ}`}
                      />
                    )}

                    {/* Amber AI change highlight */}
                    {isHighlighted &&
                      (() => {
                        const hb = objectBounds(obj, objectsById)
                        return (
                          <rect
                            className="wb-ai-highlight-rect"
                            x={hb.x - 5}
                            y={hb.y - 5}
                            width={hb.width + 10}
                            height={hb.height + 10}
                            rx={8}
                          />
                        )
                      })()}

                    {/* Selection frame: 4 corner paper handles for boxes, circular endpoint handles for connectors */}
                    {/* With several objects selected, each shows its frame without handles. */}
                    {isSelected && obj.kind !== 'connector' && (
                      <>
                        <rect
                          className="wb-selection-rect"
                          x={obj.x}
                          y={obj.y}
                          width={obj.width}
                          height={obj.height}
                          strokeWidth={2 * invZ}
                        />
                        {!shownMulti &&
                          (
                            [
                              ['nw', obj.x, obj.y, 'nwse-resize'],
                              ['ne', obj.x + obj.width, obj.y, 'nesw-resize'],
                              ['sw', obj.x, obj.y + obj.height, 'nesw-resize'],
                              ['se', obj.x + obj.width, obj.y + obj.height, 'nwse-resize'],
                            ] as const
                          ).map(([corner, hx, hy, cursor]) => (
                            <rect
                              key={corner}
                              x={hx - handleSize / 2}
                              y={hy - handleSize / 2}
                              width={handleSize}
                              height={handleSize}
                              fill={PAPER_COLORS.paper}
                              stroke={PAPER_COLORS.accent}
                              strokeWidth={1.6 * invZ}
                              style={{ cursor }}
                              onPointerDown={(e) => handleResizePointerDown(e, obj, corner)}
                            />
                          ))}
                      </>
                    )}

                    {isSelected &&
                      !shownMulti &&
                      obj.kind === 'connector' &&
                      (() => {
                        const cp = obj.props as unknown as ConnectorProps
                        const sp = resolveConnectorEnd(cp.start, objectsById)
                        const ep = resolveConnectorEnd(cp.end, objectsById)
                        const r = 5.5 * invZ
                        return (
                          <>
                            <circle
                              cx={sp.x}
                              cy={sp.y}
                              r={r}
                              fill={PAPER_COLORS.paper}
                              stroke={PAPER_COLORS.accent}
                              strokeWidth={1.8 * invZ}
                              style={{ cursor: 'move' }}
                              onPointerDown={(e) => handleEndpointPointerDown(e, obj, 'start')}
                            />
                            <circle
                              cx={ep.x}
                              cy={ep.y}
                              r={r}
                              fill={PAPER_COLORS.paper}
                              stroke={PAPER_COLORS.accent}
                              strokeWidth={1.8 * invZ}
                              style={{ cursor: 'move' }}
                              onPointerDown={(e) => handleEndpointPointerDown(e, obj, 'end')}
                            />
                          </>
                        )
                      })()}
                  </g>
                )
              })}

              {/* Dashed box around a selection of several objects */}
              {shownGroupBox && (
                <rect
                  className="wb-group-rect"
                  x={shownGroupBox.x - 6 / zoom}
                  y={shownGroupBox.y - 6 / zoom}
                  width={shownGroupBox.width + 12 / zoom}
                  height={shownGroupBox.height + 12 / zoom}
                  rx={4 / zoom}
                  strokeWidth={1.5 / zoom}
                  strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                />
              )}

              {/* Area being dragged out to select the objects inside it */}
              {marqueeRect && (
                <rect
                  className="wb-marquee-rect"
                  x={marqueeRect.x}
                  y={marqueeRect.y}
                  width={marqueeRect.width}
                  height={marqueeRect.height}
                  strokeWidth={1.5 / zoom}
                  strokeDasharray={`${5 / zoom} ${4 / zoom}`}
                />
              )}

              {/* Live in-progress connector drag preview */}
              {liveConnector &&
                (() => {
                  const geom = computeConnectorGeometry(
                    liveConnector.start,
                    liveConnector.end,
                    undefined,
                    3,
                    'none',
                    'arrow',
                  )
                  return (
                    <g style={{ pointerEvents: 'none' }}>
                      <path
                        d={geom.shaftPath}
                        fill="none"
                        stroke={penColor}
                        strokeWidth={3}
                        strokeLinecap="round"
                      />
                      {geom.endArrowPath && <path d={geom.endArrowPath} fill={penColor} />}
                    </g>
                  )
                })()}

              {/* Live in-progress pressure stroke */}
              {liveStroke && liveStroke.length > 0 && (
                <path
                  d={computeStrokeOutline(
                    liveStroke,
                    tool === 'highlighter' ? 22 : penWidth,
                    tool === 'highlighter' ? 'highlighter' : 'pen',
                  )}
                  fill={tool === 'highlighter' ? PAPER_COLORS.highlighterYellow : penColor}
                  fillOpacity={tool === 'highlighter' ? 0.35 : 1}
                  style={tool === 'highlighter' ? { mixBlendMode: 'multiply' } : undefined}
                />
              )}
            </g>
          </svg>

          {/* Inline plain-text editor overlay styled to match the paper object */}
          {editingObj &&
            (() => {
              const p = editingObj.props as unknown as StickyProps | TextProps | ShapeProps
              const fmt = richTextFormatState(p.text)
              const fontSize = (p.fontSize ?? (editingObj.kind === 'text' ? 24 : 18)) * zoom
              const align = p.align ?? (editingObj.kind === 'shape' ? 'center' : 'left')
              const bg =
                editingObj.kind === 'sticky'
                  ? (p as StickyProps).color || PAPER_FILL_SWATCHES[0]
                  : editingObj.kind === 'shape'
                    ? (p as ShapeProps).fill || PAPER_COLORS.zoneFill
                    : (p as TextProps).background || PAPER_COLORS.paper
              const pad = editingObj.kind === 'sticky' ? 16 * zoom : 6 * zoom
              return (
                <textarea
                  className="wb-inline-editor"
                  autoFocus
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  onBlur={commitInlineEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      e.stopPropagation()
                      e.nativeEvent.stopImmediatePropagation()
                      commitInlineEdit()
                    }
                  }}
                  style={{
                    left: pan.x + editingObj.x * zoom,
                    top: pan.y + editingObj.y * zoom,
                    width: Math.max(120, editingObj.width * zoom),
                    height: Math.max(48, editingObj.height * zoom),
                    padding: pad,
                    background: bg,
                    color:
                      fmt.color ||
                      (editingObj.kind === 'text' ? (p as TextProps).color : undefined) ||
                      PAPER_COLORS.ink,
                    fontSize,
                    fontWeight: fmt.bold ? 700 : 400,
                    fontStyle: fmt.italic ? 'italic' : 'normal',
                    textAlign: align,
                  }}
                />
              )
            })()}
        </div>
      </div>

      {/* Link Card Modal */}
      {linkModalOpen && (
        <div className="wb-modal-scrim">
          <div className="wb-modal" role="dialog" aria-modal="true">
            <h3>{t('linkDialogTitle')}</h3>
            <label className="wb-field">
              <span>{t('linkUrlLabel')}</span>
              <input
                className="wb-input"
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://example.com"
                autoFocus
              />
            </label>
            <label className="wb-field">
              <span>{t('linkTitleLabel')}</span>
              <input
                className="wb-input"
                type="text"
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
              />
            </label>
            <label className="wb-checkbox">
              <input
                type="checkbox"
                checked={linkFetchPreview}
                onChange={(e) => setLinkFetchPreview(e.target.checked)}
              />
              <span>{t('linkFetchPreview')}</span>
            </label>
            <div className="wb-modal-actions">
              <button
                type="button"
                className="wb-btn wb-btn-secondary"
                disabled={linkBusy}
                onClick={() => setLinkModalOpen(false)}
              >
                {t('btnCancel')}
              </button>
              <button
                type="button"
                className="wb-btn wb-btn-primary"
                disabled={linkBusy}
                onClick={() => void handleConfirmLinkCard()}
              >
                {t('btnAdd')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Multi-page PDF Range Modal */}
      {pdfPending && (
        <div className="wb-modal-scrim">
          <div className="wb-modal" role="dialog" aria-modal="true">
            <h3>{t('pdfDialogTitle')}</h3>
            <div>{t('pdfPageCount', { count: pdfPending.pageCount })}</div>
            <label className="wb-field">
              <span>{t('pdfRangeLabel')}</span>
              <input
                className="wb-input"
                type="text"
                value={pdfRange}
                onChange={(e) => setPdfRange(e.target.value)}
                autoFocus
              />
            </label>
            <div className="wb-modal-actions">
              <button
                type="button"
                className="wb-btn wb-btn-secondary"
                disabled={pdfBusy}
                onClick={() => setPdfPending(null)}
              >
                {t('btnCancel')}
              </button>
              <button
                type="button"
                className="wb-btn wb-btn-primary"
                disabled={pdfBusy}
                onClick={() => void handleConfirmPdfImport()}
              >
                {t('btnImport')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Scope Modal */}
      {exportModalFormat && (
        <div className="wb-modal-scrim">
          <div className="wb-modal" role="dialog" aria-modal="true">
            <h3>
              {exportModalFormat === 'png'
                ? t('exportTitlePng')
                : exportModalFormat === 'svg'
                  ? t('exportTitleSvg')
                  : t('exportTitlePdf')}
            </h3>
            <label className="wb-checkbox">
              <input
                type="radio"
                name="wb-export-scope"
                checked={exportScope === 'all'}
                onChange={() => setExportScope('all')}
              />
              <span>{t('exportAllPages')}</span>
            </label>
            <label className="wb-checkbox">
              <input
                type="radio"
                name="wb-export-scope"
                checked={exportScope === 'current'}
                onChange={() => setExportScope('current')}
              />
              <span>{t('exportCurrentPage')}</span>
            </label>
            <div className="wb-modal-actions">
              <button
                type="button"
                className="wb-btn wb-btn-secondary"
                onClick={onCloseExportModal}
              >
                {t('btnCancel')}
              </button>
              <button
                type="button"
                className="wb-btn wb-btn-primary"
                onClick={() => {
                  const fmt = exportModalFormat
                  onCloseExportModal()
                  onExport(fmt, exportScope)
                }}
              >
                {t('btnExport')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Presentation Mode Overlay (F5) */}
      {presenting && activePage && (
        <div className="wb-present-overlay" role="dialog" aria-modal="true">
          <div className="wb-present-stage">
            {presentSvg && (
              <img
                alt={activePage.title || 'Whiteboard page'}
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(presentSvg.svg)}`}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  background: PAPER_COLORS.paper,
                }}
              />
            )}
          </div>
          <div className="wb-present-bar">
            <button
              type="button"
              onClick={() => {
                const idx = doc.pages.findIndex((p) => p.id === activePageId)
                if (idx > 0) session.setActivePageId(doc.pages[idx - 1]!.id)
              }}
            >
              {t('presentPrev')}
            </button>
            <span>
              {doc.pages.findIndex((p) => p.id === activePageId) + 1} / {doc.pages.length}
            </span>
            <button
              type="button"
              onClick={() => {
                const idx = doc.pages.findIndex((p) => p.id === activePageId)
                if (idx >= 0 && idx + 1 < doc.pages.length)
                  session.setActivePageId(doc.pages[idx + 1]!.id)
              }}
            >
              {t('presentNext')}
            </button>
            <button type="button" onClick={() => onSetPresenting(false)}>
              {t('presentExit')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Miniature thumbnail preview of a page's objects for the left page rail. */
function PageThumbnail({
  page,
  objects,
}: {
  page: Page
  objects: readonly BoardObject[]
}): ReactElement {
  const isFreeform = page.format === 'freeform'
  const byId = new Map(objects.map((o) => [o.id, o]))
  const boxes = objects.map((o) => ({ obj: o, box: objectBounds(o, byId) }))

  let minX = 0
  let minY = 0
  let maxX = page.width || 1280
  let maxY = page.height || 720
  if (isFreeform && boxes.length > 0) {
    minX = Math.min(...boxes.map((b) => b.box.x)) - 40
    minY = Math.min(...boxes.map((b) => b.box.y)) - 40
    maxX = Math.max(...boxes.map((b) => b.box.x + b.box.width)) + 40
    maxY = Math.max(...boxes.map((b) => b.box.y + b.box.height)) + 40
  }
  const areaW = Math.max(240, maxX - minX)
  const areaH = Math.max(160, maxY - minY)
  const scale = Math.min(THUMB_W / areaW, THUMB_H / areaH)
  const offsetX = (THUMB_W - areaW * scale) / 2 - minX * scale
  const offsetY = (THUMB_H - areaH * scale) / 2 - minY * scale

  return (
    <div className={`wb-thumb${isFreeform ? ' wb-thumb-freeform' : ''}`}>
      {boxes
        .filter(({ obj }) => obj.kind !== 'connector' && obj.kind !== 'stroke')
        .map(({ obj, box }) => (
          <span
            key={obj.id}
            className="wb-thumb-obj"
            style={{
              left: Math.round(offsetX + box.x * scale),
              top: Math.round(offsetY + box.y * scale),
              width: Math.max(3, Math.round(box.width * scale)),
              height: Math.max(3, Math.round(box.height * scale)),
              backgroundColor: thumbnailSwatch(obj),
            }}
          />
        ))}
      <svg
        width={THUMB_W}
        height={THUMB_H}
        viewBox={`0 0 ${THUMB_W} ${THUMB_H}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        aria-hidden="true"
      >
        {objects
          .filter((o) => o.kind === 'connector')
          .map((o) => {
            const p = o.props as unknown as ConnectorProps
            const s = resolveConnectorEnd(p.start, byId)
            const e = resolveConnectorEnd(p.end, byId)
            return (
              <line
                key={o.id}
                x1={offsetX + s.x * scale}
                y1={offsetY + s.y * scale}
                x2={offsetX + e.x * scale}
                y2={offsetY + e.y * scale}
                stroke={p.color || PAPER_COLORS.ink}
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            )
          })}
      </svg>
    </div>
  )
}

/** Renders a RichText block cleanly with per-run marks and paragraph alignment. */
function RichTextBlock({
  richText,
  fontSize,
  defaultColor = PAPER_COLORS.ink,
  defaultAlign = 'left',
}: {
  readonly richText: RichText | undefined
  readonly fontSize: number
  readonly defaultColor?: string
  readonly defaultAlign?: TextAlign
}): ReactElement {
  const paragraphs = richText?.paragraphs ?? []
  return (
    <div
      style={{
        fontSize,
        lineHeight: 1.38,
        color: defaultColor,
        wordBreak: 'keep-all',
        overflowWrap: 'anywhere',
        whiteSpace: 'pre-wrap',
      }}
    >
      {paragraphs.map((p, pi) => {
        const align = p.align ?? defaultAlign
        const runs = p.runs ?? []
        return (
          <div key={pi} style={{ textAlign: align, minHeight: '1em' }}>
            {runs.length === 0 ? (
              <br />
            ) : (
              runs.map((r, ri) => {
                const decos = [r.underline ? 'underline' : '', r.strike ? 'line-through' : '']
                  .filter(Boolean)
                  .join(' ')
                return (
                  <span
                    key={ri}
                    style={{
                      fontWeight: r.bold ? 700 : 400,
                      fontStyle: r.italic ? 'italic' : 'normal',
                      textDecorationLine: decos || 'none',
                      color: r.color || defaultColor,
                    }}
                  >
                    {r.text}
                  </span>
                )
              })
            )}
          </div>
        )
      })}
    </div>
  )
}

function renderObjectElement(
  obj: BoardObject,
  byId: ReadonlyMap<string, BoardObject>,
  session: WhiteboardSession,
  onOpenLink: (url: string) => void,
  isSelected: boolean,
  isEditing: boolean,
): ReactElement | null {
  const { x, y, width, height } = obj
  switch (obj.kind) {
    case 'sticky': {
      const p = obj.props as unknown as StickyProps
      return (
        <g filter="url(#wb-paper-card-shadow)">
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={3}
            fill={p.color || PAPER_FILL_SWATCHES[0]}
          />
          {!isEditing && (
            <foreignObject
              x={x + 16}
              y={y + 16}
              width={Math.max(10, width - 32)}
              height={Math.max(10, height - 32)}
            >
              <RichTextBlock
                richText={p.text}
                fontSize={p.fontSize ?? 18}
                defaultColor={PAPER_COLORS.ink}
                defaultAlign={p.align ?? 'left'}
              />
            </foreignObject>
          )}
        </g>
      )
    }
    case 'text': {
      const p = obj.props as unknown as TextProps
      const isEmpty = !richTextPlain(p.text).trim()
      return (
        <g>
          {(p.background || p.borderColor) && (
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              rx={6}
              fill={p.background || 'none'}
              stroke={p.borderColor || 'none'}
              strokeWidth={1}
            />
          )}
          {isEmpty && !isEditing && (
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              rx={4}
              fill="transparent"
              stroke={PAPER_COLORS.lineDashed}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}
          {!isEditing && (
            <foreignObject
              x={x + 6}
              y={y + 4}
              width={Math.max(10, width - 12)}
              height={Math.max(10, height - 8)}
            >
              <RichTextBlock
                richText={p.text}
                fontSize={p.fontSize ?? 24}
                defaultColor={p.color || PAPER_COLORS.ink}
                defaultAlign={p.align ?? 'left'}
              />
            </foreignObject>
          )}
        </g>
      )
    }
    case 'shape': {
      const p = obj.props as unknown as ShapeProps
      const sw = p.strokeWidth ?? 2.5
      const kind = p.shape || 'rounded_rectangle'
      const d = shapePath(kind, width, height, sw / 2)
      const box = shapeTextBox(kind, width, height)
      const hasText = richTextPlain(p.text).length > 0
      return (
        <g transform={`translate(${x}, ${y})`}>
          <path
            d={d}
            fill={p.fill || PAPER_COLORS.zoneFill}
            stroke={p.stroke || PAPER_COLORS.ink}
            strokeWidth={sw}
            strokeLinejoin="round"
            strokeDasharray={dashPattern(p.lineStyle, sw)}
          />
          {hasText && !isEditing && (
            <foreignObject
              x={box.left}
              y={box.top}
              width={Math.max(10, box.width)}
              height={Math.max(10, box.height)}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                }}
              >
                <RichTextBlock
                  richText={p.text}
                  fontSize={p.fontSize ?? 18}
                  defaultColor={PAPER_COLORS.ink}
                  defaultAlign={p.align ?? 'center'}
                />
              </div>
            </foreignObject>
          )}
        </g>
      )
    }
    case 'connector': {
      const p = obj.props as unknown as ConnectorProps
      const s = resolveConnectorEnd(p.start, byId)
      const e = resolveConnectorEnd(p.end, byId)
      const sw = p.strokeWidth ?? 3
      const ink = p.color || PAPER_COLORS.ink
      const geom = computeConnectorGeometry(s, e, p.waypoints, sw, p.startHead, p.endHead)
      const lineCap = p.lineStyle === 'dashed' || p.lineStyle === 'dotted' ? 'butt' : 'round'
      const labelText = richTextPlain(p.label)
      const pillW = labelText ? Math.max(48, labelText.length * 10 + 18) : 0
      return (
        <g>
          {/* Warm terracotta glow highlight when selected (no ugly bounding rectangle) */}
          {isSelected && (
            <path
              d={geom.fullPath}
              fill="none"
              stroke={PAPER_COLORS.accent}
              strokeOpacity={0.32}
              strokeWidth={sw + 10}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {/* Generous invisible hit-target so clicking thin connectors is effortless */}
          <path
            d={geom.fullPath}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(18, sw + 14)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Pulled-back editorial shaft */}
          <path
            d={geom.shaftPath}
            fill="none"
            stroke={ink}
            strokeWidth={sw}
            strokeLinecap={lineCap}
            strokeLinejoin="round"
            strokeDasharray={dashPattern(p.lineStyle, sw)}
          />
          {/* Crisp geometric filled arrowheads */}
          {geom.startArrowPath && <path d={geom.startArrowPath} fill={ink} />}
          {geom.endArrowPath && <path d={geom.endArrowPath} fill={ink} />}
          {geom.startCircle && (
            <circle
              cx={geom.startCircle.x}
              cy={geom.startCircle.y}
              r={Math.max(4, sw * 1.5)}
              fill={ink}
            />
          )}
          {geom.endCircle && (
            <circle
              cx={geom.endCircle.x}
              cy={geom.endCircle.y}
              r={Math.max(4, sw * 1.5)}
              fill={ink}
            />
          )}
          {/* Clean warm-paper pill label */}
          {labelText && (
            <g>
              <rect
                x={geom.midpoint.x - pillW / 2}
                y={geom.midpoint.y - 22}
                width={pillW}
                height={24}
                rx={6}
                fill={PAPER_COLORS.paper}
                stroke={PAPER_COLORS.line}
                strokeWidth={1}
              />
              <text
                x={geom.midpoint.x}
                y={geom.midpoint.y - 6}
                textAnchor="middle"
                fontSize={13}
                fontWeight={500}
                fill={PAPER_COLORS.ink}
              >
                {labelText}
              </text>
            </g>
          )}
        </g>
      )
    }
    case 'stroke': {
      const p = obj.props as unknown as StrokeProps
      const d = computeStrokeOutline(p.points ?? [], p.width ?? 4, p.tool ?? 'pen')
      const isHi = p.tool === 'highlighter'
      return (
        <path
          transform={`translate(${x}, ${y})`}
          d={d}
          fill={p.color || PAPER_COLORS.ink}
          fillOpacity={p.opacity ?? (isHi ? 0.35 : 1)}
          style={isHi ? { mixBlendMode: 'multiply' } : undefined}
        />
      )
    }
    case 'image': {
      const p = obj.props as unknown as ImageProps
      const href = session.getResourceDataUrl(p.resourceId)
      return href ? (
        <image
          href={href}
          x={x}
          y={y}
          width={width}
          height={height}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={PAPER_COLORS.zoneFill}
          stroke={PAPER_COLORS.lineDashed}
          strokeDasharray="4 4"
        />
      )
    }
    case 'table': {
      const p = obj.props as unknown as TableProps
      const rowIds = p.rowIds?.length ? p.rowIds : ['r1']
      const colIds = p.colIds?.length ? p.colIds : ['c1']
      const cw = width / colIds.length
      const ch = height / rowIds.length
      return (
        <g filter="url(#wb-paper-card-shadow)">
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={4}
            fill={PAPER_COLORS.paper}
            stroke={PAPER_COLORS.lineDashed}
            strokeWidth={1.5}
          />
          {rowIds.map((rid, r) =>
            colIds.map((cid, c) => {
              const cell = p.cells?.[`${rid}:${cid}`]
              return (
                <g key={`${rid}-${cid}`}>
                  <rect
                    x={x + c * cw}
                    y={y + r * ch}
                    width={cw}
                    height={ch}
                    fill={r === 0 && p.headerRow ? PAPER_COLORS.zoneFill : PAPER_COLORS.paper}
                    stroke={PAPER_COLORS.lineStrong}
                    strokeWidth={1}
                  />
                  <text
                    x={x + c * cw + 12}
                    y={y + r * ch + ch / 2 + 5}
                    fontSize={p.fontSize ?? 14}
                    fontWeight={r === 0 && p.headerRow ? 600 : 400}
                    fill={PAPER_COLORS.ink}
                  >
                    {richTextPlain(cell)}
                  </text>
                </g>
              )
            }),
          )}
        </g>
      )
    }
    case 'sticker': {
      const p = obj.props as unknown as StickerProps
      return (
        <g transform={`translate(${x}, ${y})`}>
          <svg width={width} height={height} viewBox="0 0 100 100" overflow="visible">
            <StickerIcon stickerId={p.stickerId || 'star'} tint={p.tint} />
          </svg>
        </g>
      )
    }
    case 'link': {
      const p = obj.props as unknown as LinkProps
      const previewHref = p.previewResourceId
        ? session.getResourceDataUrl(p.previewResourceId)
        : null
      return (
        <g filter="url(#wb-paper-card-shadow)">
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={10}
            fill={PAPER_COLORS.paper}
            stroke={PAPER_COLORS.line}
            strokeWidth={1.5}
          />
          {previewHref && (
            <image
              href={previewHref}
              x={x + 8}
              y={y + 8}
              width={width - 16}
              height={Math.min(84, height * 0.5)}
              preserveAspectRatio="xMidYMid slice"
            />
          )}
          <foreignObject
            x={x + 16}
            y={previewHref ? y + Math.min(84, height * 0.5) + 12 : y + 16}
            width={Math.max(20, width - 32)}
            height={Math.max(24, height - (previewHref ? Math.min(84, height * 0.5) + 20 : 28))}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <a
                href={p.url}
                onClick={(ev) => {
                  ev.preventDefault()
                  ev.stopPropagation()
                  onOpenLink(p.url)
                }}
                style={{
                  color: PAPER_COLORS.accent,
                  fontSize: 15,
                  fontWeight: 600,
                  textDecoration: 'underline',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.title || p.url} ↗
              </a>
              <span
                style={{
                  color: PAPER_COLORS.inkMuted,
                  fontSize: 12,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.url}
              </span>
            </div>
          </foreignObject>
        </g>
      )
    }
  }
}
