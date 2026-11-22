import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { DriveWindowState, McpServerView, McpWindowState } from '@genoffice/agent-core'
import { aiModelPopoverStyle } from './AiModelPicker'
import { useDismissablePopover } from './popover-dismiss'
import { mcpServerAction, mcpServerStatusText, type McpServerAction } from './user-mcp-model'
import { userMcpText, type UserMcpStringKey } from './strings-user-mcp'
import { useDriveWindow, useMcpWindow } from './use-mcp-window'
import './user-mcp.css'

const POPOVER_WIDTH = 310
const POPOVER_MAX_HEIGHT = 400

const ACTION_LABELS: Record<McpServerAction, UserMcpStringKey> = {
  login: 'relogin',
  review: 'review',
  retry: 'retry',
  check: 'checkInSettings',
  enable: 'enableInSettings',
}

/** Call a bridge method without letting a refusal escape as an unhandled rejection */
function fire(call: () => Promise<unknown> | unknown): void {
  try {
    void Promise.resolve(call()).catch(() => {})
  } catch {
    // the shell answers through the list; nothing to show here
  }
}

function ServerIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="11" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="11" height="4.5" rx="1" />
      <path d="M5 4.75h.01M5 11.25h.01M8 4.75h3M8 11.25h3" />
    </svg>
  )
}

function ServerRow({
  lang,
  server,
  on,
  onToggle,
  onAction,
}: {
  lang: Lang
  server: McpServerView
  on: boolean
  onToggle: (on: boolean) => void
  onAction: (action: McpServerAction) => void
}) {
  const disabled = server.status === 'disabled'
  const action = mcpServerAction(server)
  return (
    <li className={`ai-mcp-row${on ? '' : ' is-off'}`}>
      <label className="ai-mcp-row-main">
        <input
          type="checkbox"
          checked={on}
          disabled={disabled}
          aria-label={userMcpText(lang, 'useInChat', { server: server.name })}
          onChange={(e) => onToggle(e.currentTarget.checked)}
        />
        <span className="ai-mcp-row-name" dir="auto">
          {server.name}
        </span>
      </label>
      <div className="ai-mcp-row-meta">
        <span className={`ai-mcp-row-status is-${on || disabled ? server.status : 'off-in-chat'}`}>
          {mcpServerStatusText(lang, server, !on)}
        </span>
        {server.newToolCount > 0 && (
          <span className="ai-mcp-row-new">
            {userMcpText(lang, 'newTools', { n: server.newToolCount })}
          </span>
        )}
      </div>
      {action && (
        <button type="button" className="ai-mcp-row-action" onClick={() => onAction(action)}>
          {userMcpText(lang, ACTION_LABELS[action])}
        </button>
      )}
    </li>
  )
}

function activeConnectionCount(
  servers: readonly McpServerView[],
  offInChat: ReadonlySet<string>,
  vaultsOffInChat: ReadonlySet<string>,
  driveActive: boolean,
): number {
  let count = driveActive ? 1 : 0
  for (const server of servers) {
    if (server.status === 'disabled' || offInChat.has(server.name)) continue
    if (server.localOnly && server.vaults) {
      for (const v of server.vaults) {
        if (v.enabled && !vaultsOffInChat.has(v.id)) count += 1
      }
    } else {
      count += 1
    }
  }
  return count
}

/**
 * The Connections button beside the AI input. Always visible whenever an MCP
 * bridge is present (even with 0 connected services), with a numeric badge when
 * >= 1 connection is active in this chat. Opens the popover listing:
 * - Google Drive AI search/read toggle (in editors when enabled; hidden in Home AI)
 * - Individual Obsidian vault toggles
 * - Remote/local MCP servers with status, per-chat toggle, and action button
 * - "+ Manage connections…" button opening Settings → Integrations
 */
export function McpServerButton({
  lang,
  state,
  driveState,
  showDrive = true,
  className = 'ai-attach-btn',
}: {
  lang: Lang
  state?: McpWindowState | null
  driveState?: DriveWindowState | null
  showDrive?: boolean
  className?: string
}): React.JSX.Element | null {
  const { state: mcp, servers, offInChat, vaultsOffInChat } = useMcpWindow(state)
  const drive = useDriveWindow(showDrive ? driveState : null)
  const [open, setOpen] = useState(false)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)

  const close = useCallback(() => setOpen(false), [])
  useDismissablePopover(open, close, { inside: () => [buttonRef.current, popRef.current] })

  useEffect(() => {
    if (!open) return
    popRef.current
      ?.querySelector<HTMLElement>('input:not(:disabled), button')
      ?.focus({ preventScroll: true })
  }, [open])

  if (!mcp) return null

  const driveRowVisible = showDrive && drive.state !== null && drive.enabled
  const driveActive = driveRowVisible && !drive.offInChat
  const badgeCount = activeConnectionCount(servers, offInChat, vaultsOffInChat, driveActive)

  const label = userMcpText(lang, 'buttonLabel')
  const finish = () => {
    setOpen(false)
    buttonRef.current?.focus({ preventScroll: true })
  }
  const openList = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      setPopStyle(
        aiModelPopoverStyle(
          rect,
          { width: window.innerWidth, height: window.innerHeight },
          POPOVER_WIDTH,
          POPOVER_MAX_HEIGHT,
        ),
      )
    }
    setOpen(true)
  }
  const act = (server: string, action: McpServerAction) => {
    if (action === 'retry') {
      fire(() => mcp.bridge.retry(server))
      return
    }
    // Settings opens in another view; the list has done its part
    fire(() => mcp.bridge.openSettings(server))
    setOpen(false)
  }
  const openManage = () => {
    if (typeof mcp.bridge.openIntegrations === 'function') {
      fire(() => mcp.bridge.openIntegrations!())
    } else {
      fire(() => mcp.bridge.openSettings(''))
    }
    setOpen(false)
  }

  // Count rendered items to decide whether to show the empty state notice
  const hasAnyRow = driveRowVisible || servers.length > 0

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${className} ai-mcp-server-btn${open ? ' open' : ''}${badgeCount > 0 ? ' has-active' : ''}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tip={open ? undefined : label}
        onClick={() => (open ? finish() : openList())}
      >
        <ServerIcon />
        {badgeCount > 0 && (
          <span className="ai-mcp-badge" aria-hidden="true">
            {badgeCount}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={popRef}
          className="ai-mcp-pop"
          role="dialog"
          aria-label={label}
          style={{ ...popStyle, width: POPOVER_WIDTH }}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            finish()
          }}
        >
          <div className="ai-mcp-pop-title">{label}</div>
          <p className="ai-mcp-pop-hint">{userMcpText(lang, 'listHint')}</p>
          {!hasAnyRow ? (
            <p className="ai-mcp-empty">{userMcpText(lang, 'emptyNotice')}</p>
          ) : (
            <ul className="ai-mcp-list">
              {driveRowVisible && drive.state && (
                <li
                  key="__google_drive__"
                  data-connector="google-drive"
                  className={`ai-mcp-row${driveActive ? '' : ' is-off'}`}
                >
                  <label className="ai-mcp-row-main">
                    <input
                      type="checkbox"
                      checked={driveActive}
                      aria-label={userMcpText(lang, 'useInChat', {
                        server: userMcpText(lang, 'driveRowName'),
                      })}
                      onChange={(e) => drive.state?.setOffInChat(!e.currentTarget.checked)}
                    />
                    <span className="ai-mcp-row-name">{userMcpText(lang, 'driveRowName')}</span>
                  </label>
                  <div className="ai-mcp-row-meta">
                    <span
                      className={`ai-mcp-row-status is-${driveActive ? 'connected' : 'off-in-chat'}`}
                    >
                      {driveActive
                        ? userMcpText(lang, 'driveRowSubtitle')
                        : userMcpText(lang, 'offInChat')}
                    </span>
                  </div>
                </li>
              )}
              {servers.flatMap((server) => {
                if (server.localOnly && server.vaults && server.status !== 'disabled') {
                  const enabledVaults = server.vaults.filter((v) => v.enabled)
                  if (enabledVaults.length === 0) return []
                  return enabledVaults.map((vault) => {
                    const vaultOn = !offInChat.has(server.name) && !vaultsOffInChat.has(vault.id)
                    const rowTitle = `Obsidian · ${vault.name}`
                    return (
                      <li
                        key={`${server.name}:${vault.id}`}
                        data-vault-id={vault.id}
                        className={`ai-mcp-row${vaultOn ? '' : ' is-off'}`}
                      >
                        <label className="ai-mcp-row-main">
                          <input
                            type="checkbox"
                            checked={vaultOn}
                            aria-label={userMcpText(lang, 'useVaultInChat', {
                              vault: vault.name,
                            })}
                            onChange={(e) =>
                              mcp.setVaultOffInChat(vault.id, !e.currentTarget.checked)
                            }
                          />
                          <span className="ai-mcp-row-name" dir="auto">
                            {rowTitle}
                          </span>
                        </label>
                        <div className="ai-mcp-row-meta">
                          <span
                            className={`ai-mcp-row-status is-${vaultOn ? 'connected' : 'off-in-chat'}`}
                          >
                            {vaultOn
                              ? userMcpText(lang, 'statusConnected')
                              : userMcpText(lang, 'offInChat')}
                          </span>
                        </div>
                      </li>
                    )
                  })
                }
                return [
                  <ServerRow
                    key={server.name}
                    lang={lang}
                    server={server}
                    on={server.status !== 'disabled' && !offInChat.has(server.name)}
                    onToggle={(on) => mcp.setServerOffInChat(server.name, !on)}
                    onAction={(action) => act(server.name, action)}
                  />,
                ]
              })}
            </ul>
          )}
          <div className="ai-mcp-pop-footer">
            <button type="button" className="ai-mcp-manage-btn" onClick={openManage}>
              {userMcpText(lang, 'manageConnections')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
