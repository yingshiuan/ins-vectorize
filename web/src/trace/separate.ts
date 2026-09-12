/**
 * The image resolved into a background, a palette, and one coverage map per ink.
 *
 * Lifted out of `pipeline.ts` for two reasons. `cutout` needs the same answer and has
 * no business pulling the tracer in to get it — and, more to the point, "which inks,
 * and which of them are showing" now has one implementation. Two copies would be two
 * chances for the SVG and the PNG to disagree about a hidden colour.
 *
 * Pure, so it is testable in node: the decision a hidden colour turns on is arithmetic,
 * and arithmetic that can only be checked through potrace is arithmetic that drifts.
 */
import { census, type Census, type Ink } from './census'
import { inkMask, parseHex, toHex, type Bitmap, type Pixels, type Rgb } from './ink'
import { splitLayers, type ColorLayer } from './layers'
import type { TraceSpec } from './spec'

export interface Separation {
  /** Coverage of the whole artwork, background already taken out. */
  mask: Bitmap
  background: Rgb
  /** What the image was found to contain, or null when nothing voted. */
  report: Census | null
  /** The dominant ink's hex, whatever the output fill is overridden to. */
  ink: string
  /** The inks this spec paints, bottom first. Empty when there was no census. */
  palette: Ink[]
  /** One layer per entry in `palette`, bottom first, hidden inks already switched off. */
  stack: ColorLayer[]
}

export function separate(img: Pixels, spec: TraceSpec): Separation {
  const chosen: Rgb | null = spec.background.color ? parseHex(spec.background.color) : null
  const { mask, background } = inkMask(img, {
    tolerance: spec.background.tolerance,
    softness: spec.background.softness,
    background: chosen,
    remove: spec.background.remove,
  })

  // One histogram per trace: the dominant ink is just the census's first entry.
  const report = census(img, mask, background)
  const ink = report ? toHex(report.inks[0].color) : '#000000'
  const palette = report ? chooseInks(report, spec) : []

  const hide = hidden(spec)
  const stack = palette.length
    ? splitLayers(
        img,
        mask,
        palette.map((p) => p.color),
        background,
        // A hidden ink stays *in* the palette and is switched off there; it is never
        // filtered out of it. Dropping one would hand its pixels to whichever
        // surviving ink sits nearest, so hiding an accent would repaint it in the
        // colour underneath instead of leaving the hole that hiding a layer means.
        palette.map((p) => !hide.has(toHex(p.color))),
      )
    : [{ color: parseHex(ink), mask, count: 0, visible: true }]

  return { mask, background, report, ink, palette, stack }
}

/** The hidden list as a set, in the case `toHex` writes, since the schema allows either. */
export function hidden(spec: TraceSpec): Set<string> {
  return new Set(spec.palette.hidden.map((h) => h.toLowerCase()))
}

/**
 * Which inks this spec paints, bottom first — including any that are switched off,
 * because a hidden colour is still part of the palette.
 *
 * A photograph collapses to one ink whatever the mode asks for: it has no palette to
 * speak of, and tracing it in six layers costs six times as much to produce six
 * silhouettes of the same picture. The Colours panel says so rather than leaving the
 * switch looking broken.
 */
export function chooseInks(report: Census, spec: TraceSpec): Ink[] {
  const dominant = [report.inks[0]]
  if (spec.palette.mode === 'single' || report.verdict === 'photographic') return dominant
  if (spec.palette.mode === 'multi' || report.verdict === 'multi') {
    return report.distinct.slice(0, spec.palette.limit)
  }
  return dominant
}

/**
 * The hexes this spec paints, bottom first.
 *
 * What the Colours panel needs to know which of the rows it lists a toggle can act on:
 * an ink the current mode does not paint has nothing to hide. Derived from the census
 * rather than from the traced layers on purpose — a single layer's fill can be
 * overridden by hand, and then its colour is no longer the palette's.
 */
export function paintedColors(report: Census | null, spec: TraceSpec): string[] {
  return report ? chooseInks(report, spec).map((i) => toHex(i.color)) : []
}
