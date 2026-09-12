/**
 * Fitted curves out as SVG path data and a finished document.
 *
 * Ported from logo_svg.py:65 and :387.
 */
import type { Cubic } from './vec'

/** Two decimals, like the Python `:.2f`, so parity fixtures compare directly. */
const f = (n: number): string => n.toFixed(2)

/** A cubic whose controls sit exactly on the thirds is a straight edge; say so. */
function isStraight([p0, c1, c2, p]: Cubic): boolean {
  const e = 1e-6
  return (
    Math.abs(c1[0] - (p0[0] + (p[0] - p0[0]) / 3)) <= e &&
    Math.abs(c1[1] - (p0[1] + (p[1] - p0[1]) / 3)) <= e &&
    Math.abs(c2[0] - (p0[0] + (2 * (p[0] - p0[0])) / 3)) <= e &&
    Math.abs(c2[1] - (p0[1] + (2 * (p[1] - p0[1])) / 3)) <= e
  )
}

/** logo_svg.py:387 `bezier_path`. One subpath per closed outline. */
export function bezierPath(fitted: readonly (readonly Cubic[])[], dy = 0): string {
  const out: string[] = []
  for (const curves of fitted) {
    if (curves.length === 0) continue
    const start = curves[0][0]
    out.push(`M${f(start[0])},${f(start[1] + dy)}`)
    for (const curve of curves) {
      const [, c1, c2, p] = curve
      if (isStraight(curve)) out.push(`L${f(p[0])},${f(p[1] + dy)}`)
      else out.push(`C${f(c1[0])},${f(c1[1] + dy)} ${f(c2[0])},${f(c2[1] + dy)} ${f(p[0])},${f(p[1] + dy)}`)
    }
    out.push('Z')
  }
  return out.join('')
}

/** How many drawing commands a path holds — the honest measure of how clean a trace is. */
export function nodeCount(d: string): number {
  return (d.match(/[MLCAQ]/g) ?? []).length
}

export interface SvgOptions {
  width: number
  height: number
  /**
   * One entry per colour, painted in order — back to front. Single-colour artwork is
   * simply the one-layer case, so multi-colour needs no new shape here.
   */
  layers: readonly { color: string; d: string }[]
  /** null leaves the page showing through. */
  background?: string | null
}

/** logo_svg.py:65 `svg`, plus an optional ground behind the artwork. */
export function svgDocument({ width, height, layers, background = null }: SvgOptions): string {
  const bg = background ? `<rect width="${width}" height="${height}" fill="${background}"/>` : ''
  const paths = layers
    .filter((l) => l.d)
    .map((l) => `<path fill="${l.color}" d="${l.d}"/>`)
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">${bg}${paths}</svg>\n`
  )
}
