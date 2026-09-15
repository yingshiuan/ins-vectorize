/**
 * A layer's traced outlines, refitted and written out as path data.
 *
 * The half of a layer's trace that never touches potrace, split from `layer.ts` so it can
 * run — and be cached, and be tested — without loading the tracer. Each outline is fitted
 * on its own, as a circle where it is one (shapes.ts) and as cubics otherwise; then the
 * layer's outlines are compared with each other, and repeats become exact copies
 * (repeats.ts).
 */
import { nodeCount, outlinePath } from './emit'
import { fitContour, type FitOptions } from './fit'
import type { Outline } from './outline'
import { snapRepeats } from './repeats'
import { dense } from './resample'
import { detectCircle } from './shapes'
import type { TraceSpec } from './spec'
import type { Seg, Vec } from './vec'

export interface LayerTrace {
  d: string
  outlines: number
  nodes: number
  /** Outlines written as circles rather than curves. */
  circles: number
  /** Outlines written as exact copies of an earlier one, moved. */
  repeats: number
}

/** One traced outline in its best form: a circle where it is one, the fewest cubics otherwise. */
function fitOutline(
  contour: readonly Seg[],
  samples: readonly Vec[] | null,
  fit: TraceSpec['fit'],
  options: FitOptions,
): Outline | null {
  if (fit.shapes && samples) {
    const circle = detectCircle(samples, options)
    if (circle) return { kind: 'circle', ...circle }
  }
  const curves = samples ? fitContour(contour, options, samples) : fitContour(contour, options)
  return curves.length ? { kind: 'curves', curves } : null
}

export function fitLayer(contours: readonly (readonly Seg[])[], fit: TraceSpec['fit']): LayerTrace {
  const options: FitOptions = { tolMax: fit.smooth, sigma: fit.denoise }
  // Circles and repeats are both judged on the traced outline's own samples, not the fit.
  const sampled = fit.shapes || fit.repeats
  const outlines: Outline[] = []
  const samples: Vec[][] = []
  for (const contour of contours) {
    const P = sampled ? dense(contour) : null
    const outline = fitOutline(contour, P, fit, options)
    if (!outline) continue
    outlines.push(outline)
    if (P) samples.push(P)
  }

  const repeats = fit.repeats ? snapRepeats(samples, outlines) : 0
  const d = outlinePath(outlines)
  return {
    d,
    outlines: outlines.length,
    nodes: nodeCount(d),
    circles: outlines.filter((o) => o.kind === 'circle').length,
    repeats,
  }
}
