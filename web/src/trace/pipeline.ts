/**
 * Bitmap in, SVG out.
 *
 * Every stage is its own module; this is only the order they run in, plus the
 * numbers worth showing the user afterwards. Kept free of React so it can be
 * driven from a worker, a test, or a script without dragging a component tree along.
 */
import type { Census } from './census'
import { svgDocument } from './emit'
import { toHex } from './ink'
import { traceLayerMask, type LayerTrace } from './layer'
import { separate } from './separate'
import { PAD, type TraceSpec } from './spec'

/**
 * One painted colour. Single-colour artwork is the one-layer case, so the shape does
 * not have to change when several colours are traced.
 */
export interface TraceLayer {
  color: string
  d: string
  outlines: number
  nodes: number
  /** Share of the artwork's ink this colour holds, so a layer describes itself. */
  share: number
  /**
   * False when this colour is switched off. The layer is still reported — the panel
   * lists it so it can be switched back on — but it was never traced and `d` is empty.
   */
  visible: boolean
}

export interface TraceResult {
  svg: string
  layers: TraceLayer[]
  /**
   * The bottom layer's path data — the whole artwork's silhouette, since every layer
   * carries the ones above it. Multi-colour callers want `layers`. Empty when the
   * bottom colour is hidden, which is the one case where it is not the silhouette.
   */
  d: string
  /** Drawing commands in the result — the honest measure of how clean the trace is. */
  nodes: number
  /** Closed outlines. A logo runs to tens; hundreds means the despeckle is too low. */
  outlines: number
  width: number
  height: number
  /** What the background was taken to be, so the UI can show and override it. */
  background: string
  /** The ink colour found in the source, whether or not the fill was overridden. */
  ink: string
  /**
   * What the image was found to contain.
   *
   * Computed here rather than at decode time on purpose: the census is a function of
   * the mask, and the mask moves with `spec.background.{tolerance,softness,color,
   * remove}`. A census taken before those applied would describe a different image
   * than the one traced, and the panel would start lying the moment a slider moved.
   */
  census: Census | null
  /** Wall-clock for the whole pipeline, ms. */
  ms: number
}

export async function vectorize(img: ImageData, spec: TraceSpec): Promise<TraceResult> {
  const started = performance.now()

  const { background, report, ink, palette, stack } = separate(img, spec)

  const width = img.width + 2 * PAD
  const height = img.height + 2 * PAD

  // Sequentially, never in parallel: each `prepare` holds a bitmap 16x the canvas, and
  // N of those at once is how a large image kills the tab.
  const layers: TraceLayer[] = []
  for (let i = 0; i < stack.length; i++) {
    // A hidden layer is skipped, not traced to nothing. `prepare` holds a bitmap 16x
    // the canvas and potrace scans all of it however few pixels are set, so this is
    // what makes switching a colour off cheaper rather than merely quieter — which
    // matters most on exactly the images that have colours worth switching off.
    const traced = stack[i].visible ? await traceLayerMask(stack[i].mask, spec) : BLANK
    layers.push({
      // A hand-set fill only means something when there is one thing to fill.
      color: stack.length === 1 ? (spec.output.color ?? ink) : toHex(stack[i].color),
      d: traced.d,
      outlines: traced.outlines,
      nodes: traced.nodes,
      share: palette[i]?.share ?? 1,
      visible: stack[i].visible,
    })
  }

  return {
    svg: svgDocument({ width, height, layers, background: spec.output.background }),
    layers,
    d: layers[0]?.d ?? '',
    nodes: layers.reduce((n, l) => n + l.nodes, 0),
    outlines: layers.reduce((n, l) => n + l.outlines, 0),
    width,
    height,
    background: toHex(background),
    ink,
    census: report,
    ms: performance.now() - started,
  }
}

/** What a layer that was never traced reports. */
const BLANK: LayerTrace = { d: '', outlines: 0, nodes: 0 }
