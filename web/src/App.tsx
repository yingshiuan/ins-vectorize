import { useEffect, useState } from 'react'
import { Compare } from './components/Canvas/Compare'
import { Inspector } from './components/Inspector/Inspector'
import { LeftPanel } from './components/LeftPanel/LeftPanel'
import { download, filenameFor, formatBytes, svgBlob } from './export/download'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useCanRedo, useCanUndo, useTraceStore } from './store/useTraceStore'
import { cutout, toPng } from './trace/cutout'
import { useTrace } from './trace/useTrace'

/**
 * Two layouts, one tree.
 *
 * Wide: controls flanking the comparison. Narrow: the comparison stays pinned at
 * the top, because watching the trace change as you pull a slider is the entire
 * point, and the controls move into a tabbed drawer beneath. The panels are the
 * same components in both — moved, not duplicated, because only one of them may
 * own the file input.
 */
const WIDE = '(min-width: 1024px)'

type Tab = 'source' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('source')
  const wide = useMediaQuery(WIDE)
  const { spec, source, picking } = useTraceStore()
  const { undo, redo, reset, setPicking, patch } = useTraceStore()
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()
  const { img, data, result, running, error } = useTrace(spec, source)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.key.toLowerCase() !== 'z') return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const stem = filenameFor(source?.name ?? '')
  const bytes = result ? new Blob([result.svg]).size : 0

  // The traced canvas carries PAD on every side. Before a result exists, the source's
  // own size keeps the preview the right shape instead of a placeholder square.
  const canvasW = result?.width ?? source?.width ?? 100
  const canvasH = result?.height ?? source?.height ?? 100

  // The preview samples the colour; which field it lands in is the armed dropper's business.
  const onPick = (hex: string) => {
    if (picking === 'background') patch('background', { color: hex })
    else if (picking === 'output') patch('output', { color: hex })
    setPicking(null)
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line px-3 lg:h-12 lg:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-[4px] bg-ink text-[10px] font-bold text-white">
            ◹
          </span>
          <h1 className="truncate text-sm font-semibold tracking-tight">
            <span className="text-muted">ins</span> vectorize
          </h1>
          {result && (
            <span className="hidden truncate text-[11px] tabular-nums text-muted lg:inline">
              · {result.nodes} nodes · {result.outlines} outlines · {formatBytes(bytes)} ·{' '}
              {Math.round(result.ms)} ms
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1 lg:gap-1.5">
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            aria-label="Undo"
            className="h-9 w-9 rounded-md border border-line text-xs transition hover:bg-panel disabled:opacity-30 lg:h-8 lg:w-8"
          >
            ↶
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title="Redo (⇧⌘Z)"
            aria-label="Redo"
            className="h-9 w-9 rounded-md border border-line text-xs transition hover:bg-panel disabled:opacity-30 lg:h-8 lg:w-8"
          >
            ↷
          </button>
          <button
            onClick={reset}
            title="Back to the default settings"
            className="h-9 rounded-md border border-line px-2.5 text-xs transition hover:bg-panel lg:h-8"
          >
            Reset
          </button>
          <button
            disabled={!data}
            title="The source with its background removed — and any switched-off colours — as a PNG"
            onClick={async () => {
              if (!data) return
              download(await toPng(cutout(data, spec)), `${stem}-cutout.png`)
            }}
            className="h-9 rounded-md border border-line px-2.5 text-xs transition hover:bg-panel disabled:opacity-30 lg:h-8"
          >
            PNG
          </button>
          <button
            disabled={!result}
            onClick={() => result && download(svgBlob(result.svg), `${stem}.svg`)}
            className="h-9 rounded-md bg-ink px-3 text-xs font-medium text-white transition hover:bg-black disabled:opacity-30 lg:h-8"
          >
            Download SVG
          </button>
        </div>
      </header>

      {wide ? (
        <div className="flex min-h-0 flex-1">
          <aside className="w-[288px] shrink-0 overflow-hidden border-r border-line">
            <LeftPanel detected={result?.background ?? null} census={result?.census ?? null} />
          </aside>

          <main className="flex min-w-0 flex-1 flex-col items-center justify-center overflow-auto bg-panel p-6">
            <div className="w-full max-w-[720px]">
              <Compare
                src={img?.src ?? null}
                svg={result?.svg ?? null}
                width={canvasW}
                height={canvasH}
                sourceWidth={source?.width ?? canvasW}
                sourceHeight={source?.height ?? canvasH}
                running={running}
                data={data}
                picking={picking !== null}
                onPick={onPick}
                onCancelPick={() => setPicking(null)}
              />
              {error && <p className="mt-3 text-[11px] text-red-600">{error}</p>}
            </div>
          </main>

          <aside className="w-[300px] shrink-0 overflow-hidden border-l border-line">
            <Inspector detectedInk={result?.ink ?? null} layers={result?.layers ?? []} />
          </aside>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-line bg-panel p-3">
            <Compare
              src={img?.src ?? null}
              svg={result?.svg ?? null}
              width={canvasW}
              height={canvasH}
              sourceWidth={source?.width ?? canvasW}
              sourceHeight={source?.height ?? canvasH}
              running={running}
              data={data}
              picking={picking !== null}
              onPick={onPick}
              onCancelPick={() => setPicking(null)}
            />
            {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
          </div>

          <nav role="tablist" aria-label="Controls" className="flex shrink-0 border-b border-line">
            {(['source', 'settings'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`-mb-px h-11 flex-1 border-b-2 text-xs font-medium capitalize transition ${
                  tab === t ? 'border-ink text-ink' : 'border-transparent text-muted'
                }`}
              >
                {t}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'source' ? (
              <LeftPanel detected={result?.background ?? null} census={result?.census ?? null} />
            ) : (
              <Inspector detectedInk={result?.ink ?? null} layers={result?.layers ?? []} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
