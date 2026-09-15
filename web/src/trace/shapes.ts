/**
 * Recognising outlines that are really circles.
 *
 * A traced dot or ring comes back from the fitter as a handful of cubics that only
 * approximate the circle the artwork meant: never quite round, and more nodes than a
 * circle needs. When an outline *is* a circle, SVG can say so in two arcs.
 *
 * "Is a circle" is held to the allowance the cubic fit is held to. `fit.ts` lets a curve
 * stray `tolerance(turning)` from each sample — tight where the outline bends, loose where
 * it does not — and a circle is accepted only if every sample sits within that same
 * allowance of it, and within what a true circle of its radius would be allowed. So an
 * outline becomes arcs only where arcs are at least as faithful as the curves would have
 * been, and a rounded square, an ellipse or a lopsided blob stays curves.
 */
import { tolerance, type FitOptions } from './fit'
import { NEAR, STEP, smooth, turning } from './resample'
import type { Vec } from './vec'

export interface Circle {
  c: Vec
  r: number
  /** 1 when the outline runs the positive-angle way — clockwise on screen, where y points down. */
  sweep: 0 | 1
}

/** Fewest samples a circle is looked for in: 12 px of outline, a dot under 4 px across. */
const MIN_SAMPLES = 24

/** Smallest radius worth writing as arcs, px. Below this an outline is a speck. */
const MIN_RADIUS = 1.5

/** Shoelace area of a closed polyline. Positive when it runs the positive-angle way. */
export function signedArea(P: readonly Vec[]): number {
  let a = 0
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += P[j][0] * P[i][1] - P[i][0] * P[j][1]
  return a / 2
}

/**
 * The least-squares circle through some points: Kåsa's algebraic fit.
 *
 * Solved about the points' mean, which keeps the normal equations well conditioned
 * wherever on the canvas the outline sits. The radius is the mean distance to the centre
 * rather than the algebraic one, so it is the circle that sits among the points.
 */
export function kasa(P: readonly Vec[]): { c: Vec; r: number } | null {
  const n = P.length
  if (n < 3) return null
  let mx = 0
  let my = 0
  for (const [x, y] of P) {
    mx += x
    my += y
  }
  mx /= n
  my /= n

  let suu = 0
  let svv = 0
  let suv = 0
  let bu = 0
  let bv = 0
  for (const [x, y] of P) {
    const u = x - mx
    const v = y - my
    suu += u * u
    svv += v * v
    suv += u * v
    bu += (u * u * u + u * v * v) / 2
    bv += (v * v * v + v * u * u) / 2
  }
  const det = suu * svv - suv * suv
  if (!(Math.abs(det) > 1e-12)) return null

  const c: Vec = [(bu * svv - bv * suv) / det + mx, (suu * bv - suv * bu) / det + my]
  let r = 0
  for (const [x, y] of P) r += Math.hypot(x - c[0], y - c[1])
  r /= n
  return Number.isFinite(r) ? { c, r } : null
}

/** The circle a closed outline's samples describe, or null if they do not describe one closely enough. */
export function detectCircle(P: readonly Vec[], { tolMax, sigma }: FitOptions): Circle | null {
  if (P.length < MIN_SAMPLES) return null

  // The points the cubics would be fitted to, and the allowance they would be held to.
  const tol = tolerance(turning(P, NEAR), tolMax)
  const Q = smooth(P, sigma)

  const fit = kasa(Q)
  if (!fit || fit.r < MIN_RADIUS) return null
  const { c, r } = fit

  // ...and the allowance a true circle this size would get: the chords NEAR samples either
  // side of a point on it turn by STEP·NEAR / r radians. Without this a flat stretch, which
  // the fitter lets off loosely, could sit that loosely off the circle too.
  const own = tolerance([(NEAR * STEP * 180) / (Math.PI * r)], tolMax)[0]

  const area = signedArea(P)
  for (let i = 0; i < Q.length; i++) {
    const [x, y] = Q[i]
    if (Math.abs(Math.hypot(x - c[0], y - c[1]) - r) > Math.min(tol[i], own)) return null
    // Round once, the same way throughout. Close to the circle is not enough on its own:
    // an outline can double back along it.
    const [nx, ny] = Q[(i + 1) % Q.length]
    if (((x - c[0]) * (ny - c[1]) - (y - c[1]) * (nx - c[0])) * area <= 0) return null
  }
  return { c, r, sweep: area > 0 ? 1 : 0 }
}
