import { test, expect } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeAndSaveVideo, freeMcpPort, launchShell, waitForPageWithUrl } from './helpers'

// The AI's edit_text on the front part of a line (one PDF text object). The save
// rewrites the whole object, so the pending preview must show the whole new line,
// and the live page render must erase the whole old one: before the fix the preview
// drew the fragment's replacement over the rest of the line redrawn at its start.
// The AI is a fake local endpoint (OpenAI-compatible JSON); no subscription runs.

const FIXTURE = join(__dirname, '../apps/pdf/tests/fixtures/plain-sample.pdf')
const CALL = { page: 1, old_text: 'This line must survive', new_text: 'This line was edited by AI' }
const EDITED = 'This line was edited by AI the round trip.'

/** chat.completions: the scripted edit_text call on the first tool turn, then a reply */
function fakeModel(port: number): Promise<Server> {
  let called = false
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c: Buffer) => (body += c.toString()))
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      if (req.method !== 'POST' || !req.url?.includes('chat/completions')) {
        res.end(JSON.stringify({ data: [{ id: 'fake-model' }] }))
        return
      }
      const tools = (JSON.parse(body || '{}') as { tools?: unknown[] }).tools ?? []
      const call = tools.length > 0 && !called
      if (call) called = true
      const message = call
        ? {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'edit_text', arguments: JSON.stringify(CALL) },
              },
            ],
          }
        : { role: 'assistant', content: 'Done.' }
      res.end(
        JSON.stringify({
          id: 'fake',
          object: 'chat.completion',
          model: 'fake-model',
          choices: [{ index: 0, message, finish_reason: call ? 'tool_calls' : 'stop' }],
        }),
      )
    })
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

test('AI edit of part of a line previews and saves the whole rewritten line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-pdf-partial-line-'))
  const userDataDir = join(dir, 'data')
  const pdfPath = join(dir, 'plain-sample.pdf')
  await copyFile(FIXTURE, pdfPath)
  const port = await freeMcpPort()
  const baseUrl = `http://127.0.0.1:${port}/v1`
  const server = await fakeModel(port)
  // An empty home: the subscription programs find no sign-in to report
  const home = join(dir, 'home')
  for (const d of [userDataDir, home, join(home, 'codex')]) await mkdir(d, { recursive: true })
  await writeFile(
    join(userDataDir, 'ai-settings.json'),
    JSON.stringify({
      provider: 'custom',
      subscriptionNoticeSeen: true,
      subscriptionNoticeVersion: 2,
      pdfSendNoticeSeen: 1,
      providers: { custom: { apiKey: '', model: 'fake-model', baseUrl } },
      customEndpoints: [
        {
          id: 'fake',
          name: 'Fake',
          kind: 'local',
          baseUrl,
          apiKey: '',
          model: 'fake-model',
          models: ['fake-model'],
          modelProfiles: {
            'fake-model': {
              contextLength: 200000,
              tools: true,
              vision: false,
              contextSource: 'user',
              toolsSource: 'user',
            },
          },
        },
      ],
      customEndpoint: 'fake',
    }),
  )
  const launched = await launchShell({
    userDataDir,
    onboardingSeen: true,
    videoDir: 'pdf-partial-line-edit',
    openFile: pdfPath,
    recordVideo: false,
    env: { HOME: home, USERPROFILE: home, CODEX_HOME: join(home, 'codex') },
  })
  try {
    const editor = await waitForPageWithUrl(launched.app, '://pdf/')
    await expect(editor.locator('.textLayer').first()).toContainText('This line must survive')
    const input = editor.locator('.ai-input-box textarea').first()
    if (!(await input.isVisible())) await editor.locator('.ai-rail').first().click()
    await input.fill('Edit the line.')
    await input.press('Enter')

    // One pending edit, drawn as the whole rewritten line from the line's start
    const preview = editor.locator('.pdf-page .pdf-textedit-preview').first()
    await expect(preview).toHaveText(EDITED)
    const line = editor
      .locator('.pdf-page .textLayer span', { hasText: 'This line must survive' })
      .first()
    const [p, l] = [await preview.boundingBox(), await line.boundingBox()]
    expect(Math.abs(p!.x - l!.x)).toBeLessThan(3)
    // spans the line, not just the 22 of its 38 characters the call named
    expect(p!.width).toBeGreaterThan(l!.width * 0.9)
    // The live page render erased the whole original line under it
    const live = editor.locator('.pdf-page .pdf-page-livepreview').first()
    await expect(live).toBeVisible()
    const lb = (await live.boundingBox())!
    expect(lb.x).toBeLessThanOrEqual(l!.x + 1)
    expect(lb.x + lb.width).toBeGreaterThan(l!.x + l!.width * 0.9)

    const before = await readFile(pdfPath)
    await editor.keyboard.press('Control+S')
    await expect.poll(async () => (await readFile(pdfPath)).equals(before)).toBe(false)
    await expect(editor.locator('.pdf-page .pdf-textedit-preview')).toHaveCount(0)
    await expect(editor.locator('.textLayer').first()).toContainText(EDITED)
    await expect(editor.locator('.textLayer').first()).toContainText(
      'Second paragraph for text comparison.',
    )
  } finally {
    await closeAndSaveVideo(launched, 'pdf-partial-line-edit')
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})
