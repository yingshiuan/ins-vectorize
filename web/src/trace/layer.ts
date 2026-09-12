/**
 * One coverage map all the way to path data.
 *
 * Lifted out of `pipeline.ts` unchanged so that tracing N layers is a loop rather than
 * a second code path. Single-colour artwork is simply the one-layer case.
 *
 * Coordinates come back in the padded canvas's space, exactly as before.
 */
import { bezierPath, nodeCount } from './emit'
import { fitContour } from './fit'
import type { Bitmap } from './ink'
import { traceBitmap } from './potrace'
import { prepare } from './prepare'
import { PAD, type TraceSpec } from './spec'
import type { Cubic } from './vec'

export interface LayerTrace {
  d: string
  outlines: number
  nodes: number
}

export async function traceLayerMask(mask: Bitmap, spec: TraceSpec): Promise<LayerTrace> {
  const bitmap = prepare(mask, {
    blur: spec.trace.blur,
    upscale: spec.trace.upscale,
    pad: PAD,
  })

  const contours = await traceBitmap(bitmap, {
    despeckle: spec.trace.despeckle,
    upscale: spec.trace.upscale,
  })

  const fitted: Cubic[][] = []
  for (const contour of contours) {
    const curves = fitContour(contour, { tolMax: spec.fit.smooth, sigma: spec.fit.denoise })
    if (curves.length) fitted.push(curves)
  }

  const d = bezierPath(fitted)
  return { d, outlines: fitted.length, nodes: nodeCount(d) }
}
