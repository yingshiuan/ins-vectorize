/**
 * Where a point on screen lands in the source image.
 *
 * Split out of the preview and kept pure for one reason: every fault found in the
 * comparison view so far has been a coordinate composition error — a box centred
 * against the wrong origin, a bitmap stretched over a padded canvas — and each one
 * compiled perfectly and could only be caught by looking at it. This is the same
 * shape of arithmetic, so it is tested rather than eyeballed.
 */

export interface View {
  /** The preview surface's box on screen. */
  rect: { left: number; top: number; width: number; height: number }
  /** Offset applied to the stage, in screen px. */
  pan: { x: number; y: number }
  /** Screen px per stage unit. */
  scale: number
  /** The stage: the traced canvas, which is the source plus padding on every side. */
  width: number
  height: number
  /** Margin the trace added on each side, in stage units. */
  padX: number
  padY: number
  /** The source bitmap's own size. */
  sourceWidth: number
  sourceHeight: number
}

/**
 * The integer source pixel under a client point, or null when the point misses the
 * image — either outside its bounds, or with no usable scale.
 */
export function sourcePixel(clientX: number, clientY: number, v: View): { x: number; y: number } | null {
  if (!(v.scale > 0)) return null

  // The stage is centred on the surface and scaled about its own centre, so undo the
  // pan and the zoom relative to that centre...
  const dx = (clientX - v.rect.left - v.rect.width / 2 - v.pan.x) / v.scale
  const dy = (clientY - v.rect.top - v.rect.height / 2 - v.pan.y) / v.scale

  // ...then step out from the stage's centre to its top-left, and past the margin.
  const x = Math.floor(v.width / 2 + dx - v.padX)
  const y = Math.floor(v.height / 2 + dy - v.padY)

  if (x < 0 || y < 0 || x >= v.sourceWidth || y >= v.sourceHeight) return null
  return { x, y }
}
