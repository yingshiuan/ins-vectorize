/**
 * The tracer.
 *
 * esm-potrace-wasm is Peter Selinger's potrace 1.16 compiled to WebAssembly — the
 * same program logo_svg.py shells out to, so what comes back here is
 * what comes back there.
 *
 * ⚠️ potrace is GPL-2.0 and so is this module's dependency. Fine for a local tool
 * or an open-source one; it does mean the app cannot ship closed-source.
 *
 * Asked for its full SVG rather than bare path data, because the document carries
 * the `translate(...) scale(...)` that maps potrace's tenths-of-a-pixel back onto
 * the bitmap. logo_svg.py:224 reads the same transform for the same reason.
 */
import { init, potrace } from 'esm-potrace-wasm'
import type { Bitmap } from './ink'
import { pathData, parsePath, parseTransform, toSource } from './parse'
import type { Seg, Vec } from './vec'

let ready: Promise<void> | null = null

/** The wasm module, initialised once per page. */
export function warmUp(): Promise<void> {
  ready ??= init()
  return ready
}

/** A 0/255 mask as the black-on-white image potrace expects. */
export function toImageData(bitmap: Bitmap): ImageData {
  const { width, height, data } = bitmap
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0, j = 0; j < data.length; i += 4, j++) {
    // Ink is black, because potrace traces the dark pixels.
    const v = data[j] >= 128 ? 0 : 255
    rgba[i] = v
    rgba[i + 1] = v
    rgba[i + 2] = v
    rgba[i + 3] = 255
  }
  return new ImageData(rgba, width, height)
}

export interface TraceOptions {
  /** potrace's turdsize, in pixels of the enlarged bitmap. */
  despeckle: number
  /** The factor `prepare` enlarged by, divided back out of the result. */
  upscale: number
  /** Where the bitmap's top-left sat on the canvas, in canvas px, when it is only part of it. */
  origin?: Vec
}

/** Outlines of the ink in `bitmap`, in source pixels. */
export async function traceBitmap(bitmap: Bitmap, { despeckle, upscale, origin }: TraceOptions): Promise<Seg[][]> {
  await warmUp()
  const svg = (await potrace(toImageData(bitmap), {
    turdsize: despeckle,
    turnpolicy: 4,
    alphamax: 1,
    opticurve: 1,
    opttolerance: 0.2,
    pathonly: false,
    extractcolors: false,
  })) as string

  const transform = parseTransform(svg)
  const contours = pathData(svg).flatMap(parsePath)
  return toSource(contours, transform, upscale, origin)
}
