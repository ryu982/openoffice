import type { ConvertKind, GenerateWindowState } from '../../../shared/generate-api'

/**
 * What the generate window draws while AI is on or off (editor choice spec
 * 8.1): with AI off, the AI "make" (its kinds, request and AI notices) is
 * gone, the conversions without AI stay, and the first one on offer is chosen
 * for the person. Pure, so it is tested without a window.
 */
export interface GenerateAiView {
  /** the AI kinds, the request box and the AI notices */
  showAi: boolean
  /** the line that says AI is off, and what can be made without it; null with AI on */
  aiOffHint: 'genAiOffConvert' | 'genAiOffNoConversion' | null
  /** "make" may be pressed */
  canMake: boolean
  /** a conversion to choose now (AI is off and none is chosen yet) */
  pickConversion: ConvertKind | null
}

export function generateAiView(
  state: Pick<GenerateWindowState, 'mode' | 'conversions' | 'canMake' | 'making'>,
  aiOn: boolean,
): GenerateAiView {
  const converting = state.mode === 'convert'
  if (aiOn) return { showAi: true, aiOffHint: null, canMake: state.canMake, pickConversion: null }
  return {
    showAi: false,
    aiOffHint: state.conversions.length > 0 ? 'genAiOffConvert' : 'genAiOffNoConversion',
    canMake: state.canMake && converting,
    pickConversion:
      !converting && !state.making && state.conversions.length > 0 ? state.conversions[0]! : null,
  }
}
