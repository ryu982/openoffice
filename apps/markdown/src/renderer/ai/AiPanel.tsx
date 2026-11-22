import {
  aiPanelWidthAtPointer,
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
  useSubscriptionUsageUpdates,
} from '@genoffice/ui'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react'
import {
  AgentLoop,
  streamText,
  type IpcStreamError,
  type MindMapTreeNode,
  composeWithDrive,
  windowMcpState,
  windowMcpUsableServers,
  toolStepLabel,
} from '@genoffice/agent-core'
import type {
  AiSettings,
  AiSubscriptionProviderId,
  AiSubscriptionUsage,
} from '@genoffice/ai-provider/browser'
import { localModelCapabilities } from '@genoffice/ai-provider/browser'
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
  McpPermissionCard,
  McpServerButton,
  useMcpWindow,
  useChatRunQueue,
  NO_SKILL_USE,
  SentSkillChips,
  skillChipRefsOf,
  useComposerSkills,
  panelUserSkills,
  panelProjectSkill,
  placeRemoteEntries,
  useProjectPanel,
  SkillUsedNotes,
  useSkillProposals,
  useSkillTemplates,
  type TemplateDocument,
  type AiScopeQuoteData,
  type AiTokenUsageView,
  type SkillChipRef,
  type SkillUse,
  type ProjectChatEntry,
  type ProjectChatOpened,
  type ProjectMemoryLine,
} from '@genoffice/ui'
import type { Editor } from '@tiptap/core'
import { aiLangDirective, t as tGlobal, useI18n } from '../i18n/locale'
import { aiMarks, clearAiHighlights } from '../editor/aiHighlight'
import { setInactiveSelectionShown } from '../editor/inactiveSelection'
import { uiOp } from '../editor/ops'
import { createMarkdownSkill, MARKDOWN_RULES } from './markdown-skill'
import { MindMapCard } from './MindMapCard'
import { mindMapToMermaid } from '@genoffice/agent-core/mind-map'
import {
  buildDocWriterRequest,
  countMarkdownBlocks,
  DOC_MAX_CHARS,
  extractMarkdown,
  type DocWriteResult,
  type DocWriteSpec,
} from './doc-writer'
import { createSearchSkill } from './search-skill'
import { createElectronTransport } from './transport'
import { blockedRunOf, readImageGenerationAvailable, type AiBlockedRun } from './ai-connection'
import { useSubscriptionConnection } from './subscription-client'
import { EditQueueCard } from './EditQueueCard'
import {
  buildQueueInstruction,
  buildQueueSummary,
  liveItems,
  resolveQueue,
  type EditQueueItem,
} from './edit-queue'
import { DOC_NAV_SCHEME, navigateToBlock, parseDocNavHref } from './doc-nav'

/** Another editor's tool records on a reopened message, shown as one line */
type OtherEditorTools = NonNullable<ProjectChatEntry['otherEditorTools']>

// Word-parity count (docs word-count.ts): Asian chars one by one + non-Asian words
const ASIAN_RE =
  /[ᄀ-ᇿ⺀-⿟、-〿぀-ヿ㄀-ㄯ㄰-㆏㇀-ㇿ㐀-䶿一-鿿가-힯豈-﫿！-｠￠-￦]|[\uD840-\uD87F][\uDC00-\uDFFF]/g
const NON_ASIAN_WORD_RE = /[A-Za-z0-9À-ɏ]+(?:['-][A-Za-z0-9À-ɏ]+)*/g

function countWords(text: string): number {
  return (text.match(ASIAN_RE) ?? []).length + (text.match(NON_ASIAN_WORD_RE) ?? []).length
}

const PANEL_WIDTH_KEY = 'markdown-ai-panel-width'
const PANEL_WIDTH_DEFAULT = 360
const PANEL_WIDTH_MIN = 280
const MAX_SNAPSHOTS = 20
const TOOL_OUTPUT_MAX_CHARS = 2000
/** progress chip refresh while a write streams */
const CHIP_UPDATE_MS = 400

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
  isError?: boolean
  output?: string
}

interface ChatEntry {
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean
  isError?: boolean
  /** the run stopped because its connection cannot go on (limit used up, signed out, …) */
  blocked?: AiBlockedRun
  /** the run failed and this user message was rolled back out of the model context */
  undelivered?: boolean
  tools?: ToolActivity[]
  /** interactive mind map from generate_mindmap's side-channel display (session-only;
   * the persisted transcript keeps the tool call, so a reopened file can regenerate) */
  mindmap?: MindMapTreeNode
  /** the selection this user message targeted, frozen at send */
  scope?: AiScopeQuoteData
  /** skill chips this user message carried */
  skills?: SkillChipRef[]
  /** skill cards the model proposed in this turn (keys of useSkillProposals) */
  skillProposals?: string[]
  /** tokens the provider billed for this reply, summed across its turns (absent when unreported) */
  usage?: AiTokenUsageView
  /** project memory lines of a reopened project message (live ones come from its tools) */
  memory?: ProjectMemoryLine[]
  /** another editor's tools on a reopened project message: one summary line */
  otherEditorTools?: OtherEditorTools
  /** the run this reply ends changed the document (session-only, not persisted) */
  changes?: RunChanges
}

interface MarkdownChangeLine extends AiChangeLine {
  block?: number
}

const MAX_MD_CHANGE_LINES = 24

function clipLineText(text: unknown, max = 56): string {
  if (typeof text !== 'string') return ''
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact
}

function mdChangeLinesFromTool(
  name: string,
  input: Record<string, unknown>,
  summary: string,
): MarkdownChangeLine[] {
  if (name === 'apply_ops' && Array.isArray(input.ops)) {
    const out: MarkdownChangeLine[] = []
    for (const raw of input.ops) {
      if (!raw || typeof raw !== 'object') continue
      const op = raw as Record<string, unknown>
      const kind = typeof op.op === 'string' ? op.op : ''
      const target =
        op.target && typeof op.target === 'object' ? (op.target as Record<string, unknown>) : null
      const block =
        typeof target?.start === 'number'
          ? target.start
          : typeof op.after === 'number'
            ? op.after + 1
            : typeof op.index === 'number'
              ? op.index
              : undefined
      if (kind === 'setFrontmatter') {
        out.push({ kind: 'named', to: 'Frontmatter', showable: false })
      } else if (kind === 'replaceText') {
        out.push({
          kind: 'replace',
          from: clipLineText(op.find),
          to: clipLineText(op.replace),
          showable: block !== undefined,
          block,
        })
      } else if (kind === 'insertContent' || kind === 'insertBlocks') {
        out.push({
          kind: 'insert',
          to: clipLineText(op.markdown ?? op.text ?? kind),
          showable: block !== undefined,
          block,
        })
      } else if (kind === 'deleteBlocks' || kind === 'deleteRange') {
        out.push({
          kind: 'delete',
          from: block !== undefined ? `Block ${block + 1}` : kind,
          showable: false,
        })
      } else if (kind) {
        out.push({
          kind: 'named',
          from: block !== undefined ? `Block ${block + 1}` : undefined,
          to: clipLineText(op.markdown ?? op.text ?? kind),
          showable: block !== undefined,
          block,
        })
      }
    }
    return out
  }
  return [{ kind: 'named', to: clipLineText(summary || name), showable: true, block: 0 }]
}

/**
 * What one run changed, on its last reply. The run is taken back by restoring
 * the snapshot taken before its first change, which also takes back every
 * later run (and anything typed since), so those cards turn 'reverted' too.
 */
interface RunChanges {
  /** the snapshot it restores (ids grow with each run) */
  id: number
  state: AiChangesState
  /** top-level blocks the run marked, when that is every place it changed */
  count?: number
  /** per-edit change summary lines for the diff card */
  lines?: MarkdownChangeLine[]
}

/** A project chat message as this panel shows it */
function entryFromProject(m: ProjectChatEntry & { skillProposals?: string[] }): ChatEntry {
  return {
    role: m.role,
    text: m.text,
    tools: m.tools?.map((tool) => ({
      name: tool.name,
      summary: tool.summary,
      isError: tool.isError,
      output: tool.output ? tool.output.slice(0, TOOL_OUTPUT_MAX_CHARS) : undefined,
    })),
    ...(m.scope ? { scope: m.scope } : {}),
    ...(m.role === 'user' && skillChipRefsOf(m.skills).length > 0
      ? { skills: skillChipRefsOf(m.skills) }
      : {}),
    ...(m.skillProposals ? { skillProposals: m.skillProposals } : {}),
    ...(m.memory.length > 0 ? { memory: m.memory } : {}),
    ...(m.otherEditorTools ? { otherEditorTools: m.otherEditorTools } : {}),
  }
}

/** an apply_ops input that writes the properties block, which no mark on the page can show */
function setsFrontmatter(input: Record<string, unknown>): boolean {
  const ops = input.ops
  return (
    Array.isArray(ops) && ops.some((op) => (op as { op?: unknown } | null)?.op === 'setFrontmatter')
  )
}

/** longest selection excerpt echoed on a user bubble */
const SCOPE_TEXT_MAX = 200

/** structured, not the serialized file text: a body starting with `---` must
 *  never be re-parsed as a frontmatter block on rollback */
export interface DocSnapshot {
  /** document body as markdown */
  body: string
  /** raw frontmatter block (fences included), kept byte-for-byte */
  frontmatter: string
}

interface Snapshot {
  id: number
  doc: DocSnapshot
}

/** Ribbon preset instruction; a new nonce triggers one auto-send */
export interface AiPreset {
  text: string
  nonce: number
}

export interface MarkdownAiDeps {
  getEditor(): Editor | null
  /** inner YAML of the properties block, read synchronously (write-then-read within one run) */
  getFrontmatter(): string
  /** replace the properties block; empty string removes it */
  setFrontmatter(inner: string): void
  /** document body + frontmatter, for pre-mutation snapshots */
  getSnapshot(): DocSnapshot
  /** rollback: replace the document (body and frontmatter) with a snapshot */
  restoreSnapshot(snapshot: DocSnapshot): void
  /** fired when a run with at least one mutation finishes (auto-save hook) */
  onRunDone(mutated: boolean): void
}

const MODEL_BRIDGE: AiModelPickerBridge = {
  getSettings: () => window.markdownApi.getAiSettings(),
  setSettings: (settings) => window.markdownApi.setAiSettings(settings),
  onSettingsChanged: (handler) => window.markdownApi.onAiSettingsChanged(handler),
  openModelSettings: () => window.markdownApi.openAiModelSettings().catch(() => {}),
}

export function AiPanel({
  deps,
  filePath,
  preset,
  onCollapse,
  editQueue = [],
  onQueueEditInstruction,
  onQueueRemove,
  onQueueClear,
  onQueueFocus,
  onQueueConsume,
  templateDocument,
  onSkillHandoff,
}: {
  deps: MarkdownAiDeps
  filePath: string | null
  preset?: AiPreset | null
  onCollapse: () => void
  /** queued selection-scoped edits (owned by App, which also owns the anchors) */
  editQueue?: EditQueueItem[]
  onQueueEditInstruction?: (qid: string, instruction: string) => void
  onQueueRemove?: (qid: string) => void
  onQueueClear?: () => void
  onQueueFocus?: (qid: string) => void
  onQueueConsume?: (qids: string[]) => void
  /** the document while it can go along as a skill's template (spec 5.7) */
  templateDocument?: TemplateDocument | null
  /** this tab took a request handed over by the template flow: show the panel */
  onSkillHandoff?: () => void
}): ReactElement {
  const { lang, t } = useI18n()
  const [chat, setChat] = useState<ChatEntry[]>([])
  /** a streamed write stopped early: the draft stays in the document until the user keeps or discards it */
  const [activePartial, setActivePartial] = useState<{ blocks: number } | null>(null)
  const partialResolverRef = useRef<((keep: boolean) => void) | null>(null)
  /** bumped by New chat / unmount: a writer resuming after its abort must not open the keep card */
  const writerEpochRef = useRef(0)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  /** messages queued while a reply runs; the pump re-runs them through send on settle */
  const msgQueue = useChatRunQueue<{ skillUse: SkillUse }>({
    busy,
    submit: (text, meta) => {
      const loop = loopRef.current
      if (!loop || loop.busy) return false
      // nothing can run right now: the message stays queued, and in front of "not connected"
      // the queue is paused so it does not start by itself after a sign-in
      if (!sendGateRef.current.admitQueued(() => msgQueueRef.current.setPaused(true))) return false
      return send(text, text, null, meta.skillUse)
    },
  })
  const msgQueueRef = useRef(msgQueue)
  msgQueueRef.current = msgQueue
  /** this window's MCP servers (user MCP spec 7.5); the chips name the ones not usable now */
  const mcpWindow = useMcpWindow()
  /** the skills called with `/` or `$`: the list, the chips and the text a request gets */
  const skills = useComposerSkills({
    lang,
    editor: 'markdown',
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
    editor: 'markdown',
    cards: skillCards,
    busy,
    send: (text, use) => send(text, undefined, undefined, use),
    // a template skill called in a document with content asks where to run
    hasContent: () => {
      const doc = deps.getSnapshot()
      return doc.body.trim() !== '' || doc.frontmatter.trim() !== ''
    },
    onTaken: onSkillHandoff,
    setComposer: setPrompt,
  })
  const skillTemplatesRef = useRef(skillTemplates)
  skillTemplatesRef.current = skillTemplates
  /** the skills of the last send: a retry sends the same skill text */
  const lastSkillUseRef = useRef<SkillUse>(NO_SKILL_USE)
  /** the snapshots the change cards restore, oldest first; a card whose snapshot was pushed out is 'expired' */
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const nextSnapshotIdRef = useRef(1)
  /** taken before the in-flight run's first change; becomes its card's snapshot when the run ends */
  const runSnapshotRef = useRef<DocSnapshot | null>(null)
  /** the in-flight run changed something its marks cannot show (the properties block) */
  const runUnmarkedRef = useRef(false)
  /** detailed change lines accumulated during the active run */
  const runChangeLinesRef = useRef<MarkdownChangeLine[]>([])
  // bumped on selection/doc changes so the scope chip & queue rows stay fresh
  const [, setScopeTick] = useState(0)
  /** the scope chip's expandable preview of the selected text */
  const [scopePreviewOpen, setScopePreviewOpen] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickToBottomRef = useRef(true)
  const {
    showButton: showScrollBottom,
    onScroll: onScrollBottom,
    scrollToBottom,
  } = useScrollToBottom(chatRef)
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
  /** the settings as last read, for what the panel shows and gates (settingsRef stays the run's own copy) */
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const applyAiSettings = (next: AiSettings): void => {
    setAiSettings(next)
  }
  /** connection of the two subscription providers, and the actions of their connect cards */
  const subscription = useSubscriptionConnection()
  const statuses = subscription.statuses
  const refreshSubscriptionRef = useRef(subscription.refresh)
  refreshSubscriptionRef.current = subscription.refresh
  /** The send gate every editor shares: holds a request made during a status check or in front
      of the first-connection notice, refuses in front of "not connected", and writes this
      panel's settings changes ("continue with …", the acknowledged notice) onto the stored ones */
  const sendGate = useAiSendGate<{
    text: string
    displayText: string | undefined
    retryScope: AiScopeQuoteData | null | undefined
    skillUse: SkillUse
  }>({
    settings: aiSettings,
    statuses,
    store: MODEL_BRIDGE,
    start: (held) => {
      send(held.text, held.displayText, held.retryScope, held.skillUse)
    },
    onNotConnected: () => refreshSubscriptionRef.current(),
    onSettingsSaved: applyAiSettings,
  })
  const sendGateRef = useRef(sendGate)
  sendGateRef.current = sendGate
  /** whether generate_image can run, as the main process answers (refreshed with the settings and before each run) */
  const imageGenAvailableRef = useRef(false)
  const refreshImageGenAvailable = (): Promise<void> =>
    readImageGenerationAvailable(() => window.markdownApi.aiToolCapabilities()).then(
      (available) => {
        imageGenAvailableRef.current = available
      },
    )
  useEffect(() => {
    let alive = true
    // tests render the panel without a full preload bridge: a missing call must not take it down
    const refresh = () => {
      Promise.resolve()
        .then(() => window.markdownApi.getAiSettings())
        .then(
          (next) => {
            if (alive) applyAiSettings(next)
          },
          () => {},
        )
      void refreshImageGenAvailable()
    }
    const onFocus = () => {
      refresh()
      // a sign-in or install finished outside the app shows up once the window is back
      if (sendGateRef.current.peek().kind === 'connect') refreshSubscriptionRef.current()
    }
    refresh()
    window.addEventListener('focus', onFocus)
    let off: (() => void) | undefined
    try {
      off = window.markdownApi.onAiSettingsChanged?.(refresh)
    } catch {
      off = undefined
    }
    return () => {
      alive = false
      window.removeEventListener('focus', onFocus)
      off?.()
    }
  }, [])
  // a connection that came or went changes which image route can run
  useEffect(() => {
    void refreshImageGenAvailable()
  }, [statuses])
  /** the transport's structured copy of its last failure; onError matches it to its message */
  const streamErrorRef = useRef<IpcStreamError | null>(null)
  /** usage windows the subscription program reported last */
  const [subscriptionUsage, setSubscriptionUsage] = useState<AiSubscriptionUsage[]>([])
  // usage a picture request reported reaches every window (the chat stream only its own);
  // the shared merge keeps the windows a report does not name
  useSubscriptionUsageUpdates(() => window.markdownApi.aiSubscription, setSubscriptionUsage)
  /** the input of the last run was cut to fit a limit */
  const [inputTruncated, setInputTruncated] = useState(false)
  const langRef = useRef(lang)
  langRef.current = lang
  const depsRef = useRef(deps)
  depsRef.current = deps
  const filePathRef = useRef(filePath)
  /** instruction of the in-flight run, labels its rollback snapshot */
  const runInstructionRef = useRef('')
  /** what the user saw for that instruction (queue submissions show a summary) */
  const runDisplayRef = useRef('')
  /** the scope quote of the last send, so a retry reuses it instead of re-reading the live selection */
  const lastScopeRef = useRef<AiScopeQuoteData | undefined>(undefined)
  const runMutatedRef = useRef(false)
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
      scope?: AiScopeQuoteData
      skills?: SkillChipRef[]
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

  /**
   * The project folder (spec 5): the chip under the input, the header's chat
   * menu, the notices, and where the chat is recorded. Without a chosen
   * project everything below runs exactly as before.
   */
  const projectPanel = useProjectPanel({
    editor: 'markdown',
    lang,
    busy,
    loop: () => loopRef.current,
    onOpen: (opened) => openProjectChat(opened),
    onRemoteMessages: (entries, running) =>
      setChat((prev) =>
        placeRemoteEntries(
          prev,
          entries.map((entry) => entryFromProject(entry)),
          running,
        ),
      ),
    onNewChat: () => startNewChat(),
    consolidation: async () => {
      // the same gate as a send: nothing goes out until a provider can run
      if (!sendGateRef.current.admitQueued(() => {})) {
        showWhatHoldsTheSend()
        return null
      }
      settingsRef.current = await window.markdownApi.getAiSettings()
      return { transport: transportRef.current!, gate: sendGateRef.current.peek }
    },
  })
  const projectPanelRef = useRef(projectPanel)
  projectPanelRef.current = projectPanel

  const persistMessage = (
    role: 'user' | 'assistant',
    text: string,
    tools?: ToolActivity[],
    scope?: AiScopeQuoteData,
    skillChips?: SkillChipRef[],
  ) => {
    // a chosen project (or this document's earlier chat) records it; otherwise the per-document store
    const recorded = projectPanelRef.current.chat.persist({
      role,
      text,
      ...(tools && tools.length > 0
        ? {
            tools: tools.map((tool) => ({
              name: tool.name,
              summary: tool.summary,
              isError: tool.isError,
              output: tool.output,
            })),
          }
        : {}),
      ...(scope ? { scope } : {}),
      ...(skillChips && skillChips.length > 0 ? { skills: skillChips } : {}),
    })
    if (!recorded) persistToDocument(role, text, tools, scope, skillChips)
  }

  /** the per-document chat store, as before project folders */
  const persistToDocument = (
    role: 'user' | 'assistant',
    text: string,
    tools?: ToolActivity[],
    scope?: AiScopeQuoteData,
    skillChips?: SkillChipRef[],
  ) => {
    const ids = chatIdsRef.current
    if (!window.projectApi) return
    if (!ids) {
      pendingPersistRef.current.push({ role, text, tools, scope, skills: skillChips })
      return
    }
    void window.projectApi
      .appendChat({
        projectId: ids.projectId,
        chatId: ids.chatId,
        role,
        text,
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(scope ? { scope } : {}),
        ...(skillChips && skillChips.length > 0 ? { skills: skillChips } : {}),
      })
      .catch(() => {
        /* persistence failures are silent */
      })
  }

  const transportRef = useRef<ReturnType<typeof createElectronTransport> | null>(null)
  if (!transportRef.current)
    transportRef.current = createElectronTransport(() => settingsRef.current!, {
      lang: () => langRef.current,
      onStreamError: (error) => {
        streamErrorRef.current = error
      },
      onSubscriptionUsage: setSubscriptionUsage,
      onInputTruncated: () => setInputTruncated(true),
    })

  /**
   * Long-form writing: one tool-less request whose reply is the markdown, streamed
   * into the document as a draft by the tool. A stream that stops early leaves the
   * user a keep-or-discard choice; a stream that produced nothing is retried once.
   */
  const runDocWriter = async (
    spec: DocWriteSpec,
    onProgress: (markdown: string) => void,
    signal?: AbortSignal,
  ): Promise<DocWriteResult> => {
    const { system, user } = buildDocWriterRequest(
      spec,
      MARKDOWN_RULES,
      aiLangDirective(langRef.current),
    )
    const epoch = writerEpochRef.current
    let closed = false
    let chipTimer: ReturnType<typeof setTimeout> | null = null
    let latest = ''
    const updateChip = () => {
      chipTimer = null
      if (closed) return
      const blocks = countMarkdownBlocks(latest)
      patchLast((last) => ({
        tools: last.tools?.map((tl) =>
          tl.running ? { ...tl, summary: tGlobal('aiWritingDocument', { blocks }) } : tl,
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
        extract: (raw) => ({ text: extractMarkdown(raw) }),
        onProgress: (markdown) => {
          if (closed) return
          latest = markdown
          onProgress(markdown)
          if (chipTimer === null) chipTimer = setTimeout(updateChip, CHIP_UPDATE_MS)
        },
      })
    let outcome = await attempt()
    if (outcome.status === 'empty' && !signal?.aborted) outcome = await attempt()
    closed = true
    if (chipTimer !== null) clearTimeout(chipTimer)
    if (outcome.status === 'complete') return { ok: true, markdown: outcome.text }
    if (outcome.status === 'empty') return { ok: false, error: outcome.error }
    if (epoch !== writerEpochRef.current) return { ok: false, error: 'the chat was reset' }
    // the draft stays in the document while the user decides
    const keep = await new Promise<boolean>((resolve) => {
      partialResolverRef.current = resolve
      setActivePartial({ blocks: countMarkdownBlocks(outcome.text) })
    })
    return keep
      ? { ok: true, markdown: outcome.text, truncated: true }
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
  useEffect(
    () => () => {
      writerEpochRef.current++
    },
    [],
  )

  /**
   * The card of the run that just ended, if it changed the document: its
   * snapshot joins the ring (the oldest falls out past MAX_SNAPSHOTS) and the
   * count is the blocks its marks sit in, unless something it changed has no mark.
   */
  const takeRunChanges = (): { changes: RunChanges } | Record<string, never> => {
    const doc = runSnapshotRef.current
    const unmarked = runUnmarkedRef.current
    const lines = runChangeLinesRef.current
    runSnapshotRef.current = null
    runUnmarkedRef.current = false
    runChangeLinesRef.current = []
    if (!doc) return {}
    const id = nextSnapshotIdRef.current++
    setSnapshots((prev) => [...prev, { id, doc }].slice(-MAX_SNAPSHOTS))
    const editor = depsRef.current.getEditor()
    const marks = editor ? aiMarks(editor.state) : null
    const count =
      marks && !unmarked && !marks.unmarked && marks.blocks > 0 ? marks.blocks : undefined
    return {
      changes: {
        id,
        state: 'applied',
        ...(count !== undefined ? { count } : {}),
        ...(lines.length > 0 ? { lines } : {}),
      },
    }
  }

  // The loop is built once; every mutable value goes through a ref getter
  const loopRef = useRef<AgentLoop<DocSnapshot> | null>(null)
  if (!loopRef.current) {
    loopRef.current = new AgentLoop<DocSnapshot>({
      transport: transportRef.current,
      // a local model that reported no tool support answers in text only
      toolsAllowed: () =>
        settingsRef.current ? localModelCapabilities(settingsRef.current).tools !== false : true,
      skill: composeWithDrive('markdown+search', '', () => loopRef.current?.messages ?? [], [
        createMarkdownSkill(
          () => depsRef.current.getEditor(),
          {
            read: () => depsRef.current.getFrontmatter(),
            write: (inner) => depsRef.current.setFrontmatter(inner),
          },
          () => imageGenAvailableRef.current,
          () => ({
            write: (spec, onProgress, signal) => runDocWriterRef.current(spec, onProgress, signal),
          }),
        ),
        createSearchSkill(),
        // the person's skills: use_skill, read_skill_file, propose_skill (app-run tools)
        ...panelUserSkills({
          editor: 'markdown',
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
        // the chosen project folder: its context in the system prompt, project_* tools (app-run)
        ...panelProjectSkill({ run: projectPanel.chat.run, lang: () => langRef.current }),
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
            if (runChangeLinesRef.current.length < MAX_MD_CHANGE_LINES) {
              const nextLines = mdChangeLinesFromTool(call.name, call.input, execution.summary)
              runChangeLinesRef.current = [...runChangeLinesRef.current, ...nextLines].slice(
                0,
                MAX_MD_CHANGE_LINES,
              )
            }
          }
          if (snapshotBefore !== undefined) runSnapshotRef.current = snapshotBefore
          if (execution.mutated && setsFrontmatter(call.input)) runUnmarkedRef.current = true
          // mind maps ride the UI-only display side channel onto the message
          const display = execution.display
          const mindmap = display?.kind === 'mindmap' ? display.tree : undefined
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
            return { tools: [...tools, activity], ...(mindmap ? { mindmap } : {}) }
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
          const base = turnLimit
            ? [text, tGlobal('aiTurnLimit')].filter(Boolean).join('\n\n')
            : text || (cancelled ? tGlobal('aiStopped') : '')
          // A reasoning model can spend the entire output budget on thinking and close the
          // turn with finish_reason=length and no prose at all — the bare "(no reply)" read
          // as the assistant ignoring the user. Name the truncation, as docs already does.
          const final = truncated
            ? [base, tGlobal('aiTruncatedNote')].filter(Boolean).join('\n\n')
            : base
          // a cancelled run keeps what it already changed: that gets its card too
          const changed = takeRunChanges()
          patchLast((last) => ({
            streaming: false,
            text: final || (last.tools?.length ? last.text : tGlobal('aiNoReply')),
            // A stop mid-tool can leave a running placeholder behind — drop it
            tools: last.tools?.filter((tl) => !tl.running),
            ...changed,
          }))
          persistMessage('assistant', final, runToolsRef.current)
          projectPanelRef.current.finishSend()
          depsRef.current.onRunDone(runMutatedRef.current)
          setBusy(false)
        },
        onError: (error) => {
          const blocked = blockedRunOf(streamErrorRef.current, error)
          streamErrorRef.current = null
          // a run can fail after it already changed the document: its card stays
          const changed = takeRunChanges()
          if (blocked) {
            // the queue must not fire one message after another into the same wall
            msgQueueRef.current.hold()
            refreshSubscriptionRef.current()
          }
          setChat((prev) => {
            const next = [...prev]
            for (let i = next.length - 1; i >= 0; i--) {
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
          projectPanelRef.current.finishSend()
          setBusy(false)
        },
      },
    })
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      partialResolverRef.current?.(false)
      loopRef.current?.cancel()
      const editor = depsRef.current.getEditor()
      if (editor) clearAiHighlights(editor)
    }
  }, [])

  /** bumped whenever a project chat opens: a per-document load still in flight is dropped */
  const documentChatEpochRef = useRef(0)

  // ── chat-history persistence: bind to the file, restore prior transcript ──
  const loadDocumentChat = (): void => {
    const api = window.projectApi
    if (!api) return
    const epoch = documentChatEpochRef.current
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
              persistToDocument(msg.role, msg.text, msg.tools, msg.scope, msg.skills)
            }
            return ids
          })
    void resolved
      .then((ids) => api.loadChat({ projectId: ids.projectId, chatId: ids.chatId, limit: 200 }))
      .then((stored) => {
        if (stored.length === 0 || epoch !== documentChatEpochRef.current) return
        // skill cards come back closed; a saved card's record is not part of the conversation
        const msgs = skillCardsRef.current.restore(stored)
        // the user may have sent a message while history was loading — never
        // replace a live transcript (and don't clobber the loop context)
        let applied = false
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
            ...(m.scope ? { scope: m.scope } : {}),
            ...(m.role === 'user' && skillChipRefsOf(m.skills).length > 0
              ? { skills: skillChipRefsOf(m.skills) }
              : {}),
            ...(m.skillProposals ? { skillProposals: m.skillProposals } : {}),
          }))
        })
        if (applied && !loopRef.current?.busy) {
          // a reopened conversation starts with no MCP choices of another chat (user MCP spec 7.6)
          windowMcpState()?.newConversation()
          loopRef.current?.restore(msgs.map((m) => ({ role: m.role, text: m.text })))
          // the next request re-reads the current text of the skills this conversation used
          skillsRef.current.restoreHistory(
            msgs.map((m) => (m.role === 'user' ? skillChipRefsOf(m.skills) : undefined)),
          )
        }
      })
      .catch(() => {
        /* history load failures are silent */
      })
  }
  useEffect(() => {
    loadDocumentChat()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, [])

  /** the conversation on screen, in the loop and in the composer's helpers goes away */
  const resetConversation = (): void => {
    stop()
    abandonWriter()
    msgQueue.clear()
    sendGate.reset()
    loopRef.current?.reset()
    // servers off in this chat and "always allow in this chat" go too (user MCP spec 7.6)
    windowMcpState()?.newConversation()
    setBusy(false)
    setChat([])
    // the cards go with the chat, and the snapshots and marks with them
    setSnapshots([])
    runSnapshotRef.current = null
    clearMarks()
    skills.resetConversation()
    skillCards.reset()
    skillTemplates.reset()
  }

  /** "New chat": a new project chat when a project is chosen, else the reset as before */
  const startNewChat = (): void => {
    resetConversation()
    void projectPanelRef.current.chat.newChat()
  }

  /** a project chat, this document's earlier chat, or (no project) the per-document chat */
  const openProjectChat = (opened: ProjectChatOpened): void => {
    documentChatEpochRef.current++
    resetConversation()
    if (opened.kind === 'document') {
      loadDocumentChat()
      return
    }
    // skill cards come back closed; a saved card's record is not part of the conversation
    const msgs = skillCardsRef.current.restore(opened.entries)
    setChat(msgs.map((m) => entryFromProject(m)))
    loopRef.current?.restore(msgs.map((m) => ({ role: m.role, text: m.text })))
    skillsRef.current.restoreHistory(
      msgs.map((m) => (m.role === 'user' ? skillChipRefsOf(m.skills) : undefined)),
    )
  }

  /** the path the document had when the panel last looked: a new one is a save (as) */
  const savedPathRef = useRef(filePath)
  /** after an untitled document's first save, bind the unsaved-* history to the real path */
  useEffect(() => {
    if (filePath && filePath !== savedPathRef.current) {
      void projectPanelRef.current.chat.documentSaved()
    }
    savedPathRef.current = filePath
    filePathRef.current = filePath
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
  }, [chat, busy, inputTruncated])

  const onChatScroll = (): void => {
    const el = chatRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    onScrollBottom()
  }

  /**
   * No run was started: the connect prompt / the first-connection notice at the
   * end of the chat is the answer, so it is brought into view.
   */
  const showWhatHoldsTheSend = (): void => {
    stickToBottomRef.current = true
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
  }

  /**
   * retryScope: null = a retry that had no scope; undefined = capture the live selection.
   * Returns false when no run was started (the text stays with the caller).
   */
  const send = (
    text: string,
    displayText?: string,
    retryScope?: AiScopeQuoteData | null,
    /** the chosen skills: their text goes to the model, their chips onto the bubble */
    skillUse: SkillUse = NO_SKILL_USE,
  ): boolean => {
    const instruction = text.trim()
    const loop = loopRef.current
    if (!instruction || !loop || loop.busy) return false
    // A request made during a status check or in front of the first-connection notice is
    // held and starts by itself once the way is clear; in front of "not connected" nothing
    // is kept. Either way nothing is sent now and the text stays with the caller.
    if (!sendGate.admit({ text: instruction, displayText, retryScope, skillUse })) {
      showWhatHoldsTheSend()
      return false
    }
    stickToBottomRef.current = true
    streamErrorRef.current = null
    setInputTruncated(false)
    runInstructionRef.current = instruction
    runDisplayRef.current = displayText ?? instruction
    runMutatedRef.current = false
    runSnapshotRef.current = null
    runUnmarkedRef.current = false
    runChangeLinesRef.current = []
    // the marks show what the last run changed: a new run starts with none
    clearMarks()
    runToolsRef.current = []
    runUsageRef.current = undefined
    // a queue batch carries its own display text: no selection quote
    const scope =
      retryScope !== undefined
        ? (retryScope ?? undefined)
        : displayText === undefined
          ? selectionScopeQuote()
          : undefined
    lastScopeRef.current = scope
    // the popover input / composer own the DOM selection now: keep the targeted range visible until the run ends
    if (scope) setInactiveSelectionShown(depsRef.current.getEditor(), true)
    setChat((prev) => [
      ...prev,
      {
        role: 'user',
        text: displayText ?? instruction,
        ...(scope ? { scope } : {}),
        ...(skillUse.chips.length > 0 ? { skills: skillUse.chips } : {}),
      },
      { role: 'assistant', text: '', streaming: true },
    ])
    setPrompt('')
    skillsRef.current.consume(skillUse)
    lastSkillUseRef.current = skillUse
    skillTemplatesRef.current.noteRequest(displayText ?? text)
    setBusy(true)
    // persist what the user saw — a restored transcript must not surface the
    // internal batch protocol text behind a queue submission
    persistMessage('user', displayText ?? instruction, undefined, scope, skillUse.chips)
    void (async () => {
      try {
        const [settings] = await Promise.all([
          window.markdownApi.getAiSettings(),
          refreshImageGenAvailable(),
        ])
        settingsRef.current = settings
        if (!mountedRef.current) return
        applyAiSettings(settings)
        // the chosen project's context for this request (after the send gate, right before the run)
        await projectPanelRef.current.prepareSend()
        if (!mountedRef.current) return
        // the skill text rides with this request only; the bubble and the record keep the chips
        await loop.run(instruction + skillUse.text)
      } catch (err) {
        projectPanelRef.current.finishSend()
        if (!mountedRef.current) return
        patchLast({
          streaming: false,
          text: err instanceof Error ? err.message : String(err),
          isError: true,
        })
        setBusy(false)
      }
    })()
    return true
  }

  const stop = (): void => {
    msgQueue.hold()
    loopRef.current?.cancel()
  }

  /** the composer's typed text: the chosen skills ride along */
  const sendTyped = () => {
    const text = prompt.trim()
    if (!text) return
    skills.withSkills(text, (skillUse) => send(text, undefined, undefined, skillUse))
  }

  /** Enter while a reply runs: the draft joins the queue above the composer */
  const enqueueDraft = () => {
    const text = prompt.trim()
    if (!text) return
    skills.withSkills(text, (skillUse) => enqueueWith(text, skillUse))
  }
  const enqueueWith = (text: string, skillUse: SkillUse) => {
    skillsRef.current.consume(skillUse)
    msgQueue.enqueue(text, { skillUse })
    setPrompt('')
  }

  const retry = (): void => {
    send(
      runInstructionRef.current,
      runDisplayRef.current,
      lastScopeRef.current ?? null,
      lastSkillUseRef.current,
    )
  }

  /** a rerun of the last user bubble sends the last send's skill text again */
  const retrySkillUse = (entry: ChatEntry): SkillUse =>
    entry === [...chat].reverse().find((e) => e.role === 'user')
      ? lastSkillUseRef.current
      : NO_SKILL_USE

  /** "Continue with …" on a blocked run: that provider becomes the selection, then the request reruns */
  const continueWith = (provider: AiSubscriptionProviderId): void =>
    sendGate.continueWith(provider, retry)

  // keep the scope chip & queue rows in sync with the editor selection/content
  useEffect(() => {
    const editor = depsRef.current.getEditor()
    if (!editor) return
    const bump = () => {
      if (editor.state.selection.empty) setScopePreviewOpen(false)
      setScopeTick((tick) => tick + 1)
    }
    editor.on('selectionUpdate', bump)
    editor.on('update', bump)
    return () => {
      editor.off('selectionUpdate', bump)
      editor.off('update', bump)
    }
  }, [])

  // scope chip data, recomputed per render (the scope tick above keeps it fresh)
  const editor = depsRef.current.getEditor()
  const liveSelection = editor?.state.selection
  const selectionText =
    !editor || !liveSelection || liveSelection.empty
      ? ''
      : editor.state.doc.textBetween(liveSelection.from, liveSelection.to, '\n', ' ').trim()
  const hasScopeSelection = selectionText.length > 0
  // whether the marks of the last run are on the page (the scope tick re-renders on edits and clears)
  const marksShown = !!editor && !editor.isDestroyed && aiMarks(editor.state).shown
  /** the newest reply with a changes card: only its run's changes are marked */
  const latestChangesIdx = chat.map((entry) => entry.changes !== undefined).lastIndexOf(true)

  /** the × on the scope chip: collapse the selection so the run targets the whole document */
  const clearScopeSelection = (): void => {
    if (editor) editor.commands.setTextSelection(editor.state.selection.to)
  }

  const selectionScopeQuote = (): AiScopeQuoteData | undefined => {
    const ed = depsRef.current.getEditor()
    if (!ed || ed.state.selection.empty) return undefined
    const { from, to } = ed.state.selection
    const text = ed.state.doc.textBetween(from, to, ' ', ' ').replace(/\s+/g, ' ').trim()
    if (!text) return undefined
    return {
      label: t('aiScopeSelection', { words: countWords(text) }),
      text: text.length > SCOPE_TEXT_MAX ? `${text.slice(0, SCOPE_TEXT_MAX)}…` : text,
    }
  }

  // the frozen-range highlight ends with the run, or as soon as the editor is focused again
  useEffect(() => {
    if (!busy) setInactiveSelectionShown(depsRef.current.getEditor(), false)
  }, [busy])
  useEffect(() => {
    const ed = depsRef.current.getEditor()
    if (!ed) return
    const off = () => setInactiveSelectionShown(ed, false)
    ed.on('focus', off)
    return () => {
      ed.off('focus', off)
    }
  }, [])

  /** [label](mdnav://block/N) links in replies select and scroll to that block */
  const docNav = {
    scheme: DOC_NAV_SCHEME,
    onNavigate: (href: string) => {
      const index = parseDocNavHref(href)
      const current = depsRef.current.getEditor()
      if (index !== null && current) navigateToBlock(current, index)
    },
  }
  // [name](filenav:///abs/path) citations open the cited file in its own app
  const fileNav = createFileNav((path) => {
    void window.markdownApi.openSourcePath(path)
  })

  /** submit every still-anchored queued edit as one batch run */
  const sendQueue = (): void => {
    const loop = loopRef.current
    const current = depsRef.current.getEditor()
    if (!loop || loop.busy || editQueue.length === 0 || !current) return
    // nothing is consumed while no run can start
    if (!sendGate.admitQueued(() => {})) {
      showWhatHoldsTheSend()
      return
    }
    const entries = liveItems(resolveQueue(current, editQueue))
    if (entries.length === 0) {
      onQueueClear?.()
      return
    }
    const instruction = buildQueueInstruction(entries)
    const display = buildQueueSummary(t('aiQueueSubmitted', { count: entries.length }), entries)
    // consumed at send: the run rewrites the anchored passages, which would
    // orphan the anchors anyway; a failed run is retried via the retry action
    onQueueConsume?.(editQueue.map((item) => item.qid))
    send(instruction, display)
  }

  // ribbon presets auto-send; while a run is active they land in the composer instead
  const presetNonceRef = useRef(0)
  useEffect(() => {
    if (!preset || preset.nonce === presetNonceRef.current) return
    presetNonceRef.current = preset.nonce
    if (loopRef.current?.busy || !send(preset.text)) setPrompt(preset.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])

  /** takes the marks of the last run's changes off the document */
  const clearMarks = (): void => {
    const current = depsRef.current.getEditor()
    if (current) clearAiHighlights(current)
    // a clear changes no content, so no editor update re-renders the card
    setScopeTick((tick) => tick + 1)
  }

  /**
   * Takes a run back: the document returns to the snapshot from before the
   * run's first change. That also drops every later run (and edits made since),
   * so their cards turn 'reverted' and their snapshots go.
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
      clearMarks()
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

  return (
    <aside
      ref={asideRef}
      className={`copilot${resizing ? ' ai-panel-resizing' : ''}`}
      style={{ width: '100%' }}
      dir={lang === 'ar' || lang === 'he' ? 'rtl' : undefined}
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
        chatMenu={projectPanel.chatMenu}
        actions={
          <>
            <AiPanelSideButton
              lang={lang}
              onMove={(side) => window.markdownApi.setAiPanelPrefs({ side })}
            />
            {chat.length > 0 && (
              <button
                type="button"
                className="ai-header-btn"
                onClick={startNewChat}
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
            <div className="ai-chat-empty-title">{t('aiEmptyTitle')}</div>
            <div className="ai-chat-empty-body">{t('aiEmptyBody')}</div>
            <div className="ai-starter-list">
              <button
                className="ai-starter"
                onClick={() => {
                  setPrompt(t('aiQuickDraftPrompt'))
                  inputRef.current?.focus()
                }}
              >
                {t('aiQuickDraft')}
              </button>
              <button
                className="ai-starter"
                onClick={() => {
                  setPrompt(t('aiQuickPolishPrompt'))
                  inputRef.current?.focus()
                }}
              >
                {t('aiQuickPolish')}
              </button>
              <button
                className="ai-starter"
                onClick={() => {
                  setPrompt(t('aiQuickMindMapPrompt'))
                  inputRef.current?.focus()
                }}
              >
                {t('aiQuickMindMap')}
              </button>
            </div>
            <AiEmptyHints lang={lang} showSkill={Boolean(skills.composer)} />
          </div>
        )}
        {chat.map((entry, i) => {
          if (entry.role === 'user') {
            return (
              <div key={i} className="ai-msg ai-msg-user">
                {entry.scope && <AiScopeQuote scope={entry.scope} />}
                <SentSkillChips lang={lang} chips={entry.skills} isAvailable={skills.isAvailable} />
                <span dir="auto">{entry.text}</span>
                {entry.undelivered && (
                  <div className="ai-msg-undelivered">
                    {t('aiUndelivered')}
                    {!busy && (
                      <button
                        className="ai-retry-btn"
                        onClick={() =>
                          send(entry.text, undefined, entry.scope ?? null, retrySkillUse(entry))
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
          if (
            !entry.text &&
            !entry.streaming &&
            !hasTools &&
            !entry.otherEditorTools &&
            !entry.changes
          )
            return null
          const isLast = i === chat.length - 1
          // Action row appears once per completed reply: on the turn's final segment only
          // (mid-turn segments have a following assistant entry; the live turn ends when !busy)
          const nextEntry = chat[i + 1]
          const turnEnded = nextEntry ? nextEntry.role === 'user' : !busy
          const showToolbar = !entry.streaming && turnEnded && !!entry.text && !entry.isError
          const blocked = entry.blocked
          return (
            <div
              key={i}
              className={`ai-msg ai-msg-assistant${entry.isError && !blocked ? ' ai-msg-error' : ''}${entry.streaming ? ' ai-msg-streaming' : ''}`}
            >
              {hasTools && <AiWorkSteps lang={lang} steps={entry.tools!} />}
              {blocked ? (
                <AiBlockedNotice
                  kind={blocked.kind}
                  provider={blocked.provider}
                  resetsAt={blocked.resetsAt}
                  message={entry.text}
                  settings={aiSettings ?? {}}
                  // the continue button belongs to the run that just stopped, not to older replies
                  statuses={isLast && !busy ? (statuses ?? {}) : {}}
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
              {entry.mindmap && (
                <MindMapCard
                  tree={entry.mindmap}
                  onAsk={(label) => {
                    setPrompt(t('aiMindMapAskPrompt', { label }))
                    inputRef.current?.focus()
                  }}
                  onJumpBlock={(index) => {
                    const current = depsRef.current.getEditor()
                    if (current) navigateToBlock(current, index)
                  }}
                  onInsert={() => {
                    const current = depsRef.current.getEditor()
                    if (!current || !entry.mindmap) return
                    uiOp(current, {
                      op: 'insertContent',
                      after: current.state.doc.childCount - 1,
                      markdown: ['```mermaid', mindMapToMermaid(entry.mindmap), '```'].join('\n'),
                    })
                  }}
                />
              )}
              <SkillUsedNotes tools={entry.tools} />
              {projectPanel.messageParts(entry)}
              {entry.skillProposals?.map((key) => skillCards.render(key))}
              {entry.changes && (
                <AiChangesCard
                  lang={lang}
                  state={cardState(entry.changes)}
                  count={entry.changes.count}
                  lines={entry.changes.lines}
                  onShowLine={(idx) => {
                    const line = entry.changes?.lines?.[idx]
                    const current = depsRef.current.getEditor()
                    if (line?.block !== undefined && current) navigateToBlock(current, line.block)
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
                  onClearMarks={i === latestChangesIdx && marksShown ? clearMarks : null}
                />
              )}
              <AiReplyProgress reply={entry} thinking={t('aiThinking')} working={t('aiWorking')} />
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
        {sendGate.connectChoice && (
          <AiConnectPrompt
            choice={sendGate.connectChoice}
            statuses={statuses ?? {}}
            lang={lang}
            disabled={subscription.busy}
            attention={sendGate.connectAttention}
            onOpenSettings={() => void window.markdownApi.openAiModelSettings().catch(() => {})}
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
        {aiSettings !== null && localModelCapabilities(aiSettings).tools === false && (
          <AiToolsUnsupportedNotice lang={lang} />
        )}
        {projectPanel.notices}
      </div>

      <AiScrollToBottom
        visible={showScrollBottom && chat.length > 0}
        lang={lang}
        onClick={() => {
          stickToBottomRef.current = true
          scrollToBottom()
        }}
      />

      <div className="ai-composer">
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
        {editor && editQueue.length > 0 && (
          <EditQueueCard
            items={editQueue}
            editor={editor}
            busy={busy}
            onEditInstruction={(qid, instruction) => onQueueEditInstruction?.(qid, instruction)}
            onRemove={(qid) => onQueueRemove?.(qid)}
            onDiscardAll={() => onQueueClear?.()}
            onSend={sendQueue}
            onFocus={(qid) => onQueueFocus?.(qid)}
          />
        )}
        {projectPanel.hint}
        {/* Above the input card, not inside its footer: the reset time is long and
            would otherwise squeeze the footer controls in a narrow panel. */}
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
          header={
            hasScopeSelection && (
              <div className="ai-scope-row">
                <span className="ai-scope-hint">
                  <button
                    className="ai-scope-label"
                    onClick={() => setScopePreviewOpen((v) => !v)}
                    aria-expanded={scopePreviewOpen}
                    data-tip={t('aiScopeSelectionTip')}
                  >
                    {t('aiScopeSelection', { words: countWords(selectionText) })}
                  </button>
                  <button
                    className="ai-scope-clear"
                    onClick={clearScopeSelection}
                    data-tip={t('aiScopeClearTitle')}
                    aria-label={t('aiScopeClearTitle')}
                  >
                    <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden>
                      <path
                        d="M4 4l8 8M12 4l-8 8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </span>
                {scopePreviewOpen && (
                  <div className="ai-scope-preview">
                    {selectionText.length > 400 ? `${selectionText.slice(0, 400)}…` : selectionText}
                  </div>
                )}
              </div>
            )
          }
          placeholder={t('aiComposerPlaceholder')}
          hintIdle={t('aiHintIdle')}
          hintBusy={t('aiHintBusy')}
          sendLabel={t('aiSend')}
          stopLabel={t('aiStop')}
          iconOnly
          lang={lang}
          showSkillButton
          footerStart={<McpServerButton lang={lang} />}
          footerEnd={
            <AiModelPicker
              bridge={MODEL_BRIDGE}
              lang={lang}
              subscriptionStatuses={statuses ?? {}}
              onRefreshSubscriptions={subscription.refresh}
            />
          }
          sendIconEnabled={<IconArrowUp size={15} />}
          sendIconDisabled={<IconArrowUp size={15} />}
          stopIcon={<IconStop size={12} />}
          textareaRef={inputRef}
          onChange={setPrompt}
          onSend={sendTyped}
          onStop={stop}
          skills={skills.composer}
          footerBelow={projectPanel.picker}
          footerBelowEnd={sessionUsage && <AiUsageChip usage={sessionUsage} session lang={lang} />}
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
