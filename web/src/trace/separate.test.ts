/**
 * Which inks get painted, and what switching one off actually does.
 *
 * The interesting claims are not about the picture but about the bookkeeping: a hidden
 * ink has to stay in the palette so its pixels are not quietly reassigned, and the
 * cut-out has to agree with the SVG about which pixels are gone. Both are arithmetic,
 * so both are checked here rather than through potrace.
 */
import { describe, expect, it } from 'vitest'
import { BLACK, BLUE, RED, ground, rect } from './fixtures'
import { toHex } from './ink'
import { visibleCoverage } from './layers'
import { MAX_INKS } from './census'
import { chooseInks, paintedColors, separate } from './separate'
import { TraceSpecSchema, defaultSpec, type TraceSpec } from './spec'

/** Three inks, none of them named: red dominant, black abutting it, a blue accent clear of both. */
function threeInks() {
  const img = ground(160, 120)
  rect(img, 8, 8, 52, 104, RED)
  rect(img, 60, 8, 40, 104, BLACK)
  rect(img, 110, 40, 30, 30, BLUE)
  return img
}

/** Seven well-separated inks — one more than the default cap of six lets through. */
function sevenInks() {
  const hues = [
    [0xa3, 0x1e, 0x2c],
    [0x1e, 0x3f, 0xa3],
    [0x00, 0x00, 0x00],
    [0x1e, 0x7a, 0x3f],
    [0xe0, 0x7b, 0x1e],
    [0x6b, 0x2e, 0xa3],
    [0x1e, 0xa3, 0xa3],
  ] as const
  const img = ground(210, 60)
  hues.forEach((c, i) => rect(img, 5 + i * 29, 8, 24, 44, c))
  return img
}

const spec = (patch: Partial<TraceSpec['palette']> = {}): TraceSpec => {
  const s = defaultSpec()
  return { ...s, palette: { ...s.palette, ...patch } }
}

const RED_HEX = '#a31e2c'
const BLUE_HEX = '#1e3fa3'

describe('separate', () => {
  it('finds the palette and paints all of it on auto', () => {
    const { report, palette, stack } = separate(threeInks(), spec())
    expect(report?.verdict).toBe('multi')
    expect(palette.map((p) => toHex(p.color))).toEqual([RED_HEX, '#000000', BLUE_HEX])
    expect(stack.every((l) => l.visible)).toBe(true)
  })

  it('keeps a hidden ink in the palette and switches it off there', () => {
    // THE REASON `visible` exists as a parameter rather than the hidden ink simply
    // being dropped from the list. Drop it and its pixels go to whichever ink is
    // nearest, so hiding the blue accent would repaint it black or red — the opposite
    // of what hiding a layer means anywhere else.
    const { palette, stack } = separate(threeInks(), spec({ hidden: [BLUE_HEX] }))
    expect(palette.map((p) => toHex(p.color))).toEqual([RED_HEX, '#000000', BLUE_HEX])
    expect(stack.map((l) => l.visible)).toEqual([true, true, false])
    expect(stack[2].mask.data.every((v) => v === 0)).toBe(true)
  })

  it('leaves a hole in the layers below where a hidden ink was', () => {
    const img = threeInks()
    const inside = 55 * 160 + 125 // well inside the blue square at (110,40)-(140,70)

    const all = separate(img, spec())
    expect(all.stack[0].mask.data[inside]).toBe(255)

    const { stack } = separate(img, spec({ hidden: [BLUE_HEX] }))
    expect(stack[0].mask.data[inside]).toBe(0)
    // ...and the red it would have shown through to is untouched elsewhere.
    expect(stack[0].mask.data[60 * 160 + 30]).toBe(255)
  })

  it('matches a hidden hex whatever case it was written in', () => {
    const { stack } = separate(threeInks(), spec({ hidden: ['#1E3FA3'] }))
    expect(stack.map((l) => l.visible)).toEqual([true, true, false])
  })

  it('hides nothing when the hex is not in the palette', () => {
    // A hex can survive in the list after the tolerance moved the palette out from
    // under it. That is the price of keying by colour rather than by index, and it is
    // meant to be inert rather than to shift the remaining colours along.
    const { stack } = separate(threeInks(), spec({ hidden: ['#00ff00'] }))
    expect(stack.map((l) => l.visible)).toEqual([true, true, true])
  })

  it('paints only the dominant ink in single mode, hidden list or not', () => {
    const { palette, stack } = separate(threeInks(), spec({ mode: 'single', hidden: [BLUE_HEX] }))
    expect(palette.map((p) => toHex(p.color))).toEqual([RED_HEX])
    expect(stack).toHaveLength(1)
    expect(stack[0].visible).toBe(true)
  })

  it('empties the only layer when the one painted ink is hidden', () => {
    const { stack } = separate(threeInks(), spec({ mode: 'single', hidden: [RED_HEX] }))
    expect(stack).toHaveLength(1)
    expect(stack[0].visible).toBe(false)
    expect(stack[0].mask.data.every((v) => v === 0)).toBe(true)
  })

  it('makes the page itself a switchable colour when removal is off', () => {
    // The combination worth knowing about. With `background.remove` off the mask is the
    // image's own alpha, so the page counts as an ink and lands at the bottom of the
    // stack with the artwork above it — which on artwork whose colours sit close to the
    // page can beat removing the background by tolerance. It is then switched off like
    // any other colour, and that is what gets the transparency back.
    const off = defaultSpec()
    const keep: TraceSpec = {
      ...off,
      background: { ...off.background, remove: false },
      palette: { ...off.palette, mode: 'multi' },
    }
    const both = separate(threeInks(), keep)
    expect(both.palette.map((p) => toHex(p.color))).toEqual(['#ffffff', RED_HEX, '#000000', BLUE_HEX])

    const { stack } = separate(threeInks(), { ...keep, palette: { ...keep.palette, hidden: ['#ffffff'] } })
    expect(stack.map((l) => l.visible)).toEqual([false, true, true, true])
    // The page is gone and the artwork above it is not.
    expect(stack[0].mask.data.every((v) => v === 0)).toBe(true)
    expect(stack[1].mask.data[60 * 160 + 30]).toBe(255)
  })

  it('stops at the limit', () => {
    const { palette } = separate(threeInks(), spec({ mode: 'multi', limit: 2 }))
    expect(palette.map((p) => toHex(p.color))).toEqual([RED_HEX, '#000000'])
  })

  it('can be raised to paint every ink the census found', () => {
    // The case the cap control exists for: seven inks, a default cap of six, one left out
    // with nothing on screen explaining where it went.
    const img = sevenInks()
    expect(separate(img, spec({ mode: 'multi' })).report!.distinct).toHaveLength(7)
    expect(separate(img, spec({ mode: 'multi', limit: 6 })).palette).toHaveLength(6)
    expect(separate(img, spec({ mode: 'multi', limit: 7 })).palette).toHaveLength(7)
  })

  it('keeps the cap ceiling in reach of every ink the census can report', () => {
    // MAX_INKS is the census's own ceiling and the top of the cap's range. If those two
    // drifted apart there would be an ink no setting could paint — silently, since the
    // palette would simply list a row that never gets a layer.
    expect(TraceSpecSchema.parse({ palette: { limit: MAX_INKS } }).palette.limit).toBe(MAX_INKS)
    // Asking for more than the image holds is not an error; it just paints what is there.
    expect(separate(sevenInks(), spec({ mode: 'multi', limit: MAX_INKS })).palette).toHaveLength(7)
  })
})

describe('paintedColors', () => {
  it('lists the hexes a toggle can act on, bottom first', () => {
    const { report } = separate(threeInks(), spec())
    expect(paintedColors(report, spec())).toEqual([RED_HEX, '#000000', BLUE_HEX])
    expect(paintedColors(report, spec({ mode: 'single' }))).toEqual([RED_HEX])
    expect(paintedColors(null, spec())).toEqual([])
  })

  it('keeps listing a hidden colour, because it is still the palette', () => {
    const { report } = separate(threeInks(), spec({ hidden: [BLUE_HEX] }))
    expect(paintedColors(report, spec({ hidden: [BLUE_HEX] }))).toContain(BLUE_HEX)
  })

  it('agrees with chooseInks, since the panel and the trace must list the same rows', () => {
    const { report } = separate(threeInks(), spec())
    expect(paintedColors(report, spec())).toEqual(chooseInks(report!, spec()).map((i) => toHex(i.color)))
  })
})

describe('visibleCoverage', () => {
  it('returns the mask itself when nothing is hidden', () => {
    // Not merely an equal copy: the PNG export should not shift by a count in the last
    // place because the palette was split on the way past.
    const { mask, stack } = separate(threeInks(), spec())
    expect(visibleCoverage(stack, mask)).toBe(mask)
  })

  it('drops a hidden ink out of the cut-out alpha', () => {
    const img = threeInks()
    const inside = 55 * 160 + 125
    const { mask, stack } = separate(img, spec({ hidden: [BLUE_HEX] }))
    const alpha = visibleCoverage(stack, mask)
    expect(mask.data[inside]).toBe(255)
    expect(alpha.data[inside]).toBe(0)
    expect(alpha.data[60 * 160 + 30]).toBe(255)
  })

  it('finds the total even when the bottom colour is the hidden one', () => {
    // The lowest *visible* layer is the total, which is only the same thing as
    // `stack[0]` while the bottom colour is showing.
    const img = threeInks()
    const { mask, stack } = separate(img, spec({ hidden: [RED_HEX] }))
    const alpha = visibleCoverage(stack, mask)
    expect(alpha.data[60 * 160 + 30]).toBe(0) // inside the red
    expect(alpha.data[55 * 160 + 125]).toBe(255) // inside the blue, still painted
    expect(alpha.data[60 * 160 + 80]).toBe(255) // inside the black, still painted
  })

  it('comes out empty when every colour is hidden', () => {
    const { mask, stack } = separate(threeInks(), spec({ hidden: [RED_HEX, '#000000', BLUE_HEX] }))
    const alpha = visibleCoverage(stack, mask)
    expect(alpha.data.every((v) => v === 0)).toBe(true)
    expect(alpha.data.length).toBe(mask.data.length)
  })
})
