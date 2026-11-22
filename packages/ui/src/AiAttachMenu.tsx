import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import { docPickedOf, type DocAttachPicked } from './DocAttachButton'
import { drivePickedOf, type DriveAttachPicked } from './DriveAttachButton'
import { IconCloudDrive, IconFileDoc, IconPaperclip, IconPlus } from './icons'
import { useDismissablePopover } from './popover-dismiss'
import { aiPanelText } from './strings-ai-panel'
import { connectorAttachText } from './strings-attach-menu'

interface DocAttachBridge {
  available(): Promise<boolean>
  pick(): Promise<unknown>
}

interface DriveAttachBridge {
  driveConnected(): Promise<boolean>
  onDriveConnectedChanged(listener: (connected: boolean) => void): () => void
  drivePickAttachments(): Promise<unknown>
}

export interface ConnectorAttachSources {
  obsidian: boolean
  notion: boolean
  canva?: boolean
}

export type ConnectorAttachWireResult =
  | {
      ok: true
      paths: string[]
      skipped?: number
      failed?: number
      omittedNonText?: number
    }
  | {
      ok: false
      reason: 'cancelled' | 'busy' | 'unavailable' | 'not-connected' | 'failed'
    }

interface ConnectorAttachBridge {
  availableSources(): Promise<ConnectorAttachSources>
  onSourcesChanged(listener: (sources: ConnectorAttachSources) => void): () => void
  pickObsidianNotes(): Promise<unknown>
  pickNotionPages(): Promise<unknown>
  pickCanvaDesigns?: () => Promise<unknown>
}

function docBridge(): DocAttachBridge | null {
  const b = (globalThis as { aiOfficeDocs?: Partial<DocAttachBridge> }).aiOfficeDocs
  return typeof b?.available === 'function' && typeof b.pick === 'function'
    ? (b as DocAttachBridge)
    : null
}

function driveBridge(): DriveAttachBridge | null {
  const b = (globalThis as { aiOfficeDriveAi?: Partial<DriveAttachBridge> }).aiOfficeDriveAi
  return typeof b?.driveConnected === 'function' &&
    typeof b.onDriveConnectedChanged === 'function' &&
    typeof b.drivePickAttachments === 'function'
    ? (b as DriveAttachBridge)
    : null
}

function connectorAttachBridge(): ConnectorAttachBridge | null {
  const b = (globalThis as { aiOfficeConnectorAttach?: Partial<ConnectorAttachBridge> })
    .aiOfficeConnectorAttach
  return typeof b?.availableSources === 'function' &&
    typeof b.onSourcesChanged === 'function' &&
    typeof b.pickObsidianNotes === 'function' &&
    typeof b.pickNotionPages === 'function'
    ? (b as ConnectorAttachBridge)
    : null
}

/** Translate the shell's connector-picker wire result into localized paths + notes */
export function connectorPickedOf(raw: unknown, lang: Lang): DriveAttachPicked {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (r.ok !== true) {
    if (r.reason === 'busy')
      return { paths: [], notes: [connectorAttachText(lang, 'connectorBusy')] }
    if (r.reason === 'not-connected') {
      return { paths: [], notes: [connectorAttachText(lang, 'connectorNotConnected')] }
    }
    if (r.reason === 'failed') {
      return { paths: [], notes: [connectorAttachText(lang, 'connectorFailed')] }
    }
    return { paths: [], notes: [] }
  }
  const paths = Array.isArray(r.paths)
    ? r.paths.filter((p): p is string => typeof p === 'string')
    : []
  const count = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.floor(v) : 0)
  const notes: string[] = []
  const skipped = count(r.skipped)
  const failed = count(r.failed)
  const omittedNonText = count(r.omittedNonText)
  if (skipped > 0) notes.push(connectorAttachText(lang, 'connectorSkipped', { n: skipped }))
  if (failed > 0) notes.push(connectorAttachText(lang, 'connectorFailed'))
  if (omittedNonText > 0) {
    notes.push(connectorAttachText(lang, 'connectorOmittedNonText', { n: omittedNonText }))
  }
  return { paths, notes }
}

/** Monochrome outline folder icon for Obsidian vault (no third-party logos, decision 0052) */
function IconVaultOutline() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.3 1.5h4.7A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V4.5Z" />
    </svg>
  )
}

/** Monochrome outline page icon for Notion pages (no third-party logos, decision 0052) */
function IconPageOutline() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 2.5h5.5L13 6v7.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" />
      <path d="M9.5 2.5V6H13M5.5 9h5M5.5 11.5h3.5" />
    </svg>
  )
}

/** Monochrome outline layout icon for Canva designs (no third-party logos, decision 0052) */
function IconCanvaOutline() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M2.5 7h11M7.5 7v6.5" />
    </svg>
  )
}

export interface AiAttachMenuProps {
  readonly lang: Lang
  /** Local computer file picker callback; omit on editors without local file attachments */
  readonly onPickPc?: (() => void) | undefined
  /** Called with paths/notes picked from the GenOffice document chooser */
  readonly onPickedDocs?: ((picked: DocAttachPicked) => void | Promise<void>) | undefined
  /** Called with paths/notes downloaded from Google Drive */
  readonly onPickedDrive?: ((picked: DriveAttachPicked) => void | Promise<void>) | undefined
  /** Called with paths/notes picked from Obsidian or Notion (defaults to `onPickedDrive`) */
  readonly onPickedConnector?: ((picked: DriveAttachPicked) => void | Promise<void>) | undefined
  readonly disabled?: boolean | undefined
}

/**
 * Unified "+" attachment menu consolidating local PC files, open/recent
 * GenOffice documents, Google Drive, Obsidian vault notes, and Notion pages
 * into one clean popover trigger.
 * Renders nothing when no attachment source is available (e.g. PDF, Markdown).
 */
export function AiAttachMenu({
  lang,
  onPickPc,
  onPickedDocs,
  onPickedDrive,
  onPickedConnector,
  disabled = false,
}: AiAttachMenuProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [docsReady, setDocsReady] = useState(false)
  const [driveConnected, setDriveConnected] = useState(false)
  const [connectorSources, setConnectorSources] = useState<ConnectorAttachSources>({
    obsidian: false,
    notion: false,
    canva: false,
  })
  const [pickingDocs, setPickingDocs] = useState(false)
  const [pickingDrive, setPickingDrive] = useState(false)
  const [pickingConnector, setPickingConnector] = useState(false)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const connectorHandler = onPickedConnector ?? onPickedDrive

  useEffect(() => {
    if (!onPickedDocs) return
    const b = docBridge()
    if (!b) return
    let live = true
    void b.available().then((v) => live && setDocsReady(v === true))
    return () => {
      live = false
    }
  }, [onPickedDocs])

  useEffect(() => {
    if (!onPickedDrive) return
    const b = driveBridge()
    if (!b) return
    let live = true
    void b.driveConnected().then((v) => live && setDriveConnected(v === true))
    const off = b.onDriveConnectedChanged((v) => setDriveConnected(v))
    return () => {
      live = false
      off()
    }
  }, [onPickedDrive])

  useEffect(() => {
    if (!connectorHandler) return
    const b = connectorAttachBridge()
    if (!b) return
    let live = true
    const normalize = (s: ConnectorAttachSources | null | undefined): ConnectorAttachSources => ({
      obsidian: s?.obsidian === true,
      notion: s?.notion === true,
      canva: s?.canva === true,
    })
    void b.availableSources().then((v) => live && setConnectorSources(normalize(v)))
    const off = b.onSourcesChanged((v) => setConnectorSources(normalize(v)))
    return () => {
      live = false
      off()
    }
  }, [connectorHandler])

  useDismissablePopover(open, () => setOpen(false), {
    inside: () => [triggerRef.current, popRef.current],
    escape: false,
  })

  // Capture Escape so closing this menu never stops an active AI run
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const menuWidth = 244
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8))
    const bottom = Math.max(8, window.innerHeight - rect.top + 6)
    setPos({ left, bottom })
  }, [open])

  const hasPc = typeof onPickPc === 'function'
  const hasDocs = docsReady && typeof onPickedDocs === 'function'
  const hasDrive = driveConnected && typeof onPickedDrive === 'function'
  const hasObsidian = connectorSources.obsidian && typeof connectorHandler === 'function'
  const hasNotion = connectorSources.notion && typeof connectorHandler === 'function'
  const hasCanva = connectorSources.canva === true && typeof connectorHandler === 'function'

  if (!hasPc && !hasDocs && !hasDrive && !hasObsidian && !hasNotion && !hasCanva) return null

  const label = aiPanelText(lang, 'attachMenuLabel')

  const pickDocs = async () => {
    const b = docBridge()
    if (!b || !onPickedDocs || pickingDocs) return
    setOpen(false)
    setPickingDocs(true)
    try {
      const picked = docPickedOf(await b.pick(), lang)
      if (picked.paths.length > 0 || picked.notes.length > 0) await onPickedDocs(picked)
    } finally {
      setPickingDocs(false)
    }
  }

  const pickDrive = async () => {
    const b = driveBridge()
    if (!b || !onPickedDrive || pickingDrive) return
    setOpen(false)
    setPickingDrive(true)
    try {
      const picked = drivePickedOf(await b.drivePickAttachments(), lang)
      if (picked.paths.length > 0 || picked.notes.length > 0) await onPickedDrive(picked)
    } finally {
      setPickingDrive(false)
    }
  }

  const pickConnector = async (source: 'obsidian' | 'notion' | 'canva') => {
    const b = connectorAttachBridge()
    if (!b || !connectorHandler || pickingConnector) return
    if (source === 'canva' && typeof b.pickCanvaDesigns !== 'function') return
    setOpen(false)
    setPickingConnector(true)
    try {
      const raw =
        source === 'obsidian'
          ? await b.pickObsidianNotes()
          : source === 'notion'
            ? await b.pickNotionPages()
            : await b.pickCanvaDesigns!()
      const picked = connectorPickedOf(raw, lang)
      if (picked.paths.length > 0 || picked.notes.length > 0) await connectorHandler(picked)
    } finally {
      setPickingConnector(false)
    }
  }

  return (
    <span className="ai-attach-menu">
      <button
        ref={triggerRef}
        type="button"
        className="ai-composer-icon-btn ai-attach-menu-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={label}
        aria-label={label}
      >
        <IconPlus size={16} />
      </button>
      {open && (
        <div
          ref={popRef}
          className="ai-attach-menu-pop"
          role="menu"
          aria-label={label}
          style={pos ? { left: pos.left, bottom: pos.bottom } : undefined}
        >
          {hasPc && (
            <button
              type="button"
              role="menuitem"
              data-source="pc"
              className="ai-attach-menu-item"
              onClick={() => {
                setOpen(false)
                onPickPc()
              }}
            >
              <span className="ai-attach-menu-item-icon" aria-hidden="true">
                <IconPaperclip size={15} />
              </span>
              <span>{aiPanelText(lang, 'attachFromPc')}</span>
            </button>
          )}
          {hasDocs && (
            <button
              type="button"
              role="menuitem"
              data-source="docs"
              className="ai-attach-menu-item"
              disabled={pickingDocs}
              onClick={() => void pickDocs()}
            >
              <span className="ai-attach-menu-item-icon" aria-hidden="true">
                <IconFileDoc size={15} />
              </span>
              <span>{aiPanelText(lang, 'attachFromDocs')}</span>
            </button>
          )}
          {hasDrive && (
            <button
              type="button"
              role="menuitem"
              data-source="drive"
              className="ai-attach-menu-item"
              disabled={pickingDrive}
              onClick={() => void pickDrive()}
            >
              <span className="ai-attach-menu-item-icon" aria-hidden="true">
                <IconCloudDrive size={15} />
              </span>
              <span>{aiPanelText(lang, 'attachFromDrive')}</span>
            </button>
          )}
          {hasObsidian && (
            <button
              type="button"
              role="menuitem"
              data-source="obsidian"
              className="ai-attach-menu-item"
              disabled={pickingConnector}
              onClick={() => void pickConnector('obsidian')}
            >
              <span className="ai-attach-menu-item-icon" aria-hidden="true">
                <IconVaultOutline />
              </span>
              <span>{connectorAttachText(lang, 'attachFromObsidian')}</span>
            </button>
          )}
          {hasNotion && (
            <button
              type="button"
              role="menuitem"
              data-source="notion"
              className="ai-attach-menu-item"
              disabled={pickingConnector}
              onClick={() => void pickConnector('notion')}
            >
              <span className="ai-attach-menu-item-icon" aria-hidden="true">
                <IconPageOutline />
              </span>
              <span>{connectorAttachText(lang, 'attachFromNotion')}</span>
            </button>
          )}
          {hasCanva && (
            <button
              type="button"
              role="menuitem"
              data-source="canva"
              className="ai-attach-menu-item"
              disabled={pickingConnector}
              onClick={() => void pickConnector('canva')}
            >
              <span className="ai-attach-menu-item-icon" aria-hidden="true">
                <IconCanvaOutline />
              </span>
              <span>{connectorAttachText(lang, 'attachFromCanva')}</span>
            </button>
          )}
        </div>
      )}
    </span>
  )
}
