/**
 * Background and ink detection.
 *
 * Both decide colours nobody typed, so both are easy to get subtly wrong in a way
 * that looks fine — a colour a shade off, or one that is the average of two inks and
 * present nowhere in the image. These fixtures have exactly known colours.
 */
import { describe, expect, it } from 'vitest'
import { BLACK, CREAM, RED, disc, ground, rect } from './fixtures'
import { detectBackground, detectInk, inkMask, toHex } from './ink'

const maskOf = (img: { width: number; height: number; data: Uint8ClampedArray }) =>
  inkMask(img, { tolerance: 0.1, softness: 0.12 }).mask

describe('detectBackground', () => {
  it('finds white under artwork that does not reach the edge', () => {
    expect(toHex(detectBackground(disc(ground(120, 120), 60, 60, 40, RED)))).toBe('#ffffff')
  })

  it('finds a tinted ground', () => {
    expect(toHex(detectBackground(disc(ground(120, 120, CREAM), 60, 60, 40, BLACK)))).toBe('#faf8f1')
  })
})

describe('detectInk', () => {
  it('finds the exact ink, not a shade off it', () => {
    const img = disc(ground(120, 120), 60, 60, 40, RED)
    expect(toHex(detectInk(img, maskOf(img))!)).toBe('#a31e2c')
  })

  it('is not fooled by the anti-aliased rim', () => {
    // A disc's edge runs through every shade between the ink and the page. Taking
    // those into account would drag the answer towards white.
    const img = disc(ground(60, 60), 30, 30, 12, RED)
    expect(toHex(detectInk(img, maskOf(img))!)).toBe('#a31e2c')
  })

  it('picks the dominant ink rather than averaging two', () => {
    // Red over most of the frame, black in a corner. The mean of the two is a colour
    // in neither; the answer has to be one of them, and the bigger one.
    const img = ground(120, 120)
    rect(img, 10, 10, 90, 90, RED)
    rect(img, 4, 4, 12, 12, BLACK)
    expect(toHex(detectInk(img, maskOf(img))!)).toBe('#a31e2c')
  })

  it('returns null when there is no artwork at all', () => {
    const img = ground(40, 40)
    expect(detectInk(img, maskOf(img))).toBeNull()
  })
})

describe('inkMask', () => {
  it('keeps the artwork and drops the page', () => {
    const img = disc(ground(120, 120), 60, 60, 40, RED)
    const { mask } = inkMask(img, { tolerance: 0.1, softness: 0.12 })
    expect(mask.data[60 * 120 + 60]).toBe(255) // middle of the disc
    expect(mask.data[2 * 120 + 2]).toBe(0) // corner of the page
  })

  it('keeps a pale ink that merely resembles the page', () => {
    // #cccccc sits 0.155 from white in Oklab, which the raw ramp scores 116 — below
    // the 128 `prepare` thresholds at. Before this it vanished from the artwork
    // entirely, which is why colours only showed up with background removal switched
    // off. It is solid artwork and must read as solid.
    const PALE = [0xcc, 0xcc, 0xcc] as const
    const img = ground(120, 120)
    rect(img, 20, 20, 80, 80, PALE)
    const { mask } = inkMask(img, { tolerance: 0.1, softness: 0.12 })
    expect(mask.data[60 * 120 + 60]).toBe(255) // interior: solid
    expect(mask.data[2 * 120 + 2]).toBe(0) // page: still dropped
  })

  it('leaves a genuinely half-covered rim fractional', () => {
    // The other half of the same judgement. Promoting rim pixels would throw away the
    // sub-pixel edge position that the whole blur-then-threshold approach exists to
    // recover, so partial values must survive where the coverage is really partial.
    const img = disc(ground(120, 120), 60, 60, 40, RED)
    const { mask } = inkMask(img, { tolerance: 0.1, softness: 0.12 })
    let partial = 0
    for (let j = 0; j < mask.data.length; j++) {
      if (mask.data[j] > 0 && mask.data[j] < 255) partial++
    }
    // The disc's rim is ~250 px, and only the blend ratios landing between the ramp's
    // two cutoffs are fractional at all — so a modest count is expected. What this
    // guards is the failure that matters: solidify promoting the rim wholesale, which
    // would leave zero.
    expect(partial).toBeGreaterThan(20)
  })
})
