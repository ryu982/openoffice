/**
 * In-app MCP queries against an open whiteboard tab: read structured board/page
 * tables, apply atomic edit ops or declarative templates, and fetch current bytes.
 */
import { randomUUID } from 'node:crypto'
import { ipcMain, type WebContents } from 'electron'
import type { BoardTableView } from '@genoffice/whiteboard-engine'
import {
  WHITEBOARD_CHANNELS,
  type WhiteboardApplyQuery,
  type WhiteboardApplyReply,
  type WhiteboardBytesReply,
  type WhiteboardReadQuery,
  type WhiteboardReadReply,
} from '../shared/ipc'

const READ_TIMEOUT_MS = 30_000
const APPLY_TIMEOUT_MS = 60_000
const RESEND_MS = 250
const GONE = 'the whiteboard is no longer open'

interface Waiter {
  wcId: number
  settle: (reply: unknown) => void
}

const readWaiters = new Map<string, Waiter>()
const applyWaiters = new Map<string, Waiter>()
const bytesWaiters = new Map<number, Array<(reply: WhiteboardBytesReply) => void>>()
let listening = false

function ensureListening(): void {
  if (listening) return
  listening = true
  const route =
    (waiters: Map<string, Waiter>) => (e: { sender: { id: number } }, reply: unknown) => {
      if (!reply || typeof reply !== 'object') return
      const id = (reply as { id?: unknown }).id
      if (typeof id !== 'string') return
      const waiter = waiters.get(id)
      if (!waiter || waiter.wcId !== e.sender.id) return
      waiter.settle(reply)
    }
  ipcMain.on(WHITEBOARD_CHANNELS.readResult, route(readWaiters))
  ipcMain.on(WHITEBOARD_CHANNELS.applyResult, route(applyWaiters))
  ipcMain.on(WHITEBOARD_CHANNELS.bytesResult, (e, reply: unknown) => {
    const queue = bytesWaiters.get(e.sender.id)
    if (!queue || queue.length === 0) return
    const next = queue.shift()!
    if (queue.length === 0) bytesWaiters.delete(e.sender.id)
    if (reply && typeof reply === 'object' && 'ok' in reply) {
      next(reply as WhiteboardBytesReply)
    } else {
      next({ ok: false, error: 'invalid bytes reply' })
    }
  })
}

export interface WhiteboardPageRead {
  text: string
  table?: BoardTableView
}

function askRead(
  contents: WebContents,
  scope: Omit<WhiteboardReadQuery, 'id'>,
): Promise<WhiteboardPageRead> {
  if (contents.isDestroyed()) return Promise.reject(new Error(GONE))
  ensureListening()
  const wcId = contents.id
  const query: WhiteboardReadQuery = { id: randomUUID(), ...scope }
  return new Promise<WhiteboardPageRead>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearInterval(resend)
      clearTimeout(timer)
      readWaiters.delete(query.id)
      fn()
    }
    const resend = setInterval(() => {
      if (contents.isDestroyed()) {
        finish(() => reject(new Error(GONE)))
        return
      }
      contents.send(WHITEBOARD_CHANNELS.readRequest, query)
    }, RESEND_MS)
    const timer = setTimeout(
      () => finish(() => reject(new Error('timed out reading the whiteboard'))),
      READ_TIMEOUT_MS,
    )
    readWaiters.set(query.id, {
      wcId,
      settle: (raw) => {
        const reply = raw as WhiteboardReadReply
        if ('text' in reply && typeof reply.text === 'string') {
          finish(() =>
            resolve({ text: reply.text, ...(reply.table ? { table: reply.table } : {}) }),
          )
        } else if ('error' in reply) {
          finish(() => reject(new Error(String(reply.error))))
        }
      },
    })
    contents.send(WHITEBOARD_CHANNELS.readRequest, query)
  })
}

export async function whiteboardReadText(contents: WebContents): Promise<string> {
  return (await askRead(contents, {})).text
}

export function whiteboardReadPage(
  contents: WebContents,
  page?: string,
): Promise<WhiteboardPageRead> {
  return askRead(contents, page ? { page } : { current: true })
}

const applyChains = new Map<number, Promise<unknown>>()

function askApply(
  contents: WebContents,
  payload: Omit<WhiteboardApplyQuery, 'id'>,
): Promise<unknown> {
  if (contents.isDestroyed()) return Promise.reject(new Error(GONE))
  ensureListening()
  const wcId = contents.id
  const query: WhiteboardApplyQuery = { id: randomUUID(), ...payload }
  return new Promise<unknown>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearInterval(watch)
      clearTimeout(timer)
      applyWaiters.delete(query.id)
      fn()
    }
    const watch = setInterval(() => {
      if (contents.isDestroyed()) finish(() => reject(new Error(GONE)))
    }, RESEND_MS)
    const timer = setTimeout(
      () => finish(() => reject(new Error('timed out applying whiteboard ops'))),
      APPLY_TIMEOUT_MS,
    )
    applyWaiters.set(query.id, {
      wcId,
      settle: (raw) => {
        const reply = raw as WhiteboardApplyReply
        if ('result' in reply) finish(() => resolve(reply.result))
        else if ('error' in reply) finish(() => reject(new Error(String(reply.error))))
      },
    })
    contents.send(WHITEBOARD_CHANNELS.applyRequest, query)
  })
}

export function whiteboardApplyOps(
  contents: WebContents,
  ops: Record<string, unknown>[],
  options: { defaultPageId?: string; template?: Record<string, unknown> } = {},
): Promise<unknown> {
  const wcId = contents.id
  const prev = applyChains.get(wcId) ?? Promise.resolve()
  const next = prev
    .catch(() => {})
    .then(async () => {
      await askRead(contents, { current: true })
      return askApply(contents, {
        ...(ops.length > 0 ? { ops } : {}),
        ...(options.template ? { template: options.template } : {}),
        ...(options.defaultPageId ? { defaultPageId: options.defaultPageId } : {}),
      })
    })
  applyChains.set(wcId, next)
  next.finally(() => {
    if (applyChains.get(wcId) === next) applyChains.delete(wcId)
  })
  return next
}

export function whiteboardReadBytes(contents: WebContents): Promise<Uint8Array> {
  if (contents.isDestroyed()) return Promise.reject(new Error(GONE))
  ensureListening()
  const wcId = contents.id
  return new Promise<Uint8Array>((resolve, reject) => {
    const queue = bytesWaiters.get(wcId) ?? []
    bytesWaiters.set(wcId, queue)
    const timer = setTimeout(
      () => reject(new Error('timed out reading whiteboard bytes')),
      READ_TIMEOUT_MS,
    )
    queue.push((reply) => {
      clearTimeout(timer)
      if (reply.ok) resolve(reply.bytes)
      else reject(new Error(reply.error))
    })
    contents.send(WHITEBOARD_CHANNELS.bytesRequest)
  })
}
