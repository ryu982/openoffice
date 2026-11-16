/**
 * The AI's "make a new document" tools (`create_document` in the Word,
 * spreadsheet and PDF editors) while some editors are turned off in
 * Settings → Editors and AI (AI itself on): a type whose editor is off is
 * refused before anything is made, with a reason the AI can pass on, and
 * every request tells the model up front which types it must not make.
 * The terminal command and MCP do not come through here (they ignore the
 * choice). Editing documents that are already open is not affected.
 *
 * The answer comes from `appChoice()` (the shell sets its source); with no
 * source (an editor on its own) everything is on. The text is for the
 * model, which answers the person in their own language, so it is English
 * like the tools' other errors.
 */
import { appChoice, type EditorItemId } from './app-choice'

/** a file type an AI tool can make → the item whose editor opens it */
const CREATE_TYPE_ITEM: Readonly<Record<string, EditorItemId>> = {
  docx: 'docs',
  odt: 'docs',
  xlsx: 'sheets',
  csv: 'sheets',
  pptx: 'slides',
  pdf: 'pdf',
  md: 'markdown',
  html: 'html',
  xmind: 'mindmap',
  drawio: 'diagram',
  hwp: 'hwp',
  hwpx: 'hwp',
  epub: 'epub',
}

/** the editors as the model should name them (format names, decision 0052) */
const ITEM_LABEL: Readonly<Record<EditorItemId, string>> = {
  docs: 'Word document (.docx)',
  sheets: 'spreadsheet (.xlsx)',
  slides: 'presentation (.pptx)',
  pdf: 'PDF',
  pdfTools: 'PDF tools',
  markdown: 'Markdown (.md)',
  html: 'HTML',
  mindmap: 'mind map (.xmind)',
  diagram: 'diagram (.drawio)',
  hwp: 'Hangul (.hwp/.hwpx)',
  epub: 'EPUB',
}

const SETTINGS_PLACE = 'Settings → Editors and AI'

/** the tools that make a new document of a chosen type */
const CREATE_TOOL_NAMES: ReadonlySet<string> = new Set(['create_document'])

/** the item whose editor opens a file of this type; null = no editor known */
export function editorItemOfCreateType(type: unknown): EditorItemId | null {
  if (typeof type !== 'string') return null
  const key = type.toLowerCase()
  return Object.hasOwn(CREATE_TYPE_ITEM, key) ? (CREATE_TYPE_ITEM[key] ?? null) : null
}

/**
 * Why the AI may not make a document of this type now, or null when it may.
 * Read at the moment it is asked; call it before anything is written or opened.
 */
export function aiCreateRefusal(type: unknown): string | null {
  const item = editorItemOfCreateType(type)
  if (!item || !appChoice().off.includes(item)) return null
  return (
    `Refused: the ${ITEM_LABEL[item]} editor is turned off in this app, so no new ` +
    `'${String(type)}' document was created or opened. Tell the user that this editor is ` +
    `turned off and that they can turn it on in ${SETTINGS_PLACE}, then ask again.`
  )
}

/** the types a create tool's input schema offers; every known type when it lists none */
function typesOfTool(tool: { inputSchema?: unknown }): string[] {
  const schema = tool.inputSchema as
    { properties?: { type?: { enum?: unknown } } } | null | undefined
  const listed = schema?.properties?.type?.enum
  if (Array.isArray(listed)) return listed.filter((t): t is string => typeof t === 'string')
  return Object.keys(CREATE_TYPE_ITEM)
}

/**
 * The tools of one AI request, with a line added to each create tool's
 * description naming the types it offers whose editor is off now. The same
 * array when there is nothing to say; the input is never changed.
 */
export function withOffDocumentKinds<
  T extends { name: string; description: string; inputSchema?: unknown },
>(tools: T[]): T[] {
  const off = appChoice().off
  if (off.length === 0) return tools
  let changed = false
  const out = tools.map((tool) => {
    if (!CREATE_TOOL_NAMES.has(tool.name)) return tool
    const types = typesOfTool(tool).filter((type) => {
      const item = editorItemOfCreateType(type)
      return item !== null && off.includes(item)
    })
    if (types.length === 0) return tool
    changed = true
    const list = types.map((type) => `'${type}'`).join(', ')
    return {
      ...tool,
      description:
        `${tool.description} ` +
        `Turned off in this app now: the editors for type ${list}. Do not create or open ` +
        `documents of ${types.length === 1 ? 'that type' : 'those types'} (the tool refuses them); ` +
        `if the user asks for one, tell them the editor is turned off and can be turned on in ` +
        `${SETTINGS_PLACE}.`,
    }
  })
  return changed ? out : tools
}
