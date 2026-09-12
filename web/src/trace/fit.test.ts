/**
 * The port held to the original.
 *
 * parity/expected.json is what logo_svg.py makes of the contours in
 * parity/fixtures/contours.json. Regenerate both with `parity/dump.py`. If these
 * disagree, the port is the one that is wrong.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bezierPath, nodeCount } from './emit'
import { fitContour } from './fit'
import { dense, turning } from './resample'
import type { Cubic, Seg, Vec } from './vec'

const PARITY = new URL('../../../parity/', import.meta.url)
const read = (p: string) => JSON.parse(readFileSync(new URL(p, PARITY), 'utf8'))

const contours: Record<string, number[][][]> = read('fixtures/contours.json')
const expected: { cases: { contour: string; tolMax: number; sigma: number; curves: number[][][] }[] } =
  read('expected.json')

const asSegs = (raw: number[][][]): Seg[] =>
  raw.map((seg) => seg.map((p) => [p[0], p[1]] as Vec) as unknown as Seg)

/** Worst distance between corresponding control points. */
function maxDrift(a: readonly Cubic[], b: number[][][]): number {
  let worst = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < 4; j++) {
      worst = Math.max(worst, Math.hypot(a[i][j][0] - b[i][j][0], a[i][j][1] - b[i][j][1]))
    }
  }
  return worst
}

describe('parity with logo_svg.py', () => {
  for (const c of expected.cases) {
    it(`${c.contour} at tolMax=${c.tolMax} sigma=${c.sigma}`, () => {
      const got = fitContour(asSegs(contours[c.contour]), { tolMax: c.tolMax, sigma: c.sigma })
      expect(got.length).toBe(c.curves.length)
      expect(maxDrift(got, c.curves)).toBeLessThan(0.01)
    })
  }
})

describe('the fit itself', () => {
  const circle = asSegs(contours.circle)

  it('rebuilds a circle in a handful of curves', () => {
    const curves = fitContour(circle, { tolMax: 0.8, sigma: 1 })
    // Four cubics is the textbook circle; the resample-and-refit round trip should
    // not need many more than that.
    expect(curves.length).toBeLessThanOrEqual(8)
  })

  it('stays inside the tolerance it was given', () => {
    // The contract is the tolerance, not a number picked here: a circle of radius
    // 30 comes back in two cubics, and two cubics carry ~0.5px of radial error by
    // construction. That is the fitter spending its whole allowance on the cheapest
    // possible answer, which is the point of it.
    for (const tolMax of [0.3, 0.8, 2]) {
      const curves = fitContour(circle, { tolMax, sigma: 1 })
      const worst = Math.max(...dense(curves).map((p) => Math.abs(Math.hypot(p[0] - 50, p[1] - 50) - 30)))
      expect(worst).toBeLessThanOrEqual(tolMax)
    }
  })

  it('spends fewer curves as the tolerance opens up', () => {
    const blob = asSegs(contours.blob)
    const tight = fitContour(blob, { tolMax: 0.2, sigma: 1 })
    const loose = fitContour(blob, { tolMax: 2.5, sigma: 1 })
    expect(loose.length).toBeLessThan(tight.length)
  })

  it('fits a rounded rectangle without exploding the curve count', () => {
    // Eight primitive pieces go in: four straights and four quarter-circle corners.
    // A fit that needs many times that is chasing the resampling, not the shape.
    const curves = fitContour(asSegs(contours.rounded_rect), { tolMax: 0.8, sigma: 0.5 })
    expect(curves.length).toBeLessThanOrEqual(24)

    const d = bezierPath([curves])
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(nodeCount(d)).toBe(curves.length + 1) // the opening M, then one per curve
  })
})

describe('turning', () => {
  it('reads ~0 along a straight run and ~90 at a right angle', () => {
    const straight: Vec[] = Array.from({ length: 40 }, (_, i) => [i, 0])
    expect(turning(straight, 6)[20]).toBeLessThan(1)

    const corner: Vec[] = [
      ...Array.from({ length: 20 }, (_, i) => [i, 0] as Vec),
      ...Array.from({ length: 20 }, (_, i) => [20, i + 1] as Vec),
    ]
    expect(turning(corner, 6)[19]).toBeGreaterThan(80)
  })
})
