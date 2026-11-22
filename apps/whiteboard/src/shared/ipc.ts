/**
 * IPC channel constants and typed API contract for `@genoffice/whiteboard`.
 * All whiteboard-owned channels use the `whiteboard:` prefix. Shared `ai:*`
 * and subscription channels are registered once by docs-main and never here.
 */
import type { AiStreamChunk } from '@genoffice/ai-provider'
import type { PrintLayoutBridge } from '@genoffice/electron-utils/print-layout-bridge'
import type { Lang } from '@genoffice/i18n'
import type { ProjectApi } from '@genoffice/project-store'
import type { AiPanelPrefs } from '@genoffice/ui'
import type { BoardTableView, ExcalidrawImportSummary } from '@genoffice/whiteboard-engine'
import type { WhiteboardInputFormat } from './formats'
import type { WhiteboardSubscriptionApi } from './subscription-api'

export const WHITEBOARD_CHANNELS = {
  consumePending: 'whiteboard:consume-pending',
  openFile: 'whiteboard:open-file',
  saveTarget: 'whiteboard:save-target',
  save: 'whiteboard:save',
  saveIntoProject: 'whiteboard:save-into-project',
  dirtyChanged: 'whiteboard:dirty-changed',
  saveRequest: 'whiteboard:save-request',
  saveRequestAck: 'whiteboard:save-request-ack',
  closeSaveRequest: 'whiteboard:close-save-request',
  closeSaveResult: 'whiteboard:close-save-result',
  fileRenamed: 'whiteboard:file-renamed',
  openLink: 'whiteboard:open-link',
  readLinkPreview: 'whiteboard:read-link-preview',
  openHelp: 'whiteboard:open-help',
  openFailed: 'whiteboard:open-failed',
  menuCommand: 'whiteboard:menu-command',
  exportRequest: 'whiteboard:export-request',
  printRequest: 'whiteboard:print-request',
  exportImages: 'whiteboard:export-images',
  exportPdf: 'whiteboard:export-pdf',
  print: 'whiteboard:print',
  recoveryCopy: 'whiteboard:recovery-copy',
  recoveryCopyNow: 'whiteboard:recovery-copy-now',
  recoveryCopyNowDone: 'whiteboard:recovery-copy-now-done',
  recoveryReset: 'whiteboard:recovery-reset',
  readRequest: 'whiteboard:read-request',
  readResult: 'whiteboard:read-result',
  applyRequest: 'whiteboard:apply-request',
  applyResult: 'whiteboard:apply-result',
  bytesRequest: 'whiteboard:bytes-request',
  bytesResult: 'whiteboard:bytes-result',
  headlessJob: 'whiteboard:headless-job',
  headlessDone: 'whiteboard:headless-done',
  handoffTake: 'whiteboard:handoff-take',
  handoffRunStarted: 'whiteboard:handoff-run-started',
  aiAddAttachments: 'whiteboard:ai-add-attachments',
  aiAddAttachmentPaths: 'whiteboard:ai-add-attachment-paths',
  aiReadAttachment: 'whiteboard:ai-read-attachment',
  aiReadAttachmentImage: 'whiteboard:ai-read-attachment-image',
  aiSavePastedImage: 'whiteboard:ai-save-pasted-image',
  aiWebSearch: 'whiteboard:ai-web-search',
  aiWebFetch: 'whiteboard:ai-web-fetch',
  aiImageSearch: 'whiteboard:ai-image-search',
  aiGenerateImage: 'whiteboard:ai-generate-image',
  fetchImage: 'whiteboard:fetch-image',
  provisionalTitle: 'whiteboard:provisional-title',
  pickPdfFile: 'whiteboard:pick-pdf-file',
  pickImageFile: 'whiteboard:pick-image-file',
  readDroppedFile: 'whiteboard:read-dropped-file',
} as const

export const APP_CHANNELS = {
  getLanguage: 'app:get-language',
  languageChanged: 'app:language-changed',
  getTheme: 'app:get-theme',
  themeChanged: 'app:theme-changed',
  getAutoSaveDefault: 'app:get-auto-save-default',
  autoSaveDefaultChanged: 'app:auto-save-default-changed',
  chromePressed: 'app:chrome-pressed',
  getAiPanelPrefs: 'app:get-ai-panel-prefs',
  setAiPanelPrefs: 'app:set-ai-panel-prefs',
  aiPanelPrefsChanged: 'app:ai-panel-prefs-changed',
  openSourcePath: 'home:open-path',
} as const

export const AI_CHANNELS = {
  getSettings: 'ai:get-settings',
  setSettings: 'ai:set-settings',
  settingsChanged: 'ai:settings-changed',
  openModelSettings: 'ai:open-model-settings',
  stream: 'ai:stream',
  streamChunk: 'ai:stream-chunk',
  streamCancel: 'ai:stream-cancel',
  webSearch: 'ai:web-search',
  readUrl: 'ai:read-url',
} as const

export type UiTheme = 'light' | 'dark' | 'system'
export interface AutoSaveDefault {
  on: boolean
  updatedAt: number
}
export type SaveMode = 'save' | 'save-as' | 'autosave'
export type SaveRequestMode = 'save' | 'save-as'
export type ExportFormat = 'png' | 'svg' | 'pdf'

export type WhiteboardMenuCommand =
  'undo' | 'redo' | 'import-pdf' | 'present' | 'toggle-ai' | 'zoom-in' | 'zoom-out' | 'zoom-fit'

export interface WhiteboardTabIdentity {
  filePath: string | null
  title: string
  untitled: boolean
  imported?: 'excalidraw'
  sourcePath?: string
  dirty: boolean
}

export type OpenFileResult =
  | {
      ok: true
      kind: 'whiteboard'
      filePath: string
      bytes: Uint8Array
      restoredFromRecovery?: boolean
    }
  | {
      ok: true
      kind: 'excalidraw'
      sourcePath: string
      format: WhiteboardInputFormat
      bytes: Uint8Array
      summary: ExcalidrawImportSummary
    }
  | {
      ok: true
      kind: 'new'
      restoredFromRecovery?: boolean
      bytes?: Uint8Array
      suggestedSavePath?: string | null
    }
  | {
      ok: false
      error: string
    }

export interface SaveTargetRequest {
  mode: SaveMode
  suggestedName?: string
  sourcePath?: string | null
}

export type SaveTargetResult =
  { ok: true; token: string; filePath: string } | { ok: false; canceled?: boolean; error?: string }

export interface SaveWhiteboardRequest {
  token?: string
  mode: SaveMode
  bytes: Uint8Array
  unchanged?: boolean
}

export type SaveWhiteboardResult =
  | { ok: true; filePath: string; skipped?: boolean }
  | { ok: false; canceled?: boolean; conflicted?: boolean; error?: string }

export interface SaveIntoProjectResult {
  ok: boolean
  filePath?: string
  error?: string
}

export interface LinkPreviewResult {
  ok: boolean
  title?: string | null
  description?: string | null
  imageBytes?: Uint8Array | null
  imageMime?: string | null
  error?: string
}

export interface ExportPageImage {
  number: number
  bytes: Uint8Array
}

export interface ExportImagesRequest {
  format: 'png' | 'svg'
  suggestedName: string
  pages: ExportPageImage[]
  singlePage?: boolean
}

export interface PrintPage {
  svg: string
  width: number
  height: number
  pageWidth: number
  pageHeight: number
}

export interface ExportPdfRequest {
  suggestedName: string
  pages: PrintPage[]
}

export interface PrintWhiteboardRequest {
  title: string
  pages: PrintPage[]
}

export interface WhiteboardPrintJob {
  title: string
  pages: PrintPage[]
}

export type ExportResult =
  { ok: true; paths: string[] } | { ok: false; canceled?: boolean; error?: string }

export type PrintResult = { ok: true } | { ok: false; canceled?: boolean; error?: string }

export interface RecoveryCopyRequest {
  bytes: Uint8Array
  title: string
  originalPath?: string | null
}

export interface RecoveryCopyResult {
  ok: boolean
  error?: string
}

export interface WhiteboardReadQuery {
  id: string
  page?: string
  current?: boolean
}

export type WhiteboardReadReply =
  { id: string; text: string; table?: BoardTableView } | { id: string; error: string }

export interface WhiteboardApplyQuery {
  id: string
  ops?: Record<string, unknown>[]
  template?: Record<string, unknown>
  defaultPageId?: string
}

export type WhiteboardApplyReply = { id: string; result: unknown } | { id: string; error: string }

export type WhiteboardBytesReply = { ok: true; bytes: Uint8Array } | { ok: false; error: string }

export interface WhiteboardHeadlessJob {
  kind: 'export'
  format: ExportFormat
  page?: number
}

export type WhiteboardHeadlessReport =
  | { ok: true; kind: 'pdf'; pages: PrintPage[] }
  | { ok: true; kind: 'images'; format: 'png' | 'svg'; pages: ExportPageImage[] }
  | { ok: false; error: string }

export interface WhiteboardHandoff {
  id: string
  sourcePaths: string[]
  prompt: string
}

export interface AttachmentMeta {
  id: string
  name: string
  path: string
  size: number
  ext: string
  isImage: boolean
}

export interface AttachmentAddResult {
  added: AttachmentMeta[]
  rejected: Array<{ name: string; reason: string }>
}

export interface AttachmentReadResult {
  ok: boolean
  text?: string
  truncated?: boolean
  totalChars?: number
  error?: string
}

export interface AttachmentImageResult {
  ok: boolean
  base64?: string
  mime?: string
  error?: string
}

export interface LocalFileBytesResult {
  ok: boolean
  path?: string
  name?: string
  bytes?: Uint8Array
  error?: string
}

export interface WhiteboardCoreApi {
  consumePending(): Promise<OpenFileResult>
  openFile(path: string): Promise<OpenFileResult>
  saveTarget(request: SaveTargetRequest): Promise<SaveTargetResult>
  save(request: SaveWhiteboardRequest): Promise<SaveWhiteboardResult>
  saveIntoProject(request: { fileName: string; bytes: Uint8Array }): Promise<SaveIntoProjectResult>
  setDirty(dirty: boolean): void
  onSaveRequest(handler: (mode: SaveRequestMode) => void): () => void
  sendSaveRequestAck(ok: boolean): void
  onCloseSaveRequest(handler: () => void): () => void
  sendCloseSaveResult(ok: boolean): void
  onFileRenamed(handler: (newPath: string) => void): () => void
  openLink(url: string): Promise<boolean>
  readLinkPreview(url: string): Promise<LinkPreviewResult>
  openHelp(): void
  openFailed(message: string): Promise<void>
  onMenuCommand(handler: (cmd: WhiteboardMenuCommand) => void): () => void
  getLanguage(): Promise<Lang>
  onLanguageChanged(handler: (lang: Lang) => void): () => void
  getTheme(): Promise<UiTheme>
  onThemeChanged(handler: (theme: UiTheme) => void): () => void
  getAutoSaveDefault(): Promise<AutoSaveDefault>
  onAutoSaveDefaultChanged(handler: (value: AutoSaveDefault) => void): () => void
  onChromePressed(handler: () => void): () => void
  pickPdfFile(): Promise<LocalFileBytesResult>
  pickImageFile(): Promise<LocalFileBytesResult>
  readDroppedFile(file: File): Promise<LocalFileBytesResult>
  setProvisionalTitle(title: string): void
}

export interface WhiteboardExportApi {
  onExportRequest(handler: (format: ExportFormat) => void): () => void
  onPrintRequest(handler: () => void): () => void
  exportImages(request: ExportImagesRequest): Promise<ExportResult>
  exportPdf(request: ExportPdfRequest): Promise<ExportResult>
  print(request: PrintWhiteboardRequest): Promise<PrintResult>
  printLayout: PrintLayoutBridge<WhiteboardPrintJob>
}

export interface WhiteboardRecoveryApi {
  writeRecoveryCopy(request: RecoveryCopyRequest): Promise<RecoveryCopyResult>
  onRecoveryCopyNow(handler: () => void): () => void
  sendRecoveryCopyNowDone(): void
  onRecoveryReset(handler: () => void): () => void
}

export interface WhiteboardQueryApi {
  onReadRequest(handler: (query: WhiteboardReadQuery) => void): () => void
  sendReadResult(reply: WhiteboardReadReply): void
  onApplyRequest(handler: (query: WhiteboardApplyQuery) => void): () => void
  sendApplyResult(reply: WhiteboardApplyReply): void
  onBytesRequest(handler: () => void): () => void
  sendBytesResult(reply: WhiteboardBytesReply): void
}

export interface WhiteboardHeadlessApi {
  headlessJob(): Promise<WhiteboardHeadlessJob | null>
  headlessDone(report: WhiteboardHeadlessReport): void
}

export interface WhiteboardHandoffApi {
  take(): Promise<WhiteboardHandoff | null>
  reportRunStarted(report: { id: string; attachedPaths: string[] }): void
}

export interface WhiteboardAiApi {
  getSettings(): Promise<unknown>
  setSettings(settings: unknown): Promise<void>
  onSettingsChanged(handler: () => void): () => void
  getPanelPrefs(): Promise<AiPanelPrefs>
  setPanelPrefs(patch: Partial<AiPanelPrefs>): Promise<void>
  onPanelPrefsChanged(handler: (prefs: AiPanelPrefs) => void): () => void
  aiStream(request: unknown): Promise<void>
  aiStreamCancel(requestId: string): Promise<void>
  onAiStream(handler: (chunk: AiStreamChunk) => void): () => void
  openModelSettings(): Promise<void>
  addAttachments(): Promise<AttachmentAddResult>
  addAttachmentPaths(paths: string[]): Promise<AttachmentAddResult>
  readAttachment(path: string, offset?: number, maxChars?: number): Promise<AttachmentReadResult>
  readAttachmentImage(path: string): Promise<AttachmentImageResult>
  savePastedImage(bytes: Uint8Array, mime: string): Promise<AttachmentMeta | null>
  webSearch(query: string, maxResults?: number): Promise<unknown>
  readUrl(url: string, offset?: number): Promise<unknown>
  imageSearch(query: string): Promise<unknown>
  generateImage(op: { prompt: string; aspectRatio?: string; model?: string }): Promise<unknown>
  fetchImage(url: string): Promise<{ base64: string; mime: string } | null>
  resolveFilePath(file: File): string
}

export interface WhiteboardApi {
  core: WhiteboardCoreApi
  exporting: WhiteboardExportApi
  recovery: WhiteboardRecoveryApi
  queries: WhiteboardQueryApi
  headless: WhiteboardHeadlessApi
  handoff: WhiteboardHandoffApi
  ai: WhiteboardAiApi
  subscription: WhiteboardSubscriptionApi
  project: ProjectApi
}
