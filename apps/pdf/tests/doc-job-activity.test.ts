/**
 * A PDF tab's document jobs tell the main process when they begin and end
 * (the shell's list of running AI work): the begin goes out before the job
 * starts, a refusal (AI turned off) stops the job and it fails with that
 * refusal, the main process's stop request is the job's Stop, and the end is
 * told once however the job ends. The job is a fake that runs until stopped.
 */
import { describe, expect, it, vi } from 'vitest'
import { DocumentJobBusyError, DocumentJobRegistry } from '../../../packages/pdf-structure/src/jobs'
import type { DocumentJobHandle, JobSummary } from '../../../packages/pdf-structure/src/jobs'
import { DocumentJobSession, type StartDocumentJob } from '../src/renderer/doc-jobs/job-session'
import type { ScreenAiJobBridge } from '../src/shared/ipc'

const DOC = 'a'.repeat(64)

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
    end: vi.fn((jobId: string) => {
      order.push(`end ${jobId}`)
    }),
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
  }
}

/** a job that runs until its signal aborts, then ends stopped */
function runningJob(order: string[]): StartDocumentJob<number> {
  return {
    docHash: DOC,
    kind: 'ai-read',
    provider: 'claude-code',
    launch: ({ signal, registry }) => {
      order.push('launch')
      const lease = registry.acquire(
        { docHash: DOC, kind: 'ai-read', progress: { done: 0, total: 1 } },
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
        kind: 'ai-read',
        result,
        cancel: () => {},
        progress: () => ({ done: 0, total: 1 }),
      } as DocumentJobHandle<number>
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('document jobs on the shell list', () => {
  it('tells the begin before the job starts, and the end once when it stops', async () => {
    const fake = fakeActivity()
    const session = new DocumentJobSession(new DocumentJobRegistry(), fake.activity)
    const out = session.start(runningJob(fake.order))
    expect(out.ok).toBe(true)
    expect(fake.order[0]).toMatch(/^begin /)
    expect(fake.order[1]).toBe('launch')
    fake.answerBegin()
    await flush()
    expect(session.isRunning(DOC)).toBe(true)
    session.stop(DOC)
    await flush()
    const jobId = fake.order[0]!.slice('begin '.length)
    expect(fake.activity.end).toHaveBeenCalledTimes(1)
    expect(fake.activity.end).toHaveBeenCalledWith(jobId)
    expect(session.view(DOC)?.state).toBe('stopped')
  })

  it('a refused job stops at once and fails with the refusal', async () => {
    const fake = fakeActivity('AI features are turned off in Settings.')
    const session = new DocumentJobSession(new DocumentJobRegistry(), fake.activity)
    session.start(runningJob(fake.order))
    fake.answerBegin()
    await flush()
    expect(session.isRunning(DOC)).toBe(false)
    expect(session.view(DOC)).toMatchObject({
      state: 'failed',
      error: 'AI features are turned off in Settings.',
    })
    expect(fake.activity.end).toHaveBeenCalledTimes(1)
  })

  it("the main process's stop request is the job's Stop", async () => {
    const fake = fakeActivity()
    const session = new DocumentJobSession(new DocumentJobRegistry(), fake.activity)
    session.start(runningJob(fake.order))
    fake.answerBegin()
    await flush()
    // another job's id stops nothing
    fake.askStop('someone-else')
    await flush()
    expect(session.isRunning(DOC)).toBe(true)
    fake.askStop(fake.order[0]!.slice('begin '.length))
    await flush()
    expect(session.isRunning(DOC)).toBe(false)
    expect(session.view(DOC)?.state).toBe('stopped')
    expect(fake.activity.end).toHaveBeenCalledTimes(1)
  })

  it('a job the engine refuses as busy is told ended at once', () => {
    const fake = fakeActivity()
    const session = new DocumentJobSession(new DocumentJobRegistry(), fake.activity)
    const out = session.start({
      ...runningJob(fake.order),
      launch: () => {
        // another page of this process took the document in the meantime
        throw new DocumentJobBusyError({
          docHash: DOC,
          kind: 'translate',
          progress: { done: 0, total: 1 },
        })
      },
    })
    expect(out.ok).toBe(false)
    expect(fake.activity.begin).toHaveBeenCalledTimes(1)
    expect(fake.activity.end).toHaveBeenCalledTimes(1)
  })

  it('without the bridge a job runs as before', async () => {
    const order: string[] = []
    const session = new DocumentJobSession(new DocumentJobRegistry())
    expect(session.start(runningJob(order)).ok).toBe(true)
    session.stop(DOC)
    await flush()
    expect(session.view(DOC)?.state).toBe('stopped')
  })
})
