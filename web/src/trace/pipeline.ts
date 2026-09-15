/**
 * Bitmap in, SVG out, in one call.
 *
 * The stages live in `tracer.ts`, which also remembers them between runs for the worker.
 * This is the forgetful version, for callers that trace once — the selftest and
 * `scripts/trace-file.ts`. Kept free of React so either can use it without dragging a
 * component tree along.
 */
import { layerContours } from './layer'
import type { TraceSpec } from './spec'
import { createTracer, type TraceResult } from './tracer'

export type { TraceLayer, TraceResult } from './tracer'

export function vectorize(img: ImageData, spec: TraceSpec): Promise<TraceResult> {
  return createTracer(layerContours).run(img, spec)
}
