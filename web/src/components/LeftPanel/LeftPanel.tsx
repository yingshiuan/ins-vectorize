/** The source image, and what counts as its background. */
import { useRef, useState } from 'react'
import { loadImage } from '../../export/download'
import { useTraceStore } from '../../store/useTraceStore'
import type { Census } from '../../trace/census'
import { Field, Section, Slider, Toggle } from '../ui'
import { ColorField } from '../ColorField'
import { Colours } from './Colours'

const MAX_BYTES = 12 * 1024 * 1024

export function LeftPanel({ detected, census }: { detected: string | null; census: Census | null }) {
  const { spec, source, picking } = useTraceStore()
  const { patch, setSource, setPicking, begin, end } = useTraceStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dropping, setDropping] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  const readFile = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setFileError('That is not an image file.')
      return
    }
    if (file.size > MAX_BYTES) {
      setFileError('Images over 12 MB take a long time to trace — try a smaller one.')
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      const src = String(reader.result)
      try {
        const img = await loadImage(src)
        setFileError(null)
        setSource({
          src,
          name: file.name,
          width: img.naturalWidth,
          height: img.naturalHeight,
          bytes: file.size,
        })
      } catch {
        setFileError('That file could not be read as an image.')
      }
    }
    reader.onerror = () => setFileError('That file could not be read.')
    reader.readAsDataURL(file)
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Section
        title="Source"
        aside={
          source && (
            <button onClick={() => setSource(null)} className="text-[11px] text-muted underline hover:text-ink">
              Remove
            </button>
          )
        }
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
          className="hidden"
          onChange={(e) => readFile(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDropping(true)
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDropping(false)
            readFile(e.dataTransfer.files?.[0])
          }}
          className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-5 transition ${
            dropping ? 'border-accent bg-blue-50' : 'border-line hover:border-zinc-300 hover:bg-panel'
          }`}
        >
          {source ? (
            <img src={source.src} alt="" className="max-h-14 max-w-[70%] object-contain" />
          ) : (
            <span className="text-xl text-muted">＋</span>
          )}
          <span className="text-[11px] text-muted">
            {source ? 'Replace image' : 'Choose a PNG or JPG'}
            {!source && <span className="hidden lg:inline"> — or drop one here</span>}
          </span>
        </button>
        {source && (
          <p className="text-[11px] tabular-nums text-muted">
            {source.name} · {source.width}×{source.height}
          </p>
        )}
        {fileError && <p className="text-[11px] text-red-600">{fileError}</p>}
      </Section>

      {/* Above Background on purpose: it reports what the settings below produced. */}
      {source && <Colours census={census} />}

      <Section title="Background">
        <Toggle
          checked={spec.background.remove}
          onChange={(v) => patch('background', { remove: v })}
          label="Remove the background"
          hint="Works out which colour the page is and drops it. No model, and exact on flat artwork."
        />

        {spec.background.remove && (
          <>
            <Field
              label="Colour"
              hint={spec.background.color ? 'set by hand' : detected ? `detected ${detected}` : 'from the border'}
            >
              <ColorField
                value={spec.background.color ?? detected}
                onChange={(v) => patch('background', { color: v })}
                onAuto={spec.background.color ? () => patch('background', { color: null }) : undefined}
                onPick={() => setPicking(picking === 'background' ? null : 'background')}
                picking={picking === 'background'}
              />
            </Field>

            <Field label="Tolerance" hint={spec.background.tolerance.toFixed(2)}>
              <Slider
                min={0}
                max={0.6}
                step={0.005}
                value={spec.background.tolerance}
                onChange={(v) => patch('background', { tolerance: v })}
                onCommitStart={begin}
                onCommitEnd={end}
              />
            </Field>

            <Field label="Softness" hint={spec.background.softness.toFixed(2)}>
              <Slider
                min={0.01}
                max={0.6}
                step={0.005}
                value={spec.background.softness}
                onChange={(v) => patch('background', { softness: v })}
                onCommitStart={begin}
                onCommitEnd={end}
              />
            </Field>
            <p className="text-[11px] leading-snug text-muted">
              Distances are perceptual: about 0.02 is a shade, 0.1 a different colour. Raise the
              tolerance if background survives; lower it if the artwork is being eaten.
            </p>
          </>
        )}
      </Section>
    </div>
  )
}
