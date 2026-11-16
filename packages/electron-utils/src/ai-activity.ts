/**
 * The AI work the app's screens started that is running now, so the shell can
 * say how much is running and stop all of it (turning AI off in Settings).
 * One job is one AI chat turn receiving its answer (per tab), one running
 * translation or AI reading job, one generation of the create window, one run
 * of the agent window, or one answer of home's ask box. Work the terminal
 * command or MCP started is not registered here: it is neither counted nor
 * stopped.
 *
 * In-process and Electron-free: the shell and the editor mains share it
 * because they run in the same main process.
 */

export type AiJobKind = 'chat' | 'document-job' | 'generate' | 'agent' | 'home-ask'

export interface AiJob {
  kind: AiJobKind
  /** stop the job; may finish later, a throw counts as stopped */
  stop: () => void | Promise<unknown>
  /**
   * Jobs sharing a group count as one, e.g. the parallel model calls of one
   * tab's chat turn. Without a group every job counts on its own.
   */
  group?: string
  /**
   * Keep the group counted this long after the job ends, so a chat turn that
   * pauses between model calls (its tools run in the screen) is not "nothing
   * running" for that moment. Only meaningful with a group.
   */
  lingerMs?: number
}

const jobs = new Set<AiJob>()
/** jobs stop-all ended: their own end does not linger */
const stoppedByAll = new WeakSet<AiJob>()
const listeners = new Set<(count: number) => void>()
/** groups whose last job ended a moment ago, with the timer that forgets them */
const lingering = new Map<string, ReturnType<typeof setTimeout>>()

function count(): number {
  const groups = new Set<string>(lingering.keys())
  let single = 0
  for (const job of jobs) {
    if (job.group === undefined) single++
    else groups.add(job.group)
  }
  return single + groups.size
}

function changed(): void {
  const count_ = count()
  for (const listener of [...listeners]) {
    try {
      listener(count_)
    } catch {
      // one listener's failure does not keep the others uninformed
    }
  }
}

/**
 * Register a running job. The returned handle unregisters it; call it when
 * the job ends however it ends. A second call does nothing.
 */
export function registerAiJob(job: AiJob): () => void {
  const entry: AiJob = { kind: job.kind, stop: job.stop }
  if (job.group !== undefined) {
    entry.group = job.group
    const timer = lingering.get(job.group)
    if (timer !== undefined) {
      clearTimeout(timer)
      lingering.delete(job.group)
    }
  }
  jobs.add(entry)
  changed()
  return () => {
    if (!jobs.delete(entry)) return
    const group = entry.group
    const linger = stoppedByAll.has(entry) ? 0 : (job.lingerMs ?? 0)
    if (group !== undefined && linger > 0 && ![...jobs].some((j) => j.group === group)) {
      const timer = setTimeout(() => {
        if (lingering.get(group) === timer) {
          lingering.delete(group)
          changed()
        }
      }, linger)
      // a lingering count never keeps a process alive
      ;(timer as { unref?: () => void }).unref?.()
      lingering.set(group, timer)
    }
    changed()
  }
}

/** How many jobs run now; jobs of one group count once */
export function runningAiJobCount(): number {
  return count()
}

/**
 * Stop every job running now and wait for their stops. Each job leaves the
 * registry once its stop settled, even when the job forgets to unregister.
 * A job registered while this runs is not stopped. Answers how many it stopped.
 */
export async function stopAllAiJobs(): Promise<number> {
  const running = [...jobs]
  const before = count()
  // a group between two model calls has nothing to stop now; its next call is
  // refused once AI is off, so it is only forgotten here
  const hadLingering = lingering.size > 0
  for (const timer of lingering.values()) clearTimeout(timer)
  lingering.clear()
  await Promise.all(
    running.map(async (job) => {
      stoppedByAll.add(job)
      try {
        await job.stop()
      } catch {
        // a stop that throws still counts: the job is no longer wanted
      }
      if (jobs.delete(job)) changed()
    }),
  )
  if (hadLingering) changed()
  return before
}

/** Hear the running count after every change; returns the unsubscribe */
export function onAiJobsChanged(listener: (count: number) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
