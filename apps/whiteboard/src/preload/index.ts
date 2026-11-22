/**
 * Preload bridge for the whiteboard editor (`window.whiteboardApi` + shared shell bridges).
 * Security invariant: exposes only read/login/install/update/cancel/metered subscription hooks,
 * never sign-out or disable controls.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AiStreamChunk } from '@genoffice/ai-provider'
import { SUBSCRIPTION_IPC_CHANNELS } from '@genoffice/ai-provider/browser'
import type { Lang } from '@genoffice/i18n'
import type { ProjectApi } from '@genoffice/project-store'
import type { AiPanelPrefs } from '@genoffice/ui'
import { APP_CHOICE_BRIDGE_KEY, appChoiceBridge } from '@genoffice/electron-utils/app-choice-bridge'
import { connectorAttachBridge } from '@genoffice/electron-utils/connector-attach-bridge'
import { CONNECTOR_ATTACH_BRIDGE_KEY } from '@genoffice/electron-utils/connector-attach-channels'
import { docAttachBridge } from '@genoffice/electron-utils/doc-attach-bridge'
import { DOC_ATTACH_BRIDGE_KEY } from '@genoffice/electron-utils/doc-attach-channels'
import { driveAiBridge } from '@genoffice/electron-utils/drive-ai-bridge'
import { installDropOpenBridge } from '@genoffice/electron-utils/drop-open'
import { mcpToolsBridge } from '@genoffice/electron-utils/mcp-tools-bridge'
import { outboundBridge } from '@genoffice/electron-utils/outbound-bridge'
import { createPrintLayoutBridge } from '@genoffice/electron-utils/print-layout-bridge'
import {
  PROJECT_FOLDER_BRIDGE_KEY,
  projectFolderBridge,
} from '@genoffice/electron-utils/project-folder-bridge'
import { SPLIT_PANE_BRIDGE_KEY, splitPaneBridge } from '@genoffice/electron-utils/split-pane-bridge'
import { userSkillsBridge } from '@genoffice/electron-utils/user-skills-bridge'
import { USER_SKILLS_BRIDGE_KEY } from '@genoffice/electron-utils/user-skills-channels'
import { AI_CHANNELS, APP_CHANNELS, WHITEBOARD_CHANNELS } from '../shared/ipc'
import type {
  AutoSaveDefault,
  ExportFormat,
  SaveRequestMode,
  UiTheme,
  WhiteboardAiApi,
  WhiteboardApi,
  WhiteboardApplyQuery,
  WhiteboardCoreApi,
  WhiteboardExportApi,
  WhiteboardHandoffApi,
  WhiteboardHeadlessApi,
  WhiteboardMenuCommand,
  WhiteboardPrintJob,
  WhiteboardQueryApi,
  WhiteboardReadQuery,
  WhiteboardRecoveryApi,
} from '../shared/ipc'
import {
  SUBSCRIPTION_CONNECT_HELP_CHANNEL,
  SUBSCRIPTION_INSTALL_HELP_CHANNEL,
  SUBSCRIPTION_USAGE_CHANNEL,
  subscriptionLaunchResultOf,
  subscriptionMeteredResultOf,
  subscriptionStatusMapOf,
  type WhiteboardSubscriptionApi,
} from '../shared/subscription-api'

function listen<Args extends unknown[]>(
  channel: string,
  handler: (...args: Args) => void,
): () => void {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => handler(...(args as Args))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const core: WhiteboardCoreApi = {
  consumePending: () => ipcRenderer.invoke(WHITEBOARD_CHANNELS.consumePending),
  openFile: (path) => ipcRenderer.invoke(WHITEBOARD_CHANNELS.openFile, path),
  saveTarget: (req) => ipcRenderer.invoke(WHITEBOARD_CHANNELS.saveTarget, req),
  save: (req) => ipcRenderer.invoke(WHITEBOARD_CHANNELS.save, req),
  saveIntoProject: (req) => ipcRenderer.invoke(WHITEBOARD_CHANNELS.saveIntoProject, req),
  setDirty: (dirty) => ipcRenderer.send(WHITEBOARD_CHANNELS.dirtyChanged, dirty),
  onSaveRequest: (handler) => listen<[SaveRequestMode]>(WHITEBOARD_CHANNELS.saveRequest, handler),
  sendSaveRequestAck: (ok) => ipcRenderer.send(WHITEBOARD_CHANNELS.saveRequestAck, ok),
  onCloseSaveRequest: (handler) => listen<[]>(WHITEBOARD_CHANNELS.closeSaveRequest, handler),
  sendCloseSaveResult: (ok) => ipcRenderer.send(WHITEBOARD_CHANNELS.closeSaveResult, ok),
  onFileRenamed: (handler) => listen<[string]>(WHITEBOARD_CHANNELS.fileRenamed, handler),
  openLink: (url) => ipcRenderer.invoke(WHITEBOARD_CHANNELS.openLink, url),
  readLinkPreview: (url) => ipcRenderer.invoke(WHITEBOARD_CHANNELS.readLinkPreview, url),
  openHelp: () => ipcRenderer.send(WHITEBOARD_CHANNELS.openHelp),
  openFailed: (message) => ipcRenderer.invoke(WHITEBOARD_CHANNELS.openFailed, message),
  onMenuCommand: (handler) =>
    listen<[WhiteboardMenuCommand]>(WHITEBOARD_CHANNELS.menuCommand, handler),
  getLanguage: () => ipcRenderer.invoke(APP_CHANNELS.getLanguage),
  onLanguageChanged: (handler) => listen<[Lang]>(APP_CHANNELS.languageChanged, handler),
  getTheme: () => ipcRenderer.invoke(APP_CHANNELS.getTheme),
  onThemeChanged: (handler) => listen<[UiTheme]>(APP_CHANNELS.themeChanged, handler),
  getAutoSaveDefault: () => ipcRenderer.invoke(APP_CHANNELS.getAutoSaveDefault),
  onAutoSaveDefaultChanged: (handler) =>
    listen<[AutoSaveDefault]>(APP_CHANNELS.autoSaveDefaultChanged, handler),
  onChromePressed: (handler) => listen<[]>(APP_CHANNELS.chromePressed, handler),
  pickPdfFile: () => ipcRenderer.invoke(WHITEBOARD_CHANNELS.pickPdfFile),
  pickImageFile: () => ipcRenderer.invoke(WHITEBOARD_CHANNELS.pickImageFile),
  readDroppedFile: (file) => {
    const filePath = webUtils.getPathForFile(file)
    return ipcRenderer.invoke(WHITEBOARD_CHANNELS.readDroppedFile, filePath)
  },
  setProvisionalTitle: (title) => ipcRenderer.send(WHITEBOARD_CHANNELS.provisionalTitle, title),
}

const exporting: WhiteboardExportApi = {
  onExportRequest: (handler) => listen<[ExportFormat]>(WHITEBOARD_CHANNELS.exportRequest, handler),
  onPrintRequest: (handler) => listen<[]>(WHITEBOARD_CHANNELS.printRequest, handler),
  exportImages: (req) => ipcRenderer.invoke(WHITEBOARD_CHANNELS.exportImages, req),
  exportPdf: (req) => ipcRenderer.invoke(WHITEBOARD_CHANNELS.exportPdf, req),
  print: (req) => ipcRenderer.invoke(WHITEBOARD_CHANNELS.print, req),
  printLayout: createPrintLayoutBridge<WhiteboardPrintJob>(ipcRenderer, 'whiteboard'),
}

const recovery: WhiteboardRecoveryApi = {
  writeRecoveryCopy: (req) => ipcRenderer.invoke(WHITEBOARD_CHANNELS.recoveryCopy, req),
  onRecoveryCopyNow: (handler) => listen<[]>(WHITEBOARD_CHANNELS.recoveryCopyNow, handler),
  sendRecoveryCopyNowDone: () => ipcRenderer.send(WHITEBOARD_CHANNELS.recoveryCopyNowDone),
  onRecoveryReset: (handler) => listen<[]>(WHITEBOARD_CHANNELS.recoveryReset, handler),
}

const queries: WhiteboardQueryApi = {
  onReadRequest: (handler) =>
    listen<[WhiteboardReadQuery]>(WHITEBOARD_CHANNELS.readRequest, handler),
  sendReadResult: (reply) => ipcRenderer.send(WHITEBOARD_CHANNELS.readResult, reply),
  onApplyRequest: (handler) =>
    listen<[WhiteboardApplyQuery]>(WHITEBOARD_CHANNELS.applyRequest, handler),
  sendApplyResult: (reply) => ipcRenderer.send(WHITEBOARD_CHANNELS.applyResult, reply),
  onBytesRequest: (handler) => listen<[]>(WHITEBOARD_CHANNELS.bytesRequest, handler),
  sendBytesResult: (reply) => ipcRenderer.send(WHITEBOARD_CHANNELS.bytesResult, reply),
}

const headless: WhiteboardHeadlessApi = {
  headlessJob: () => ipcRenderer.invoke(WHITEBOARD_CHANNELS.headlessJob),
  headlessDone: (report) => ipcRenderer.send(WHITEBOARD_CHANNELS.headlessDone, report),
}

const handoff: WhiteboardHandoffApi = {
  take: () => ipcRenderer.invoke(WHITEBOARD_CHANNELS.handoffTake),
  reportRunStarted: (report) => ipcRenderer.send(WHITEBOARD_CHANNELS.handoffRunStarted, report),
}

const subscription: WhiteboardSubscriptionApi = {
  statuses: async () =>
    subscriptionStatusMapOf(await ipcRenderer.invoke(SUBSCRIPTION_IPC_CHANNELS.statuses)),
  recheck: async (providers) =>
    subscriptionStatusMapOf(
      await ipcRenderer.invoke(
        SUBSCRIPTION_IPC_CHANNELS.recheck,
        providers ? { providers } : undefined,
      ),
    ),
  login: async (provider, mode) =>
    subscriptionLaunchResultOf(
      await ipcRenderer.invoke(
        SUBSCRIPTION_IPC_CHANNELS.login,
        mode ? { provider, mode } : { provider },
      ),
    ),
  install: async (provider) =>
    subscriptionLaunchResultOf(
      await ipcRenderer.invoke(SUBSCRIPTION_IPC_CHANNELS.install, { provider }),
    ),
  update: async (provider) =>
    subscriptionLaunchResultOf(
      await ipcRenderer.invoke(SUBSCRIPTION_IPC_CHANNELS.update, { provider }),
    ),
  cancelLogin: async (provider) =>
    subscriptionLaunchResultOf(
      await ipcRenderer.invoke(SUBSCRIPTION_IPC_CHANNELS.cancelLogin, { provider }),
    ),
  setMeteredAccepted: async (provider, accepted) =>
    subscriptionMeteredResultOf(
      await ipcRenderer.invoke(SUBSCRIPTION_IPC_CHANNELS.metered, { provider, accepted }),
    ),
  onChanged: (handler) =>
    listen<[unknown]>(SUBSCRIPTION_IPC_CHANNELS.changed, (raw) =>
      handler(subscriptionStatusMapOf(raw)),
    ),
  onUsage: (handler) => listen(SUBSCRIPTION_USAGE_CHANNEL, handler),
  openInstallHelp: (provider) => ipcRenderer.invoke(SUBSCRIPTION_INSTALL_HELP_CHANNEL, provider),
  openConnectHelp: (path) => ipcRenderer.invoke(SUBSCRIPTION_CONNECT_HELP_CHANNEL, path),
}

const ai: WhiteboardAiApi = {
  getSettings: () => ipcRenderer.invoke(AI_CHANNELS.getSettings),
  setSettings: (settings) => ipcRenderer.invoke(AI_CHANNELS.setSettings, settings),
  onSettingsChanged: (handler) => listen<[]>(AI_CHANNELS.settingsChanged, handler),
  getPanelPrefs: () => ipcRenderer.invoke(APP_CHANNELS.getAiPanelPrefs) as Promise<AiPanelPrefs>,
  setPanelPrefs: (patch) => ipcRenderer.invoke(APP_CHANNELS.setAiPanelPrefs, patch),
  onPanelPrefsChanged: (handler) =>
    listen<[AiPanelPrefs]>(APP_CHANNELS.aiPanelPrefsChanged, handler),
  aiStream: (request) => ipcRenderer.invoke(AI_CHANNELS.stream, request),
  aiStreamCancel: (requestId) => ipcRenderer.invoke(AI_CHANNELS.streamCancel, requestId),
  onAiStream: (handler) => listen<[AiStreamChunk]>(AI_CHANNELS.streamChunk, handler),
  openModelSettings: () => ipcRenderer.invoke(AI_CHANNELS.openModelSettings),
  addAttachments: () => ipcRenderer.invoke(WHITEBOARD_CHANNELS.aiAddAttachments),
  addAttachmentPaths: (paths) =>
    ipcRenderer.invoke(WHITEBOARD_CHANNELS.aiAddAttachmentPaths, paths),
  readAttachment: (path, offset, maxChars) =>
    ipcRenderer.invoke(WHITEBOARD_CHANNELS.aiReadAttachment, path, offset, maxChars),
  readAttachmentImage: (path) =>
    ipcRenderer.invoke(WHITEBOARD_CHANNELS.aiReadAttachmentImage, path),
  savePastedImage: (bytes, mime) =>
    ipcRenderer.invoke(WHITEBOARD_CHANNELS.aiSavePastedImage, bytes, mime),
  webSearch: (query, maxResults) => ipcRenderer.invoke(AI_CHANNELS.webSearch, query, maxResults),
  readUrl: (url, offset) => ipcRenderer.invoke(AI_CHANNELS.readUrl, url, offset),
  imageSearch: (query) => ipcRenderer.invoke(WHITEBOARD_CHANNELS.aiImageSearch, query),
  generateImage: (op) => ipcRenderer.invoke(WHITEBOARD_CHANNELS.aiGenerateImage, op),
  fetchImage: (url) => ipcRenderer.invoke(WHITEBOARD_CHANNELS.fetchImage, url),
  resolveFilePath: (file) => webUtils.getPathForFile(file),
}

const project: ProjectApi = {
  ...projectFolderBridge(ipcRenderer),
} as unknown as ProjectApi

const api: WhiteboardApi = {
  core,
  exporting,
  recovery,
  queries,
  headless,
  handoff,
  ai,
  subscription,
  project,
}

contextBridge.exposeInMainWorld('whiteboardApi', api)
contextBridge.exposeInMainWorld(SPLIT_PANE_BRIDGE_KEY, splitPaneBridge(ipcRenderer))
const appChoice = appChoiceBridge()
contextBridge.exposeInMainWorld(APP_CHOICE_BRIDGE_KEY, {
  get: appChoice.get,
  onChange: appChoice.onChange,
})
contextBridge.exposeInMainWorld(PROJECT_FOLDER_BRIDGE_KEY, projectFolderBridge(ipcRenderer))
contextBridge.exposeInMainWorld(USER_SKILLS_BRIDGE_KEY, userSkillsBridge())
contextBridge.exposeInMainWorld(DOC_ATTACH_BRIDGE_KEY, docAttachBridge())
contextBridge.exposeInMainWorld(CONNECTOR_ATTACH_BRIDGE_KEY, connectorAttachBridge())
contextBridge.exposeInMainWorld('aiOfficeDriveAi', driveAiBridge())
contextBridge.exposeInMainWorld('aiOfficeMcpTools', mcpToolsBridge())
contextBridge.exposeInMainWorld('aiOfficeOutbound', outboundBridge())

installDropOpenBridge()
