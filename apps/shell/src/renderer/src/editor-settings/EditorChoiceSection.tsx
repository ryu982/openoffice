import { useState } from 'react'
import type { AppChoice, EditorChoiceApi, EditorItemId } from '../../../shared/editor-choice'
import { EditorChoiceList } from '../editor-choice/EditorChoiceList'
import { editorPickText } from '../i18n/strings-editor-pick'
import { editorSettingsText } from '../i18n/strings-editor-settings'
import { useI18n } from '../locale'
import { aiOffConfirm, aiOffStart } from './ai-off'
import './editor-settings.css'

export interface EditorChoiceSectionProps {
  api: Pick<EditorChoiceApi, 'set' | 'aiJobCount' | 'stopAllAiJobs'>
  /** the choice that applies now */
  choice: AppChoice
  /** the choice changed here (shown at once, then as the main process stored it) */
  onChoice: (next: AppChoice) => void
  /** items whose editor has documents open now */
  openItems?: ReadonlySet<EditorItemId>
}

/**
 * Settings → Editors and AI (spec §6): the eleven items and AI, saved as
 * soon as a switch moves. Turning an editor off closes nothing that is open
 * (§6.1). Turning AI off while AI jobs run asks first and stops them on
 * "stop and turn off"; with none running it goes off at once (§6.2).
 */
export function EditorChoiceSection({
  api,
  choice,
  onChoice,
  openItems,
}: EditorChoiceSectionProps) {
  const { lang } = useI18n()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  /** AI jobs running when AI was switched off: the question is up */
  const [asking, setAsking] = useState<number | null>(null)

  const run = async (optimistic: AppChoice | null, work: () => Promise<AppChoice | null>) => {
    if (busy) return
    const before = choice
    setBusy(true)
    setFailed(false)
    if (optimistic) onChoice(optimistic)
    try {
      const next = await work()
      if (next) onChoice(next)
    } catch (error) {
      console.warn('editor choice not saved', error)
      onChoice(before)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const changeOff = (off: EditorItemId[]) => void run({ ...choice, off }, () => api.set({ off }))

  const changeAi = (on: boolean) => {
    if (on) {
      void run({ ...choice, aiFeatures: true }, () => api.set({ aiFeatures: true }))
      return
    }
    void run(null, async () => {
      const step = await aiOffStart(api)
      if (step.kind === 'done') return step.choice
      setAsking(step.count)
      return null
    })
  }

  const confirmAiOff = () => {
    setAsking(null)
    void run(null, () => aiOffConfirm(api))
  }

  return (
    <div className="es-section" data-testid="editor-choice-section">
      <h3 className="set-pane-title">{editorPickText(lang, 'settingsTabName')}</h3>
      <div className="set-field-desc es-lead">{editorSettingsText(lang, 'sectionDesc')}</div>
      <EditorChoiceList
        off={choice.off}
        aiFeatures={choice.aiFeatures}
        onOffChange={changeOff}
        onAiFeaturesChange={changeAi}
        openItems={openItems}
        disabled={busy || asking !== null}
      />
      {asking !== null && (
        <div className="es-confirm" role="alertdialog" aria-live="assertive">
          <div className="set-field-desc es-confirm-text">
            {editorSettingsText(lang, 'aiOffAsk', { count: asking })}
          </div>
          <div className="es-confirm-actions">
            <button
              type="button"
              className="set-btn es-ai-off-cancel"
              onClick={() => setAsking(null)}
            >
              {editorSettingsText(lang, 'aiOffCancel')}
            </button>
            <button type="button" className="set-btn primary es-ai-off-stop" onClick={confirmAiOff}>
              {editorSettingsText(lang, 'aiOffStop')}
            </button>
          </div>
        </div>
      )}
      {failed && (
        <div className="set-field-desc es-failed" role="status">
          {editorSettingsText(lang, 'saveFailed')}
        </div>
      )}
      <div className="set-field-desc es-note">{editorSettingsText(lang, 'aiOffKeeps')}</div>
    </div>
  )
}
