/**
 * Preparing only the part of a layer that has ink in it.
 *
 * `prepare` blurs and enlarges the whole canvas 16x, and that is where a trace's time
 * goes — 461 of 790 ms on the reference wordmark — so a small accent used to cost as much as
 * the silhouette. Cropping each layer to its own ink first makes that cost follow the
 * artwork instead of the frame.
 *
 * The crop is only worth having if it is invisible, and for `prepare` it is exactly so:
 * the prepared crop is byte-identical to the same window of the uncropped result, and that
 * result is empty everywhere else. Two things make that true.
 *
 * - **The box leaves out coverage too faint to set a pixel.** Blur is an average, so it
 *   never lifts a pixel above its brightest neighbour; the Lanczos upscale overshoots, but
 *   by at most `upscaleGain`. Coverage below 127 / gain therefore stays under the 128
 *   `prepare` thresholds at, whatever surrounds it. It has to be left out, not merely
 *   tolerated: soft colour splits scatter exactly such slivers across a layer — measured
 *   on the reference wordmark with a small blue accent added, 3,467 pixels of coverage 1–29
 *   spread over the whole word — and counting them stretched the accent's box across it.
 * - **The margin is twice a result pixel's reach, plus one.** A result pixel reads mask
 *   pixels up to `blurRadius` + 3 (Lanczos-3) away. One whose reach crosses the crop's
 *   edge is then more than a reach from the box, so everything it reads is faint and it
 *   comes out empty, cropped or not. One whose reach stays inside the crop reads exactly
 *   the same pixels either way. `blur` and `upscale` clamp at an edge rather than wrap,
 *   and at the crop's edge that repeats a faint pixel in place of a faint pixel.
 *
 * **potrace is not given the crop, though.** Its arithmetic is not translation-invariant:
 * it works in absolute bitmap coordinates, and moving the same pixels flips borderline
 * curve decisions. Measured on the ring fixture, handing potrace the identical prepared
 * pixels with 32 px or less to their left traced a different hole than the full canvas
 * did; 40 px or more, the same; 256 px of extra border all round, different again.
 * Tightening the right, top or bottom edge alone changed nothing. So `anchor` puts the
 * prepared crop back where it came from, in a bitmap that keeps the canvas's left edge
 * and its bottom one — potrace measures y from the bottom — and drops only the empty space
 * to the right and above. potrace then sees the same coordinates it always did.
 *
 * `crop.test.ts` holds the `prepare` identity over a grid of blurs, factors and
 * placements; the selftest holds the traced result to the uncropped one.
 */
import type { Bitmap } from './ink'
import { blurRadius, upscaleGain } from './prepare'

/** A pixel box, `x1` and `y1` exclusive. */
export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** How far `upscale` reads either side of an output pixel's base, in source px. */
const LANCZOS_REACH = 3

/** Coverage at least this strong may set a prepared pixel; anything below it cannot, on its own. */
export function faintBelow(upscale: number): number {
  return Math.floor(127 / upscaleGain(upscale))
}

/** The smallest box holding every pixel with at least `below` coverage, or null if there are none. */
export function inkBounds(mask: Bitmap, below = 1): Box | null {
  const { width, height, data } = mask
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (data[row + x] < below) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      y1 = y
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

/** Margin around the ink, in source px, beyond which cropping cannot change the result. See the note at the top. */
export function cropMargin(blur: number, upscale: number): number {
  const reach = blurRadius(blur) + (upscale > 1 ? LANCZOS_REACH : 0)
  return 2 * reach + 1
}

/**
 * The padded canvas `prepare` would build, cut down to `box` grown by `margin`.
 *
 * Built directly rather than by padding and then slicing, so the full-size canvas is
 * never allocated. `x`, `y` is the crop's origin on the padded canvas — what has to be
 * added back to anything traced from it.
 */
export function cropPadded(
  mask: Bitmap,
  pad: number,
  box: Box,
  margin: number,
): { bitmap: Bitmap; x: number; y: number } {
  const x0 = Math.max(0, box.x0 + pad - margin)
  const y0 = Math.max(0, box.y0 + pad - margin)
  const x1 = Math.min(mask.width + 2 * pad, box.x1 + pad + margin)
  const y1 = Math.min(mask.height + 2 * pad, box.y1 + pad + margin)
  const width = x1 - x0
  const height = y1 - y0
  const data = new Uint8ClampedArray(width * height)

  // The source columns that land inside the crop; the rest of it is padding, already zero.
  const sx0 = Math.max(0, x0 - pad)
  const sx1 = Math.min(mask.width, x1 - pad)
  if (sx1 > sx0) {
    for (let y = y0; y < y1; y++) {
      const sy = y - pad
      if (sy < 0 || sy >= mask.height) continue
      const from = sy * mask.width
      data.set(mask.data.subarray(from + sx0, from + sx1), (y - y0) * width + (sx0 + pad - x0))
    }
  }
  return { bitmap: { width, height, data }, x: x0, y: y0 }
}

/**
 * A prepared crop put back at its place, for potrace. See the note at the top.
 *
 * `left` is the crop's distance from the canvas's left edge and `height` its distance
 * from the top of the crop to the canvas's bottom edge, both in prepared px. The result
 * keeps those two edges where the full canvas has them and is empty apart from the crop.
 */
export function anchor(part: Bitmap, left: number, height: number): Bitmap {
  const width = left + part.width
  const data = new Uint8ClampedArray(width * height)
  for (let r = 0; r < part.height; r++) {
    data.set(part.data.subarray(r * part.width, (r + 1) * part.width), r * width + left)
  }
  return { width, height, data }
}
