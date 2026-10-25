import type { AgentActionView, AgentProjectPrefs } from '../../../shared/agent-api'
import type { AgentWebStringKey } from '../i18n/strings-agent-web'

/**
 * The web part of the agent window (spec 7): what a permission request offers
 * and when the Codex network warning shows. Kept out of the component so the
 * rules can be tested without a window.
 */

/** One answer a permission request offers, in the order the buttons appear */
export type AgentPermissionChoice = 'deny' | 'allow-session' | 'allow'

/**
 * A web search, or a page of a known site, may also be allowed for the rest of
 * the session; everything else is allowed or declined once.
 */
export function agentPermissionChoices(action: AgentActionView): AgentPermissionChoice[] {
  const lasting =
    action.kind === 'web-search' || (action.kind === 'web-fetch' && Boolean(action.host))
  return lasting ? ['deny', 'allow-session', 'allow'] : ['deny', 'allow']
}

/** The label of the "for this session" answer of a web request */
export function agentSessionAllowLabel(action: AgentActionView): AgentWebStringKey {
  return action.kind === 'web-search' ? 'permAllowSearchSession' : 'permAllowSiteSession'
}

/** What a permission request asks, for the web kinds; undefined for the others */
export function agentWebPermissionLabel(action: AgentActionView): AgentWebStringKey | undefined {
  if (action.kind === 'web-search') return 'permWebSearch'
  if (action.kind === 'web-fetch') return 'permWebFetch'
  return undefined
}

/** The warning about commands reaching the internet shows while that is on */
export function codexNetworkWarningShown(prefs: AgentProjectPrefs | null): boolean {
  return prefs?.codexNetwork === true
}
