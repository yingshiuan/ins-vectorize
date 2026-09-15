/**
 * The end-to-end check, shared by the node runner and the browser page.
 *
 * The unit tests cover the maths, which is pure. They cannot cover potrace or the
 * mapping from its coordinates back into source pixels, and those are exactly where
 * a silent error would look plausible: a y-flip, a forgotten division by the upscale
 * factor, or a missing PAD offset all leave curves that are individually fine and
 * collectively in the wrong place.
 *
 * So: trace shapes whose geometry is known exactly, and check the bounding box.
 */
import { bezierPath } from './emit'
import { fitContour } from './fit'
import { disc, ground, rect, ring, threeInks, toImageData, RED, type Raw } from './fixtures'
import { layerContours } from './layer'
import { parsePath } from './parse'
import { vectorize } from './pipeline'
import { dense } from './resample'
import { separate } from './separate'
import { signedArea } from './shapes'
import { defaultSpec, PAD, type TraceSpec } from './spec'
import { createTracer } from './tracer'
import type { Seg, Vec } from './vec'

export interface Check {
  label: string
  got: number
  want: number
  slack: number
  ok: boolean
}

export interface Case {
  name: string
  note: string
  checks: Check[]
  source: Raw
  svg: string
}

export interface SelfTest {
  cases: Case[]
  failures: number
}

/** The extent of some path data, by walking the curves it actually describes. */
export function bounds(d: string) {
  const pts = parsePath(d).flatMap((c) => dense(c as Seg[]))
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

/** Worst distance between corresponding points of two outlines; Infinity if their shapes differ. */
function contourDrift(a: readonly Seg[], b: readonly Seg[]): number {
  if (a.length !== b.length) return Infinity
  let worst = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return Infinity
    for (let j = 0; j < a[i].length; j++) {
      worst = Math.max(worst, Math.abs(a[i][j][0] - b[i][j][0]), Math.abs(a[i][j][1] - b[i][j][1]))
    }
  }
  return worst
}

/** The one offset every point of `b` sits at from the matching point of `a`, or null if there is none. */
function offsetOf(a: readonly Vec[], b: readonly Vec[]): Vec | null {
  if (a.length !== b.length || a.length === 0) return null
  const dx = b[0][0] - a[0][0]
  const dy = b[0][1] - a[0][1]
  const moved = a.every((p, i) => Math.abs(b[i][0] - p[0] - dx) < 1e-6 && Math.abs(b[i][1] - p[1] - dy) < 1e-6)
  return moved ? [dx, dy] : null
}

/** Whether every subpath starting right of `split` is one starting left of it, moved — all by one offset. */
function copiesAcross(d: string, split: number): boolean {
  const subpaths = parsePath(d).map((c) => c.flatMap((s): Vec[] => [...s]))
  const left = subpaths.filter((p) => p[0][0] < split)
  const right = subpaths.filter((p) => p[0][0] >= split)
  if (left.length === 0 || left.length !== right.length) return false
  let common: Vec | null = null
  for (const b of right) {
    const offsets = left.map((a) => offsetOf(a, b)).filter((o): o is Vec => o !== null)
    const found = offsets.find((o) => !common || Math.hypot(o[0] - common[0], o[1] - common[1]) < 1e-6)
    if (!found) return false
    common ??= found
  }
  return true
}

const fitAll = (contours: readonly Seg[][], spec: TraceSpec): string =>
  bezierPath(
    contours.map((c) => fitContour(c, { tolMax: spec.fit.smooth, sigma: spec.fit.denoise })).filter((c) => c.length),
  )

function checker() {
  const checks: Check[] = []
  return {
    checks,
    check(label: string, got: number, want: number, slack: number) {
      checks.push({ label, got, want, slack, ok: Math.abs(got - want) <= slack })
    },
  }
}

export async function runSelfTest(): Promise<SelfTest> {
  const spec = defaultSpec()
  const cases: Case[] = []

  // A filled disc: radius 40 at (60,60). PAD is added on every side, so everything
  // the trace reports should sit that much further in.
  {
    const source = disc(ground(120, 120), 60, 60, 40)
    const r = await vectorize(toImageData(source), spec)
    const b = bounds(r.d)
    const { checks, check } = checker()
    check('left edge', b.x0, 20 + PAD, 1.5)
    check('top edge', b.y0, 20 + PAD, 1.5)
    check('right edge', b.x1, 100 + PAD, 1.5)
    check('bottom edge', b.y1, 100 + PAD, 1.5)
    check('canvas width', r.width, 120 + 2 * PAD, 0)
    check('outlines', r.outlines, 1, 0)
    check('written as a circle', r.circles, 1, 0)
    check('arcs, not curves', /A/.test(r.d) && !/C/.test(r.d) ? 1 : 0, 1, 0)
    cases.push({
      name: 'disc r=40 at (60,60)',
      note: `${r.outlines} outline, ${r.nodes} nodes, ${Math.round(r.ms)} ms`,
      checks,
      source,
      svg: r.svg,
    })
  }

  // A ring, so a hole has to survive as a hole rather than being filled in.
  {
    const source = ring(ground(120, 120), 60, 60, 45, 22)
    const r = await vectorize(toImageData(source), spec)
    const { checks, check } = checker()
    check('outlines (outer + hole)', r.outlines, 2, 0)
    check('both written as circles', r.circles, 2, 0)

    // Arcs keep the winding, or the hole fills in: nonzero needs the two to run opposite ways.
    const rings = parsePath(r.d).map((c) => dense(c))
    check('opposite windings', rings.length === 2 && signedArea(rings[0]) * signedArea(rings[1]) < 0 ? 1 : 0, 1, 0)
    const hole = rings.reduce((a, b) => (Math.abs(signedArea(a)) < Math.abs(signedArea(b)) ? a : b))
    check('hole left edge', Math.min(...hole.map((p) => p[0])), 38 + PAD, 1.5)
    check('hole right edge', Math.max(...hole.map((p) => p[0])), 82 + PAD, 1.5)
    cases.push({
      name: 'ring 45/22 at (60,60)',
      note: `${r.outlines} outlines, ${r.nodes} nodes, ${Math.round(r.ms)} ms`,
      checks,
      source,
      svg: r.svg,
    })
  }

  // Off-centre and not square, which pins orientation down: a y-flip leaves the box
  // the right size in the wrong half of the canvas.
  {
    const source = rect(ground(120, 80), 10, 12, 60, 20)
    const r = await vectorize(toImageData(source), spec)
    const b = bounds(r.d)
    const { checks, check } = checker()
    check('left edge', b.x0, 10 + PAD, 1.5)
    check('top edge', b.y0, 12 + PAD, 1.5)
    check('right edge', b.x1, 70 + PAD, 1.5)
    check('bottom edge', b.y1, 32 + PAD, 1.5)
    check('no circles', r.circles, 0, 0)
    cases.push({
      name: 'rect (10,12) 60x20',
      note: `${r.outlines} outline, ${r.nodes} nodes, ${Math.round(r.ms)} ms`,
      checks,
      source,
      svg: r.svg,
    })
  }

  // Red on white -- the reference case. Nobody names the background; it has to be found.
  {
    const source = disc(ground(120, 120), 60, 60, 35, RED)
    const r = await vectorize(toImageData(source), spec)
    const b = bounds(r.d)
    const { checks, check } = checker()
    check('background found white', r.background === '#ffffff' ? 1 : 0, 1, 0)
    // Nobody names either colour: both are read off the image.
    check('ink found reference red', r.ink === '#a31e2c' ? 1 : 0, 1, 0)
    check('fill uses the ink', r.layers[0].color === '#a31e2c' ? 1 : 0, 1, 0)
    check('left edge', b.x0, 25 + PAD, 1.5)
    check('right edge', b.x1, 95 + PAD, 1.5)
    check('outlines', r.outlines, 1, 0)
    // Flat single-ink artwork must never wander into multi-colour on its own.
    check('one layer', r.layers.length, 1, 0)
    cases.push({
      name: 'red disc on white',
      note: `background ${r.background}, ink ${r.ink}, ${r.nodes} nodes`,
      checks,
      source,
      svg: r.svg,
    })
  }

  // A dot, the smallest circle worth an arc — and the one most likely to be too wobbly after
  // tracing to pass for one. If this fails, the note says how far it was off.
  {
    const source = disc(ground(40, 40), 20, 20, 4)
    const r = await vectorize(toImageData(source), spec)
    const b = bounds(r.d)
    const { checks, check } = checker()
    check('written as a circle', r.circles, 1, 0)
    check('left edge', b.x0, 16 + PAD, 1)
    check('right edge', b.x1, 24 + PAD, 1)
    cases.push({
      name: 'dot r=4 at (20,20)',
      note: `${r.nodes} nodes · ${r.d}`,
      checks,
      source,
      svg: r.svg,
    })
  }

  // Switched off, circles are traced exactly as they were before there were circles.
  {
    const source = disc(ground(120, 120), 60, 60, 40)
    const off = { ...spec, fit: { ...spec.fit, shapes: false } }
    const r = await vectorize(toImageData(source), off)
    const contours = await layerContours(separate(source, off).stack[0].mask, off.trace)
    const { checks, check } = checker()
    check('no circles', r.circles, 0, 0)
    check('same path as the plain fit', r.d === fitAll(contours, off) ? 1 : 0, 1, 0)
    cases.push({
      name: 'disc with circles off',
      note: `${r.nodes} nodes`,
      checks,
      source,
      svg: r.svg,
    })
  }

  // Repeated shapes come out as exact copies. Two b's a whole 100 px apart, which is still
  // enough for potrace to trace them differently (see crop.ts) — then a b beside a d, which
  // share a box and an area, and must not be taken for each other.
  //
  // Whole pixels on purpose. These fixtures supersample 4x4, so a fractional offset is not
  // a clean move: at 100.3 or 100.5 px the second b comes out up to 0.7 px wider and traces
  // 2.6–3.4% of its scale away, well past the 1.5% a real repeat is allowed. How far apart
  // real repeats trace at sub-pixel offsets is measured on real artwork instead; see
  // `SHARE` in repeats.ts.
  {
    const glyph = (raw: Raw, x: number, stemRight = false): Raw => {
      ring(raw, x + 40, 50, 20, 10)
      return rect(raw, x + (stemRight ? 54 : 18), 10, 8, 60)
    }
    const bb = glyph(glyph(ground(200, 90), 0), 100)
    const bd = glyph(glyph(ground(200, 90), 0), 100, true)
    const r = await vectorize(toImageData(bb), spec)
    const mirrored = await vectorize(toImageData(bd), spec)
    const off = await vectorize(toImageData(bb), { ...spec, fit: { ...spec.fit, repeats: false } })
    const { checks, check } = checker()
    check('outlines', r.outlines, 4, 0)
    check('copied: an outline and its hole', r.repeats, 2, 0)
    check('the second b is the first, moved', copiesAcross(r.d, 100) ? 1 : 0, 1, 0)
    check('a d is not a b', mirrored.repeats, 0, 0)
    check('nothing copied when switched off', off.repeats, 0, 0)
    cases.push({
      name: 'b b, then b d',
      note: `${r.nodes} nodes copied · ${off.nodes} nodes traced separately`,
      checks,
      source: bb,
      svg: r.svg,
    })
  }

  // Two dots: circles and copies together, so the copy has to stay a circle.
  {
    const source = disc(disc(ground(80, 40), 20, 20, 4), 60, 20, 4)
    const r = await vectorize(toImageData(source), spec)
    const { checks, check } = checker()
    check('both circles', r.circles, 2, 0)
    check('one copied', r.repeats, 1, 0)
    check('one radius, written twice', new Set(r.d.match(/A[\d.]+,[\d.]+/g)).size, 1, 0)
    cases.push({
      name: 'two dots',
      note: r.d,
      checks,
      source,
      svg: r.svg,
    })
  }

  // Three inks, one of them small, two of them sharing an edge. Nobody names any of
  // them: the census finds the palette and `auto` decides to use it.
  {
    const source = threeInks()
    const r = await vectorize(toImageData(source), spec)
    const { checks, check } = checker()

    check('three layers', r.layers.length, 3, 0)
    check('bottom layer is the dominant ink', r.layers[0]?.color === '#a31e2c' ? 1 : 0, 1, 0)

    // Under-extension, stated as geometry: every layer carries the ones above it, so
    // the bottom layer is the whole artwork and its right edge is the *blue* square's,
    // not the red rectangle's. Revert to disjoint masks and this is the check that goes
    // red — it would stop at 60 + PAD.
    check('bottom layer spans all three inks', bounds(r.layers[0].d).x1, 140 + PAD, 1.5)

    // ...and the topmost ink sits inside it rather than poking out.
    const bottom = bounds(r.layers[0].d)
    const top = bounds(r.layers[2].d)
    check('top ink nested inside the silhouette', top.x0 >= bottom.x0 - 1.5 && top.x1 <= bottom.x1 + 1.5 ? 1 : 0, 1, 0)

    // Despeckle is global but applies per layer, so a small accent can be eaten whole.
    check('every layer drew something', r.layers.every((l) => l.outlines > 0) ? 1 : 0, 1, 0)

    cases.push({
      name: 'three inks on white',
      note: `${r.census?.verdict ?? '?'} · ${r.layers.map((l) => l.color).join(' ')} · ${r.nodes} nodes, ${Math.round(r.ms)} ms`,
      checks,
      source,
      svg: r.svg,
    })
  }

  // The same three inks with the accent switched off. This is the check that a hidden
  // colour leaves a *hole*: the blue square sits clear of the others, so if hiding it
  // merely stopped it being drawn, the layers below would still carry its pixels and
  // the silhouette would keep reaching x = 140. It has to stop at the black's edge.
  {
    const source = threeInks()
    const off = { ...spec, palette: { ...spec.palette, hidden: ['#1e3fa3'] } }
    const r = await vectorize(toImageData(source), off)
    const { checks, check } = checker()

    check('the palette still lists three', r.layers.length, 3, 0)
    check('the hidden layer drew nothing', r.layers[2].outlines, 0, 0)
    check('...and is reported as hidden', r.layers[2].visible ? 1 : 0, 0, 0)
    check('the layers still showing did draw', r.layers.slice(0, 2).every((l) => l.outlines > 0) ? 1 : 0, 1, 0)

    // The hole, as geometry. 100 + PAD is the black rectangle's right edge; 140 + PAD
    // would mean the silhouette still carried the blue.
    check('the silhouette stops where the blue was', bounds(r.layers[0].d).x1, 100 + PAD, 1.5)

    // Nothing switched off may appear in the file, whatever the layer list says.
    check('the hidden hex is not in the SVG', r.svg.includes('#1e3fa3') ? 1 : 0, 0, 0)

    cases.push({
      name: 'three inks, the accent switched off',
      note: `${r.layers.filter((l) => l.visible).length} of ${r.layers.length} painted · ${r.nodes} nodes, ${Math.round(r.ms)} ms`,
      checks,
      source,
      svg: r.svg,
    })
  }

  // Cropping is invisible. Every layer is traced from a crop around its own ink (crop.ts);
  // here each mask from the cases above goes through potrace both ways and the two have
  // to agree — not just in extent, which a crop off by a fraction of a pixel would pass.
  {
    const sources = [
      disc(ground(120, 120), 60, 60, 40),
      ring(ground(120, 120), 60, 60, 45, 22),
      rect(ground(120, 80), 10, 12, 60, 20),
      threeInks(),
    ]
    const { checks, check } = checker()
    let masks = 0
    let sameCounts = 1
    let samePaths = 1
    let drift = 0
    for (const source of sources) {
      for (const layer of separate(source, spec).stack) {
        const whole = await layerContours(layer.mask, spec.trace, { crop: false })
        const cropped = await layerContours(layer.mask, spec.trace)
        masks++
        if (whole.length !== cropped.length) sameCounts = 0
        else whole.forEach((c, i) => (drift = Math.max(drift, contourDrift(c, cropped[i]))))
        if (fitAll(whole, spec) !== fitAll(cropped, spec)) samePaths = 0
      }
    }
    check('same outline counts', sameCounts, 1, 0)
    check('coordinate drift', drift, 0, 1e-6)
    check('same path data', samePaths, 1, 0)

    const source = threeInks()
    cases.push({
      name: 'cropping is invisible',
      note: `${masks} layer masks traced cropped and whole · worst drift ${drift.toExponential(1)} px`,
      checks,
      source,
      svg: (await vectorize(toImageData(source), spec)).svg,
    })
  }

  // Remembering changes nothing. A tracer that keeps its stages between runs has to answer
  // exactly what one that forgets would, at every step — and the steps that touch only the
  // fit or only the output must not reach potrace at all.
  {
    const source = threeInks()
    const img = toImageData(source)
    const warm = createTracer(layerContours)
    const s = spec
    const smoother = { ...s, fit: { ...s.fit, smooth: 1.5 } }
    const steps: { label: string; spec: TraceSpec; traces: boolean }[] = [
      { label: 'default', spec: s, traces: true },
      { label: 'smoothing 1.5', spec: smoother, traces: false },
      { label: 'page colour', spec: { ...smoother, output: { ...s.output, background: '#fffff0' } }, traces: false },
      { label: 'edge softening 1', spec: { ...s, trace: { ...s.trace, blur: 1 } }, traces: true },
      { label: 'accent hidden', spec: { ...s, palette: { ...s.palette, hidden: ['#1e3fa3'] } }, traces: true },
      { label: 'default again', spec: s, traces: false },
    ]
    const { checks, check } = checker()
    let svg = ''
    for (const step of steps) {
      const before = warm.stats.contours
      const got = await warm.run(img, step.spec)
      const want = await vectorize(img, step.spec)
      check(`${step.label}: same SVG`, got.svg === want.svg ? 1 : 0, 1, 0)
      if (!step.traces) check(`${step.label}: no potrace`, warm.stats.contours - before, 0, 0)
      svg = got.svg
    }
    cases.push({
      name: 'remembering changes nothing',
      note: `${steps.length} runs, ${warm.stats.contours} potrace calls`,
      checks,
      source,
      svg,
    })
  }

  const failures = cases.reduce((n, c) => n + c.checks.filter((k) => !k.ok).length, 0)
  return { cases, failures }
}
