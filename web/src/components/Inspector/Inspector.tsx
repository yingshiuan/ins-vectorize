/** How the outline is traced, how closely it is followed, and what colour it comes out. */
import { useTraceStore } from '../../store/useTraceStore'
import type { TraceLayer } from '../../trace/pipeline'
import { Field, Section, Slider } from '../ui'
import { ColorField } from '../ColorField'

export function Inspector({
  detectedInk,
  layers,
}: {
  detectedInk: string | null
  layers: readonly TraceLayer[]
}) {
  const spec = useTraceStore((s) => s.spec)
  const picking = useTraceStore((s) => s.picking)
  const { patch, setPicking, begin, end } = useTraceStore()

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Section title="Trace">
        <Field label="Edge softening" hint={`${spec.trace.blur.toFixed(1)} px`}>
          <Slider
            min={0}
            max={6}
            step={0.1}
            value={spec.trace.blur}
            onChange={(v) => patch('trace', { blur: v })}
            onCommitStart={begin}
            onCommitEnd={end}
          />
        </Field>
        <p className="text-[11px] leading-snug text-muted">
          Blurring before the threshold is what recovers sub-pixel edges: it turns the
          anti-aliased fringe into a ramp, so an edge lands where the original implied rather
          than snapping to the pixel grid.
        </p>

        <Field label="Despeckle" hint={`${spec.trace.despeckle} px`}>
          <Slider
            min={0}
            max={1200}
            step={10}
            value={spec.trace.despeckle}
            onChange={(v) => patch('trace', { despeckle: Math.round(v) })}
            onCommitStart={begin}
            onCommitEnd={end}
          />
        </Field>
      </Section>

      <Section title="Fit">
        <Field label="Smoothing" hint={`${spec.fit.smooth.toFixed(2)} px`}>
          <Slider
            min={0.05}
            max={3}
            step={0.05}
            value={spec.fit.smooth}
            onChange={(v) => patch('fit', { smooth: v })}
            onCommitStart={begin}
            onCommitEnd={end}
          />
        </Field>
        <p className="text-[11px] leading-snug text-muted">
          How far a curve may stray on gentle stretches. Tips and tight bends are always held
          closer than this, which is why raising it removes wobble instead of rounding corners off.
        </p>

        <Field label="Denoise" hint={`${spec.fit.denoise.toFixed(2)} px`}>
          <Slider
            min={0}
            max={3}
            step={0.05}
            value={spec.fit.denoise}
            onChange={(v) => patch('fit', { denoise: v })}
            onCommitStart={begin}
            onCommitEnd={end}
          />
        </Field>
      </Section>

      <Section title="Output">
        {layers.length > 1 ? (
          /* One fill cannot describe several layers, so this becomes a readout. Each
             colour came from the image and is edited by changing what is detected — and
             switched on and off in the Colours panel, which owns the palette's hexes. */
          <Field label="Fills" hint={`${layers.filter((l) => l.visible).length} of ${layers.length} painted`}>
            <ul className="space-y-1.5">
              {layers.map((l, i) => (
                <li key={`${l.color}-${i}`} className="flex items-center gap-2">
                  <span
                    className={`h-4 w-4 shrink-0 rounded-sm border border-line ${l.visible ? '' : 'opacity-30'}`}
                    style={{ background: l.color }}
                    aria-hidden
                  />
                  <span className={`font-mono text-[11px] ${l.visible ? 'text-ink' : 'text-muted line-through'}`}>
                    {l.color}
                  </span>
                  <span className="ml-auto text-[11px] tabular-nums text-muted">
                    {l.visible ? `${l.outlines} outline${l.outlines === 1 ? '' : 's'}` : 'hidden'}
                  </span>
                </li>
              ))}
            </ul>
          </Field>
        ) : (
          <Field
            label="Fill"
            hint={spec.output.color ? 'set by hand' : detectedInk ? `detected ${detectedInk}` : 'from the image'}
          >
            <ColorField
              value={spec.output.color ?? detectedInk}
              onChange={(v) => patch('output', { color: v })}
              onAuto={spec.output.color ? () => patch('output', { color: null }) : undefined}
              onPick={() => setPicking(picking === 'output' ? null : 'output')}
              picking={picking === 'output'}
            />
          </Field>
        )}
        <Field label="Background">
          <ColorField
            value={spec.output.background}
            onChange={(v) => patch('output', { background: v })}
            allowNone
          />
        </Field>
      </Section>
    </div>
  )
}
