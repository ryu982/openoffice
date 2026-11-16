// @vitest-environment node
/**
 * The screen's document jobs on the shell's list of running AI work: a job
 * begins only while AI is on, counts as one 'document-job', leaves the list
 * when the screen says it ended or its tab closes, and "stop all" asks the
 * screen to stop it and waits for its end. Uses the real activity list.
 */
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  registerAiJob,
  runningAiJobCount,
  stopAllAiJobs,
  type AiJob,
} from '@genoffice/electron-utils/ai-activity'
import { AI_OFF_FALLBACK, createScreenAiJobs } from '../src/main/screen-ai-jobs'

class FakeSender extends EventEmitter {
  static next = 1
  readonly id = FakeSender.next++
  destroyed = false
  readonly sent: Array<[string, ...unknown[]]> = []
  isDestroyed = () => this.destroyed
  send(channel: string, ...args: unknown[]): void {
    this.sent.push([channel, ...args])
  }
  destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

const STOP = 'pdf:ai-job-stop'

function setup(o: { aiOn?: boolean; refusal?: string | null; stopWaitMs?: number } = {}) {
  let aiOn = o.aiOn ?? true
  const kinds: AiJob['kind'][] = []
  const jobs = createScreenAiJobs({
    aiOn: () => aiOn,
    refusal: () => (o.refusal === undefined ? 'AI is off.' : o.refusal),
    register: (job) => {
      kinds.push(job.kind)
      return registerAiJob(job)
    },
    stopChannel: STOP,
    // short, so the clean-up's stop of a job a test left running does not wait long
    stopWaitMs: o.stopWaitMs ?? 20,
  })
  return { jobs, kinds, setAiOn: (on: boolean) => (aiOn = on) }
}

afterEach(async () => {
  vi.useRealTimers()
  // nothing a test left behind stays on the process-wide list
  await stopAllAiJobs()
})

describe('screen document jobs on the AI activity list', () => {
  it('refuses a job while AI is off and lists nothing', () => {
    const { jobs } = setup({ aiOn: false })
    const sender = new FakeSender()
    expect(jobs.begin(sender, 'job-1')).toEqual({ ok: false, error: 'AI is off.' })
    expect(runningAiJobCount()).toBe(0)
    expect(jobs.size()).toBe(0)
  })

  it('falls back to a fixed text when the shell sets no refusal', () => {
    const { jobs } = setup({ aiOn: false, refusal: null })
    expect(jobs.begin(new FakeSender(), 'job-1')).toEqual({ ok: false, error: AI_OFF_FALLBACK })
  })

  it('lists a job as one document job until the screen says it ended', () => {
    const { jobs, kinds } = setup()
    const sender = new FakeSender()
    expect(jobs.begin(sender, 'job-1')).toEqual({ ok: true })
    // the same job told twice is still one
    expect(jobs.begin(sender, 'job-1')).toEqual({ ok: true })
    expect(kinds).toEqual(['document-job'])
    expect(runningAiJobCount()).toBe(1)
    jobs.end(sender.id, 'job-1')
    jobs.end(sender.id, 'job-1')
    expect(runningAiJobCount()).toBe(0)
  })

  it('refuses a malformed job id', () => {
    const { jobs } = setup()
    expect(jobs.begin(new FakeSender(), 42).ok).toBe(false)
    expect(jobs.begin(new FakeSender(), '').ok).toBe(false)
    expect(runningAiJobCount()).toBe(0)
  })

  it('stop all asks the screen to stop the job and waits for its end', async () => {
    const { jobs } = setup()
    const sender = new FakeSender()
    jobs.begin(sender, 'job-1')
    let settled = false
    const stopping = stopAllAiJobs().then((n) => {
      settled = true
      return n
    })
    await Promise.resolve()
    expect(sender.sent).toEqual([[STOP, 'job-1']])
    expect(settled).toBe(false)
    // the screen's Stop ran: its calls are cancelled and the job reports its end
    jobs.end(sender.id, 'job-1')
    expect(await stopping).toBe(1)
    expect(runningAiJobCount()).toBe(0)
  })

  it('a screen that never answers the stop is let go after the wait', async () => {
    vi.useFakeTimers()
    const { jobs } = setup({ stopWaitMs: 1000 })
    const sender = new FakeSender()
    jobs.begin(sender, 'job-1')
    const stopping = stopAllAiJobs()
    await vi.advanceTimersByTimeAsync(1000)
    expect(await stopping).toBe(1)
    expect(jobs.size()).toBe(0)
  })

  it('a closed tab takes its jobs off the list', () => {
    const { jobs } = setup()
    const a = new FakeSender()
    const b = new FakeSender()
    jobs.begin(a, 'job-1')
    jobs.begin(a, 'job-2')
    jobs.begin(b, 'job-1')
    expect(runningAiJobCount()).toBe(3)
    a.destroy()
    expect(runningAiJobCount()).toBe(1)
    jobs.end(b.id, 'job-1')
    expect(runningAiJobCount()).toBe(0)
  })

  it('one tab ending a job id leaves the same id of another tab alone', () => {
    const { jobs } = setup()
    const a = new FakeSender()
    const b = new FakeSender()
    jobs.begin(a, 'same')
    jobs.begin(b, 'same')
    jobs.end(a.id, 'same')
    expect(runningAiJobCount()).toBe(1)
  })
})
