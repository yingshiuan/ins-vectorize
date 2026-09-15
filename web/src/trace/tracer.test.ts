/**
 * Remembering, held to forgetting.
 *
 * A stage answered from memory is only safe if it answers exactly what running it would.
 * The ways that goes wrong are all bookkeeping — a key that misses a field, a cache hit on
 * the wrong mask, an abandoned run leaving something half-done behind — so they are checked
 * here with potrace replaced by a stand-in that counts its calls.
 */
import { describe, expect, it, vi } from 'vitest'
import { inkBounds } from './crop'
import { threeInks } from './fixtures'
import { createHost } from './host'
import type { Bitmap } from './ink'
import type { FromWorker } from './protocol'
import { defaultSpec, PAD, TraceSpecSchema, type TraceSpec } from './spec'
import { createTracer, stageKeys, Superseded, type TraceResult } from './tracer'
import type { Seg, Vec } from './vec'

/**
 * potrace's stand-in: the box around a layer's solid pixels, as one outline, grown by the
 * blur so that trace settings visibly matter. Enough for the fit to have something to do
 * and for a changed mask to show.
 */
function fakeContours() {
  const calls = { n: 0 }
  const fn = async (mask: Bitmap, trace: TraceSpec['trace']): Promise<Seg[][]> => {
    calls.n++
    const box = inkBounds({ ...mask, data: mask.data.map((v) => (v >= 128 ? 1 : 0)) })
    if (!box) return []
    const [x0, y0] = [box.x0 + PAD - trace.blur, box.y0 + PAD - trace.blur]
    const [x1, y1] = [box.x1 + PAD + trace.blur, box.y1 + PAD + trace.blur]
    const p: Vec[] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]
    return [p.map((a, i) => [a, p[(i + 1) % 4]] as Seg)]
  }
  return { fn, calls }
}

const img = threeInks()
const base = defaultSpec()
const BLUE = '#1e3fa3'

const edit = <K extends Exclude<keyof TraceSpec, 'v'>>(spec: TraceSpec, section: K, patch: Partial<TraceSpec[K]>) =>
  ({ ...spec, [section]: { ...spec[section], ...patch } }) as TraceSpec

/** A result with its timings taken out, since those are the one thing allowed to differ. */
const timeless = (r: TraceResult) => ({ ...r, ms: 0, stages: null })

describe('createTracer', () => {
  it('does not trace again when only the fit changes', async () => {
    const { fn, calls } = fakeContours()
    const tracer = createTracer(fn)
    await tracer.run(img, base)
    expect(calls.n).toBe(3)

    await tracer.run(img, edit(base, 'fit', { smooth: 1.5 }))
    expect(calls.n).toBe(3)
    expect(tracer.stats).toEqual({ separate: 1, contours: 3, fit: 6 })
  })

  it('only rebuilds the document when only the output changes', async () => {
    const { fn, calls } = fakeContours()
    const tracer = createTracer(fn)
    await tracer.run(img, base)
    const r = await tracer.run(img, edit(base, 'output', { background: '#ffffff' }))
    expect(calls.n).toBe(3)
    expect(tracer.stats.fit).toBe(3)
    expect(r.svg).toContain('<rect')
  })

  it('retraces only the layers a hidden colour changes, and nothing when it comes back', async () => {
    const { fn, calls } = fakeContours()
    const tracer = createTracer(fn)
    await tracer.run(img, base)

    // The red and the black both carry the blue above them, so both change; the blue
    // itself is not traced at all.
    await tracer.run(img, edit(base, 'palette', { hidden: [BLUE] }))
    expect(calls.n).toBe(5)

    // Back on: separated afresh into new mask objects, but pixel for pixel the first run's.
    await tracer.run(img, base)
    expect(calls.n).toBe(5)
    expect(tracer.stats.separate).toBe(3)
  })

  it('answers exactly what a fresh tracer would, step after step', async () => {
    const warm = createTracer(fakeContours().fn)
    const steps = [
      base,
      edit(base, 'fit', { smooth: 1.5 }),
      edit(base, 'trace', { blur: 1 }),
      edit(base, 'palette', { hidden: [BLUE] }),
      edit(base, 'output', { background: '#fffff0' }),
      edit(base, 'palette', { mode: 'single' }),
      edit(edit(base, 'palette', { mode: 'single' }), 'output', { color: '#123456' }),
      edit(base, 'background', { tolerance: 0.2 }),
      base,
    ]
    for (const spec of steps) {
      const cold = await createTracer(fakeContours().fn).run(img, spec)
      expect(timeless(await warm.run(img, spec))).toEqual(timeless(cold))
    }
  })

  it('keys every spec field to the stage that reads it', () => {
    // A field that changed the picture without changing its stage's key would be served
    // stale from memory, silently. So every field is changed in turn, and exactly the
    // stage that reads it has to notice.
    const owners = { background: 'separate', palette: 'separate', trace: 'contours', fit: 'fit', output: null } as const
    const variant = (value: unknown): unknown =>
      typeof value === 'boolean'
        ? !value
        : typeof value === 'number'
          ? Number.isInteger(value)
            ? value + 1
            : value / 2
          : Array.isArray(value)
            ? ['#123456']
            : value === 'auto'
              ? 'multi'
              : '#123456'

    for (const [section, stage] of Object.entries(owners) as [keyof typeof owners, string | null][]) {
      for (const [field, value] of Object.entries(base[section])) {
        const changed = TraceSpecSchema.parse({ ...base, [section]: { ...base[section], [field]: variant(value) } })
        const before = stageKeys(base)
        const after = stageKeys(changed)
        for (const s of ['separate', 'contours', 'fit'] as const) {
          expect(after[s] !== before[s], `${section}.${field} should ${s === stage ? '' : 'not '}change ${s}`).toBe(
            s === stage,
          )
        }
      }
    }
    // ...and no section has been added to the spec without a stage being named for it.
    expect(Object.keys(base).filter((k) => k !== 'v').sort()).toEqual(Object.keys(owners).sort())
  })

  it('keeps what an abandoned run finished for the run that replaces it', async () => {
    const { fn, calls } = fakeContours()
    const tracer = createTracer(fn)
    let checkpoints = 0
    const checkpoint = async () => {
      if (++checkpoints === 2) throw new Superseded()
    }
    await expect(tracer.run(img, base, { checkpoint })).rejects.toBeInstanceOf(Superseded)
    expect(calls.n).toBe(1)

    await tracer.run(img, base)
    expect(tracer.stats.separate).toBe(1)
    expect(calls.n).toBe(3)
  })
})

describe('createHost', () => {
  const image = img as unknown as ImageData

  it('finishes only the newest of a burst of traces', async () => {
    const posted: FromWorker[] = []
    const handle = createHost(createTracer(fakeContours().fn), (m) => posted.push(m))
    handle({ type: 'source', id: 1, image })
    for (const run of [1, 2, 3]) handle({ type: 'trace', run, source: 1, spec: base })

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(posted.map((m) => (m.type === 'result' ? m.run : m.type))).toEqual([3])
  })

  it('ignores a trace about an image it no longer has', async () => {
    const posted: FromWorker[] = []
    const handle = createHost(createTracer(fakeContours().fn), (m) => posted.push(m))
    handle({ type: 'source', id: 1, image })
    handle({ type: 'source', id: 2, image })
    handle({ type: 'trace', run: 1, source: 1, spec: base })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(posted).toEqual([])
  })
})
