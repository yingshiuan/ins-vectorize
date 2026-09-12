/**
 * Splitting one ink mask into a stack.
 *
 * The invariants here are the ones that make multi-colour safe: the bottom layer must
 * still be the whole artwork, the stack must be nested before `prepare` ever sees it,
 * and a rim pixel must stay with its own ink rather than being handed to an accent
 * that happens to sit near the ink-to-page blend.
 */
import { describe, expect, it } from 'vitest'
import { BLUE, RED, WHITE, disc, ground, rect } from './fixtures'
import { detectBackground, inkMask, type Rgb } from './ink'
import { splitLayers } from './layers'

type Img = { width: number; height: number; data: Uint8ClampedArray }

const maskOf = (img: Img) => {
  const background = detectBackground(img)
  return { mask: inkMask(img, { tolerance: 0.1, softness: 0.12, background }).mask, background }
}

const rgb = (c: readonly [number, number, number]): Rgb => ({ r: c[0], g: c[1], b: c[2] })

/**
 * A red disc with a blue square inside it.
 *
 * A disc and not a rectangle on purpose: an axis-aligned rect on integer coordinates
 * has no partially covered pixels at all — every sample of a column is either inside
 * or outside — so there would be no rim for the rim test to find.
 */
function twoInks() {
  const img = ground(120, 120)
  disc(img, 60, 60, 50, RED)
  rect(img, 72, 72, 20, 20, BLUE)
  return img
}

describe('splitLayers', () => {
  it('returns the mask untouched for a single ink', () => {
    const img = disc(ground(80, 80), 40, 40, 28, RED)
    const { mask, background } = maskOf(img)
    const out = splitLayers(img, mask, [rgb(RED)], background)
    expect(out).toHaveLength(1)
    expect(out[0].mask.data).toBe(mask.data)
  })

  it('leaves the bottom layer byte-identical to the whole mask', () => {
    // The property that makes multi-colour safe: whatever else happens, the silhouette
    // survives, because the memberships sum back to each pixel's own coverage.
    const img = twoInks()
    const { mask, background } = maskOf(img)
    const out = splitLayers(img, mask, [rgb(RED), rgb(BLUE)], background)
    expect(out).toHaveLength(2)
    expect(Array.from(out[0].mask.data)).toEqual(Array.from(mask.data))
  })

  it('nests the stack before prepare ever runs', () => {
    const img = twoInks()
    const { mask, background } = maskOf(img)
    const out = splitLayers(img, mask, [rgb(RED), rgb(BLUE)], background)
    for (let j = 0; j < mask.data.length; j++) {
      expect(out[0].mask.data[j]).toBeGreaterThanOrEqual(out[1].mask.data[j])
    }
  })

  it('keeps a half-covered rim pixel with its own ink', () => {
    // THE REASON assignment uses distance to the [ink -> background] segment rather
    // than distance to the nearest ink. A rim pixel is a blend of red and white;
    // nearest-ink would hand it to whichever accent sits closest to that blend,
    // painting a one-pixel fringe of the wrong colour around every edge.
    const img = twoInks()
    const { mask, background } = maskOf(img)
    const out = splitLayers(img, mask, [rgb(RED), rgb(BLUE)], background)

    // A pixel on the disc's outer rim, at its left, far from any blue.
    let rim = -1
    for (let y = 50; y < 70 && rim < 0; y++) {
      for (let x = 4; x < 24; x++) {
        const j = y * 120 + x
        if (mask.data[j] > 40 && mask.data[j] < 215) {
          rim = j
          break
        }
      }
    }
    expect(rim).toBeGreaterThan(-1)
    // Not merely "below the threshold prepare would apply" — none of it. A sliver
    // surviving here would be a leak that only luck keeps invisible.
    expect(out[1].mask.data[rim]).toBe(0)
  })

  it('splits an ink-to-ink blend between both inks', () => {
    // #602e67 is the midpoint of red and blue — the colour a pixel takes where those
    // two inks meet. Neither ink over the page explains it (measured d1 = 0.163, well
    // above the gate), so both should take a share.
    //
    // Note what this fixture avoids: three colours on one line. Black, mid-grey and
    // #404040 are all on the black-to-white axis, which makes "a blend of two inks"
    // indistinguishable from "one ink at partial coverage" — the same ambiguity the
    // census needs `interior` to resolve, and the splitter has no such signal.
    const PURPLE = [0x60, 0x2e, 0x67] as const
    const img = ground(60, 60)
    rect(img, 4, 4, 52, 52, PURPLE)
    const { mask, background } = maskOf(img)
    const out = splitLayers(img, mask, [rgb(RED), rgb(BLUE)], background)
    const j = 30 * 60 + 30
    // The bottom layer carries everything, so ask what the top layer took.
    const top = out[1].mask.data[j]
    expect(top).toBeGreaterThan(60)
    expect(top).toBeLessThan(195)
  })

  it('counts what each ink owns outright', () => {
    const img = twoInks()
    const { mask, background } = maskOf(img)
    const out = splitLayers(img, mask, [rgb(RED), rgb(BLUE)], background)
    expect(out[0].count).toBeGreaterThan(out[1].count)
    expect(out[1].count).toBeGreaterThan(100) // the 26x26 square, give or take its rim
  })

  it('leaves a hole where a hidden ink was, not the colour beneath', () => {
    // The point of withholding a hidden ink from the accumulator rather than just not
    // drawing it. The blue square sits inside the red disc; hide blue and that patch
    // must become empty, not red.
    const img = twoInks()
    const { mask, background } = maskOf(img)
    const inside = 82 * 120 + 82 // well within the blue square at (72,72)-(92,92)

    const all = splitLayers(img, mask, [rgb(RED), rgb(BLUE)], background)
    expect(all[0].mask.data[inside]).toBe(255)

    const hidden = splitLayers(img, mask, [rgb(RED), rgb(BLUE)], background, [true, false])
    expect(hidden[1].visible).toBe(false)
    expect(hidden[0].visible).toBe(true)
    expect(hidden[0].mask.data[inside]).toBe(0)
    // ...and the red elsewhere is untouched.
    expect(hidden[0].mask.data[60 * 120 + 30]).toBe(255)
  })

  it('handles being given no inks at all', () => {
    const img = ground(40, 40, WHITE)
    const { mask, background } = maskOf(img)
    expect(splitLayers(img, mask, [], background)).toEqual([])
  })
})
