/**
 * Bitmap in, SVG out — remembering what it did last time.
 *
 * Every stage is its own module; this is the order they run in, the numbers worth showing
 * the user afterwards, and what each stage remembers. Moving one slider used to rerun all
 * of it: the background mask, the census, every layer's blur, upscale and potrace. But
 * each stage reads only part of the spec, so most of that was recomputing an answer
 * already in hand.
 *
 * | stage    | reads                        | work                   |
 * |----------|------------------------------|------------------------|
 * | separate | `background`, `palette`      | ink mask, census, split |
 * | contours | `trace`, and one layer mask  | prepare, potrace       |
 * | fit      | `fit`, and those contours    | refit, path data       |
 * | emit     | `output`                     | the document           |
 *
 * so a Fit slider never reaches potrace, and an Output change is a string join.
 *
 * Keys are whole spec sections, serialised, rather than hand-picked fields: a field added
 * to a section later invalidates its stage without anyone having to remember to say so,
 * and `tracer.test.ts` holds every field to that.
 *
 * potrace is passed in rather than imported. That keeps this free of React and of the
 * wasm, so it runs the same in the worker, in a test, and in a script.
 */
import { MAX_INKS, summarize, type CensusSummary } from './census'
import { applyCoverage } from './cutout'
import { svgDocument } from './emit'
import { fitLayer, type LayerTrace } from './fitlayer'
import { toHex, type Bitmap, type Pixels } from './ink'
import { separate, type Separation } from './separate'
import { PAD, type TraceSpec } from './spec'
import type { Seg } from './vec'

/**
 * One painted colour. Single-colour artwork is the one-layer case, so the shape does
 * not have to change when several colours are traced.
 */
export interface TraceLayer {
  color: string
  d: string
  outlines: number
  nodes: number
  /** Outlines written as circles rather than curves. */
  circles: number
  /** Outlines written as exact copies of an earlier one, moved. */
  repeats: number
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
  /** How many of those were written as circles. */
  circles: number
  /** ...and how many as copies of an earlier shape. */
  repeats: number
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
  census: CensusSummary | null
  /** Wall-clock for the whole pipeline, ms. */
  ms: number
  /** Where that time went, ms. A stage answered from memory costs next to nothing. */
  stages: { separate: number; trace: number; fit: number; emit: number }
}

/** potrace, or a stand-in for it: one layer mask to its outlines, in padded-canvas px. */
export type ContoursFn = (mask: Bitmap, trace: TraceSpec['trace']) => Promise<Seg[][]>

/** Thrown from a checkpoint to abandon a run that a newer request has made pointless. */
export class Superseded extends Error {
  constructor() {
    super('superseded')
  }
}

export interface RunOptions {
  /**
   * Awaited between stages and between layers. Throwing `Superseded` there abandons the
   * run; whatever it had finished stays remembered for the run that replaces it.
   */
  checkpoint?: () => Promise<void>
}

export interface Tracer {
  /** `img` is remembered by identity, so a changed picture must arrive as a new object. */
  run(img: Pixels, spec: TraceSpec, options?: RunOptions): Promise<TraceResult>
  /** The source with its background, and any switched-off colours, taken out — from `run`'s own separation. */
  cutout(img: Pixels, spec: TraceSpec): ImageData
  /** Drop everything remembered, for when the image it was remembered about is gone. */
  forget(): void
  /** How many times each stage actually did its work rather than answering from memory. */
  readonly stats: { separate: number; contours: number; fit: number }
}

/**
 * Layers remembered per stage, most recent first: a full palette's worth. That is enough
 * for switching a colour off and on again to trace nothing, without holding a canvas-sized
 * mask for every combination ever tried.
 */
const REMEMBERED = MAX_INKS

/** A spec section as a key. Sorted, so the order an object happens to list its fields in never matters. */
const key = (section: object): string => JSON.stringify(section, Object.keys(section).sort())

/** The keys each stage is remembered under. Exported so a test can hold every spec field to one. */
export function stageKeys(spec: TraceSpec) {
  return {
    separate: key(spec.background) + key(spec.palette),
    contours: key(spec.trace),
    fit: key(spec.fit),
  }
}

function sameBitmap(a: Bitmap, b: Bitmap): boolean {
  if (a.data === b.data) return true
  if (a.width !== b.width || a.height !== b.height) return false
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false
  return true
}

/** `entry` moved to the front of `list`, which is kept to `REMEMBERED` long. */
function remember<T>(list: readonly T[], entry: T): T[] {
  return [entry, ...list.filter((e) => e !== entry)].slice(0, REMEMBERED)
}

/** What a layer that was never traced reports. */
const BLANK: LayerTrace = { d: '', outlines: 0, nodes: 0, circles: 0, repeats: 0 }

export function createTracer(contoursOf: ContoursFn): Tracer {
  let separated: { img: Pixels; key: string; separation: Separation } | null = null
  // Compared by mask contents, not identity: a changed background or palette separates
  // afresh into new mask objects, but most layers' pixels come out exactly as before.
  let traced: { key: string; mask: Bitmap; contours: Seg[][] }[] = []
  let fitted: { key: string; contours: Seg[][]; layer: LayerTrace }[] = []
  const stats = { separate: 0, contours: 0, fit: 0 }

  const separation = (img: Pixels, spec: TraceSpec): Separation => {
    const k = stageKeys(spec).separate
    if (separated && separated.img === img && separated.key === k) return separated.separation
    const fresh = separate(img, spec)
    stats.separate++
    separated = { img, key: k, separation: fresh }
    return fresh
  }

  const contoursFor = async (mask: Bitmap, spec: TraceSpec): Promise<Seg[][]> => {
    const k = stageKeys(spec).contours
    const hit = traced.find((e) => e.key === k && sameBitmap(e.mask, mask))
    if (hit) {
      traced = remember(traced, hit)
      return hit.contours
    }
    const contours = await contoursOf(mask, spec.trace)
    stats.contours++
    traced = remember(traced, { key: k, mask, contours })
    return contours
  }

  const fitFor = (contours: Seg[][], spec: TraceSpec): LayerTrace => {
    const k = stageKeys(spec).fit
    const hit = fitted.find((e) => e.key === k && e.contours === contours)
    if (hit) {
      fitted = remember(fitted, hit)
      return hit.layer
    }
    const layer = fitLayer(contours, spec.fit)
    stats.fit++
    fitted = remember(fitted, { key: k, contours, layer })
    return layer
  }

  return {
    stats,

    forget() {
      separated = null
      traced = []
      fitted = []
    },

    cutout: (img, spec) => applyCoverage(img, separation(img, spec)),

    async run(img, spec, { checkpoint } = {}) {
      const started = performance.now()
      const { background, report, ink, palette, stack } = separation(img, spec)
      const stages = { separate: performance.now() - started, trace: 0, fit: 0, emit: 0 }

      // Sequentially, never in parallel: each `prepare` holds a bitmap 16x its crop, and
      // N of those at once is how a large image kills the tab.
      const layers: TraceLayer[] = []
      for (let i = 0; i < stack.length; i++) {
        await checkpoint?.()

        // A hidden layer is skipped, not traced to nothing. That is what makes switching a
        // colour off cheaper rather than merely quieter — which matters most on exactly
        // the images that have colours worth switching off.
        let traced = BLANK
        if (stack[i].visible) {
          let t = performance.now()
          const contours = await contoursFor(stack[i].mask, spec)
          stages.trace += performance.now() - t
          t = performance.now()
          traced = fitFor(contours, spec)
          stages.fit += performance.now() - t
        }

        layers.push({
          // A hand-set fill only means something when there is one thing to fill.
          color: stack.length === 1 ? (spec.output.color ?? ink) : toHex(stack[i].color),
          d: traced.d,
          outlines: traced.outlines,
          nodes: traced.nodes,
          circles: traced.circles,
          repeats: traced.repeats,
          share: palette[i]?.share ?? 1,
          visible: stack[i].visible,
        })
      }

      const width = img.width + 2 * PAD
      const height = img.height + 2 * PAD
      const t = performance.now()
      const svg = svgDocument({ width, height, layers, background: spec.output.background })
      stages.emit = performance.now() - t

      return {
        svg,
        layers,
        d: layers[0]?.d ?? '',
        nodes: layers.reduce((n, l) => n + l.nodes, 0),
        outlines: layers.reduce((n, l) => n + l.outlines, 0),
        circles: layers.reduce((n, l) => n + l.circles, 0),
        repeats: layers.reduce((n, l) => n + l.repeats, 0),
        width,
        height,
        background: toHex(background),
        ink,
        census: report && summarize(report),
        ms: performance.now() - started,
        stages,
      }
    },
  }
}
