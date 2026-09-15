/**
 * What the page and the tracing worker say to each other.
 *
 * The image crosses once per source rather than once per trace: it can run to tens of
 * megabytes, and a slider drag would otherwise copy it on every step. Each request then
 * names the source it is about, so one that arrives after the picture changed is dropped
 * instead of being answered about the wrong image.
 */
import type { TraceSpec } from './spec'
import type { TraceResult } from './tracer'

export type ToWorker =
  | { type: 'source'; id: number; image: ImageData }
  | { type: 'trace'; run: number; source: number; spec: TraceSpec }
  | { type: 'cutout'; req: number; source: number; spec: TraceSpec }

export type FromWorker =
  | { type: 'result'; run: number; result: TraceResult }
  | { type: 'error'; run: number; message: string }
  | { type: 'cutout'; req: number; image: ImageData }
  | { type: 'cutout-error'; req: number; message: string }
