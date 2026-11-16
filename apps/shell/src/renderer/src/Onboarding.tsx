import { useEffect, useRef, useState } from 'react'
import {
  AiConnectGuide,
  AiMark,
  aiSubscriptionProviderName,
  aiSubscriptionText,
} from '@genoffice/ui'
import { FREE_AI_PROVIDERS, freeAiConnected } from '@genoffice/ai-provider/browser'
import appIcon from './assets/app-icon.png'
import { FirstConnectionDialog } from './FirstConnectionNotice'
import { FreeAiCards, useAiSettings as useFreeAiSettings } from './FreeAiCards'
import { FREE_AI_PROVIDER_NAMES } from './free-ai-cards'
import { useI18n } from './locale'
import {
  leavesPickStep,
  isLastOnboardingStep,
  nextOnboardingStep,
  onboardingConnectStep,
  onboardingStepIds,
  previousOnboardingStep,
} from './onboarding-steps'
import type { OnboardingStepId } from './onboarding-steps'
import type { EditorChoiceApi, EditorItemId } from '../../shared/editor-choice'
import { EditorChoiceList } from './editor-choice/EditorChoiceList'
import { pickPatch } from './editor-choice/one-time-pick'
import './editor-choice/globals'
import { editorPickText } from './i18n/strings-editor-pick'
import type { SubscriptionConnection } from './subscription-client'
import { usableSubscriptionProviders } from './subscription-status'
import './onboarding.css'

interface OnboardingProps {
  /** persists completion */
  onDone: () => Promise<boolean>
  /** the live subscription connection: the connect step shows it and acts on it */
  connection: SubscriptionConnection
  /** a subscription can be used and the first-connection notice was not acknowledged yet */
  noticeDue: boolean
  onNoticeAcknowledge: () => void
  /** Settings is open above this window: the keyboard is not ours meanwhile */
  covered?: boolean
  /** saves the pick step's choice; the shell's bridge unless a test hands in a fake */
  editorChoice?: Pick<EditorChoiceApi, 'set' | 'markPickSeen'>
}

/* exact vectors from the design spec:
 * 60px canvas, 4px strokes — same visual mass as the 60px app icon */
function SlideArt({ step }: { step: OnboardingStepId }) {
  if (step === 'welcome') {
    return <img className="onb-art onb-art-logo" src={appIcon} alt="" />
  }
  if (step === 'pick') {
    // four tiles: the editors to choose from
    return (
      <span className="onb-art onb-art-badge onb-art-pick" aria-hidden="true">
        <svg viewBox="0 0 60 60" fill="none" stroke="currentColor" strokeWidth="4">
          <rect x="8" y="8" width="18" height="18" rx="4" />
          <rect x="34" y="8" width="18" height="18" rx="4" />
          <rect x="8" y="34" width="18" height="18" rx="4" />
          <rect x="34" y="34" width="18" height="18" rx="4" />
        </svg>
      </span>
    )
  }
  if (step === 'connect') {
    // the neutral AI glyph: no vendor mark stands for the connection
    return (
      <span className="onb-art onb-art-badge onb-art-ai" aria-hidden="true">
        <AiMark size={58} />
      </span>
    )
  }
  return (
    <span className="onb-art onb-art-badge onb-art-check" aria-hidden="true">
      <svg viewBox="0 0 60 60" fill="none" stroke="currentColor" strokeWidth="4">
        <path
          d="M29.9883 5.5C43.5194 5.5 54.4883 16.469 54.4883 30C54.4883 43.5311 43.5194 54.5 29.9883 54.5C16.4573 54.5 5.48828 43.5311 5.48828 30C5.48828 16.469 16.4573 5.5 29.9883 5.5Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M18.125 33.75L24.7764 40.4014C25.8727 41.4977 27.6924 41.342 28.5865 40.0753L41.875 21.25"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}

export function Onboarding({
  onDone,
  connection,
  noticeDue,
  onNoticeAcknowledge,
  covered = false,
  editorChoice,
}: OnboardingProps) {
  const { t, lang } = useI18n()
  const [index, setIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  // the pick step's switches: everything on until the person changes them;
  // saved only when the pick step is passed
  const [off, setOff] = useState<EditorItemId[]>([])
  const [aiOn, setAiOn] = useState(true)
  const cardRef = useRef<HTMLDivElement>(null)
  const steps = onboardingStepIds(aiOn)
  const isLast = isLastOnboardingStep(index, aiOn)
  // the notice waits for the step that is about the connection (none with AI off)
  const connectStep = onboardingConnectStep(aiOn)
  const noticeOpen = noticeDue && connectStep >= 0 && index >= connectStep
  const freeSettings = useFreeAiSettings()
  const freeConnected = FREE_AI_PROVIDERS.some(
    (provider) => freeSettings !== null && freeAiConnected(freeSettings, provider),
  )
  const connected = [
    ...usableSubscriptionProviders(connection.statuses).map(aiSubscriptionProviderName),
    ...FREE_AI_PROVIDERS.filter(
      (provider) => freeSettings && freeAiConnected(freeSettings, provider),
    ).map((provider) => FREE_AI_PROVIDER_NAMES[provider]),
  ]

  const titles: Record<OnboardingStepId, string> = {
    welcome: t('onbTitle1'),
    pick: editorPickText(lang, 'pickTitle'),
    connect: t('onbConnectTitle'),
    done: t('onbDoneTitle'),
  }

  const finish = () => {
    if (submitting) return
    setSubmitting(true)
    void onDone()
      .catch(() => false)
      .finally(() => setSubmitting(false))
  }

  /**
   * Move to another step. Passing the pick step forward saves the choice and
   * marks the picker seen first; a save that fails still moves on (the guide
   * never traps anyone) but leaves the picker due for the next launch.
   */
  const goTo = (target: number) => {
    if (submitting) return
    if (!leavesPickStep(index, target, aiOn)) {
      setIndex(target)
      return
    }
    const api = editorChoice ?? window.aiOfficeEditorChoice
    setSubmitting(true)
    void (async () => {
      try {
        if (api) {
          await api.set(pickPatch(off, aiOn))
          await api.markPickSeen()
        }
      } catch (error) {
        console.warn('editor choice not saved', error)
      } finally {
        setSubmitting(false)
        setIndex(target)
      }
    })()
  }

  // never waits for a connection: the connect step is left like any other
  const next = () => {
    const target = nextOnboardingStep(index, aiOn)
    if (target === null) finish()
    else goTo(target)
  }

  // move focus into the dialog on mount so keyboard users start inside it
  // (the container, not a button, so no focus ring shows on open)
  useEffect(() => {
    cardRef.current?.focus()
  }, [])

  // slide changes can strip focus from the active control (leaving the connect
  // step makes its card buttons inert, which blurs them) — pull focus back onto
  // the card so it never drops to body
  useEffect(() => {
    if (noticeOpen) return
    const card = cardRef.current
    const active = document.activeElement
    if (card && (!(active instanceof HTMLElement) || !card.contains(active))) card.focus()
  }, [index, noticeOpen])

  // keyboard handling: Escape skips, Enter / ArrowRight advance, ArrowLeft goes
  // back, and Tab is trapped inside the dialog (aria-modal). Enter is ignored
  // when a button is focused so the native click doesn't double-fire.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // the notice or the Settings dialog above owns the keyboard while it is open
      if (noticeOpen || covered) return
      if (event.key === 'Escape') {
        finish()
        return
      }
      if (event.key === 'Tab') {
        const card = cardRef.current
        if (!card) return
        // inactive slides stay mounted (stacked for the height lock) but are
        // inert — their buttons must not enter the tab cycle
        const focusables = Array.from(card.querySelectorAll<HTMLElement>('button')).filter(
          (el) => !el.closest('[inert]') && !el.hasAttribute('disabled'),
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        // the card itself holds focus on open/slide change; from there, Tab in
        // either direction must land on a dialog control, never behind the modal
        const onButton = active instanceof HTMLElement && focusables.includes(active)
        if (!onButton) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        } else if (event.shiftKey && active === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
        return
      }
      const buttonFocused =
        event.target instanceof HTMLElement && event.target.closest('button') !== null
      if ((event.key === 'Enter' && !buttonFocused) || event.key === 'ArrowRight') next()
      if (event.key === 'ArrowLeft' && !submitting) {
        setIndex((i) => previousOnboardingStep(i, aiOn))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const renderStep = (step: OnboardingStepId) => {
    if (step === 'welcome') {
      return (
        <>
          <p className="onb-subtitle">{t('onbWelcomeSubtitle')}</p>
          <p className="onb-body">{t('onbWelcomeBody')}</p>
        </>
      )
    }
    if (step === 'pick') {
      return (
        <>
          <p className="onb-body onb-body-lead">{editorPickText(lang, 'pickBody')}</p>
          <div className="onb-pick">
            <EditorChoiceList
              off={off}
              aiFeatures={aiOn}
              onOffChange={setOff}
              onAiFeaturesChange={setAiOn}
              disabled={submitting}
            />
          </div>
        </>
      )
    }
    if (step === 'connect') {
      return (
        <>
          <p className="onb-body onb-body-lead">{aiSubscriptionText(lang, 'connectBody')}</p>
          <div className="onb-connect">
            <AiConnectGuide
              statuses={connection.statuses}
              lang={lang}
              disabled={connection.busy}
              onInstall={connection.install}
              onUpdate={connection.update}
              onLogin={connection.login}
              onCancelLogin={connection.cancelLogin}
              onRecheck={connection.recheck}
              onAcceptMetered={(id) => void connection.acceptMetered(id)}
              onOpenInstallHelp={connection.openInstallHelp}
              onOpenConnectHelp={connection.openConnectHelp}
              // no subscription: the free connections open right here
              freeContent={<FreeAiCards t={t} compact />}
              freeConnected={freeConnected}
              codexNotice
              renderAfterCard={(provider) =>
                connection.failed[provider] && (
                  <p className="onb-connect-failed" role="alert" data-provider={provider}>
                    {t(
                      connection.failed[provider] === 'install'
                        ? 'setSubInstallFailed'
                        : 'setSubLoginFailed',
                    )}
                  </p>
                )
              }
            />
          </div>
          <p className="onb-note">{t('onbConnectSkipNote')}</p>
        </>
      )
    }
    if (!aiOn) {
      // AI is off: nothing about connecting one
      return (
        <>
          <p className="onb-subtitle">{editorPickText(lang, 'pickDoneAiOff')}</p>
          <p className="onb-body onb-body-dim">{t('onbBody3')}</p>
        </>
      )
    }
    return (
      <>
        <p className="onb-subtitle" data-connected={connected.length > 0}>
          {connected.length > 0
            ? t('onbDoneConnected', {
                provider: connected.join(' · '),
              })
            : t('onbDoneNotConnected')}
        </p>
        <p className="onb-body onb-body-dim">{t('onbBody3')}</p>
      </>
    )
  }

  return (
    <div
      className="onb-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={titles[steps[index] ?? 'welcome']}
    >
      <div className="onb-card" ref={cardRef} tabIndex={-1}>
        {/* all slides stay mounted, stacked in one grid cell: the card locks to
            the tallest slide's height for the language, so the footer and its
            buttons never move between steps. Inactive slides are inert. */}
        <div className="onb-stage">
          {steps.map((step, i) => (
            <div
              className={`onb-slide${i === index ? ' active' : ''}`}
              key={step}
              data-step={step}
              inert={i !== index}
            >
              <SlideArt step={step} />
              <h2 className="onb-title">{titles[step]}</h2>
              {renderStep(step)}
            </div>
          ))}
        </div>

        <div className="onb-footer">
          <div className="onb-dots">
            {steps.map((step, i) => (
              <button
                key={step}
                className={`onb-dot${i === index ? ' active' : ''}`}
                aria-label={t('onbStepAria', { n: i + 1, total: steps.length })}
                aria-current={i === index}
                disabled={submitting}
                onClick={() => goTo(i)}
              />
            ))}
          </div>
          <div className="onb-nav">
            <button className="onb-skip" disabled={submitting} onClick={finish}>
              {t('onbSkip')}
            </button>
            {index > 0 && (
              <button
                className="onb-back"
                disabled={submitting}
                onClick={() => setIndex(previousOnboardingStep(index, aiOn))}
              >
                {t('onbBack')}
              </button>
            )}
            <button className="onb-next" disabled={submitting} onClick={next}>
              {isLast ? t('onbStart') : t('onbNext')}
            </button>
          </div>
        </div>
      </div>
      {noticeOpen && <FirstConnectionDialog onAcknowledge={onNoticeAcknowledge} />}
    </div>
  )
}
