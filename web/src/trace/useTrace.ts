/**
 * Running the pipeline for the UI.
 *
 * Decoding is separated from tracing so that pulling a slider never re-decodes the image.
 * The trace itself runs in a worker (see worker.ts), which only ever finishes the newest
 * request and abandons older ones at its next stage boundary, so a drag cannot pile work
 * up behind itself — and the page stays live while it runs. A short debounce still spares
 * the worker the requests a drag makes faster than any stage could answer. Answers that
 * arrive out of order are dropped by run id.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadImage, toImageData } from '../export/download'
import type { Source } from '../store/useTraceStore'
import { createTraceClient, type TraceClient } from './client'
import type { TraceSpec } from './spec'
import type { TraceResult } from './tracer'

/** Long enough to skip a drag's in-between frames; the worker's own coalescing does the rest. */
const DEBOUNCE = 80

export interface TraceState {
  /** The decoded source, for the comparison view. */
  img: HTMLImageElement | null
  /** The decoded source's pixels, for the colour dropper. */
  data: ImageData | null
  result: TraceResult | null
  running: boolean
  error: string | null
  /** The source with its background, and any switched-off colours, taken out. */
  cutout(spec: TraceSpec): Promise<ImageData>
}

export function useTrace(spec: TraceSpec, source: Source | null): TraceState {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [data, setData] = useState<ImageData | null>(null)
  const [result, setResult] = useState<TraceResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)
  const client = useRef<TraceClient | null>(null)

  // One worker for the life of the page. Made in an effect rather than during render, so
  // StrictMode's rehearsal mount disposes the one it made instead of leaking it; the trace
  // below reads the ref when its timer fires, by which time it holds the survivor.
  useEffect(() => {
    const made = createTraceClient({
      onResult(run, r) {
        if (run !== latest.current) return
        setResult(r)
        setError(null)
        setRunning(false)
      },
      onError(run, message) {
        if (run !== latest.current) return
        setError(message)
        setRunning(false)
      },
    })
    client.current = made
    return () => {
      made.dispose()
      if (client.current === made) client.current = null
    }
  }, [])

  useEffect(() => {
    if (!source) {
      // Anything still being traced was about the image that just went away.
      latest.current++
      setImg(null)
      setData(null)
      setResult(null)
      setError(null)
      setRunning(false)
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
    const timer = setTimeout(() => client.current?.trace(id, spec, data), DEBOUNCE)
    return () => clearTimeout(timer)
  }, [data, spec])

  const cutout = useCallback(
    (s: TraceSpec) =>
      client.current && data ? client.current.cutout(s, data) : Promise.reject(new Error('There is no image to cut out.')),
    [data],
  )

  return { img, data, result, running, error, cutout }
}
