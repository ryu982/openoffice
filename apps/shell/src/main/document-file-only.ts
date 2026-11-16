/**
 * "Create the file only" for a document another feature would open as a new
 * tab of a turned-off editor (editor choice spec 7.3), such as the PDF
 * annotation list's "Open as Markdown / Word document": the file is written
 * where new documents of the asking view go (its project folder, else the
 * default save folder, under a free name) and shown in its folder. Never the
 * AI's document creator. Electron-free: index.ts hands in the writes.
 */

export interface DocumentFileRequest {
  type: string
  title: string
  /** docx: restricted HTML; md: Markdown source */
  content: string
}

export interface DocumentFileOnlyDeps {
  /** a safe file-name stem for the title */
  fileBase(title: string): string
  /** a Word file's bytes from restricted HTML */
  htmlToDocx(html: string): Promise<Uint8Array>
  /** into the asking view's project folder; null without a project */
  writeInProject(owner: number, fileName: string, bytes: Uint8Array): Promise<string | null>
  /** into the default save folder under a free name like `fileName`; its path */
  writeInDefaultFolder(fileName: string, bytes: Uint8Array): Promise<string>
  reveal(path: string): void
}

export async function writeDocumentFileOnly(
  deps: DocumentFileOnlyDeps,
  request: DocumentFileRequest,
  owner: number,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (request.type !== 'md' && request.type !== 'docx') {
    return { ok: false, error: `unsupported document type: ${request.type}` }
  }
  if (!request.content.trim()) return { ok: false, error: 'content must not be empty' }
  try {
    const fileName = `${deps.fileBase(request.title)}.${request.type}`
    const bytes =
      request.type === 'md'
        ? new TextEncoder().encode(request.content)
        : await deps.htmlToDocx(request.content)
    const path =
      (await deps.writeInProject(owner, fileName, bytes)) ??
      (await deps.writeInDefaultFolder(fileName, bytes))
    deps.reveal(path)
    return { ok: true, path }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
