/**
 * Reading path data back, arcs included.
 *
 * The arc cases are anchored to the SVG spec rather than to this app's own writer: the two
 * small arcs between the same pair of points, told apart only by the sweep flag, have
 * midpoints that can be worked out by hand. An emitter and a parser that shared a mistake
 * would otherwise agree with each other perfectly.
 */
import { describe, expect, it } from 'vitest'
import { circlePath } from './emit'
import { parsePath, toSource } from './parse'
import { dense } from './resample'
import { signedArea } from './shapes'
import { bezAt, type Cubic, type Seg, type Vec } from './vec'

const midpoint = (seg: Seg): Vec => {
  expect(seg).toHaveLength(4)
  const [p0, c1, c2, p1] = seg as Cubic
  return bezAt(p0, c1, c2, p1, 0.5)
}

const near = ([x, y]: Vec, [ex, ey]: Vec) => {
  expect(x).toBeCloseTo(ex, 2)
  expect(y).toBeCloseTo(ey, 2)
}

describe('parsePath arcs', () => {
  it('takes the positive-angle arc when sweep is 1', () => {
    // Around (0,0), from -90° up to 0°.
    const [[seg]] = parsePath('M0,-10A10,10 0 0 1 10,0')
    near(midpoint(seg), [7.0711, -7.0711])
  })

  it('takes the other small arc when sweep is 0', () => {
    // Around (10,-10), from 180° down to 90°.
    const [[seg]] = parsePath('M0,-10A10,10 0 0 0 10,0')
    near(midpoint(seg), [2.9289, -2.9289])
  })

  it('reads relative arcs from the current point', () => {
    // Around (10,20), from -90° up to 0°.
    const [[seg]] = parsePath('M10,10a10,10 0 0 1 10,10')
    near(midpoint(seg), [17.0711, 12.9289])
  })

  it('scales radii too small to reach the endpoint, as the spec says', () => {
    // Radius 1 cannot span 10 px, so it becomes 5: a half turn around (5,0), passing over the top.
    const [segs] = parsePath('M0,0A1,1 0 0 1 10,0')
    expect(segs).toHaveLength(2)
    near(segs[0][segs[0].length - 1], [5, -5])
  })

  it('treats a zero radius as a straight line', () => {
    expect(parsePath('M0,0A0,5 0 0 1 10,0')).toEqual([[[[0, 0], [10, 0]]]])
  })

  it('reads a written circle back as that circle, running the way it was written', () => {
    for (const sweep of [0, 1] as const) {
      const contours = parsePath(circlePath({ kind: 'circle', c: [50, 50], r: 30, sweep }))
      expect(contours).toHaveLength(1)
      const P = dense(contours[0])
      for (const [x, y] of P) expect(Math.abs(Math.hypot(x - 50, y - 50) - 30)).toBeLessThan(0.02)
      expect(Math.sign(signedArea(P))).toBe(sweep ? 1 : -1)
    }
  })
})

describe('toSource', () => {
  it('adds the origin before dividing, in canvas px', () => {
    // potrace's y-flip, a 4x bitmap, and a bitmap that sat at (3,7) on the canvas.
    const t = { tx: 0, ty: 100, sx: 0.1, sy: -0.1 }
    const [[seg]] = toSource([[[[40, 400], [80, 400]]]], t, 4, [3, 7])
    near(seg[0], [4, 22])
    near(seg[1], [5, 22])
  })
})
