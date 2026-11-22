import {
  aiPanelWidthAtPointer,
  AiAttachMenu,
  AiBlockedNotice,
  AiConnectPrompt,
  AiFirstConnectionNotice,
  AiInputTruncatedNotice,
  AiMark,
  AiPanelHeader,
  AiPanelSideButton,
  AiReplyFooter,
  AiScrollToBottom,
  AiModelPicker,
  AiToolsUnsupportedNotice,
  AiWorkSteps,
  AiEmptyHints,
  useScrollToBottom,
  type AiModelPickerBridge,
  AiQueueStrip,
  AI_QUEUE_LABELS,
  AiSubscriptionUsageLine,
  AiUsageChip,
  addTokenUsage,
  type AiTokenUsageView,
  aiSubscriptionText,
  useAiSendGate,
  useChatRunQueue,
  type DriveAttachPicked,
  McpPermissionCard,
  McpServerButton,
  useMcpWindow,
  NO_SKILL_USE,
  SentSkillChips,
  skillChipRefsOf,
  useComposerSkills,
  panelUserSkills,
  panelProjectSkill,
  SkillUsedNotes,
  useSkillProposals,
  useSkillTemplates,
  createHandedRun,
  type TemplateDocument,
  type SkillChipRef,
  type SkillUse,
  type ProjectChatEntry,
  type ProjectChatOpened,
  placeRemoteEntries,
  useProjectPanel,
  type ProjectPanel,
  type ProjectMemoryLine,
  useSubscriptionUsageUpdates,
} from '@genoffice/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Block } from '@genoffice/docx-engine'
import {
  AgentLoop,
  createKnowledgeBaseSkill,
  streamText,
  type AgentImage,
  type IpcStreamError,
  type KbFileInfo,
  composeWithDrive,
  windowMcpState,
  windowMcpUsableServers,
  type MindMapTreeNode,
  toolStepLabel,
} from '@genoffice/agent-core'
import type { AiSubscriptionProviderId, AiSubscriptionUsage } from '@genoffice/ai-provider/browser'
import { localModelCapabilities } from '@genoffice/ai-provider/browser'
import type {
  AiSettings,
  AiToolCapabilities,
  AttachmentAddResult,
  AttachmentMeta,
} from '../../shared/ipc'
import { redactTextBetween, type RedactableNode } from './redact-view'
import { ATTACHMENT_IMAGE_EXTS } from '../../shared/ipc'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { captureRollbackSnapshot, restoreRollbackSnapshot } from './rollback-snapshot'
import { countWords, findNumId, isBlankDocument, type NumIds } from './protocol'
import { DOC_NAV_SCHEME, navigateToBlock, parseDocNavHref } from './doc-nav'
import {
  carryDocSeen,
  markDocSeen,
  type AiCommentsAccess,
  type AiDocExtras,
  type AiHeaderFooterAccess,
} from './tools'
import type { AiPageSetupAccess } from './page-setup'
import type { AiNotesAccess } from './note-ops'
import { createDocsSkill } from './docs-skill'
import { MindMapCard } from './MindMapCard'
import { insertPictureAtSelection } from '../editor/insert-picture'
import {
  buildDocWriterRequest,
  countFragmentBlocks,
  DOC_MAX_CHARS,
  extractFragment,
  type DocWriteResult,
  type DocWriteSpec,
} from './doc-writer'
import { EditQueueCard } from './EditQueueCard'
import {
  buildQueueInstruction,
  buildQueueSummary,
  liveItems,
  resolveQueue,
  type DocsEditQueueItem,
} from './edit-queue'
import { setInactiveSelectionShown } from '../editor/inactive-selection'
import { applyRevisionsBy } from '../editor/revisions'
import { DOCS_CONTINUE_INSTRUCTION } from './continuation'
import { waitForFullContent } from '../phased-content'
import { currentDocGeneration } from '../file-actions'
import { createFilesSkill } from './files-skill'
import { boundChatHistory } from './chat-retention'
import {
  afterRollback,
  clearAiMarksTransaction,
  collectAiMarkedChangeLines,
  countAiMarkedBlocks,
  docChangeLineFromTool,
  hasLaterAppliedRun,
  isAiMarksClear,
  runChangesState,
  type DocsChangeLine,
  type DocsRunChanges,
} from './run-changes'
import { createElectronTransport } from './transport'
import {
  isBlockedRunCause,
  mergeSubscriptionUsage,
  runErrorCauseOf,
  shouldRecheckAfter,
  type RunErrorCause,
} from './run-state'
import { useSubscriptionConnection } from './subscription-client'
import { useI18n, t as tModule, aiLangDirective, type StringKey } from '../i18n/locale'
import { AiChangesCard, createFileNav, Markdown } from '@genoffice/ui'
import {
  AiComposer,
  AiScopeQuote,
  AiReplyProgress,
  docMentionActions,
  type AiComposerDocs,
  type AiScopeQuoteData,
} from '@genoffice/ui'
import filePdfIcon from '../assets/file-pdf.png'
import fileWordIcon from '../assets/file-word.png'
import fileExcelIcon from '../assets/file-excel.png'
import filePptIcon from '../assets/file-ppt.png'
import fileImageIcon from '../assets/file-image.png'
import fileVideoIcon from '../assets/file-video.png'
import fileVoiceIcon from '../assets/file-voice.png'
import fileDocumentIcon from '../assets/file-document.png'
import fileGeneralIcon from '../assets/file-general.png'
import { IconNewChat, IconSidebarCollapse } from '../components/icons'
import { odtOffProps, useOdtSession } from '../odt-gate'

interface ToolActivity {
  name: string
  summary: string
  /** still executing: rendered as a spinner chip, replaced in place when the tool finishes */
  running?: boolean
  isError?: boolean
  /** Tool output (truncated on the UI side); when set, the row can be expanded for details */
  output?: string
}

/** Max characters of tool output in the UI expansion panel */
const TOOL_OUTPUT_MAX_CHARS = 2000

/** progress chip refresh while a write streams */
const CHIP_UPDATE_MS = 400

/** Widest a mind map picture is placed into the document; narrower maps keep
 *  their layout size (the markdown app's diagram fallback width). */
const MIND_MAP_PICTURE_MAX_WIDTH_PX = 620

/** Rasterize the baked mind-map SVG at 2x and insert it as a picture. */
async function insertSvgAsPng(
  editor: Editor,
  svg: string,
  size: { width: number; height: number },
  label: string,
): Promise<void> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(blobUrl)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(size.width * 2)
      canvas.height = Math.round(size.height * 2)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('canvas 2d context unavailable'))
        return
      }
      ctx.scale(2, 2)
      ctx.drawImage(img, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl)
      reject(new Error('the mind map SVG could not be rasterized'))
    }
    img.src = blobUrl
  })
  const scale = Math.min(1, MIND_MAP_PICTURE_MAX_WIDTH_PX / Math.max(1, size.width))
  insertPictureAtSelection(editor, {
    dataUrl,
    base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    mime: 'image/png',
    widthPx: Math.max(1, Math.round(size.width * scale)),
    heightPx: Math.max(1, Math.round(size.height * scale)),
    label,
  })
}

/** Cap on tool args/output persisted in the transcript (the store layer has another 16k truncation fallback) */
const PERSIST_TOOL_FIELD_MAX = 16_000

/** Tool args → JSON string (truncated; returns undefined on serialization failure, doesn't block persistence) */
function safeJsonInput(input: unknown): string | undefined {
  try {
    const s = JSON.stringify(input)
    return s && s !== '{}' ? s.slice(0, PERSIST_TOOL_FIELD_MAX) : undefined
  } catch {
    return undefined
  }
}

interface ChatEntry {
  role: 'user' | 'assistant'
  text: string
  error?: string
  streaming?: boolean
  turnLimit?: boolean
  /** machine-readable cause of `error`: a blocked connection gets the notice and connect cards instead of an error line */
  errorCause?: RunErrorCause
  /** tool executions performed during this assistant turn */
  tools?: ToolActivity[]
  /** interactive mind map from generate_mindmap's side-channel display (session-only;
   * the persisted transcript keeps the tool call, so a reopened file can regenerate) */
  mindmap?: MindMapTreeNode
  /** document state before this turn's first edit — what the changes card rolls back to */
  snapshot?: ProseMirrorNode
  /** what the run changed, for its changes card; set on the run's last reply when it edited */
  changes?: DocsRunChanges
  /** attachments consumed from the composer by this user message (read-only echo chips) */
  attachments?: AttachmentMeta[]
  /** the selection this user message targeted, frozen at send */
  scope?: AiScopeQuoteData
  /** skill chips this user message carried */
  skills?: SkillChipRef[]
  /** skill cards the model proposed in this turn (keys of useSkillProposals) */
  skillProposals?: string[]
  /** tokens the provider billed for this reply, summed across its turns (absent when unreported) */
  usage?: AiTokenUsageView
  /** memory lines a reopened project chat gave this message */
  memory?: ProjectMemoryLine[]
  /** tools another editor ran for this message (a reopened project chat) */
  otherEditorTools?: ProjectChatEntry['otherEditorTools']
}

/** A stored message (per-document or project chat) as the panel keeps it */
interface StoredEntry {
  role: 'user' | 'assistant'
  text: string
  tools?: readonly { name: string; summary: string; isError?: boolean; output?: string }[]
  attachments?: readonly { name: string; path?: string; ext?: string; sizeBytes?: number }[]
  scope?: AiScopeQuoteData
  skills?: unknown
  skillProposals?: string[]
  memory?: ProjectMemoryLine[]
  otherEditorTools?: ProjectChatEntry['otherEditorTools']
}

/** One message of a stored conversation, as the read-only transcript shows it */
function storedEntryOf(m: StoredEntry): ChatEntry {
  return {
    role: m.role,
    text: m.text,
    tools: m.tools?.map((t) => ({
      name: t.name,
      summary: t.summary,
      isError: t.isError,
      output: t.output ? t.output.slice(0, TOOL_OUTPUT_MAX_CHARS) : undefined,
    })),
    // stored metadata only: no thumbnail read for history, the chips render name/size
    attachments: m.attachments
      ?.filter((a) => a.path)
      .map((a) => ({
        name: a.name,
        path: a.path ?? '',
        ext: a.ext ?? '',
        sizeBytes: a.sizeBytes ?? 0,
      })),
    ...(m.scope ? { scope: m.scope } : {}),
    ...(m.role === 'user' && skillChipRefsOf(m.skills).length > 0
      ? { skills: skillChipRefsOf(m.skills) }
      : {}),
    ...(m.skillProposals ? { skillProposals: m.skillProposals } : {}),
    ...(m.memory && m.memory.length > 0 ? { memory: m.memory } : {}),
    ...(m.otherEditorTools ? { otherEditorTools: m.otherEditorTools } : {}),
  }
}

/** longest selection excerpt echoed on a user bubble */
const SCOPE_TEXT_MAX = 200

/** clickable starter prompts for the empty state (fill the input, do not send) —
 * blank documents get generation starters, documents with content get edit starters */
const DRAFT_STARTER_PROMPTS: StringKey[] = [
  'aiStarterWeeklyReport',
  'aiStarterLaunchPost',
  'aiStarterEventOutline',
]
const EDIT_STARTER_PROMPTS: StringKey[] = [
  'aiStarterSummarize',
  'aiStarterPolishAll',
  'aiStarterContinue',
  'aiStarterFillTemplate',
  'aiStarterMindMap',
]

/** resizable panel width: persisted, clamped so neither pane collapses */
const PANEL_WIDTH_KEY = 'docs-ai-panel-width'
const PANEL_WIDTH_DEFAULT = 360
const PANEL_WIDTH_MIN = 280

function maxPanelWidth(): number {
  // The viewport can be transiently tiny (a WebContentsView is 0×0 until the
  // shell lays it out), so never let the ceiling drop below the minimum
  return Math.max(PANEL_WIDTH_MIN, Math.min(720, Math.round(window.innerWidth * 0.6)))
}

function clampPanelWidth(w: number): number {
  return Math.min(Math.max(w, PANEL_WIDTH_MIN), maxPanelWidth())
}

function loadPanelWidth(): number {
  const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY))
  // static bounds only — clamping against the window here would bake a
  // transiently small viewport into the restored preference
  return Number.isFinite(saved) && saved > 0
    ? Math.min(Math.max(saved, PANEL_WIDTH_MIN), 720)
    : PANEL_WIDTH_DEFAULT
}

/** persisted UI preference: highlight AI edits in yellow and ask for confirmation */
const TRACK_CHANGES_KEY = 'ai-docs-track-changes'

/** Clipboard bitmap MIME → attachment extension (corresponds to ATTACHMENT_IMAGE_EXTS) */
const PASTE_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/** File-type icons for attachment cards (attachment icon set); exts the
 *  attachment allowlist doesn't accept yet are mapped ahead so they light up when added */
const ATTACHMENT_CARD_ICON_GROUPS: [icon: string, exts: string[]][] = [
  [fileWordIcon, ['doc', 'docx', 'odt']],
  [fileExcelIcon, ['xls', 'xlsx', 'xlsm', 'csv', 'tsv']],
  [filePptIcon, ['ppt', 'pptx']],
  [filePdfIcon, ['pdf']],
  [fileImageIcon, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'heic']],
  [fileVideoIcon, ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v']],
  [fileVoiceIcon, ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus']],
  [
    fileDocumentIcon,
    [
      'txt',
      'md',
      'markdown',
      'rtf',
      'log',
      'json',
      'yaml',
      'yml',
      'xml',
      'html',
      'htm',
      'js',
      'ts',
      'tsx',
      'jsx',
      'py',
      'java',
      'c',
      'h',
      'cpp',
      'go',
      'rs',
      'rb',
      'sh',
      'sql',
      'css',
    ],
  ],
]

export const ATTACHMENT_CARD_ICONS: Record<string, string> = Object.fromEntries(
  ATTACHMENT_CARD_ICON_GROUPS.flatMap(([icon, exts]) => exts.map((ext) => [ext, icon])),
)

function AttachmentCardIcon({ ext }: { ext: string }) {
  return <img src={ATTACHMENT_CARD_ICONS[ext] ?? fileGeneralIcon} alt="" aria-hidden />
}

/** Card name slot width: 190 card - 2 border - 8/14 padding - 40 icon - 10 gap */
const CARD_NAME_MAX_WIDTH = 116
let cardNameCtx: CanvasRenderingContext2D | null = null

/** Ellipsize like the design: cut at the limit, strip trailing -_./spaces so
 *  punctuation never sits against the …; CSS text-overflow stays as fallback */
function truncateCardName(name: string): string {
  cardNameCtx ??= document.createElement('canvas').getContext('2d')
  if (!cardNameCtx) return name
  // must match the stack the card name actually renders with (body font in styles.css)
  cardNameCtx.font =
    "500 13px 'Segoe UI', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
  if (cardNameCtx.measureText(name).width <= CARD_NAME_MAX_WIDTH) return name
  let lo = 1
  let hi = name.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cardNameCtx.measureText(`${name.slice(0, mid)}…`).width <= CARD_NAME_MAX_WIDTH) lo = mid
    else hi = mid - 1
  }
  return `${name.slice(0, lo).replace(/[-_.\s]+$/, '')}…`
}

function formatAttachmentSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(2)} KB`
}

/** Read-only echo of the attachments a user message consumed from the composer
 *  (image previews when the file is still readable; otherwise the placeholder icon) */
function SentAttachments({
  atts,
  previews,
}: {
  atts: AttachmentMeta[]
  previews: Record<string, string>
}) {
  return (
    <div className="ai-msg-attachments">
      {atts.map((a) =>
        ATTACHMENT_IMAGE_EXTS.has(a.ext) ? (
          <span key={a.path} className="ai-attachment-thumb" title={a.name}>
            {previews[a.path] ? (
              <img src={previews[a.path]} alt={a.name} />
            ) : (
              <span className="ai-attachment-thumb-pending" aria-hidden>
                <img src={fileImageIcon} alt="" />
              </span>
            )}
          </span>
        ) : (
          <span key={a.path} className="ai-attachment-card" title={a.name}>
            <span className="ai-attachment-card-icon">
              <AttachmentCardIcon ext={a.ext} />
            </span>
            <span className="ai-attachment-card-meta">
              <span className="ai-attachment-card-name">{truncateCardName(a.name)}</span>
              <span className="ai-attachment-card-size">{formatAttachmentSize(a.sizeBytes)}</span>
            </span>
          </span>
        ),
      )}
    </div>
  )
}

/** author name on AI-generated tracked revisions (accept/reject via Review) */
export const AI_REVISION_AUTHOR = 'AI Assistant'

interface AiPanelProps {
  /** the document while it can go along as a skill's template (spec 5.7) */
  templateDocument?: TemplateDocument | null
  editor: Editor
  blocks: Block[]
  settings: AiSettings
  /** the document has no text yet — the empty-state copy offers drafting instead of editing */
  docEmpty?: boolean
  /** fallback numbering ids for documents created from the blank template */
  numIdFallback?: NumIds | null
  /** preset instruction pushed from the ribbon or start screen; autoRun sends it immediately */
  preset?: { text: string; nonce: number; autoRun?: boolean } | null
  /** false shows only the collapsed rail; the component stays mounted so panel state survives */
  open?: boolean
  /** true suppresses even the collapsed rail (the "show the AI sidebar" setting is off) */
  hideRail?: boolean
  /** expand from the collapsed rail */
  onExpand?: () => void
  /** collapse the panel to the sidebar rail */
  onCollapse?: () => void
  /** Absolute path of the currently open file (used for chat-history persistence) */
  filePath?: string | null
  /** queued selection-scoped edits (owned by App, which also owns the anchors) */
  editQueue?: DocsEditQueueItem[]
  onQueueEditInstruction?: (qid: string, instruction: string) => void
  onQueueRemove?: (qid: string) => void
  onQueueClear?: () => void
  /** scroll to and select the anchored passage */
  onQueueFocus?: (qid: string) => void
  /** submission consumed these items: drop them and their anchors */
  onQueueConsume?: (qids: string[]) => void
  /** comments store for the AI comment tools (read/reply/resolve) */
  commentsAccess?: AiCommentsAccess
  /** header/footer state for the set_header_footer tool and per-turn context */
  hfAccess?: AiHeaderFooterAccess
  /** section store for set_page_setup / insert_section_break and the page-setup context line */
  pageSetupAccess?: AiPageSetupAccess
  /** style catalog and watermark stores for define_style / applyStyle / set_watermark */
  docExtras?: AiDocExtras
  /** footnote / endnote lists for insert_footnote, insert_endnote, delete_note, read_notes */
  notesAccess?: AiNotesAccess
  /**
   * The run a skill template's copy handed to this tab ended well: the app
   * saves the untitled copy into the panel's project (spec 6)
   */
  onHandedRunDone?: () => void
}

const MODEL_BRIDGE: AiModelPickerBridge = {
  getSettings: () => window.desktop.getAiSettings(),
  setSettings: (settings) => window.desktop.setAiSettings(settings),
  onSettingsChanged: (handler) => window.desktop.onAiSettingsChanged(handler),
  openModelSettings: () => window.desktop.openAiModelSettings().catch(() => {}),
}

export function AiPanel({
  editor,
  blocks,
  settings,
  docEmpty,
  numIdFallback,
  preset,
  open = true,
  hideRail = false,
  onExpand,
  onCollapse,
  filePath,
  editQueue = [],
  onQueueEditInstruction,
  onQueueRemove,
  onQueueClear,
  onQueueFocus,
  onQueueConsume,
  commentsAccess,
  hfAccess,
  pageSetupAccess,
  docExtras,
  notesAccess,
  templateDocument,
  onHandedRunDone,
}: AiPanelProps) {
  const { t, lang } = useI18n()
  /** the run a template copy handed to this tab, until it ends (spec 6) */
  const handedRunRef = useRef(createHandedRun())
  const onHandedRunDoneRef = useRef(onHandedRunDone)
  onHandedRunDoneRef.current = onHandedRunDone
  // Panel chrome follows the UI language; message text follows its own content (dir=auto below)
  const isRtl = lang === 'ar' || lang === 'he'
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  /** messages queued while a reply runs; the pump re-runs them through runWith on settle */
  const msgQueue = useChatRunQueue<{
    attachments: AttachmentMeta[]
    scope: AiScopeQuoteData | null
    skillUse: SkillUse
  }>({
    busy,
    submit: (text, meta) => {
      const loop = loopRef.current
      if (!loop || loop.busy || pendingSendRef.current) return false
      // nothing can run right now: the message stays queued, and in front of "not connected"
      // the queue is paused so it does not start by itself after a sign-in
      if (!sendGateRef.current.admitQueued(() => msgQueueRef.current.setPaused(true))) return false
      runWith(text, text, meta.attachments, meta.scope, meta.skillUse)
      return true
    },
  })
  const msgQueueRef = useRef(msgQueue)
  msgQueueRef.current = msgQueue
  /** this window's MCP servers (user MCP spec 7.5); the chips name the ones not usable now */
  const mcpWindow = useMcpWindow()
  /** the skills called with `/` or `$`: the list, the chips and the text a request gets */
  const skills = useComposerSkills({
    lang,
    editor: 'docs',
    usableMcpServers: mcpWindow.state?.usableServers(),
    // a chip whose skill has a template runs in a new tab (spec 5.7)
    onTemplateSkill: (request) => skillTemplatesRef.current.onTemplateSkill(request),
  })
  const skillsRef = useRef(skills)
  skillsRef.current = skills
  const langRef = useRef(lang)
  langRef.current = lang
  /** the skill cards `propose_skill` shows; nothing is written before their Save */
  const skillCards = useSkillProposals({
    lang,
    // the document goes along as a template while it can be one (spec 5.7)
    templateDocument: templateDocument ?? null,
    persistSaved: (record) => persistMessage('assistant', '', [record]),
  })
  const skillCardsRef = useRef(skillCards)
  skillCardsRef.current = skillCards
  /**
   * The template flow (spec 5.6, 5.7): a chip whose skill has a template runs
   * in a new tab, a template the model used offers its new document, and the
   * request a new tab was opened for runs here once through the send gate.
   */
  const skillTemplates = useSkillTemplates({
    lang,
    editor: 'docs',
    cards: skillCards,
    busy,
    send: (text, use) => runWith(text, text, undefined, undefined, use),
    // a template skill called in a document with content asks where to run
    hasContent: () => !isBlankDocument(editorRef.current),
    // a template copy that brought the asking document: it goes in as an attachment
    attach: async (paths) => {
      const added = await window.desktop.addAttachmentPaths(paths)
      mergeAttachments(added)
      return (added?.accepted.length ?? 0) > 0
    },
    onTaken: () => {
      if (!open) onExpand?.()
    },
    // a template copy's request: the copy goes into the project once it ends well
    onHandedRun: ({ preview }) => {
      if (!preview) handedRunRef.current.arm()
    },
    setComposer: setInput,
  })
  const skillTemplatesRef = useRef(skillTemplates)
  skillTemplatesRef.current = skillTemplates
  /** Wall-clock start of the current run, drives the elapsed badge */
  const runStartedAtRef = useRef(0)
  /** a send waiting on a phased open's tail; Stop / New chat abort it before it runs */
  const pendingSendRef = useRef<{ aborted: boolean } | null>(null)
  // snapshot of the starred files feeding the knowledge-base skill; refreshed
  // on mount and before each send so a freshly starred file is answerable
  const kbFilesRef = useRef<KbFileInfo[]>([])
  const refreshKbFiles = (): Promise<void> => {
    if (typeof window.desktop?.kbList !== 'function') return Promise.resolve()
    return window.desktop
      .kbList()
      .then((files) => {
        kbFilesRef.current = files
      })
      .catch(() => undefined)
  }
  const [chat, setChat] = useState<ChatEntry[]>([])
  /** the live turn shown now, for callbacks that must decide before the next render */
  const chatNowRef = useRef(chat)
  chatNowRef.current = chat
  /** a streamed write stopped early: the draft stays in the document until the user keeps or discards it */
  const [activePartial, setActivePartial] = useState<{ blocks: number } | null>(null)
  const partialResolverRef = useRef<((keep: boolean) => void) | null>(null)
  /** bumped by New chat / unmount: a writer resuming after its abort must not open the keep card */
  const writerEpochRef = useRef(0)
  /** Past conversation restored from JSONL (read-only transcript, not fed to the model) */
  const [historicChat, setHistoricChat] = useState<ChatEntry[]>([])
  const [trackChanges, setTrackChanges] = useState(
    () => localStorage.getItem(TRACK_CHANGES_KEY) === '1',
  )
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([])
  const [attachNotice, setAttachNotice] = useState<string | null>(null)
  /** data-URL previews for image attachments, keyed by path (composer thumbnails) */
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<string, string>>({})
  /** image paths with a read already issued — one readAttachmentImage per attach, even while pending */
  const previewRequestedRef = useRef(new Set<string>())
  /** Attachments consumed by earlier sends this session: sending clears the composer, but the
      files skill must keep reading them mid-run and in follow-up turns. Deduped by path
      against the live composer list. */
  const sentAttachmentsRef = useRef<AttachmentMeta[]>([])
  useEffect(() => {
    void refreshKbFiles()
  }, [])

  useEffect(() => {
    // previews cover the composer plus every image echoed on a sent/history message
    // (history chips re-read the file by its stored path; a deleted file keeps the placeholder)
    const wanted = [
      ...attachments,
      ...chat.flatMap((e) => e.attachments ?? []),
      ...historicChat.flatMap((e) => e.attachments ?? []),
    ]
    const alive = new Set(wanted.map((a) => a.path))
    // drop previews (and request markers) of removed attachments, so memory is reclaimed and a re-attach re-reads
    setAttachmentPreviews((prev) => {
      const stale = Object.keys(prev).filter((p) => !alive.has(p))
      if (stale.length === 0) return prev
      const next = { ...prev }
      for (const p of stale) delete next[p]
      return next
    })
    for (const p of previewRequestedRef.current) {
      if (!alive.has(p)) previewRequestedRef.current.delete(p)
    }
    for (const a of wanted) {
      if (!ATTACHMENT_IMAGE_EXTS.has(a.ext) || previewRequestedRef.current.has(a.path)) continue
      previewRequestedRef.current.add(a.path)
      void window.desktop
        .readAttachmentImage(a.path)
        .then((r) => {
          if (!previewRequestedRef.current.has(a.path)) return // removed while the read was in flight
          if (r.ok && r.base64 && r.mime) {
            setAttachmentPreviews((prev) => ({
              ...prev,
              [a.path]: `data:${r.mime};base64,${r.base64}`,
            }))
          }
        })
        .catch(() => {
          // A rejected read (bridge error, teardown race) must not leave the
          // path marked requested forever — that would permanently skip the
          // thumbnail with no retry. Clear it so the next effect run retries.
          previewRequestedRef.current.delete(a.path)
        })
    }
  }, [attachments, chat, historicChat])
  /** paints the strip's scrollbar thumb while the user scrolls it (cleared 800ms after the last event) */
  const attachScrollFadeRef = useRef(0)
  const onAttachmentsScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    el.classList.add('is-scrolling')
    window.clearTimeout(attachScrollFadeRef.current)
    attachScrollFadeRef.current = window.setTimeout(() => el.classList.remove('is-scrolling'), 800)
  }
  const [dragOver, setDragOver] = useState(false)
  // preferred = the user's chosen width (the only value persisted); panelWidth =
  // what fits the current window. Deriving the display width from the preference
  // means a transiently small window never permanently shrinks the panel.
  const preferredWidthRef = useRef(loadPanelWidth())
  const [panelWidth, setPanelWidth] = useState(() => clampPanelWidth(preferredWidthRef.current))
  const [resizing, setResizing] = useState(false)
  const asideRef = useRef<HTMLElement>(null)

  // The .ai-dock wrapper owns the animated width (Excel-parity 180ms slide);
  // it tracks the resizable panel width through this variable
  // `open` dep: the aside ref only exists while expanded
  useEffect(() => {
    const dock = asideRef.current?.closest('.ai-dock') as HTMLElement | null
    dock?.style.setProperty('--ai-panel-width', `${panelWidth}px`)
  }, [panelWidth, open])

  // Re-derive the display width on window resize (max is 60% of the window);
  // growing the window back restores the preferred width
  useEffect(() => {
    const onResize = () => setPanelWidth(clampPanelWidth(preferredWidthRef.current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // a pending keep/discard must not outlive the panel: settle it as discard
  useEffect(
    () => () => {
      writerEpochRef.current++
      partialResolverRef.current?.(false)
      partialResolverRef.current = null
    },
    [],
  )
  // bumped on selection/doc changes so the scope hint & quick actions stay fresh
  const [, setScopeTick] = useState(0)
  /** the scope chip's expandable preview of the selected text */
  const [scopePreviewOpen, setScopePreviewOpen] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const scrollBottom = useScrollToBottom(logRef)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /** false once the user scrolls up to read; re-arms near the bottom */
  const stickToBottomRef = useRef(true)
  /** projectId/chatId of the current chat */
  const chatRefIds = useRef<{ projectId: string; chatId: string } | null>(null)

  // latest props for the loop's closures (the loop instance outlives renders)
  const editorRef = useRef(editor)
  editorRef.current = editor
  /** connection of the subscription providers: decides the provider, the connect prompt and the notices */
  const subscription = useSubscriptionConnection()
  const subscriptionRef = useRef(subscription)
  subscriptionRef.current = subscription
  /** The send gate every editor shares: holds a request made during a status check or in front
      of the first-connection notice, refuses in front of "not connected", and writes this
      panel's settings changes ("continue with ...", the acknowledged notice) onto the latest
      stored settings, so a key another window saved meanwhile is not written back */
  const sendGate = useAiSendGate<{
    instruction: string
    displayInstruction: string
    attachments: AttachmentMeta[] | undefined
    retryScope: AiScopeQuoteData | null | undefined
    skillUse: SkillUse
  }>({
    settings,
    statuses: subscription.statuses,
    store: MODEL_BRIDGE,
    start: (held) =>
      runWith(
        held.instruction,
        held.displayInstruction,
        held.attachments,
        held.retryScope,
        held.skillUse,
      ),
    onSettingsSaved: (next) => {
      // a run started right after ("continue with ...") must already see the change
      settingsRef.current = next
    },
  })
  const sendGateRef = useRef(sendGate)
  sendGateRef.current = sendGate
  /** the settings prop, or a change this panel just stored until the prop catches up */
  const liveSettings = sendGate.settings ?? settings
  const settingsRef = useRef(liveSettings)
  settingsRef.current = liveSettings
  /** what the image / media tools can do right now, asked from the main process
      (settings plus subscription statuses; refreshed when either changes and on window focus) */
  const toolCapabilitiesRef = useRef<AiToolCapabilities | null>(null)
  useEffect(() => {
    let alive = true
    const refresh = () => {
      // tests render the panel without a preload bridge
      void Promise.resolve()
        .then(() => window.desktop?.aiToolCapabilities?.())
        .then((capabilities) => {
          if (alive && capabilities) toolCapabilitiesRef.current = capabilities
        })
        .catch(() => {})
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      window.removeEventListener('focus', refresh)
    }
  }, [settings, subscription.statuses])
  /** rate-limit windows the subscription CLI reported (newest per provider and window) */
  const [subscriptionUsage, setSubscriptionUsage] = useState<AiSubscriptionUsage[]>([])
  // usage a picture request reported reaches every window (the chat stream only its own)
  useSubscriptionUsageUpdates(
    () => window.aiOfficeSubscription,
    setSubscriptionUsage,
    mergeSubscriptionUsage,
  )
  /** the last turn's input was cut to fit a limit: the user is told, never silently */
  const [inputTruncated, setInputTruncated] = useState(false)
  /** structured copy of the transport's latest failure, matched to the loop's error by its text */
  const streamErrorRef = useRef<IpcStreamError | null>(null)
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const numIdFallbackRef = useRef(numIdFallback)
  numIdFallbackRef.current = numIdFallback
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  /** attachments consumed by the most recent send — retry resends the same set */
  const lastAttachmentsRef = useRef<AttachmentMeta[]>([])
  /** the scope quote of the last send, so a retry reuses it instead of re-reading the live selection */
  const lastScopeRef = useRef<AiScopeQuoteData | undefined>(undefined)
  /** the skills of the last send: a retry sends the same skill text */
  const lastSkillUseRef = useRef<SkillUse>(NO_SKILL_USE)
  /** composer attachments plus everything already sent this session (deduped by path) */
  const availableAttachments = (): AttachmentMeta[] => {
    const seen = new Set<string>()
    return [...sentAttachmentsRef.current, ...attachmentsRef.current].filter((a) =>
      seen.has(a.path) ? false : (seen.add(a.path), true),
    )
  }
  // tracked changes are off in an ODT document: AI edits land as plain edits
  const odtDoc = useOdtSession()
  const trackOn = trackChanges && !odtDoc
  const trackChangesRef = useRef(trackOn)
  trackChangesRef.current = trackOn
  const commentsAccessRef = useRef(commentsAccess)
  commentsAccessRef.current = commentsAccess
  const hfAccessRef = useRef(hfAccess)
  hfAccessRef.current = hfAccess
  const pageSetupAccessRef = useRef(pageSetupAccess)
  pageSetupAccessRef.current = pageSetupAccess
  const docExtrasRef = useRef(docExtras)
  docExtrasRef.current = docExtras
  const notesAccessRef = useRef(notesAccess)
  notesAccessRef.current = notesAccess

  /** drop every aiChanged flag when the AI's revisions are accepted */
  const clearAiHighlights = () => {
    const view = editorRef.current.view
    let tr = view.state.tr
    let touched = false
    view.state.doc.forEach((node, offset) => {
      if (node.attrs.aiChanged) {
        tr = tr.setNodeMarkup(offset, undefined, { ...node.attrs, aiChanged: false })
        touched = true
      }
    })
    if (touched) {
      view.dispatch(tr)
      // AI-pipeline housekeeping, not a user edit: keep the freshness baseline current
      markDocSeen(editorRef.current)
    }
  }
  /** the page shows the yellow marks of the last run (tracking off) */
  const [marksShown, setMarksShown] = useState(false)
  const marksShownRef = useRef(marksShown)
  marksShownRef.current = marksShown
  /** Take the last run's marks off the page: no edit, no undo step, no revision. */
  const clearMarks = () => {
    marksShownRef.current = false
    setMarksShown(false)
    const ed = editorRef.current
    const before = ed.state.doc
    const tr = clearAiMarksTransaction(ed.view.state)
    if (!tr) return
    ed.view.dispatch(tr)
    // the AI saw the marked document: it saw this one (a user edit since still counts)
    carryDocSeen(ed, before)
  }
  /**
   * What the finished run changed, for its last reply: nothing when it made no edit.
   * With tracking off its blocks keep their marks, counted here; with tracking on the
   * revisions show the changes and the card names no count. Refs only: the loop keeps
   * the closure of the first render.
   */
  const takeRunChanges = (): { changes: DocsRunChanges } | Record<string, never> => {
    if (!runSnapshotRef.current) return {}
    if (trackChangesRef.current) {
      const lines = runEditLinesRef.current.length > 0 ? [...runEditLinesRef.current] : undefined
      return { changes: { state: 'applied', ...(lines ? { lines } : {}) } }
    }
    const doc = editorRef.current.state.doc
    const count = countAiMarkedBlocks(doc)
    if (count > 0) {
      marksShownRef.current = true
      setMarksShown(true)
    }
    const markedLines = collectAiMarkedChangeLines(doc)
    const lines =
      markedLines.length > 0
        ? markedLines
        : runEditLinesRef.current.length > 0
          ? [...runEditLinesRef.current]
          : undefined
    return {
      changes: {
        state: 'applied',
        ...(count > 0 ? { count } : {}),
        ...(lines ? { lines } : {}),
      },
    }
  }
  /**
   * A new run or chat starts without the last run's marks. With tracking off no block
   * keeps one either way (a redo can bring a cleared one back); with tracking on the
   * yellow under the revisions stays for the Review tab, as before.
   */
  const dropRunMarks = () => {
    if (marksShownRef.current || !trackChangesRef.current) clearMarks()
  }
  // the marks go once the user edits the document (they would point astray) or something
  // else took them off; housekeeping that keeps no undo step is not the user's edit
  useEffect(() => {
    if (!marksShown || busy) return
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged || isAiMarksClear(transaction)) return
      if (transaction.getMeta('addToHistory') !== false) {
        // after this transaction is applied, not inside its dispatch
        window.setTimeout(() => {
          if (marksShownRef.current) clearMarks()
        }, 0)
      } else if (countAiMarkedBlocks(transaction.doc) === 0) {
        marksShownRef.current = false
        setMarksShown(false)
      }
    }
    editor.on('transaction', onTransaction)
    return () => {
      editor.off('transaction', onTransaction)
    }
  }, [editor, marksShown, busy])
  /** instruction of the in-flight run */
  const instructionRef = useRef('')
  /** document state before the run's first edit — attached to the turn's final
      segment at run end (mid-turn segments never show the action toolbar) */
  const runSnapshotRef = useRef<ProseMirrorNode | null>(null)
  /** last sent instruction, for one-click retry */
  const lastInstructionRef = useRef('')
  /** Tool activity of the whole run (with args/output, accumulated across turns) — for full
      transcript persistence, and so persisting needn't do side effects inside a setState updater */
  const runToolsRef = useRef<
    Array<{ name: string; summary: string; isError?: boolean; input?: string; output?: string }>
  >([])
  /** fallback change lines captured from mutating tool calls during the run */
  const runEditLinesRef = useRef<DocsChangeLine[]>([])
  /** tokens billed so far in the in-flight run (summed across turns; usage chips read it live) */
  const runUsageRef = useRef<AiTokenUsageView | undefined>(undefined)
  /** tokens billed across the panel's session (the composer chip) */
  const [sessionUsage, setSessionUsage] = useState<AiTokenUsageView | undefined>(undefined)

  // ── Chat-history persistence ────────────────────────────────────────────
  /** the project folder of this panel (set once its hook ran; read by callbacks) */
  const projectRef = useRef<ProjectPanel | null>(null)

  /** Show a stored conversation as the read-only transcript and hand it to the model. */
  const showStoredChat = (stored: readonly StoredEntry[]) => {
    // skill cards come back closed; a saved card's record is not part of the conversation
    const msgs = skillCardsRef.current.restore(stored)
    setHistoricChat(msgs.map(storedEntryOf))
    // the next request re-reads the current text of the skills this conversation used
    skillsRef.current.restoreHistory(
      msgs.map((m) => (m.role === 'user' ? skillChipRefsOf(m.skills) : undefined)),
    )
    // a reopened conversation starts with no MCP choices of another chat (user MCP spec 7.6)
    windowMcpState()?.newConversation()
    // restore model context: follow-ups after reopening a file continue the previous conversation (only when the loop is idle with no history)
    loopRef.current?.restore(msgs.map((m) => ({ role: m.role, text: m.text })))
  }

  /** This document's own conversation; nothing while a project chat shows. */
  const loadDocumentChat = (ids: { projectId: string; chatId: string }) => {
    const api = (window as Window & { projectApi?: typeof window.projectApi }).projectApi
    if (!api) return
    void api
      .loadChat({ projectId: ids.projectId, chatId: ids.chatId, limit: 200 })
      .then((stored) => {
        if (stored.length === 0 || projectRef.current?.chat.chat) return
        showStoredChat(stored)
      })
      .catch(() => {
        /* history load failures are silent */
      })
  }

  useEffect(() => {
    const api = (window as Window & { projectApi?: typeof window.projectApi }).projectApi
    if (!api) return
    const tempChatId = `unsaved-${Date.now()}`
    void api
      .resolveChat({ filePath: filePath ?? null, tempChatId })
      .then((ids) => {
        chatRefIds.current = ids
        loadDocumentChat(ids)
      })
      .catch(() => {
        /* history load failures are silent */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** After an unsaved document's first save yields a real path, bind the unsaved-* history to that file (recoverable by path on reopen) */
  const savedPathRef = useRef(filePath)
  useEffect(() => {
    // a first save or a save under another name: a project chat notes the document (spec 5.3.6)
    if (filePath && filePath !== savedPathRef.current) {
      void projectRef.current?.chat.documentSaved()
    }
    savedPathRef.current = filePath
    const ids = chatRefIds.current
    const api = (window as Window & { projectApi?: typeof window.projectApi }).projectApi
    if (!api || !ids || !filePath || !ids.chatId.startsWith('unsaved-')) return
    void api
      .rebindChat({ projectId: ids.projectId, tempChatId: ids.chatId, newFilePath: filePath })
      .then((r) => {
        if (r?.chatId) chatRefIds.current = r
      })
      .catch(() => {
        /* silent */
      })
  }, [filePath])

  const persistMessage = (
    role: 'user' | 'assistant',
    text: string,
    tools?: Array<{
      name: string
      summary: string
      isError?: boolean
      input?: string
      output?: string
    }>,
    attachments?: AttachmentMeta[],
    scope?: AiScopeQuoteData,
    skillChips?: SkillChipRef[],
  ) => {
    const record = {
      role,
      text,
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(attachments && attachments.length > 0
        ? {
            attachments: attachments.map((a) => ({
              name: a.name,
              path: a.path,
              ext: a.ext,
              sizeBytes: a.sizeBytes,
            })),
          }
        : {}),
      ...(scope ? { scope } : {}),
      ...(skillChips && skillChips.length > 0 ? { skills: skillChips } : {}),
    }
    // a chosen project (or this document's earlier chat) records it; otherwise as before
    if (projectRef.current?.chat.persist(record)) return
    const ids = chatRefIds.current
    const api = (window as Window & { projectApi?: typeof window.projectApi }).projectApi
    if (!ids || !api) return
    void api.appendChat({ projectId: ids.projectId, chatId: ids.chatId, ...record }).catch(() => {
      /* silent */
    })
  }

  const patchLastAssistant = (
    patch: Partial<ChatEntry> | ((last: ChatEntry) => Partial<ChatEntry>),
  ) => {
    setChat((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (!last || last.role !== 'assistant') return prev
      next[next.length - 1] = { ...last, ...(typeof patch === 'function' ? patch(last) : patch) }
      // bounded: this is where a finished run's full-document snapshot lands
      return boundChatHistory(next)
    })
  }

  /**
   * The project folder (spec 5): the chip under the input, the chat menu, the
   * notices. With no project chosen the panel keeps its per-document chat.
   */
  const project = useProjectPanel({
    editor: 'docs',
    lang,
    busy,
    loop: () => loopRef.current,
    consolidation: () => {
      const transport = transportRef.current
      return transport ? { transport, gate: () => sendGateRef.current.peek() } : null
    },
    onOpen: (opened, initial) => openChat(opened, initial),
    onRemoteMessages: (entries, running) => {
      setChat((prev) =>
        boundChatHistory(placeRemoteEntries(prev, entries.map(storedEntryOf), running)),
      )
    },
    onNewChat: () => newChat(),
  })
  projectRef.current = project

  const transportRef = useRef<ReturnType<typeof createElectronTransport> | null>(null)
  if (!transportRef.current)
    transportRef.current = createElectronTransport(() => settingsRef.current, {
      onStreamError: (failure) => {
        streamErrorRef.current = failure
      },
      onSubscriptionUsage: (usage) =>
        setSubscriptionUsage((known) => mergeSubscriptionUsage(known, usage)),
      onInputTruncated: () => setInputTruncated(true),
    })

  /**
   * Long-form writing: one tool-less request whose reply is the fragment, streamed
   * into the document as a draft by the tool. A stream that stops early leaves the
   * user a keep-or-discard choice; a stream that produced nothing is retried once.
   */
  const runDocWriter = async (
    spec: DocWriteSpec,
    onProgress: (html: string) => void,
    signal?: AbortSignal,
  ): Promise<DocWriteResult> => {
    const { system, user } = buildDocWriterRequest(spec, aiLangDirective())
    const epoch = writerEpochRef.current
    let closed = false
    let chipTimer: ReturnType<typeof setTimeout> | null = null
    let latest = ''
    const updateChip = () => {
      chipTimer = null
      if (closed) return
      const blocks = countFragmentBlocks(latest)
      patchLastAssistant((last) => ({
        tools: last.tools?.map((tl) =>
          tl.running ? { ...tl, summary: tModule('aiWritingDocument', { blocks }) } : tl,
        ),
      }))
    }
    const attempt = () =>
      streamText({
        transport: transportRef.current!,
        system,
        user,
        signal,
        maxChars: DOC_MAX_CHARS,
        extract: (raw) => ({ text: extractFragment(raw) }),
        onProgress: (html) => {
          if (closed) return
          latest = html
          onProgress(html)
          if (chipTimer === null) chipTimer = setTimeout(updateChip, CHIP_UPDATE_MS)
        },
      })
    let outcome = await attempt()
    if (outcome.status === 'empty' && !signal?.aborted) outcome = await attempt()
    closed = true
    if (chipTimer !== null) clearTimeout(chipTimer)
    if (outcome.status === 'complete') return { ok: true, html: outcome.text }
    if (outcome.status === 'empty') return { ok: false, error: outcome.error }
    if (epoch !== writerEpochRef.current) return { ok: false, error: 'the chat was reset' }
    // the draft stays in the document while the user decides
    const keep = await new Promise<boolean>((resolve) => {
      partialResolverRef.current = resolve
      setActivePartial({ blocks: countFragmentBlocks(outcome.text) })
    })
    return keep
      ? { ok: true, html: outcome.text, truncated: true }
      : {
          ok: false,
          error: `${outcome.reason}${outcome.error ? `: ${outcome.error}` : ''}; the user discarded the partial content`,
        }
  }
  const runDocWriterRef = useRef(runDocWriter)
  runDocWriterRef.current = runDocWriter

  const decidePartial = (keep: boolean): void => {
    partialResolverRef.current?.(keep)
    partialResolverRef.current = null
    setActivePartial(null)
  }
  /** New chat / unmount: discard an open keep card and keep a still-settling writer from opening one */
  const abandonWriter = (): void => {
    writerEpochRef.current++
    decidePartial(false)
  }

  const loopRef = useRef<AgentLoop<ProseMirrorNode> | null>(null)
  if (!loopRef.current) {
    const numIds = (): NumIds => ({
      bullet: findNumId(blocksRef.current, 'bullet') ?? numIdFallbackRef.current?.bullet ?? null,
      ordered: findNumId(blocksRef.current, 'ordered') ?? numIdFallbackRef.current?.ordered ?? null,
    })
    loopRef.current = new AgentLoop<ProseMirrorNode>({
      transport: transportRef.current,
      systemSuffix: aiLangDirective,
      // a local model that reported no tool support answers in text only
      toolsAllowed: () => localModelCapabilities(settingsRef.current).tools !== false,
      skill: composeWithDrive('docs+files', '', () => loopRef.current?.messages ?? [], [
        // the reader's starred files; empty while the user stars nothing —
        // buildContext then returns '' and the skill stays out of the way.
        // Mounted only when the bridge carries the kb channel at all: a test
        // mock or an older preload must not grow tools that cannot execute.
        ...(typeof window.desktop?.kbList === 'function'
          ? [
              createKnowledgeBaseSkill({
                listFiles: () => kbFilesRef.current,
                search: (query, limit) => window.desktop.kbSearch({ q: query, limit }),
                read: (path, offset) => window.desktop.kbRead(path, offset),
              }),
            ]
          : []),
        createDocsSkill(
          () => editorRef.current,
          numIds,
          () => (trackChangesRef.current ? { author: AI_REVISION_AUTHOR } : undefined),
          () => commentsAccessRef.current,
          () => hfAccessRef.current,
          () => toolCapabilitiesRef.current?.imageGeneration.available === true,
          () => ({
            write: (spec, onProgress, signal) => runDocWriterRef.current(spec, onProgress, signal),
          }),
          () => pageSetupAccessRef.current,
          () => docExtrasRef.current,
          () => notesAccessRef.current,
          () =>
            toolCapabilitiesRef.current?.imageAnalysis.available === true ||
            toolCapabilitiesRef.current?.videoAnalysis.available === true,
          // the model names an attachment; only files the panel shows can be found
          () => ({
            pathOf: (name) =>
              availableAttachments().find((attachment) => attachment.name === name)?.path ?? null,
            names: () =>
              availableAttachments()
                .filter((attachment) => ATTACHMENT_IMAGE_EXTS.has(attachment.ext))
                .map((attachment) => attachment.name),
          }),
        ),
        createFilesSkill(availableAttachments),
        // the person's skills: use_skill, read_skill_file, propose_skill (app-run tools)
        ...panelUserSkills({
          editor: 'docs',
          lang: () => langRef.current,
          messages: () => loopRef.current?.messages ?? [],
          // a template skill the model used offers its new document (spec 5.7)
          onUsed: (skill) => skillTemplatesRef.current.onUsed(skill),
          // use_skill names the MCP servers it expects that are not usable now (spec 8)
          mcpServerUsable: (name) => windowMcpUsableServers().has(name),
          onProposal: (proposal) => {
            skillCardsRef.current.add(proposal)
            patchLastAssistant((last) => ({
              skillProposals: [...(last.skillProposals ?? []), proposal.key],
            }))
          },
        }),
        // the chosen project folder: its context and its four app-run tools (spec 5.4, 5.5)
        ...panelProjectSkill({ run: project.chat.run, lang: () => langRef.current }),
      ]),
      captureSnapshot: () => captureRollbackSnapshot(editorRef.current),
      events: {
        onText: (text) => patchLastAssistant({ text }),
        onToolStart: (call) => {
          // Live "running" chip: replaced in place by onToolExecuted
          patchLastAssistant((last) => ({
            tools: [
              ...(last.tools ?? []),
              { name: call.name, summary: toolStepLabel(call.name), running: true },
            ],
          }))
        },
        onToolExecuted: ({ call, execution, snapshotBefore }) => {
          // The run's first pre-edit state wins so one roll-back undoes the whole run
          if (snapshotBefore && !runSnapshotRef.current) runSnapshotRef.current = snapshotBefore
          if (execution.mutated && !execution.isError) {
            runEditLinesRef.current.push(
              docChangeLineFromTool(call.name, call.input, execution.summary),
            )
          }
          // tracking off: the edit is accepted, its yellow marks stay until the next run (or
          // the card's clear); tracking on: revisions stay pending, handled in the Review tab
          // mind maps ride the UI-only display side channel onto the message
          const display = execution.display
          const mindmap = display?.kind === 'mindmap' ? display.tree : undefined
          runToolsRef.current.push({
            name: call.name,
            summary: execution.summary,
            isError: execution.isError,
            input: safeJsonInput(call.input),
            output: execution.output
              ? execution.output.slice(0, PERSIST_TOOL_FIELD_MAX)
              : undefined,
          })
          patchLastAssistant((last) => {
            // Swap out the running placeholder pushed by onToolStart (parse-fail calls have none)
            const tools = [...(last.tools ?? [])]
            if (tools.at(-1)?.running) tools.pop()
            return {
              tools: [
                ...tools,
                {
                  name: call.name,
                  summary: execution.summary,
                  isError: execution.isError,
                  output: execution.output
                    ? execution.output.slice(0, TOOL_OUTPUT_MAX_CHARS)
                    : undefined,
                },
              ],
              ...(mindmap ? { mindmap } : {}),
            }
          })
        },
        onTurnEnd: () => {
          patchLastAssistant({ streaming: false })
          setChat((prev) =>
            boundChatHistory([...prev, { role: 'assistant', text: '', streaming: true }]),
          )
        },
        onUsage: (usage) => {
          runUsageRef.current = addTokenUsage(runUsageRef.current, usage)
          setSessionUsage((prev) => addTokenUsage(prev, usage))
          patchLastAssistant({ usage: runUsageRef.current })
        },
        onDone: ({ text, cancelled, turnLimit, truncated }) => {
          // module-level t: the loop instance is created only once; the component's t goes stale with the first-render closure
          const baseText = turnLimit
            ? [text, tModule('aiTurnLimit')].filter(Boolean).join('\n\n')
            : text || (cancelled ? tModule('aiStopped') : '')
          const finalText = truncated
            ? [baseText, tModule('aiTruncatedNote')].filter(Boolean).join('\n\n')
            : baseText
          // outside the updater: it reads the document and shows the marks once
          const runChanges = takeRunChanges()
          patchLastAssistant((last) => ({
            streaming: false,
            turnLimit,
            text: finalText || (last.tools?.length ? last.text : tModule('aiNoReply')),
            // A stop mid-tool can leave a running placeholder behind — drop it
            tools: last.tools?.filter((tl) => !tl.running),
            snapshot: runSnapshotRef.current ?? undefined,
            ...runChanges,
          }))
          setBusy(false)
          // App listens: a run that generated content into a never-saved document
          // triggers a silent first save with a content-derived file name
          window.dispatchEvent(new Event('ai-docs-run-done'))
          // persist outside the updater (a double-invoked updater would write history twice); tools stores the whole run's full activity.
          // Edits-only runs (tools ran, no text) persist too, or the whole turn vanishes from the restored transcript
          if (!cancelled && (finalText || runToolsRef.current.length > 0)) {
            persistMessage('assistant', finalText, runToolsRef.current)
          }
          projectRef.current?.finishSend()
          // a handed-over run that ended well: the copy goes into the project
          if (handedRunRef.current.settle(!cancelled)) onHandedRunDoneRef.current?.()
        },
        onError: (error) => {
          const errorCause = runErrorCauseOf(streamErrorRef.current, error)
          streamErrorRef.current = null
          // outside the updater: it reads the document and shows the marks once
          const runChanges = takeRunChanges()
          setChat((prev) => {
            const next = [...prev]
            const last = next.at(-1)
            if (last?.role === 'assistant') {
              next[next.length - 1] = {
                ...last,
                streaming: false,
                error,
                ...(errorCause ? { errorCause } : {}),
                tools: last.tools?.filter((tl) => !tl.running),
                snapshot: runSnapshotRef.current ?? undefined,
                ...runChanges,
              }
            }
            return boundChatHistory(next)
          })
          // a refusal for a connection reason may rest on an out-of-date status: look
          // again, so the connect cards show what the program says now
          if (shouldRecheckAfter(errorCause)) {
            subscriptionRef.current.refresh(
              errorCause?.provider ? [errorCause.provider] : undefined,
            )
          }
          // the next queued message would only run into the same wall: it waits for a resume
          if (isBlockedRunCause(errorCause)) msgQueueRef.current.hold()
          setBusy(false)
          projectRef.current?.finishSend()
          // a failed make writes nothing: the copy stays untitled
          handedRunRef.current.settle(false)
        },
      },
    })
  }

  useEffect(() => {
    if (!preset) return
    if (preset.autoRun) runWith(preset.text)
    else {
      setInput(preset.text)
      inputRef.current?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.nonce])

  // keep the scope hint & quick actions in sync with the editor selection
  useEffect(() => {
    const bump = () => {
      if (editor.state.selection.empty) setScopePreviewOpen(false)
      setScopeTick((t) => t + 1)
    }
    editor.on('selectionUpdate', bump)
    editor.on('update', bump)
    return () => {
      editor.off('selectionUpdate', bump)
      editor.off('update', bump)
    }
  }, [editor])

  // scope chip data, recomputed per render (the scope tick above keeps it fresh)
  const liveSelection = editor.state.selection
  const selectionText = liveSelection.empty
    ? ''
    : redactTextBetween(
        editor.getJSON() as RedactableNode,
        liveSelection.from,
        liveSelection.to,
        '\n',
      )
        .replace(/\s+/g, ' ')
        .trim()
  const hasScopeSelection = selectionText.length > 0

  /** the × on the scope chip: collapse the selection so the run targets the whole document */
  const clearScopeSelection = () => {
    editor.commands.setTextSelection(editor.state.selection.to)
  }

  const selectionScopeQuote = (): AiScopeQuoteData | undefined => {
    const { from, to, empty } = editor.state.selection
    if (empty) return undefined
    const text = redactTextBetween(editor.getJSON() as RedactableNode, from, to, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) return undefined
    return {
      label: t('aiScopeSelection', { words: countWords(text) }),
      text: text.length > SCOPE_TEXT_MAX ? `${text.slice(0, SCOPE_TEXT_MAX)}…` : text,
    }
  }

  // the frozen-range highlight ends with the run, or as soon as the editor is focused again
  useEffect(() => {
    if (!busy) setInactiveSelectionShown(editor, false)
  }, [busy, editor])
  useEffect(() => {
    const off = () => setInactiveSelectionShown(editor, false)
    editor.on('focus', off)
    return () => {
      editor.off('focus', off)
    }
  }, [editor])

  // made once: a stable list lets the memoized Markdown skip unchanged replies
  const chatNavs = useMemo(() => {
    /** [label](docnav://block/N) links in replies select and scroll to that block */
    const docNav = {
      scheme: DOC_NAV_SCHEME,
      onNavigate: (href: string) => {
        const index = parseDocNavHref(href)
        if (index !== null) navigateToBlock(editorRef.current, index)
      },
    }
    // [name](filenav:///abs/path) citations open the cited file in its own app
    const fileNav = createFileNav((path) => {
      void window.desktop.openSourcePath(path)
    })
    return [docNav, fileNav]
  }, [])

  // follow the stream, but stop yanking once the user scrolls up to read;
  // `open` dep: re-expanding lands on messages streamed while collapsed
  useEffect(() => {
    if (stickToBottomRef.current) {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
    }
  }, [chat, open])

  const onLogScroll = () => {
    const el = logRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    scrollBottom.onScroll()
  }

  const run = () => {
    const text = input.trim()
    if (!text) return
    skills.withSkills(text, (skillUse) => runWith(text, text, undefined, undefined, skillUse))
  }

  /** Image attachments are read as base64 and go multimodal with this user message (≤5MB per image, max 20) */
  const MAX_IMAGES_PER_MESSAGE = 20
  const collectImageAttachments = async (atts: AttachmentMeta[]): Promise<AgentImage[]> => {
    const imageAtts = atts.filter((a) => ATTACHMENT_IMAGE_EXTS.has(a.ext))
    const images: AgentImage[] = []
    const failures: string[] = []
    for (const att of imageAtts.slice(0, MAX_IMAGES_PER_MESSAGE)) {
      const result = await window.desktop.readAttachmentImage(att.path)
      if (result.ok && result.base64 && result.mime) {
        images.push({ base64: result.base64, mime: result.mime })
      } else {
        failures.push(result.error ?? t('aiImageReadFail', { name: att.name }))
      }
    }
    if (imageAtts.length > MAX_IMAGES_PER_MESSAGE) {
      failures.push(t('aiTooManyImages', { max: MAX_IMAGES_PER_MESSAGE }))
    }
    if (failures.length > 0) {
      setAttachNotice(failures.join(';'))
      window.setTimeout(() => setAttachNotice(null), 5000)
    }
    return images
  }

  const runWith = (
    instruction: string,
    displayInstruction = instruction,
    attachmentsOverride?: AttachmentMeta[],
    /** null = a retry that had no scope; undefined = capture the live selection */
    retryScope?: AiScopeQuoteData | null,
    /** the chosen skills: their text goes to the model, their chips onto the bubble */
    skillUse: SkillUse = NO_SKILL_USE,
  ) => {
    const loop = loopRef.current
    if (!instruction || !loop || loop.busy || pendingSendRef.current) return
    // Nothing can run yet: the composer shows the connect prompt or the notice about what
    // leaves the PC instead of an error, and keeps its text. A request made in front of the
    // notice (or while the status check is still running) is held and starts once the way is
    // clear; in front of a real "not connected" nothing is kept.
    if (
      !sendGate.admit({
        instruction,
        displayInstruction,
        attachments: attachmentsOverride,
        retryScope,
        skillUse,
      })
    ) {
      return
    }
    setInputTruncated(false)
    setInput('')
    skillsRef.current.consume(skillUse)
    lastSkillUseRef.current = skillUse
    skillTemplatesRef.current.noteRequest(displayInstruction)
    // The message consumes the composer attachments: they ride along (echoed on the
    // bubble, images multimodal, files via the files skill) and the composer clears.
    const sentAtts = attachmentsOverride ?? attachmentsRef.current
    if (!attachmentsOverride && sentAtts.length > 0) {
      const seen = new Set(sentAttachmentsRef.current.map((a) => a.path))
      sentAttachmentsRef.current = [
        ...sentAttachmentsRef.current,
        ...sentAtts.filter((a) => !seen.has(a.path)),
      ]
      setAttachments([])
    }
    lastAttachmentsRef.current = sentAtts
    // the queue batch and the continue action carry their own display text: no selection quote
    const scope =
      retryScope !== undefined
        ? (retryScope ?? undefined)
        : displayInstruction === instruction
          ? selectionScopeQuote()
          : undefined
    lastScopeRef.current = scope
    // the popover input / composer own the DOM selection now: keep the targeted range visible until the run ends
    if (scope) setInactiveSelectionShown(editor, true)
    instructionRef.current = instruction
    lastInstructionRef.current = instruction
    runToolsRef.current = []
    runEditLinesRef.current = []
    runSnapshotRef.current = null
    runUsageRef.current = undefined
    dropRunMarks()
    stickToBottomRef.current = true
    setChat((prev) =>
      boundChatHistory([
        ...prev,
        {
          role: 'user',
          text: displayInstruction,
          ...(sentAtts.length > 0 ? { attachments: sentAtts } : {}),
          ...(scope ? { scope } : {}),
          ...(skillUse.chips.length > 0 ? { skills: skillUse.chips } : {}),
        },
        { role: 'assistant', text: '', streaming: true },
      ]),
    )
    runStartedAtRef.current = Date.now()
    setBusy(true)
    // claimed before the async image read so Stop / New chat can flag this send at any point
    const generation = currentDocGeneration()
    const pending = { aborted: false }
    pendingSendRef.current = pending
    persistMessage('user', instruction, undefined, sentAtts, scope, skillUse.chips)
    // a rejected image read must not strand the run (busy would stay true forever): degrade to a no-image send
    void collectImageAttachments(sentAtts)
      .catch((): AgentImage[] => {
        setAttachNotice(t('aiImagesSendFailed'))
        window.setTimeout(() => setAttachNotice(null), 5000)
        return []
      })
      // a phased open still streaming its tail: the context must describe the whole document
      .then(async (images) => {
        await Promise.all([waitForFullContent(), refreshKbFiles()])
        // a newer send (after New chat) owns the panel now: leave its state alone
        if (pendingSendRef.current !== pending) return
        if (!pending.aborted && currentDocGeneration() === generation) {
          // the chosen project's context, read now and fixed for this request (spec 5.4)
          await projectRef.current?.prepareSend()
          if (pendingSendRef.current !== pending) return
        }
        pendingSendRef.current = null
        // the wait ended because another document replaced this one, or the
        // user stopped / reset the chat meanwhile: nothing to run
        if (pending.aborted || currentDocGeneration() !== generation) {
          setChat((prev) =>
            prev.filter(
              (m, i) => !(i === prev.length - 1 && m.role === 'assistant' && m.streaming),
            ),
          )
          setBusy(false)
          projectRef.current?.finishSend()
          return
        }
        // the skill text rides with this request only; the bubble and the record keep the chips
        return loop.run(instruction + skillUse.text, images)
      })
  }

  const cancel = () => {
    msgQueue.hold()
    if (pendingSendRef.current) pendingSendRef.current.aborted = true
    loopRef.current?.cancel()
  }

  /** submit every still-anchored queued edit as one batch run */
  const sendQueue = () => {
    const loop = loopRef.current
    if (!loop || loop.busy || editQueue.length === 0) return
    const entries = liveItems(resolveQueue(editorRef.current, editQueue))
    if (entries.length === 0) {
      onQueueClear?.()
      return
    }
    // nothing is consumed while no run can start
    if (!sendGate.admitQueued(() => {})) return
    const instruction = buildQueueInstruction(entries)
    const display = buildQueueSummary(t('aiQueueSubmitted', { count: entries.length }), entries)
    // consumed at send: the run rewrites the anchored passages, which would
    // orphan the anchors anyway; a failed run is retried via the retry action
    onQueueConsume?.(editQueue.map((item) => item.qid))
    runWith(instruction, display)
  }

  const retry = () =>
    runWith(
      lastInstructionRef.current,
      lastInstructionRef.current,
      lastAttachmentsRef.current,
      lastScopeRef.current ?? null,
      lastSkillUseRef.current,
    )

  const continueRun = () => runWith(DOCS_CONTINUE_INSTRUCTION, t('aiContinue'))

  /** "continue with ..." on a blocked run: that provider becomes the selection (the picker and
      the other windows follow the settings file's change event), then the request runs again */
  const continueWith = (provider: AiSubscriptionProviderId) =>
    sendGate.continueWith(provider, retry)

  /** Enter while a reply runs: the draft joins the queue above the composer */
  const enqueueDraft = () => {
    const text = input.trim()
    if (!text) return
    skills.withSkills(text, (skillUse) => enqueueWith(text, skillUse))
  }
  const enqueueWith = (text: string, skillUse: SkillUse) => {
    skillsRef.current.consume(skillUse)
    // snapshot + consume the composer attachments exactly like a send does: the
    // queued message owns them, and pump time hands them to runWith as an override
    const attachments = attachmentsRef.current
    if (attachments.length > 0) {
      const seen = new Set(sentAttachmentsRef.current.map((a) => a.path))
      sentAttachmentsRef.current = [
        ...sentAttachmentsRef.current,
        ...attachments.filter((a) => !seen.has(a.path)),
      ]
      setAttachments([])
    }
    msgQueue.enqueue(text, { attachments, scope: selectionScopeQuote() ?? null, skillUse })
    setInput('')
  }

  /** Today's "new chat": the screen, the loop and everything the conversation carried start over. */
  const resetConversation = () => {
    msgQueue.clear()
    if (pendingSendRef.current) {
      pendingSendRef.current.aborted = true
      pendingSendRef.current = null
    }
    abandonWriter()
    loopRef.current?.reset()
    // servers off in this chat and "always allow in this chat" go too (user MCP spec 7.6)
    windowMcpState()?.newConversation()
    sendGate.reset()
    setInputTruncated(false)
    setBusy(false)
    setChat([])
    // Restored history is painted above the live turn: without this the
    // previous conversation survives "New chat" on screen (#195).
    setHistoricChat([])
    skills.resetConversation()
    skillCards.reset()
    skillTemplates.reset()
    // Unsent composer attachments would otherwise ride into the next chat's
    // file context (availableAttachments merges sent + live). The typed
    // draft itself is kept — only staged files are dropped.
    setAttachments([])
    setAttachNotice(null)
    sentAttachmentsRef.current = []
    dropRunMarks()
  }

  /** "New chat": a new chat of the chosen project, or (no project) today's reset (spec 5.3.7) */
  const newChat = () => {
    resetConversation()
    if (projectRef.current?.chat.projectId) void projectRef.current.chat.newChat()
    inputRef.current?.focus()
  }

  /** A project chat, this document's earlier chat, or (no project) the document's own chat opened. */
  const openChat = (opened: ProjectChatOpened, initial = false) => {
    // a send made while the panel started (a request handed to this tab) keeps its chat
    if (
      initial &&
      (chatNowRef.current.length > 0 || loopRef.current?.busy || pendingSendRef.current)
    ) {
      return
    }
    resetConversation()
    if (opened.kind === 'document') {
      const ids = chatRefIds.current
      if (ids) loadDocumentChat(ids)
      return
    }
    showStoredChat(opened.entries)
  }

  const mergeAttachments = (result: AttachmentAddResult | null) => {
    if (!result) return
    if (result.accepted.length > 0) {
      setAttachments((prev) => {
        const seen = new Set(prev.map((a) => a.path))
        return [...prev, ...result.accepted.filter((a) => !seen.has(a.path))]
      })
    }
    if (result.rejected.length > 0) {
      setAttachNotice(result.rejected.join(';'))
      window.setTimeout(() => setAttachNotice(null), 5000)
    }
  }

  const pickAttachments = async () => mergeAttachments(await window.desktop.pickAttachments())

  /** Drive files the person ticked: attached like files from this PC, notes beside them */
  const attachFromDrive = async ({ paths, notes }: DriveAttachPicked) => {
    const added = paths.length > 0 ? await window.desktop.addAttachmentPaths(paths) : null
    mergeAttachments({
      accepted: added?.accepted ?? [],
      rejected: [...(added?.rejected ?? []), ...notes],
    })
  }

  /** The `@` document list in the input attaches through the same route as the buttons */
  const docMention: AiComposerDocs = {
    lang,
    ...docMentionActions({
      lang,
      add: (paths) => window.desktop.addAttachmentPaths(paths),
      merge: mergeAttachments,
    }),
    attachments,
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.desktop.getPathForFile(f))
      .filter(Boolean)
    if (paths.length > 0) mergeAttachments(await window.desktop.addAttachmentPaths(paths))
  }

  /** Files pasted into the input: ones with a local path go through regular attachments; pure bitmaps like screenshots hit a temp file first */
  const onPasteFiles = async (files: File[]) => {
    const paths: string[] = []
    for (const f of files) {
      const p = window.desktop.getPathForFile(f)
      if (p) {
        paths.push(p)
        continue
      }
      const ext = PASTE_MIME_EXT[f.type] ?? f.name.split('.').pop()?.toLowerCase() ?? 'bin'
      mergeAttachments(await window.desktop.addPastedImage(await f.arrayBuffer(), ext))
    }
    if (paths.length > 0) mergeAttachments(await window.desktop.addAttachmentPaths(paths))
  }

  const removeAttachment = (path: string) =>
    setAttachments((prev) => prev.filter((a) => a.path !== path))

  const acceptChanges = () => {
    applyRevisionsBy(editorRef.current, AI_REVISION_AUTHOR, 'accept')
    clearAiHighlights()
  }

  const toggleTrackChanges = () => {
    const next = !trackChanges
    setTrackChanges(next)
    localStorage.setItem(TRACK_CHANGES_KEY, next ? '1' : '0')
    // switching off keeps nothing pending: accept whatever is still highlighted
    if (!next) acceptChanges()
  }

  const rollback = (entryIdx: number, snapshot: ProseMirrorNode) => {
    restoreRollbackSnapshot(editor, snapshot)
    // the point is from before the run's first edit, so it carries no marks
    marksShownRef.current = false
    setMarksShown(false)
    // The document rewound to before this turn: this and every later run are taken
    // back, and their rollback points now describe discarded futures
    setChat((prev) => afterRollback(prev, entryIdx))
  }
  /** the newest run that changed the document: the marks on the page are its */
  const lastChangesIdx = chat.map((entry) => entry.changes !== undefined).lastIndexOf(true)

  const resizeCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => resizeCleanupRef.current?.(), [])

  /** Drag the inner panel edge to resize from the selected window side. */
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const resizer = e.currentTarget
    setResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: PointerEvent) => {
      const w = clampPanelWidth(aiPanelWidthAtPointer(ev.clientX))
      preferredWidthRef.current = w
      setPanelWidth(w)
    }
    let done = false
    const cleanup = () => {
      if (done) return
      done = true
      resizeCleanupRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      resizer.removeEventListener('lostpointercapture', cleanup)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setResizing(false)
      localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(preferredWidthRef.current)))
    }
    resizeCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
    // lostpointercapture also fires if the resizer is unmounted mid-drag (panel collapse)
    resizer.addEventListener('lostpointercapture', cleanup)
    resizer.setPointerCapture(e.pointerId)
  }

  // collapsed: rail only — after all hooks, so the instance and its state survive
  if (!open) {
    // the sidebar setting is off: nothing to show until an explicit AI action opens the panel
    if (hideRail) return null
    return (
      <button
        className="ai-rail"
        data-tip={t('appExpandAiPanel')}
        aria-label={t('appExpandAiPanel')}
        onClick={onExpand}
      >
        <AiMark size={22} />
      </button>
    )
  }

  return (
    <aside
      ref={asideRef}
      style={{ width: '100%' }}
      dir={isRtl ? 'rtl' : undefined}
      className={`ai-panel${dragOver ? ' ai-panel-dragover' : ''}${resizing ? ' ai-panel-resizing' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <div
        className="ai-panel-resizer"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label={aiSubscriptionText(lang, 'aiAssistant')}
      />
      <AiPanelHeader
        lang={lang}
        chatMenu={project.chatMenu}
        actions={
          <>
            <AiPanelSideButton
              lang={lang}
              onMove={(side) => window.desktop.setAiPanelPrefs({ side })}
            />
            {(chat.length > 0 || historicChat.length > 0) && (
              <button
                type="button"
                className="ai-header-btn"
                onClick={newChat}
                data-tip={t('aiNewChatTitle')}
                aria-label={t('aiNewChatTitle')}
              >
                <IconNewChat size={16} />
              </button>
            )}
            {onCollapse && (
              <button
                type="button"
                className="ai-header-btn ai-panel-collapse"
                onClick={onCollapse}
                data-tip={t('aiCollapseTitle')}
                aria-label={t('aiCollapseTitle')}
              >
                <IconSidebarCollapse size={15} />
              </button>
            )}
          </>
        }
      />

      <div ref={logRef} className="ai-chat" onScroll={onLogScroll}>
        {/* past conversation (read-only transcript, not fed to the model), shown continuously with the current turn */}
        {historicChat.length > 0 && (
          <>
            {historicChat.map((entry, i) => (
              <div key={`h${i}`} className={`ai-msg ai-msg-${entry.role} ai-msg-historic`}>
                {entry.role === 'user' && entry.scope && <AiScopeQuote scope={entry.scope} />}
                {entry.role === 'user' && (
                  <SentSkillChips
                    lang={lang}
                    chips={entry.skills}
                    isAvailable={skills.isAvailable}
                  />
                )}
                {entry.role === 'user' && entry.attachments && entry.attachments.length > 0 && (
                  <SentAttachments atts={entry.attachments} previews={attachmentPreviews} />
                )}
                {entry.tools && entry.tools.length > 0 && (
                  <AiWorkSteps lang={lang} steps={entry.tools} />
                )}
                <SkillUsedNotes tools={entry.tools} />
                {project.messageParts(entry)}
                {entry.skillProposals?.map((key) => skillCards.render(key))}
                {entry.text && (
                  <div dir="auto">
                    <Markdown text={entry.text} navs={chatNavs} />
                  </div>
                )}
              </div>
            ))}
            <div className="ai-history-sep">{t('aiHistorySep')}</div>
          </>
        )}
        {chat.length === 0 && historicChat.length === 0 && (
          <div className="ai-chat-empty">
            <div className="ai-chat-empty-badge" aria-hidden="true">
              <AiMark size={24} />
            </div>
            <div className="ai-chat-empty-title">
              {t(docEmpty ? 'aiEmptyDraftTitle' : 'aiEmptyTitle')}
            </div>
            <div className="ai-chat-empty-body">
              {t(docEmpty ? 'aiEmptyDraftBody1' : 'aiEmptyBody1')}
              <br />
              {t(docEmpty ? 'aiEmptyDraftBody2' : 'aiEmptyBody2')}
            </div>
            {/* the other editors honour "hide from AI"; this one sends the text as written (docs/security.md) */}
            <div className="ai-chat-empty-note">{t('aiNoHidingNote')}</div>
            <div className="ai-starter-list">
              {(docEmpty ? DRAFT_STARTER_PROMPTS : EDIT_STARTER_PROMPTS).map((p) => (
                <button
                  type="button"
                  key={p}
                  className="ai-starter"
                  onClick={() => {
                    setInput(t(p))
                    inputRef.current?.focus()
                  }}
                >
                  {t(p)}
                </button>
              ))}
            </div>
            <AiEmptyHints lang={lang} showSkill={Boolean(skills.composer)} showDocMention />
          </div>
        )}
        {chat.map((entry, i) => {
          if (
            entry.role === 'assistant' &&
            !entry.text &&
            !entry.streaming &&
            !entry.error &&
            !entry.tools?.length
          ) {
            return null
          }
          const isLast = i === chat.length - 1
          // a cause that means "this connection cannot go on" gets the blocked notice
          const blockedCause = isBlockedRunCause(entry.errorCause) ? entry.errorCause : undefined
          // Action row appears once per completed reply: on the turn's final segment only
          // (mid-turn segments have a following assistant entry; the live turn ends when !busy)
          const nextEntry = chat[i + 1]
          const turnEnded = nextEntry ? nextEntry.role === 'user' : !busy
          const showToolbar =
            entry.role === 'assistant' &&
            !entry.streaming &&
            turnEnded &&
            // an edits-only turn has no text to copy; the last one still offers the retry
            !!(entry.text || entry.error || (isLast && entry.changes))
          return (
            <div
              key={i}
              className={`ai-msg ai-msg-${entry.role}${entry.role === 'assistant' && entry.streaming ? ' ai-msg-streaming' : ''}`}
            >
              {entry.role === 'user' && entry.scope && <AiScopeQuote scope={entry.scope} />}
              {entry.role === 'user' && (
                <SentSkillChips lang={lang} chips={entry.skills} isAvailable={skills.isAvailable} />
              )}
              {entry.role === 'user' && entry.attachments && entry.attachments.length > 0 && (
                <SentAttachments atts={entry.attachments} previews={attachmentPreviews} />
              )}
              {entry.role === 'assistant' && entry.tools && entry.tools.length > 0 && (
                <AiWorkSteps lang={lang} steps={entry.tools} />
              )}
              {entry.role === 'assistant' ? (
                entry.text && (
                  <div dir="auto">
                    <Markdown text={entry.text} navs={chatNavs} />
                  </div>
                )
              ) : (
                <span dir="auto">{entry.text}</span>
              )}
              {entry.mindmap && (
                <MindMapCard
                  tree={entry.mindmap}
                  onAsk={(label) => {
                    setInput(t('aiMindMapAskPrompt', { label }))
                    inputRef.current?.focus()
                  }}
                  onJumpBlock={(index) => navigateToBlock(editorRef.current, index)}
                  onInsert={(svg, size) => {
                    const editor = editorRef.current
                    if (!editor || !entry.mindmap) return
                    void insertSvgAsPng(editor, svg, size, t('aiMindMapTitle'))
                  }}
                />
              )}
              <SkillUsedNotes tools={entry.tools} />
              {project.messageParts(entry)}
              {entry.skillProposals?.map((key) => skillCards.render(key))}
              {entry.error && !blockedCause && (
                <div className="ai-msg-error">{t('aiErrorPrefix', { error: entry.error })}</div>
              )}
              {blockedCause && (
                <AiBlockedNotice
                  kind={blockedCause.kind}
                  provider={blockedCause.provider}
                  resetsAt={blockedCause.resetsAt}
                  message={entry.error}
                  settings={liveSettings}
                  // only the run that just stopped can be continued on another connection
                  statuses={isLast && !busy ? subscription.statuses : {}}
                  lang={lang}
                  onContinueWith={continueWith}
                />
              )}
              {entry.changes && (
                <AiChangesCard
                  lang={lang}
                  state={runChangesState(entry.changes, entry.snapshot)}
                  count={entry.changes.count}
                  lines={entry.changes.lines}
                  onShowLine={(lineIdx) => {
                    const idx = entry.changes?.lines?.[lineIdx]?.blockIndex
                    if (idx !== undefined) navigateToBlock(editorRef.current, idx)
                  }}
                  canRevert={!busy}
                  revertsLater={hasLaterAppliedRun(chat, i)}
                  onRevert={() => {
                    if (entry.snapshot) rollback(i, entry.snapshot)
                  }}
                  // the marks are the newest run's: only its card clears them
                  onClearMarks={marksShown && i === lastChangesIdx ? clearMarks : null}
                />
              )}
              <AiReplyProgress reply={entry} thinking={t('aiThinking')} working={t('aiWorking')} />
              {entry.role === 'assistant' && (showToolbar || entry.usage) && (
                <AiReplyFooter
                  lang={lang}
                  isLast={isLast}
                  copyText={showToolbar && entry.text ? entry.text : undefined}
                  onRetry={
                    showToolbar && isLast && !busy && lastInstructionRef.current ? retry : undefined
                  }
                  usage={entry.usage}
                />
              )}
              {entry.turnLimit && isLast && !busy && (
                <button className="ai-continue-btn" onClick={continueRun}>
                  {t('aiContinue')}
                </button>
              )}
            </div>
          )
        })}
        {skillTemplates.notes}
        {/* an MCP tool waiting for the person's yes (user MCP spec 7.4) */}
        <McpPermissionCard lang={lang} />
      </div>

      <AiScrollToBottom
        lang={lang}
        visible={scrollBottom.showButton}
        onClick={() => {
          stickToBottomRef.current = true
          scrollBottom.scrollToBottom()
        }}
      />

      <div className="ai-composer">
        {sendGate.connectChoice && (
          <AiConnectPrompt
            choice={sendGate.connectChoice}
            statuses={subscription.statuses}
            lang={lang}
            disabled={subscription.busy}
            attention={sendGate.connectAttention}
            onOpenSettings={() => void window.desktop.openAiModelSettings().catch(() => {})}
            onInstall={subscription.install}
            onUpdate={subscription.update}
            onCancelLogin={subscription.cancelLogin}
            onLogin={subscription.login}
            onRecheck={subscription.recheck}
            onAcceptMetered={subscription.acceptMetered}
            onOpenInstallHelp={subscription.openInstallHelp}
            onOpenConnectHelp={subscription.openConnectHelp}
          />
        )}
        {sendGate.noticeDue && (
          <AiFirstConnectionNotice
            lang={lang}
            codexKeepsHistory
            onAcknowledge={sendGate.acknowledgeNotice}
          />
        )}
        {inputTruncated && (
          <AiInputTruncatedNotice lang={lang} onDismiss={() => setInputTruncated(false)} />
        )}
        {localModelCapabilities(liveSettings).tools === false && (
          <AiToolsUnsupportedNotice lang={lang} />
        )}
        {project.hint}
        {project.notices}
        {attachNotice && <div className="ai-attach-notice">{attachNotice}</div>}
        {activePartial && (
          <div className="ai-queue ai-partial-card" role="group" aria-label={t('aiPartialTitle')}>
            <div className="ai-queue-head">
              <span className="ai-queue-title">{t('aiPartialTitle')}</span>
            </div>
            <div className="ai-queue-hint">
              {t('aiPartialBody', { blocks: activePartial.blocks })}
            </div>
            <div className="ai-queue-foot">
              <button
                type="button"
                className="ai-queue-discard"
                onClick={() => decidePartial(false)}
              >
                {t('aiPartialDiscard')}
              </button>
              <button type="button" className="ai-queue-send" onClick={() => decidePartial(true)}>
                {t('aiPartialAdopt')}
              </button>
            </div>
          </div>
        )}
        <EditQueueCard
          items={editQueue}
          editor={editor}
          busy={busy}
          onEditInstruction={(qid, text) => onQueueEditInstruction?.(qid, text)}
          onRemove={(qid) => onQueueRemove?.(qid)}
          onDiscardAll={() => onQueueClear?.()}
          onSend={sendQueue}
          onFocus={(qid) => onQueueFocus?.(qid)}
        />
        {/* Above the input card, not inside its footer: the reset time is long and
            would otherwise squeeze the attach/send buttons in a narrow panel. */}
        <AiSubscriptionUsageLine usage={subscriptionUsage} lang={lang} />
        <AiComposer
          queueStrip={
            <AiQueueStrip
              items={msgQueue.queued}
              labels={AI_QUEUE_LABELS[lang]}
              onUpdate={msgQueue.update}
              onRemove={msgQueue.remove}
              onClear={msgQueue.clear}
              paused={msgQueue.paused}
              onTogglePause={msgQueue.togglePaused}
              onMove={msgQueue.move}
            />
          }
          onQueue={enqueueDraft}
          queuePlaceholder={AI_QUEUE_LABELS[lang].queuePlaceholder}
          header={
            (hasScopeSelection || attachments.length > 0) && (
              <>
                {hasScopeSelection && (
                  <div className="ai-scope-row">
                    <span className="ai-scope-hint">
                      <button
                        type="button"
                        className="ai-scope-label"
                        onClick={() => setScopePreviewOpen((v) => !v)}
                        aria-expanded={scopePreviewOpen}
                        data-tip={t('aiScopeSelectionTip')}
                      >
                        {t('aiScopeSelection', { words: countWords(selectionText) })}
                      </button>
                      <button
                        type="button"
                        className="ai-scope-clear"
                        onClick={clearScopeSelection}
                        data-tip={t('aiScopeClearTitle')}
                        aria-label={t('aiScopeClearTitle')}
                      >
                        <svg width="12" height="12" viewBox="0 0 32 32" aria-hidden>
                          <path
                            d="M24 9.4L22.6 8L16 14.6L9.4 8L8 9.4l6.6 6.6L8 22.6L9.4 24l6.6-6.6l6.6 6.6l1.4-1.4l-6.6-6.6L24 9.4z"
                            fill="currentColor"
                          />
                        </svg>
                      </button>
                    </span>
                    {scopePreviewOpen && (
                      <div className="ai-scope-preview">
                        {selectionText.length > 400
                          ? `${selectionText.slice(0, 400)}…`
                          : selectionText}
                      </div>
                    )}
                  </div>
                )}
                {attachments.length > 0 && (
                  <div className="ai-attachments" onScroll={onAttachmentsScroll}>
                    {attachments.map((a) =>
                      ATTACHMENT_IMAGE_EXTS.has(a.ext) ? (
                        <span key={a.path} className="ai-attachment-thumb" data-tip={a.path}>
                          {attachmentPreviews[a.path] ? (
                            <img src={attachmentPreviews[a.path]} alt={a.name} />
                          ) : (
                            <span className="ai-attachment-thumb-pending" aria-hidden>
                              <img src={fileImageIcon} alt="" />
                            </span>
                          )}
                          <button
                            className="ai-attachment-thumb-remove"
                            onClick={() => removeAttachment(a.path)}
                            data-tip={t('aiRemoveAttachmentTitle')}
                            aria-label={t('aiRemoveAttachmentTitle')}
                          >
                            <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden>
                              <path
                                d="M24 9.4L22.6 8L16 14.6L9.4 8L8 9.4l6.6 6.6L8 22.6L9.4 24l6.6-6.6l6.6 6.6l1.4-1.4l-6.6-6.6L24 9.4z"
                                fill="currentColor"
                                stroke="currentColor"
                                strokeWidth="0.25"
                              />
                            </svg>
                          </button>
                        </span>
                      ) : (
                        <span key={a.path} className="ai-attachment-card" data-tip={a.path}>
                          <span className="ai-attachment-card-icon">
                            <AttachmentCardIcon ext={a.ext} />
                          </span>
                          <span className="ai-attachment-card-meta">
                            <span className="ai-attachment-card-name">
                              {truncateCardName(a.name)}
                            </span>
                            <span className="ai-attachment-card-size">
                              {formatAttachmentSize(a.sizeBytes)}
                            </span>
                          </span>
                          <button
                            className="ai-attachment-thumb-remove"
                            onClick={() => removeAttachment(a.path)}
                            data-tip={t('aiRemoveAttachmentTitle')}
                            aria-label={t('aiRemoveAttachmentTitle')}
                          >
                            <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden>
                              <path
                                d="M24 9.4L22.6 8L16 14.6L9.4 8L8 9.4l6.6 6.6L8 22.6L9.4 24l6.6-6.6l6.6 6.6l1.4-1.4l-6.6-6.6L24 9.4z"
                                fill="currentColor"
                                stroke="currentColor"
                                strokeWidth="0.25"
                              />
                            </svg>
                          </button>
                        </span>
                      ),
                    )}
                  </div>
                )}
              </>
            )
          }
          value={input}
          busy={busy}
          placeholder={t('aiInputPlaceholder')}
          hintIdle={t('aiHintIdle')}
          hintBusy={t('aiHintBusy')}
          hintIdleTitle={t('aiHintIdleTitle')}
          sendLabel={t('aiSend')}
          stopLabel={t('aiStop')}
          iconOnly
          lang={lang}
          showSkillButton
          textareaRef={inputRef}
          onChange={setInput}
          onSend={run}
          onStop={cancel}
          skills={skills.composer}
          docs={docMention}
          onPasteFiles={(files) => void onPasteFiles(files)}
          footerBelow={project.picker}
          footerBelowEnd={sessionUsage && <AiUsageChip usage={sessionUsage} session lang={lang} />}
          footerStart={
            <>
              <AiAttachMenu
                lang={lang}
                onPickPc={() => void pickAttachments()}
                onPickedDocs={attachFromDrive}
                onPickedDrive={attachFromDrive}
              />
              <McpServerButton lang={lang} />
              <button
                type="button"
                className={`ai-track-btn${trackOn ? ' on' : ''}`}
                onClick={toggleTrackChanges}
                data-tip={trackOn ? t('aiTrackOnTitle') : t('aiTrackOffTitle')}
                {...odtOffProps(odtDoc)}
              >
                <span className="ai-track-dot" aria-hidden />
                {t('aiTrackChanges')}
              </button>
            </>
          }
          footerEnd={
            <AiModelPicker
              bridge={MODEL_BRIDGE}
              lang={lang}
              subscriptionStatuses={subscription.statuses}
              onRefreshSubscriptions={subscription.refresh}
            />
          }
        />
      </div>
    </aside>
  )
}
