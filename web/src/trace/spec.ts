/**
 * TraceSpec — everything that decides what comes out, in one object.
 *
 * The spec describes the job, never the source image: the picture itself lives in
 * the store as a data URI and is passed alongside. That split is what lets a
 * setting be remembered between visits without dragging a megabyte of pixels
 * through localStorage with it.
 */
import { z } from 'zod'

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$/, 'expected #rrggbb or #rrggbbaa')

export const TraceSpecSchema = z.object({
  v: z.literal(1).default(1),

  background: z
    .object({
      remove: z.boolean().default(true),
      /** null = read it off the image's own border. */
      color: Color.nullable().default(null),
      /**
       * How far from the background colour a pixel must sit before it counts as
       * ink, in Oklab units — roughly, 0.02 is a shade and 0.1 is a new colour.
       */
      tolerance: z.number().min(0).max(0.6).default(0.1),
      /** Width of the fade from background to ink. Too sharp and edges go jagged. */
      softness: z.number().min(0.01).max(0.6).default(0.12),
    })
    .prefault({}),

  palette: z
    .object({
      /**
       * auto lets the census decide — the image knows how many inks it has, and it is
       * right more often than a remembered preference is.
       */
      mode: z.enum(['auto', 'single', 'multi']).default('auto'),
      /**
       * Most inks a multi-colour trace may use.
       *
       * A *cap*, deliberately not a count: how many inks an image has is a fact about
       * the image, and the spec describes the job (see the note at the top). A count
       * here would also be persisted and survive `setSource`, so a 6 chosen for one
       * picture would follow the user onto a two-colour one.
       */
      limit: z.number().int().min(2).max(8).default(6),
      /**
       * Colours to leave out, by the hex the census found — deliberately not by index.
       * The palette's order moves with `background.tolerance`, so an index would come
       * to mean a different colour the moment that slider moved.
       */
      hidden: z.array(Color).default([]),
    })
    .prefault({}),

  trace: z
    .object({
      /**
       * Blur before thresholding, px — what recovers sub-pixel edges.
       *
       * logo_svg.py:202 uses 2.0, but only for the wordmark's letterforms, which are
       * thick enough not to care. On fine artwork that value bridges any white gap
       * thinner than itself: on the reference emblem it merges two hairlines into each
       * other and into the rim — the exact failure that script sidesteps by rebuilding
       * that glyph rather than tracing it. Measured on it, 0 and 0.5 keep the hairlines
       * open, 1 thins them, 2 closes them. 0.5 keeps the sub-pixel benefit without
       * closing sub-pixel gaps. Raise it for noisy scans or JPEG ringing.
       */
      blur: z.number().min(0).max(6).default(0.5),
      /** Threshold at this multiple of the source resolution. logo_svg.py:202 UPSCALE. */
      upscale: z.number().int().min(1).max(8).default(4),
      /** Drop specks smaller than this many px. potrace's turdsize. */
      despeckle: z.number().int().min(0).max(2000).default(200),
    })
    .prefault({}),

  fit: z
    .object({
      /**
       * How far a refitted curve may stray on gentle stretches, px. Tight bends and
       * tips are always held closer than this — see fit.ts `tolerance`.
       * logo_svg.py:206 TOL_MAX.
       */
      smooth: z.number().min(0.05).max(3).default(0.8),
      /** Smoothing along the outline before refitting, px. logo_svg.py:207 SIGMA. */
      denoise: z.number().min(0).max(3).default(1),
    })
    .prefault({}),

  output: z
    .object({
      /**
       * The fill. null = use the ink colour found in the source, which is almost
       * always what is wanted: a red logo should come out red, not black.
       */
      color: Color.nullable().default(null),
      /** null = transparent, which is what a logo almost always wants. */
      background: Color.nullable().default(null),
    })
    .prefault({}),
})

export type TraceSpec = z.infer<typeof TraceSpecSchema>

export function defaultSpec(): TraceSpec {
  return TraceSpecSchema.parse({})
}

/** Margin kept around the artwork so a shape touching the edge still closes. logo_svg.py:202 PAD. */
export const PAD = 4
