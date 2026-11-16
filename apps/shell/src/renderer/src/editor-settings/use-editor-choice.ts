import { useEffect, useState } from 'react'
import {
  type AppChoice,
  type EditorChoiceApi,
  type EditorItemId,
} from '../../../shared/editor-choice'
import type { TabsApi } from '../../../shared/tabs-api'
import { openEditorItems } from '../editor-choice/one-time-pick'

const allOn = (): AppChoice => ({ off: [], aiFeatures: true, locked: false })

/**
 * The editor choice as Settings shows it, kept current when it changes
 * anywhere else (the first-run guide, a "turn on and open" prompt, another
 * window). `null` until the first answer, so nothing AI-only mounts (and no
 * subscription check starts) before Settings knows whether AI is on. With no
 * bridge (a window without it, tests) everything is on from the start.
 */
export function useEditorChoice(
  api: EditorChoiceApi | undefined,
): [AppChoice | null, (next: AppChoice) => void] {
  const [choice, setChoice] = useState<AppChoice | null>(() => (api ? null : allOn()))

  useEffect(() => {
    if (!api) return
    let alive = true
    let heard = false
    const unsubscribe = api.onChange((next) => {
      heard = true
      if (alive) setChoice(next)
    })
    api.get().then(
      (next) => {
        if (alive && !heard) setChoice(next)
      },
      () => {
        if (alive && !heard) setChoice(allOn())
      },
    )
    return () => {
      alive = false
      unsubscribe()
    }
  }, [api])

  return [choice, setChoice]
}

/** the items whose editor has a tab open, kept current while Settings is up */
export function useOpenEditorItems(
  tabs: Pick<TabsApi, 'list' | 'onChanged'> | undefined,
): ReadonlySet<EditorItemId> {
  const [items, setItems] = useState<ReadonlySet<EditorItemId>>(() => new Set())

  useEffect(() => {
    if (!tabs) return
    let alive = true
    const unsubscribe = tabs.onChanged((next) => {
      if (alive) setItems(openEditorItems(next))
    })
    tabs.list().then(
      (listed) => {
        if (alive) setItems(openEditorItems(listed))
      },
      () => undefined,
    )
    return () => {
      alive = false
      unsubscribe()
    }
  }, [tabs])

  return items
}
