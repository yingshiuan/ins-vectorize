/**
 * What the image was found to be made of, and which of it to paint.
 *
 * The switches live here rather than beside the fills in the Inspector because
 * `palette.hidden` is keyed by the hex the *census* found (see the note in spec.ts on
 * why not by index), and this list is where those hexes come from. Putting the control
 * anywhere else would mean a second place that has to agree about what a row is called.
 *
 * The numbers are counted *after* the background is removed, so they move with the
 * Tolerance and Softness sliders in the section below. That is worth saying out loud:
 * the panel ordering hides the dependency.
 */
import { useTraceStore } from '../../store/useTraceStore'
import { MAX_INKS, type Census, type Ink } from '../../trace/census'
import { toHex } from '../../trace/ink'
import { hidden as hiddenSet, paintedColors } from '../../trace/separate'
import { Field, Section, SegmentedControl, Slider } from '../ui'

const MODES = [
  { value: 'auto', label: 'Auto', title: 'Let the image decide' },
  { value: 'single', label: 'Single', title: 'One colour, whatever the image holds' },
  { value: 'multi', label: 'Multi', title: 'One layer per colour found' },
]

const pct = (v: number) => `${v >= 0.995 ? 100 : Math.round(v * 100)}%`

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M1.5 8S4 4 8 4s6.5 4 6.5 4S12 12 8 12 1.5 8 1.5 8Z" strokeLinejoin="round" />
      {off ? <path d="M3 13L13 3" strokeLinecap="round" /> : <circle cx="8" cy="8" r="1.9" />}
    </svg>
  )
}

/**
 * One colour in the palette.
 *
 * A row the current mode does not paint is shown but inert: there is nothing to switch
 * off, and a toggle that moved a setting without changing the picture would be worse
 * than no toggle at all.
 */
function Swatch({ ink, painted, off, onToggle }: { ink: Ink; painted: boolean; off: boolean; onToggle: () => void }) {
  const hex = toHex(ink.color)
  const body = (
    <>
      <span
        className={`h-4 w-4 shrink-0 rounded-sm border border-line ${off ? 'opacity-30' : ''}`}
        style={{ background: hex }}
        aria-hidden
      />
      <span className={`font-mono text-[11px] ${off ? 'text-muted line-through' : 'text-ink'}`}>{hex}</span>
      <span className="ml-auto text-[11px] tabular-nums text-muted">{pct(ink.share)}</span>
    </>
  )

  if (!painted) {
    return (
      <li className="flex items-center gap-2 opacity-40" title="Not painted in this mode">
        {body}
        <span className="w-3.5 text-center text-[11px] text-muted" aria-hidden>
          –
        </span>
      </li>
    )
  }

  return (
    <li>
      <button
        type="button"
        role="switch"
        aria-checked={!off}
        onClick={onToggle}
        title={off ? `Show ${hex}` : `Hide ${hex}`}
        className="flex w-full items-center gap-2 text-left"
      >
        {body}
        <span className={`shrink-0 transition ${off ? 'text-muted' : 'text-ink'}`}>
          <EyeIcon off={off} />
        </span>
      </button>
    </li>
  )
}

export function Colours({ census }: { census: Census | null }) {
  const spec = useTraceStore((s) => s.spec)
  const { patch, begin, end } = useTraceStore()
  const { mode, limit } = spec.palette

  if (!census) {
    return (
      <Section title="Colours">
        <p className="text-[11px] text-muted">Counting…</p>
      </Section>
    )
  }

  const { verdict, distinct, inks } = census
  // A photograph has no palette worth listing; show the top few as a hint of the spread.
  const shown = verdict === 'photographic' ? inks.slice(0, 6) : distinct

  const off = hiddenSet(spec)
  const painted = paintedColors(census, spec)
  const paints = new Set(painted)
  const unpainted = shown.filter((i) => !paints.has(toHex(i.color))).length
  const allOff = painted.length > 0 && painted.every((hex) => off.has(hex))

  // The cap is only worth showing when it can actually bite. Its floor is 2, so with two
  // inks or fewer every one of them is painted at every setting, and in single mode or on
  // a photograph the palette is not consulted at all — a slider there would move a stored
  // number without changing the picture, which is the same dead control the inert swatch
  // rows avoid. MAX_INKS is the ceiling because that is as many as the census reports.
  const capMatters = verdict !== 'photographic' && mode !== 'single' && distinct.length > 2

  const toggle = (hex: string) =>
    patch('palette', {
      hidden: off.has(hex) ? spec.palette.hidden.filter((h) => h.toLowerCase() !== hex) : [...spec.palette.hidden, hex],
    })

  return (
    <Section
      title="Colours"
      aside={
        <span className="flex items-center gap-2">
          {off.size > 0 && (
            <button
              onClick={() => patch('palette', { hidden: [] })}
              className="text-[11px] text-muted underline hover:text-ink"
            >
              Show all
            </button>
          )}
          <span className="text-[11px] tabular-nums text-muted">
            {verdict === 'photographic' ? `${census.clusters}+` : distinct.length}
          </span>
        </span>
      }
    >
      <p className="text-[11px] leading-snug text-ink">
        {verdict === 'single' && (
          <>
            One ink — <span className="font-mono">{toHex(distinct[0].color)}</span>, {pct(distinct[0].share)} of
            the artwork.
          </>
        )}
        {verdict === 'multi' && <>{distinct.length} inks.</>}
        {verdict === 'photographic' && <>Photographic — tracing will lose most of this.</>}
      </p>

      <ul className="space-y-1.5">
        {shown.map((ink) => {
          const hex = toHex(ink.color)
          return (
            <Swatch key={hex} ink={ink} painted={paints.has(hex)} off={off.has(hex)} onToggle={() => toggle(hex)} />
          )
        })}
      </ul>

      <SegmentedControl
        columns={3}
        value={mode}
        onChange={(v) => patch('palette', { mode: v as 'auto' | 'single' | 'multi' })}
        options={MODES}
      />

      {capMatters && (
        <Field label="Most colours" hint={`${limit}`}>
          <Slider
            min={2}
            max={MAX_INKS}
            step={1}
            value={limit}
            onChange={(v) => patch('palette', { limit: Math.round(v) })}
            onCommitStart={begin}
            onCommitEnd={end}
          />
        </Field>
      )}

      {allOff && (
        <p className="text-[11px] leading-snug text-red-600">
          Every colour is switched off, so the export is empty. Show one to get a shape back.
        </p>
      )}

      <p className="text-[11px] leading-snug text-muted">
        {verdict === 'photographic'
          ? 'A photograph has no palette to separate, so this traces as one colour whichever mode is chosen — you will get a silhouette rather than the picture.'
          : unpainted > 0 && painted.length === 1
            ? 'Single mode paints the dominant ink only. Switch to Multi to get a layer per colour, each with its own switch.'
            : unpainted > 0
              ? `The cap is leaving ${unpainted} out. Raise it to paint ${unpainted === 1 ? 'it' : 'them'}.`
              : 'Switch a colour off to leave it out of the SVG and the PNG. It leaves a hole rather than showing the colour underneath, and is not traced at all, so hiding one is also faster.'}
      </p>
    </Section>
  )
}
