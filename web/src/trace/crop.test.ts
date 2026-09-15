/**
 * Cropping has to be invisible.
 *
 * The claim is exact, so the check is exact: the bitmap `prepare` makes from the crop must
 * equal the matching window of the bitmap it makes from the whole canvas, byte for byte,
 * and the whole canvas must be empty outside that window. Held over every blur and factor
 * worth worrying about, with ink in the middle, in a corner and running off the edge —
 * the last because that is where the crop is clipped and clamping has to agree — and with
 * faint speckle scattered everywhere, which the box leaves out.
 */
import { describe, expect, it } from 'vitest'
import { anchor, cropMargin, cropPadded, faintBelow, inkBounds } from './crop'
import type { Bitmap } from './ink'
import { prepare, upscaleGain } from './prepare'
import { PAD } from './spec'

/** A single-channel anti-aliased disc, so there is a real fringe for the blur to spread. */
function disc(width: number, height: number, cx: number, cy: number, r: number): Bitmap {
  const data = new Uint8ClampedArray(width * height)
  const SS = 4
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hits = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const dx = x + (sx + 0.5) / SS - cx
          const dy = y + (sy + 0.5) / SS - cy
          if (dx * dx + dy * dy <= r * r) hits++
        }
      }
      data[y * width + x] = (hits / (SS * SS)) * 255
    }
  }
  return { width, height, data }
}

/** Coverage just under `faint` on every seventh empty pixel, the way a soft colour split leaves it. */
function speckle(mask: Bitmap, faint: number): Bitmap {
  let seed = 5
  for (let i = 0; i < mask.data.length; i += 7) {
    if (mask.data[i] === 0) mask.data[i] = 1 + ((seed = (seed * 16807) % 2147483647) % (faint - 1))
  }
  return mask
}

/** How the cropped route's prepared bitmap differs from the whole canvas's: mismatches inside it, set pixels outside. */
function compare(mask: Bitmap, blur: number, upscale: number) {
  const full = prepare(mask, { blur, upscale, pad: PAD })
  const box = inkBounds(mask, faintBelow(upscale))!
  const { bitmap, x, y } = cropPadded(mask, PAD, box, cropMargin(blur, upscale))
  const part = prepare(bitmap, { blur, upscale, pad: 0 })

  const ox = x * upscale
  const oy = y * upscale
  let mismatched = 0
  let strays = 0
  for (let fy = 0; fy < full.height; fy++) {
    for (let fx = 0; fx < full.width; fx++) {
      const v = full.data[fy * full.width + fx]
      const px = fx - ox
      const py = fy - oy
      if (px >= 0 && py >= 0 && px < part.width && py < part.height) {
        if (part.data[py * part.width + px] !== v) mismatched++
      } else if (v !== 0) {
        strays++
      }
    }
  }
  return { mismatched, strays, cropped: part.data.length < full.data.length, box }
}

describe('inkBounds', () => {
  it('is null for an empty mask', () => {
    expect(inkBounds({ width: 4, height: 3, data: new Uint8ClampedArray(12) })).toBeNull()
  })

  it('holds a single pixel, exclusive at the far edges', () => {
    const data = new Uint8ClampedArray(12)
    data[1 * 4 + 2] = 1
    expect(inkBounds({ width: 4, height: 3, data })).toEqual({ x0: 2, y0: 1, x1: 3, y1: 2 })
  })

  it('reaches the canvas edge when the ink does', () => {
    const data = new Uint8ClampedArray(12)
    data[0] = 9
    data[11] = 9
    expect(inkBounds({ width: 4, height: 3, data })).toEqual({ x0: 0, y0: 0, x1: 4, y1: 3 })
  })

  it('leaves out coverage under the threshold it is given', () => {
    const data = new Uint8ClampedArray(12)
    data[0] = 9
    data[6] = 200
    expect(inkBounds({ width: 4, height: 3, data }, 10)).toEqual({ x0: 2, y0: 1, x1: 3, y1: 2 })
  })
})

describe('faintBelow', () => {
  it('is a threshold no faint pixel can climb over, at every factor', () => {
    for (let factor = 1; factor <= 8; factor++) {
      const faint = faintBelow(factor)
      expect((faint - 1) * upscaleGain(factor)).toBeLessThan(128)
      // ...and not so timid that it keeps a soft split's slivers.
      expect(faint).toBeGreaterThan(32)
    }
  })

  it('leaves a mask that is only faint empty after preparing', () => {
    for (const upscale of [1, 4, 8]) {
      const mask = speckle({ width: 40, height: 30, data: new Uint8ClampedArray(1200) }, faintBelow(upscale))
      expect(inkBounds(mask, faintBelow(upscale))).toBeNull()
      expect(prepare(mask, { blur: 0.5, upscale, pad: PAD }).data.every((v) => v === 0)).toBe(true)
    }
  })
})

describe('anchor', () => {
  it('puts the crop back at its place, keeping the left and bottom edges', () => {
    // A 2x2 crop that sat 3 px from the left and whose top was 4 px above the bottom edge.
    const part = { width: 2, height: 2, data: new Uint8ClampedArray([1, 2, 3, 4]) }
    const placed = anchor(part, 3, 4)
    expect([placed.width, placed.height]).toEqual([5, 4])
    expect([...placed.data]).toEqual([0, 0, 0, 1, 2, 0, 0, 0, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })
})

describe('cropPadded', () => {
  const placements = [
    { name: 'centre', mask: () => disc(90, 70, 45, 35, 8) },
    { name: 'corner', mask: () => disc(90, 70, 10, 9, 7) },
    { name: 'off the edge', mask: () => disc(90, 70, 86, 66, 9) },
  ]

  for (const blur of [0, 0.5, 1.3, 2, 6]) {
    for (const upscale of [1, 3, 4]) {
      for (const { name, mask } of placements) {
        it(`prepares identically: blur ${blur}, upscale ${upscale}, ${name}`, () => {
          const { mismatched, strays, cropped } = compare(mask(), blur, upscale)
          expect(mismatched).toBe(0)
          expect(strays).toBe(0)
          // ...and it actually is a crop, not the whole canvas under another name.
          if (name === 'centre' && blur < 6) expect(cropped).toBe(true)
        })
      }
    }
  }

  for (const upscale of [1, 4, 8]) {
    for (const blur of [0.5, 2]) {
      it(`prepares identically through faint speckle: blur ${blur}, upscale ${upscale}`, () => {
        const mask = speckle(disc(120, 90, 90, 60, 6), faintBelow(upscale))
        const { mismatched, strays, box } = compare(mask, blur, upscale)
        expect(mismatched).toBe(0)
        expect(strays).toBe(0)
        // The box is the disc's, not the speckle's.
        expect(box.x1 - box.x0).toBeLessThan(16)
        expect(box.y1 - box.y0).toBeLessThan(16)
      })
    }
  }
})
