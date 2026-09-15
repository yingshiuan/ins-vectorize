/**
 * The page's side of the tracing worker.
 *
 * Owns the one thing the protocol leaves to its caller: sending the image before the first
 * request that needs it, and only then. If the worker cannot start at all — a browser
 * without module workers, a script that fails to load — the same host runs on the page
 * instead, so tracing still works, only without its own thread.
 */
import type { FromWorker, ToWorker } from './protocol'
import type { TraceSpec } from './spec'
import type { TraceResult } from './tracer'

export interface TraceClientEvents {
  onResult(run: number, result: TraceResult): void
  onError(run: number, message: string): void
}

export interface TraceClient {
  /** Trace `image` with `spec`. Only the newest run is promised an answer. */
  trace(run: number, spec: TraceSpec, image: ImageData): void
  cutout(spec: TraceSpec, image: ImageData): Promise<ImageData>
  /** Where the tracing is happening — the verify page reports it. */
  readonly mode: 'worker' | 'page'
  dispose(): void
}

type Pending = { resolve: (image: ImageData) => void; reject: (error: Error) => void; message: ToWorker }

export function createTraceClient(events: TraceClientEvents): TraceClient {
  let mode: 'worker' | 'page' = 'worker'
  let worker: Worker | null = null
  let page: ((message: ToWorker) => void) | null = null
  let heard = false
  let disposed = false

  let image: ImageData | null = null
  let source = 0
  let req = 0
  // What a fallback has to replay: the host it replaces may have received either.
  let lastSource: ToWorker | null = null
  let lastTrace: Extract<ToWorker, { type: 'trace' }> | null = null
  const cutouts = new Map<number, Pending>()

  const receive = (message: FromWorker) => {
    heard = true
    if (disposed) return
    switch (message.type) {
      case 'result':
        events.onResult(message.run, message.result)
        break
      case 'error':
        events.onError(message.run, message.message)
        break
      case 'cutout':
        cutouts.get(message.req)?.resolve(message.image)
        cutouts.delete(message.req)
        break
      case 'cutout-error':
        cutouts.get(message.req)?.reject(new Error(message.message))
        cutouts.delete(message.req)
        break
    }
  }

  // With neither in place a fallback is still loading, and will replay what it missed.
  const send = (message: ToWorker) => {
    if (page) page(message)
    else worker?.postMessage(message)
  }

  const fallBack = async (reason: unknown) => {
    worker?.terminate()
    worker = null
    mode = 'page'
    console.warn('Tracing on the page, because the worker could not start:', reason)
    const [{ createHost }, { createTracer }, { layerContours }] = await Promise.all([
      import('./host'),
      import('./tracer'),
      import('./layer'),
    ])
    if (disposed) return
    page = createHost(createTracer(layerContours), receive)
    for (const message of [lastSource, lastTrace, ...[...cutouts.values()].map((c) => c.message)]) {
      if (message) page(message)
    }
  }

  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<FromWorker>) => receive(event.data)
    worker.onerror = (event) => {
      if (!heard) {
        event.preventDefault()
        void fallBack(event.message || event)
      } else if (lastTrace) {
        events.onError(lastTrace.run, event.message || 'The tracer stopped unexpectedly.')
      }
    }
  } catch (e) {
    void fallBack(e)
  }

  const adopt = (next: ImageData) => {
    if (next === image) return
    image = next
    lastSource = { type: 'source', id: ++source, image: next }
    send(lastSource)
  }

  return {
    get mode() {
      return mode
    },

    trace(run, spec, next) {
      adopt(next)
      lastTrace = { type: 'trace', run, source, spec }
      send(lastTrace)
    },

    cutout(spec, next) {
      adopt(next)
      const message: ToWorker = { type: 'cutout', req: ++req, source, spec }
      return new Promise<ImageData>((resolve, reject) => {
        cutouts.set(req, { resolve, reject, message })
        send(message)
      })
    },

    dispose() {
      disposed = true
      worker?.terminate()
      for (const { reject } of cutouts.values()) reject(new Error('The tracer was closed.'))
      cutouts.clear()
    },
  }
}
