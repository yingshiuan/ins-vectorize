/**
 * Points, cubics, and the handful of vector operations the fitter needs.
 *
 * Ported from logo_svg.py, which works in NumPy Nx2 arrays. Here a
 * point is a plain tuple and a polyline is an array of them: the fitter slices
 * polylines constantly and tuples keep that legible, which matters more than the
 * throughput on outlines that run to a few thousand samples.
 */

/** A point, or a direction, in canvas units. */
export type Vec = readonly [number, number]

/** One cubic: start, two controls, end. */
export type Cubic = readonly [Vec, Vec, Vec, Vec]

/** A traced outline arrives as a mix of straight and curved pieces. */
export type Seg = readonly [Vec, Vec] | Cubic

export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]]
export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]]
export const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s]
export const neg = (a: Vec): Vec => [-a[0], -a[1]]
export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1]
export const len = (a: Vec): number => Math.hypot(a[0], a[1])
export const dist = (a: Vec, b: Vec): number => Math.hypot(a[0] - b[0], a[1] - b[1])

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

export const lerp = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** logo_svg.py:60 — a zero-length vector is returned unchanged rather than as NaN. */
export function unit(v: Vec): Vec {
  const n = len(v)
  return n > 1e-12 ? [v[0] / n, v[1] / n] : v
}

/** One point on a cubic. logo_svg.py:209 `bez`. */
export function bezAt(p0: Vec, c1: Vec, c2: Vec, p1: Vec, t: number): Vec {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return [
    a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
    a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1],
  ]
}

/** Index of the smallest value. */
export function argmin(v: ArrayLike<number>): number {
  let best = 0
  for (let i = 1; i < v.length; i++) if (v[i] < v[best]) best = i
  return best
}

/** `np.roll(a, -by)` — element i becomes the one `by` places later, wrapping. */
export function roll<T>(a: readonly T[], by: number): T[] {
  const n = a.length
  const out = new Array<T>(n)
  for (let i = 0; i < n; i++) out[i] = a[(((i + by) % n) + n) % n]
  return out
}
