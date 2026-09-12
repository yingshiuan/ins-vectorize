/**
 * Shapes whose geometry is known exactly, drawn without a canvas.
 *
 * Pure arithmetic so the same fixtures run in a browser and in node. Edges are
 * anti-aliased by supersampling, because a hard-edged fixture would not exercise
 * the one thing `prepare` exists for: reading an edge's sub-pixel position out of
 * its anti-aliasing.
 */

export interface Raw {
  width: number
  height: number
  /** Pinned to ArrayBuffer: ImageData will not accept a possibly-shared buffer. */
  data: Uint8ClampedArray<ArrayBuffer>
}

export type Rgb = readonly [number, number, number]

export const WHITE: Rgb = [255, 255, 255]
export const BLACK: Rgb = [0, 0, 0]
/** The reference red, for the case the background detector has to get right. */
export const RED: Rgb = [0xa3, 0x1e, 0x2c]
export const BLUE: Rgb = [0x1e, 0x3f, 0xa3]
/** The reference cream, for a ground that is not white. */
export const CREAM: Rgb = [0xfa, 0xf8, 0xf1]
/** Sits exactly on the black-to-white line: a real ink that geometry alone cannot see. */
export const GREY: Rgb = [128, 128, 128]

/** Samples per axis when measuring how much of a pixel a shape covers. */
const SS = 4

export function ground(width: number, height: number, colour: Rgb = WHITE): Raw {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = colour[0]
    data[i + 1] = colour[1]
    data[i + 2] = colour[2]
    data[i + 3] = 255
  }
  return { width, height, data }
}

/** Blend `colour` into every pixel by how much of it `inside` claims. */
function paint(raw: Raw, colour: Rgb, inside: (x: number, y: number) => boolean): Raw {
  for (let y = 0; y < raw.height; y++) {
    for (let x = 0; x < raw.width; x++) {
      let hits = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (inside(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hits++
        }
      }
      if (hits === 0) continue
      const a = hits / (SS * SS)
      const i = (y * raw.width + x) * 4
      for (let c = 0; c < 3; c++) raw.data[i + c] = raw.data[i + c] * (1 - a) + colour[c] * a
    }
  }
  return raw
}

export function disc(raw: Raw, cx: number, cy: number, r: number, colour: Rgb = BLACK): Raw {
  return paint(raw, colour, (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r)
}

export function rect(raw: Raw, x0: number, y0: number, w: number, h: number, colour: Rgb = BLACK): Raw {
  return paint(raw, colour, (x, y) => x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h)
}

/** A filled disc with a smaller one taken back out of it. */
export function ring(raw: Raw, cx: number, cy: number, outer: number, inner: number, colour: Rgb = BLACK): Raw {
  disc(raw, cx, cy, outer, colour)
  return paint(raw, WHITE, (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= inner * inner)
}

/**
 * Gaussian-blur every colour channel.
 *
 * One ink smeared towards the page, which must never read as a second ink. This is the
 * only way to exercise that rejection, and `prepare.ts`'s `blur` cannot be reused: it
 * works on a single-channel coverage map, not on colour.
 */
export function soften(raw: Raw, sigma: number): Raw {
  if (sigma <= 0) return raw
  const r = Math.max(1, Math.ceil(3 * sigma))
  const k = new Float64Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-0.5 * (i / sigma) ** 2)
    k[i + r] = w
    sum += w
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum

  const { width, height, data } = raw
  const tmp = new Float64Array(width * height * 3)
  const clamp = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0
        for (let i = -r; i <= r; i++) acc += data[(y * width + clamp(x + i, width - 1)) * 4 + c] * k[i + r]
        tmp[(y * width + x) * 3 + c] = acc
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0
        for (let i = -r; i <= r; i++) acc += tmp[(clamp(y + i, height - 1) * width + x) * 3 + c] * k[i + r]
        data[(y * width + x) * 4 + c] = acc
      }
    }
  }
  return raw
}

/** A horizontal hue sweep: many colours, none dominant. Stands in for a photograph. */
export function sweep(raw: Raw): Raw {
  for (let x = 0; x < raw.width; x++) {
    const h = (x / raw.width) * 6
    const s = 0.9
    const v = 0.85
    const c = v * s
    const m = v - c
    const f = c * (1 - Math.abs((h % 2) - 1))
    const [r, g, b] =
      h < 1 ? [c, f, 0] : h < 2 ? [f, c, 0] : h < 3 ? [0, c, f] : h < 4 ? [0, f, c] : h < 5 ? [f, 0, c] : [c, 0, f]
    for (let y = 0; y < raw.height; y++) {
      const i = (y * raw.width + x) * 4
      raw.data[i] = (r + m) * 255
      raw.data[i + 1] = (g + m) * 255
      raw.data[i + 2] = (b + m) * 255
    }
  }
  return raw
}

/** Wrap raw pixels as ImageData. Node needs a polyfill for this; browsers do not. */
export function toImageData(raw: Raw): ImageData {
  return new ImageData(raw.data, raw.width, raw.height)
}
