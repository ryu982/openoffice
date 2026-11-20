import type { TabSummary } from '../shared/tabs-api'

/**
 * The shell window's OS title: what the taskbar button, its hover preview,
 * Alt+Tab and the macOS Window menu show. The tab strip replaces the visible
 * title bar, so this is the only place outside the app that names the
 * document being worked on. Like other document programs it reads
 * "<document> - <product>"; Home (or no active tab) is the product alone.
 */
export function shellWindowTitle(
  tabs: ReadonlyArray<Pick<TabSummary, 'kind' | 'title' | 'active'>>,
  product: string,
): string {
  const active = tabs.find((tab) => tab.active)
  const title = active?.title.trim()
  if (!active || active.kind === 'home' || !title) return product
  return `${title} - ${product}`
}
