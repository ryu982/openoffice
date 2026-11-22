/**
 * The ways a person puts a picture on a topic (`picture-drop.ts`). The
 * drop zone of the map card: a picture dragged from the desktop lands on the
 * topic under the pointer. "Insert picture" (toolbar and the topic's menu):
 * the file window, for the topic it was asked for. A picture pasted on the
 * map goes on a new topic under the selected one. While the drag is over a
 * topic that topic is marked; the mark is editing chrome, coloured in
 * `styles.css`, and is gone before the drop changes the map.
 */
import { useCallback, useEffect, useRef, type ClipboardEvent, type DragEvent } from 'react'
import type { StringKey } from '../i18n/locale'
import type { MapAiHost } from '../ai/map-tools'
import type { MapController } from './controller'
import {
  choosePictureFile,
  dragCarriesPicture,
  dropPicture,
  isPictureFile,
  pastePicture,
  topicAt,
  type PictureDropOutcome,
} from './picture-drop'

/** The class a topic carries while a picture is dragged over it. */
export const PICTURE_DROP_TARGET = 'mm-picture-drop-target'

/** The status line text of a drop that did not simply work; null for a drop that did. */
const OUTCOME_TEXT: Record<PictureDropOutcome, StringKey | null> = {
  done: null,
  'done-first-only': 'pictureDropFirstOnly',
  'no-topic': 'pictureDropNoTopic',
  'too-large': 'pictureDropTooLarge',
  unsupported: 'pictureDropUnsupported',
  failed: 'pictureDropFailed',
}

export interface PictureDropZone {
  onDragOver(event: DragEvent<HTMLElement>): void
  onDragLeave(event: DragEvent<HTMLElement>): void
  onDrop(event: DragEvent<HTMLElement>): void
  /** a picture pasted on the map: a new topic under the selected one holds it */
  onPaste(event: ClipboardEvent<HTMLElement>): void
  /** opens the file window and puts the chosen picture on the topic */
  choose(topicId: string): void
}

export function usePictureDrop(options: {
  host: MapAiHost
  /** the controller of the sheet on screen */
  controller(): MapController | null
  say(key: StringKey): void
}): PictureDropZone {
  const { host, controller, say } = options
  const marked = useRef<Element | null>(null)

  const mark = useCallback((topic: Element | null) => {
    if (marked.current === topic) return
    marked.current?.classList.remove(PICTURE_DROP_TARGET)
    topic?.classList.add(PICTURE_DROP_TARGET)
    marked.current = topic
  }, [])
  useEffect(() => () => mark(null), [mark])

  const report = useCallback(
    (pending: Promise<PictureDropOutcome>) => {
      void pending.then(
        (outcome) => {
          const text = OUTCOME_TEXT[outcome]
          if (text) say(text)
        },
        () => say('pictureDropFailed'),
      )
    },
    [say],
  )

  const put = useCallback(
    (topicId: string | null, pictures: readonly File[]) => {
      report(dropPicture(host, topicId, pictures))
    },
    [host, report],
  )

  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!dragCarriesPicture(event.dataTransfer)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      mark(topicAt(event.target))
    },
    [mark],
  )

  const onDragLeave = useCallback(
    (event: DragEvent<HTMLElement>) => {
      // moving between elements of the card is not leaving it
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      mark(null)
    },
    [mark],
  )

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      mark(null)
      const pictures = Array.from(event.dataTransfer.files).filter(isPictureFile)
      // a drop without a picture (a document) is the drop-open bridge's: it opens in a tab
      if (pictures.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      const under = topicAt(event.target)?.nodeObj.id ?? null
      const selected = controller()?.selectedTopicIds() ?? []
      const topicId = under ?? (selected.length === 1 ? selected[0]! : null)
      put(topicId, pictures)
    },
    [controller, put, mark],
  )

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      // topics copied in the map are the library's paste
      if (event.defaultPrevented) return
      const target = event.target instanceof Element ? event.target : null
      // a title being typed takes a paste as text
      if (!target?.closest('.map-container') || target.closest('#input-box')) return
      const pictures = Array.from(event.clipboardData.files).filter(isPictureFile)
      if (pictures.length === 0) return
      event.preventDefault()
      const parentId = controller()?.selectedTopicIds().at(-1)
      if (parentId === undefined) say('selectTopicFirst')
      else report(pastePicture(host, parentId, pictures))
    },
    [controller, host, report, say],
  )

  const choose = useCallback(
    (topicId: string) => {
      void choosePictureFile().then((file) => {
        // closing the window without a picture changes nothing and says nothing
        if (file) put(topicId, [file])
      })
    },
    [put],
  )

  return { onDragOver, onDragLeave, onDrop, onPaste, choose }
}
