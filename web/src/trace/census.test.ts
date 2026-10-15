/**
 * The colour census.
 *
 * Every case here was measured before it was written — on real logo artwork, real
 * photographs, and synthetics built to break specific rules. Two of them killed
 * earlier versions of the discriminator, and they are marked. Assertions check
 * `d1`/`perp`/`interior` and not only the verdict, so a regression says *which* signal
 * moved rather than just that the answer changed.
 */
import { describe, expect, it } from 'vitest'
import { BLACK, BLUE, GREY, RED, disc, ground, rect, soften, sweep } from './fixtures'
import { PERP_MIN, census, perpendicular, tally } from './census'
import { detectBackground, inkMask, toHex } from './ink'
import { rgbToOklab } from './oklab'

type Img = { width: number; height: number; data: Uint8ClampedArray }

const look = (img: Img) => {
  const background = detectBackground(img)
  const { mask } = inkMask(img, { tolerance: 0.1, softness: 0.12, background })
  return census(img, mask, background)
}

const hexes = (c: NonNullable<ReturnType<typeof look>>) => c.distinct.map((i) => toHex(i.color))

describe('perpendicular', () => {
  const a = rgbToOklab(0, 0, 0)
  const b = rgbToOklab(255, 255, 255)

  it('is zero at both ends and anywhere between', () => {
    expect(perpendicular(a, a, b)).toBeCloseTo(0, 6)
    expect(perpendicular(b, a, b)).toBeCloseTo(0, 6)
    expect(perpendicular(rgbToOklab(128, 128, 128), a, b)).toBeLessThan(0.01)
  })

  it('is positive off the line', () => {
    expect(perpendicular(rgbToOklab(0xa3, 0x1e, 0x2c), a, b)).toBeGreaterThan(0.1)
  })

  it('clamps past the ends instead of extending the line', () => {
    // A point beyond `b` measures to `b`, not to the infinite line through a-b.
    const beyond = rgbToOklab(255, 255, 255)
    expect(perpendicular(beyond, a, rgbToOklab(128, 128, 128))).toBeGreaterThan(0.1)
  })
})

describe('census', () => {
  it('reads one flat ink as single', () => {
    const c = look(disc(ground(120, 120), 60, 60, 40, RED))!
    expect(c.verdict).toBe('single')
    expect(c.distinct).toHaveLength(1)
    expect(toHex(c.distinct[0].color)).toBe('#a31e2c')
    expect(c.distinct[0].share).toBeGreaterThan(0.9)
  })

  it('finds a small second ink that share alone would drop', () => {
    // 90/10. The second ink holds ~3% of the artwork -- the same share a blur smear
    // produces, which is why the rule cannot be a share threshold.
    const img = ground(160, 160)
    rect(img, 8, 8, 144, 144, RED)
    rect(img, 120, 120, 28, 28, BLACK)
    const c = look(img)!
    expect(c.verdict).toBe('multi')
    expect(hexes(c)).toHaveLength(2)
    expect(c.distinct[1].perp).toBeGreaterThan(PERP_MIN)
  })

  it('finds a flat ink lying ON the ink-to-background line', () => {
    // THE CASE THAT BROKE TWO EARLIER RULES. Mid-grey between black ink and a white
    // page sits exactly on the blend line, so `perp` is ~0 and geometry cannot see
    // it. Only its solidity separates it from a blur.
    const img = ground(160, 120)
    rect(img, 8, 8, 68, 104, BLACK)
    rect(img, 84, 8, 68, 104, GREY)
    const c = look(img)!
    expect(c.verdict).toBe('multi')
    expect(c.distinct).toHaveLength(2)

    const grey = c.inks.find((i) => i.color.r > 100 && i.color.r < 160)!
    expect(grey.perp).toBeLessThan(PERP_MIN) // geometry says "smear"
    expect(grey.interior).toBeGreaterThan(0.8) // solidity says "region"
    expect(grey.distinct).toBe(true)
  })

  it('rejects a blur smear of one ink at either strength', () => {
    for (const sigma of [2, 3]) {
      const c = look(soften(disc(ground(160, 160), 80, 80, 55, BLACK), sigma))!
      expect(c.verdict).toBe('single')
      expect(c.distinct).toHaveLength(1)
      // The runner-up must fail on both arms, not scrape past one of them.
      const next = c.inks[1]
      if (next) {
        expect(next.perp).toBeLessThan(PERP_MIN)
        expect(next.interior).toBeLessThan(0.5)
      }
    }
  })

  it('counts four flat inks', () => {
    const img = ground(160, 160)
    rect(img, 4, 4, 72, 72, RED)
    rect(img, 84, 4, 72, 72, BLUE)
    rect(img, 4, 84, 72, 72, BLACK)
    rect(img, 84, 84, 72, 72, GREY)
    const c = look(img)!
    expect(c.verdict).toBe('multi')
    expect(c.distinct).toHaveLength(4)
    for (const ink of c.distinct) expect(ink.share).toBeGreaterThan(0.2)
  })

  it('calls a hue sweep photographic', () => {
    expect(look(sweep(ground(200, 140)))!.verdict).toBe('photographic')
  })

  it('returns null when there is no artwork', () => {
    expect(look(ground(40, 40))).toBeNull()
  })

  it('is deterministic', () => {
    const build = () => {
      const img = ground(120, 120)
      rect(img, 4, 4, 56, 112, RED)
      rect(img, 60, 4, 56, 112, BLUE) // deliberately equal areas
      return look(img)!
    }
    expect(hexes(build())).toEqual(hexes(build()))
  })
})

describe('tally', () => {
  it('merges two buckets of one ink instead of reporting two', () => {
    // #a31e2c and #a6212f are a hair apart perceptually but fall either side of a
    // bucket boundary on the green channel. Unmerged they are two clusters of ~50%
    // each and the image reads as two-colour; merged, it is one ink.
    const NEAR = [0xa6, 0x21, 0x2f] as const
    const img = ground(120, 120)
    rect(img, 4, 4, 54, 112, RED)
    rect(img, 62, 4, 54, 112, NEAR)
    const c = look(img)!
    expect(c.verdict).toBe('single')
    expect(c.distinct).toHaveLength(1)
    expect(c.distinct[0].share).toBeGreaterThan(0.9)
  })

  it('reports shares against the pixels that voted', () => {
    const img = disc(ground(120, 120), 60, 60, 40, RED)
    const background = detectBackground(img)
    const t = tally(img, inkMask(img, { tolerance: 0.1, softness: 0.12, background }).mask)!
    expect(t.counted).toBeGreaterThan(0)
    expect(t.inks.reduce((a, i) => a + i.share, 0)).toBeLessThanOrEqual(1.0001)
  })
})
