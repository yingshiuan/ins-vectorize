/**
 * sRGB to Oklab, for deciding how far a pixel is from the background.
 *
 * Plain RGB distance is the obvious thing and the wrong one: it makes a light grey
 * look as far from white as a saturated yellow does, so either the grey survives a
 * background removal or the yellow is eaten by it. Oklab distances track what the
 * eye calls "a different colour", which is the judgement being made here.
 *
 * Björn Ottosson's transform, https://bottosson.github.io/posts/oklab/
 */

export type Lab = readonly [number, number, number]

const linear = (c: number): number => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** One 8-bit sRGB triple as Oklab. */
export function rgbToOklab(r: number, g: number, b: number): Lab {
  const lr = linear(r)
  const lg = linear(g)
  const lb = linear(b)

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** Perceptual distance. Roughly: 0.02 is a shade, 0.1 is a different colour. */
export function labDistance(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
