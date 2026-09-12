/**
 * The source image with its background taken out, as pixels.
 *
 * The same mask the tracer works from, applied to the original colours instead of
 * being thresholded. This is "remove background" as a deliverable in its own right:
 * no model, no wait, and exact on flat artwork rather than predicted.
 *
 * Hidden colours come out here too, from the same `separate` the SVG is built from, so
 * the two exports cannot disagree about what the user switched off. With nothing hidden
 * that resolves to the plain ink mask and this is byte-for-byte what it always was.
 */
import { visibleCoverage } from './layers'
import { separate } from './separate'
import type { TraceSpec } from './spec'

export function cutout(img: ImageData, spec: TraceSpec): ImageData {
  const { mask: whole, stack } = separate(img, spec)
  const mask = visibleCoverage(stack, whole)

  const out = new Uint8ClampedArray(img.data.length)
  out.set(img.data)
  for (let i = 3, j = 0; j < mask.data.length; i += 4, j++) out[i] = mask.data[j]
  return new ImageData(out, img.width, img.height)
}

/** An ImageData as a PNG blob. */
export function toPng(data: ImageData): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = data.width
  canvas.height = data.height
  canvas.getContext('2d')!.putImageData(data, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas export failed'))), 'image/png')
  })
}
