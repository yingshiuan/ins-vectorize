/**
 * The source and the trace, on one surface.
 *
 * A vector is only as good as it looks against what it came from, so the default
 * view is a split: bitmap on the left, vector on the right, with a handle between
 * them. The bitmap is drawn `pixelated` on purpose — smoothing it would hide the
 * staircase the trace is being judged against.
 *
 * Zoom is the other half of the judgement. At fit size every tracer looks fine; the
 * difference shows up at 8x on a curve's shoulder. So the view opens showing the
 * whole image and getting closer is one click.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react'
import { toHex } from '../../trace/ink'
import { sourcePixel } from '../../trace/pick'
import { SegmentedControl } from '../ui'

export type View = 'split' | 'vector' | 'source' | 'overlay'

/** Scale is CSS px per SVG unit. The ceiling is for inspecting single edges. */
const MAX_SCALE = 64
/** Breathing room around the artwork when fitted. */
const FIT_MARGIN = 0.94

const VIEWS = [
  { value: 'split', label: 'Split', title: 'Source left, vector right' },
  { value: 'vector', label: 'Vector', title: 'The traced result alone' },
  { value: 'source', label: 'Source', title: 'The original bitmap alone' },
  { value: 'overlay', label: 'Over', title: 'Vector laid over the source' },
]

const ZOOMS = [
  { value: 'fit', label: 'Fit', title: 'Show the whole image' },
  { value: '2', label: '2×', title: 'Twice fit size' },
  { value: '4', label: '4×', title: 'Four times fit size' },
  { value: '8', label: '8×', title: 'Eight times fit size' },
  { value: '16', label: '16×', title: 'Sixteen times fit size' },
]

export function Compare({
  src,
  svg,
  width,
  height,
  sourceWidth = width,
  sourceHeight = height,
  running,
  data = null,
  picking = false,
  onPick,
  onCancelPick,
}: {
  src: string | null
  svg: string | null
  /** The traced canvas, in SVG units — the source plus PAD on every side. */
  width: number
  height: number
  /** The source bitmap's own size, so it can be registered against the vector. */
  sourceWidth?: number
  sourceHeight?: number
  running: boolean
  /** The decoded source pixels, so the dropper reads the file rather than the screen. */
  data?: ImageData | null
  picking?: boolean
  onPick?: (hex: string) => void
  onCancelPick?: () => void
}) {
  const [view, setView] = useState<View>('split')
  const [split, setSplit] = useState(50)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [box, setBox] = useState({ w: 0, h: 0 })
  const surface = useRef<HTMLDivElement>(null)
  const drag = useRef<{ kind: 'pan' | 'split'; x: number; y: number; panX: number; panY: number } | null>(null)
  /** Set once the view has been zoomed or panned by hand, so a resize cannot undo it. */
  const touched = useRef(false)

  useEffect(() => {
    const el = surface.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect
      setBox({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** The scale at which the whole image is on screen. */
  const fitScale = useMemo(() => {
    if (!box.w || !box.h || !width || !height) return 0
    return Math.min(box.w / width, box.h / height) * FIT_MARGIN
  }, [box.w, box.h, width, height])

  const fit = useCallback(() => {
    if (!fitScale) return
    setScale(fitScale)
    setPan({ x: 0, y: 0 })
  }, [fitScale])

  // A new image is a new job: show all of it. Afterwards the view is the user's.
  useEffect(() => {
    touched.current = false
  }, [width, height])

  useEffect(() => {
    if (touched.current || !fitScale) return
    setScale(fitScale)
    setPan({ x: 0, y: 0 })
  }, [fitScale, width, height])

  const zoomTo = (next: number) => {
    touched.current = true
    setScale(Math.min(MAX_SCALE, Math.max(fitScale * 0.5 || 0.01, next)))
  }

  useEffect(() => {
    if (!picking) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelPick?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picking, onCancelPick])

  const onPointerDown = (e: ReactPointerEvent) => {
    if (picking) {
      // A click that lands off the artwork stays armed rather than cancelling —
      // missing is far more likely to be a slip than a change of mind.
      const hex = sampleAt(e.clientX, e.clientY)
      if (hex) onPick?.(hex)
      return
    }
    const onHandle = (e.target as HTMLElement).dataset.handle === 'split'
    drag.current = { kind: onHandle ? 'split' : 'pan', x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.kind === 'split') {
      const rect = surface.current?.getBoundingClientRect()
      if (rect) setSplit(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)))
    } else {
      touched.current = true
      setPan({ x: d.panX + (e.clientX - d.x), y: d.panY + (e.clientY - d.y) })
    }
  }

  const stop = () => {
    drag.current = null
  }

  const onWheel = (e: WheelEvent) => {
    if (e.deltaY === 0) return
    zoomTo(scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12))
  }

  /** Which preset the current scale corresponds to, or '' when it sits between them. */
  const activeZoom = useMemo(() => {
    if (!fitScale) return ''
    if (Math.abs(scale - fitScale) < fitScale * 1e-3) return 'fit'
    return ZOOMS.slice(1).find((z) => Math.abs(scale - fitScale * Number(z.value)) < fitScale * 1e-3)?.value ?? ''
  }, [scale, fitScale])

  const percent = scale >= 1 ? Math.round(scale * 100) : Number((scale * 100).toPrecision(2))

  const padX = Math.max(0, (width - sourceWidth) / 2)
  const padY = Math.max(0, (height - sourceHeight) / 2)

  /**
   * The source pixel under a screen point, as hex.
   *
   * Read out of the decoded file rather than off the screen. At fit size the preview
   * is a downscaled render, so sampling what is displayed would return a blended
   * pixel anywhere near an edge instead of a colour that is actually in the image —
   * which is the whole reason not to use the native EyeDropper here.
   */
  const sampleAt = (clientX: number, clientY: number): string | null => {
    const rect = surface.current?.getBoundingClientRect()
    if (!rect || !data) return null
    // The decoded image is authoritative about its own size; the props describe the
    // stage it is drawn on.
    const at = sourcePixel(clientX, clientY, {
      rect,
      pan,
      scale,
      width,
      height,
      padX,
      padY,
      sourceWidth: data.width,
      sourceHeight: data.height,
    })
    if (!at) return null
    const i = (at.y * data.width + at.x) * 4
    if (data.data[i + 3] === 0) return null // nothing there to take a colour from
    return toHex({ r: data.data[i], g: data.data[i + 1], b: data.data[i + 2] })
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <div
        ref={surface}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stop}
        onPointerCancel={stop}
        onWheel={onWheel}
        className={`checker relative h-[52dvh] w-full touch-none select-none overflow-hidden rounded-lg border ${
          picking ? 'cursor-crosshair border-ink' : 'border-line'
        }`}
      >
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute left-1/2 top-1/2"
            style={{
              width,
              height,
              /*
               * `translate(-50%, -50%)` puts this box's own centre on the container's
               * centre whatever its size, which is the point: `grid place-items-center`
               * cannot. An item wider than the container grows the implicit track to
               * match instead of centring, leaving the box laid out from the left edge
               * -- so scaling about its centre threw the artwork off to one side.
               */
              transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              transformOrigin: 'center center',
            }}
          >
            {src && (view === 'source' || view === 'split' || view === 'overlay') && (
              /*
               * Inset by the margin the trace added. The stage is the traced canvas,
               * which carries PAD on every side; the bitmap is the artwork alone. Left
               * to fill the stage it would sit a few units out from the vector -- which
               * is precisely the misalignment the split view exists to reveal.
               */
              <img
                src={src}
                alt=""
                draggable={false}
                className="pixelated absolute"
                style={{
                  left: `${(padX / width) * 100}%`,
                  top: `${(padY / height) * 100}%`,
                  width: `${(sourceWidth / width) * 100}%`,
                  height: `${(sourceHeight / height) * 100}%`,
                }}
              />
            )}

            {svg && view !== 'source' && (
              <div
                className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full"
                style={{
                  clipPath: view === 'split' ? `inset(0 0 0 ${split}%)` : undefined,
                  opacity: view === 'overlay' ? 0.55 : 1,
                }}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            )}
          </div>
        </div>

        {view === 'split' && svg && (
          <div
            className="absolute inset-y-0 z-10 w-px bg-ink/25"
            style={{ left: `${split}%` }}
            role="separator"
            aria-label="Comparison split"
          >
            <div
              data-handle="split"
              title="Drag to move the split"
              className="absolute top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-line bg-white text-[10px] text-muted shadow-sm"
            >
              ↔
            </div>
          </div>
        )}

        {!src && <p className="absolute inset-0 grid place-items-center text-xs text-muted">Drop an image to start</p>}

        {running && !picking && (
          <span className="absolute right-2 top-2 rounded-md bg-ink/80 px-2 py-1 text-[11px] text-white">tracing…</span>
        )}

        {picking && (
          <span className="absolute left-1/2 top-2 -translate-x-1/2 rounded-md bg-ink/85 px-2.5 py-1 text-[11px] text-white">
            Click the image to take a colour · Esc to cancel
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-[240px] shrink-0">
          <SegmentedControl columns={4} value={view} onChange={(v) => setView(v as View)} options={VIEWS} />
        </div>
        <div className="w-[260px] shrink-0">
          <SegmentedControl
            columns={5}
            value={activeZoom}
            onChange={(v) => (v === 'fit' ? fit() : zoomTo(fitScale * Number(v)))}
            options={ZOOMS}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="range"
          className="w-full"
          aria-label="Zoom"
          min={Math.log2(Math.max(fitScale * 0.5, 0.01))}
          max={Math.log2(MAX_SCALE)}
          step={0.02}
          value={Math.log2(Math.max(scale, 0.01))}
          onChange={(e) => zoomTo(2 ** Number(e.target.value))}
        />
        <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted">{percent}%</span>
        {/* Distinct from Fit on purpose: Fit also resets the zoom, and after looking
            closely at something the zoom is usually the part worth keeping. */}
        <button
          type="button"
          onClick={() => setPan({ x: 0, y: 0 })}
          disabled={pan.x === 0 && pan.y === 0}
          title="Bring the image back to the middle, keeping the zoom"
          className="h-8 shrink-0 rounded-md border border-line px-2.5 text-xs transition hover:bg-panel disabled:opacity-30"
        >
          Center
        </button>
      </div>
    </div>
  )
}
