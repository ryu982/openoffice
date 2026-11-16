/**
 * An AI run the app stopped by its own rule leaves one line in the crash record.
 * What arrives was sent by a renderer: only the known rule, the known fault
 * words with their counts, one tool name of identifier shape and two small
 * numbers go into the line. No text of the model or the document can.
 */
import { describe, expect, it } from 'vitest'
import { runStopEntry } from '../src/main/ai-run-stop-log'
import { crashLine } from '../src/main/crash-log'

const AT = new Date('2026-11-11T01:02:03.000Z')

describe('the crash-record line of a stopped AI run', () => {
  it('keeps the rule, the faults with their counts, a tool and what the run had done', () => {
    const entry = runStopEntry('hwp', {
      kind: 'tool-input',
      faults: { truncated: 2, missing: 1 },
      tools: ['insert_table', 'unknown'],
      executed: 4,
      mutated: true,
    })
    expect(entry).toEqual({
      kind: 'ai-run-stop',
      reason: 'tool-input',
      editor: 'hwp',
      cause: 'truncated:2 missing:1',
      tool: 'insert_table',
      executed: 4,
      changed: 1,
    })
    expect(JSON.parse(crashLine(entry!, AT))).toEqual({
      at: '2026-11-11T01:02:03.000Z',
      kind: 'ai-run-stop',
      reason: 'tool-input',
      editor: 'hwp',
      cause: 'truncated:2 missing:1',
      tool: 'insert_table',
      executed: 4,
      changed: 1,
    })
  })

  it('writes the other two rules without faults', () => {
    expect(runStopEntry('hwp', { kind: 'repeating', executed: 1, mutated: false })).toEqual({
      kind: 'ai-run-stop',
      reason: 'repeating',
      editor: 'hwp',
      executed: 1,
      changed: 0,
    })
    expect(runStopEntry('hwp', { kind: 'tool-errors', executed: 0, mutated: false })).toMatchObject(
      { reason: 'tool-errors', executed: 0 },
    )
  })

  it('is nothing for what is not a stop', () => {
    for (const bad of [null, undefined, 'tool-input', 7, {}, { kind: 'crashed' }, { kind: 3 }]) {
      expect(runStopEntry('hwp', bad)).toBeNull()
    }
  })

  it('lets no text through: unknown fault words, long or odd tool names and wild counts are dropped', () => {
    const entry = runStopEntry('hwp', {
      kind: 'tool-input',
      faults: {
        truncated: 5000,
        missing: -1,
        invalid: 1.5,
        unparseable: '3',
        'C:\\Users\\someone\\secret.hwp': 2,
      },
      tools: [
        'the text of a paragraph, with spaces',
        'C:\\Users\\someone',
        42,
        'insert_paragraphs',
      ],
      executed: 'many',
      mutated: 'yes',
      message: 'Unexpected token in "주민등록번호 ..."',
    })
    expect(entry).toEqual({
      kind: 'ai-run-stop',
      reason: 'tool-input',
      editor: 'hwp',
      cause: 'truncated:999',
      tool: 'insert_paragraphs',
      changed: 0,
    })
    const line = crashLine(entry!, AT)
    expect(line).not.toContain('someone')
    expect(line).not.toContain('주민')
    expect(line).not.toContain('paragraph,')
  })
})
