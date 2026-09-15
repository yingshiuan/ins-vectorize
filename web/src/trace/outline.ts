/**
 * One closed outline, in whichever form describes it best.
 *
 * Most outlines are a run of cubics. One that is a circle is kept as its centre and
 * radius, so it can be written as arcs. `sweep` is the direction it runs in, which is not
 * cosmetic: paths fill by the nonzero rule, and a ring's hole is only a hole because it
 * runs the other way round from the ring.
 */
import { hundredths, isStraight } from './emit'
import type { Cubic, Vec } from './vec'

export type Outline =
  | { kind: 'curves'; curves: readonly Cubic[] }
  | { kind: 'circle'; c: Vec; r: number; sweep: 0 | 1 }

/**
 * An outline put on the two-decimal grid its path data is written on, then moved by
 * `shift` — itself on that grid. A copy made this way writes out numbers that differ from
 * the original's by exactly the shift and nothing else.
 *
 * A straight cubic is rebuilt from its rounded ends instead of being rounded point by
 * point: it is written as a line only while its controls sit exactly on the thirds, and
 * rounding each control on its own knocks them off.
 */
export function quantise(outline: Outline, shift: Vec = [0, 0]): Outline {
  const q = ([x, y]: Vec): Vec => [hundredths(x) + shift[0], hundredths(y) + shift[1]]
  if (outline.kind === 'circle') return { ...outline, c: q(outline.c), r: hundredths(outline.r) }

  return {
    kind: 'curves',
    curves: outline.curves.map((cubic): Cubic => {
      const p0 = q(cubic[0])
      const p1 = q(cubic[3])
      if (!isStraight(cubic)) return [p0, q(cubic[1]), q(cubic[2]), p1]
      const dx = p1[0] - p0[0]
      const dy = p1[1] - p0[1]
      return [p0, [p0[0] + dx / 3, p0[1] + dy / 3], [p0[0] + (2 * dx) / 3, p0[1] + (2 * dy) / 3], p1]
    }),
  }
}
