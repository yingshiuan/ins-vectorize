/** A swatch that opens a picker, with a hex field and an optional dropper beside it. */
import { useEffect, useRef, useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import { normaliseHex } from './hexColor'

function DropperIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M2.5 13.5l.6-2.3 6.1-6.1 1.7 1.7-6.1 6.1-2.3.6Z" strokeLinejoin="round" />
      <path d="M9.7 4.4l1.3-1.3a1.7 1.7 0 0 1 2.4 2.4l-1.3 1.3" strokeLinecap="round" />
    </svg>
  )
}

export function ColorField({
  value,
  onChange,
  allowNone = false,
  onPick,
  picking = false,
  onAuto,
}: {
  /** null means transparent, and is only reachable when `allowNone`. */
  value: string | null
  onChange: (v: string | null) => void
  allowNone?: boolean
  /** When given, shows a dropper that arms sampling from the source image. */
  onPick?: () => void
  picking?: boolean
  /**
   * When given, shows an "Auto" button that hands the colour back to detection.
   * Distinct from `allowNone`: that one means transparent, this one means "work it
   * out from the image".
   */
  onAuto?: () => void
}) {
  const [open, setOpen] = useState(false)
  // Half-typed hex is not a colour yet, so the field keeps its own draft.
  const [draft, setDraft] = useState(value ?? '')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => setDraft(value ?? ''), [value])

  useEffect(() => {
    if (!open) return
    // pointerdown, not mousedown: a touch that dismisses the popover should not
    // also have to complete a click on whatever was underneath it.
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  return (
    <div ref={box} className="relative flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Choose a colour"
        className={`h-8 w-8 shrink-0 rounded-md border border-line ${value ? '' : 'checker'}`}
        style={value ? { background: value } : undefined}
      />

      {onPick && (
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            onPick()
          }}
          aria-pressed={picking}
          title="Take this colour from the image"
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-md border transition ${
            picking ? 'border-ink bg-ink text-white' : 'border-line bg-white text-muted hover:text-ink'
          }`}
        >
          <DropperIcon />
        </button>
      )}

      <input
        value={draft}
        placeholder={value ? '' : 'none'}
        onChange={(e) => {
          setDraft(e.target.value)
          const hex = normaliseHex(e.target.value)
          if (hex) onChange(hex)
        }}
        onBlur={() => setDraft(value ?? '')}
        className="h-8 w-full min-w-0 rounded-md border border-line px-2 font-mono text-xs outline-none focus:border-ink"
      />

      {allowNone && (
        <button
          type="button"
          onClick={() => onChange(value === null ? '#000000' : null)}
          className="shrink-0 text-[11px] text-muted underline hover:text-ink"
        >
          {value === null ? 'Set' : 'None'}
        </button>
      )}

      {onAuto && (
        <button
          type="button"
          onClick={onAuto}
          title="Take this colour from the image again"
          className="shrink-0 text-[11px] text-muted underline hover:text-ink"
        >
          Auto
        </button>
      )}

      {open && (
        <div className="absolute left-0 top-10 z-20 rounded-lg border border-line bg-white p-2 shadow-lg">
          <HexColorPicker color={value ?? '#000000'} onChange={onChange} />
        </div>
      )}
    </div>
  )
}
