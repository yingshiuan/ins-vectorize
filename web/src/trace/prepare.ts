/**
 * Getting an ink mask ready for the tracer.
 *
 * Ported from logo_svg.py:257-259: pad, blur, upscale, threshold.
 *
 * The order is the whole trick, and it looks backwards. Blurring before enlarging
 * seems like throwing detail away, but a hard edge in the source sits *between*
 * two pixels, and only the anti-aliasing says where. Blur turns that grey fringe
 * into a ramp, the upscale gives the ramp somewhere to live, and thresholding the
 * result puts the edge back at the sub-pixel position the original implied.
 * Threshold first and every edge snaps to the pixel grid, which is exactly the
 * staircase every mediocre tracer reproduces.
 *
 * Resampling is Lanczos-3 written out here rather than handed to the canvas:
 * `drawImage` smoothing is browser-dependent, and an edge that moves between
 * browsers is not a foundation to fit curves on.
 */
import type { Bitmap } from './ink'

export interface PrepareOptions {
  blur: number
  upscale: number
  pad: number
}

/** Grow the canvas by `pad` px of background on every side. */
export function expand(src: Bitmap, pad: number): Bitmap {
  if (pad === 0) return src
  const width = src.width + 2 * pad
  const height = src.height + 2 * pad
  const data = new Uint8ClampedArray(width * height)
  for (let y = 0; y < src.height; y++) {
    data.set(src.data.subarray(y * src.width, (y + 1) * src.width), (y + pad) * width + pad)
  }
  return { width, height, data }
}

/** How far `blur` reaches either side of a pixel, px. Zero when there is no blur. */
export function blurRadius(sigma: number): number {
  return sigma > 0 ? Math.max(1, Math.ceil(3 * sigma)) : 0
}

/** Separable Gaussian, edges held rather than wrapped. */
export function blur(src: Bitmap, sigma: number): Bitmap {
  if (sigma <= 0) return src
  const { width, height } = src
  const r = blurRadius(sigma)
  const k = new Float64Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-0.5 * (i / sigma) ** 2)
    k[i + r] = w
    sum += w
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum

  const tmp = new Float64Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let i = -r; i <= r; i++) {
        const sx = Math.min(width - 1, Math.max(0, x + i))
        acc += src.data[y * width + sx] * k[i + r]
      }
      tmp[y * width + x] = acc
    }
  }

  const data = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let i = -r; i <= r; i++) {
        const sy = Math.min(height - 1, Math.max(0, y + i))
        acc += tmp[sy * width + x] * k[i + r]
      }
      data[y * width + x] = acc
    }
  }
  return { width, height, data }
}

const sinc = (x: number): number => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x))
const lanczos = (x: number, a: number): number => (Math.abs(x) >= a ? 0 : sinc(x) * sinc(x / a))

type Tap = { offset: number; weight: number }

/** Normalised Lanczos taps for each output phase of an integer enlargement. */
function lanczosTaps(factor: number, a: number): Tap[][] {
  const support = Math.ceil(a)
  const taps: Tap[][] = []
  for (let phase = 0; phase < factor; phase++) {
    const centre = (phase + 0.5) / factor - 0.5
    const first = Math.floor(centre) - support + 1
    const row: Tap[] = []
    let sum = 0
    for (let i = 0; i < 2 * support; i++) {
      const w = lanczos(centre - (first + i), a)
      if (w !== 0) {
        row.push({ offset: first + i, weight: w })
        sum += w
      }
    }
    for (const t of row) t.weight /= sum
    taps.push(row)
  }
  return taps
}

/**
 * The most `upscale` can multiply non-negative input by.
 *
 * Lanczos has negative lobes, so it overshoots. The first pass can reach the largest sum
 * of positive taps times its input; it can also leave negative values behind, so the
 * second pass is bounded by the largest sum of absolute taps times that. Under 2 at every
 * factor the spec allows.
 */
export function upscaleGain(factor: number, a = 3): number {
  if (factor === 1) return 1
  let positive = 0
  let absolute = 0
  for (const row of lanczosTaps(factor, a)) {
    positive = Math.max(positive, row.reduce((s, t) => s + Math.max(0, t.weight), 0))
    absolute = Math.max(absolute, row.reduce((s, t) => s + Math.abs(t.weight), 0))
  }
  return positive * absolute
}

/** Enlarge by an integer factor with a Lanczos-3 kernel, separably. */
export function upscale(src: Bitmap, factor: number, a = 3): Bitmap {
  if (factor === 1) return src
  const width = src.width * factor
  const height = src.height * factor

  // Weights repeat every `factor` output pixels, so they are built once.
  const taps = lanczosTaps(factor, a)

  const tmp = new Float64Array(width * src.height)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < width; x++) {
      const base = Math.floor(x / factor)
      let acc = 0
      for (const { offset, weight } of taps[x % factor]) {
        const sx = Math.min(src.width - 1, Math.max(0, base + offset))
        acc += src.data[y * src.width + sx] * weight
      }
      tmp[y * width + x] = acc
    }
  }

  const data = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    const base = Math.floor(y / factor)
    const row = taps[y % factor]
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (const { offset, weight } of row) {
        const sy = Math.min(src.height - 1, Math.max(0, base + offset))
        acc += tmp[sy * width + x] * weight
      }
      data[y * width + x] = acc
    }
  }
  return { width, height, data }
}

/** Pad, blur, enlarge, threshold. The result is 0 or 255, ink being 255. */
export function prepare(mask: Bitmap, { blur: sigma, upscale: factor, pad }: PrepareOptions): Bitmap {
  const big = upscale(blur(expand(mask, pad), sigma), factor)
  const data = new Uint8ClampedArray(big.data.length)
  for (let i = 0; i < data.length; i++) data[i] = big.data[i] >= 128 ? 255 : 0
  return { width: big.width, height: big.height, data }
}
