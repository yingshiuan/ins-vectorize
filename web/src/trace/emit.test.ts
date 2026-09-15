/**
 * Writing outlines out.
 *
 * Curves have their parity test in fit.test.ts. Circles are this app's own, and the claim
 * worth holding is the one that is easy to lose to rounding: as written, the two arc
 * endpoints are exactly a diameter apart.
 */
import { describe, expect, it } from 'vitest'
import { bezierPath, circlePath, nodeCount, outlinePath } from './emit'
import type { Cubic } from './vec'

describe('circlePath', () => {
  it('writes a circle as two half-turn arcs in one subpath', () => {
    const d = circlePath({ kind: 'circle', c: [50, 50], r: 30, sweep: 1 })
    expect(d).toBe('M80.00,50.00A30.00,30.00 0 1 1 20.00,50.00A30.00,30.00 0 1 1 80.00,50.00Z')
    expect(nodeCount(d)).toBe(3)
  })

  it('keeps the endpoints exactly a diameter apart as written, wherever the circle is', () => {
    let seed = 7
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < 1000; i++) {
      const d = circlePath({ kind: 'circle', c: [rand() * 2000, rand() * 2000], r: 0.5 + rand() * 500, sweep: 1 })
      // M x0,y  A R,R 0 1 1 x1,y ... — the decimals, in hundredths.
      const [x0, , radius, , x1] = d.match(/-?\d+\.\d+/g)!.map((s) => Math.round(Number(s) * 100))
      expect(x0 - x1).toBe(2 * radius)
    }
  })
})

describe('outlinePath', () => {
  it('writes curves exactly as bezierPath always has', () => {
    const a: Cubic[] = [
      [[0, 0], [10, 0], [20, 10], [20, 20]],
      [[20, 20], [10, 20], [0, 10], [0, 0]],
    ]
    const b: Cubic[] = [
      [[5, 5], [6, 5], [7, 5], [8, 5]],
      [[8, 5], [7, 6], [6, 6], [5, 5]],
    ]
    const both = outlinePath([
      { kind: 'curves', curves: a },
      { kind: 'curves', curves: b },
    ])
    expect(both).toBe(bezierPath([a, b]))
  })
})
