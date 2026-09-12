/**
 * SVG path data to the segment lists the fitter works on.
 *
 * Stands in for `fontTools.svgLib.path.parse_path` + `RecordingPen` in
 * logo_svg.py:226. potrace only ever emits moves, lines, cubics and
 * closes, but the relative forms and the shorthands cost little to support and
 * save a puzzling failure if a build starts using them.
 */
import type { Seg, Vec } from './vec'

/** Every subpath in `d`, as segments, in the path's own coordinates. */
export function parsePath(d: string): Seg[][] {
  const tokens = d.match(/[MmLlHhVvCcSsZz]|[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g) ?? []

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
    if (/[MmLlHhVvCcSsZz]/.test(tokens[i])) {
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

/** Apply potrace's transform and bring the result back to source pixels. */
export function toSource(contours: Seg[][], t: Transform, divisor: number): Seg[][] {
  const at = (p: Vec): Vec => [(t.tx + t.sx * p[0]) / divisor, (t.ty + t.sy * p[1]) / divisor]
  return contours.map((segs) =>
    segs.map((seg) => (seg.length === 2 ? [at(seg[0]), at(seg[1])] : [at(seg[0]), at(seg[1]), at(seg[2]), at(seg[3])]) as Seg),
  )
}
