import type { WebContents } from 'electron'
import type { OpenDocumentTab } from '../../shared/tabs-api'
import type { WhiteboardControl, WhiteboardPageReadAnswer } from './tools/whiteboard-tools'

type MaybePromise<T> = T | Promise<T>

export interface WhiteboardBridgeDeps {
  list: () => Promise<OpenDocumentTab[]>
  webContentsFor: (tabId: string) => MaybePromise<WebContents | undefined>
  isDetached?: (tabId: string) => boolean
  activate?: (tabId: string) => void
  revealWindow?: (tabId: string) => void
  readPage: (contents: WebContents, page?: string) => Promise<WhiteboardPageReadAnswer>
  applyOps: (
    contents: WebContents,
    payload: {
      ops?: Record<string, unknown>[]
      template?: Record<string, unknown>
      defaultPageId?: string
    },
  ) => Promise<unknown>
}

export function createWhiteboardControl(deps: WhiteboardBridgeDeps): WhiteboardControl {
  const contentsOf = async (tab: OpenDocumentTab): Promise<WebContents> => {
    const contents = await deps.webContentsFor(tab.id)
    if (!contents || contents.isDestroyed()) throw new Error(`"${tab.title}" is no longer open`)
    return contents
  }

  return {
    list: deps.list,
    ...(deps.isDetached ? { isDetached: deps.isDetached } : {}),
    read: async (tab, page) => deps.readPage(await contentsOf(tab), page),
    apply: async (tab, payload) => {
      const contents = await contentsOf(tab)
      if (!tab.active) {
        try {
          deps.activate?.(tab.id)
          deps.revealWindow?.(tab.id)
        } catch (error) {
          console.warn('[mcp] could not bring the whiteboard into view:', error)
        }
      }
      return deps.applyOps(contents, payload)
    },
  }
}
