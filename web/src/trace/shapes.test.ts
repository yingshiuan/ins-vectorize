/**
 * Which outlines count as circles.
 *
 * Both directions matter, but not equally. A circle missed costs a few extra nodes; a
 * near-circle taken for one is a shape changed. So the rejections — an ellipse a few
 * percent out of round, a rounded rectangle, a blob — are held as firmly as the finds.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dense } from './resample'
import { detectCircle, kasa, signedArea } from './shapes'
import type { Seg, Vec } from './vec'

const PARITY = new URL('../../../parity/', import.meta.url)
const contours: Record<string, number[][][]> = JSON.parse(
  readFileSync(new URL('fixtures/contours.json', PARITY), 'utf8'),
)
const asSegs = (raw: number[][][]): Seg[] => raw.map((seg) => seg.map((p) => [p[0], p[1]] as Vec) as unknown as Seg)

/** The fit settings' defaults. */
const DEFAULT = { tolMax: 0.8, sigma: 1 }

/** A closed polyline through `n` points of a curve given by angle. */
function loop(n: number, at: (t: number) => Vec): Seg[] {
  const pts = Array.from({ length: n }, (_, i) => at((i / n) * 2 * Math.PI))
  return pts.map((p, i) => [p, pts[(i + 1) % n]] as Seg)
}

const reversed = (segs: readonly Seg[]): Seg[] => segs.map((s) => [...s].reverse() as unknown as Seg).reverse()

describe('detectCircle', () => {
  it('finds the parity circle, and which way it runs', () => {
    // Centre (50,50), radius 30, drawn clockwise on screen.
    const found = detectCircle(dense(asSegs(contours.circle)), DEFAULT)
    expect(found).not.toBeNull()
    expect(found!.c[0]).toBeCloseTo(50, 1)
    expect(found!.c[1]).toBeCloseTo(50, 1)
    expect(Math.abs(found!.r - 30)).toBeLessThan(0.05)
    expect(found!.sweep).toBe(1)

    expect(detectCircle(dense(reversed(asSegs(contours.circle))), DEFAULT)?.sweep).toBe(0)
  })

  it('finds a circle through noise like a trace leaves', () => {
    let seed = 3
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.1
    const found = detectCircle(
      dense(loop(360, (t) => {
        const r = 30 + noise()
        return [200 + r * Math.cos(t), 120 + r * Math.sin(t)]
      })),
      DEFAULT,
    )
    expect(found).not.toBeNull()
    expect(Math.hypot(found!.c[0] - 200, found!.c[1] - 120)).toBeLessThan(0.05)
    expect(Math.abs(found!.r - 30)).toBeLessThan(0.05)
  })

  it('finds a dot', () => {
    const found = detectCircle(dense(loop(64, (t) => [20 + 4 * Math.cos(t), 20 + 4 * Math.sin(t)])), DEFAULT)
    expect(found).not.toBeNull()
    expect(Math.abs(found!.r - 4)).toBeLessThan(0.2)
  })

  it('keeps an ellipse only a few percent out of round as curves', () => {
    const ellipse = loop(360, (t) => [100 + 40 * Math.cos(t), 100 + 37 * Math.sin(t)])
    expect(detectCircle(dense(ellipse), DEFAULT)).toBeNull()
  })

  it('keeps a visibly oval ellipse as curves even at the loosest smoothing', () => {
    const ellipse = loop(360, (t) => [100 + 40 * Math.cos(t), 100 + 30 * Math.sin(t)])
    expect(detectCircle(dense(ellipse), { tolMax: 3, sigma: 1 })).toBeNull()
  })

  it('does not take a rounded rectangle, a blob or a square for a circle', () => {
    expect(detectCircle(dense(asSegs(contours.rounded_rect)), DEFAULT)).toBeNull()
    expect(detectCircle(dense(asSegs(contours.blob)), DEFAULT)).toBeNull()
    const square = loop(4, (t) => [20 + 20 * Math.sign(Math.round(Math.cos(t + Math.PI / 4) * 1e9)), 20 + 20 * Math.sign(Math.round(Math.sin(t + Math.PI / 4) * 1e9))])
    expect(detectCircle(dense(square), DEFAULT)).toBeNull()
  })

  it('leaves specks alone', () => {
    expect(detectCircle(dense(loop(32, (t) => [5 + 1.2 * Math.cos(t), 5 + 1.2 * Math.sin(t)])), DEFAULT)).toBeNull()
  })
})

describe('kasa', () => {
  it('recovers a circle exactly from points on it', () => {
    const pts = Array.from({ length: 12 }, (_, i): Vec => [7 + 3 * Math.cos(i), -4 + 3 * Math.sin(i)])
    const fit = kasa(pts)!
    expect(fit.c[0]).toBeCloseTo(7, 9)
    expect(fit.c[1]).toBeCloseTo(-4, 9)
    expect(fit.r).toBeCloseTo(3, 9)
  })
})

describe('signedArea', () => {
  it('is positive for an outline running clockwise on screen', () => {
    expect(
      signedArea([
        [0, 0],
        [40, 0],
        [40, 40],
        [0, 40],
      ]),
    ).toBe(1600)
  })
})
