/**
 * The dropper's coordinate maths.
 *
 * These cases are the invariants that actually broke in this view before: an origin
 * that was not the centre, and a bitmap offset from the vector by the trace's own
 * padding. Both compiled; neither could be seen without a browser.
 */
import { describe, expect, it } from 'vitest'
import { sourcePixel, type View } from './pick'

/** A 100x100 source on a 108x108 traced canvas, in an 800x400 surface. */
const view = (over: Partial<View> = {}): View => ({
  rect: { left: 0, top: 0, width: 800, height: 400 },
  pan: { x: 0, y: 0 },
  scale: 1,
  width: 108,
  height: 108,
  padX: 4,
  padY: 4,
  sourceWidth: 100,
  sourceHeight: 100,
  ...over,
})

describe('sourcePixel', () => {
  it('maps the middle of the surface to the middle of the image', () => {
    expect(sourcePixel(400, 200, view())).toEqual({ x: 50, y: 50 })
  })

  it('puts the artwork’s top-left corner at pixel 0,0', () => {
    // The stage is centred, so its top-left sits half its width up and left of the
    // surface centre; the artwork starts one padding in from there.
    const v = view()
    const artX = 400 - v.width / 2 + v.padX
    const artY = 200 - v.height / 2 + v.padY
    expect(sourcePixel(artX, artY, v)).toEqual({ x: 0, y: 0 })
    // One pixel further out is off the artwork, not pixel 0 again.
    expect(sourcePixel(artX - 1, artY, v)).toBeNull()
    expect(sourcePixel(artX, artY - 1, v)).toBeNull()
  })

  it('subtracts the padding rather than the canvas edge', () => {
    // Same click, same source size, but no padding: the answer must shift by the pad.
    const padded = sourcePixel(420, 200, view())
    const bare = sourcePixel(420, 200, view({ width: 100, height: 100, padX: 0, padY: 0 }))
    expect(padded).toEqual({ x: 70, y: 50 })
    expect(bare).toEqual({ x: 70, y: 50 })
  })

  it('halves the distance travelled in the source when zoomed 2x', () => {
    const at1 = sourcePixel(440, 200, view())
    const at2 = sourcePixel(440, 200, view({ scale: 2 }))
    expect(at1).toEqual({ x: 90, y: 50 })
    expect(at2).toEqual({ x: 70, y: 50 })
  })

  it('cancels the pan out', () => {
    // Panning the image right by 100 and clicking 100 further right is the same point.
    expect(sourcePixel(500, 200, view({ pan: { x: 100, y: 0 } }))).toEqual({ x: 50, y: 50 })
    expect(sourcePixel(400, 260, view({ pan: { x: 0, y: 60 } }))).toEqual({ x: 50, y: 50 })
  })

  it('accounts for where the surface sits on the page', () => {
    const v = view({ rect: { left: 200, top: 90, width: 800, height: 400 } })
    expect(sourcePixel(600, 290, v)).toEqual({ x: 50, y: 50 })
  })

  it('returns null off the image and with no scale', () => {
    expect(sourcePixel(0, 0, view())).toBeNull()
    expect(sourcePixel(799, 399, view())).toBeNull()
    expect(sourcePixel(400, 200, view({ scale: 0 }))).toBeNull()
  })
})
