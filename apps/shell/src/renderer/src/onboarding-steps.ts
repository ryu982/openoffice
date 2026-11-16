/**
 * The first-run onboarding as data: its steps and how one moves between
 * them. The steps follow the AI switch of the pick step (with AI off there is
 * no connect step), so every function takes it. No step waits for anything —
 * in particular the connect step can be left without a subscription
 * connected.
 */

import { onboardingSteps, type OnboardingStep } from '../../shared/editor-choice'

export type OnboardingStepId = OnboardingStep

/** the steps in order: welcome, pick, (connect,) done */
export function onboardingStepIds(aiOn: boolean): readonly OnboardingStepId[] {
  return onboardingSteps(aiOn)
}

/** the step where the subscription connection is offered; -1 with AI off */
export function onboardingConnectStep(aiOn: boolean): number {
  return onboardingStepIds(aiOn).indexOf('connect')
}

export function isLastOnboardingStep(index: number, aiOn: boolean): boolean {
  return index >= onboardingStepIds(aiOn).length - 1
}

/** Where "Next" leads from a step; `null` means the onboarding is finished */
export function nextOnboardingStep(index: number, aiOn: boolean): number | null {
  return isLastOnboardingStep(index, aiOn) ? null : Math.max(0, index) + 1
}

/** Where "Back" leads from a step; the first step stays put */
export function previousOnboardingStep(index: number, aiOn: boolean): number {
  return Math.max(0, Math.min(index, onboardingStepIds(aiOn).length - 1) - 1)
}

/**
 * Whether moving from step `from` to step `to` passes the pick step: leaving
 * it forward, the moment the choice is saved. Going back from it, or jumping
 * over it from the welcome step, is not passing it.
 */
export function leavesPickStep(from: number, to: number, aiOn: boolean): boolean {
  return onboardingStepIds(aiOn)[from] === 'pick' && to > from
}
