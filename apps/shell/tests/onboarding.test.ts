/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiSubscriptionState, SubscriptionStatusMap } from '@genoffice/ai-provider/browser'
import { LANGS } from '@genoffice/i18n'
import { aiSubscriptionText } from '@genoffice/ui'
import { Onboarding } from '../src/renderer/src/Onboarding'
import { LocaleProvider } from '../src/renderer/src/locale'
import { editorPickText } from '../src/renderer/src/i18n/strings-editor-pick'
import {
  leavesPickStep,
  onboardingConnectStep,
  onboardingStepIds,
  isLastOnboardingStep,
  nextOnboardingStep,
  previousOnboardingStep,
} from '../src/renderer/src/onboarding-steps'
import type { EditorChoiceApi } from '../src/shared/editor-choice'
import { strings } from '../src/renderer/src/strings'
import type { SubscriptionConnection } from '../src/renderer/src/subscription-client'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function statuses(claude: AiSubscriptionState, codex: AiSubscriptionState): SubscriptionStatusMap {
  return {
    'claude-code': { provider: 'claude-code', state: claude, meteredAccepted: false },
    codex: { provider: 'codex', state: codex, meteredAccepted: false },
  }
}

function connectionOf(
  map: SubscriptionStatusMap,
  extra: Partial<SubscriptionConnection> = {},
): SubscriptionConnection {
  return {
    statuses: map,
    busy: false,
    failed: {},
    codexImageAvailable: false,
    install: vi.fn(),
    login: vi.fn(),
    switchAccount: vi.fn(),
    logout: vi.fn(),
    recheck: vi.fn(),
    refresh: vi.fn(),
    acceptMetered: vi.fn(async () => undefined),
    openInstallHelp: vi.fn(),
    ...extra,
  }
}

type PickApi = Pick<EditorChoiceApi, 'set' | 'markPickSeen'>

/** the shell's choice bridge as the onboarding uses it: saving and marking the picker seen */
function pickApi() {
  return {
    set: vi.fn<PickApi['set']>(async (patch) => ({
      off: patch.off ?? [],
      aiFeatures: patch.aiFeatures ?? true,
      locked: false as const,
    })),
    markPickSeen: vi.fn<PickApi['markPickSeen']>(async () => undefined),
  }
}

interface RenderOptions {
  onDone?: () => Promise<boolean>
  connection?: SubscriptionConnection
  noticeDue?: boolean
  onNoticeAcknowledge?: () => void
  covered?: boolean
  editorChoice?: PickApi
}

function renderOnboarding(options: RenderOptions = {}): void {
  act(() => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(Onboarding, {
          onDone: options.onDone ?? vi.fn(async () => true),
          connection: options.connection ?? connectionOf(statuses('not-installed', 'signed-out')),
          noticeDue: options.noticeDue ?? false,
          onNoticeAcknowledge: options.onNoticeAcknowledge ?? vi.fn(),
          editorChoice: options.editorChoice ?? pickApi(),
          ...(options.covered === undefined ? {} : { covered: options.covered }),
        }),
      ),
    )
  })
}

async function click(selector: string): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>(selector)
  expect(button, selector).not.toBeNull()
  await act(async () => {
    button!.click()
    // let a finish (persist, then re-enable the buttons) settle
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const activeStep = (): string | null =>
  host.querySelector<HTMLElement>('.onb-slide.active')?.dataset.step ?? null

const slideSteps = (): string[] =>
  Array.from(host.querySelectorAll<HTMLElement>('.onb-slide')).map((el) => el.dataset.step ?? '')

const pickSelector = (item: string): string =>
  `.onb-slide[data-step="pick"] [data-item="${item}"] [role="switch"]`

/** the pick step's switch for an item ('ai' for the AI switch) */
const pickSwitch = (item: string): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>(pickSelector(item))!

/** from the welcome step to the connect step */
async function toConnect(): Promise<void> {
  await click('.onb-next')
  await click('.onb-next')
  expect(activeStep()).toBe('connect')
}

describe('onboarding steps', () => {
  it('are welcome, pick, connect, done with AI on, and leave out connect with AI off', () => {
    expect(onboardingStepIds(true)).toEqual(['welcome', 'pick', 'connect', 'done'])
    expect(onboardingStepIds(false)).toEqual(['welcome', 'pick', 'done'])
    expect(onboardingConnectStep(true)).toBe(2)
    expect(onboardingConnectStep(false)).toBe(-1)
  })

  it('advance one by one and finish after the last, whatever the connection', () => {
    expect(nextOnboardingStep(0, true)).toBe(1)
    expect(nextOnboardingStep(1, true)).toBe(2)
    expect(nextOnboardingStep(2, true)).toBe(3)
    expect(nextOnboardingStep(3, true)).toBeNull()
    expect(isLastOnboardingStep(2, true)).toBe(false)
    expect(isLastOnboardingStep(3, true)).toBe(true)
    // with AI off the pick step leads straight to the end
    expect(nextOnboardingStep(1, false)).toBe(2)
    expect(nextOnboardingStep(2, false)).toBeNull()
    expect(isLastOnboardingStep(2, false)).toBe(true)
  })

  it('go back one by one and stop at the first', () => {
    expect(previousOnboardingStep(3, true)).toBe(2)
    expect(previousOnboardingStep(2, true)).toBe(1)
    expect(previousOnboardingStep(1, true)).toBe(0)
    expect(previousOnboardingStep(0, true)).toBe(0)
    expect(previousOnboardingStep(2, false)).toBe(1)
  })

  it('pass the pick step only when moving forward from it', () => {
    expect(leavesPickStep(1, 2, true)).toBe(true)
    expect(leavesPickStep(1, 3, true)).toBe(true)
    expect(leavesPickStep(1, 2, false)).toBe(true)
    expect(leavesPickStep(1, 0, true)).toBe(false)
    expect(leavesPickStep(1, 1, true)).toBe(false)
    // jumping over it from the welcome step is not passing it
    expect(leavesPickStep(0, 3, true)).toBe(false)
    expect(leavesPickStep(2, 3, true)).toBe(false)
  })
})

describe('Onboarding', () => {
  it('shows four steps: welcome first, one dot each', () => {
    renderOnboarding()
    expect(slideSteps()).toEqual(['welcome', 'pick', 'connect', 'done'])
    expect(host.querySelectorAll('.onb-dot')).toHaveLength(4)
    expect(activeStep()).toBe('welcome')
  })

  it('lists the eleven items and AI on the pick step, everything on to begin with', async () => {
    renderOnboarding()
    await click('.onb-next')
    expect(activeStep()).toBe('pick')
    const step = host.querySelector<HTMLElement>('.onb-slide[data-step="pick"]')!
    expect(
      Array.from(step.querySelectorAll<HTMLElement>('.ec-row[data-item]')).map(
        (el) => el.dataset.item,
      ),
    ).toEqual([
      'docs',
      'sheets',
      'slides',
      'pdf',
      'pdfTools',
      'markdown',
      'html',
      'mindmap',
      'diagram',
      'hwp',
      'epub',
      'ai',
    ])
    const switches = Array.from(step.querySelectorAll<HTMLButtonElement>('[role="switch"]'))
    expect(switches).toHaveLength(12)
    expect(switches.every((el) => el.getAttribute('aria-checked') === 'true')).toBe(true)
    expect(switches.some((el) => el.disabled)).toBe(false)
    expect(step.querySelector('[data-item="docs"]')!.textContent).toContain(
      editorPickText('en', 'itemDocs'),
    )
    expect(step.querySelector('[data-item="ai"]')!.textContent).toContain(
      editorPickText('en', 'pickAiName'),
    )
  })

  it('follows the AI switch live: with AI off the connect step is gone', async () => {
    const onDone = vi.fn(async () => true)
    renderOnboarding({ onDone })
    await click('.onb-next')
    await click(pickSelector('ai'))
    expect(pickSwitch('ai').getAttribute('aria-checked')).toBe('false')
    expect(slideSteps()).toEqual(['welcome', 'pick', 'done'])
    expect(host.querySelectorAll('.onb-dot')).toHaveLength(3)
    expect(activeStep()).toBe('pick')

    // and back on, it returns
    await click(pickSelector('ai'))
    expect(slideSteps()).toEqual(['welcome', 'pick', 'connect', 'done'])
    await click(pickSelector('ai'))

    await click('.onb-next')
    expect(activeStep()).toBe('done')
    // nothing about connecting an AI on the last step while AI is off
    const done = host.querySelector<HTMLElement>('.onb-slide[data-step="done"]')!
    expect(done.querySelector('.onb-subtitle')!.textContent).toBe(
      editorPickText('en', 'pickDoneAiOff'),
    )
    expect(done.textContent).not.toContain(strings.en.onbDoneNotConnected)
    expect(host.querySelector('.onb-next')!.textContent).toBe(strings.en.onbStart)
    await click('.onb-next')
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('saves the choice and marks the picker seen when the pick step is left with Next', async () => {
    const editorChoice = pickApi()
    renderOnboarding({ editorChoice })
    await click('.onb-next')
    await click(pickSelector('slides'))
    await click(pickSelector('pdfTools'))
    await click(pickSelector('ai'))
    expect(editorChoice.set).not.toHaveBeenCalled()
    expect(editorChoice.markPickSeen).not.toHaveBeenCalled()

    await click('.onb-next')
    expect(editorChoice.set).toHaveBeenCalledTimes(1)
    expect(editorChoice.set).toHaveBeenCalledWith({
      off: ['slides', 'pdfTools'],
      aiFeatures: false,
    })
    expect(editorChoice.markPickSeen).toHaveBeenCalledTimes(1)
    expect(activeStep()).toBe('done')
  })

  it('saves untouched switches as everything on', async () => {
    const editorChoice = pickApi()
    renderOnboarding({ editorChoice })
    await toConnect()
    expect(editorChoice.set).toHaveBeenCalledWith({ off: [], aiFeatures: true })
    expect(editorChoice.markPickSeen).toHaveBeenCalledTimes(1)
  })

  it('does not mark the picker seen when the choice could not be saved', async () => {
    const editorChoice = pickApi()
    editorChoice.set.mockRejectedValueOnce(new Error('unwritable'))
    renderOnboarding({ editorChoice })
    await toConnect()
    expect(editorChoice.markPickSeen).not.toHaveBeenCalled()
  })

  it('saves nothing when closed or turned back before the pick step is passed', async () => {
    const editorChoice = pickApi()
    const onDone = vi.fn(async () => true)
    renderOnboarding({ editorChoice, onDone })
    await click('.onb-next')
    await click(pickSelector('docs'))
    // Back is not passing the step
    await click('.onb-back')
    expect(activeStep()).toBe('welcome')
    // nor is jumping over it from the welcome step by a dot
    await click('.onb-dot:last-child')
    expect(activeStep()).toBe('done')
    await click('.onb-dot:nth-child(2)')
    expect(activeStep()).toBe('pick')
    // Skip closes the guide from the pick step
    await click('.onb-skip')
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(editorChoice.set).not.toHaveBeenCalled()
    expect(editorChoice.markPickSeen).not.toHaveBeenCalled()
  })

  it('keeps the last editor on: its switch is disabled with the reason, the PDF tools do not count', async () => {
    renderOnboarding()
    await click('.onb-next')
    for (const item of [
      'docs',
      'sheets',
      'slides',
      'pdf',
      'markdown',
      'html',
      'mindmap',
      'diagram',
      'hwp',
    ]) {
      await click(pickSelector(item))
    }
    const reason = editorPickText('en', 'pickLastEditor')
    const step = () => host.querySelector<HTMLElement>('.onb-slide[data-step="pick"]')!
    expect(pickSwitch('epub').getAttribute('aria-checked')).toBe('true')
    expect(pickSwitch('epub').disabled).toBe(true)
    expect(step().querySelector('[data-item="epub"]')!.textContent).toContain(reason)
    // the PDF tools stay switchable either way and are no editor
    expect(pickSwitch('pdfTools').disabled).toBe(false)
    await click(pickSelector('pdfTools'))
    expect(pickSwitch('pdfTools').getAttribute('aria-checked')).toBe('false')
    expect(pickSwitch('epub').disabled).toBe(true)

    // a second editor on frees the first again
    await click(pickSelector('hwp'))
    expect(pickSwitch('epub').disabled).toBe(false)
    expect(step().textContent).not.toContain(reason)
  })

  it('describes the product plainly on the welcome step', () => {
    renderOnboarding()
    const step = host.querySelector<HTMLElement>('.onb-slide[data-step="welcome"]')!
    expect(step.querySelector('.onb-subtitle')!.textContent).toBe(strings.en.onbWelcomeSubtitle)
    expect(step.querySelector('.onb-body')!.textContent).toBe(strings.en.onbWelcomeBody)
    // no superlative of its own
    expect(step.textContent).not.toMatch(/\b(first|best|leading|most|only)\b|AI-native/i)
    expect(strings.en.onbWelcomeSubtitle).toBe('An open-source office suite')
  })

  it('can be completed without connecting a subscription', async () => {
    const onDone = vi.fn(async () => true)
    const connection = connectionOf(statuses('not-installed', 'not-installed'))
    renderOnboarding({ onDone, connection })

    await toConnect()
    expect(host.querySelector<HTMLButtonElement>('.onb-next')!.disabled).toBe(false)
    expect(host.textContent).toContain(strings.en.onbConnectSkipNote)

    await click('.onb-next')
    expect(activeStep()).toBe('done')
    expect(host.textContent).toContain(strings.en.onbDoneNotConnected)
    expect(onDone).not.toHaveBeenCalled()

    await click('.onb-next')
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(connection.install).not.toHaveBeenCalled()
    expect(connection.login).not.toHaveBeenCalled()
  })

  it('lets Skip and Escape finish from any step', async () => {
    const onDone = vi.fn(async () => true)
    renderOnboarding({ onDone })

    await click('.onb-skip')
    expect(onDone).toHaveBeenCalledTimes(1)

    await click('.onb-next')
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await Promise.resolve()
    })
    expect(onDone).toHaveBeenCalledTimes(2)
  })

  it('leaves the keyboard alone while Settings is open above it, and is still there after', async () => {
    const onDone = vi.fn(async () => true)
    renderOnboarding({ onDone, covered: true })
    const press = async (key: string) =>
      act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key }))
        await Promise.resolve()
      })

    // Escape closes the dropped skill's preview, Enter is typed in a field there
    await press('Escape')
    await press('Enter')
    await press('ArrowRight')
    expect(onDone).not.toHaveBeenCalled()
    expect(activeStep()).toBe('welcome')

    renderOnboarding({ onDone, covered: false })
    await press('Escape')
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('asks which AI the user has on the connect step, then walks that one path on the live status', async () => {
    const connection = connectionOf(statuses('not-installed', 'signed-out'))
    renderOnboarding({ connection })
    await toConnect()

    const step = host.querySelector<HTMLElement>('.onb-slide[data-step="connect"]')!
    const cards = () =>
      Array.from(step.querySelectorAll<HTMLElement>('.ai-sub-card')).map((card) => [
        card.dataset.provider,
        card.dataset.state,
      ])
    expect(step.querySelector('.ai-sub-guide-question')!.textContent).toBe(
      aiSubscriptionText('en', 'guideQuestion'),
    )
    expect(
      Array.from(step.querySelectorAll<HTMLElement>('.ai-sub-guide-path')).map(
        (el) => el.dataset.path,
      ),
    ).toEqual(['claude-code', 'chatgpt', 'free'])
    expect(cards()).toEqual([])
    // the ChatGPT answer connects directly: the line about Codex belongs to the Codex way alone
    expect(step.querySelector('.ai-sub-codex')).toBeNull()

    await click('.onb-slide[data-step="connect"] [data-path="claude-code"]')
    expect(cards()).toEqual([['claude-code', 'not-installed']])
    await click(
      '.onb-slide[data-step="connect"] [data-provider="claude-code"] [data-action="install"]',
    )
    expect(connection.install).toHaveBeenCalledWith('claude-code')
    await click('.onb-slide[data-step="connect"] [data-action="guide-back"]')
    await click('.onb-slide[data-step="connect"] [data-path="chatgpt"]')
    await click('.onb-slide[data-step="connect"] [data-action="guide-alternate"]')
    expect(cards()).toEqual([['codex', 'signed-out']])
    expect(step.querySelector('.ai-sub-codex')!.textContent).toBe(
      aiSubscriptionText('en', 'codexNotice'),
    )
    await click('.onb-slide[data-step="connect"] [data-provider="codex"] [data-action="login"]')
    expect(connection.login).toHaveBeenCalledWith('codex')
  })

  it('says a launch could not start, under the card of that path', async () => {
    renderOnboarding({
      connection: connectionOf(statuses('not-installed', 'signed-out'), {
        failed: { codex: 'login' },
      }),
    })
    await toConnect()
    expect(host.querySelector('.onb-connect-failed')).toBeNull()
    await click('.onb-slide[data-step="connect"] [data-path="chatgpt"]')
    await click('.onb-slide[data-step="connect"] [data-action="guide-alternate"]')
    const failed = host.querySelector<HTMLElement>('.onb-connect-failed')!
    expect(failed.dataset.provider).toBe('codex')
    expect(failed.textContent).toBe(strings.en.setSubLoginFailed)
  })

  it('names the connected subscription on the last step', async () => {
    renderOnboarding({ connection: connectionOf(statuses('ready', 'signed-out')) })
    await toConnect()
    await click('.onb-next')
    expect(host.querySelector('.onb-slide.active .onb-subtitle')!.textContent).toBe(
      'AI is connected: Claude.',
    )
  })

  it('offers the free connections on the connect step and names a made one on the last step', async () => {
    const connectFreeAi = vi.fn(async () => ({
      ok: true as const,
      provider: 'gemini' as const,
      model: 'm',
    }))
    vi.stubGlobal('aiOffice', {
      getAiSettings: async () => ({
        providers: {
          openrouter: { apiKey: 'sk-or-v1-x', model: 'nvidia/nemotron-3-super-120b-a12b:free' },
        },
      }),
      onAiSettingsChanged: () => () => {},
      getFreeAiQuota: async () => ({ used: 9, limit: 50, remaining: 41 }),
      connectFreeAi,
    })
    try {
      renderOnboarding()
      await toConnect()
      const step = host.querySelector('.onb-slide.active')!
      // a free connection already made opens the free path by itself
      expect(step.querySelector('.ai-sub-guide-open')!.getAttribute('data-path')).toBe('free')
      // the free cards say what free use means themselves: no line of the guide repeats it
      expect(step.querySelector('.ai-sub-guide-need')).toBeNull()
      expect(
        [...step.querySelectorAll<HTMLElement>('.free-ai-card')].map((el) => [
          el.dataset.provider,
          el.dataset.state,
        ]),
      ).toEqual([
        ['openrouter', 'connected'],
        ['gemini', 'idle'],
      ])
      expect(step.textContent).toContain('41 of 50 free requests left today')
      await click('.onb-next')
      expect(host.querySelector('.onb-slide.active .onb-subtitle')!.textContent).toBe(
        'AI is connected: OpenRouter.',
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the first-connection notice for the connect step and reports its acknowledgement', async () => {
    const onNoticeAcknowledge = vi.fn()
    const onDone = vi.fn(async () => true)
    renderOnboarding({
      onDone,
      noticeDue: true,
      onNoticeAcknowledge,
      connection: connectionOf(statuses('ready', 'signed-out')),
    })
    expect(host.querySelector('.first-notice')).toBeNull()
    // not on the pick step either: the notice is about the connection
    await click('.onb-next')
    expect(activeStep()).toBe('pick')
    expect(host.querySelector('.first-notice')).toBeNull()

    await click('.onb-next')
    const notice = host.querySelector<HTMLElement>('.first-notice')!
    expect(notice.textContent).toContain(aiSubscriptionText('en', 'noticeSend'))
    expect(notice.textContent).toContain(aiSubscriptionText('en', 'noticeTraining'))
    expect(notice.textContent).toContain(aiSubscriptionText('en', 'noticeCodexHistory'))

    // the notice owns the keyboard: the onboarding behind it neither skips nor advances
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
      await Promise.resolve()
    })
    expect(activeStep()).toBe('connect')
    expect(onDone).not.toHaveBeenCalled()

    await click('.first-notice .ai-sub-btn')
    expect(onNoticeAcknowledge).toHaveBeenCalledTimes(1)
  })

  it('carries no credits offer, community call, star hint or statistics notice', async () => {
    renderOnboarding({ connection: connectionOf(statuses('ready', 'ready')) })
    const text = () => host.textContent ?? ''
    const steps = onboardingStepIds(true)
    for (let step = 0; step < steps.length; step++) {
      expect(text()).not.toMatch(/credit|github|\bstars?\b|statistic|analytics/i)
      if (step < steps.length - 1) await click('.onb-next')
    }
    // the only switches are the pick step's editors and AI: no consent switch
    const switches = Array.from(host.querySelectorAll('[role="switch"]'))
    expect(switches.length).toBeGreaterThan(0)
    expect(switches.every((el) => el.closest('.onb-slide[data-step="pick"]'))).toBe(true)
    expect(host.querySelector('.onb-offer, .onb-star, .onb-consent, .onb-join')).toBeNull()
  })
})

describe('welcome copy', () => {
  it('exists in every UI language, as a translation', () => {
    for (const lang of LANGS) {
      const { onbWelcomeSubtitle, onbWelcomeBody } = strings[lang]
      expect(onbWelcomeSubtitle.trim(), lang).not.toBe('')
      expect(onbWelcomeBody.trim(), lang).not.toBe('')
      if (lang === 'en') continue
      expect(onbWelcomeSubtitle, lang).not.toBe(strings.en.onbWelcomeSubtitle)
      expect(onbWelcomeBody, lang).not.toBe(strings.en.onbWelcomeBody)
    }
    expect(new Set(LANGS.map((lang) => strings[lang].onbWelcomeBody)).size).toBe(LANGS.length)
  })

  it.each(LANGS)('names every document kind and both subscriptions in %s', (lang) => {
    const body = strings[lang].onbWelcomeBody
    for (const name of ['Word', 'Excel', 'PowerPoint', 'PDF', 'Markdown', 'HTML']) {
      expect(body, name).toContain(name)
    }
    expect(body).toContain('Claude')
    expect(body).toContain('ChatGPT')
    // the product is named by the title above, and no vendor of the suite is named at all
    expect(`${strings[lang].onbWelcomeSubtitle} ${body}`).not.toMatch(/genoffice/i)
  })
})
