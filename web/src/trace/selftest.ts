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
import { disc, ground, rect, ring, toImageData, BLACK, BLUE, RED, type Raw } from './fixtures'
import { parsePath } from './parse'
import { vectorize } from './pipeline'
import { dense } from './resample'
import { defaultSpec, PAD } from './spec'
import type { Seg } from './vec'

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

/**
 * Three inks, one of them small, two of them sharing an edge. Nobody names any of
 * them: the census finds the palette and `auto` decides to use it.
 */
function threeInks(): Raw {
  const source = ground(160, 120)
  rect(source, 8, 8, 52, 104, RED) // left, dominant
  rect(source, 60, 8, 40, 104, BLACK) // abuts the red along x = 60
  rect(source, 110, 40, 30, 30, BLUE) // a small accent, clear of both
  return source
}

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

  const failures = cases.reduce((n, c) => n + c.checks.filter((k) => !k.ok).length, 0)
  return { cases, failures }
}
