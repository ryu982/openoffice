import {
  aiPanelWidthAtPointer,
  AiAttachMenu,
  AiPanelHeader,
  AiPanelSideButton,
  AiModelPicker,
  type AiModelPickerBridge,
  AiBlockedNotice,
  AiConnectPrompt,
  AiFirstConnectionNotice,
  AiInputTruncatedNotice,
  AiChangesCard,
  type AiChangeLine,
  type AiChangesState,
  AiMark,
  AiReplyFooter,
  AiScrollToBottom,
  AiToolsUnsupportedNotice,
  AiSubscriptionUsageLine,
  AiWorkSteps,
  IconArrowUp,
  IconStop,
  AiEmptyHints,
  aiSubscriptionText,
  useAiSendGate,
  useScrollToBottom,
  type DriveAttachPicked,
  McpPermissionCard,
  McpServerButton,
  useMcpWindow,
  NO_SKILL_USE,
  SentSkillChips,
  skillChipRefsOf,
  useComposerSkills,
  panelUserSkills,
  SkillUsedNotes,
  useSkillProposals,
  useSkillTemplates,
  type TemplateDocument,
  type SkillChipRef,
  type SkillUse,
  docMentionActions,
  type AiComposerDocs,
  consolidateProjectMemory,
  memoryLinesOf,
  panelProjectSkill,
  ProjectChatMenu,
  ProjectFolderHintLine,
  ProjectMemoryConsolidatedLine,
  ProjectMemoryEventLine,
  memoryLineGone,
  memoryRemoveOutcome,
  type ProjectMemoryRemoveOutcome,
  ProjectNoticeLine,
  ProjectNoticeList,
  ProjectPicker,
  ProjectToolSummaryLine,
  ProjectProblemLine,
  placeRemoteEntries,
  projectAddProblem,
  projectPrepareProblem,
  type ProjectProblem,
  undoProjectMemoryConsolidation,
  useProjectChat,
  type ProjectChatEntry,
  type ProjectChatOpened,
  type ProjectMemoryLine,
  type ProjectRunPrepared,
  useSubscriptionUsageUpdates,
} from '@genoffice/ui'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react'
import {
  AgentLoop,
  composeWithDrive,
  windowMcpState,
  windowMcpUsableServers,
  toolStepLabel,
} from '@genoffice/agent-core'
import type { AgentImage, IpcStreamError } from '@genoffice/agent-core'
import type {
  AddFolderResult,
  ChatMessage,
  CreateProjectResult,
  ProjectEditor,
  ProjectFolderApi,
  ProjectId,
  ProjectListItem,
  ProjectNotice,
  ProjectScreenSection,
} from '@genoffice/project-store'
import type {
  AiSettings,
  AiSubscriptionProviderId,
  AiSubscriptionUsage,
} from '@genoffice/ai-provider'
import { localModelCapabilities } from '@genoffice/ai-provider/browser'
import { ATTACHMENT_IMAGE_EXTS } from '../../shared/ipc'
import type { AttachmentAddResult, AttachmentMeta } from '../../shared/ipc'
import {
  AiComposer,
  AiQueueStrip,
  AI_QUEUE_LABELS,
  AiScopeQuote,
  AiReplyProgress,
  AiUsageChip,
  addTokenUsage,
  createFileNav,
  Markdown,
  useChatRunQueue,
  type AiScopeQuoteData,
  type AiTokenUsageView,
} from '@genoffice/ui'
import { aiLangDirective, t as tGlobal, useI18n } from '../i18n/locale'
import {
  clearRunningWait,
  markRunningWait,
  panelWaitOf,
  stepsWaitOf,
  WAIT_LABEL,
  type PanelWait,
} from './waiting'
import fileDocumentIcon from '../assets/file-document.png'
import fileExcelIcon from '../assets/file-excel.png'
import fileGeneralIcon from '../assets/file-general.png'
import fileImageIcon from '../assets/file-image.png'
import filePdfIcon from '../assets/file-pdf.png'
import filePptIcon from '../assets/file-ppt.png'
import fileWordIcon from '../assets/file-word.png'
import { createDocumentSkill } from './html-skill'
import { createFilesSkill } from './files-skill'
import { createIntentSkill, type PageIntent } from './intent'
import {
  buildPageWriterRequest,
  streamPage,
  type PageWriteResult,
  type PageWriteSpec,
} from './page-writer'
import {
  buildBriefWriterRequest,
  streamBrief,
  type BriefPlanSpec,
  type BriefPlanResult,
} from './brief-writer'
import type { BriefDecision, ClarifyQuestion, HtmlDocAccess } from './tools'
import type { Brief } from '../document/brief'
import { isDocEmpty } from '../document/blank'
import { ClarifyCard } from '../components/ClarifyCard'
import { BriefCard } from '../components/BriefCard'
import { createSearchSkill } from './search-skill'
import { pastedBase64Image } from './base64-paste'
import { createElectronTransport } from './transport'
import {
  blockedRunFor,
  blockedRunOf,
  mergeSubscriptionUsage,
  writerMayRetry,
  type BlockedRun,
} from './connection'
import { useSubscriptionConnection } from './subscription-client'
import { DOC_NAV_SCHEME, parseDocNavHref } from './doc-nav'
import { EditQueueCard } from './EditQueueCard'
import {
  buildQueueInstruction,
  buildQueueSummary,
  liveItems,
  resolveQueue,
  type EditQueueItem,
} from './edit-queue'
import { buildProjection } from './redact'
import { useGenerateHandoff } from './generate-handoff'

/** [chip label, composer prefill]: blank page → design something new; page with content → rework it */
const GENERATE_STARTERS = [
  ['aiStarterLanding', 'aiStarterLandingPrompt'],
  ['aiStarterReport', 'aiStarterReportPrompt'],
  ['aiStarterPoster', 'aiStarterPosterPrompt'],
  ['aiStarterWorkspace', 'aiStarterWorkspacePrompt'],
] as const
const WRITE_STARTERS = [
  ['aiStarterArticle', 'aiStarterArticlePrompt'],
  ['aiStarterAnnouncement', 'aiStarterAnnouncementPrompt'],
  ['aiStarterGuide', 'aiStarterGuidePrompt'],
] as const
const EDIT_STARTERS = [
  ['aiStarterExtractBrief', 'aiStarterExtractBriefPrompt'],
  ['aiStarterRecolor', 'aiStarterRecolorPrompt'],
  ['aiStarterUnify', 'aiStarterUnifyPrompt'],
] as const

/** clipboard bitmap MIME → attachment extension (matches ATTACHMENT_IMAGE_EXTS) */
const PASTE_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}
const ATTACHMENT_CARD_ICONS: Record<string, string> = Object.fromEntries(
  (
    [
      [fileWordIcon, ['doc', 'docx', 'odt']],
      [fileExcelIcon, ['xls', 'xlsx', 'xlsm', 'csv', 'tsv']],
      [filePptIcon, ['ppt', 'pptx']],
      [filePdfIcon, ['pdf']],
      [fileImageIcon, ['png', 'jpg', 'jpeg', 'gif', 'webp']],
    ] as [string, string[]][]
  ).flatMap(([icon, exts]) => exts.map((ext) => [ext, icon])),
)
const MAX_IMAGES_PER_MESSAGE = 20

function formatAttachmentSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(2)} KB`
}

/** composer chips (removable) and the read-only echo on a sent message share one renderer */
function AttachmentList({
  atts,
  previews,
  onRemove,
  removeLabel,
}: {
  atts: AttachmentMeta[]
  previews: Record<string, string>
  onRemove?: (path: string) => void
  removeLabel?: string
}) {
  const remove = (path: string) =>
    onRemove && (
      <button
        type="button"
        className="ai-attachment-thumb-remove"
        onClick={() => onRemove(path)}
        data-tip={removeLabel}
        aria-label={removeLabel}
      >
        <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden>
          <path
            d="M24 9.4L22.6 8L16 14.6L9.4 8L8 9.4l6.6 6.6L8 22.6L9.4 24l6.6-6.6l6.6 6.6l1.4-1.4l-6.6-6.6L24 9.4z"
            fill="currentColor"
          />
        </svg>
      </button>
    )
  return (
    <>
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
            {remove(a.path)}
          </span>
        ) : (
          <span key={a.path} className="ai-attachment-card" title={a.path}>
            <span className="ai-attachment-card-icon">
              <img
                src={ATTACHMENT_CARD_ICONS[a.ext] ?? fileDocumentIcon ?? fileGeneralIcon}
                alt=""
                aria-hidden
              />
            </span>
            <span className="ai-attachment-card-meta">
              <span className="ai-attachment-card-name">{a.name}</span>
              <span className="ai-attachment-card-size">{formatAttachmentSize(a.sizeBytes)}</span>
            </span>
            {remove(a.path)}
          </span>
        ),
      )}
    </>
  )
}

/** The project folder bridge (decision 0088), or null outside the shell or with an older preload */
function folderApi(): ProjectFolderApi | null {
  return window.projectFolderApi ?? null
}

/** The file name at the end of a folder-relative path */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/** Stored attachment records as chips (a record without a path is not shown) */
function storedAttachments(list: ChatMessage['attachments']): AttachmentMeta[] | undefined {
  const shown = list
    ?.filter((a) => a.path)
    .map((a) => ({
      name: a.name,
      path: a.path ?? '',
      ext: a.ext ?? '',
      sizeBytes: a.sizeBytes ?? 0,
    }))
  return shown && shown.length > 0 ? shown : undefined
}

const PANEL_WIDTH_KEY = 'html-ai-panel-width'
const PANEL_WIDTH_DEFAULT = 360
const PANEL_WIDTH_MIN = 280
const MAX_SNAPSHOTS = 20
const TOOL_OUTPUT_MAX_CHARS = 2000

function clampPanelWidth(w: number): number {
  // The viewport can be transiently tiny (a WebContentsView is 0×0 until the
  // shell lays it out), so never let the ceiling drop below the minimum
  const max = Math.max(PANEL_WIDTH_MIN, Math.min(720, Math.round(window.innerWidth * 0.6)))
  return Math.min(Math.max(w, PANEL_WIDTH_MIN), max)
}

function loadPanelWidth(): number {
  const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY))
  // static bounds only — clamping against the window here would bake a
  // transiently small viewport into the restored preference
  return Number.isFinite(saved) && saved > 0
    ? Math.min(Math.max(saved, PANEL_WIDTH_MIN), 720)
    : PANEL_WIDTH_DEFAULT
}

interface ToolActivity {
  name: string
  summary: string
  /** still executing: rendered as a spinner chip, replaced in place when the tool finishes */
  running?: boolean
  /** the running tool holds the run on a docked card: the row and the group title say whose turn it is */
  waiting?: PanelWait
  isError?: boolean
  output?: string
}

interface ChatEntry {
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean
  isError?: boolean
  /** the run stopped because its connection cannot go on: rendered as the blocked notice */
  blocked?: BlockedRun
  /** the run failed and this user message was rolled back out of the model context */
  undelivered?: boolean
  /** instruction actually sent when it differs from the bubble text (sid-pinned Ask AI / queue batch); retries resend this */
  instruction?: string
  /** the bubble was a queue batch: retry must hide the live selection again */
  queueRun?: boolean
  /** attachments consumed from the composer by this message (echoed read-only; retries resend them) */
  attachments?: AttachmentMeta[]
  tools?: ToolActivity[]
  /** the element this user message targeted, frozen at send */
  scope?: AiScopeQuoteData
  /** skill chips this user message carried */
  skills?: SkillChipRef[]
  /** skill cards the model proposed in this turn (keys of useSkillProposals) */
  skillProposals?: string[]
  /** the skill text this message's request carried (live only): a retry resends it */
  skillText?: string
  /** tokens the provider billed for this reply, summed across its turns (absent when unreported) */
  usage?: AiTokenUsageView
  /** a project chat's memory lines for this reply (absent: read from the live tool records) */
  memory?: ProjectMemoryLine[]
  /** a project chat's reply whose tools another editor ran: shown as one line */
  otherEditorTools?: { editor: ProjectEditor; fileRef?: string; count: number }
  /** the run this reply ends changed the document (session-only, not persisted) */
  changes?: RunChanges
}

interface HtmlChangeLine extends AiChangeLine {
  sid?: number
}

const MAX_HTML_CHANGE_LINES = 24

function clipHtmlText(text: unknown, max = 56): string {
  if (typeof text !== 'string') return ''
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact
}

function htmlChangeLinesFromTool(
  name: string,
  input: Record<string, unknown>,
  summary: string,
): HtmlChangeLine[] {
  if (name === 'apply_ops' && Array.isArray(input.ops)) {
    const out: HtmlChangeLine[] = []
    for (const raw of input.ops) {
      if (!raw || typeof raw !== 'object') continue
      const op = raw as Record<string, unknown>
      const kind = typeof op.op === 'string' ? op.op : ''
      const sid = typeof op.sid === 'number' ? op.sid : undefined
      if (kind === 'set_text') {
        out.push({
          kind: 'replace',
          from: sid !== undefined ? `#${sid}` : undefined,
          to: clipHtmlText(op.text),
          showable: sid !== undefined,
          sid,
        })
      } else if (kind.startsWith('insert') || kind === 'append' || kind === 'prepend') {
        out.push({
          kind: 'insert',
          to: clipHtmlText(op.html ?? op.text ?? kind),
          showable: sid !== undefined,
          sid,
        })
      } else if (kind === 'remove' || kind === 'delete') {
        out.push({
          kind: 'delete',
          from: sid !== undefined ? `#${sid}` : kind,
          showable: false,
        })
      } else if (kind) {
        out.push({
          kind: 'named',
          from: sid !== undefined ? `#${sid}` : undefined,
          to: clipHtmlText(op.text ?? op.value ?? op.html ?? kind),
          showable: sid !== undefined,
          sid,
        })
      }
    }
    return out
  }
  return [{ kind: 'named', to: clipHtmlText(summary || name), showable: false }]
}

/**
 * What one run changed, on its last reply. The run is taken back by restoring
 * the source from before its first change, which also takes back every later
 * run (and anything edited since), so those cards turn 'reverted' too.
 */
interface RunChanges {
  /** the snapshot it restores (ids grow with each run) */
  id: number
  state: AiChangesState
  /** page elements the run marked, when that is every place it changed */
  count?: number
  /** detailed per-edit lines for the diff card */
  lines?: HtmlChangeLine[]
}

/** A project chat's message as this panel shows it */
function chatEntryOf(entry: ProjectChatEntry & { skillProposals?: string[] }): ChatEntry {
  const skills = entry.role === 'user' ? skillChipRefsOf(entry.skills) : []
  const attachments = storedAttachments(entry.attachments)
  return {
    role: entry.role,
    text: entry.text,
    ...(entry.tools && entry.tools.length > 0
      ? {
          tools: entry.tools.map((tool) => ({
            name: tool.name,
            summary: tool.summary,
            isError: tool.isError,
            output: tool.output ? tool.output.slice(0, TOOL_OUTPUT_MAX_CHARS) : undefined,
          })),
        }
      : {}),
    ...(attachments ? { attachments } : {}),
    ...(entry.scope ? { scope: entry.scope } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(entry.skillProposals ? { skillProposals: entry.skillProposals } : {}),
    ...(entry.otherEditorTools ? { otherEditorTools: entry.otherEditorTools } : {}),
    memory: entry.memory,
  }
}

/** the whole source text: one string is the exact rollback unit */
export interface DocSnapshot {
  text: string
}

interface Snapshot {
  id: number
  doc: DocSnapshot
}

/** Preset instruction (ribbon / Ask AI "send now"); a new nonce triggers one auto-send */
export interface AiPreset {
  text: string
  nonce: number
  /** what the chat bubble shows when the instruction itself carries protocol text */
  displayText?: string
  scope?: AiScopeQuoteData
}

/** Prefill the composer without sending (Ask AI about the selected element) */
export interface AiDraft {
  text: string
  nonce: number
}

export interface HtmlAiDeps {
  /** live document access for the skill's tools */
  access: HtmlDocAccess
  getSnapshot(): DocSnapshot
  restoreSnapshot(snapshot: DocSnapshot): void
  /** the user sent a request (the text as shown in the bubble); names an untitled document */
  onPrompt(text: string): void
  /** fired when a run with at least one mutation finishes (auto-save hook) */
  onRunDone(mutated: boolean): void
  /** takes the marks of the AI's changes off the source pane and the preview */
  clearHighlights(): void
  /** the page elements the marks sit on now, when they show every change since the last clear */
  changedPlaces?(): number | undefined
  /** [label](htmlnav://sid/N) citation clicked */
  navigateTo(sid: number): void
  /** the user confirmed a brief on the card; the app pins it into the next generated document */
  onBriefConfirmed(brief: Brief): void
  /** page the AI is still writing (null when done): mirrored over the preview */
  previewDraft(html: string | null): void
}

/** how often the streaming draft is pushed into the preview mirror */
const DRAFT_PREVIEW_MS = 400

const MODEL_BRIDGE: AiModelPickerBridge = {
  getSettings: () => window.htmlApi.getAiSettings(),
  setSettings: (settings) => window.htmlApi.setAiSettings(settings),
  onSettingsChanged: (handler) => window.htmlApi.onAiSettingsChanged(handler),
  openModelSettings: () => window.htmlApi.openAiModelSettings().catch(() => {}),
}

export function AiPanel({
  deps,
  filePath,
  preset,
  draft,
  editQueue,
  onQueueEditInstruction,
  onQueueRemove,
  onQueueClear,
  onQueueFocus,
  onQueueConsume,
  onCollapse,
  onGenerateHandoff,
  templateDocument,
  onSkillHandoff,
  marksShown = false,
}: {
  deps: HtmlAiDeps
  filePath: string | null
  preset?: AiPreset | null
  draft?: AiDraft | null
  editQueue: EditQueueItem[]
  onQueueEditInstruction: (qid: string, instruction: string) => void
  onQueueRemove: (qid: string) => void
  onQueueClear: () => void
  onQueueFocus: (qid: string) => void
  onQueueConsume: (qids: string[]) => void
  onCollapse: () => void
  /** this new tab took a request handed over by "make" (8.5) */
  onGenerateHandoff?: () => void
  /** the document while it can go along as a skill's template (spec 5.7) */
  templateDocument?: TemplateDocument | null
  /** this tab took a request handed over by the template flow: show the panel */
  onSkillHandoff?: () => void
  /** the marks of the last run's changes are on the page */
  marksShown?: boolean
}): ReactElement {
  const { lang, t } = useI18n()
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  /** Claude / Codex connection: live statuses and the connect-card actions */
  const subscription = useSubscriptionConnection()
  /** the shared AI settings as last read; null until the first read answered */
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  useEffect(() => {
    let alive = true
    const refresh = () => {
      void window.htmlApi
        .getAiSettings()
        .then((next) => {
          if (alive) setAiSettings(next)
        })
        .catch(() => {
          /* no settings bridge: the gate keeps waiting for the settings */
        })
    }
    refresh()
    const off = window.htmlApi.onAiSettingsChanged(refresh)
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      off()
      window.removeEventListener('focus', refresh)
    }
  }, [])
  /** The send gate every editor shares: holds a request made during a status check or in front
      of the first-connection notice, refuses in front of "not connected", and writes this
      panel's settings changes ("continue with …", the acknowledged notice) onto the stored ones.
      An acknowledgement holds for this panel even when it could not be saved, so the notice
      never locks the composer. */
  const sendGate = useAiSendGate<{
    text: string
    displayText: string | undefined
    queueRun: boolean
    attachments: AttachmentMeta[] | undefined
    scope: AiScopeQuoteData | undefined
    skillUse: SkillUse
  }>({
    settings: aiSettings,
    statuses: subscription.statuses,
    store: MODEL_BRIDGE,
    start: (held) => {
      send(held.text, held.displayText, held.queueRun, held.attachments, held.scope, held.skillUse)
    },
    onSettingsSaved: setAiSettings,
  })
  const sendGateRef = useRef(sendGate)
  sendGateRef.current = sendGate
  /** rate-limit windows the subscription program reported (latest per window) */
  const [subscriptionUsage, setSubscriptionUsage] = useState<AiSubscriptionUsage[]>([])
  // usage a picture request reported reaches every window (the chat stream only its own)
  useSubscriptionUsageUpdates(
    () => window.htmlApi?.subscription,
    setSubscriptionUsage,
    mergeSubscriptionUsage,
  )
  /** the last turn's input was cut to fit a limit; shown until dismissed */
  const [inputTruncated, setInputTruncated] = useState(false)
  /** structured cause of the last failed stream (chat turn or page/brief writer) */
  const lastStreamErrorRef = useRef<IpcStreamError | null>(null)
  /** set when a writer stopped the run on a blocked connection: onDone renders the notice instead of "Stopped" */
  const blockedStopRef = useRef<BlockedRun | null>(null)
  /** messages queued while a reply runs; the pump re-runs them through send on settle */
  const msgQueue = useChatRunQueue<{ atts: AttachmentMeta[]; skillUse: SkillUse }>({
    busy,
    submit: (text, meta) => {
      const loop = loopRef.current
      if (!loop || loop.busy) return false
      // a queued message waits instead of being refused and dropped; in front of "not
      // connected" the queue is paused so it does not start by itself after a sign-in
      if (!sendGateRef.current.admitQueued(() => msgQueueRef.current.setPaused(true))) return false
      return send(text, text, false, meta.atts, undefined, meta.skillUse)
    },
  })
  const msgQueueRef = useRef(msgQueue)
  msgQueueRef.current = msgQueue
  /** this window's MCP servers (user MCP spec 7.5); the chips name the ones not usable now */
  const mcpWindow = useMcpWindow()
  /** the skills called with `/` or `$`: the list, the chips and the text a request gets */
  const skills = useComposerSkills({
    lang,
    editor: 'html',
    usableMcpServers: mcpWindow.state?.usableServers(),
    // a chip whose skill has a template runs in a new tab (spec 5.7)
    onTemplateSkill: (request) => skillTemplatesRef.current.onTemplateSkill(request),
  })
  const skillsRef = useRef(skills)
  skillsRef.current = skills
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
    editor: 'html',
    cards: skillCards,
    busy,
    send: (text, use) => send(text, undefined, false, undefined, undefined, use),
    // a template skill called in a page with content asks where to run
    hasContent: () => !isDocEmpty(deps.access.getText()),
    // a template copy that brought the asking document: it goes in as an attachment
    attach: async (paths) => {
      const added = (await window.htmlApi.addAttachmentPaths(paths)) ?? null
      mergeAttachments(added)
      return (added?.accepted.length ?? 0) > 0
    },
    onTaken: onSkillHandoff,
    setComposer: setPrompt,
  })
  const skillTemplatesRef = useRef(skillTemplates)
  skillTemplatesRef.current = skillTemplates
  /**
   * Project folders (spec 5): the project chosen under the input, its chat and
   * where messages are recorded. With no project chosen (or no bridge) the
   * panel keeps its per-document chat exactly as before.
   */
  const projectChat = useProjectChat({
    editor: 'html',
    loop: () => loopRef.current,
    onOpen: (opened) => openProjectChat(opened),
    onRemoteMessage: (entry) => showRemoteMessage(entry),
  })
  const projectChatRef = useRef(projectChat)
  projectChatRef.current = projectChat
  /** a project (or earlier document) chat is on screen: the per-document history stays away */
  const projectShownRef = useRef(false)
  /** the project lists of the picker */
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [defaultParentFolder, setDefaultParentFolder] = useState<string | undefined>(undefined)
  /** the notices the last send's project context brought (spec 5.4, 5.10) */
  const [projectNotices, setProjectNotices] = useState<ProjectNotice[]>([])
  /** "Memory tidied up (N → M) [Undo]" after the person ran [Tidy up] */
  const [consolidated, setConsolidated] = useState<{
    projectId: ProjectId
    before: number
    after: number
    backupName: string
  } | null>(null)
  const consolidatingRef = useRef(false)
  /** memory entries the person removed with [Remove] in this panel */
  const [forgotten, setForgotten] = useState<ReadonlySet<string>>(() => new Set())
  /** what the person asked for that did not happen, or a send that went without the project */
  const [projectProblem, setProjectProblem] = useState<ProjectProblem | null>(null)
  /** a reply runs (set at once by `send`, before the state renders) */
  const busyRef = useRef(busy)
  busyRef.current = busy
  /** the snapshots the change cards restore, oldest first; a card whose snapshot was pushed out is 'expired' */
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const nextSnapshotIdRef = useRef(1)
  /** taken before the in-flight run's first change; becomes its card's snapshot when the run ends */
  const runSnapshotRef = useRef<DocSnapshot | null>(null)
  /** questionnaire / brief cards docked in the composer slot while a tool waits for the user */
  const [activeClarify, setActiveClarify] = useState<ClarifyQuestion[] | null>(null)
  const clarifyResolverRef = useRef<((r: { answers: string; cancelled?: boolean }) => void) | null>(
    null,
  )
  const [activeBrief, setActiveBrief] = useState<Brief | null>(null)
  const briefResolverRef = useRef<((d: BriefDecision) => void) | null>(null)
  /** the page writer stopped early: keep-or-discard card for what arrived */
  const [activePartial, setActivePartial] = useState<{ lines: number } | null>(null)
  const partialResolverRef = useRef<((keep: boolean) => void) | null>(null)
  /** answered receipts rendered after the user message they belong to (view-only, not chat data) */
  const [receipts, setReceipts] = useState<
    Array<{ afterIdx: number; qa?: Array<{ q: string; a: string }>; brief?: Brief }>
  >([])
  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickToBottomRef = useRef(true)
  const {
    showButton: showScrollBottom,
    onScroll: onScrollBottom,
    scrollToBottom,
  } = useScrollToBottom(chatRef)
  const [intent, setIntent] = useState<PageIntent>('design')
  const intentRef = useRef(intent)
  intentRef.current = intent
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([])
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  const sendSeqRef = useRef(0)
  const [attachNotice, setAttachNotice] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  /** data-URL previews for image attachments, keyed by path */
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<string, string>>({})
  const previewRequestedRef = useRef(new Set<string>())
  /** attachments consumed by earlier sends: the files skill keeps reading them in follow-up turns */
  const sentAttachmentsRef = useRef<AttachmentMeta[]>([])
  useEffect(() => {
    const wanted = [...attachments, ...chat.flatMap((e) => e.attachments ?? [])]
    const alive = new Set(wanted.map((a) => a.path))
    setAttachmentPreviews((prev) => {
      const stale = Object.keys(prev).filter((path) => !alive.has(path))
      if (stale.length === 0) return prev
      const next = { ...prev }
      for (const path of stale) delete next[path]
      return next
    })
    for (const path of previewRequestedRef.current) {
      if (!alive.has(path)) previewRequestedRef.current.delete(path)
    }
    for (const a of wanted) {
      if (!ATTACHMENT_IMAGE_EXTS.has(a.ext) || previewRequestedRef.current.has(a.path)) continue
      previewRequestedRef.current.add(a.path)
      void window.htmlApi
        .readAttachmentImage(a.path)
        .then((r) => {
          if (!previewRequestedRef.current.has(a.path)) return
          if (r.ok && r.base64 && r.mime) {
            setAttachmentPreviews((prev) => ({
              ...prev,
              [a.path]: `data:${r.mime};base64,${r.base64}`,
            }))
          }
        })
        .catch(() => previewRequestedRef.current.delete(a.path))
    }
  }, [attachments, chat])
  const availableAttachments = (): AttachmentMeta[] => {
    const seen = new Set<string>()
    return [...sentAttachmentsRef.current, ...attachmentsRef.current].filter((a) => {
      if (seen.has(a.path)) return false
      seen.add(a.path)
      return true
    })
  }
  const showAttachNotice = (lines: string[]) => {
    if (lines.length === 0) return
    setAttachNotice(lines.join('; '))
    window.setTimeout(() => setAttachNotice(null), 5000)
  }
  const mergeAttachments = (result: AttachmentAddResult | null) => {
    if (!result) return
    if (result.accepted.length > 0) {
      setAttachments((prev) => {
        const seen = new Set(prev.map((a) => a.path))
        return [...prev, ...result.accepted.filter((a) => !seen.has(a.path))]
      })
    }
    showAttachNotice(result.rejected)
  }
  const pickAttachments = async () => mergeAttachments(await window.htmlApi.pickAttachments())
  /** Drive files the person ticked: attached like files from this PC, notes beside them */
  const attachFromDrive = async ({ paths, notes }: DriveAttachPicked) => {
    const added = paths.length > 0 ? await window.htmlApi.addAttachmentPaths(paths) : null
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
      add: async (paths) => (await window.htmlApi.addAttachmentPaths(paths)) ?? null,
      merge: mergeAttachments,
    }),
    attachments,
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.htmlApi.getPathForFile(f))
      .filter(Boolean)
    if (paths.length > 0) mergeAttachments(await window.htmlApi.addAttachmentPaths(paths))
  }
  /** pasted files with a local path go through the regular route; pure bitmaps (screenshots) hit a temp file first */
  const onPasteFiles = async (files: File[]) => {
    const paths: string[] = []
    for (const f of files) {
      const path = window.htmlApi.getPathForFile(f)
      if (path) {
        paths.push(path)
        continue
      }
      const ext = PASTE_MIME_EXT[f.type] ?? f.name.split('.').pop()?.toLowerCase() ?? 'bin'
      mergeAttachments(await window.htmlApi.addPastedImage(await f.arrayBuffer(), ext))
    }
    if (paths.length > 0) mergeAttachments(await window.htmlApi.addAttachmentPaths(paths))
  }
  /** a pasted base64 image (data: URL or a bare base64 dump) becomes a real attachment, not chat text */
  const onPasteText = (text: string): boolean => {
    const img = pastedBase64Image(text)
    if (!img) return false
    void window.htmlApi
      .addPastedImage(img.bytes.buffer as ArrayBuffer, img.ext)
      .then(mergeAttachments)
    return true
  }
  const removeAttachment = (path: string) =>
    setAttachments((prev) => prev.filter((a) => a.path !== path))
  /** image attachments ride along as multimodal input (≤5MB each, capped per message) */
  const collectImages = async (atts: AttachmentMeta[]): Promise<AgentImage[]> => {
    const imageAtts = atts.filter((a) => ATTACHMENT_IMAGE_EXTS.has(a.ext))
    const images: AgentImage[] = []
    const failures: string[] = []
    for (const att of imageAtts.slice(0, MAX_IMAGES_PER_MESSAGE)) {
      const result = await window.htmlApi.readAttachmentImage(att.path)
      if (result.ok && result.base64 && result.mime) {
        images.push({ base64: result.base64, mime: result.mime })
      } else {
        failures.push(result.error ?? t('aiImageReadFail', { name: att.name }))
      }
    }
    if (imageAtts.length > MAX_IMAGES_PER_MESSAGE) {
      failures.push(t('aiTooManyImages', { max: MAX_IMAGES_PER_MESSAGE }))
    }
    showAttachNotice(failures)
    return images
  }
  /** apply_ops `attachment://` references: land in the document's assets/ like a manually placed picture, or inline when that is not possible */
  const resolveAttachmentSrc = async (
    ref: string,
  ): Promise<{ ok: true; src: string } | { ok: false; error: string }> => {
    const name = ref.trim()
    const atts = availableAttachments()
    const att =
      atts.find((a) => a.name === name) ??
      atts.find((a) => a.name.toLowerCase() === name.toLowerCase())
    if (!att) {
      const names = atts.map((a) => a.name).join(', ') || '(none)'
      return { ok: false, error: `no attachment named "${name}"; attached files: ${names}` }
    }
    if (!ATTACHMENT_IMAGE_EXTS.has(att.ext)) {
      return {
        ok: false,
        error: `${att.name} is not an image attachment (png/jpg/gif/webp); ask the user to attach the image file itself`,
      }
    }
    const img = await window.htmlApi.readAttachmentImage(att.path)
    if (!img.ok || !img.base64 || !img.mime) {
      return { ok: false, error: img.error ?? `could not read ${att.name}` }
    }
    // saveImage keeps webp out (assets must stay DOCX-exportable) and returns null for an unsaved document
    const ext = att.ext === 'jpeg' ? 'jpg' : att.ext
    const rel = ext === 'webp' ? null : await window.htmlApi.saveImage({ base64: img.base64, ext })
    return { ok: true, src: rel ?? `data:${img.mime};base64,${img.base64}` }
  }
  // preferred = the user's chosen width (the only value persisted); panelWidth =
  // what fits the current window. Deriving the display width from the preference
  // means a transiently small window never permanently shrinks the panel.
  const preferredWidthRef = useRef(loadPanelWidth())
  const [panelWidth, setPanelWidth] = useState(() => clampPanelWidth(preferredWidthRef.current))
  const [resizing, setResizing] = useState(false)
  const asideRef = useRef<HTMLElement>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    const dock = asideRef.current?.closest('.ai-dock') as HTMLElement | null
    dock?.style.setProperty('--ai-panel-width', `${panelWidth}px`)
  }, [panelWidth])

  const settingsRef = useRef<AiSettings | null>(null)
  /** whether generate_image can run, as the main process answers (refreshed on mount and window focus) */
  const imageGenAvailableRef = useRef(false)
  useEffect(() => {
    let alive = true
    const refresh = () => {
      // tests render the panel without a full preload bridge: a missing call must not take it down
      Promise.resolve()
        .then(() => window.htmlApi.aiToolCapabilities())
        .then((capabilities) => {
          if (alive)
            imageGenAvailableRef.current = capabilities?.imageGeneration?.available === true
        })
        .catch(() => {
          if (alive) imageGenAvailableRef.current = false
        })
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      window.removeEventListener('focus', refresh)
    }
  }, [])
  const langRef = useRef(lang)
  langRef.current = lang
  const depsRef = useRef(deps)
  depsRef.current = deps
  const filePathRef = useRef(filePath)
  /** instruction of the in-flight run, labels its rollback snapshot */
  const runInstructionRef = useRef('')
  /** a queue batch names its own targets: the live selection is hidden from the model while it runs */
  const queueRunRef = useRef(false)
  /** whether the last started run was a queue batch (survives onDone/onError for the header retry) */
  const lastQueueRunRef = useRef(false)
  /** what the user saw for that instruction (queue submissions show a summary) */
  const runDisplayRef = useRef('')
  /** the scope quote of the last send, carried over by the header retry */
  const lastScopeRef = useRef<AiScopeQuoteData | undefined>(undefined)
  /** the skills of the last send: a retry sends the same skill text */
  const lastSkillUseRef = useRef<SkillUse>(NO_SKILL_USE)
  const runMutatedRef = useRef(false)
  const runChangeLinesRef = useRef<HtmlChangeLine[]>([])
  /** tool activity of the whole run, for transcript persistence */
  const runToolsRef = useRef<ToolActivity[]>([])
  /** tokens billed so far in the in-flight run (summed across turns) */
  const runUsageRef = useRef<AiTokenUsageView | undefined>(undefined)
  /** tokens billed across the panel's session (the composer chip) */
  const [sessionUsage, setSessionUsage] = useState<AiTokenUsageView | undefined>(undefined)
  const chatIdsRef = useRef<{ projectId: string; chatId: string } | null>(null)
  /** messages sent before resolveChat returned, flushed once the chat id is known */
  const pendingPersistRef = useRef<
    Array<{
      role: 'user' | 'assistant'
      text: string
      tools?: ToolActivity[]
      attachments?: AttachmentMeta[]
      scope?: AiScopeQuoteData
      skillChips?: SkillChipRef[]
    }>
  >([])

  const patchLast = (patch: Partial<ChatEntry> | ((last: ChatEntry) => Partial<ChatEntry>)) => {
    setChat((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (!last || last.role !== 'assistant') return prev
      next[next.length - 1] = { ...last, ...(typeof patch === 'function' ? patch(last) : patch) }
      return next
    })
  }

  const persistMessage = (
    role: 'user' | 'assistant',
    text: string,
    tools?: ToolActivity[],
    attachments?: AttachmentMeta[],
    scope?: AiScopeQuoteData,
    skillChips?: SkillChipRef[],
  ) => {
    // a project chat records the message in the project folder (spec 5.3)
    if (
      projectChatRef.current.persist({
        role,
        text,
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        ...(scope ? { scope } : {}),
        ...(skillChips && skillChips.length > 0 ? { skills: skillChips } : {}),
      })
    )
      return
    persistDocumentMessage(role, text, tools, attachments, scope, skillChips)
  }

  /** the per-document chat store, as before project folders */
  const persistDocumentMessage = (
    role: 'user' | 'assistant',
    text: string,
    tools?: ToolActivity[],
    attachments?: AttachmentMeta[],
    scope?: AiScopeQuoteData,
    skillChips?: SkillChipRef[],
  ) => {
    const ids = chatIdsRef.current
    if (!window.projectApi) return
    if (!ids) {
      pendingPersistRef.current.push({ role, text, tools, attachments, scope, skillChips })
      return
    }
    void window.projectApi
      .appendChat({
        projectId: ids.projectId,
        chatId: ids.chatId,
        role,
        text,
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        ...(scope ? { scope } : {}),
        ...(skillChips && skillChips.length > 0 ? { skills: skillChips } : {}),
      })
      .catch(() => {
        /* persistence failures are silent */
      })
  }

  // The loop is built once; every mutable value goes through a ref getter
  const transportRef = useRef<ReturnType<typeof createElectronTransport> | null>(null)
  if (!transportRef.current) {
    transportRef.current = createElectronTransport(() => settingsRef.current!, {
      getLang: () => langRef.current,
      onStreamError: (error) => {
        lastStreamErrorRef.current = error
      },
      onSubscriptionUsage: (usage) =>
        setSubscriptionUsage((prev) => mergeSubscriptionUsage(prev, usage)),
      onInputTruncated: () => setInputTruncated(true),
    })
  }

  /**
   * A writer that got nothing because its connection is blocked (limit used up,
   * signed out, nothing connected) ends the run right there, with the same
   * notice a blocked chat turn gets, instead of handing the model a failure to
   * paraphrase on a connection that cannot answer.
   */
  const stopRunIfBlocked = (): void => {
    const blocked = blockedRunOf(lastStreamErrorRef.current)
    if (!blocked) return
    blockedStopRef.current = blocked
    loopRef.current?.cancel()
  }

  /** A docked card holds the running tool: its step row says what the person has to do until they do it */
  const awaitPerson = <T,>(wait: PanelWait, summary: string, card: Promise<T>): Promise<T> => {
    patchLast((last) => ({ tools: markRunningWait(last.tools, wait, summary) }))
    return card.finally(() =>
      patchLast((last) => ({ tools: clearRunningWait(last.tools, toolStepLabel) })),
    )
  }

  /**
   * Whole-page generation: one tool-less request whose reply is the HTML, streamed
   * into the preview mirror as it arrives. A stream that stops early leaves the user
   * a keep-or-discard choice; a stream that produced nothing is retried once.
   */
  const runPageWriter = async (
    spec: PageWriteSpec,
    signal?: AbortSignal,
  ): Promise<PageWriteResult> => {
    const { system, user } = buildPageWriterRequest(spec, aiLangDirective(langRef.current))
    let draft = ''
    let timer: number | null = null
    let closed = false
    const flush = () => {
      timer = null
      if (closed) return
      depsRef.current.previewDraft(draft)
      const lines = draft.split('\n').length
      patchLast((last) => ({
        tools: last.tools?.map((tl) =>
          tl.running ? { ...tl, summary: tGlobal('aiWritingPage', { lines }) } : tl,
        ),
      }))
    }
    const attempt = () => {
      lastStreamErrorRef.current = null
      return streamPage({
        transport: transportRef.current!,
        system,
        user,
        signal,
        onProgress: (html) => {
          if (closed) return
          draft = html
          if (timer === null) timer = window.setTimeout(flush, DRAFT_PREVIEW_MS)
        },
      })
    }
    let outcome = await attempt()
    // a blocked connection would only fail the same way again
    if (
      outcome.status === 'empty' &&
      !signal?.aborted &&
      writerMayRetry(lastStreamErrorRef.current)
    )
      outcome = await attempt()
    // nothing may touch the mirror after this point, or the overlay would outlive the landed page
    closed = true
    if (timer !== null) window.clearTimeout(timer)
    timer = null
    const done = () => depsRef.current.previewDraft(null)
    if (outcome.status === 'complete') {
      done()
      return { ok: true, html: outcome.html }
    }
    if (outcome.status === 'empty') {
      done()
      stopRunIfBlocked()
      return { ok: false, error: outcome.error }
    }
    // the draft stays visible while the user decides what to do with it
    depsRef.current.previewDraft(outcome.html)
    const keep = await awaitPerson(
      'choice',
      tGlobal('aiWaitPartialStep', {
        adopt: tGlobal('aiPartialAdopt'),
        discard: tGlobal('aiPartialDiscard'),
      }),
      new Promise<boolean>((resolve) => {
        partialResolverRef.current = resolve
        setActivePartial({ lines: outcome.html.split('\n').length })
      }),
    )
    done()
    // a kept partial page still lands; the next turn reports the blocked connection itself
    if (!keep) stopRunIfBlocked()
    return keep
      ? { ok: true, html: outcome.html, truncated: true }
      : {
          ok: false,
          error: `${outcome.reason}${outcome.error ? `: ${outcome.error}` : ''}; the user discarded the partial page`,
        }
  }
  const runPageWriterRef = useRef(runPageWriter)
  runPageWriterRef.current = runPageWriter

  /** Brief drafting: one tool-less request over the conversation transcript; an empty reply is retried once. */
  const runBriefWriter = async (
    spec: BriefPlanSpec,
    signal?: AbortSignal,
  ): Promise<BriefPlanResult> => {
    const { system, user } = buildBriefWriterRequest(
      spec,
      loopRef.current?.messages ?? [],
      aiLangDirective(langRef.current),
    )
    patchLast((last) => ({
      tools: last.tools?.map((tl) =>
        tl.running ? { ...tl, summary: tGlobal('aiDraftingBrief') } : tl,
      ),
    }))
    const attempt = () => {
      lastStreamErrorRef.current = null
      return streamBrief({ transport: transportRef.current!, system, user, signal })
    }
    let result = await attempt()
    if (!result.ok && !signal?.aborted && writerMayRetry(lastStreamErrorRef.current))
      result = await attempt()
    if (!result.ok) stopRunIfBlocked()
    return result
  }
  const runBriefWriterRef = useRef(runBriefWriter)
  runBriefWriterRef.current = runBriefWriter

  /**
   * The card of the run that just ended, if it changed the document: its
   * snapshot joins the ring (the oldest falls out past MAX_SNAPSHOTS) and the
   * count is the elements its marks sit on, when the app can count them all.
   */
  const takeRunChanges = (): { changes: RunChanges } | Record<string, never> => {
    const doc = runSnapshotRef.current
    const lines = runChangeLinesRef.current
    runSnapshotRef.current = null
    runChangeLinesRef.current = []
    if (!doc) return {}
    const id = nextSnapshotIdRef.current++
    setSnapshots((prev) => [...prev, { id, doc }].slice(-MAX_SNAPSHOTS))
    const count = depsRef.current.changedPlaces?.()
    return {
      changes: {
        id,
        state: 'applied',
        ...(count !== undefined ? { count } : {}),
        ...(lines.length > 0 ? { lines } : {}),
      },
    }
  }

  const loopRef = useRef<AgentLoop<DocSnapshot> | null>(null)
  if (!loopRef.current) {
    loopRef.current = new AgentLoop<DocSnapshot>({
      transport: transportRef.current,
      // a local model that reported no tool support answers in text only
      toolsAllowed: () =>
        settingsRef.current ? localModelCapabilities(settingsRef.current).tools !== false : true,
      skill: composeWithDrive('html+search', '', () => loopRef.current?.messages ?? [], [
        createDocumentSkill(
          {
            getText: () => depsRef.current.access.getText(),
            getVersion: () => depsRef.current.access.getVersion(),
            getMap: () => depsRef.current.access.getMap(),
            getLastManualVersion: () => depsRef.current.access.getLastManualVersion(),
            getFilePath: () => depsRef.current.access.getFilePath(),
            getSelectedSid: () =>
              queueRunRef.current ? null : depsRef.current.access.getSelectedSid(),
            applyOps: (ops, label) => depsRef.current.access.applyOps(ops, label),
            replaceAll: (html, label) => depsRef.current.access.replaceAll(html, label),
            askClarification: (questions) =>
              awaitPerson(
                'answer',
                tGlobal('aiWaitClarifyStep'),
                new Promise((resolve) => {
                  clarifyResolverRef.current = resolve
                  setActiveClarify(questions)
                }),
              ),
            confirmBrief: (brief) =>
              awaitPerson(
                'confirm',
                tGlobal('aiWaitBriefStep', { action: tGlobal('briefGenerate') }),
                new Promise((resolve) => {
                  briefResolverRef.current = resolve
                  setActiveBrief(brief)
                }),
              ),
            writePage: (spec, signal) => runPageWriterRef.current(spec, signal),
            planBrief: (spec, signal) => runBriefWriterRef.current(spec, signal),
            getInstruction: () => runInstructionRef.current,
            resolveAttachmentSrc: (ref) => resolveAttachmentSrc(ref),
            listAttachmentNames: () => availableAttachments().map((a) => a.name),
            listImageAttachmentNames: () =>
              availableAttachments()
                .filter((a) => ATTACHMENT_IMAGE_EXTS.has(a.ext))
                .map((a) => a.name),
          },
          () => imageGenAvailableRef.current,
        ),
        createSearchSkill(),
        createFilesSkill(availableAttachments),
        createIntentSkill(
          () => intentRef.current,
          () => isDocEmpty(depsRef.current.access.getText()),
        ),
        // the person's skills: use_skill, read_skill_file, propose_skill (app-run tools)
        ...panelUserSkills({
          editor: 'html',
          lang: () => langRef.current,
          messages: () => loopRef.current?.messages ?? [],
          // a template skill the model used offers its new document (spec 5.7)
          onUsed: (skill) => skillTemplatesRef.current.onUsed(skill),
          // use_skill names the MCP servers it expects that are not usable now (spec 8)
          mcpServerUsable: (name) => windowMcpUsableServers().has(name),
          onProposal: (proposal) => {
            skillCardsRef.current.add(proposal)
            patchLast((last) => ({
              skillProposals: [...(last.skillProposals ?? []), proposal.key],
            }))
          },
        }),
        // the chosen project: its context and the app-run project tools (adds nothing without one)
        ...panelProjectSkill({ run: projectChat.run, lang: () => langRef.current }),
      ]),
      captureSnapshot: () => depsRef.current.getSnapshot(),
      systemSuffix: () => aiLangDirective(langRef.current),
      events: {
        onText: (text) => patchLast({ text }),
        onToolStart: (call) => {
          // Live "running" chip: replaced in place by onToolExecuted
          patchLast((last) => ({
            tools: [
              ...(last.tools ?? []),
              { name: call.name, summary: toolStepLabel(call.name), running: true },
            ],
          }))
        },
        onToolExecuted: ({ call, execution, snapshotBefore }) => {
          if (execution.mutated) {
            runMutatedRef.current = true
            if (runChangeLinesRef.current.length < MAX_HTML_CHANGE_LINES) {
              const nextLines = htmlChangeLinesFromTool(call.name, call.input, execution.summary)
              runChangeLinesRef.current = [...runChangeLinesRef.current, ...nextLines].slice(
                0,
                MAX_HTML_CHANGE_LINES,
              )
            }
          }
          if (snapshotBefore !== undefined) runSnapshotRef.current = snapshotBefore
          const activity: ToolActivity = {
            name: call.name,
            summary: execution.summary,
            isError: execution.isError,
            output: execution.output?.slice(0, TOOL_OUTPUT_MAX_CHARS),
          }
          runToolsRef.current.push(activity)
          patchLast((last) => {
            // Swap out the running placeholder pushed by onToolStart (parse-fail calls have none)
            const tools = [...(last.tools ?? [])]
            if (tools.at(-1)?.running) tools.pop()
            return { tools: [...tools, activity] }
          })
        },
        onTurnEnd: () => {
          patchLast({ streaming: false })
          setChat((prev) => [...prev, { role: 'assistant', text: '', streaming: true }])
        },
        onUsage: (usage) => {
          runUsageRef.current = addTokenUsage(runUsageRef.current, usage)
          setSessionUsage((prev) => addTokenUsage(prev, usage))
          patchLast({ usage: runUsageRef.current })
        },
        onDone: ({ text, cancelled, turnLimit, truncated }) => {
          const blocked = cancelled ? blockedStopRef.current : null
          blockedStopRef.current = null
          // a stopped run keeps what it already changed: that gets its card too
          const changed = takeRunChanges()
          if (blocked) {
            // a writer stopped the run on a blocked connection: show why, not "Stopped"
            msgQueueRef.current.hold()
            patchLast((last) => ({
              streaming: false,
              text: blocked.message,
              isError: true,
              blocked,
              tools: last.tools?.filter((tl) => !tl.running),
              ...changed,
            }))
            depsRef.current.onRunDone(runMutatedRef.current)
            void projectChatRef.current.finishSend()
            queueRunRef.current = false
            setBusy(false)
            return
          }
          const base = turnLimit
            ? [text, tGlobal('aiTurnLimit')].filter(Boolean).join('\n\n')
            : text || (cancelled ? tGlobal('aiStopped') : '')
          // A reasoning model can spend the entire output budget on thinking and close the
          // turn with finish_reason=length and no prose at all — the bare "(no reply)" read
          // as the assistant ignoring the user. Name the truncation, as docs already does.
          const final = truncated
            ? [base, tGlobal('aiTruncatedNote')].filter(Boolean).join('\n\n')
            : base
          patchLast((last) => ({
            streaming: false,
            text: final || (last.tools?.length ? last.text : tGlobal('aiNoReply')),
            // A stop mid-tool can leave a running placeholder behind — drop it
            tools: last.tools?.filter((tl) => !tl.running),
            ...changed,
          }))
          persistMessage('assistant', final, runToolsRef.current)
          void projectChatRef.current.finishSend()
          depsRef.current.onRunDone(runMutatedRef.current)
          queueRunRef.current = false
          setBusy(false)
        },
        onError: (error) => {
          // a connection that cannot go on gets the blocked notice (with "continue with …") instead of an error line
          const blocked = blockedRunFor(error, lastStreamErrorRef.current)
          // the next queued message would only meet the same block
          if (blocked) msgQueueRef.current.hold()
          // once a tool ran the message was delivered; a later turn failing is not a send failure
          const undelivered = runToolsRef.current.length === 0
          // a run can fail after it already changed the document: its card stays
          const changed = takeRunChanges()
          setChat((prev) => {
            const next = [...prev]
            for (let i = undelivered ? next.length - 1 : -1; i >= 0; i--) {
              const entry = next[i]!
              if (entry.role === 'user') {
                next[i] = { ...entry, undelivered: true }
                break
              }
            }
            const last = next.at(-1)
            if (last?.role === 'assistant') {
              next[next.length - 1] = {
                ...last,
                streaming: false,
                text: error,
                isError: true,
                ...(blocked ? { blocked } : {}),
                tools: last.tools?.filter((tl) => !tl.running),
                ...changed,
              }
            }
            return next
          })
          void projectChatRef.current.finishSend()
          queueRunRef.current = false
          setBusy(false)
        },
      },
    })
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clarifyResolverRef.current?.({ answers: '', cancelled: true })
      briefResolverRef.current?.({ kind: 'cancelled' })
      partialResolverRef.current?.(false)
      loopRef.current?.cancel()
      depsRef.current.clearHighlights()
    }
  }, [])

  // ── chat-history persistence: bind to the file, restore prior transcript ──
  /** the per-document chat: bound to the file once, then its stored messages shown */
  const loadDocumentChat = (): void => {
    const api = window.projectApi
    if (!api) return
    const known = chatIdsRef.current
    const resolved = known
      ? Promise.resolve(known)
      : api
          .resolveChat({
            filePath: filePathRef.current ?? null,
            tempChatId: `unsaved-${Date.now()}`,
          })
          .then((ids) => {
            chatIdsRef.current = ids
            for (const msg of pendingPersistRef.current.splice(0)) {
              persistDocumentMessage(
                msg.role,
                msg.text,
                msg.tools,
                msg.attachments,
                msg.scope,
                msg.skillChips,
              )
            }
            return ids
          })
    void resolved
      .then((ids) => api.loadChat({ projectId: ids.projectId, chatId: ids.chatId, limit: 200 }))
      .then((stored) => {
        // a project chat took the panel meanwhile: it keeps it
        if (stored.length === 0 || projectShownRef.current) return
        // skill cards come back closed; a saved card's record is not part of the conversation
        const msgs = skillCardsRef.current.restore(stored)
        // the user may have sent a message while history was loading — never
        // replace a live transcript (and don't clobber the loop context)
        let applied = false
        // stored metadata only: the chips render name/size, a still-readable image gets its thumbnail
        const restoredAtts = (m: (typeof msgs)[number]): AttachmentMeta[] | undefined =>
          m.attachments
            ?.filter((a) => a.path)
            .map((a) => ({
              name: a.name,
              path: a.path ?? '',
              ext: a.ext ?? '',
              sizeBytes: a.sizeBytes ?? 0,
            }))
        setChat((prev) => {
          if (prev.length > 0) return prev
          applied = true
          return msgs.map((m) => ({
            role: m.role,
            text: m.text,
            tools: m.tools?.map((tool) => ({
              name: tool.name,
              summary: tool.summary,
              isError: tool.isError,
              output: tool.output ? tool.output.slice(0, TOOL_OUTPUT_MAX_CHARS) : undefined,
            })),
            attachments: restoredAtts(m),
            ...(m.scope ? { scope: m.scope } : {}),
            ...(m.role === 'user' && skillChipRefsOf(m.skills).length > 0
              ? { skills: skillChipRefsOf(m.skills) }
              : {}),
            ...(m.skillProposals ? { skillProposals: m.skillProposals } : {}),
          }))
        })
        // the next request re-reads the current text of the skills this conversation used
        if (applied) {
          skillsRef.current.restoreHistory(
            msgs.map((m) => (m.role === 'user' ? skillChipRefsOf(m.skills) : undefined)),
          )
        }
        if (applied && !loopRef.current?.busy) {
          // a reopened conversation starts with no MCP choices of another chat (user MCP spec 7.6)
          windowMcpState()?.newConversation()
          loopRef.current?.restore(msgs.map((m) => ({ role: m.role, text: m.text })))
          // follow-up turns can keep reading the files those messages attached
          const seen = new Set(sentAttachmentsRef.current.map((a) => a.path))
          for (const a of msgs.flatMap((m) => restoredAtts(m) ?? [])) {
            if (seen.has(a.path)) continue
            seen.add(a.path)
            sentAttachmentsRef.current.push(a)
          }
        }
      })
      .catch(() => {
        /* history load failures are silent */
      })
  }
  useEffect(() => {
    loadDocumentChat()
    // once, when the panel opens; a project chosen later swaps the chat itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** after an untitled document's first save, bind the unsaved-* history to the real path */
  useEffect(() => {
    const previous = filePathRef.current
    filePathRef.current = filePath
    // saved under a new path (first save, save as): a project chat goes on and notes the document (spec 5.3.6)
    if (filePath && filePath !== previous) void projectChatRef.current.documentSaved()
    const ids = chatIdsRef.current
    if (!window.projectApi || !ids || !filePath || !ids.chatId.startsWith('unsaved-')) return
    void window.projectApi
      .rebindChat({ projectId: ids.projectId, tempChatId: ids.chatId, newFilePath: filePath })
      .then((r) => {
        if (r?.chatId) chatIdsRef.current = r
      })
      .catch(() => {
        /* silent */
      })
  }, [filePath])

  useEffect(() => {
    if (stickToBottomRef.current) {
      chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
    }
  }, [chat, busy])

  const onChatScroll = (): void => {
    const el = chatRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    onScrollBottom()
  }

  /** a new tab opened by "make" takes its request once and sends it through `send` (8.5) */
  const generateHandoff = useGenerateHandoff({
    filePath,
    composer: prompt,
    attach: mergeAttachments,
    setComposer: setPrompt,
    designIntent: () => setIntent('design'),
    send: (text) => send(text),
    onTaken: onGenerateHandoff,
  })

  /** a request made before this window's project was known: sent once it is */
  const heldUntilReadyRef = useRef<(() => void) | null>(null)

  /** false when nothing was started (empty text or a run already active) */
  const send = (
    text: string,
    displayText?: string,
    queueRun = false,
    attachmentsOverride?: AttachmentMeta[],
    scope?: AiScopeQuoteData,
    /** the chosen skills: their text goes to the model, their chips onto the bubble */
    skillUse: SkillUse = NO_SKILL_USE,
  ): boolean => {
    const instruction = text.trim()
    const loop = loopRef.current
    if (!instruction || !loop || loop.busy) return false
    // the window's project is not known yet (the panel just opened): the request waits for it,
    // so it goes to the right chat with the right context (spec 5.2, 6)
    if (projectChatRef.current.available && !projectChatRef.current.ready) {
      heldUntilReadyRef.current = () => {
        send(text, displayText, queueRun, attachmentsOverride, scope, skillUse)
      }
      return false
    }
    // Nothing connected, or the first-connection notice not acknowledged: nothing is sent, and
    // the dock above the composer says what to do. A request made during a status check or in
    // front of the notice is held and starts by itself once the way is clear.
    if (
      !sendGate.admit({
        text: instruction,
        displayText,
        queueRun,
        attachments: attachmentsOverride,
        scope,
        skillUse,
      })
    ) {
      return false
    }
    lastStreamErrorRef.current = null
    blockedStopRef.current = null
    setInputTruncated(false)
    // the message consumes the composer attachments: echoed on the bubble, images multimodal, files via the skill
    const sentAtts = attachmentsOverride ?? attachmentsRef.current
    generateHandoff.runAdmitted(sentAtts)
    if (sentAtts.length > 0) {
      const seen = new Set(sentAttachmentsRef.current.map((a) => a.path))
      sentAttachmentsRef.current = [
        ...sentAttachmentsRef.current,
        ...sentAtts.filter((a) => !seen.has(a.path)),
      ]
      if (!attachmentsOverride) setAttachments([])
    }
    stickToBottomRef.current = true
    queueRunRef.current = queueRun
    lastQueueRunRef.current = queueRun
    runInstructionRef.current = instruction
    runDisplayRef.current = displayText ?? instruction
    lastScopeRef.current = scope
    runMutatedRef.current = false
    runChangeLinesRef.current = []
    runSnapshotRef.current = null
    // the marks show what the last run changed: a new run starts with none
    depsRef.current.clearHighlights()
    depsRef.current.onPrompt(displayText ?? instruction)
    runToolsRef.current = []
    runUsageRef.current = undefined
    setChat((prev) => [
      ...prev,
      {
        role: 'user',
        text: displayText ?? instruction,
        instruction: displayText ? instruction : undefined,
        queueRun: queueRun || undefined,
        attachments: sentAtts.length > 0 ? sentAtts : undefined,
        scope,
        ...(skillUse.chips.length > 0 ? { skills: skillUse.chips, skillText: skillUse.text } : {}),
      },
      { role: 'assistant', text: '', streaming: true },
    ])
    setPrompt('')
    skillsRef.current.consume(skillUse)
    lastSkillUseRef.current = skillUse
    skillTemplatesRef.current.noteRequest(displayText ?? text)
    setBusy(true)
    busyRef.current = true
    // persist what the user saw — a restored transcript must not surface the
    // internal batch protocol text behind a queue submission
    persistMessage('user', displayText ?? instruction, undefined, sentAtts, scope, skillUse.chips)
    // Stop / New chat during the pre-run reads (settings, image bytes) bump the sequence; a stale send never starts the loop
    const seq = ++sendSeqRef.current
    void (async () => {
      try {
        settingsRef.current = await window.htmlApi.getAiSettings()
        const images = sentAtts.length > 0 ? await collectImages(sentAtts) : []
        if (!mountedRef.current || seq !== sendSeqRef.current) return
        // the chosen project's context is read now and holds for this request (spec 5.4)
        const prepared = await projectChatRef.current.prepareSend()
        if (!mountedRef.current || seq !== sendSeqRef.current) {
          void projectChatRef.current.finishSend()
          return
        }
        showPreparedNotices(prepared)
        // the skill text rides with this request only; the bubble and the record keep the chips
        await loop.run(instruction + skillUse.text, images.length > 0 ? images : undefined)
      } catch (err) {
        void projectChatRef.current.finishSend()
        // a send cancelled during its pre-run reads must not paint its error onto a later turn's bubble
        if (!mountedRef.current || seq !== sendSeqRef.current) return
        patchLast({
          streaming: false,
          text: err instanceof Error ? err.message : String(err),
          isError: true,
        })
        queueRunRef.current = false
        setBusy(false)
      }
    })()
    return true
  }

  /** one run for the whole queue; every item is consumed up front, failures go through retry */
  const sendQueue = (): void => {
    const access = depsRef.current.access
    const entries = liveItems(
      resolveQueue(buildProjection(access.getText(), access.getMap()), access.getMap(), editQueue),
    )
    if (entries.length === 0) {
      onQueueClear()
      return
    }
    // a batch is not held: its items stay queued until a run can really start
    if (!sendGate.admitQueued(() => {})) return
    const started = send(
      buildQueueInstruction(entries),
      buildQueueSummary(t('aiQueueSubmitted', { count: entries.length }), entries),
      true,
    )
    // consume only once the run is under way; a failed run keeps its retry via the bubble's instruction
    if (started) onQueueConsume(editQueue.map((item) => item.qid))
  }

  /** finish pending cards as skipped so no promise is left dangling */
  const dismissCards = (): void => {
    clarifyResolverRef.current?.({ answers: '', cancelled: true })
    clarifyResolverRef.current = null
    setActiveClarify(null)
    briefResolverRef.current?.({ kind: 'cancelled' })
    briefResolverRef.current = null
    setActiveBrief(null)
    decidePartial(false)
  }

  const decidePartial = (keep: boolean): void => {
    partialResolverRef.current?.(keep)
    partialResolverRef.current = null
    setActivePartial(null)
  }

  /** pre-run send in flight (reads before loop.run): cancelling it drops the empty reply and marks the message undelivered */
  const cancelPendingSend = (): void => {
    sendSeqRef.current++
    setChat((prev) => {
      const last = prev.at(-1)
      if (!last || last.role !== 'assistant' || !last.streaming || last.text) return prev
      const rest = prev.slice(0, -1)
      const user = rest.at(-1)
      if (user?.role === 'user') rest[rest.length - 1] = { ...user, undelivered: true }
      return rest
    })
    queueRunRef.current = false
    setBusy(false)
  }

  /** Enter while a reply runs: the draft joins the queue above the composer */
  const enqueueDraft = () => {
    const text = prompt.trim()
    if (!text) return
    skills.withSkills(text, (skillUse) => enqueueWith(text, skillUse))
  }
  const enqueueWith = (text: string, skillUse: SkillUse) => {
    skillsRef.current.consume(skillUse)
    // the queued message owns the composer attachments; pump time passes them as an override
    const atts = attachmentsRef.current
    if (atts.length > 0) setAttachments([])
    msgQueue.enqueue(text, { atts, skillUse })
    setPrompt('')
  }

  /** the composer's send: the typed text goes out with the chosen skills */
  const sendDraft = () => {
    const text = prompt.trim()
    if (!text) return
    skills.withSkills(text, (skillUse) =>
      send(text, undefined, false, undefined, undefined, skillUse),
    )
  }

  /** the skills a past user message was sent with, for resending it (none for a restored one) */
  const entrySkillUse = (entry: ChatEntry): SkillUse =>
    entry.skills && entry.skillText !== undefined
      ? { text: entry.skillText, chips: entry.skills }
      : NO_SKILL_USE

  const stop = (): void => {
    msgQueue.hold()
    dismissCards()
    const loop = loopRef.current
    if (loop?.busy) loop.cancel()
    else cancelPendingSend()
  }

  const retry = (): void => {
    send(
      runInstructionRef.current,
      runDisplayRef.current,
      lastQueueRunRef.current,
      undefined,
      lastScopeRef.current,
      lastSkillUseRef.current,
    )
  }

  /** "Continue with …" on a blocked run: that provider becomes the selection (the picker shows it) and the request runs again */
  const continueWith = (provider: AiSubscriptionProviderId): void => {
    // the blocked request again, with the attachments and scope it was sent with
    const last = [...chat].reverse().find((entry) => entry.role === 'user')
    sendGate.continueWith(provider, () => {
      if (last)
        send(
          last.instruction ?? last.text,
          last.text,
          last.queueRun,
          last.attachments ?? [],
          last.scope,
          entrySkillUse(last),
        )
      else retry()
    })
  }

  // ── project folders (spec 5) ──

  useEffect(() => {
    if (!projectChat.ready) return
    const held = heldUntilReadyRef.current
    heldUntilReadyRef.current = null
    held?.()
  }, [projectChat.ready])

  /** the chat on screen goes: the composer's files, the queue, the loop and the cards start over */
  const resetConversation = (): void => {
    msgQueue.clear()
    sendGate.reset()
    stop()
    loopRef.current?.reset()
    // servers off in this chat and "always allow in this chat" go too (user MCP spec 7.6)
    windowMcpState()?.newConversation()
    setBusy(false)
    busyRef.current = false
    setChat([])
    skills.resetConversation()
    skillCards.reset()
    skillTemplates.reset()
    setReceipts([])
    // the cards go with the chat, and the snapshots and marks with them
    setSnapshots([])
    runSnapshotRef.current = null
    depsRef.current.clearHighlights()
    attachmentsRef.current = []
    setAttachments([])
    setAttachNotice(null)
    sentAttachmentsRef.current = []
  }

  /** "New chat": a new chat of the chosen project, or the fresh start it always was (spec 5.3.7) */
  const newChat = (): void => {
    resetConversation()
    if (projectChatRef.current.projectId) void projectChatRef.current.newChat()
  }

  /** a chat was opened (or the person went back to the document's own): show it, hand it to the loop */
  const openProjectChat = (opened: ProjectChatOpened): void => {
    // a conversation on screen gives way; an empty panel keeps what its composer holds
    if (busy || chat.length > 0) resetConversation()
    else loopRef.current?.reset()
    // another chat opens: no MCP choices of the one before (user MCP spec 7.6)
    windowMcpState()?.newConversation()
    setProjectNotices([])
    setProjectProblem(null)
    setConsolidated(null)
    if (opened.kind === 'document') {
      projectShownRef.current = false
      loadDocumentChat()
      return
    }
    projectShownRef.current = true
    // skill cards come back closed; a saved card's record is not part of the conversation
    const entries = skillCardsRef.current.restore(opened.entries)
    const shown = entries.map(chatEntryOf)
    setChat(shown)
    skillsRef.current.restoreHistory(
      entries.map((e) => (e.role === 'user' ? skillChipRefsOf(e.skills) : undefined)),
    )
    // the model gets each message's role and text, as with any chat opened again
    loopRef.current?.restore(entries.map((e) => ({ role: e.role, text: e.text })))
    const seen = new Set<string>()
    sentAttachmentsRef.current = shown
      .flatMap((e) => e.attachments ?? [])
      .filter((a) => !seen.has(a.path) && !!seen.add(a.path))
  }

  /** another window recorded a message in this chat: shown now, ahead of a reply in flight (spec 5.3.3) */
  const showRemoteMessage = (entry: ProjectChatEntry): void => {
    const shown = chatEntryOf(entry)
    setChat((prev) => placeRemoteEntries(prev, [shown], busyRef.current))
  }

  /** what the request's project context brought: changed rules or memory, long memory, a cut (spec 5.4, 5.10) */
  const showPreparedNotices = (prepared: ProjectRunPrepared): void => {
    // "cannot be written" keeps its own line for as long as it lasts
    setProjectNotices(
      prepared.status === 'ok' ? prepared.notices.filter((n) => n.kind !== 'unwritable') : [],
    )
    // a request that went without the project's context says so
    setProjectProblem(projectPrepareProblem(prepared))
  }

  const refreshProjects = async (): Promise<void> => {
    const api = folderApi()
    if (!api) return
    try {
      const list = await api.listProjects()
      if (mountedRef.current) setProjects(list)
    } catch {
      /* the picker keeps the list it showed */
    }
  }
  // the chip names the chosen project: the list is read when the panel opens and the choice moves
  useEffect(() => {
    if (projectChat.available) void refreshProjects()
  }, [projectChat.available, projectChat.projectId])

  const openPicker = (): void => {
    void refreshProjects()
    void folderApi()
      ?.getDefaultParentFolder()
      .then((folder) => {
        if (mountedRef.current) setDefaultParentFolder(folder)
      })
      .catch(() => undefined)
  }

  /** a project that was added or created becomes this panel's project */
  const takeAddedProject = async (
    result: AddFolderResult | CreateProjectResult | undefined,
  ): Promise<void> => {
    if (!result) return
    if (result.status !== 'added' && result.status !== 'created') {
      // refused, not made: say why (spec 5.1); a closed dialog says nothing
      if (mountedRef.current) setProjectProblem(projectAddProblem(result))
      return
    }
    setProjectProblem(null)
    await refreshProjects()
    await projectChatRef.current.selectProject(result.project.id)
    // the addition's one-time notices (a sync folder) show after the switch cleared the old ones
    if (result.status === 'added' && result.notices.length > 0) setProjectNotices(result.notices)
  }
  const afterAdd = (pending: Promise<AddFolderResult | CreateProjectResult> | undefined): void => {
    void pending?.then(takeAddedProject).catch(showActionFailed)
  }
  /** a bridge call the person made failed: say so instead of doing nothing */
  const showActionFailed = (): void => {
    if (mountedRef.current) setProjectProblem({ kind: 'action-failed' })
  }

  const removeProjectFromList = (projectId: ProjectId): void => {
    void folderApi()
      ?.removeFromList({ projectId })
      .then(async () => {
        await refreshProjects()
        if (projectChatRef.current.projectId === projectId) {
          await projectChatRef.current.selectProject(null)
        }
      })
      .catch(showActionFailed)
  }

  /** "[View]": the home project screen at that section */
  const viewProjectSection = (section: ProjectScreenSection): void => {
    const projectId = projectChatRef.current.projectId
    if (projectId)
      void folderApi()
        ?.openProjectScreen({ projectId, section })
        .catch(() => undefined)
  }

  /** "[Tidy up]": one request, only when pressed, through the same gate as a send (spec 5.6) */
  const consolidateMemory = async (): Promise<void> => {
    const projectId = projectChatRef.current.projectId
    if (!projectId || consolidatingRef.current || busyRef.current) return
    consolidatingRef.current = true
    try {
      const settings = await window.htmlApi.getAiSettings()
      if (settings) settingsRef.current = settings
      if (!settingsRef.current || !transportRef.current) return
      const result = await consolidateProjectMemory({
        projectId,
        transport: transportRef.current,
        gate: () => sendGateRef.current.peek(),
      })
      if (!mountedRef.current) return
      if (result.status === 'ok') {
        setProjectNotices((prev) => prev.filter((n) => n.kind !== 'memory-long'))
        setConsolidated({
          projectId,
          before: result.before,
          after: result.after,
          backupName: result.backupName,
        })
      } else if (result.status === 'not-ready') {
        // nothing went out: the connect prompt or the first-connection notice says why
        sendGateRef.current.admitQueued(() => {})
      } else if (result.status === 'unwritable') {
        projectChatRef.current.markUnwritable()
      } else if (result.status === 'failed') {
        setProjectProblem({ kind: 'consolidate-failed' })
      }
    } catch {
      // the memory stays as it was
      if (mountedRef.current) setProjectProblem({ kind: 'consolidate-failed' })
    } finally {
      consolidatingRef.current = false
    }
  }

  const undoConsolidation = (): void => {
    const done = consolidated
    const api = folderApi()
    if (!done || !api) return
    void undoProjectMemoryConsolidation(api, done.projectId, done.backupName)
      .then((result) => {
        if (result.status === 'ok' && mountedRef.current) setConsolidated(null)
        else if (result.status === 'unwritable') projectChatRef.current.markUnwritable()
      })
      .catch(showActionFailed)
  }

  /** "[Remove]" on a memory line: the entry leaves `memory.md` */
  const forgetMemory = (line: ProjectMemoryLine): Promise<ProjectMemoryRemoveOutcome> =>
    projectChatRef.current
      .forgetMemory(line)
      .then((result) => {
        const outcome = memoryRemoveOutcome(result)
        // an entry no longer in the memory is as good as removed
        if (outcome !== 'failed' && mountedRef.current) {
          setForgotten((prev) => new Set(prev).add(line.text))
        }
        return outcome
      })
      .catch((): ProjectMemoryRemoveOutcome => 'failed')

  /** the memory lines and the other editor's tool line under a project chat's reply */
  const projectReplyLines = (entry: ChatEntry): ReactNode => {
    const memory = entry.memory ?? memoryLinesOf(entry.tools)
    const other = entry.otherEditorTools
    if (!other && memory.length === 0) return null
    return (
      <>
        {other && (
          <ProjectToolSummaryLine
            lang={lang}
            editor={other.editor}
            documentName={other.fileRef ? baseName(other.fileRef) : undefined}
            count={other.count}
          />
        )}
        {memory.map((line, k) => (
          <ProjectMemoryEventLine
            key={k}
            lang={lang}
            change={line.change}
            gone={
              projectChat.memoryEntries
                ? memoryLineGone(line, projectChat.memoryEntries)
                : forgotten.has(line.text)
            }
            onRemove={() => forgetMemory(line)}
          />
        ))}
      </>
    )
  }

  /** the project chip under the input (spec 5.1); absent without the project folder bridge */
  const projectPicker = projectChat.available ? (
    <ProjectPicker
      lang={lang}
      projects={projects}
      selectedId={projectChat.projectId}
      disabled={busy || !projectChat.ready}
      defaultParentFolder={defaultParentFolder}
      onOpen={openPicker}
      onSelect={(projectId) => void projectChat.selectProject(projectId)}
      onCreate={(name, { otherPlace }) =>
        afterAdd(folderApi()?.createProject({ name, otherPlace }))
      }
      onAddFolder={() => afterAdd(folderApi()?.addFolder())}
      onRelocate={(projectId) => afterAdd(folderApi()?.relocateProject({ projectId }))}
      onSetPinned={(projectId, pinned) =>
        void folderApi()
          ?.setPinned({ projectId, pinned })
          .then(refreshProjects)
          .catch(() => undefined)
      }
      onOpenInFileManager={(projectId) =>
        void folderApi()
          ?.openInFileManager({ projectId })
          .catch(() => undefined)
      }
      onRemoveFromList={removeProjectFromList}
    />
  ) : undefined

  /** the project's lines above the input: the folder hint, "cannot be written", the context notices */
  const projectLines = (
    <>
      {projectProblem && (
        <ProjectProblemLine
          lang={lang}
          problem={projectProblem}
          onDismiss={() => setProjectProblem(null)}
        />
      )}
      {projectChat.hint && (
        <ProjectFolderHintLine
          lang={lang}
          hint={projectChat.hint}
          onUse={() => afterAdd(folderApi()?.adoptFolderHint())}
        />
      )}
      {projectChat.projectId && projectChat.unwritable && (
        <ProjectNoticeLine lang={lang} notice={{ kind: 'unwritable' }} />
      )}
      <ProjectNoticeList
        lang={lang}
        notices={projectNotices}
        onView={viewProjectSection}
        onConsolidate={busy ? undefined : () => void consolidateMemory()}
        onDismiss={(index) => setProjectNotices((prev) => prev.filter((_, i) => i !== index))}
      />
      {consolidated && consolidated.projectId === projectChat.projectId && (
        <ProjectMemoryConsolidatedLine
          lang={lang}
          before={consolidated.before}
          after={consolidated.after}
          onUndo={undoConsolidation}
        />
      )}
    </>
  )

  /** the [chat ▾] menu of the panel header, while a project is chosen (spec 5.3) */
  const activeChat = projectChat.chat
  const projectChatMenu = projectChat.projectId ? (
    <ProjectChatMenu
      lang={lang}
      chats={projectChat.chats}
      currentChatId={activeChat?.kind === 'project' && !activeChat.isNew ? activeChat.chatId : null}
      currentTitle={activeChat?.kind === 'project' ? activeChat.title || undefined : undefined}
      legacy={projectChat.legacy}
      legacyActive={activeChat?.kind === 'legacy'}
      disabled={busy}
      onOpen={() => void projectChat.refreshChats()}
      onSelect={(chatId) => void projectChat.openChat(chatId)}
      onNewChat={newChat}
      onRename={(chatId, title) =>
        void projectChat.renameChat(chatId, title).catch(showActionFailed)
      }
      onDelete={(chatId) => void projectChat.deleteChat(chatId).catch(showActionFailed)}
      onSelectLegacy={() => void projectChat.openLegacy()}
    />
  ) : null

  /** [label](htmlnav://sid/N) links in replies select that element */
  const docNav = {
    scheme: DOC_NAV_SCHEME,
    onNavigate: (href: string) => {
      const sid = parseDocNavHref(href)
      if (sid !== null) depsRef.current.navigateTo(sid)
    },
  }
  // [name](filenav:///abs/path) citations open the cited file in its own app
  const fileNav = createFileNav((path) => {
    void window.htmlApi.openSourcePath(path)
  })

  const draftNonceRef = useRef(0)
  useEffect(() => {
    if (!draft || draft.nonce === draftNonceRef.current) return
    draftNonceRef.current = draft.nonce
    setPrompt(draft.text)
    inputRef.current?.focus()
  }, [draft])

  // ribbon presets auto-send; while a run is active they land in the composer instead
  const presetNonceRef = useRef(0)
  useEffect(() => {
    if (!preset || preset.nonce === presetNonceRef.current) return
    presetNonceRef.current = preset.nonce
    // while a run is active the request lands in the composer as the user phrased it, never as protocol text
    if (loopRef.current?.busy) setPrompt(preset.displayText ?? preset.text)
    else if (!send(preset.text, preset.displayText, false, undefined, preset.scope))
      // refused (nothing connected yet): the request waits in the composer instead of being lost
      setPrompt(preset.displayText ?? preset.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])

  /**
   * Takes a run back: the source returns to the snapshot from before the run's
   * first change. That also drops every later run (and edits made since), so
   * their cards turn 'reverted' and their snapshots go.
   */
  const revertRun = (id: number): void => {
    if (busy) return
    const snapshot = snapshots.find((s) => s.id === id)
    if (!snapshot) return
    let state: AiChangesState = 'reverted'
    try {
      depsRef.current.restoreSnapshot(snapshot.doc)
    } catch {
      state = 'refused'
    }
    if (state === 'reverted') {
      depsRef.current.clearHighlights()
      setSnapshots((prev) => prev.filter((s) => s.id < id))
    }
    setChat((prev) =>
      prev.map((entry) => {
        const changes = entry.changes
        if (!changes || changes.state !== 'applied') return entry
        if (changes.id === id) return { ...entry, changes: { ...changes, state } }
        if (state === 'reverted' && changes.id > id)
          return { ...entry, changes: { ...changes, state: 'reverted' } }
        return entry
      }),
    )
  }

  /** the card's state: an applied run whose snapshot fell out of the ring can no longer be taken back */
  const cardState = (changes: RunChanges): AiChangesState =>
    changes.state === 'applied' && !snapshots.some((s) => s.id === changes.id)
      ? 'expired'
      : changes.state
  /** the newest reply with a changes card: only its run's changes are marked */
  const latestChangesIdx = chat.map((entry) => entry.changes !== undefined).lastIndexOf(true)

  // Re-derive the display width on window resize (max is 60% of the window);
  // growing the window back restores the preferred width
  useEffect(() => {
    const onResize = (): void => setPanelWidth(clampPanelWidth(preferredWidthRef.current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const resizeCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => resizeCleanupRef.current?.(), [])

  /** Drag the inner panel edge to resize from the selected window side. */
  const startResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const resizer = e.currentTarget
    setResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: PointerEvent): void => {
      const w = clampPanelWidth(aiPanelWidthAtPointer(ev.clientX))
      preferredWidthRef.current = w
      setPanelWidth(w)
    }
    let done = false
    const cleanup = (): void => {
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
    resizer.addEventListener('lostpointercapture', cleanup)
    resizer.setPointerCapture(e.pointerId)
  }

  const docEmpty = chat.length === 0 && isDocEmpty(deps.access.getText())
  /** a docked card the run is waiting on: the live reply shows it in place of the clock */
  const panelWait = panelWaitOf(activeClarify, activeBrief, activePartial)

  return (
    <aside
      ref={asideRef}
      className={`copilot${resizing ? ' ai-panel-resizing' : ''}${dragOver ? ' ai-panel-dragover' : ''}`}
      style={{ width: '100%' }}
      dir={lang === 'ar' || lang === 'he' ? 'rtl' : undefined}
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
      onDrop={(e) => void onDrop(e)}
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
        chatMenu={projectChatMenu}
        actions={
          <>
            <AiPanelSideButton
              lang={lang}
              onMove={(side) => window.htmlApi.setAiPanelPrefs({ side })}
            />
            {chat.length > 0 && (
              <button
                type="button"
                className="ai-header-btn"
                onClick={newChat}
                data-tip={t('aiNewChat')}
                aria-label={t('aiNewChat')}
              >
                <IconNewChat />
              </button>
            )}
            <button
              type="button"
              className="ai-header-btn ai-panel-collapse"
              onClick={onCollapse}
              data-tip={t('aiCollapsePanel')}
              aria-label={t('aiCollapsePanel')}
            >
              <IconCollapse />
            </button>
          </>
        }
      />

      <div className="ai-chat" ref={chatRef} onScroll={onChatScroll}>
        {chat.length === 0 && (
          <div className="ai-chat-empty">
            <div className="ai-chat-empty-badge">
              <AiMark size={24} />
            </div>
            <div className="ai-chat-empty-title">
              {t(
                docEmpty
                  ? intent === 'write'
                    ? 'aiEmptyWriteTitle'
                    : 'aiEmptyTitle'
                  : 'aiEmptyDocTitle',
              )}
            </div>
            <div className="ai-chat-empty-body">
              {t(
                docEmpty
                  ? intent === 'write'
                    ? 'aiEmptyWriteBody'
                    : 'aiEmptyBody'
                  : 'aiEmptyDocBody',
              )}
            </div>
            <div className="ai-starter-list">
              {(docEmpty
                ? intent === 'write'
                  ? WRITE_STARTERS
                  : GENERATE_STARTERS
                : EDIT_STARTERS
              ).map(([label, promptKey]) => (
                <button
                  key={label}
                  className="ai-starter"
                  onClick={() => {
                    setPrompt(t(promptKey))
                    inputRef.current?.focus()
                  }}
                >
                  {t(label)}
                </button>
              ))}
            </div>
            <AiEmptyHints lang={lang} showSkill={Boolean(skills.composer)} showDocMention />
          </div>
        )}
        {chat.map((entry, i) => {
          if (entry.role === 'user') {
            const own = receipts.filter((r) => r.afterIdx === i)
            return (
              <div key={i} className="ai-msg ai-msg-user">
                {entry.scope && <AiScopeQuote scope={entry.scope} />}
                <SentSkillChips lang={lang} chips={entry.skills} isAvailable={skills.isAvailable} />
                {entry.attachments && entry.attachments.length > 0 && (
                  <div className="ai-msg-attachments">
                    <AttachmentList atts={entry.attachments} previews={attachmentPreviews} />
                  </div>
                )}
                <span dir="auto">{entry.text}</span>
                {own.map((r, k) =>
                  r.qa ? (
                    <div key={`ca${k}`} className="ai-clarify-answered">
                      {r.qa.map((pair, m) => (
                        <div key={m} className="ai-clarify-answered-row">
                          <div className="ai-clarify-answered-q">{pair.q}</div>
                          <div className="ai-clarify-answered-a">{pair.a}</div>
                        </div>
                      ))}
                    </div>
                  ) : r.brief ? (
                    <div key={`br${k}`} className="brief-receipt">
                      <b>{t('briefTitle')}</b> ·{' '}
                      {t('briefReceipt', { hook: r.brief.core_hook, n: r.brief.sections.length })}
                    </div>
                  ) : null,
                )}
                {entry.undelivered && (
                  <div className="ai-msg-undelivered">
                    {t('aiUndelivered')}
                    {!busy && (
                      <button
                        className="ai-retry-btn"
                        onClick={() =>
                          send(
                            entry.instruction ?? entry.text,
                            entry.text,
                            entry.queueRun,
                            entry.attachments ?? [],
                            entry.scope,
                            entrySkillUse(entry),
                          )
                        }
                      >
                        {t('aiRetry')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          }
          const hasTools = (entry.tools?.length ?? 0) > 0
          const projectLinesOfReply = projectReplyLines(entry)
          if (
            !entry.text &&
            !entry.streaming &&
            !hasTools &&
            !projectLinesOfReply &&
            !entry.changes
          )
            return null
          const isLast = i === chat.length - 1
          // Action row appears once per completed reply: on the turn's final segment only
          // (mid-turn segments have a following assistant entry; the live turn ends when !busy)
          const nextEntry = chat[i + 1]
          const turnEnded = nextEntry ? nextEntry.role === 'user' : !busy
          const showToolbar = !entry.streaming && turnEnded && !!entry.text && !entry.isError
          return (
            <div
              key={i}
              className={`ai-msg ai-msg-assistant${entry.isError ? ' ai-msg-error' : ''}${entry.streaming ? ' ai-msg-streaming' : ''}`}
            >
              {hasTools && (
                <AiWorkSteps
                  lang={lang}
                  steps={entry.tools!}
                  summaryLabel={(() => {
                    const wait = stepsWaitOf(entry.tools!)
                    return wait ? t(WAIT_LABEL[wait]) : undefined
                  })()}
                />
              )}
              {entry.blocked ? (
                <AiBlockedNotice
                  kind={entry.blocked.kind}
                  provider={entry.blocked.provider}
                  resetsAt={entry.blocked.resetsAt}
                  message={entry.text}
                  settings={aiSettings ?? {}}
                  // only the run that just stopped offers "continue with …": it reruns the last request
                  statuses={isLast && !busy ? subscription.statuses : {}}
                  lang={lang}
                  onContinueWith={continueWith}
                />
              ) : (
                entry.text && (
                  <div dir="auto">
                    <Markdown text={entry.text} navs={[docNav, fileNav]} />
                  </div>
                )
              )}
              {projectLinesOfReply}
              <SkillUsedNotes tools={entry.tools} />
              {entry.skillProposals?.map((key) => skillCards.render(key))}
              {entry.changes && (
                <AiChangesCard
                  lang={lang}
                  state={cardState(entry.changes)}
                  count={entry.changes.count}
                  lines={entry.changes.lines}
                  onShowLine={(idx) => {
                    const sid = entry.changes?.lines?.[idx]?.sid
                    if (sid !== undefined) depsRef.current.navigateTo(sid)
                  }}
                  canRevert={!busy}
                  revertsLater={chat.some(
                    (later) =>
                      later.changes &&
                      later.changes.id > entry.changes!.id &&
                      later.changes.state === 'applied',
                  )}
                  onRevert={() => revertRun(entry.changes!.id)}
                  // the marks are of the newest run's changes
                  onClearMarks={
                    i === latestChangesIdx && marksShown
                      ? () => depsRef.current.clearHighlights()
                      : null
                  }
                />
              )}
              {entry.streaming && isLast && panelWait ? (
                <span className="ai-typing-row">
                  <span className="ai-clarify-chip" role="status">
                    <span className="ai-clarify-chip-eyebrow">{t(WAIT_LABEL[panelWait])}</span>
                    <span className="ai-clarify-chip-arrow" aria-hidden>
                      ↓
                    </span>
                  </span>
                </span>
              ) : (
                <AiReplyProgress
                  reply={entry}
                  thinking={t('aiThinking')}
                  working={t('aiWorking')}
                />
              )}
              {(showToolbar || entry.usage) && (
                <AiReplyFooter
                  lang={lang}
                  isLast={isLast}
                  copyText={showToolbar ? entry.text : undefined}
                  onRetry={
                    showToolbar && isLast && !busy && runInstructionRef.current ? retry : undefined
                  }
                  usage={entry.usage}
                />
              )}
            </div>
          )
        })}
        {skillTemplates.notes}
        {/* an MCP tool waiting for the person's yes (user MCP spec 7.4) */}
        <McpPermissionCard lang={lang} />
      </div>

      <AiScrollToBottom
        visible={
          showScrollBottom && chat.length > 0 && !activeClarify && !activeBrief && !activePartial
        }
        lang={lang}
        onClick={() => {
          stickToBottomRef.current = true
          scrollToBottom()
        }}
      />

      {activeClarify && (
        <div className="ai-composer">
          <ClarifyCard
            questions={activeClarify}
            onSubmit={(answers, qa) => {
              const idx = chat.map((c) => c.role).lastIndexOf('user')
              clarifyResolverRef.current?.({ answers })
              clarifyResolverRef.current = null
              setActiveClarify(null)
              setReceipts((prev) => [...prev, { afterIdx: idx, qa }])
            }}
            onSkip={() => {
              clarifyResolverRef.current?.({ answers: '', cancelled: true })
              clarifyResolverRef.current = null
              setActiveClarify(null)
            }}
          />
        </div>
      )}
      {activeBrief && !activeClarify && (
        <div className="ai-composer">
          <BriefCard
            key={activeBrief.core_hook + activeBrief.sections.length}
            brief={activeBrief}
            onDecide={(decision) => {
              const idx = chat.map((c) => c.role).lastIndexOf('user')
              if (decision.kind === 'confirmed') {
                depsRef.current.onBriefConfirmed(decision.brief)
                setReceipts((prev) => [...prev, { afterIdx: idx, brief: decision.brief }])
              }
              briefResolverRef.current?.(decision)
              briefResolverRef.current = null
              setActiveBrief(null)
            }}
          />
        </div>
      )}
      {activePartial && !activeClarify && !activeBrief && (
        <div className="ai-composer">
          <div className="brief-card ai-partial-card" role="group" aria-label={t('aiPartialTitle')}>
            <div className="ai-partial-title">{t('aiPartialTitle')}</div>
            <div className="ai-partial-body">
              {t('aiPartialBody', { lines: activePartial.lines })}
            </div>
            <div className="brief-actions">
              <button type="button" className="brief-btn" onClick={() => decidePartial(false)}>
                {t('aiPartialDiscard')}
              </button>
              <button
                type="button"
                className="brief-btn primary"
                onClick={() => decidePartial(true)}
              >
                {t('aiPartialAdopt')}
              </button>
            </div>
          </div>
        </div>
      )}
      {(sendGate.connectChoice || sendGate.noticeDue) && (
        <div className="ai-composer">
          {sendGate.connectChoice ? (
            <AiConnectPrompt
              choice={sendGate.connectChoice}
              statuses={subscription.statuses}
              lang={lang}
              disabled={subscription.busy}
              attention={sendGate.connectAttention}
              onOpenSettings={() => void window.htmlApi.openAiModelSettings().catch(() => {})}
              onInstall={subscription.install}
              onUpdate={subscription.update}
              onCancelLogin={subscription.cancelLogin}
              onLogin={subscription.login}
              onRecheck={subscription.recheck}
              onAcceptMetered={subscription.acceptMetered}
              onOpenInstallHelp={subscription.openInstallHelp}
              onOpenConnectHelp={subscription.openConnectHelp}
            />
          ) : (
            <AiFirstConnectionNotice
              lang={lang}
              codexKeepsHistory
              onAcknowledge={sendGate.acknowledgeNotice}
            />
          )}
        </div>
      )}
      <div
        className="ai-composer"
        style={activeClarify || activeBrief || activePartial ? { display: 'none' } : undefined}
      >
        {chat.length === 0 && docEmpty && (
          <div className="ai-intent-bar">
            <div className="ai-intent-label">{t('aiIntentLabel')}</div>
            <div className="ai-intent-cards" role="radiogroup" aria-label={t('aiIntentLabel')}>
              {(
                [
                  ['design', 'aiIntentDesign', 'aiIntentDesignDesc'],
                  ['write', 'aiIntentWrite', 'aiIntentWriteDesc'],
                ] as const
              ).map(([kind, title, desc]) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={intent === kind}
                  className={`ai-intent-card${intent === kind ? ' selected' : ''}`}
                  data-tip={t(desc)}
                  onClick={() => {
                    setIntent(kind)
                    inputRef.current?.focus()
                  }}
                >
                  <span className="ai-intent-card-icon" aria-hidden>
                    {kind === 'design' ? (
                      <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                        <rect x="2.5" y="2.5" width="15" height="15" rx="2.5" />
                        <path d="M2.5 7.5h15M7.5 7.5v10" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                        <path d="M4 15.5h12M4 4.5h12M4 8.2h12M4 11.8h8" />
                      </svg>
                    )}
                  </span>
                  <span className="ai-intent-card-title">{t(title)}</span>
                  {intent === kind && (
                    <span className="ai-intent-card-check" aria-hidden>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5.2l2.2 2.2L8 3" />
                      </svg>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
        {editQueue.length > 0 && (
          <EditQueueCard
            items={editQueue}
            text={deps.access.getText()}
            map={deps.access.getMap()}
            busy={busy}
            onEditInstruction={onQueueEditInstruction}
            onRemove={onQueueRemove}
            onDiscardAll={onQueueClear}
            onFocus={onQueueFocus}
            onSend={sendQueue}
          />
        )}
        {attachments.length > 0 && (
          <div className="ai-attachments">
            <AttachmentList
              atts={attachments}
              previews={attachmentPreviews}
              onRemove={removeAttachment}
              removeLabel={t('aiRemoveAttachmentTitle')}
            />
          </div>
        )}
        {attachNotice && <div className="ai-attach-notice">{attachNotice}</div>}
        {inputTruncated && (
          <AiInputTruncatedNotice lang={lang} onDismiss={() => setInputTruncated(false)} />
        )}
        {aiSettings !== null && localModelCapabilities(aiSettings).tools === false && (
          <AiToolsUnsupportedNotice lang={lang} />
        )}
        {projectLines}
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
          value={prompt}
          busy={busy}
          placeholder={t('aiComposerPlaceholder')}
          hintIdle={t('aiHintIdle')}
          hintBusy={t('aiHintBusy')}
          sendLabel={t('aiSend')}
          stopLabel={t('aiStop')}
          iconOnly
          lang={lang}
          showSkillButton
          sendIconEnabled={<IconArrowUp size={15} />}
          sendIconDisabled={<IconArrowUp size={15} />}
          stopIcon={<IconStop size={12} />}
          textareaRef={inputRef}
          onChange={setPrompt}
          onSend={sendDraft}
          onStop={stop}
          skills={skills.composer}
          docs={docMention}
          onPasteFiles={(files) => void onPasteFiles(files)}
          onPasteText={onPasteText}
          footerBelow={projectPicker}
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

function Svg({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

function IconNewChat(): ReactElement {
  return (
    <Svg>
      <path
        d="M13.5 7.2v-3A1.7 1.7 0 0 0 11.8 2.5H4.2a1.7 1.7 0 0 0-1.7 1.7v6.1a1.7 1.7 0 0 0 1.7 1.7h1.1v2l2.6-2h1.3"
        strokeLinejoin="round"
      />
      <path d="M12.2 9.4v4M10.2 11.4h4" />
    </Svg>
  )
}

function IconCollapse(): ReactElement {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
      <path d="M5.5 2.5v11" />
      <path d="M12.5 8H8.1M9.8 5.9 7.7 8l2.1 2.1" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}
