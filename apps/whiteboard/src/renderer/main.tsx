import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@genoffice/i18n'
import { applyAiPanelPrefs, installScreenTips } from '@genoffice/ui'
import { initWhiteboardEngine } from '@genoffice/whiteboard-engine'
import '@genoffice/ui/tokens.css'
import '@genoffice/ui/screentip.css'
import '@genoffice/ui/dropdown.css'
import '@genoffice/ui/color-picker.css'
import type { UiTheme } from '../shared/ipc'
import App from './App'
import { runWhiteboardHeadless } from './headless'
import { LocaleProvider } from './i18n/locale'
import './styles.css'

installScreenTips()

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

const isHeadless = new URLSearchParams(window.location.search).get('headless') === '1'

if (isHeadless) {
  void runWhiteboardHeadless()
} else {
  void (async () => {
    const [lang, theme] = await Promise.all([
      window.whiteboardApi.core.getLanguage().catch(() => 'zh' as Lang),
      window.whiteboardApi.core.getTheme().catch(() => 'system' as UiTheme),
      initWhiteboardEngine(),
    ])
    document.documentElement.lang = htmlLang(lang)
    document.documentElement.dir = htmlDir(lang)
    applyTheme(theme)
    window.whiteboardApi.core.onThemeChanged(applyTheme)
    await window.whiteboardApi.ai
      .getPanelPrefs()
      .then(applyAiPanelPrefs)
      .catch(() => {})
    window.whiteboardApi.ai.onPanelPrefsChanged(applyAiPanelPrefs)

    createRoot(document.getElementById('root')!).render(
      <LocaleProvider initial={lang}>
        <App />
      </LocaleProvider>,
    )
  })()
}
