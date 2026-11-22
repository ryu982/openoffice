/**
 * Whiteboard AI panel wired to `@genoffice/ui` shared send-gate, model picker,
 * composer (`/` skills, `@` doc mentions), Drive & MCP tools (`composeWithDrive`,
 * `McpPermissionCard`, `McpServerButton`), `AiAttachMenu`, `AiChangesCard`, and
 * `AgentLoop`. Automatically attaches a theme-invariant light PNG snapshot of
 * the current page alongside `<whiteboard_page>` text when the active model
 * supports vision, and falls back silently to text-only otherwise.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  AgentLoop,
  composeWithDrive,
  windowMcpUsableServers,
  type AgentImage,
  type IpcStreamError,
} from '@genoffice/agent-core'
import type { AiSettings, AiSubscriptionUsage } from '@genoffice/ai-provider/browser'
import {
  AiAttachMenu,
  AiBlockedNotice,
  AiChangesCard,
  type AiChangesState,
  AiComposer,
  type AiComposerDocs,
  AiConnectPrompt,
  AiEmptyHints,
  AiFirstConnectionNotice,
  AiInputTruncatedNotice,
  AiModelPicker,
  type AiModelPickerBridge,
  AiPanelHeader,
  AiPanelSideButton,
  AiSubscriptionUsageLine,
  AiWorkSteps,
  type AiWorkStep,
  type DocMentionAddResult,
  type DriveAttachPicked,
  IconArrowUp,
  IconStop,
  Markdown,
  McpPermissionCard,
  McpServerButton,
  NO_SKILL_USE,
  SentSkillChips,
  type SkillChipRef,
  type SkillUse,
  SkillUsedNotes,
  docMentionActions,
  panelUserSkills,
  useAiSendGate,
  useComposerSkills,
  useMcpWindow,
  useSkillProposals,
  useSubscriptionUsageUpdates,
} from '@genoffice/ui'
import type { WhiteboardAiHost } from '../../shared/ai-host'
import type { AttachmentAddResult, AttachmentMeta, WhiteboardHandoff } from '../../shared/ipc'
import { useI18n } from '../i18n/locale'
import { blockedRunFor, mergeSubscriptionUsage, type BlockedRun } from './connection'
import { createFilesSkill } from './files-skill'
import { aiLangDirective } from './lang-directive'
import { createSearchSkill } from './search-skill'
import { useSubscriptionConnection } from './subscription-client'
import { createElectronTransport } from './transport'
import { modelSupportsVision } from './vision-capability'
import { createWhiteboardSkill, whiteboardContext } from './whiteboard-skill'

interface TurnChanges {
  batchCount: number
  changedIds: string[]
  state: AiChangesState
}

interface TrackedWorkStep extends AiWorkStep {
  readonly callId: string
}

interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  skills?: SkillChipRef[]
  skillProposals?: string[]
  steps?: TrackedWorkStep[]
  error?: string
  changes?: TurnChanges
}

export interface WhiteboardAiPanelProps {
  host: WhiteboardAiHost
  filePath: string | null
  handoff?: WhiteboardHandoff | null
  onCollapse(): void
  onHandoffConsumed?(): void
}

const STARTERS = [
  ['aiStarterBrainstorm', 'aiStarterBrainstormPrompt'],
  ['aiStarterKanban', 'aiStarterKanbanPrompt'],
  ['aiStarterOrganize', 'aiStarterOrganizePrompt'],
  ['aiStarterSummarize', 'aiStarterSummarizePrompt'],
] as const

const MODEL_BRIDGE: AiModelPickerBridge = {
  getSettings: () => window.whiteboardApi.ai.getSettings() as Promise<AiSettings>,
  setSettings: (settings) => window.whiteboardApi.ai.setSettings(settings),
  onSettingsChanged: (handler) => window.whiteboardApi.ai.onSettingsChanged(handler),
  openModelSettings: () => window.whiteboardApi.ai.openModelSettings(),
}

function toDocAddResult(
  res: AttachmentAddResult | null,
): DocMentionAddResult<AttachmentMeta> | null {
  if (!res) return null
  return {
    accepted: res.added,
    rejected: res.rejected.map((r) => `${r.name}: ${r.reason}`),
  }
}

export function AiPanel({
  host,
  handoff,
  onCollapse,
  onHandoffConsumed,
}: WhiteboardAiPanelProps): ReactElement {
  const { lang, t } = useI18n()
  const sub = useSubscriptionConnection()
  const mcpWindow = useMcpWindow()
  const skills = useComposerSkills({
    lang,
    editor: 'whiteboard',
    usableMcpServers: mcpWindow.state?.usableServers(),
  })
  const skillsRef = useRef(skills)
  skillsRef.current = skills
  const skillCards = useSkillProposals({ lang })
  const skillCardsRef = useRef(skillCards)
  skillCardsRef.current = skillCards

  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([])
  const [attachNotice, setAttachNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [blockedRun, setBlockedRun] = useState<BlockedRun | null>(null)
  const [inputTruncated, setInputTruncated] = useState(false)
  const [usage, setUsage] = useState<AiSubscriptionUsage[]>([])
  const [activeHighlights, setActiveHighlights] = useState<string[]>([])
  const [undoNotice, setUndoNotice] = useState<string | null>(null)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const settingsRef = useRef<AiSettings | null>(null)
  settingsRef.current = settings
  const attachmentsRef = useRef<AttachmentMeta[]>([])
  attachmentsRef.current = attachments
  const sentAttachmentsRef = useRef<AttachmentMeta[]>([])
  const contextRef = useRef('')
  const lastStreamErrorRef = useRef<IpcStreamError | null>(null)
  const loopRef = useRef<AgentLoop | null>(null)
  const activeAsstIdRef = useRef<string | null>(null)
  const turnBatchesRef = useRef(0)
  const turnChangedIdsRef = useRef<string[]>([])
  const lastSentRef = useRef<{
    text: string
    attachments: AttachmentMeta[]
    skillUse: SkillUse
  } | null>(null)
  const langRef = useRef(lang)
  langRef.current = lang

  const availableAttachments = useCallback((): AttachmentMeta[] => {
    const seen = new Set<string>()
    return [...sentAttachmentsRef.current, ...attachmentsRef.current].filter((a) => {
      if (seen.has(a.path)) return false
      seen.add(a.path)
      return true
    })
  }, [])

  const showAttachNotice = useCallback((lines: string[]) => {
    if (lines.length === 0) return
    setAttachNotice(lines.join('; '))
    window.setTimeout(() => setAttachNotice(null), 5000)
  }, [])

  const mergeAttachments = useCallback(
    (result: DocMentionAddResult<AttachmentMeta> | null) => {
      if (!result) return
      if (result.accepted.length > 0) {
        const seen = new Set(attachmentsRef.current.map((a) => a.path))
        const next = [
          ...attachmentsRef.current,
          ...result.accepted.filter((a) => !seen.has(a.path)),
        ]
        attachmentsRef.current = next
        setAttachments(next)
      }
      showAttachNotice(result.rejected)
    },
    [showAttachNotice],
  )

  const attachFromPicker = useCallback(
    async ({ paths, notes }: DriveAttachPicked) => {
      const added =
        paths.length > 0
          ? toDocAddResult(await window.whiteboardApi.ai.addAttachmentPaths(paths))
          : null
      mergeAttachments({
        accepted: added?.accepted ?? [],
        rejected: [...(added?.rejected ?? []), ...notes],
      })
    },
    [mergeAttachments],
  )

  const docMention: AiComposerDocs = useMemo(
    () => ({
      lang,
      ...docMentionActions<AttachmentMeta>({
        lang,
        add: async (paths) =>
          toDocAddResult(await window.whiteboardApi.ai.addAttachmentPaths(paths)),
        merge: mergeAttachments,
      }),
      attachments,
    }),
    [attachments, lang, mergeAttachments],
  )

  const handlePasteFiles = useCallback(
    async (files: File[]) => {
      const localPaths: string[] = []
      const pasted: AttachmentMeta[] = []
      for (const f of files) {
        const p = window.whiteboardApi.ai.resolveFilePath(f)
        if (p) {
          localPaths.push(p)
        } else if (f.type.startsWith('image/')) {
          const bytes = new Uint8Array(await f.arrayBuffer())
          const saved = await window.whiteboardApi.ai.savePastedImage(bytes, f.type)
          if (saved) pasted.push(saved)
        }
      }
      if (pasted.length > 0) {
        mergeAttachments({ accepted: pasted, rejected: [] })
      }
      if (localPaths.length > 0) {
        mergeAttachments(
          toDocAddResult(await window.whiteboardApi.ai.addAttachmentPaths(localPaths)),
        )
      }
    },
    [mergeAttachments],
  )

  const refreshSettings = useCallback(() => {
    void window.whiteboardApi.ai
      .getSettings()
      .then((s: unknown) => setSettings(s as AiSettings))
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshSettings()
    return window.whiteboardApi.ai.onSettingsChanged(refreshSettings)
  }, [refreshSettings])

  useSubscriptionUsageUpdates(
    () => window.whiteboardApi?.subscription,
    setUsage,
    mergeSubscriptionUsage,
  )

  const finalizeRun = useCallback(() => {
    const asstId = activeAsstIdRef.current
    const batches = turnBatchesRef.current
    const changedIds = [...new Set(turnChangedIdsRef.current)]
    if (asstId && batches > 0) {
      host.setHighlights(changedIds)
      setActiveHighlights(changedIds)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === asstId
            ? {
                ...m,
                changes: {
                  batchCount: batches,
                  changedIds,
                  state: 'applied',
                },
              }
            : m,
        ),
      )
    }
    setBusy(false)
  }, [host])

  const runTurn = useCallback(
    async (text: string, sendAttachments: AttachmentMeta[], skillUse: SkillUse = NO_SKILL_USE) => {
      const currentSettings = settingsRef.current
      if (!currentSettings) return
      setBusy(true)
      setBlockedRun(null)
      setInputTruncated(false)
      setUndoNotice(null)
      lastStreamErrorRef.current = null
      turnBatchesRef.current = 0
      turnChangedIdsRef.current = []
      lastSentRef.current = { text, attachments: sendAttachments, skillUse }
      if (sendAttachments.length > 0) {
        const seen = new Set(sentAttachmentsRef.current.map((a) => a.path))
        sentAttachmentsRef.current = [
          ...sentAttachmentsRef.current,
          ...sendAttachments.filter((a) => !seen.has(a.path)),
        ]
      }
      skillsRef.current.consume(skillUse)

      const userId = `u-${Date.now()}`
      const asstId = `a-${Date.now()}`
      activeAsstIdRef.current = asstId
      setMessages((prev) => [
        ...prev,
        {
          id: userId,
          role: 'user',
          text,
          ...(skillUse.chips.length > 0 ? { skills: skillUse.chips } : {}),
        },
        { id: asstId, role: 'assistant', text: '', steps: [] },
      ])

      const pageTable = await host.readPage()
      contextRef.current = whiteboardContext(pageTable)

      const images: AgentImage[] = []
      if (modelSupportsVision(currentSettings)) {
        const png = await host.captureCurrentPagePng(1600)
        if (png) {
          images.push({ base64: png.base64, mime: png.mime })
        }
      }
      for (const att of sendAttachments) {
        if (!att.isImage) continue
        const img = await window.whiteboardApi.ai.readAttachmentImage(att.path)
        if (img.ok && img.base64 && img.mime) {
          images.push({ base64: img.base64, mime: img.mime })
        }
      }

      if (!loopRef.current) {
        const transport = createElectronTransport(() => settingsRef.current!, {
          getLang: () => langRef.current,
          onStreamError: (err) => {
            lastStreamErrorRef.current = err
          },
          onSubscriptionUsage: (reported) => {
            setUsage((prev) => mergeSubscriptionUsage(prev, reported))
          },
          onInputTruncated: () => setInputTruncated(true),
        })
        const wbSkill = createWhiteboardSkill({
          host: () => host,
          context: () => contextRef.current,
          onApplied: (ids) => {
            turnBatchesRef.current += 1
            turnChangedIdsRef.current.push(...ids)
          },
        })
        const composed = composeWithDrive(
          'whiteboard+search',
          '',
          () => loopRef.current?.messages ?? [],
          [
            wbSkill,
            createSearchSkill(),
            createFilesSkill(availableAttachments),
            ...panelUserSkills({
              editor: 'whiteboard',
              lang: () => langRef.current,
              messages: () => loopRef.current?.messages ?? [],
              mcpServerUsable: (name) => windowMcpUsableServers().has(name),
              onProposal: (proposal) => {
                skillCardsRef.current.add(proposal)
                const targetId = activeAsstIdRef.current
                if (targetId) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === targetId
                        ? { ...m, skillProposals: [...(m.skillProposals ?? []), proposal.key] }
                        : m,
                    ),
                  )
                }
              },
            }),
          ],
        )
        loopRef.current = new AgentLoop({
          transport,
          skill: composed,
          systemSuffix: () => aiLangDirective(langRef.current),
          events: {
            onText: (fullText) => {
              const targetId = activeAsstIdRef.current
              if (!targetId) return
              setMessages((prev) =>
                prev.map((m) => (m.id === targetId ? { ...m, text: fullText } : m)),
              )
            },
            onToolStart: (call) => {
              const targetId = activeAsstIdRef.current
              if (!targetId) return
              const step: TrackedWorkStep = {
                callId: call.id,
                name: call.name,
                summary: call.name,
                running: true,
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === targetId ? { ...m, steps: [...(m.steps ?? []), step] } : m,
                ),
              )
            },
            onToolExecuted: ({ call, execution }) => {
              const targetId = activeAsstIdRef.current
              if (!targetId) return
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === targetId
                    ? {
                        ...m,
                        steps: (m.steps ?? []).map((s) =>
                          s.callId === call.id
                            ? {
                                ...s,
                                summary: execution.summary || s.summary,
                                running: false,
                                isError: execution.isError,
                                output: execution.output.slice(0, 1200),
                              }
                            : s,
                        ),
                      }
                    : m,
                ),
              )
            },
            onError: (msg) => {
              const targetId = activeAsstIdRef.current
              const blocked = blockedRunFor(msg, lastStreamErrorRef.current)
              if (blocked) {
                setBlockedRun(blocked)
              } else if (targetId) {
                setMessages((prev) =>
                  prev.map((m) => (m.id === targetId ? { ...m, error: msg } : m)),
                )
              }
              finalizeRun()
            },
            onDone: () => {
              finalizeRun()
            },
          },
        })
      }

      loopRef.current.run(text + skillUse.text, images.length > 0 ? images : undefined)
    },
    [availableAttachments, finalizeRun, host],
  )

  const gate = useAiSendGate<{
    text: string
    attachments: AttachmentMeta[]
    skillUse: SkillUse
  }>({
    settings,
    statuses: sub.statuses,
    store: {
      getSettings: MODEL_BRIDGE.getSettings,
      setSettings: MODEL_BRIDGE.setSettings,
    },
    start: (req) => {
      void runTurn(req.text, req.attachments, req.skillUse)
    },
    onNotConnected: () => sub.refresh(),
    onSettingsSaved: (next) => setSettings(next),
  })

  const sendMessage = useCallback(
    (
      overrideText?: string,
      overrideAttachments?: AttachmentMeta[],
      skillUse: SkillUse = NO_SKILL_USE,
    ) => {
      const text = (overrideText ?? input).trim()
      const atts = overrideAttachments ?? attachments
      if (!text || busy) return
      if (!gate.admit({ text, attachments: atts, skillUse })) return
      setInput('')
      void runTurn(text, atts, skillUse)
    },
    [input, attachments, busy, gate, runTurn],
  )

  const sendDraft = useCallback(() => {
    const text = input.trim()
    if (!text || busy) return
    skillsRef.current.withSkills(text, (skillUse) => sendMessage(text, undefined, skillUse))
  }, [busy, input, sendMessage])

  const consumedHandoffId = useRef<string | null>(null)
  useEffect(() => {
    if (!handoff || consumedHandoffId.current === handoff.id) return
    consumedHandoffId.current = handoff.id
    void (async () => {
      let added: AttachmentMeta[] = []
      if (handoff.sourcePaths.length > 0) {
        const res = await window.whiteboardApi.ai.addAttachmentPaths(handoff.sourcePaths)
        added = res.added
        setAttachments((prev) => [...prev, ...added])
      }
      window.whiteboardApi.handoff.reportRunStarted({
        id: handoff.id,
        attachedPaths: added.map((a) => a.path),
      })
      onHandoffConsumed?.()
      if (handoff.prompt.trim()) {
        setInput(handoff.prompt)
        sendMessage(handoff.prompt, added)
      }
    })()
  }, [handoff, onHandoffConsumed, sendMessage])

  const handleNewChat = useCallback(() => {
    loopRef.current?.cancel()
    loopRef.current = null
    setMessages([])
    setBlockedRun(null)
    setInputTruncated(false)
    setUndoNotice(null)
    sentAttachmentsRef.current = []
    host.setHighlights([])
    setActiveHighlights([])
    gate.reset()
  }, [gate, host])

  const handleRevertTurn = useCallback(
    async (msgId: string, changes: TurnChanges) => {
      const ok = await host.undoBatches(changes.batchCount)
      if (!ok) {
        setUndoNotice(t('aiUndoBlockedAfterEdit'))
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId && m.changes ? { ...m, changes: { ...m.changes, state: 'refused' } } : m,
          ),
        )
        return
      }
      setActiveHighlights([])
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.changes ? { ...m, changes: { ...m.changes, state: 'reverted' } } : m,
        ),
      )
    },
    [host, t],
  )

  const handleClearMarks = useCallback(() => {
    host.setHighlights([])
    setActiveHighlights([])
  }, [host])

  const handleAddAttachments = useCallback(async () => {
    const res = toDocAddResult(await window.whiteboardApi.ai.addAttachments())
    mergeAttachments(res)
  }, [mergeAttachments])

  const headerActions = useMemo(
    () => (
      <>
        <AiPanelSideButton
          lang={lang}
          onMove={async (side) => {
            await window.whiteboardApi.ai.setPanelPrefs({ side })
            return window.whiteboardApi.ai.getPanelPrefs()
          }}
        />
        <button
          type="button"
          className="wb-btn"
          title={t('aiNewChat')}
          onClick={handleNewChat}
          disabled={busy}
        >
          +
        </button>
        <button type="button" className="wb-btn" title={t('aiCollapsePanel')} onClick={onCollapse}>
          ×
        </button>
      </>
    ),
    [busy, handleNewChat, lang, onCollapse, t],
  )

  return (
    <aside className="copilot" aria-label="AI Assistant">
      <AiPanelHeader lang={lang} actions={headerActions} />

      <div className="wbai-messages">
        {gate.connectChoice && (
          <AiConnectPrompt
            lang={lang}
            choice={gate.connectChoice}
            statuses={sub.statuses}
            onInstall={sub.install}
            onLogin={sub.login}
            onRecheck={sub.recheck}
            onAcceptMetered={sub.acceptMetered}
            onOpenInstallHelp={sub.openInstallHelp}
            onUpdate={sub.update}
            onCancelLogin={sub.cancelLogin}
            attention={gate.connectAttention}
            onOpenSettings={() => void window.whiteboardApi.ai.openModelSettings()}
          />
        )}
        {gate.noticeDue && (
          <AiFirstConnectionNotice lang={lang} onAcknowledge={gate.acknowledgeNotice} />
        )}
        {blockedRun && (
          <AiBlockedNotice
            lang={lang}
            kind={blockedRun.kind}
            provider={blockedRun.provider}
            resetsAt={blockedRun.resetsAt}
            message={blockedRun.message}
            settings={settings ?? {}}
            statuses={sub.statuses}
            onContinueWith={(provider) => {
              const last = lastSentRef.current
              gate.continueWith(provider, () => {
                if (last) void runTurn(last.text, last.attachments, last.skillUse)
              })
            }}
          />
        )}
        {inputTruncated && <AiInputTruncatedNotice lang={lang} />}
        {undoNotice && <div className="wbai-error">{undoNotice}</div>}

        {messages.length === 0 ? (
          <div>
            <h4>{t('aiEmptyTitle')}</h4>
            <p>{t('aiEmptyBody')}</p>
            <div className="wbai-starters">
              {STARTERS.map(([labelKey, promptKey]) => (
                <button
                  key={labelKey}
                  type="button"
                  className="wbai-starter"
                  onClick={() => {
                    setInput(t(promptKey))
                    inputRef.current?.focus()
                  }}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
            <AiEmptyHints lang={lang} showSkill={Boolean(skills.composer)} showDocMention />
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`wbai-msg wbai-msg-${m.role}`}>
              {m.role === 'user' ? (
                <>
                  <SentSkillChips lang={lang} chips={m.skills} isAvailable={skills.isAvailable} />
                  <div>{m.text}</div>
                </>
              ) : (
                <>
                  {m.steps && m.steps.length > 0 && <AiWorkSteps lang={lang} steps={m.steps} />}
                  {m.text && <Markdown text={m.text} />}
                  <SkillUsedNotes tools={m.steps} />
                  {m.skillProposals?.map((key) => skillCards.render(key))}
                  {m.error && <div className="wbai-error">{m.error}</div>}
                  {m.changes && (
                    <AiChangesCard
                      lang={lang}
                      state={m.changes.state}
                      count={m.changes.changedIds.length || m.changes.batchCount}
                      canRevert={!busy && m.changes.state === 'applied'}
                      onRevert={() => void handleRevertTurn(m.id, m.changes!)}
                      onClearMarks={activeHighlights.length > 0 ? handleClearMarks : null}
                    />
                  )}
                </>
              )}
            </div>
          ))
        )}
        <McpPermissionCard lang={lang} />
      </div>

      {usage.length > 0 && <AiSubscriptionUsageLine lang={lang} usage={usage} />}

      <div className="ai-composer wbai-composer-wrap">
        {attachments.length > 0 && (
          <div className="wbai-chips">
            {attachments.map((att) => (
              <span key={att.id} className="wbai-chip">
                {att.name}
                <button
                  type="button"
                  title={t('aiRemoveAttachmentTitle')}
                  onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {attachNotice && <div className="ai-attach-notice">{attachNotice}</div>}
        <AiComposer
          value={input}
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
          onChange={setInput}
          onSend={sendDraft}
          onStop={() => loopRef.current?.cancel()}
          skills={skills.composer}
          docs={docMention}
          onPasteFiles={(files) => void handlePasteFiles(files)}
          footerStart={
            <>
              <AiAttachMenu
                lang={lang}
                onPickPc={() => void handleAddAttachments()}
                onPickedDocs={attachFromPicker}
                onPickedDrive={attachFromPicker}
              />
              <McpServerButton lang={lang} />
            </>
          }
          footerEnd={
            <AiModelPicker
              bridge={MODEL_BRIDGE}
              lang={lang}
              subscriptionStatuses={sub.statuses}
              onRefreshSubscriptions={() => sub.refresh()}
            />
          }
        />
      </div>
    </aside>
  )
}
