import { rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeAndSaveVideo, launchShell } from './helpers'

async function waitWhiteboardPage(app: ElectronApplication, before: Set<Page>): Promise<Page> {
  let found: Page | undefined
  await expect
    .poll(
      () => {
        found = app.windows().find((p) => !before.has(p) && p.url().includes('://whiteboard/'))
        return found !== undefined
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  await expect(found!.locator('.wb-stage-svg')).toHaveCount(1, { timeout: 30_000 })
  return found!
}

const GOOD_EDIT_CALL = {
  type: 'tool-call',
  toolCall: {
    id: 'wb-call-1',
    name: 'edit_board',
    input: {
      ops: [
        {
          op: 'add',
          id: 'ai-1',
          kind: 'sticky',
          x: 80,
          y: 80,
          width: 200,
          height: 140,
          text: 'AI Sticky One',
        },
        {
          op: 'add',
          id: 'ai-2',
          kind: 'sticky',
          x: 360,
          y: 80,
          width: 200,
          height: 140,
          text: 'AI Sticky Two',
        },
        { op: 'add', id: 'ai-conn', kind: 'connector', from: 'ai-1', to: 'ai-2' },
      ],
    },
  },
}

const BAD_EDIT_CALL = {
  type: 'tool-call',
  toolCall: {
    id: 'wb-call-2',
    name: 'edit_board',
    input: {
      ops: [
        {
          op: 'add',
          id: 'ai-3',
          kind: 'sticky',
          x: 80,
          y: 300,
          width: 200,
          height: 140,
          text: 'Should Not Exist',
        },
        { op: 'delete', id: 'no-such-object' },
      ],
    },
  },
}

async function scriptWhiteboardAi(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    ({ ipcMain, webContents }, { good, bad }) => {
      const proto = Object.getPrototypeOf(webContents.getAllWebContents()[0]) as {
        send: (channel: string, ...args: unknown[]) => void
      }
      const realSend = proto.send
      proto.send = function (this: unknown, channel: string, ...args: unknown[]) {
        if (channel === 'ai:subscription-changed') return
        return realSend.call(this, channel, ...args)
      }
      const statuses = {
        'claude-code': { provider: 'claude-code', state: 'ready', meteredAccepted: false },
        codex: { provider: 'codex', state: 'not-installed', meteredAccepted: false },
      }
      for (const ch of ['ai:subscription-statuses', 'ai:subscription-recheck']) {
        ipcMain.removeHandler(ch)
        ipcMain.handle(ch, () => statuses)
      }
      const seen: Array<{ messages: unknown[]; tools?: Array<{ name: string }> }> = []
      ;(globalThis as unknown as { __wbAiRequests?: unknown[] }).__wbAiRequests = seen
      ipcMain.removeHandler('ai:stream')
      ipcMain.handle(
        'ai:stream',
        (
          event,
          request: { requestId: string; messages: unknown[]; tools?: Array<{ name: string }> },
        ) => {
          seen.push(request)
          const last = JSON.stringify(request.messages[request.messages.length - 1] ?? '')
          const chunks = last.includes('GOOD-WB-TURN')
            ? [good, { type: 'done' }]
            : last.includes('BAD-WB-TURN')
              ? [bad, { type: 'done' }]
              : [{ type: 'delta', text: 'Updated the whiteboard.' }, { type: 'done' }]
          setTimeout(() => {
            for (const chunk of chunks as Array<Record<string, unknown>>) {
              realSend.call(event.sender, 'ai:stream-chunk', {
                requestId: request.requestId,
                ...chunk,
              })
            }
          }, 150)
        },
      )
      for (const wc of webContents.getAllWebContents()) {
        if (!wc.isDestroyed()) realSend.call(wc, 'ai:subscription-changed', statuses)
      }
    },
    { good: GOOD_EDIT_CALL, bad: BAD_EDIT_CALL },
  )
}

test.describe('Whiteboard AI panel', () => {
  test('hides AI panel completely when AI features are disabled', async () => {
    test.setTimeout(120_000)
    const dir = await mkdtemp(join(tmpdir(), 'genoffice-wb-aioff-'))
    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'whiteboard-ai-off',
      settings: { aiFeatures: false, defaultSaveDir: dir },
    })
    const { app, page: shell } = launched
    try {
      const card = shell.locator('.quick-card', {
        has: shell.locator('.quick-title', { hasText: /^Whiteboard$/ }),
      })
      const before = new Set(app.windows())
      await card.click()
      const board = await waitWhiteboardPage(app, before)

      await expect(board.locator('.copilot')).toHaveCount(0)
      await expect(board.locator('.ai-rail')).toHaveCount(0)
    } finally {
      await closeAndSaveVideo(launched, 'whiteboard-ai-off')
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('applies atomic tool call with highlights, reverts in one Undo, and rejects invalid batch without partial edits', async () => {
    test.setTimeout(180_000)
    const dir = await mkdtemp(join(tmpdir(), 'genoffice-wb-ai-'))
    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'whiteboard-ai',
      settings: { defaultSaveDir: dir },
    })
    const { app, page: shell } = launched
    try {
      const card = shell.locator('.quick-card', {
        has: shell.locator('.quick-title', { hasText: /^Whiteboard$/ }),
      })
      const before = new Set(app.windows())
      await card.click()
      const board = await waitWhiteboardPage(app, before)

      await scriptWhiteboardAi(app)

      // Open AI dock if collapsed
      if ((await board.locator('.ai-rail').count()) > 0) {
        await board.locator('.ai-rail').click()
      }
      const textarea = board.locator('.ai-input-box textarea')
      const sendBtn = board.locator('.ai-send-btn')
      await expect(textarea).toBeVisible()

      // Send good edit batch
      await textarea.fill('GOOD-WB-TURN: add two connected stickies')
      await sendBtn.click()

      await expect(board.locator('[data-object-id="ai-1"]')).toHaveCount(1, { timeout: 20_000 })
      await expect(board.locator('[data-object-id="ai-2"]')).toHaveCount(1)
      await expect(board.locator('[data-object-id="ai-conn"]')).toHaveCount(1)
      await expect(board.locator('.wb-ai-highlight-rect').first()).toBeVisible()

      // Verify tool definitions exposed to model
      const reqs = await app.evaluate(
        () =>
          (globalThis as unknown as { __wbAiRequests?: Array<{ tools?: Array<{ name: string }> }> })
            .__wbAiRequests ?? [],
      )
      expect(reqs[0]?.tools?.map((t) => t.name)).toEqual(
        expect.arrayContaining(['read_board', 'edit_board', 'apply_template']),
      )

      // Send bad edit batch (all-or-nothing: ai-3 must not be added)
      const countBeforeBad = reqs.length
      await textarea.fill('BAD-WB-TURN: invalid delete batch')
      await sendBtn.click()
      await expect
        .poll(async () =>
          app.evaluate(
            () =>
              (globalThis as unknown as { __wbAiRequests?: unknown[] }).__wbAiRequests?.length ?? 0,
          ),
        )
        .toBeGreaterThanOrEqual(countBeforeBad + 2)
      await expect(board.locator('[data-object-id="ai-3"]')).toHaveCount(0)
      await expect(board.locator('[data-object-id="ai-1"]')).toHaveCount(1)

      // One Undo reverts the entire first tool call (all 3 objects)
      await board.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect(board.locator('[data-object-id="ai-1"]')).toHaveCount(0)
      await expect(board.locator('[data-object-id="ai-2"]')).toHaveCount(0)
      await expect(board.locator('[data-object-id="ai-conn"]')).toHaveCount(0)
    } finally {
      await closeAndSaveVideo(launched, 'whiteboard-ai')
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
