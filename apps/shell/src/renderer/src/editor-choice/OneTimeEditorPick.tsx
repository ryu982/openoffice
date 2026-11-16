import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useModalKeys } from '@genoffice/ui'
import type { EditorChoiceApi, EditorItemId } from '../../../shared/editor-choice'
import type { TabsApi, TabSummary } from '../../../shared/tabs-api'
import { editorPickText } from '../i18n/strings-editor-pick'
import { useI18n } from '../locale'
import { EditorChoiceList } from './EditorChoiceList'
import {
  homeTabActive,
  oneTimePickVisible,
  openEditorItems,
  pickPatch,
  waitForLaunchSettled,
} from './one-time-pick'
import './globals'
import './editor-choice.css'

/** what the picker talks to; the window bridges unless a test hands in fakes */
export interface OneTimeEditorPickDeps {
  choice: Pick<EditorChoiceApi, 'pickDue' | 'set' | 'markPickSeen'>
  tabs: Pick<TabsApi, 'list' | 'onChanged'>
  /** resolves once the launch has laid out its tabs */
  launchSettled: () => Promise<void>
}

function windowDeps(): OneTimeEditorPickDeps | null {
  const choice = window.aiOfficeEditorChoice
  const tabs = window.aiOfficeTabs
  if (!choice || !tabs) return null
  return {
    choice,
    tabs,
    launchSettled: () => waitForLaunchSettled(window.aiOfficeRecovery),
  }
}

/**
 * The one-time editor picker for people who passed the first-run guide
 * before it had a pick step (spec §5). It asks once whether it is due, waits
 * for the launch to lay out its tabs, and shows only while the home tab is
 * in front (editor views paint above the shell). Everything starts on; the
 * new-document entries hidden on Home are not applied (a different setting).
 * It marks itself seen as soon as it shows, so quitting the app with it open
 * does not bring it back; saving sends the switches, closing keeps the choice
 * as it is, and either marks it seen again if the first mark failed.
 */
export function OneTimeEditorPick({ deps: given }: { deps?: OneTimeEditorPickDeps }) {
  const [deps] = useState(() => given ?? windowDeps())
  const [due, setDue] = useState(false)
  const [settled, setSettled] = useState(false)
  const [tabs, setTabs] = useState<TabSummary[] | null>(null)
  const [done, setDone] = useState(false)
  const [off, setOff] = useState<EditorItemId[]>([])
  const [aiFeatures, setAiFeatures] = useState(true)
  const [busy, setBusy] = useState(false)
  /** the mark under way or made; null before the first show, or after a mark that failed */
  const seenMark = useRef<Promise<boolean> | null>(null)

  /** mark it seen once; true when the mark is stored */
  const markSeen = useCallback((): Promise<boolean> => {
    if (!deps) return Promise.resolve(false)
    if (!seenMark.current) {
      const mark = deps.choice.markPickSeen().then(
        () => true,
        (error: unknown) => {
          console.warn('editor picker not marked seen', error)
          // the next try (saving or closing) marks it again
          if (seenMark.current === mark) seenMark.current = null
          return false
        },
      )
      seenMark.current = mark
    }
    return seenMark.current
  }, [deps])

  useEffect(() => {
    if (!deps) return
    let alive = true
    let unsubscribe: (() => void) | null = null
    void (async () => {
      const isDue = await deps.choice.pickDue().catch(() => false)
      if (!alive || !isDue) return
      setDue(true)
      unsubscribe = deps.tabs.onChanged((next) => {
        if (alive) setTabs(next)
      })
      await deps.launchSettled().catch(() => undefined)
      if (!alive) return
      // read the tabs after the launch laid them out, whatever was heard before
      const listed = await deps.tabs.list().catch(() => null)
      if (!alive) return
      if (listed) setTabs(listed)
      setSettled(true)
    })()
    return () => {
      alive = false
      unsubscribe?.()
    }
  }, [deps])

  const visible = oneTimePickVisible({
    due,
    launchSettled: settled,
    homeActive: tabs !== null && homeTabActive(tabs),
    done,
  })

  // seen once it shows (spec 5): it does not come back after a quit with it open
  useEffect(() => {
    if (visible) void markSeen()
  }, [visible, markSeen])

  if (!deps || !visible) return null

  const finish = async (save: boolean): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      if (save) await deps.choice.set(pickPatch(off, aiFeatures))
    } catch (error) {
      // not saved: stay up so it can be tried again or closed
      console.warn('editor choice not saved', error)
      setBusy(false)
      return
    }
    // a mark made when it showed is enough; one that failed is tried again
    if (!(await markSeen())) await markSeen()
    setBusy(false)
    setDone(true)
  }

  return (
    <OneTimeEditorPickDialog
      off={off}
      aiFeatures={aiFeatures}
      onOffChange={setOff}
      onAiFeaturesChange={setAiFeatures}
      openItems={openEditorItems(tabs ?? [])}
      busy={busy}
      onSave={() => void finish(true)}
      onClose={() => void finish(false)}
    />
  )
}

interface DialogProps {
  off: readonly EditorItemId[]
  aiFeatures: boolean
  onOffChange: (off: EditorItemId[]) => void
  onAiFeaturesChange: (on: boolean) => void
  openItems: ReadonlySet<EditorItemId>
  busy: boolean
  onSave: () => void
  onClose: () => void
}

function OneTimeEditorPickDialog(props: DialogProps) {
  const { lang } = useI18n()
  const titleId = useId()
  const keys = useModalKeys(() => {
    if (!props.busy) props.onClose()
  })

  return (
    <div
      className="modal-overlay ec-pick-overlay"
      ref={keys.ref}
      onKeyDown={keys.onKeyDown}
      tabIndex={-1}
    >
      <div
        className="modal ec-pick-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h3 id={titleId}>{editorPickText(lang, 'pickOneTimeTitle')}</h3>
        <p className="ec-pick-body">{editorPickText(lang, 'pickOneTimeBody')}</p>
        <div className="ec-pick-scroll">
          <EditorChoiceList
            off={props.off}
            aiFeatures={props.aiFeatures}
            onOffChange={props.onOffChange}
            onAiFeaturesChange={props.onAiFeaturesChange}
            openItems={props.openItems}
            disabled={props.busy}
          />
        </div>
        <div className="modal-buttons">
          <button
            type="button"
            className="btn btn-secondary ec-pick-close"
            disabled={props.busy}
            onClick={props.onClose}
          >
            {editorPickText(lang, 'pickClose')}
          </button>
          <button
            type="button"
            className="btn btn-primary ec-pick-save"
            disabled={props.busy}
            onClick={props.onSave}
          >
            {editorPickText(lang, 'pickSave')}
          </button>
        </div>
      </div>
    </div>
  )
}
