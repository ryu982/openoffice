import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconCheck } from '@genoffice/ui/icons'
import type {
  ConnectorPickerApi,
  ConnectorPickerInit,
  ConnectorPickerItem,
} from '../../../shared/connector-picker-api'
import {
  connectorPickerText,
  type ConnectorPickerStringKey,
} from '../i18n/strings-connector-picker'

export const CONNECTOR_PICK_MAX = 20

const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/

/** Format ISO-8601 UTC timestamps into a clean local date/time in the active UI language */
export function formatPickerSubtitle(
  item: ConnectorPickerItem,
  lang: string,
  pageCountText?: string,
): string {
  const parts: string[] = []
  if (pageCountText) parts.push(pageCountText)
  const raw = item.subtitle.trim()
  if (raw) {
    if (ISO_TIMESTAMP_RE.test(raw)) {
      const d = new Date(raw)
      if (!Number.isNaN(d.getTime())) {
        try {
          parts.push(
            new Intl.DateTimeFormat(lang, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(d),
          )
        } catch {
          parts.push(d.toLocaleString())
        }
      } else {
        parts.push(raw)
      }
    } else {
      parts.push(raw)
    }
  }
  return parts.join(' · ')
}

export function ConnectorPickerWindow({
  init,
  api,
}: {
  init: ConnectorPickerInit
  api: ConnectorPickerApi
}) {
  const { kind, lang, vaults } = init
  const t = useCallback(
    (key: ConnectorPickerStringKey, params?: Record<string, string>) =>
      connectorPickerText(lang, key, params),
    [lang],
  )
  const isRemote = kind === 'notion' || kind === 'canva'
  const unavailableKey: ConnectorPickerStringKey =
    kind === 'canva' ? 'canvaUnavailable' : 'notionUnavailable'

  const [items, setItems] = useState<ConnectorPickerItem[]>([])
  const [query, setQuery] = useState('')
  const [vaultFilter, setVaultFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [working, setWorking] = useState(false)
  const [workingMode, setWorkingMode] = useState<'attach' | 'open'>('attach')
  const [notice, setNotice] = useState<string | null>(null)

  const runList = useCallback(
    async (searchText?: string) => {
      setLoading(true)
      setError(null)
      try {
        const res = await api.list(searchText)
        if (res.ok) {
          setItems(res.items)
        } else {
          setItems([])
          setError(res.error || t(unavailableKey))
        }
      } catch {
        setItems([])
        setError(t(unavailableKey))
      } finally {
        setLoading(false)
      }
    },
    [api, t, unavailableKey],
  )

  useEffect(() => {
    void runList('')
  }, [runList])

  const filteredItems = useMemo(() => {
    if (isRemote) return items
    const q = query.trim().toLowerCase()
    const tagQuery = q.startsWith('#') ? q.slice(1) : ''
    return items.filter((item) => {
      if (vaultFilter !== 'all' && item.vaultId !== vaultFilter) return false
      if (!q) return true
      if (tagQuery) {
        return (item.tags ?? []).some((tag) => tag.toLowerCase().includes(tagQuery))
      }
      return (
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        (item.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
      )
    })
  }, [items, isRemote, query, vaultFilter])

  const toggle = (item: ConnectorPickerItem) => {
    if (item.disabledReason === 'unsaved') {
      setNotice(t('unsavedNote'))
      return
    }
    if (!selected.has(item.id) && selected.size >= CONNECTOR_PICK_MAX) {
      setNotice(t('limitNotice'))
      return
    }
    setNotice(null)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
  }

  const attach = async () => {
    setWorking(true)
    setWorkingMode('attach')
    setNotice(null)
    const res = await api.choose([...selected]).catch(() => null)
    if (!res || !res.ok) {
      setWorking(false)
      setNotice(res && !res.ok ? res.error : t(unavailableKey))
    }
  }

  const openSelectedInTab = async () => {
    const firstId = [...selected][0]
    if (!firstId || !api.openInTab) return
    setWorking(true)
    setWorkingMode('open')
    setNotice(null)
    const res = await api.openInTab(firstId).catch(() => null)
    if (!res || !res.ok) {
      setWorking(false)
      setNotice(res && !res.ok ? res.error : t(unavailableKey))
    }
  }

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (isRemote) {
      void runList(query)
    }
  }

  const searchPlaceholderKey: ConnectorPickerStringKey =
    kind === 'obsidian'
      ? 'searchObsidianPlaceholder'
      : kind === 'canva'
        ? 'searchCanvaPlaceholder'
        : 'searchNotionPlaceholder'
  const emptyKey: ConnectorPickerStringKey =
    kind === 'obsidian' ? 'emptyObsidian' : kind === 'canva' ? 'emptyCanva' : 'emptyNotion'

  return (
    <div className="cp">
      <form className="cp-search-bar" onSubmit={onSubmitSearch}>
        <input
          type="search"
          className="cp-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(searchPlaceholderKey)}
          autoFocus
          disabled={working}
        />
        {isRemote && (
          <button type="submit" className="cp-ghost" disabled={loading || working}>
            {t('searchButton')}
          </button>
        )}
      </form>

      {kind === 'obsidian' && vaults.length > 1 && (
        <div className="cp-vault-chips" role="tablist">
          <button
            type="button"
            className={`cp-chip${vaultFilter === 'all' ? ' active' : ''}`}
            onClick={() => setVaultFilter('all')}
          >
            {t('allVaults')}
          </button>
          {vaults.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`cp-chip${vaultFilter === v.id ? ' active' : ''}`}
              onClick={() => setVaultFilter(v.id)}
            >
              {v.name}
            </button>
          ))}
        </div>
      )}

      <div className="cp-body">
        {loading ? (
          <p className="cp-note">{t('loading')}</p>
        ) : error ? (
          <div className="cp-error-box">
            <p className="cp-error-text">{error}</p>
            <button type="button" className="cp-ghost" onClick={() => void api.openSettings()}>
              {t('openSettings')}
            </button>
          </div>
        ) : filteredItems.length === 0 ? (
          <p className="cp-note">{t(emptyKey)}</p>
        ) : (
          <ul className="cp-list">
            {filteredItems.map((item) => {
              const picked = selected.has(item.id)
              const blocked = item.disabledReason === 'unsaved'
              const subText = formatPickerSubtitle(
                item,
                lang,
                item.pageCount ? t('pageCount', { n: String(item.pageCount) }) : undefined,
              )
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`cp-item${blocked ? ' dim' : ''}${picked ? ' picked' : ''}`}
                    onClick={() => toggle(item)}
                    disabled={working}
                    aria-disabled={blocked}
                    aria-pressed={picked}
                    title={blocked ? t('unsavedNote') : undefined}
                  >
                    <span className="cp-check" aria-hidden="true">
                      {picked && <IconCheck size={12} />}
                    </span>
                    <span className="cp-meta">
                      <span className="cp-title">
                        {item.vaultName && vaults.length > 1 ? `[${item.vaultName}] ` : ''}
                        {item.title}
                      </span>
                      <span className="cp-sub">
                        {subText}
                        {item.tags && item.tags.length > 0
                          ? ` · ${item.tags
                              .slice(0, 4)
                              .map((tag) => `#${tag}`)
                              .join(' ')}`
                          : ''}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="cp-foot">
        <span className="cp-count">
          {working
            ? t(workingMode === 'open' ? 'openingInTab' : 'attaching')
            : notice
              ? notice
              : t('selectedCount', { n: String(selected.size) })}
        </span>
        <button
          type="button"
          className="cp-ghost"
          onClick={() => void api.cancel()}
          disabled={working}
        >
          {t('cancel')}
        </button>
        {kind === 'canva' && api.openInTab && (
          <button
            type="button"
            className="cp-ghost"
            onClick={() => void openSelectedInTab()}
            disabled={working || selected.size !== 1}
          >
            {t('openInTab')}
          </button>
        )}
        <button
          type="button"
          className="cp-primary"
          onClick={() => void attach()}
          disabled={working || selected.size === 0}
        >
          {t('attach')}
        </button>
      </div>
    </div>
  )
}
