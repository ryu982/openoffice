import { useCallback, useEffect, useRef, useState } from 'react'
import { createDefaultOptions, type PrintLayoutOptions } from '@genoffice/print-layout/plan'
import {
  coupleDuplex,
  createDuplexCoupling,
  setDuplexByUser,
  type DuplexCoupling,
  type PrintLayoutDuplex,
  type PrintLayoutProgress,
} from './model'

/**
 * Options state for a print dialog that starts from the defaults every time
 * `open` turns true (spec 4: nothing carries over between prints).
 */
export function usePrintLayoutOptions(
  open: boolean,
): [PrintLayoutOptions, (next: PrintLayoutOptions) => void] {
  const [options, setOptions] = useState<PrintLayoutOptions>(createDefaultOptions)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setOptions(createDefaultOptions())
  }
  return [options, setOptions]
}

/**
 * The word editor's duplex field coupled to the panel (spec 4.6). Pass the
 * panel's options each render; `setDuplex` is for the user's own changes.
 */
export function useDuplexCoupling(
  options: PrintLayoutOptions,
  initial: PrintLayoutDuplex,
): { duplex: PrintLayoutDuplex; setDuplex: (duplex: PrintLayoutDuplex) => void } {
  const [state, setState] = useState<DuplexCoupling>(() => createDuplexCoupling(initial))
  const [seen, setSeen] = useState(options)
  if (seen !== options) {
    setSeen(options)
    setState(coupleDuplex(state, seen, options))
  }
  const setDuplex = useCallback(
    (duplex: PrintLayoutDuplex) => setState((s) => setDuplexByUser(s, duplex)),
    [],
  )
  return { duplex: state.duplex, setDuplex }
}

/**
 * Builds the arranged result as one PNG per face. The editor reports progress
 * and stops (rejecting or resolving, either is fine) when `signal` aborts.
 */
export type PrintLayoutPreviewRequest = (
  options: PrintLayoutOptions,
  context: { signal: AbortSignal; onProgress: (progress: PrintLayoutProgress) => void },
) => Promise<Uint8Array[]>

export type ArrangedPreviewState =
  | { status: 'idle' }
  | { status: 'running'; progress: PrintLayoutProgress | null }
  | { status: 'done'; faces: readonly Uint8Array[] }
  | { status: 'failed' }

/** Runs a preview request with cancel; a newer start or unmount aborts the older run. */
export function useArrangedPreview(request: PrintLayoutPreviewRequest | undefined): {
  state: ArrangedPreviewState
  start: (options: PrintLayoutOptions) => void
  cancel: () => void
} {
  const [state, setState] = useState<ArrangedPreviewState>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)
  const requestRef = useRef(request)
  requestRef.current = request

  const cancel = useCallback(() => {
    controller.current?.abort()
    controller.current = null
    setState((s) => (s.status === 'idle' ? s : { status: 'idle' }))
  }, [])

  const start = useCallback((options: PrintLayoutOptions) => {
    const run = requestRef.current
    if (!run) return
    controller.current?.abort()
    const c = new AbortController()
    controller.current = c
    setState({ status: 'running', progress: null })
    let pending: Promise<Uint8Array[]>
    try {
      pending = run(options, {
        signal: c.signal,
        onProgress: (progress) => {
          if (!c.signal.aborted) setState({ status: 'running', progress })
        },
      })
    } catch {
      pending = Promise.reject(new Error('preview request failed'))
    }
    pending.then(
      (faces) => {
        if (c.signal.aborted) return
        controller.current = null
        setState({ status: 'done', faces })
      },
      () => {
        if (c.signal.aborted) return
        controller.current = null
        setState({ status: 'failed' })
      },
    )
  }, [])

  useEffect(() => () => controller.current?.abort(), [])

  return { state, start, cancel }
}
