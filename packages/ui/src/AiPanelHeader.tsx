import React from 'react'
import type { Lang } from '@genoffice/i18n'
import { AiMark } from './AiMark'
import { aiSubscriptionText } from './strings-ai-subscription'

export interface AiPanelHeaderProps {
  readonly lang: Lang
  /** Project conversation menu; when present it takes the header title slot beside AiMark */
  readonly chatMenu?: React.ReactNode
  /** Trailing action buttons (side swap, new chat, collapse) */
  readonly actions?: React.ReactNode
  /** Optional extra leading controls or badge */
  readonly extra?: React.ReactNode
}

/**
 * Shared slim header for every editor AI panel. Shows `AiMark` + "AI Assistant"
 * by default; when a project folder is active (`chatMenu` present), the chat
 * title switcher replaces the static label visually while keeping the panel
 * accessible name intact.
 */
export function AiPanelHeader({
  lang,
  chatMenu,
  actions,
  extra,
}: AiPanelHeaderProps): React.JSX.Element {
  const assistantLabel = aiSubscriptionText(lang, 'aiAssistant')
  const hasChatMenu = chatMenu !== null && chatMenu !== undefined && chatMenu !== false
  return (
    <header className="ai-panel-header">
      <div className="ai-panel-header-lead">
        {hasChatMenu ? (
          <>
            <span className="ai-panel-header-mark" aria-hidden="true">
              <AiMark size={20} />
            </span>
            {chatMenu}
          </>
        ) : (
          <span className="ai-panel-title">
            <AiMark size={20} />
            {assistantLabel}
          </span>
        )}
        {extra}
      </div>
      {actions && <div className="ai-panel-header-actions">{actions}</div>}
    </header>
  )
}
