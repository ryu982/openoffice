/**
 * A book translation tells the main process when it begins and ends (the
 * shell's list of running AI work): the begin goes out before the job
 * starts, a refusal (AI turned off) stops the job and it fails with that
 * refusal, the main process's stop request is the job's Stop, and the end is
 * told once. The job is a fake that runs until stopped; no model is reached.
 */
import { describe, expect, it, vi } from 'vitest'
import type { DocumentJobHandle, DocumentJobRegistry, JobSummary } from '@genoffice/pdf-structure'
import { DocumentJobRegistry as Registry } from '../src/renderer/translate/pdf-structure-browser'
import { BookJobSession, type StartBookJob } from '../src/renderer/translate/job-session'
import type { ScreenAiJobBridge } from '../src/shared/ipc'

const DOC = 'b'.repeat(64)

function fakeActivity(answer: string | null = null) {
  const order: string[] = []
  let stopListener: ((jobId: string) => void) | null = null
  let resolveBegin!: (refusal: string | null) => void
  const activity: ScreenAiJobBridge = {
    begin: vi.fn((jobId: string) => {
      order.push(`begin ${jobId}`)
      return new Promise<string | null>((resolve) => {
        resolveBegin = resolve
      })
    }),
    end: vi.fn(),
    onStop: (handler) => {
      stopListener = handler
      return () => {
        stopListener = null
      }
    },
  }
  return {
    activity,
    order,
    answerBegin: () => resolveBegin(answer),
    askStop: (jobId: string) => stopListener?.(jobId),
    jobId: () => order[0]!.slice('begin '.length),
  }
}

/** a translation that runs until its signal aborts, then ends stopped */
function runningJob(order: string[]): StartBookJob<number> {
  return {
    docHash: DOC,
    lang: 'ko',
    provider: 'claude-code',
    launch: ({ signal, registry }: { signal: AbortSignal; registry: DocumentJobRegistry }) => {
      order.push('launch')
      const lease = registry.acquire(
        { docHash: DOC, kind: 'translate', progress: { done: 0, total: 1 } },
        () => {},
      )
      const result = new Promise<JobSummary<number>>((resolve) => {
        signal.addEventListener('abort', () => {
          lease.release()
          resolve({
            state: 'stopped',
            stopReason: 'cancelled',
            doneUnits: [],
            failedUnits: [],
            lostUnits: [],
            skippedItems: 0,
            progress: { done: 0, total: 1 },
            recordWriteFailed: false,
          })
        })
      })
      return {
        docHash: DOC,
        kind: 'translate',
        result,
        cancel: () => {},
        progress: () => ({ done: 0, total: 1 }),
      } as DocumentJobHandle<number>
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('book translation on the shell list', () => {
  it('tells the begin before the job starts, and the end once when it stops', async () => {
    const fake = fakeActivity()
    const session = new BookJobSession(new Registry(), fake.activity)
    expect(session.start(runningJob(fake.order)).ok).toBe(true)
    expect(fake.order).toEqual([`begin ${fake.jobId()}`, 'launch'])
    fake.answerBegin()
    await flush()
    expect(session.isRunning()).toBe(true)
    session.stop()
    await flush()
    expect(fake.activity.end).toHaveBeenCalledTimes(1)
    expect(fake.activity.end).toHaveBeenCalledWith(fake.jobId())
    expect(session.view()?.state).toBe('stopped')
  })

  it('a refused translation stops at once and fails with the refusal', async () => {
    const fake = fakeActivity('AI features are turned off in Settings.')
    const session = new BookJobSession(new Registry(), fake.activity)
    session.start(runningJob(fake.order))
    fake.answerBegin()
    await flush()
    expect(session.isRunning()).toBe(false)
    expect(session.view()).toMatchObject({
      state: 'failed',
      error: 'AI features are turned off in Settings.',
    })
    expect(fake.activity.end).toHaveBeenCalledTimes(1)
  })

  it("the main process's stop request is the translation's Stop", async () => {
    const fake = fakeActivity()
    const session = new BookJobSession(new Registry(), fake.activity)
    session.start(runningJob(fake.order))
    fake.answerBegin()
    await flush()
    fake.askStop('someone-else')
    await flush()
    expect(session.isRunning()).toBe(true)
    fake.askStop(fake.jobId())
    await flush()
    expect(session.isRunning()).toBe(false)
    expect(session.view()?.state).toBe('stopped')
    expect(fake.activity.end).toHaveBeenCalledTimes(1)
  })
})
