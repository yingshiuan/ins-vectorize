/**
 * One coverage map to the outlines potrace finds in it.
 *
 * Lifted out of `pipeline.ts` so that tracing N layers is a loop rather than a second code
 * path. Single-colour artwork is simply the one-layer case. The fitting that follows lives
 * in `fitlayer.ts`, away from potrace, so that it can be cached and tested on its own.
 *
 * Coordinates come back in the padded canvas's space.
 */
import { anchor, cropMargin, cropPadded, faintBelow, inkBounds } from './crop'
import type { Bitmap } from './ink'
import { traceBitmap } from './potrace'
import { prepare } from './prepare'
import { PAD, type TraceSpec } from './spec'
import type { Seg } from './vec'

/**
 * A layer's outlines, in padded-canvas px.
 *
 * Prepared from a crop around the layer's own ink rather than from the whole canvas, then
 * anchored back in place for potrace — see crop.ts for why that changes the cost and
 * nothing else, and why the anchoring is not optional. `crop: false` keeps the
 * full-canvas route, so the selftest can hold the two against each other.
 */
export async function layerContours(
  mask: Bitmap,
  trace: TraceSpec['trace'],
  { crop = true }: { crop?: boolean } = {},
): Promise<Seg[][]> {
  const { blur, upscale, despeckle } = trace
  const box = inkBounds(mask, faintBelow(upscale))
  // Nothing strong enough to set a pixel: potrace would scan a blank canvas and find nothing.
  if (!box) return []

  if (!crop) return traceBitmap(prepare(mask, { blur, upscale, pad: PAD }), { despeckle, upscale })

  const { bitmap, x, y } = cropPadded(mask, PAD, box, cropMargin(blur, upscale))
  const part = prepare(bitmap, { blur, upscale, pad: 0 })
  const canvasHeight = mask.height + 2 * PAD
  const placed = anchor(part, x * upscale, (canvasHeight - y) * upscale)
  // Anchored at the left edge, so only the vertical offset remains to be added back.
  return traceBitmap(placed, { despeckle, upscale, origin: [0, y] })
}
