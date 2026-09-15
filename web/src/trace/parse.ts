/**
 * SVG path data to the segment lists the fitter works on.
 *
 * Stands in for `fontTools.svgLib.path.parse_path` + `RecordingPen` in
 * logo_svg.py:226. potrace only ever emits moves, lines, cubics and
 * closes, but the relative forms and the shorthands cost little to support and
 * save a puzzling failure if a build starts using them.
 *
 * Arcs are here for the other direction: this app writes circles as arcs (emit.ts), and
 * the selftest reads its own output back to measure it. An arc comes out as cubics.
 * Their flags must be separated by whitespace or commas — the compact `11` some
 * minifiers write is not read.
 */
import type { Seg, Vec } from './vec'

/**
 * An SVG elliptical arc as cubics of at most a quarter turn each.
 *
 * Endpoint to centre is the SVG spec's own conversion, appendix F.6.5, including its rule
 * that radii too small to reach the endpoint are scaled up until they do. A quarter turn
 * is as far as one cubic follows a circle closely: with handles 4/3·tan(θ/4) long the
 * error stays under 0.03% of the radius.
 */
function arcSegments(p0: Vec, rx: number, ry: number, degrees: number, large: boolean, sweep: boolean, p1: Vec): Seg[] {
  if (p0[0] === p1[0] && p0[1] === p1[1]) return []
  if (rx === 0 || ry === 0) return [[p0, p1]]

  const phi = (degrees * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const hx = (p0[0] - p1[0]) / 2
  const hy = (p0[1] - p1[1]) / 2
  const x1 = cos * hx + sin * hy
  const y1 = -sin * hx + cos * hy

  const reach = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  const grow = reach > 1 ? Math.sqrt(reach) : 1
  const a = Math.abs(rx) * grow
  const b = Math.abs(ry) * grow

  const lift = a * a * b * b - a * a * y1 * y1 - b * b * x1 * x1
  const k = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, lift / (a * a * y1 * y1 + b * b * x1 * x1)))
  const cxp = (k * a * y1) / b
  const cyp = (-k * b * x1) / a
  const cx = cos * cxp - sin * cyp + (p0[0] + p1[0]) / 2
  const cy = sin * cxp + cos * cyp + (p0[1] + p1[1]) / 2

  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const theta = angle(1, 0, (x1 - cxp) / a, (y1 - cyp) / b)
  let delta = angle((x1 - cxp) / a, (y1 - cyp) / b, (-x1 - cxp) / a, (-y1 - cyp) / b)
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  if (sweep && delta < 0) delta += 2 * Math.PI

  const at = (u: number): Vec => [
    cx + a * Math.cos(u) * cos - b * Math.sin(u) * sin,
    cy + a * Math.cos(u) * sin + b * Math.sin(u) * cos,
  ]
  const along = (u: number): Vec => [
    -a * Math.sin(u) * cos - b * Math.cos(u) * sin,
    -a * Math.sin(u) * sin + b * Math.cos(u) * cos,
  ]

  const n = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9))
  const step = delta / n
  const handle = (4 / 3) * Math.tan(step / 4)
  const out: Seg[] = []
  let from = p0
  for (let i = 0; i < n; i++) {
    const u0 = theta + i * step
    const u1 = u0 + step
    // The ends are the given points exactly, not their reconstruction.
    const to = i === n - 1 ? p1 : at(u1)
    const t0 = along(u0)
    const t1 = along(u1)
    out.push([from, [from[0] + handle * t0[0], from[1] + handle * t0[1]], [to[0] - handle * t1[0], to[1] - handle * t1[1]], to])
    from = to
  }
  return out
}

/** Every subpath in `d`, as segments, in the path's own coordinates. */
export function parsePath(d: string): Seg[][] {
  const tokens = d.match(/[MmLlHhVvCcSsAaZz]|[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g) ?? []

  const contours: Seg[][] = []
  let segs: Seg[] = []
  let cur: Vec = [0, 0]
  let start: Vec = [0, 0]
  // Reflection point for S, which mirrors the previous cubic's second control.
  let lastC2: Vec | null = null
  let op = ''
  let i = 0

  const num = (): number => Number(tokens[i++])
  const flush = () => {
    if (segs.length) contours.push(segs)
    segs = []
  }

  while (i < tokens.length) {
    if (/[MmLlHhVvCcSsAaZz]/.test(tokens[i])) {
      op = tokens[i++]
    } else if (op === 'M') {
      op = 'L'
    } else if (op === 'm') {
      op = 'l'
    }

    const rel = op === op.toLowerCase()
    const ox = rel ? cur[0] : 0
    const oy = rel ? cur[1] : 0

    switch (op.toUpperCase()) {
      case 'M': {
        flush()
        cur = [num() + ox, num() + oy]
        start = cur
        lastC2 = null
        break
      }
      case 'L': {
        const p: Vec = [num() + ox, num() + oy]
        segs.push([cur, p])
        cur = p
        lastC2 = null
        break
      }
      case 'H': {
        const p: Vec = [num() + ox, cur[1]]
        segs.push([cur, p])
        cur = p
        lastC2 = null
        break
      }
      case 'V': {
        const p: Vec = [cur[0], num() + oy]
        segs.push([cur, p])
        cur = p
        lastC2 = null
        break
      }
      case 'C': {
        const c1: Vec = [num() + ox, num() + oy]
        const c2: Vec = [num() + ox, num() + oy]
        const p: Vec = [num() + ox, num() + oy]
        segs.push([cur, c1, c2, p])
        cur = p
        lastC2 = c2
        break
      }
      case 'S': {
        const c1: Vec = lastC2 ? [2 * cur[0] - lastC2[0], 2 * cur[1] - lastC2[1]] : cur
        const c2: Vec = [num() + ox, num() + oy]
        const p: Vec = [num() + ox, num() + oy]
        segs.push([cur, c1, c2, p])
        cur = p
        lastC2 = c2
        break
      }
      case 'A': {
        const rx = num()
        const ry = num()
        const rotation = num()
        const large = num() !== 0
        const sweep = num() !== 0
        const p: Vec = [num() + ox, num() + oy]
        segs.push(...arcSegments(cur, rx, ry, rotation, large, sweep, p))
        cur = p
        lastC2 = null
        break
      }
      case 'Z': {
        // An explicit closing edge only matters when the path does not already end
        // where it began; `dense` closes the ring either way.
        if (cur[0] !== start[0] || cur[1] !== start[1]) segs.push([cur, start])
        cur = start
        flush()
        lastC2 = null
        break
      }
      default:
        throw new Error(`unsupported path command "${op}"`)
    }
  }
  flush()
  return contours
}

/** potrace's root transform, which maps its tenths-of-a-pixel units back to the bitmap. */
export interface Transform {
  tx: number
  ty: number
  sx: number
  sy: number
}

/** logo_svg.py:224 — read `translate(tx,ty) scale(sx,sy)` off potrace's own output. */
export function parseTransform(svg: string): Transform {
  const m = svg.match(
    /translate\(\s*([-\d.eE]+)[,\s]+([-\d.eE]+)\s*\)\s*scale\(\s*([-\d.eE]+)[,\s]+([-\d.eE]+)\s*\)/,
  )
  if (!m) throw new Error('potrace returned no transform to map its coordinates by')
  return { tx: Number(m[1]), ty: Number(m[2]), sx: Number(m[3]), sy: Number(m[4]) }
}

/** All `d` attributes in a document, in order. */
export function pathData(svg: string): string[] {
  return [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1])
}

/**
 * Apply potrace's transform and bring the result back to source pixels.
 *
 * `origin` is where the traced bitmap's top-left sat on the canvas, in canvas px, for a
 * bitmap that is only part of it (see crop.ts). It joins the translation before anything
 * is divided: offsets and translations are whole numbers, so their sum is exact and the
 * result is bit-for-bit what tracing the full canvas gives, not merely within rounding.
 */
export function toSource(contours: Seg[][], t: Transform, divisor: number, origin: Vec = [0, 0]): Seg[][] {
  const tx = t.tx + origin[0] * divisor
  const ty = t.ty + origin[1] * divisor
  const at = (p: Vec): Vec => [(tx + t.sx * p[0]) / divisor, (ty + t.sy * p[1]) / divisor]
  return contours.map((segs) =>
    segs.map((seg) => (seg.length === 2 ? [at(seg[0]), at(seg[1])] : [at(seg[0]), at(seg[1]), at(seg[2]), at(seg[3])]) as Seg),
  )
}
