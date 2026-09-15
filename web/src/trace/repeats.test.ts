/**
 * Which shapes are the same shape, moved.
 *
 * As with circles, the two mistakes are not equal. A repeat missed is a file a little less
 * tidy than it could be; a shape snapped to one it only resembles is a glyph changed. So
 * the refusals — a mirror image, a copy too far out, a shape with a different number of
 * holes — are held as firmly as the snaps.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isStraight, outlinePath } from './emit'
import { fitLayer } from './fitlayer'
import { quantise } from './outline'
import { parsePath } from './parse'
import { dense } from './resample'
import { describeShape, nest } from './repeats'
import { defaultSpec } from './spec'
import type { Cubic, Seg, Vec } from './vec'

const PARITY = new URL('../../../parity/', import.meta.url)
const contours: Record<string, number[][][]> = JSON.parse(
  readFileSync(new URL('fixtures/contours.json', PARITY), 'utf8'),
)

const FIT = defaultSpec().fit

/** A closed polygon through these vertices. */
const polygon = (vertices: readonly Vec[]): Seg[] => vertices.map((p, i) => [p, vertices[(i + 1) % vertices.length]] as Seg)

/** The blob fixture's vertices; it is all straight segments. */
const BLOB: Vec[] = contours.blob.map((seg) => [seg[0][0], seg[0][1]])

const move = (vertices: readonly Vec[], [dx, dy]: Vec, jitter = () => 0): Vec[] =>
  vertices.map(([x, y]) => [x + dx + jitter(), y + dy + jitter()])

const square = (x: number, y: number, side: number, reverse = false): Vec[] => {
  const v: Vec[] = [
    [x, y],
    [x + side, y],
    [x + side, y + side],
    [x, y + side],
  ]
  return reverse ? v.reverse() : v
}

const loop = (cx: number, cy: number, r: number, n = 64): Vec[] =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)])

function lcg(amplitude: number, seed = 11) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * amplitude
}

/** Every point of every subpath, as the parser reads the written path back. */
const subpaths = (d: string) => parsePath(d).map((c) => c.flatMap((s): Vec[] => [...s]))

/** The single move taking every point of `a` to the matching point of `b`, if there is one. */
function offsetOf(a: readonly Vec[], b: readonly Vec[]): Vec | null {
  if (a.length !== b.length) return null
  const dx = b[0][0] - a[0][0]
  const dy = b[0][1] - a[0][1]
  return a.every((p, i) => Math.abs(b[i][0] - p[0] - dx) < 1e-6 && Math.abs(b[i][1] - p[1] - dy) < 1e-6) ? [dx, dy] : null
}

describe('snapping repeats', () => {
  it('writes a moved copy as the original, number for number', () => {
    const layer = fitLayer([polygon(BLOB), polygon(move(BLOB, [120.37, 3.21], lcg(0.05)))], FIT)
    expect(layer.repeats).toBe(1)
    const [a, b] = subpaths(layer.d)
    const offset = offsetOf(a, b)
    expect(offset).not.toBeNull()
    expect(Math.abs(offset![0] - 120.37)).toBeLessThan(0.02)
    expect(Math.abs(offset![1] - 3.21)).toBeLessThan(0.02)
  })

  it('does not take a mirror image for a copy', () => {
    // Mirrored and run backwards, so it winds the same way and only its shape differs.
    const mirror = BLOB.map(([x, y]): Vec => [250 - x, y]).reverse()
    expect(fitLayer([polygon(BLOB), polygon(mirror)], FIT).repeats).toBe(0)
  })

  it('holds a copy to a share of its scale, not to a distance', () => {
    // The same px of wobble: well within tolerance for a shape five times the size, well past it here.
    const big = BLOB.map(([x, y]): Vec => [x * 5, y * 5])
    expect(fitLayer([polygon(big), polygon(move(big, [600, 0], lcg(1.5)))], FIT).repeats).toBe(1)
    expect(fitLayer([polygon(BLOB), polygon(move(BLOB, [120, 0], lcg(1.5)))], FIT).repeats).toBe(0)
  })

  it('holds a thin line to its thickness, not to its length', () => {
    // A share of length would give these 700 px rules 7 px of slack — enough to take a line
    // for one 4 px longer or twice as thick, which is what the reference badge's rules would have
    // been snapped as. A share of √area gives them half a pixel.
    const rule = (y: number, length: number, thickness: number): Seg[] =>
      polygon([[0, y], [length, y], [length, y + thickness], [0, y + thickness]])
    expect(fitLayer([rule(0, 700, 2), rule(20, 700, 2)], FIT).repeats).toBe(1)
    expect(fitLayer([rule(0, 700, 2), rule(20, 704, 2)], FIT).repeats).toBe(0)
    expect(fitLayer([rule(0, 700, 2), rule(20, 700, 4)], FIT).repeats).toBe(0)
  })

  it('needs the holes to match too, and copies them along with their shape', () => {
    const withHole = [polygon(square(0, 0, 40)), polygon(square(10, 10, 10, true))]
    const twoHoles = [polygon(square(100, 0, 40)), polygon(square(105, 5, 10, true)), polygon(square(125, 25, 10, true))]
    const sameAgain = [polygon(square(200.4, 0, 40)), polygon(square(210.4, 10, 10, true))]
    const layer = fitLayer([...withHole, ...twoHoles, ...sameAgain], FIT)
    // The first square and its hole are copied onto the third; the second has one hole too many.
    expect(layer.repeats).toBe(2)
    const paths = subpaths(layer.d)
    expect(offsetOf(paths[0], paths[5])).not.toBeNull()
    expect(offsetOf(paths[1], paths[6])).not.toBeNull()
  })

  it('keeps a straight edge straight through the copy', () => {
    // Off the grid on purpose: rounded point by point, the controls would leave the thirds
    // and the edge would be written as a curve.
    const edge: Cubic = [
      [1.234, 5.678],
      [1.234 + 10.001 / 3, 5.678 + 3.337 / 3],
      [1.234 + (2 * 10.001) / 3, 5.678 + (2 * 3.337) / 3],
      [11.235, 9.015],
    ]
    expect(isStraight(edge)).toBe(true)
    const copy = quantise({ kind: 'curves', curves: [edge] }, [120.37, 3.21])
    expect(copy.kind === 'curves' && isStraight(copy.curves[0])).toBe(true)
    expect(outlinePath([copy])).toBe('M121.60,8.89L131.61,12.23Z')
  })

  it('copies a circle as a circle', () => {
    const layer = fitLayer([polygon(loop(20, 20, 6)), polygon(move(loop(20, 20, 6), [40.3, 0], lcg(0.03)))], FIT)
    expect(layer.circles).toBe(2)
    expect(layer.repeats).toBe(1)
    expect(new Set(layer.d.match(/A[\d.]+,[\d.]+/g)).size).toBe(1)
  })

  it('leaves everything alone when switched off', () => {
    const layer = fitLayer([polygon(BLOB), polygon(move(BLOB, [120, 0]))], { ...FIT, repeats: false })
    expect(layer.repeats).toBe(0)
  })
})

describe('nest', () => {
  it('finds a hole by its winding and its place, not by its size alone', () => {
    const shapes = [
      loop(50, 50, 20),
      loop(50, 50, 10).reverse(), // a hole in the first
      loop(120, 50, 5), // a separate dot, smaller than the hole and running the same way as the ring
    ].map((v) => describeShape(dense(polygon(v))))
    expect(nest(shapes)).toEqual([-1, 0, -1])
  })

  it('puts a shape centroid where it is', () => {
    const { centroid, area } = describeShape(square(10, 20, 40))
    expect(centroid[0]).toBeCloseTo(30, 9)
    expect(centroid[1]).toBeCloseTo(40, 9)
    expect(area).toBe(1600)
  })
})
