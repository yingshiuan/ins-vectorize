/**
 * The tracing side of the protocol: a queue one deep.
 *
 * Only the newest trace is ever worth finishing. While one runs, a newer request replaces
 * whatever was waiting, and the running one looks between stages for anything waiting —
 * abandoning itself if there is, but leaving what it finished in the tracer's memory for
 * its replacement. potrace cannot be interrupted mid-call, so a stage boundary is the
 * soonest a run can give way.
 *
 * Shared by the worker and by the page's fallback for when a worker cannot start, so the
 * two cannot behave differently.
 */
import type { FromWorker, ToWorker } from './protocol'
import { Superseded, type Tracer } from './tracer'

export type Post = (message: FromWorker, transfer?: Transferable[]) => void

type TraceJob = Extract<ToWorker, { type: 'trace' }>

/** Let the event loop run, so requests that arrived meanwhile are delivered. */
const yieldToMessages = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function createHost(tracer: Tracer, post: Post): (message: ToWorker) => void {
  let image: ImageData | null = null
  let source = -1
  let pending: TraceJob | null = null
  let busy = false

  const checkpoint = async () => {
    await yieldToMessages()
    if (pending) throw new Superseded()
  }

  const drain = async () => {
    busy = true
    while (pending && image) {
      const job = pending
      pending = null
      try {
        post({ type: 'result', run: job.run, result: await tracer.run(image, job.spec, { checkpoint }) })
      } catch (e) {
        if (!(e instanceof Superseded)) post({ type: 'error', run: job.run, message: messageOf(e) })
      }
      await yieldToMessages()
    }
    busy = false
  }

  return (message) => {
    switch (message.type) {
      case 'source':
        image = message.image
        source = message.id
        pending = null
        tracer.forget()
        break

      case 'trace':
        if (message.source !== source) return
        pending = message
        if (!busy) void drain()
        break

      case 'cutout':
        if (message.source !== source || !image) {
          post({ type: 'cutout-error', req: message.req, message: 'The image changed before the cut-out was made.' })
          return
        }
        try {
          const out = tracer.cutout(image, message.spec)
          post({ type: 'cutout', req: message.req, image: out }, [out.data.buffer as ArrayBuffer])
        } catch (e) {
          post({ type: 'cutout-error', req: message.req, message: messageOf(e) })
        }
        break
    }
  }
}
