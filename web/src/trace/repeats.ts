/**
 * Making repeated shapes exactly repeated.
 *
 * potrace is not translation-invariant (see crop.ts), so the same glyph in two places on
 * a canvas traces two slightly different ways, and the fit then settles on different
 * curves for each: a wordmark's two a's come out a few hundredths and a node or two apart.
 * Invisible at a glance, and obvious the moment anyone edits the file. So shapes that are
 * the same shape moved are found, and every later copy is written as the first one,
 * shifted — identical, number for number, apart from the shift.
 *
 * Generalised from logo_svg.py:354 `twin_letters`, which was written for one
 * wordmark and leans on it. Its letters are contours taller than 200 px, its holes are
 * whatever small contour sits inside a letter's box, and two letters match when their
 * boxes agree to 1.5 px and their areas to 1%. None of that travels: 200 px is a fact
 * about one image, a hole found by its box can belong to a neighbour, and area and box
 * alone cannot tell a b from a d, which share both. Here instead:
 *
 * - **Holes** are outlines running the other way round from the outline that contains
 *   them — the same rule the nonzero fill uses to cut them out.
 * - **A match** is confirmed on the outlines themselves. Laid over each other by their
 *   centroids, every sample of each has to lie within the tolerance of the other. A b and
 *   a d fail by the width of the bowl; an n and a u fail because only moves are tried.
 * - **The tolerance** is a share of the shape's own scale, not a distance — see `SHARE`.
 * - **Size and area** are a quick first pass, derived from that same tolerance so they can
 *   never turn away a pair the full comparison would accept.
 */
import { hundredths } from './emit'
import { TOL_MIN } from './fit'
import { quantise, type Outline } from './outline'
import { STEP } from './resample'
import type { Vec } from './vec'

/**
 * How far apart two traces of one shape may be, as a share of √area — the shape's scale.
 *
 * A share, because no distance works across images. The reference wordmark's two t's and two
 * a's are the same glyphs, and they trace 0.59 and 0.63 px apart in its 568 px export but
 * 2.31 and 1.47 px apart in the 2046 px one; any fixed distance is too tight for the
 * larger image or too loose for the specks of the smaller.
 *
 * Of √area, because a shape's length is not its scale. Measured against their longest
 * side those glyphs agree to 0.3–0.5% — but so do the two 724 × 2.5 px rules on the reference
 * badge, whose ends trace 3.8 px apart: a share of length lets a thin line match another
 * of twice its thickness. Against √area the glyphs are 0.77%, 0.66%, 0.84% and 0.43%
 * apart, those rules 11%, and the hairlines of the textured badge 5–25%. 1.5% is nearly
 * twice the worst glyph and a seventh of the nearest line.
 */
const SHARE = 0.015

/**
 * ...but never less than this, px: the fitter's own floor plus half a sample, below which
 * two samplings of one identical curve can already disagree. So a speck is only ever
 * snapped to a speck that is, to the tracer's resolution, the same speck.
 */
const FLOOR = TOL_MIN + STEP / 2

export interface Shape {
  samples: readonly Vec[]
  /** Signed, so its sign says which way the outline runs. */
  area: number
  centroid: Vec
  min: Vec
  max: Vec
}

export function describeShape(samples: readonly Vec[]): Shape {
  let area = 0
  let cx = 0
  let cy = 0
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = 0, j = samples.length - 1; i < samples.length; j = i++) {
    const [xj, yj] = samples[j]
    const [xi, yi] = samples[i]
    const cross = xj * yi - xi * yj
    area += cross
    cx += (xj + xi) * cross
    cy += (yj + yi) * cross
    x0 = Math.min(x0, xi)
    y0 = Math.min(y0, yi)
    x1 = Math.max(x1, xi)
    y1 = Math.max(y1, yi)
  }
  area /= 2
  const centroid: Vec = area !== 0 ? [cx / (6 * area), cy / (6 * area)] : [(x0 + x1) / 2, (y0 + y1) / 2]
  return { samples, area, centroid, min: [x0, y0], max: [x1, y1] }
}

/** Even-odd ray test. */
function inside([px, py]: Vec, polygon: readonly Vec[]): boolean {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/**
 * Each shape's parent: the smallest shape running the other way round that contains it,
 * or -1. A solid's children are its holes; a hole's children are the islands inside it.
 */
export function nest(shapes: readonly Shape[]): number[] {
  return shapes.map((s, i) => {
    let parent = -1
    for (let k = 0; k < shapes.length; k++) {
      const o = shapes[k]
      if (k === i || Math.sign(o.area) === Math.sign(s.area) || Math.abs(o.area) <= Math.abs(s.area)) continue
      if (o.min[0] > s.min[0] || o.min[1] > s.min[1] || o.max[0] < s.max[0] || o.max[1] < s.max[1]) continue
      if (parent >= 0 && Math.abs(shapes[parent].area) <= Math.abs(o.area)) continue
      if (inside(s.samples[0], o.samples)) parent = k
    }
    return parent
  })
}

/** Whether every one of `points` has one of `by` within `limit`. */
function covered(points: readonly Vec[], by: readonly Vec[], limit: number): boolean {
  const key = (x: number, y: number) => `${Math.floor(x / limit)},${Math.floor(y / limit)}`
  const grid = new Map<string, Vec[]>()
  for (const p of by) {
    const k = key(p[0], p[1])
    const cell = grid.get(k)
    if (cell) cell.push(p)
    else grid.set(k, [p])
  }

  const reach = limit * limit
  const hasNeighbour = ([x, y]: Vec): boolean => {
    const ix = Math.floor(x / limit)
    const iy = Math.floor(y / limit)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [qx, qy] of grid.get(`${ix + dx},${iy + dy}`) ?? []) {
          if ((qx - x) ** 2 + (qy - y) ** 2 <= reach) return true
        }
      }
    }
    return false
  }
  return points.every(hasNeighbour)
}

/** Whether `a` moved by `shift` and `b` are within `limit` of each other everywhere, both ways round. */
export function within(a: readonly Vec[], b: readonly Vec[], shift: Vec, limit: number): boolean {
  const moved = a.map(([x, y]): Vec => [x + shift[0], y + shift[1]])
  return covered(moved, b, limit) && covered(b, moved, limit)
}

/**
 * Rewrite every shape that repeats an earlier one — outline and holes — as a copy of it.
 *
 * `samples[i]` are the traced samples `outlines[i]` was fitted from. Shapes are visited in
 * reading order, left to right, so the first appearance is the one copied. Returns how
 * many outlines were rewritten.
 */
export function snapRepeats(samples: readonly (readonly Vec[])[], outlines: Outline[]): number {
  const shapes = samples.map(describeShape)
  const parents = nest(shapes)

  const depths: number[] = []
  const depth = (i: number): number => (depths[i] ??= parents[i] < 0 ? 0 : depth(parents[i]) + 1)
  const holes = shapes.map((): number[] => [])
  parents.forEach((p, i) => {
    if (p >= 0) holes[p].push(i)
  })
  const solids = shapes
    .map((_, i) => i)
    .filter((i) => depth(i) % 2 === 0)
    .sort((a, b) => shapes[a].min[0] - shapes[b].min[0] || shapes[a].min[1] - shapes[b].min[1])

  /** `b`'s outlines paired with `a`'s — outline, then each hole with its counterpart — or null if `b` is not `a` moved. */
  const match = (a: number, b: number): [number, number][] | null => {
    const A = shapes[a]
    const B = shapes[b]
    if (holes[a].length !== holes[b].length || Math.sign(A.area) !== Math.sign(B.area)) return null
    // Holes are held to their shape's tolerance: the glyph moves as one piece.
    const limit = Math.max(FLOOR, SHARE * Math.sqrt(Math.abs(A.area)))
    if (Math.abs(A.max[0] - A.min[0] - (B.max[0] - B.min[0])) > 2 * limit) return null
    if (Math.abs(A.max[1] - A.min[1] - (B.max[1] - B.min[1])) > 2 * limit) return null
    // Two outlines never further than `limit` apart enclose areas that differ by at most
    // their length times `limit`.
    if (Math.abs(Math.abs(A.area) - Math.abs(B.area)) > A.samples.length * STEP * limit) return null

    const shift: Vec = [B.centroid[0] - A.centroid[0], B.centroid[1] - A.centroid[1]]
    if (!within(A.samples, B.samples, shift, limit)) return null

    const pairs: [number, number][] = [[a, b]]
    const left = [...holes[b]]
    for (const h of holes[a]) {
      // The hole of `b` sitting where this one would be, moved along with its shape.
      const want: Vec = [shapes[h].centroid[0] + shift[0], shapes[h].centroid[1] + shift[1]]
      let best = -1
      for (let k = 0; k < left.length; k++) {
        const [x, y] = shapes[left[k]].centroid
        const [bx, by] = best < 0 ? [Infinity, Infinity] : shapes[left[best]].centroid
        if (Math.hypot(x - want[0], y - want[1]) < Math.hypot(bx - want[0], by - want[1])) best = k
      }
      if (best < 0) return null
      const [k] = left.splice(best, 1)
      if (!within(shapes[h].samples, shapes[k].samples, shift, limit)) return null
      pairs.push([h, k])
    }
    return pairs
  }

  const taken = new Set<number>()
  let copies = 0
  for (let i = 0; i < solids.length; i++) {
    const a = solids[i]
    if (taken.has(a)) continue
    let canonical: Map<number, Outline> | null = null

    for (let j = i + 1; j < solids.length; j++) {
      const b = solids[j]
      if (taken.has(b)) continue
      const pairs = match(a, b)
      if (!pairs) continue

      if (!canonical) {
        canonical = new Map([a, ...holes[a]].map((k) => [k, quantise(outlines[k])]))
        for (const [k, outline] of canonical) outlines[k] = outline
      }
      const shift: Vec = [
        hundredths(shapes[b].centroid[0] - shapes[a].centroid[0]),
        hundredths(shapes[b].centroid[1] - shapes[a].centroid[1]),
      ]
      for (const [from, to] of pairs) outlines[to] = quantise(canonical.get(from)!, shift)
      copies += pairs.length
      taken.add(b)
    }
  }
  return copies
}
