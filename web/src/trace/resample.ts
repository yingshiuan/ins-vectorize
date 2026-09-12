/**
 * Turning a traced outline into evenly spaced samples, and measuring how sharply
 * it bends at each one.
 *
 * The bend measurement is what makes the refit work: it sets a per-sample
 * tolerance, so the fitter is held tight where there is real detail and let loose
 * where the only thing to follow is the bitmap's own staircase.
 *
 * Ported from logo_svg.py:262-293.
 */
import { bezAt, dist, lerp, type Seg, type Vec } from './vec'

/** px between outline samples. logo_svg.py:204 STEP. */
export const STEP = 0.5

/** Samples either side of a point when measuring how sharply the outline bends. logo_svg.py:205 NEAR. */
export const NEAR = 6

/** Evenly spaced points around a closed outline. logo_svg.py:262 `dense`. */
export function dense(contour: readonly Seg[], step = STEP): Vec[] {
  const fine: Vec[] = []
  for (const seg of contour) {
    if (seg.length === 2) {
      const [p0, p1] = seg
      const n = Math.max(2, Math.floor(dist(p1, p0) / 0.1))
      for (let i = 0; i < n; i++) fine.push(lerp(p0, p1, i / n))
    } else {
      const [p0, c1, c2, p1] = seg
      const n = Math.max(4, Math.floor((dist(c1, p0) + dist(c2, c1) + dist(p1, c2)) / 0.1))
      for (let i = 0; i < n; i++) fine.push(bezAt(p0, c1, c2, p1, i / n))
    }
  }
  if (fine.length === 0) return []

  // Close the ring back onto its first sample before measuring arc length, so the
  // final span is walked like any other.
  const P = [...fine, fine[0]]
  const cum = new Float64Array(P.length)
  for (let i = 1; i < P.length; i++) cum[i] = cum[i - 1] + dist(P[i], P[i - 1])
  const total = cum[cum.length - 1]
  if (total <= 0) return []

  const n = Math.max(8, Math.floor(total / step))
  const out: Vec[] = new Array(n)
  let j = 0
  for (let i = 0; i < n; i++) {
    const s = (i * total) / n
    while (j < cum.length - 2 && cum[j + 1] < s) j++
    const span = cum[j + 1] - cum[j]
    out[i] = lerp(P[j], P[j + 1], span > 0 ? (s - cum[j]) / span : 0)
  }
  return out
}

/**
 * Degrees the outline turns between the chords k samples behind and ahead of each
 * point. logo_svg.py:280 `turning`.
 */
export function turning(P: readonly Vec[], k: number): Float64Array {
  const n = P.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const back = P[(((i - k) % n) + n) % n]
    const fwd = P[(i + k) % n]
    const ax = P[i][0] - back[0]
    const ay = P[i][1] - back[1]
    const bx = fwd[0] - P[i][0]
    const by = fwd[1] - P[i][1]
    const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) + 1e-12)
    out[i] = (Math.acos(cos < -1 ? -1 : cos > 1 ? 1 : cos) * 180) / Math.PI
  }
  return out
}

/**
 * Gaussian smoothing around a closed outline. logo_svg.py:287 `smooth`.
 *
 * Circular, so the join is not a seam. A radius below one sample would smooth
 * nothing, and NumPy's `P[-0:]` quietly wraps the whole array there — the guard
 * returns a copy instead of reproducing that.
 */
export function smooth(P: readonly Vec[], sigma: number, step = STEP): Vec[] {
  const n = P.length
  const s = sigma / step
  const r = Math.min(Math.floor(3 * s), n - 1)
  if (r < 1) return P.slice()

  const k = new Float64Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-0.5 * (i / s) ** 2)
    k[i + r] = w
    sum += w
  }

  const out: Vec[] = new Array(n)
  for (let i = 0; i < n; i++) {
    let x = 0
    let y = 0
    for (let j = -r; j <= r; j++) {
      const p = P[(((i + j) % n) + n) % n]
      const w = k[j + r] / sum
      x += p[0] * w
      y += p[1] * w
    }
    out[i] = [x, y]
  }
  return out
}
