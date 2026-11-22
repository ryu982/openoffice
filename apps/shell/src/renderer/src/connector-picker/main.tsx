import React from 'react'
import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang } from '@genoffice/i18n'
import '@genoffice/ui/tokens.css'
import './connector-picker.css'
import { ConnectorPickerWindow } from './ConnectorPickerWindow'
import type { ConnectorPickerApi, ConnectorPickerTheme } from '../../../shared/connector-picker-api'

declare global {
  interface Window {
    aiOfficeConnectorPicker: ConnectorPickerApi
  }
}

function applyTheme(theme: ConnectorPickerTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

const api = window.aiOfficeConnectorPicker
void api.getInit().then((init) => {
  applyTheme(init.theme)
  api.onThemeChanged(applyTheme)
  document.documentElement.lang = htmlLang(init.lang)
  document.documentElement.dir = htmlDir(init.lang)
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ConnectorPickerWindow init={init} api={api} />
    </React.StrictMode>,
  )
})
