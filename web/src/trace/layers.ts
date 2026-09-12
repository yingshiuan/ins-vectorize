/**
 * One coverage map per ink, stacked back to front.
 *
 * Three things here are easy to get subtly wrong, and each was got wrong first:
 *
 * **Sum, not union.** Each layer carries every layer painted after it, so the upper
 * ones cover the joins and no hairline can open between two inks. But the carrying has
 * to be arithmetic, not `max`: a pixel split evenly between two inks yields 127 under
 * `max`, which fails `prepare`'s >= 128 threshold and punches a one-pixel hole along
 * every internal boundary. Because the memberships sum to the pixel's own coverage,
 * `layers[0].mask` comes out **byte-identical to the input mask** — the bottom layer of
 * a multi-colour trace is exactly today's single-colour trace, so multi-colour can
 * never lose the silhouette.
 *
 * **Assign by distance to the [ink -> background] segment, not to the nearest ink.** A
 * half-covered rim pixel is a blend of its ink and the page, so it lies *on* that
 * segment. Nearest-ink would instead hand it to whichever accent happens to sit near
 * that blend, painting a one-pixel fringe of the wrong colour around every edge. The
 * metric is self-consistent with how inks were chosen in the first place: an ink only
 * qualifies as distinct *because* it sits off that axis (see `census.ts`), so no
 * surviving ink can be mistaken for a blend of the dominant ink and the page.
 *
 * **Split softly between the two nearest inks.** Hard assignment puts a binary step on
 * every ink-to-ink boundary — the pixel-grid staircase `prepare.ts` exists to avoid,
 * reintroduced on exactly the edges multi-colour adds. Deep inside a flat region the
 * split degenerates to the hard case for free.
 *
 * Note that `census.tally` only lets *solid* pixels vote on what the inks are, while
 * this assigns *every* covered pixel. That looks inconsistent and is deliberate:
 * deciding what the inks are and deciding who owns a rim pixel are different questions.
 */
import { MERGE, perpendicular } from './census'
import type { Bitmap, Pixels, Rgb } from './ink'
import { rgbToOklab, type Lab } from './oklab'

export interface ColorLayer {
  color: Rgb
  /** Coverage 0-255 in source-pixel space, ready for `prepare`. */
  mask: Bitmap
  /** Pixels this ink owns outright — for the UI, and for spotting inks about to vanish. */
  count: number
  /** False when the ink is switched off; its mask is empty and it should not be traced. */
  visible: boolean
}

/**
 * Split one ink mask into a stack, one layer per ink, bottom first.
 *
 * `inks` must already be ordered as they will be painted — largest first, so the
 * dominant ink owns the silhouette. With a single ink this returns that mask unchanged.
 */
export function splitLayers(
  img: Pixels,
  mask: Bitmap,
  inks: readonly Rgb[],
  background: Rgb,
  visible?: readonly boolean[],
): ColorLayer[] {
  const n = inks.length
  const size = mask.data.length
  const shown = (k: number) => visible?.[k] !== false
  if (n === 0) return []
  if (n === 1) {
    const only = shown(0)
    return [
      {
        color: inks[0],
        mask: only ? mask : { width: mask.width, height: mask.height, data: new Uint8ClampedArray(size) },
        count: countSolid(mask.data),
        visible: only,
      },
    ]
  }

  const labs = inks.map((c) => rgbToOklab(c.r, c.g, c.b))
  const bg = rgbToOklab(background.r, background.g, background.b)

  // Fractions rather than bytes: two halves of 255 must sum back to 255 exactly, or
  // the layers[0] === mask guarantee is lost to rounding.
  const owns = Array.from({ length: n }, () => new Float64Array(size))

  // Flat artwork repeats colours heavily, so the Oklab conversion and the choice of
  // owners are worth caching per distinct RGB.
  const seen = new Map<number, { k1: number; k2: number; t: number }>()

  for (let i = 0, j = 0; j < size; i += 4, j++) {
    const a = mask.data[j]
    if (a === 0) continue

    const key = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]
    let pick = seen.get(key)
    if (pick === undefined) {
      const p = rgbToOklab(img.data[i], img.data[i + 1], img.data[i + 2])

      // The two inks whose [ink -> background] segments this colour sits closest to.
      let k1 = 0
      let k2 = -1
      let d1 = Infinity
      let d2 = Infinity
      for (let k = 0; k < n; k++) {
        const d = perpendicular(p, labs[k], bg)
        if (d < d1) {
          k2 = k1
          d2 = d1
          k1 = k
          d1 = d
        } else if (d < d2) {
          k2 = k
          d2 = d
        }
      }

      // Share a pixel only when its own ink cannot account for it.
      //
      // A rim pixel *is* its ink blended with the page, so it lies on that segment and
      // d1 is ~0. Giving a slice of it to some far-off ink is a leak, harmless today
      // only because `prepare` thresholds the sliver away — luck, not design. A pixel
      // where two inks meet lies on neither segment, so its d1 is substantial.
      //
      // Measured, red and blue over white: rim pixels hold d1 0.008-0.016 at every
      // coverage; boundary pixels 0.031-0.271 at every mix. d1 separates them with a
      // gap. The distance *between* d1 and d2 does not — both populations span roughly
      // 0.02 to 0.25 there, so no threshold on it could work, including the one that
      // was here before.
      const shared = k2 >= 0 && d1 > MERGE
      pick = { k1, k2: shared ? k2 : -1, t: shared ? along(p, labs[k1], labs[k2]) : 0 }
      seen.set(key, pick)
    }

    if (pick.k2 < 0 || pick.t <= 0) {
      owns[pick.k1][j] += a
    } else {
      owns[pick.k1][j] += a * (1 - pick.t)
      owns[pick.k2][j] += a * pick.t
    }
  }

  // Back to front: each layer is its own coverage plus everything painted above it.
  //
  // A hidden ink is withheld from the accumulator entirely, not merely left undrawn.
  // Skipping only the drawing would leave the layers *below* still carrying its pixels,
  // so switching a colour off would reveal the colour underneath instead of leaving a
  // hole — which is not what switching a layer off means anywhere else.
  const layers: ColorLayer[] = new Array(n)
  const acc = new Float64Array(size)
  for (let k = n - 1; k >= 0; k--) {
    const own = owns[k]
    const show = shown(k)
    if (show) for (let j = 0; j < size; j++) acc[j] += own[j]
    layers[k] = {
      color: inks[k],
      mask: {
        width: mask.width,
        height: mask.height,
        data: show ? Uint8ClampedArray.from(acc) : new Uint8ClampedArray(size),
      },
      count: countOwned(own),
      visible: show,
    }
  }
  return layers
}

/** How far along the line from `a` to `b` the colour `p` sits, clamped to the ends. */
function along(p: Lab, a: Lab, b: Lab): number {
  const x = b[0] - a[0]
  const y = b[1] - a[1]
  const z = b[2] - a[2]
  const len2 = x * x + y * y + z * z
  if (len2 <= 0) return 0
  const t = ((p[0] - a[0]) * x + (p[1] - a[1]) * y + (p[2] - a[2]) * z) / len2
  return t < 0 ? 0 : t > 1 ? 1 : t
}

const countSolid = (data: Uint8ClampedArray): number => {
  let n = 0
  for (let j = 0; j < data.length; j++) if (data[j] >= 128) n++
  return n
}

const countOwned = (own: Float64Array): number => {
  let n = 0
  for (let j = 0; j < own.length; j++) if (own[j] >= 128) n++
  return n
}

/**
 * Total coverage of the layers still showing — the alpha a cut-out should carry.
 *
 * The lowest visible layer already *is* that total. Every layer carries the ones
 * painted above it, so the bottom-most one still showing holds the sum of all of them;
 * nothing has to be recomputed and no second pass can disagree with the first.
 *
 * With nothing hidden the answer is the mask the split was given, and that is returned
 * rather than `layers[0].mask`: the two are equal by construction (see the note at the
 * top) but one of them is a rounded copy, and the PNG export should not shift by a
 * count in the last place because a colour panel was opened.
 */
export function visibleCoverage(layers: readonly ColorLayer[], mask: Bitmap): Bitmap {
  if (layers.every((l) => l.visible)) return mask
  const lowest = layers.find((l) => l.visible)
  if (lowest) return lowest.mask
  return { width: mask.width, height: mask.height, data: new Uint8ClampedArray(mask.data.length) }
}
