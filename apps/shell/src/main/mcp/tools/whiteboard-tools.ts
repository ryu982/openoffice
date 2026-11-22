import { PRODUCT_NAME } from '@genoffice/i18n'
import { z } from 'zod'
import type { OpenDocumentTab } from '../../../shared/tabs-api'
import type { McpToolDefinition } from '../mcp-server'
import { resolveOpenDocumentOfFamily } from './open-documents-tools'

export interface WhiteboardPageReadAnswer {
  text: string
  table?: unknown
}

export interface WhiteboardControl {
  list: () => Promise<OpenDocumentTab[]>
  isDetached?: (tabId: string) => boolean
  read: (tab: OpenDocumentTab, page?: string) => Promise<WhiteboardPageReadAnswer>
  apply: (
    tab: OpenDocumentTab,
    payload: {
      ops?: Record<string, unknown>[]
      template?: Record<string, unknown>
      defaultPageId?: string
    },
  ) => Promise<unknown>
}

export interface WhiteboardToolsDeps {
  control?: WhiteboardControl
}

export const WHITEBOARD_MCP_TOOL_NAMES = {
  read: 'read_whiteboard',
  apply: 'apply_whiteboard_ops',
} as const

const DOCUMENT_ARG = z
  .string()
  .optional()
  .describe(
    'Id or path of an open whiteboard, as open_documents lists it. Default: the whiteboard in front.',
  )

function noWhiteboardInFront(documents: readonly OpenDocumentTab[]): Error {
  const boards = documents.filter((doc) => doc.kind === 'whiteboard')
  if (boards.length === 0) {
    return new Error(`no whiteboard is open in ${PRODUCT_NAME}`)
  }
  const listing = boards
    .map((doc) => `  ${doc.id}  ${doc.filePath ?? '(never saved)'}  — ${doc.title}`)
    .join('\n')
  return new Error(
    `no whiteboard is in front; pass document with one of the open whiteboards:\n${listing}`,
  )
}

async function resolveWhiteboardTab(
  control: WhiteboardControl,
  document?: string,
): Promise<OpenDocumentTab> {
  const documents = await control.list()
  if (document) return resolveOpenDocumentOfFamily(documents, document, 'whiteboard')
  const activeDetached = documents.find(
    (doc) => doc.kind === 'whiteboard' && doc.active && control.isDetached?.(doc.id),
  )
  if (activeDetached) return activeDetached
  const active = documents.find((doc) => doc.kind === 'whiteboard' && doc.active)
  if (active) return active
  const boards = documents.filter((doc) => doc.kind === 'whiteboard')
  if (boards.length === 1) return boards[0]!
  throw noWhiteboardInFront(documents)
}

export function createWhiteboardTools(deps: WhiteboardToolsDeps): McpToolDefinition[] {
  const requireControl = (): WhiteboardControl => {
    if (!deps.control) {
      throw new Error(`the whiteboard editor is unavailable in headless mode (${PRODUCT_NAME})`)
    }
    return deps.control
  }

  return [
    {
      name: WHITEBOARD_MCP_TOOL_NAMES.read,
      description:
        'Read an open whiteboard tab as a structured text table. Omit page to read the active page, or specify a page id, title, or 1-based index.',
      inputSchema: {
        document: DOCUMENT_ARG,
        page: z.string().optional().describe('Optional page id, title, or 1-based index.'),
      },
      handler: async (args) => {
        const control = requireControl()
        const tab = await resolveWhiteboardTab(control, args.document as string | undefined)
        const ans = await control.read(tab, args.page as string | undefined)
        return {
          document: { id: tab.id, title: tab.title, filePath: tab.filePath },
          text: ans.text,
          ...(ans.table ? { table: ans.table } : {}),
        }
      },
    },
    {
      name: WHITEBOARD_MCP_TOOL_NAMES.apply,
      description:
        'Apply an atomic batch of whiteboard ops or a declarative template to an open whiteboard tab as one undo step (all or nothing).',
      inputSchema: {
        document: DOCUMENT_ARG,
        ops: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe(
            'Ordered list of whiteboard edit operations (add, update [including tablePatch], move [x/y and z-order], delete, add_page, rename_page, delete_page, set_page_format).',
          ),
        template: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Declarative JSON layout template (schemaVersion: 1, pages: [...]).'),
        defaultPageId: z.string().optional().describe('Optional default page id for add ops.'),
      },
      handler: async (args) => {
        const control = requireControl()
        const tab = await resolveWhiteboardTab(control, args.document as string | undefined)
        const ops = Array.isArray(args.ops) ? (args.ops as Record<string, unknown>[]) : undefined
        const template =
          args.template && typeof args.template === 'object'
            ? (args.template as Record<string, unknown>)
            : undefined
        if (!ops && !template) {
          throw new Error('provide either ops or template')
        }
        return control.apply(tab, {
          ops,
          template,
          defaultPageId: typeof args.defaultPageId === 'string' ? args.defaultPageId : undefined,
        })
      },
    },
  ]
}
