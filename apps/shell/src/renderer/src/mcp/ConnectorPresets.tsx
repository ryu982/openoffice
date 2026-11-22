import { useState } from 'react'
import type { Lang, Params } from '@genoffice/i18n'
import {
  MCP_PERMISSIONS,
  type McpPresetId,
  type McpServerSettingsView,
  type McpVaultEntry,
} from '../../../shared/mcp-servers-api'
import { connectorsText, type ConnectorsStringKey } from '../i18n/strings-connectors'
import { PERMISSION_KEYS, STATUS_KEYS, mcpServersApi, signInOutcome } from './mcp-model'
import { McpServerItem } from './McpServerItem'
import type { McpText } from './McpServersCard'

/**
 * Curated connector preset cards shown at the top of Settings → Integrations
 * directly below Google Drive: Notion, Canva, Obsidian Vault, Korean Law MCP,
 * and kordoc MCP. Uses generic monochrome outline icons only (decision 0052).
 */

interface PresetIconsProps {
  kind: 'notion' | 'canva' | 'obsidian' | 'korean-law' | 'kordoc'
}

function PresetOutlineIcon({ kind }: PresetIconsProps) {
  switch (kind) {
    case 'notion':
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 2.5h5.5L13 6v7.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" />
          <path d="M9.5 2.5V6H13M5.5 9h5M5.5 11.5h3.5" />
        </svg>
      )
    case 'canva':
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
          <path d="M2.5 7h11M7.5 7v6.5" />
        </svg>
      )
    case 'obsidian':
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.3 1.5h4.7A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V4.5Z" />
        </svg>
      )
    case 'korean-law':
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 2.5v11M4.5 13.5h7M3 5.5h10M4.5 5.5 3 9h3l-1.5-3.5ZM11.5 5.5 10 9h3l-1.5-3.5Z" />
        </svg>
      )
    case 'kordoc':
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="2.5" width="10" height="11" rx="1.5" />
          <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" />
        </svg>
      )
  }
}

export interface ConnectorPresetsProps {
  lang: Lang
  locale: string
  s: McpText
  servers: McpServerSettingsView[]
  names: string[]
  openIds: ReadonlySet<string>
  requested: string | null
  onOpen(id: string, open: boolean): void
  onChanged(): void
}

export function ConnectorPresets({
  lang,
  locale,
  s,
  servers,
  names,
  openIds,
  requested,
  onOpen,
  onChanged,
}: ConnectorPresetsProps) {
  const c = (key: ConnectorsStringKey, params?: Params) => connectorsText(lang, key, params)
  const findPreset = (presetId: McpPresetId) =>
    servers.find((srv) => srv.presetId === presetId) ?? null
  const vaultServer = servers.find((srv) => srv.kind === 'vault') ?? null

  return (
    <div className="mcp-presets" data-testid="connector-presets">
      <RemotePresetCard
        presetId="notion"
        displayName="Notion"
        desc={c('notionDesc')}
        notice={c('notionNotice')}
        c={c}
        s={s}
        locale={locale}
        server={findPreset('notion')}
        names={names}
        openIds={openIds}
        requested={requested}
        onOpen={onOpen}
        onChanged={onChanged}
      />
      <RemotePresetCard
        presetId="canva"
        displayName="Canva"
        desc={c('canvaDesc')}
        notice={c('canvaNotice')}
        c={c}
        s={s}
        locale={locale}
        server={findPreset('canva')}
        names={names}
        openIds={openIds}
        requested={requested}
        onOpen={onOpen}
        onChanged={onChanged}
      />
      <ObsidianVaultCard
        c={c}
        s={s}
        server={vaultServer}
        open={vaultServer ? openIds.has(vaultServer.id) : false}
        onOpen={(open) => {
          if (vaultServer) onOpen(vaultServer.id, open)
        }}
        onChanged={onChanged}
      />
      <LocalPresetCard
        presetId="korean-law"
        displayName="Korean Law MCP"
        desc={c('koreanLawDesc')}
        notice={c('koreanLawNotice')}
        requireLawOc
        c={c}
        s={s}
        locale={locale}
        server={findPreset('korean-law')}
        names={names}
        openIds={openIds}
        requested={requested}
        onOpen={onOpen}
        onChanged={onChanged}
      />
      <LocalPresetCard
        presetId="kordoc"
        displayName="kordoc MCP"
        desc={c('kordocDesc')}
        notice={c('kordocNotice')}
        requireLawOc={false}
        c={c}
        s={s}
        locale={locale}
        server={findPreset('kordoc')}
        names={names}
        openIds={openIds}
        requested={requested}
        onOpen={onOpen}
        onChanged={onChanged}
      />
    </div>
  )
}

// ---- Notion & Canva 1-flow OAuth card ---------------------------------------

function RemotePresetCard({
  presetId,
  displayName,
  desc,
  notice,
  c,
  s,
  locale,
  server,
  names,
  openIds,
  requested,
  onOpen,
  onChanged,
}: {
  presetId: 'notion' | 'canva'
  displayName: string
  desc: string
  notice: string
  c: (key: ConnectorsStringKey, params?: Params) => string
  s: McpText
  locale: string
  server: McpServerSettingsView | null
  names: string[]
  openIds: ReadonlySet<string>
  requested: string | null
  onOpen(id: string, open: boolean): void
  onChanged(): void
}) {
  const api = mcpServersApi()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  if (!api) return null

  const startOneFlowConnect = async () => {
    setBusy(true)
    setError(null)
    try {
      const added = await api.connectPreset({ presetId })
      if (!added.ok) {
        setError(s('saveFailed'))
        return
      }
      setConfirming(false)
      const signInAns = await api.signIn(added.id)
      if (!signInAns.ok) {
        const outcome = signInOutcome(signInAns)
        setError(s(outcome.key))
        onChanged()
        return
      }
      await api.test(added.id)
      onChanged()
    } catch {
      setError(s('signInFailed'))
    } finally {
      setBusy(false)
    }
  }

  const signInExisting = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      const ans = await api.signIn(id)
      if (!ans.ok) {
        setError(s(signInOutcome(ans).key))
        onChanged()
        return
      }
      await api.test(id)
      onChanged()
    } catch {
      setError(s('signInFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (!server) {
    return (
      <div className="mcp-preset-card" data-preset={presetId}>
        <div className="mcp-preset-head">
          <span className="mcp-preset-icon">
            <PresetOutlineIcon kind={presetId} />
          </span>
          <div className="mcp-preset-info">
            <div className="mcp-server-name">{displayName}</div>
            <div className="set-field-desc">{desc}</div>
          </div>
          {!confirming && (
            <button
              type="button"
              className="set-btn primary"
              disabled={busy}
              onClick={() => {
                setError(null)
                setConfirming(true)
              }}
            >
              {c('connect')}
            </button>
          )}
        </div>
        {confirming && (
          <div className="mcp-preset-panel" data-testid={`preset-confirm-${presetId}`}>
            <div className="set-field-desc">{notice}</div>
            <div className="set-field-desc">{c('thirdPartyNote')}</div>
            <div className="mcp-actions">
              <button
                type="button"
                className="set-btn"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                {s('cancel')}
              </button>
              <button
                type="button"
                className="set-btn primary"
                disabled={busy}
                onClick={() => void startOneFlowConnect()}
              >
                {busy ? s('signingIn') : c('continueSignIn')}
              </button>
            </div>
          </div>
        )}
        {error && <div className="set-field-desc mcp-error">{error}</div>}
      </div>
    )
  }

  const isExpanded = openIds.has(server.id)
  const needsSignIn =
    server.status.status === 'login-required' || (server.oauth !== null && !server.oauth.signedIn)

  return (
    <div className="mcp-preset-card" data-preset={presetId} data-mcp-server={server.id}>
      <div className="mcp-preset-head">
        <span className="mcp-preset-icon">
          <PresetOutlineIcon kind={presetId} />
        </span>
        <div className="mcp-preset-info">
          <div className="mcp-server-name-line">
            <span className="mcp-server-name">{displayName}</span>
            <span className="mcp-status">{s(STATUS_KEYS[server.status.status])}</span>
          </div>
          <div className="set-field-desc">{desc}</div>
        </div>
        <label className="mcp-check">
          <input
            type="checkbox"
            checked={server.enabled}
            onChange={(e) => {
              void api.setEnabled(server.id, e.target.checked).then(onChanged)
            }}
          />
          <span>{s('enabled')}</span>
        </label>
        {needsSignIn && (
          <button
            type="button"
            className="set-btn primary"
            disabled={busy}
            onClick={() => void signInExisting(server.id)}
          >
            {s('signInAgain')}
          </button>
        )}
        <button type="button" className="set-btn" onClick={() => onOpen(server.id, !isExpanded)}>
          {isExpanded ? c('hideTools') : c('showTools')}
        </button>
        <button type="button" className="set-btn danger" onClick={() => setConfirmDisconnect(true)}>
          {c('disconnect')}
        </button>
      </div>
      {error && <div className="set-field-desc mcp-error">{error}</div>}
      {confirmDisconnect && (
        <div className="set-intg-confirm" data-testid={`preset-disconnect-${presetId}`}>
          <div className="set-field-desc">{c('disconnectConfirm', { name: displayName })}</div>
          <div className="mcp-actions">
            <button type="button" className="set-btn" onClick={() => setConfirmDisconnect(false)}>
              {s('cancel')}
            </button>
            <button
              type="button"
              className="set-btn danger"
              onClick={() => {
                setConfirmDisconnect(false)
                void api.remove(server.id).then(onChanged)
              }}
            >
              {c('disconnect')}
            </button>
          </div>
        </div>
      )}
      {isExpanded && (
        <ul className="mcp-list mcp-preset-embedded">
          <McpServerItem
            s={s}
            locale={locale}
            server={server}
            taken={names.filter((n) => n !== server.name)}
            open={true}
            requested={requested === server.id}
            onOpen={(open) => onOpen(server.id, open)}
            onChanged={onChanged}
          />
        </ul>
      )}
    </div>
  )
}

// ---- Obsidian Vault single card managing multiple vaults --------------------

function ObsidianVaultCard({
  c,
  s,
  server,
  open,
  onOpen,
  onChanged,
}: {
  c: (key: ConnectorsStringKey, params?: Params) => string
  s: McpText
  server: McpServerSettingsView | null
  open: boolean
  onOpen(open: boolean): void
  onChanged(): void
}) {
  const api = mcpServersApi()
  const [pendingFolder, setPendingFolder] = useState<{
    path: string
    suggestedName: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [removingVault, setRemovingVault] = useState<McpVaultEntry | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  if (!api) return null

  const vaults = server?.vaults ?? []

  const commitAddVault = async (path: string, name: string) => {
    setError(null)
    const res = await api.addVault({ path, name })
    setPendingFolder(null)
    if (!res.ok) {
      if (res.problem === 'duplicate-vault') setError(c('obsidianDuplicate'))
      else if (res.problem === 'forbidden-folder') setError(c('obsidianForbidden'))
      else setError(s('saveFailed'))
      return
    }
    onChanged()
  }

  const pickAndAdd = async () => {
    setError(null)
    const picked = await api.pickVaultFolder()
    if (!picked.ok) {
      if (picked.reason === 'forbidden') setError(c('obsidianForbidden'))
      return
    }
    if (!picked.hasObsidianDir) {
      setPendingFolder({ path: picked.path, suggestedName: picked.suggestedName })
      return
    }
    await commitAddVault(picked.path, picked.suggestedName)
  }

  const submitRename = async (vaultId: string) => {
    const clean = renameValue.trim()
    if (!clean) return
    const res = await api.renameVault(vaultId, clean)
    if (!res.ok) {
      setError(res.problem === 'name-taken' ? s('nameTaken') : s('saveFailed'))
      return
    }
    setRenamingId(null)
    setError(null)
    onChanged()
  }

  return (
    <div className="mcp-preset-card" data-preset="obsidian" data-mcp-server={server?.id}>
      <div className="mcp-preset-head">
        <span className="mcp-preset-icon">
          <PresetOutlineIcon kind="obsidian" />
        </span>
        <div className="mcp-preset-info">
          <div className="mcp-server-name-line">
            <span className="mcp-server-name">{c('obsidianName')}</span>
            {vaults.length > 0 && (
              <span className="mcp-status">{c('obsidianVaultCount', { n: vaults.length })}</span>
            )}
          </div>
          <div className="set-field-desc">{c('obsidianDesc')}</div>
        </div>
        {server && (
          <label className="mcp-check">
            <input
              type="checkbox"
              checked={server.enabled}
              onChange={(e) => void api.setEnabled(server.id, e.target.checked).then(onChanged)}
            />
            <span>{s('enabled')}</span>
          </label>
        )}
        <button
          type="button"
          className={`set-btn${vaults.length === 0 ? ' primary' : ''}`}
          onClick={() => void pickAndAdd()}
        >
          {c('obsidianAddVault')}
        </button>
        {server && (
          <>
            <button type="button" className="set-btn" onClick={() => onOpen(!open)}>
              {open ? c('hideTools') : c('showTools')}
            </button>
            <button
              type="button"
              className="set-btn danger"
              onClick={() => setConfirmDisconnect(true)}
            >
              {c('disconnect')}
            </button>
          </>
        )}
      </div>

      {pendingFolder && (
        <div className="set-intg-confirm" data-testid="obsidian-missing-dir-confirm">
          <div className="set-field-desc">
            {c('obsidianMissingDirConfirm', { name: pendingFolder.suggestedName })}
          </div>
          <div className="mcp-actions">
            <button type="button" className="set-btn" onClick={() => setPendingFolder(null)}>
              {s('cancel')}
            </button>
            <button
              type="button"
              className="set-btn primary"
              onClick={() => void commitAddVault(pendingFolder.path, pendingFolder.suggestedName)}
            >
              {c('obsidianConnectAnyway')}
            </button>
          </div>
        </div>
      )}

      {error && <div className="set-field-desc mcp-error">{error}</div>}

      {confirmDisconnect && server && (
        <div className="set-intg-confirm" data-testid="preset-disconnect-obsidian">
          <div className="set-field-desc">
            {c('disconnectConfirm', { name: c('obsidianName') })}
          </div>
          <div className="mcp-actions">
            <button type="button" className="set-btn" onClick={() => setConfirmDisconnect(false)}>
              {s('cancel')}
            </button>
            <button
              type="button"
              className="set-btn danger"
              onClick={() => {
                setConfirmDisconnect(false)
                void api.remove(server.id).then(onChanged)
              }}
            >
              {c('disconnect')}
            </button>
          </div>
        </div>
      )}

      {vaults.length > 0 && (
        <ul className="mcp-vault-list">
          {vaults.map((vault) => (
            <li key={vault.id} className="mcp-vault-row" data-vault-id={vault.id}>
              <label className="mcp-check">
                <input
                  type="checkbox"
                  checked={vault.enabled}
                  onChange={(e) =>
                    void api.setVaultEnabled(vault.id, e.target.checked).then(onChanged)
                  }
                />
                <span className="mcp-vault-info">
                  {renamingId === vault.id ? (
                    <span className="mcp-vault-rename">
                      <input
                        type="text"
                        className="mcp-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void submitRename(vault.id)
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                      />
                      <button
                        type="button"
                        className="set-btn primary"
                        onClick={() => void submitRename(vault.id)}
                      >
                        {s('save')}
                      </button>
                      <button type="button" className="set-btn" onClick={() => setRenamingId(null)}>
                        {s('cancel')}
                      </button>
                    </span>
                  ) : (
                    <>
                      <span className="mcp-vault-name">{vault.name}</span>
                      <span className="mcp-vault-path" title={vault.path}>
                        {vault.path}
                      </span>
                    </>
                  )}
                </span>
              </label>
              {renamingId !== vault.id && (
                <div className="mcp-actions">
                  <button
                    type="button"
                    className="set-btn"
                    onClick={() => {
                      setRenamingId(vault.id)
                      setRenameValue(vault.name)
                    }}
                  >
                    {c('obsidianRename')}
                  </button>
                  <button
                    type="button"
                    className="set-btn danger"
                    onClick={() => setRemovingVault(vault)}
                  >
                    {c('obsidianRemoveVault')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {removingVault && (
        <div className="set-intg-confirm" data-testid="obsidian-remove-vault-confirm">
          <div className="set-field-desc">
            {c('obsidianRemoveVaultConfirm', { name: removingVault.name })}
          </div>
          <div className="mcp-actions">
            <button type="button" className="set-btn" onClick={() => setRemovingVault(null)}>
              {s('cancel')}
            </button>
            <button
              type="button"
              className="set-btn danger"
              onClick={() => {
                const target = removingVault
                setRemovingVault(null)
                void api.removeVault(target.id).then(onChanged)
              }}
            >
              {c('obsidianRemoveVault')}
            </button>
          </div>
        </div>
      )}

      {server && open && (
        <div className="mcp-server-body" data-testid="obsidian-tools-drawer">
          <div className="mcp-block">
            <label className="mcp-check">
              <input
                type="checkbox"
                name="keep-inside"
                checked={server.keepResultsInside}
                onChange={(e) =>
                  void api.setKeepResultsInside(server.id, e.target.checked).then(onChanged)
                }
              />
              <span>
                <span className="set-field-label">{s('keepInside')}</span>
                <span className="set-field-desc mcp-block-desc">{s('keepInsideDesc')}</span>
              </span>
            </label>
            {!server.keepResultsInside && (
              <div className="set-field-desc mcp-error">{s('keepInsideOffWarn')}</div>
            )}
          </div>
          <div className="mcp-tools-part">
            <div className="mcp-block-title">{s('toolsTitle')}</div>
            <ul className="mcp-tools">
              {Object.entries(server.tools).map(([toolName, tool]) => (
                <li key={toolName} className="mcp-tool" data-mcp-tool={toolName}>
                  <div className="mcp-tool-head">
                    <code className="mcp-tool-name">{toolName}</code>
                    {tool.definition.annotations?.readOnlyHint === true && (
                      <span className="mcp-tag">{s('toolReadOnly')}</span>
                    )}
                    {tool.definition.annotations?.destructiveHint === true && (
                      <span className="mcp-tag mcp-tag-strong">{s('toolDestructive')}</span>
                    )}
                    <div className="mcp-perm" role="group" aria-label={toolName}>
                      {MCP_PERMISSIONS.map((perm) => (
                        <button
                          key={perm}
                          type="button"
                          data-perm={perm}
                          aria-pressed={tool.permission === perm}
                          onClick={() => {
                            if (tool.permission !== perm) {
                              void api.setToolPermission(server.id, toolName, perm).then(onChanged)
                            }
                          }}
                        >
                          {s(PERMISSION_KEYS[perm])}
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Korean Law MCP & kordoc MCP local preset cards -------------------------

function LocalPresetCard({
  presetId,
  displayName,
  desc,
  notice,
  requireLawOc,
  c,
  s,
  locale,
  server,
  names,
  openIds,
  requested,
  onOpen,
  onChanged,
}: {
  presetId: 'korean-law' | 'kordoc'
  displayName: string
  desc: string
  notice: string
  requireLawOc: boolean
  c: (key: ConnectorsStringKey, params?: Params) => string
  s: McpText
  locale: string
  server: McpServerSettingsView | null
  names: string[]
  openIds: ReadonlySet<string>
  requested: string | null
  onOpen(id: string, open: boolean): void
  onChanged(): void
}) {
  const api = mcpServersApi()
  const [configuring, setConfiguring] = useState(false)
  const [lawOc, setLawOc] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!api) return null

  const registerLocalPreset = async () => {
    if (requireLawOc && !lawOc.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.connectPreset(
        requireLawOc ? { presetId, lawOc: lawOc.trim() } : { presetId },
      )
      if (!res.ok) {
        setError(s('saveFailed'))
        return
      }
      setConfiguring(false)
      setLawOc('')
      onOpen(res.id, true)
      onChanged()
    } catch {
      setError(s('saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (!server) {
    return (
      <div className="mcp-preset-card" data-preset={presetId}>
        <div className="mcp-preset-head">
          <span className="mcp-preset-icon">
            <PresetOutlineIcon kind={presetId} />
          </span>
          <div className="mcp-preset-info">
            <div className="mcp-server-name">{displayName}</div>
            <div className="set-field-desc">{desc}</div>
          </div>
          {!configuring && (
            <button
              type="button"
              className="set-btn primary"
              onClick={() => {
                setError(null)
                setConfiguring(true)
              }}
            >
              {c('connect')}
            </button>
          )}
        </div>
        {configuring && (
          <div className="mcp-preset-panel" data-testid={`preset-setup-${presetId}`}>
            <div className="set-field-desc">{notice}</div>
            <div className="set-field-desc">{c('thirdPartyNote')}</div>
            {requireLawOc && (
              <div className="mcp-form-row">
                <a
                  href="https://open.law.go.kr"
                  target="_blank"
                  rel="noreferrer"
                  className="mcp-preset-link"
                >
                  {c('koreanLawGuideLink')}
                </a>
                <label className="set-field-label" htmlFor="korean-law-oc">
                  {c('koreanLawKeyLabel')}
                </label>
                <input
                  id="korean-law-oc"
                  name="LAW_OC"
                  type="password"
                  className="mcp-input"
                  value={lawOc}
                  onChange={(e) => setLawOc(e.target.value)}
                  placeholder="LAW_OC"
                  autoComplete="off"
                />
                <div className="set-field-desc">{c('koreanLawKeyHint')}</div>
              </div>
            )}
            {error && <div className="set-field-desc mcp-error">{error}</div>}
            <div className="mcp-actions">
              <button
                type="button"
                className="set-btn"
                disabled={busy}
                onClick={() => setConfiguring(false)}
              >
                {s('cancel')}
              </button>
              <button
                type="button"
                className="set-btn primary"
                disabled={busy || (requireLawOc && !lawOc.trim())}
                onClick={() => void registerLocalPreset()}
              >
                {c('registerAndReview')}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Once registered, show the full LaunchReview / RuntimeQuestion / Tools item
  // automatically expanded while launch approval is pending.
  const isExpanded = openIds.has(server.id) || server.launchReviewNeeded

  return (
    <div className="mcp-preset-card" data-preset={presetId}>
      <ul className="mcp-list mcp-preset-embedded">
        <McpServerItem
          s={s}
          locale={locale}
          server={server}
          taken={names.filter((n) => n !== server.name)}
          open={isExpanded}
          requested={requested === server.id}
          onOpen={(open) => onOpen(server.id, open)}
          onChanged={onChanged}
        />
      </ul>
    </div>
  )
}
