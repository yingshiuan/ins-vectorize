/**
 * What colours an image is actually made of.
 *
 * This owns the colour histogram. `ink.ts` asks it for the dominant ink, the UI asks
 * it how many inks there are, and multi-colour tracing asks it for the palette — one
 * implementation, so the three answers cannot drift apart.
 *
 * Every threshold below was measured over real logo artwork and real photographs.
 * They are not taste. Re-run that comparison before changing any of them.
 *
 * Types come from `ink.ts` and values go back to it; `verbatimModuleSyntax` erases
 * `import type`, so this direction leaves no runtime cycle. The reverse would.
 */
import { labDistance, rgbToOklab, type Lab } from './oklab'
import type { Bitmap, Pixels, Rgb } from './ink'

/** Coarseness of the colour buckets, per channel. Moved here from ink.ts. */
export const BUCKET = 16

/** Coverage a pixel needs before it may vote, stepped down for artwork too fine to have solid pixels. */
export const SOLID = [200, 128, 40]

/**
 * Oklab radius within which two buckets are the same ink.
 *
 * A flat colour sitting near a bucket boundary splits across buckets, so raw bins
 * over-report. Measured: 0.02 collapses those splits (a seal reading 3 clusters
 * becomes 1, top share 89.8% -> 98.0%). Larger is worse, not better — at 0.1 a
 * photograph reaches 50.4% top share and starts impersonating flat artwork.
 */
export const MERGE = 0.02

/**
 * How far off the [dominant ink -> background] axis a cluster must sit to be a real
 * second ink. Measured: real inks 0.164-0.323, blur smears 0.005-0.016. 0.05 is 3x
 * above the worst smear and 3.3x below the weakest real ink.
 */
export const PERP_MIN = 0.05

/**
 * ...and how far from the dominant ink. Measured: real inks 0.284-0.673, and a
 * compression-noise cluster in the reference wordmark at 0.027. 0.10 is 3.7x above that
 * false positive and 2.8x below the weakest real ink.
 */
export const DIST_MIN = 0.1

/**
 * A cluster this solid is a region, not a smear.
 *
 * Geometry alone is not enough: black plus mid-grey on white puts a *genuine* ink
 * exactly on the black->white line, perp 0.000, indistinguishable from a blur. But a
 * flat region is solid and a smear is a thin band hugging an edge. Measured: real
 * inks 98.2% interior, smears 0.0-1.1%.
 */
export const INTERIOR_MIN = 0.5

/** Below this share of the ink a cluster is noise whatever its geometry. */
export const NOISE_FLOOR = 0.001

/** Most inks reported. Beyond this the answer is "lots", which is a different answer. */
export const MAX_INKS = 8

/**
 * Below this top share, with at least this many clusters, the image is a photograph.
 *
 * Unlike the thresholds above this one is *chosen between* the measured populations
 * rather than measured: flat artwork holds 0.914-0.980 in its top cluster, photographs
 * 0.024-0.100. Anywhere in the wide gap works; 0.35 is the middle of it.
 */
export const PHOTO_SHARE = 0.35
export const PHOTO_CLUSTERS = 12

export const bucketOf = (r: number, g: number, b: number): number =>
  (((r / BUCKET) | 0) << 16) | (((g / BUCKET) | 0) << 8) | ((b / BUCKET) | 0)

/** The colour at the centre of a bucket — its seed, used only for merging. */
function bucketLab(key: number): Lab {
  const half = BUCKET / 2
  return rgbToOklab((((key >> 16) & 0xff) * BUCKET) + half, (((key >> 8) & 0xff) * BUCKET) + half, ((key & 0xff) * BUCKET) + half)
}

/** Distance from `p` to the segment `a`-`b`, clamped at both ends rather than extending the line. */
export function perpendicular(p: Lab, a: Lab, b: Lab): number {
  const ax = b[0] - a[0]
  const ay = b[1] - a[1]
  const az = b[2] - a[2]
  const len2 = ax * ax + ay * ay + az * az
  if (len2 <= 0) return labDistance(p, a)
  const raw = ((p[0] - a[0]) * ax + (p[1] - a[1]) * ay + (p[2] - a[2]) * az) / len2
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw
  return labDistance(p, [a[0] + t * ax, a[1] + t * ay, a[2] + t * az])
}

export interface InkTally {
  /** Median of the cluster's largest bucket: a colour that is genuinely in the image. */
  color: Rgb
  lab: Lab
  count: number
  /** Of the ink pixels that voted, not of the canvas. */
  share: number
}

export interface Tally {
  inks: InkTally[]
  /** Ink pixels that voted. */
  counted: number
  /** Coverage floor those votes needed. */
  floor: number
  /** Merged clusters found, including any past MAX_INKS that were not returned. */
  clusters: number
  /** Cluster index per pixel, -1 where the pixel did not vote or fell past MAX_INKS. */
  assignment: Int32Array
}

const median = (v: number[]): number => {
  v.sort((a, b) => a - b)
  // The upper median, matching what detectInk has always returned.
  return v[v.length >> 1]
}

/**
 * Ink pixels bucketed and merged, ranked by how much of the artwork they cover.
 *
 * Only solid pixels vote, because a red logo's rim runs through every shade between
 * red and the page and those shades are not inks. Note that `splitLayers` later
 * assigns *every* covered pixel — deciding what the inks are and deciding which ink
 * owns a rim pixel are deliberately different populations.
 */
export function tally(img: Pixels, mask: Bitmap, merge = MERGE): Tally | null {
  for (const floor of SOLID) {
    const counts = new Map<number, number>()
    for (let i = 0, j = 0; j < mask.data.length; i += 4, j++) {
      if (mask.data[j] < floor) continue
      const key = bucketOf(img.data[i], img.data[i + 1], img.data[i + 2])
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    if (counts.size === 0) continue

    // Biggest bucket first, ties broken on the key, so the merge is deterministic.
    const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])

    // Merge against each cluster's fixed seed, never a running centroid: a chain of
    // buckets each just inside the radius would otherwise walk a centroid across the
    // gamut and swallow genuinely different colours.
    const clusters: { seed: number; lab: Lab; count: number }[] = []
    const owner = new Map<number, number>()
    for (const [key, n] of ordered) {
      const lab = bucketLab(key)
      let found = -1
      for (let c = 0; c < clusters.length; c++) {
        if (labDistance(clusters[c].lab, lab) <= merge) {
          found = c
          break
        }
      }
      if (found < 0) {
        found = clusters.length
        clusters.push({ seed: key, lab, count: 0 })
      }
      clusters[found].count += n
      owner.set(key, found)
    }

    // Merging can reorder the ranking — that reordering is the point.
    const rank = clusters.map((_, i) => i).sort((a, b) => {
      const d = clusters[b].count - clusters[a].count
      if (d !== 0) return d
      const x = clusters[a].lab
      const y = clusters[b].lab
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
    })
    const place = new Map<number, number>()
    rank.forEach((from, to) => place.set(from, to))

    const kept = Math.min(rank.length, MAX_INKS)
    const counted = [...counts.values()].reduce((a, b) => a + b, 0)

    // Collect channel values for the seed buckets alone. Collecting for every bucket
    // is what makes a naive implementation die on a photograph.
    const seeds = new Map<number, number>()
    for (let i = 0; i < kept; i++) seeds.set(clusters[rank[i]].seed, i)

    const chans: number[][][] = Array.from({ length: kept }, () => [[], [], []])
    const assignment = new Int32Array(mask.data.length).fill(-1)
    for (let i = 0, j = 0; j < mask.data.length; i += 4, j++) {
      if (mask.data[j] < floor) continue
      const key = bucketOf(img.data[i], img.data[i + 1], img.data[i + 2])
      const slot = place.get(owner.get(key)!)!
      if (slot < kept) assignment[j] = slot
      const seed = seeds.get(key)
      if (seed === undefined) continue
      chans[seed][0].push(img.data[i])
      chans[seed][1].push(img.data[i + 1])
      chans[seed][2].push(img.data[i + 2])
    }

    const inks: InkTally[] = []
    for (let i = 0; i < kept; i++) {
      const c = clusters[rank[i]]
      const color: Rgb = { r: median(chans[i][0]), g: median(chans[i][1]), b: median(chans[i][2]) }
      inks.push({ color, lab: rgbToOklab(color.r, color.g, color.b), count: c.count, share: c.count / counted })
    }
    return { inks, counted, floor, clusters: clusters.length, assignment }
  }
  return null
}

export interface Ink extends InkTally {
  /** Distance from the segment [dominant ink -> background]. */
  perp: number
  /** Distance from the dominant ink. */
  d1: number
  /** Share of this ink's pixels whose four neighbours are the same ink. */
  interior: number
  distinct: boolean
}

export type Verdict = 'single' | 'multi' | 'photographic'

export interface Census {
  /** Up to MAX_INKS merged clusters, largest first. */
  inks: Ink[]
  /** The subset that are real inks. Always contains inks[0]. */
  distinct: Ink[]
  verdict: Verdict
  background: Rgb
  counted: number
  floor: number
  /** Merged clusters found, including any past MAX_INKS. */
  clusters: number
  /** Cluster index per pixel, -1 where the pixel did not vote. */
  assignment: Int32Array
}

/** How solid each cluster is: the share of its pixels entirely surrounded by itself. */
function interiors(assignment: Int32Array, width: number, height: number, n: number): number[] {
  const inside = new Array<number>(n).fill(0)
  const total = new Array<number>(n).fill(0)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const j = y * width + x
      const c = assignment[j]
      if (c < 0) continue
      total[c]++
      if (
        assignment[j - 1] === c &&
        assignment[j + 1] === c &&
        assignment[j - width] === c &&
        assignment[j + width] === c
      ) {
        inside[c]++
      }
    }
  }
  return inside.map((v, i) => (total[i] > 0 ? v / total[i] : 0))
}

/**
 * The palette, judged against the background: which clusters are separate inks.
 *
 * A cluster is a distinct ink iff it is far enough from the dominant ink AND either
 * sits off the ink-to-background axis OR is solid enough to be a region. Both arms of
 * that OR earn their place, for opposite reasons: a thin stroke in a second colour has
 * low interior by nature and is caught by `perp`; a flat colour lying on the axis has
 * zero perp and is caught by `interior`.
 */
export function census(img: Pixels, mask: Bitmap, background: Rgb, limit = MAX_INKS): Census | null {
  const counted = tally(img, mask)
  if (!counted) return null

  const bg = rgbToOklab(background.r, background.g, background.b)
  const top = counted.inks[0].lab
  const solid = interiors(counted.assignment, mask.width, mask.height, counted.inks.length)

  const inks: Ink[] = counted.inks.map((ink, i) => {
    const d1 = labDistance(ink.lab, top)
    const perp = perpendicular(ink.lab, top, bg)
    const interior = solid[i]
    // Index 0 defines the axis, so its own perp and d1 are 0 by construction.
    const distinct =
      i === 0 ||
      (ink.share >= NOISE_FLOOR && d1 >= DIST_MIN && (perp >= PERP_MIN || interior >= INTERIOR_MIN))
    return { ...ink, d1, perp, interior, distinct }
  })

  const distinct = inks.filter((i) => i.distinct).slice(0, Math.max(1, limit))

  // Photographic is tested first: a photograph also has genuinely off-axis clusters
  // and would otherwise be reported as multi-colour with a full palette.
  const verdict: Verdict =
    counted.inks[0].share < PHOTO_SHARE && counted.clusters >= PHOTO_CLUSTERS
      ? 'photographic'
      : distinct.length > 1
        ? 'multi'
        : 'single'

  return {
    inks,
    distinct,
    verdict,
    background,
    counted: counted.counted,
    floor: counted.floor,
    clusters: counted.clusters,
    assignment: counted.assignment,
  }
}

/** What the page is shown of a census: everything but the per-pixel working. */
export type CensusSummary = Omit<Census, 'assignment'>

/**
 * A census without `assignment`.
 *
 * That is one Int32 per pixel — 16 MB on a 2000 px square — and nothing outside this
 * module reads it. A trace result is copied from the worker to the page every time, so
 * the part nobody reads stays behind.
 */
export function summarize({ inks, distinct, verdict, background, counted, floor, clusters }: Census): CensusSummary {
  return { inks, distinct, verdict, background, counted, floor, clusters }
}
