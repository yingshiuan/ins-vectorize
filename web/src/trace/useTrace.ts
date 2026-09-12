/**
 * Running the pipeline for the UI.
 *
 * Decoding is separated from tracing so that pulling a slider never re-decodes the
 * image, and the trace itself is debounced: it is hundreds of milliseconds of
 * honest work, and firing it on every frame of a drag would only ever show stale
 * results late. Out-of-order completions are dropped by run id rather than
 * cancelled, since neither potrace nor the fitter has anywhere to check a flag.
 */
import { useEffect, useRef, useState } from 'react'
import { loadImage, toImageData } from '../export/download'
import type { Source } from '../store/useTraceStore'
import { vectorize, type TraceResult } from './pipeline'
import type { TraceSpec } from './spec'

/** Long enough that a slider drag settles first, short enough to feel answered. */
const DEBOUNCE = 200

export interface TraceState {
  /** The decoded source, for the comparison view. */
  img: HTMLImageElement | null
  /** The decoded source's pixels, for the PNG cut-out export. */
  data: ImageData | null
  result: TraceResult | null
  running: boolean
  error: string | null
}

export function useTrace(spec: TraceSpec, source: Source | null): TraceState {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [data, setData] = useState<ImageData | null>(null)
  const [result, setResult] = useState<TraceResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)

  useEffect(() => {
    if (!source) {
      setImg(null)
      setData(null)
      setResult(null)
      setError(null)
      return
    }
    let live = true
    loadImage(source.src)
      .then((loaded) => {
        if (!live) return
        setImg(loaded)
        setData(toImageData(loaded))
        setError(null)
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [source])

  useEffect(() => {
    if (!data) return
    const id = ++latest.current
    setRunning(true)
    const timer = setTimeout(() => {
      vectorize(data, spec)
        .then((r) => {
          if (id !== latest.current) return
          setResult(r)
          setError(null)
        })
        .catch((e: unknown) => {
          if (id !== latest.current) return
          setError(e instanceof Error ? e.message : String(e))
        })
        .finally(() => {
          if (id === latest.current) setRunning(false)
        })
    }, DEBOUNCE)
    return () => clearTimeout(timer)
  }, [data, spec])

  return { img, data, result, running, error }
}
