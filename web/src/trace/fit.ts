/**
 * Refitting a traced outline with as few cubics as will hold it.
 *
 * This is the part that separates a usable vector from a trace. potrace hands back
 * an outline that follows the bitmap's staircase faithfully, wobble and all. Here
 * each outline is resampled, its local curvature measured, and a tolerance derived
 * from that curvature: loose along gentle stretches where the only thing to follow
 * is noise, tight at tips and hard bends where the detail is real. Then Schneider's
 * least-squares fit finds the fewest curves that stay inside it.
 *
 * Ported from logo_svg.py:296-351.
 */
import { NEAR, STEP, dense, smooth, turning } from './resample'
import {
  add,
  argmin,
  bezAt,
  clamp,
  dist,
  dot,
  neg,
  roll,
  scale,
  sub,
  unit,
  type Cubic,
  type Seg,
  type Vec,
} from './vec'

/** The tightest a curve is ever held, px. Below this the fit chases anti-aliasing. */
export const TOL_MIN = 0.2

export interface FitOptions {
  /** How far a refitted curve may stray on gentle stretches, px. logo_svg.py:206 TOL_MAX. */
  tolMax: number
  /** Smoothing along the outline before refitting, px. logo_svg.py:207 SIGMA. */
  sigma: number
}

/**
 * One cubic from P[0] to P[-1] leaving along t1 and arriving along -t2.
 * logo_svg.py:296 `fit_bezier`.
 *
 * `tol` is per sample, so `err` comes back in multiples of each point's own
 * allowance rather than in px — 1 means "exactly at tolerance everywhere".
 */
export function fitBezier(
  P: readonly Vec[],
  t1: Vec,
  t2: Vec,
  tol: readonly number[],
): { B: Cubic; err: number; worst: number } {
  const n = P.length
  const d = new Float64Array(n)
  for (let i = 1; i < n; i++) d[i] = d[i - 1] + dist(P[i], P[i - 1])
  const total = d[n - 1]
  let u = new Float64Array(n)
  for (let i = 0; i < n; i++) u[i] = total > 0 ? d[i] / total : d[i]

  const p0 = P[0]
  const p3 = P[n - 1]
  const seg = dist(p3, p0)
  let B: Cubic = [p0, p0, p3, p3]
  let err = 0
  let worst = 0

  for (let attempt = 0; attempt < 13; attempt++) {
    let c00 = 0
    let c01 = 0
    let c11 = 0
    let x0 = 0
    let x1 = 0
    for (let i = 0; i < n; i++) {
      const ui = u[i]
      const w1 = 3 * (1 - ui) ** 2 * ui
      const w2 = 3 * (1 - ui) * ui ** 2
      const a1x = w1 * t1[0]
      const a1y = w1 * t1[1]
      const a2x = w2 * t2[0]
      const a2y = w2 * t2[1]
      // What is left once the endpoints alone have had their say.
      const base = bezAt(p0, p0, p3, p3, ui)
      const rx = P[i][0] - base[0]
      const ry = P[i][1] - base[1]
      c00 += a1x * a1x + a1y * a1y
      c01 += a1x * a2x + a1y * a2y
      c11 += a2x * a2x + a2y * a2y
      x0 += a1x * rx + a1y * ry
      x1 += a2x * rx + a2y * ry
    }

    const det = c00 * c11 - c01 * c01
    let al: number
    let ar: number
    if (Math.abs(det) > 1e-12) {
      al = (x0 * c11 - x1 * c01) / det
      ar = (c00 * x1 - c01 * x0) / det
    } else {
      al = seg / 3
      ar = seg / 3
    }
    // A handle longer than the span itself, or negative, means the solve has gone
    // somewhere the curve should not follow. Fall back to even thirds.
    if (!(1e-6 * seg < al && al < 2 * seg && 1e-6 * seg < ar && ar < 2 * seg)) {
      al = seg / 3
      ar = seg / 3
    }
    B = [p0, add(p0, scale(t1, al)), add(p3, scale(t2, ar)), p3]

    err = -1
    worst = 0
    for (let i = 0; i < n; i++) {
      const q = bezAt(B[0], B[1], B[2], B[3], u[i])
      const e = dist(q, P[i]) / tol[i]
      if (e > err) {
        err = e
        worst = i
      }
    }
    // Good enough, hopeless, or out of attempts. Hopeless is worth leaving early:
    // reparameterising a curve that is four times out will not rescue it, and the
    // caller is going to split here anyway.
    if (err < 1 || err >= 4 || attempt === 12) return { B, err, worst }

    // Newton step: move each sample's parameter to its closest point on the curve.
    const next = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const ui = u[i]
      const q = bezAt(B[0], B[1], B[2], B[3], ui)
      const m = 1 - ui
      const d1: Vec = [
        3 * (m * m * (B[1][0] - p0[0]) + 2 * m * ui * (B[2][0] - B[1][0]) + ui * ui * (p3[0] - B[2][0])),
        3 * (m * m * (B[1][1] - p0[1]) + 2 * m * ui * (B[2][1] - B[1][1]) + ui * ui * (p3[1] - B[2][1])),
      ]
      const d2: Vec = [
        6 * (m * (B[2][0] - 2 * B[1][0] + p0[0]) + ui * (p3[0] - 2 * B[2][0] + B[1][0])),
        6 * (m * (B[2][1] - 2 * B[1][1] + p0[1]) + ui * (p3[1] - 2 * B[2][1] + B[1][1])),
      ]
      const qp = sub(q, P[i])
      const den = dot(d1, d1) + dot(qp, d2)
      next[i] = Math.abs(den) > 1e-12 ? clamp(ui - dot(qp, d1) / den, 0, 1) : ui
    }
    u = next
  }
  return { B, err, worst }
}

/** Fewest cubics that keep every point of P within its tolerance. logo_svg.py:326 `fit_run`. */
export function fitRun(P: readonly Vec[], t1: Vec, t2: Vec, tol: readonly number[]): Cubic[] {
  if (P.length <= 3) {
    const p0 = P[0]
    const p1 = P[P.length - 1]
    const third = dist(p1, p0) / 3
    return [[p0, add(p0, scale(t1, third)), add(p1, scale(t2, third)), p1]]
  }

  const { B, err, worst } = fitBezier(P, t1, t2, tol)
  if (err < 1) return [B]

  const n = P.length
  // Worst error hugging an end: halve instead of peeling one sample off, or the
  // recursion walks in from the edge one point at a time.
  const split = n <= 8 || worst < 3 || worst > n - 4 ? Math.floor(n / 2) : worst
  const tc = unit(sub(P[split - 1], P[split + 1]))
  return [
    ...fitRun(P.slice(0, split + 1), t1, tc, tol.slice(0, split + 1)),
    ...fitRun(P.slice(split), neg(tc), t2, tol.slice(split)),
  ]
}

/**
 * The tolerance curve for a set of bend measurements.
 *
 * logo_svg.py:346. The chords 3 px either side of a point on a curve of radius R
 * turn by about 3 px / R, so inverting the turn recovers the radius — and a curve
 * with a large radius is one where any wobble is the bitmap's, not the artwork's.
 */
export function tolerance(near: ArrayLike<number>, tolMax: number): number[] {
  const out = new Array<number>(near.length)
  for (let i = 0; i < near.length; i++) {
    const radians = Math.max((near[i] * Math.PI) / 180, 1e-3)
    out[i] = clamp((NEAR * STEP) / radians / 12, TOL_MIN, tolMax)
  }
  return out
}

/**
 * Refit one closed outline: tight on sharp bends and tips, relaxed on gentle
 * curves. logo_svg.py:341 `fit_contour`.
 *
 * `P` is `dense(contour)`, for a caller that has already sampled the outline for
 * something else and should not pay for it twice.
 */
export function fitContour(contour: readonly Seg[], { tolMax, sigma }: FitOptions, P: readonly Vec[] = dense(contour)): Cubic[] {
  if (P.length < 4) return []

  const near = turning(P, NEAR)
  const tol = tolerance(near, tolMax)

  // Begin where the outline is flattest: the start is the one place the fit cannot
  // choose its own tangent, so it should be somewhere that barely has an opinion.
  const start = argmin(near)
  const Q = smooth(roll(P, start), sigma)
  Q.push(Q[0])
  const rolledTol = roll(tol, start)
  rolledTol.push(tol[start])

  const t = unit(sub(Q[2], Q[Q.length - 3]))
  return fitRun(Q, t, neg(t), rolledTol)
}
