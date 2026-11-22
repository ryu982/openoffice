import type { Lang } from '@genoffice/i18n'
import { aiPanelText } from './strings-ai-panel'

export interface AiEmptyHintsProps {
  lang: Lang
  /** True when the `/` skill picker trigger is available in this panel. */
  showSkill?: boolean
  /** True when the `@` document mention trigger is available in this panel. */
  showDocMention?: boolean
}

/**
 * Quiet shortcut hint row shown below the empty-state starter cards.
 * Each hint renders only when its trigger is available; when both are shown they are
 * separated by a middle dot, and the container is omitted entirely when neither applies.
 */
export function AiEmptyHints({
  lang,
  showSkill = false,
  showDocMention = false,
}: AiEmptyHintsProps) {
  if (!showSkill && !showDocMention) return null
  return (
    <div className="ai-chat-empty-hints">
      {showSkill && <span>{aiPanelText(lang, 'hintSkill')}</span>}
      {showSkill && showDocMention && (
        <span className="ai-chat-empty-hint-sep" aria-hidden="true">
          ·
        </span>
      )}
      {showDocMention && <span>{aiPanelText(lang, 'hintDocMention')}</span>}
    </div>
  )
}
