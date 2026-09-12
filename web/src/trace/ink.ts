/**
 * Separating artwork from its background.
 *
 * This is both the app's "remove background" and the first step of every trace,
 * because they are the same operation: decide, per pixel, how much of it is ink.
 *
 * Generalised from logo_svg.py:241 `solid_logo`, which asks how *red*
 * each pixel is and so drops the white page and the halo around the artwork in one
 * pass. Here "red" becomes "far from whatever colour the border is", measured in
 * Oklab — see oklab.ts for why not plain RGB.
 *
 * No neural net. For flat artwork this is exact rather than predicted, and it
 * finishes before a model would have finished loading.
 */
import { tally } from './census'
import { labDistance, rgbToOklab } from './oklab'

/** A single-channel image: one byte of coverage per pixel. */
export interface Bitmap {
  width: number
  height: number
  data: Uint8ClampedArray
}

/**
 * RGBA bytes and a size.
 *
 * Structural rather than `ImageData` so this module can be tested: node has no
 * ImageData, and colour detection that cannot be tested is colour detection that
 * quietly drifts. Browser `ImageData` satisfies it unchanged.
 */
export interface Pixels {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * The background colour, read off the border.
 *
 * The median rather than the mean: artwork that runs off the edge of the frame
 * pulls a mean towards itself, and a median simply ignores it as long as most of
 * the border really is background.
 */
export function detectBackground(img: Pixels, ring = 2): Rgb {
  const { width: w, height: h, data } = img
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 4
    // A transparent border pixel says nothing about the background colour.
    if (data[i + 3] < 8) return
    rs.push(data[i])
    gs.push(data[i + 1])
    bs.push(data[i + 2])
  }
  for (let x = 0; x < w; x++) {
    for (let d = 0; d < ring; d++) {
      take(x, d)
      take(x, h - 1 - d)
    }
  }
  for (let y = 0; y < h; y++) {
    for (let d = 0; d < ring; d++) {
      take(d, y)
      take(w - 1 - d, y)
    }
  }
  if (rs.length === 0) return { r: 255, g: 255, b: 255 }
  const mid = (v: number[]) => {
    v.sort((a, b) => a - b)
    return v[v.length >> 1]
  }
  return { r: mid(rs), g: mid(gs), b: mid(bs) }
}

export interface InkOptions {
  /** Oklab distance at which a pixel stops being background. */
  tolerance: number
  /** Width of the fade above that distance. */
  softness: number
  /** null = detect from the border. */
  background?: Rgb | null
  /** false keeps every opaque pixel, letting the source alpha alone decide. */
  remove?: boolean
}

/**
 * How much of each pixel is ink, 0-255.
 *
 * The source's own alpha is multiplied in, so a PNG that already has a cut-out
 * background keeps it, and a JPEG (which cannot) relies entirely on the colour
 * distance.
 */
export function inkMask(img: Pixels, opts: InkOptions): { mask: Bitmap; background: Rgb } {
  const { width, height, data } = img
  const background = opts.background ?? detectBackground(img)
  const mask = new Uint8ClampedArray(width * height)

  if (opts.remove === false) {
    for (let i = 0, j = 0; j < mask.length; i += 4, j++) mask[j] = data[i + 3]
    return { mask: { width, height, data: mask }, background }
  }

  const bg = rgbToOklab(background.r, background.g, background.b)
  const lo = opts.tolerance
  const hi = opts.tolerance + Math.max(opts.softness, 1e-6)

  // Colours repeat heavily in flat artwork, so the Oklab conversion is worth caching.
  const seen = new Map<number, number>()
  for (let i = 0, j = 0; j < mask.length; i += 4, j++) {
    const a = data[i + 3]
    if (a === 0) {
      mask[j] = 0
      continue
    }
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
    let ramp = seen.get(key)
    if (ramp === undefined) {
      const d = labDistance(rgbToOklab(data[i], data[i + 1], data[i + 2]), bg)
      ramp = d <= lo ? 0 : d >= hi ? 255 : ((d - lo) / (hi - lo)) * 255
      seen.set(key, ramp)
    }
    mask[j] = (ramp * a) / 255
  }

  solidify(img, mask, width, height)
  return { mask: { width, height, data: mask }, background }
}

/**
 * Local colour spread a pixel may have and still count as interior to a flat region.
 *
 * Measured on flat artwork: interiors hold 0-13 even with sensor noise, edges 40-56.
 * A "must be perfectly uniform" test would be right on synthetic input and wrong on
 * every JPEG.
 */
const FLAT = 24

/**
 * Give solid artwork full coverage even when its colour resembles the page.
 *
 * The ramp above measures distance from the background, and that number carries two
 * different meanings. For a rim pixel it is right: the pixel genuinely *is* part ink
 * over page, and the fraction is the sub-pixel edge `prepare` exists to recover. For a
 * solid pale pixel it is wrong: the pixel is entirely ink and merely looks like the
 * page. Measured, a light grey on white lands at 116 — under the 128 `prepare`
 * thresholds at — so it disappeared from the artwork altogether, in single-colour mode
 * as much as multi-colour. That is the bug where colours only appeared once background
 * removal was switched off.
 *
 * Colour alone cannot tell those two apart. The neighbourhood can: a pixel surrounded
 * by its own colour is interior to a region, whatever its distance from the page. The
 * page itself is never at risk, because it is the reference colour and so sits at
 * coverage 0 — this only ever promotes pixels the ramp already called ink.
 */
function solidify(img: Pixels, mask: Uint8ClampedArray, width: number, height: number) {
  const src = img.data
  // Read from the original throughout, so one promotion cannot cascade into the next.
  const out = mask.slice()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const j = y * width + x
      const v = mask[j]
      if (v === 0 || v === 255) continue

      let spread = 0
      for (let c = 0; c < 3; c++) {
        let lo = 255
        let hi = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy < 0 ? 0 : y + dy >= height ? height - 1 : y + dy
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx < 0 ? 0 : x + dx >= width ? width - 1 : x + dx
            const s = src[(yy * width + xx) * 4 + c]
            if (s < lo) lo = s
            if (s > hi) hi = s
          }
        }
        if (hi - lo > spread) spread = hi - lo
      }
      if (spread < FLAT) out[j] = 255
    }
  }
  mask.set(out)
}

/**
 * The dominant ink colour, or null if the mask found no artwork.
 *
 * Mode first, then median within the winning cluster. A global median would split the
 * difference between two inks and return a colour that appears nowhere in the image —
 * purple, for a red-and-blue logo. Bucketing first picks a real ink; the median inside
 * the winning bucket then recovers its exact value rather than a rounded centre.
 *
 * Edge pixels are excluded by coverage, since a red logo's edges are every shade
 * between red and the page. If nothing is solid enough — very fine line art — the
 * threshold steps down rather than giving up.
 *
 * The histogram itself lives in `census.ts`, because the same counting answers both
 * "which ink" and "how many inks" and two copies of it would drift.
 */
export function detectInk(img: Pixels, mask: Bitmap): Rgb | null {
  return tally(img, mask)?.inks[0].color ?? null
}

/** `#rrggbb` to bytes. */
export function parseHex(hex: string): Rgb {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

/** Bytes to `#rrggbb`. */
export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}
