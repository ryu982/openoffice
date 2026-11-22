import React, { useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import { IconStepDone, IconStepError, IconStepRunning } from './icons'
import { aiPanelText } from './strings-ai-panel'

export interface AiWorkStep {
  readonly name: string
  readonly summary: string
  /** Step is currently running; keeps the timeline open until finished */
  readonly running?: boolean | undefined
  readonly isError?: boolean | undefined
  /** Truncated tool output shown when the step is expanded */
  readonly output?: string | undefined
}

export interface AiWorkStepsProps<T extends AiWorkStep = AiWorkStep> {
  readonly lang: Lang
  readonly steps: readonly T[]
  /** Override the summary header label (e.g. docked-card waiting state in HTML) */
  readonly summaryLabel?: string | undefined
  /** Override whether a step can expand (e.g. structured display payload in Slides) */
  readonly hasDetail?: ((step: T, index: number) => boolean) | undefined
  /** Custom detail renderer for an expanded step; falls back to monospace output */
  readonly renderDetail?: ((step: T, index: number) => React.ReactNode) | undefined
}

function StepStatusIcon({ status }: { readonly status: 'running' | 'done' | 'error' }) {
  if (status === 'running') return <IconStepRunning size={14} />
  if (status === 'error') return <IconStepError size={14} />
  return <IconStepDone size={14} />
}

/**
 * Collapsible tool-activity timeline placed above an assistant reply body.
 * Auto-opens while any step is running, auto-collapses into "Worked · N steps"
 * once finished, and honors manual toggles unconditionally.
 */
export function AiWorkSteps<T extends AiWorkStep = AiWorkStep>({
  lang,
  steps,
  summaryLabel,
  hasDetail,
  renderDetail,
}: AiWorkStepsProps<T>): React.JSX.Element | null {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [userOpen, setUserOpen] = useState<boolean | null>(null)

  if (steps.length === 0) return null

  const toggleStep = (index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const anyRunning = steps.some((step) => step.running === true)
  const anyError = steps.some((step) => step.isError === true)
  const open = userOpen ?? anyRunning
  const summaryStatus: 'running' | 'done' | 'error' = anyRunning
    ? 'running'
    : anyError
      ? 'error'
      : 'done'
  const label =
    summaryLabel ??
    (anyRunning
      ? aiPanelText(lang, 'workingSteps')
      : steps.length === 1
        ? aiPanelText(lang, 'workedStepOne')
        : aiPanelText(lang, 'workedSteps', { n: steps.length }))

  return (
    <div className="ai-work-group">
      <button
        type="button"
        className={`ai-work-group-summary${anyRunning ? ' running' : ''}`}
        aria-expanded={open}
        onClick={() => setUserOpen(!open)}
      >
        <span className={`ai-work-group-summary-icon ${summaryStatus}`} aria-hidden="true">
          <StepStatusIcon status={summaryStatus} />
        </span>
        <span className="ai-work-group-label">{label}</span>
        <span className={`ai-tool-chip-caret${open ? ' open' : ''}`} aria-hidden="true">
          ›
        </span>
      </button>
      <div className={`ai-work-group-body${open ? ' open' : ''}`}>
        <div className="ai-work-group-body-inner">
          {steps.map((step, index) => {
            const canExpand =
              !step.running && (hasDetail ? hasDetail(step, index) : Boolean(step.output))
            const isOpen = expanded.has(index)
            const status: 'running' | 'done' | 'error' = step.running
              ? 'running'
              : step.isError
                ? 'error'
                : 'done'
            return (
              <div key={index} className="ai-step-row">
                <span className={`ai-step-icon ${status}`} aria-hidden="true">
                  <StepStatusIcon status={status} />
                </span>
                <div className="ai-step-content">
                  {canExpand ? (
                    <button
                      type="button"
                      className="ai-step-title clickable"
                      data-tip={step.name}
                      aria-expanded={isOpen}
                      onClick={() => toggleStep(index)}
                    >
                      {step.summary}
                    </button>
                  ) : (
                    <span className="ai-step-title" data-tip={step.name}>
                      {step.summary}
                    </span>
                  )}
                  {canExpand && isOpen && (
                    <div className="ai-step-detail">
                      {renderDetail ? (
                        renderDetail(step, index)
                      ) : (
                        <div className="ai-tool-output">
                          <div className="ai-tool-output-pre">{step.output}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
