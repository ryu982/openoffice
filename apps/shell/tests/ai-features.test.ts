/**
 * Editor choice spec 8.1: with AI features off the home window shows none of
 * its AI parts. These are the rules Home and the project screen draw with.
 */
import { describe, expect, it } from 'vitest'
import {
  firstConnectionNoticeShown,
  projectTabShown,
  projectTabsShown,
} from '../src/renderer/src/ai-features'

const TABS = ['instructions', 'memory', 'files', 'chats'] as const

describe('the first-connection notice on home', () => {
  const due = {
    aiOn: true,
    noticeDue: true,
    settingsVisited: false,
    askMode: true,
    projectsMode: false,
    projectsNoticeAsked: false,
  }

  it('comes up where a connection is used, as before', () => {
    expect(firstConnectionNoticeShown(due)).toBe(true)
    expect(firstConnectionNoticeShown({ ...due, askMode: false, settingsVisited: true })).toBe(true)
    expect(
      firstConnectionNoticeShown({
        ...due,
        askMode: false,
        projectsMode: true,
        projectsNoticeAsked: true,
      }),
    ).toBe(true)
    expect(firstConnectionNoticeShown({ ...due, askMode: false })).toBe(false)
    expect(firstConnectionNoticeShown({ ...due, noticeDue: false })).toBe(false)
  })

  it('never comes up while AI is off', () => {
    expect(
      firstConnectionNoticeShown({
        ...due,
        aiOn: false,
        settingsVisited: true,
        projectsMode: true,
        projectsNoticeAsked: true,
      }),
    ).toBe(false)
  })
})

describe('the project screen tabs', () => {
  it('keep every tab while AI is on', () => {
    expect(projectTabsShown(TABS, true)).toEqual([...TABS])
    expect(projectTabShown('chats', TABS, true)).toBe('chats')
  })

  it('drop the chats while AI is off, and a request for them shows the first tab', () => {
    expect(projectTabsShown(TABS, false)).toEqual(['instructions', 'memory', 'files'])
    expect(projectTabShown('chats', TABS, false)).toBe('instructions')
    expect(projectTabShown('files', TABS, false)).toBe('files')
  })
})
