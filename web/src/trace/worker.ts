/**
 * The tracer, off the page's thread.
 *
 * A trace is hundreds of milliseconds to seconds of blur, potrace and fitting, and on the
 * main thread all of it froze the very preview it was meant to update. Here it costs the
 * page nothing but receiving the answer.
 */
import { createHost } from './host'
import { layerContours } from './layer'
import type { FromWorker, ToWorker } from './protocol'
import { createTracer } from './tracer'

// Typed here rather than by adding the WebWorker lib, whose globals collide with DOM's.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null
  postMessage(message: FromWorker, transfer: Transferable[]): void
}

const handle = createHost(createTracer(layerContours), (message, transfer = []) =>
  scope.postMessage(message, transfer),
)
scope.onmessage = (event) => handle(event.data)
