/**
 * A run the app stopped by its own rule is wired end to end in the Hangul AI
 * panel: the loop's stop reaches the chat entry, the shared notice shows it in
 * the screen language with "Continue" on the newest reply only, Continue sends
 * the same request with the app's note (and never stacks two notes), and the
 * stop goes to the main process for the crash record. The type-level wiring is
 * checked by the typecheck; the notice, its words and the note are tested in
 * packages/ui (run-stop.test.ts), the record in apps/shell (ai-run-stop-log.test.ts).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (rel: string): string =>
  readFileSync(join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n')
const squeezed = (text: string): string => text.replace(/\s+/g, ' ')

describe('a stopped run in the Hangul AI panel', () => {
  const panel = squeezed(read('src/renderer/ai/AiPanel.tsx'))

  it('takes the stop from the loop, shows it translated and keeps it for Continue', () => {
    expect(panel).toContain('onError: (error, stop) => {')
    expect(panel).toContain('runStopRef.current = stop ?? null')
    expect(panel).toContain('text: stop ? runStopText(stop, langRef.current) : error,')
    expect(panel).toContain('...(stop ? { stop } : {}),')
  })

  it('offers Continue on the reply of the run that just stopped only', () => {
    expect(panel).toContain(
      '<AiRunStopNotice stop={entry.stop} lang={lang} // going on belongs to the run that just stopped, not to older replies onContinue={isLast && !busy && !reverting ? continueRun : undefined} />',
    )
  })

  it('sends the same request with the note, on top of the skills the run had', () => {
    expect(panel).toContain('const base = continueBaseRef.current ?? runSkillUseRef.current')
    expect(panel).toContain(
      'send(runInstructionRef.current, runAttachmentsRef.current, runScopeRef.current, { ...base, text: `${base.text}\\n\\n${runContinueNote(stop)}`, })',
    )
    expect(panel).toContain('if (sent) continueBaseRef.current = base')
    // any other send starts clean
    expect(panel).toContain('runStopRef.current = null continueBaseRef.current = null')
  })

  it('reports the stop to the main process, which hands it to the shell unchecked', () => {
    expect(panel).toContain('if (stop) window.hwpApi.noteAiRunStop?.(stop)')
    expect(read('src/preload/index.ts')).toContain(
      'noteAiRunStop: (stop) => ipcRenderer.send(HWP_CHANNELS.aiRunStop, stop)',
    )
    const main = squeezed(read('src/main/hwp-main.ts'))
    expect(main).toContain(
      'ipcMain.on(HWP_CHANNELS.aiRunStop, (_e, stop: unknown) => { runtime.noteAiRunStop?.(stop) })',
    )
  })
})
