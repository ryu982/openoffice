import { afterEach, describe, expect, it } from 'vitest'
import { aiRunRefusal, setAiRunGuard } from '../src/ai-run-guard'

afterEach(() => {
  setAiRunGuard('drive', null)
  setAiRunGuard('ai-off', null)
})

describe('aiRunRefusal', () => {
  it('lets every run go while no check is set', () => {
    expect(aiRunRefusal({ senderId: 1, provider: 'gemini', model: '' })).toBeNull()
  })

  it('answers with the check the shell set', () => {
    setAiRunGuard('drive', ({ senderId, provider }) =>
      senderId === 7 && provider === 'gemini' ? 'no' : null,
    )
    expect(aiRunRefusal({ senderId: 7, provider: 'gemini', model: '' })).toBe('no')
    expect(aiRunRefusal({ senderId: 8, provider: 'gemini', model: '' })).toBeNull()
  })

  it('keeps two named checks side by side; the first refusal wins', () => {
    let aiOff = false
    setAiRunGuard('ai-off', () => (aiOff ? 'off' : null))
    setAiRunGuard('drive', ({ provider }) => (provider === 'gemini' ? 'drive' : null))
    expect(aiRunRefusal({ senderId: 1, provider: 'gemini', model: '' })).toBe('drive')
    expect(aiRunRefusal({ senderId: 1, provider: 'claude-code', model: '' })).toBeNull()
    aiOff = true
    expect(aiRunRefusal({ senderId: 1, provider: 'gemini', model: '' })).toBe('off')
    expect(aiRunRefusal({ senderId: 1, provider: 'claude-code', model: '' })).toBe('off')
  })

  it('clears one check without dropping the other', () => {
    setAiRunGuard('ai-off', () => 'off')
    setAiRunGuard('drive', () => 'drive')
    setAiRunGuard('ai-off', null)
    expect(aiRunRefusal({ senderId: 1, provider: 'gemini', model: '' })).toBe('drive')
    setAiRunGuard('drive', null)
    expect(aiRunRefusal({ senderId: 1, provider: 'gemini', model: '' })).toBeNull()
  })

  it('replaces a check set again under the same name', () => {
    setAiRunGuard('drive', () => 'first')
    setAiRunGuard('drive', () => 'second')
    expect(aiRunRefusal({ senderId: 1, provider: 'gemini', model: '' })).toBe('second')
  })
})
