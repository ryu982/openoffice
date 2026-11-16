/**
 * The book translations this editor's screens run, as the shell's AI
 * activity sees them.
 * The jobs themselves run in the screen and send their model calls over the
 * shared `ai:stream`; the screen tells the main process when one begins and
 * ends, so Settings can count it and stop it (turning AI off) as one job.
 *
 * A job may not begin while AI is turned off: the screen hides every way in,
 * and this is the second wall behind it. Only the editor's IPC handlers call
 * here, so the sender is always an app screen; a job the terminal command or
 * MCP runs (`epub translate`) never passes through and is
 * neither refused nor counted.
 *
 * Electron-free: the caller passes the sender and the shell's readers. The
 * PDF editor has the same module (apps/pdf/src/main/screen-ai-jobs.ts).
 */
import type { AiJob } from '@genoffice/electron-utils/ai-activity'

/** shown when no refusal text is set (an editor running on its own never refuses) */
export const AI_OFF_FALLBACK = 'AI features are turned off in Settings.'

/** how long a stop waits for the screen to report the job ended */
export const SCREEN_JOB_STOP_WAIT_MS = 10_000

/** Structural subset of Electron's WebContents */
export interface ScreenJobSender {
  readonly id: number
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
  once(event: 'destroyed', listener: () => void): unknown
}

export interface ScreenAiJobsDeps {
  /** whether AI features are on now */
  aiOn(): boolean
  /** the refusal the window `senderId` gets while AI is off, null for none */
  refusal(senderId: number): string | null
  /** put a running job on the shell's list; returns the way off it */
  register(job: AiJob): () => void
  /** the channel that asks the screen to stop one job (its id as the argument) */
  stopChannel: string
  stopWaitMs?: number
}

export type ScreenJobBeginAnswer = { ok: true } | { ok: false; error: string }

export interface ScreenAiJobs {
  /** a screen's job begins: refused while AI is off */
  begin(sender: ScreenJobSender, jobId: unknown): ScreenJobBeginAnswer
  /** the job ended however it ended (a second call does nothing) */
  end(senderId: number, jobId: unknown): void
  /** how many jobs are on the list (tests) */
  size(): number
}

interface Entry {
  senderId: number
  unregister: () => void
  /** stops waiting for the screen's end */
  waiters: (() => void)[]
}

const jobIdOf = (raw: unknown): string | null =>
  typeof raw === 'string' && raw.length > 0 && raw.length <= 100 ? raw : null

export function createScreenAiJobs(deps: ScreenAiJobsDeps): ScreenAiJobs {
  const stopWaitMs = deps.stopWaitMs ?? SCREEN_JOB_STOP_WAIT_MS
  const running = new Map<string, Entry>()
  const watched = new Set<number>()
  const keyOf = (senderId: number, jobId: string) => `${senderId}\u0000${jobId}`

  const finish = (key: string) => {
    const entry = running.get(key)
    if (!entry) return
    running.delete(key)
    entry.unregister()
    for (const done of entry.waiters.splice(0)) done()
  }

  const watch = (sender: ScreenJobSender) => {
    if (watched.has(sender.id)) return
    watched.add(sender.id)
    // a closed tab ends its jobs' streams in the shell; the list forgets them too
    sender.once('destroyed', () => {
      watched.delete(sender.id)
      for (const [key, entry] of [...running]) if (entry.senderId === sender.id) finish(key)
    })
  }

  return {
    begin(sender, rawId) {
      const jobId = jobIdOf(rawId)
      if (!jobId) return { ok: false, error: 'invalid job id' }
      if (!deps.aiOn()) return { ok: false, error: deps.refusal(sender.id) ?? AI_OFF_FALLBACK }
      const key = keyOf(sender.id, jobId)
      if (running.has(key)) return { ok: true }
      const entry: Entry = { senderId: sender.id, unregister: () => {}, waiters: [] }
      running.set(key, entry)
      watch(sender)
      entry.unregister = deps.register({
        kind: 'document-job',
        // the screen's Stop for this job: it cancels the job's calls, and the
        // shell's ai:stream ends the subscription programs they started
        stop: () =>
          new Promise<void>((resolve) => {
            if (!running.has(key) || sender.isDestroyed()) {
              finish(key)
              resolve()
              return
            }
            const timer = setTimeout(() => finish(key), stopWaitMs)
            entry.waiters.push(() => {
              clearTimeout(timer)
              resolve()
            })
            sender.send(deps.stopChannel, jobId)
          }),
      })
      return { ok: true }
    },
    end(senderId, rawId) {
      const jobId = jobIdOf(rawId)
      if (jobId) finish(keyOf(senderId, jobId))
    },
    size: () => running.size,
  }
}
