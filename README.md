# vectorize

Drop a PNG or JPG in, get a clean SVG out. Runs entirely in the browser.

```bash
cd web && npm install && npm run dev     # http://localhost:5173
```

## Why this exists

potrace is free, excellent, and thirty years old, so tracing a bitmap is a solved
problem and not the interesting part. What separates a usable vector from a traced
one is everything that happens *after* the trace, and that is where Illustrator's
Image Trace and the online converters all leave you: four hundred nodes where twelve
would do, the bitmap's staircase baked into every edge, circles spelled out as two
hundred cubics.

The fitter here comes from `logo_svg.py`,
which was written to build one client's logo set and turned out to be general.
Its idea: derive the fitting tolerance from the **local radius of curvature**. Gentle
stretches get a loose tolerance, because the only thing to follow there is the
bitmap's own noise. Tips and tight bends get 0.2 px, because that is where the detail
is real. Then Schneider's least-squares fit finds the fewest curves that stay inside
it.

## How a trace runs

| stage | module | what it does |
|---|---|---|
| ink | `trace/ink.ts` | how much of each pixel is artwork rather than background |
| prepare | `trace/prepare.ts` | pad, blur, enlarge 4×, threshold |
| trace | `trace/potrace.ts` | potrace, compiled to WebAssembly |
| resample | `trace/resample.ts` | even samples, and how sharply the outline bends at each |
| fit | `trace/fit.ts` | ★ curvature-adaptive tolerance, Schneider + Newton |
| emit | `trace/emit.ts` | path data and the document |

The odd-looking step is prepare: blurring *before* enlarging looks like throwing
detail away. It is the opposite. A hard edge in the source sits between two pixels
and only the anti-aliasing says where; blur turns that fringe into a ramp, the
upscale gives the ramp room, and thresholding puts the edge back at the sub-pixel
position the original implied. Threshold first and every edge snaps to the pixel
grid — which is exactly the staircase every mediocre tracer reproduces.

## Background removal

There is no neural net, and for flat artwork there should not be. `trace/ink.ts`
finds the background colour from the image border and measures every pixel's
distance from it in Oklab, which tracks what the eye calls "a different colour"
where plain RGB does not. On a logo this is *exact* rather than predicted, and it
finishes before a model would have loaded. It is also the first step of every trace,
because "what is the background" and "what should be traced" are the same question.

`@imgly/background-removal` is the fallback if photographic cutout is ever wanted —
lazily imported so its models never load unless asked for.

## Colour

The same mask answers the opposite question. Once it says which pixels are *not*
background, `trace/census.ts` buckets them, merges buckets within 0.02 Oklab, and ranks
what is left. The top entry is the ink, so a red logo traces to red rather than to a
hardcoded black. Rim pixels get no vote — a disc's edge runs through every shade
between the ink and the page, and letting those vote drags the answer towards white.

Deciding whether the *rest* of the ranking is more inks or just noise took three tries,
and the two failures are worth recording because each looks fine until it doesn't:

- **Share cannot do it.** A real second ink covering 3% and a blur smear of *one* ink
  both produce a 3% second cluster.
- **Geometry alone cannot do it.** A smear lies *on* the line between its ink and the
  page, so distance from that line separates smears from off-axis inks — but a logo in
  black and **mid-grey on white** puts a genuine ink exactly on that line too.

What works is both, OR'd with a spatial signal: an ink is real when it is far enough
from the dominant ink **and** either sits off the ink-to-background axis **or** is solid
rather than a thin band hugging an edge (measured: real inks 98% interior, smears
0–1%). Every constant in `census.ts` carries the measurement that chose it.

## Multi-colour

Each ink gets its own coverage map, and **every layer carries the ones painted above
it**, so the upper layers cover the joins. Two consequences worth knowing:

- `layers[0]` comes out byte-identical to the single-colour mask, so multi-colour is
  "the same trace, plus accents on top" and can never lose the silhouette.
- Seams are closed structurally, not statistically: at a junction the lower layer has no
  boundary at all, so blurring and thresholding each layer separately has nothing to
  displace. Simulated on a 753 px boundary, disjoint masks tear open 220 px of gaps in
  7 px runs; this leaves 4 isolated pixels.

`polygon-clipping` is **not** used and is not a dependency. Its ESM build exports only a
default while its types declare named exports, so `import { union }` typechecks and then
fails at runtime — and none of this needs polygon booleans anyway, because the stacking
is done on raster coverage before tracing.

A pixel is shared between two inks only when its own ink cannot account for it.
Measured on red and blue over white: rim pixels sit 0.008–0.016 from their own ink's
blend line at every coverage, boundary pixels 0.031–0.271 at every mix. That gap is the
gate. The distance *between* the two nearest inks is not — both populations span roughly
0.02 to 0.25 there, so no threshold on it can work.

## Switching a colour off

Each ink in the palette has a switch, and the export carries what is switched on — both
exports, since `cutout.ts` and the tracer take their answer from the same `separate.ts`.
It is stored as `palette.hidden`, a list of **hexes rather than indices**: the palette's
order moves with `background.tolerance`, so an index would come to mean a different
colour the moment that slider moved.

Two things about it are deliberate and neither is obvious:

- **A hidden ink stays in the palette and is switched off there.** Filtering it out of
  the list instead would hand its pixels to whichever surviving ink sits nearest, so
  hiding an accent would repaint it in the colour underneath. What hiding a layer means
  is a **hole**, and the hole is why `splitLayers` takes a visibility mask rather than a
  shorter list of inks: a hidden ink is withheld from the accumulator, so the layers
  below never carry its pixels. `selftest.ts` states this as geometry — switch off the
  blue accent in the three-ink fixture and the silhouette has to stop at the black's
  edge, not keep reaching the blue's.
- **A hidden layer is never traced.** `prepare` holds a bitmap 16× the canvas and potrace
  scans all of it however few pixels are set, so skipping is what makes switching a
  colour off cheaper rather than merely quieter. Measured on the three-ink fixture: 36 ms
  at three colours, 22 ms with the accent off.

One combination is worth knowing about, because it is not obvious and it is the reason
this exists. Turn **background removal off** and the mask becomes the image's own alpha,
so the page counts as an ink: it lands at the bottom of the stack with the artwork
layered over it, and gets a switch like everything else. On artwork whose colours sit
close to the page — where a tolerance either eats the artwork or leaves a halo — that can
beat removing the background at all, and switching the page's own colour off afterwards
is what gets the transparency back.

The cut-out's alpha is the coverage of the **lowest visible layer**, which needs no
second pass: every layer already carries the ones above it, so the bottom-most one still
showing *is* the sum of all of them. With nothing hidden that is the ink mask itself,
which is why a PNG does not shift by a count in the last place just because the palette
was split on the way past.

## Parity

`web/src/trace/fit.ts` is a port, and a port is worth what its evidence is worth.

```bash
LOGO_SVG=/path/to/logo_svg.py python parity/dump.py   # ground truth
cd web && npm test                                            # hold the port to it
```

`parity/dump.py` drives the original Python over the contours in
`parity/fixtures/contours.json` and records what it produced. The test suite runs the
TypeScript over the same contours and requires agreement within 0.01 px. When they
disagree, the port is wrong — the Python is the one with logos shipped from it.

Image preprocessing is deliberately outside the parity check: Pillow and this code
necessarily resample differently, and pretending otherwise would make the check
either meaningless or permanently red. What is checked is what was ported.

## End to end

```bash
cd web && npm run verify     # headless
```

`npm test` covers the maths, which is pure. It cannot cover potrace, or the mapping
from potrace's coordinates back into source pixels — and that mapping is exactly
where a silent error looks plausible. A y-flip, a forgotten division by the upscale
factor, a missing `PAD` offset: each leaves curves that are individually fine and
collectively in the wrong place. So `verify` traces shapes whose geometry is known
exactly — a disc, a ring, an off-centre rectangle, a red disc on white — and checks
the bounding boxes against the numbers they must produce. The same assertions run in
a browser at `/verify.html`, which also shows each result beside its source.

For the record, potrace emits `translate(0,H) scale(0.1,-0.1)`: tenths of a pixel,
with the y-flip carried in the transform's negative scale.

Running this outside a browser needs two stand-ins, both confined to
`web/scripts/selftest.ts`. `esm-potrace-wasm` declares `"type": "module"` but its
node branch calls bare `require`, so it cannot load under node ESM as published;
and node has no `ImageData`. Neither stand-in touches the code being tested.

## Not done yet

- **Shape detection.** A traced circle is currently a handful of cubics; it should be
  one `A`. Fit a circle to each run of samples, accept it when the residual holds.
- **Repeated-shape snapping.** `logo_svg.py:354` makes the two `a`s in a wordmark
  byte-identical. Worth porting.
- **A worker.** The pipeline is debounced but runs on the main thread. Measured on the
  reference wordmark: 777 ms at one colour, **2013 ms at three** — two seconds of frozen UI.
- **Cropping.** `prepare` enlarges the *whole canvas* 4× and potrace scans all of it
  however few pixels are set, so N inks cost N full traces. Cropping each layer to its
  own ink bounds would change that to `O(artwork + accent boxes)`. This is also why the
  canvas still keeps the source's full frame with its dead margin, where `logo_svg.py`
  trims to the artwork first.
- **Fine artwork still loses to a rebuild.** Traced at the default, the reference emblem
  keeps its hairlines; the shipped logo's are still cleaner, because that
  glyph is not traced at all but reconstructed from measured geometry
  (`logo_svg.py:401-454`). No tracer wins that comparison — it is worth knowing where
  the ceiling is.

## Licence

⚠️ potrace is **GPL-2.0**, and `esm-potrace-wasm` inherits it. Fine for a local tool
or an open-source one; it does mean this cannot ship closed-source without swapping
the tracer.
