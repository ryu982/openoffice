import { useEffect, useState, type ReactElement } from 'react'
import type { Lang } from '@genoffice/i18n'
import { printLayoutText } from '../strings-print-layout'
import type { ArrangedPreviewState } from './hooks'
import type { PrintLayoutProgress } from './model'
import './print-layout.css'

/** "n of m pages" with a cancel button, for a running preview, print or save. */
export function PrintLayoutProgressLine(props: {
  lang: Lang
  progress: PrintLayoutProgress | null
  onCancel?: (() => void) | undefined
  /** data-pl name of the cancel button */
  cancelId?: string | undefined
}): ReactElement {
  const { lang, progress, onCancel, cancelId = 'job-cancel' } = props
  return (
    <div className="gs-pl-progress" role="status">
      <span>
        {progress && progress.total > 0
          ? printLayoutText(lang, 'progress', { done: progress.done, total: progress.total })
          : '…'}
      </span>
      {progress && progress.total > 0 && (
        <progress className="gs-pl-progress-bar" value={progress.done} max={progress.total} />
      )}
      {onCancel && (
        <button type="button" className="gs-pl-btn" data-pl={cancelId} onClick={onCancel}>
          {printLayoutText(lang, 'cancel')}
        </button>
      )}
    </div>
  )
}

/** Blob URLs for the face pictures, revoked when the faces change or the view goes away. */
function useFaceUrls(faces: readonly Uint8Array[] | null): string[] {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    if (!faces) {
      setUrls([])
      return
    }
    const made = faces.map((png) =>
      URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' })),
    )
    setUrls(made)
    return () => {
      for (const url of made) URL.revokeObjectURL(url)
    }
  }, [faces])
  return urls
}

export interface ArrangedPreviewProps {
  lang: Lang
  state: ArrangedPreviewState
  onCancel: () => void
  onClose: () => void
}

/**
 * The arranged result as the editor rendered it (spec 4.7): progress and cancel
 * while it is made, then one picture per face.
 */
export function ArrangedPreview(props: ArrangedPreviewProps): ReactElement | null {
  const { lang, state, onCancel, onClose } = props
  const urls = useFaceUrls(state.status === 'done' ? state.faces : null)
  if (state.status === 'idle') return null
  return (
    <section className="gs-pl-result" aria-label={printLayoutText(lang, 'previewTitle')}>
      <div className="gs-pl-result-head">
        <span className="gs-pl-legend">{printLayoutText(lang, 'previewTitle')}</span>
        {state.status !== 'running' && (
          <button type="button" className="gs-pl-btn" data-pl="preview-close" onClick={onClose}>
            {printLayoutText(lang, 'close')}
          </button>
        )}
      </div>
      {state.status === 'running' && (
        <PrintLayoutProgressLine
          lang={lang}
          progress={state.progress}
          onCancel={onCancel}
          cancelId="preview-cancel"
        />
      )}
      {state.status === 'failed' && (
        <p className="gs-pl-issue" role="alert">
          {printLayoutText(lang, 'previewFailed')}
        </p>
      )}
      {state.status === 'done' && (
        <div className="gs-pl-result-faces">
          {urls.map((url, i) => (
            <img
              key={url}
              className="gs-pl-result-face"
              src={url}
              alt={printLayoutText(lang, 'faceCaption', { face: i + 1 })}
            />
          ))}
        </div>
      )}
    </section>
  )
}
