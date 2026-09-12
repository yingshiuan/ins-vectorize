/**
 * The settings being edited, the image they apply to, and undo/redo.
 *
 * The image is deliberately *not* persisted. inscode stores its logo in
 * localStorage because a QR design is meaningless without it, but here the source
 * is whatever was dropped a moment ago and can run to several megabytes — past the
 * storage quota on its own, and gone from the user's mind by the next visit. The
 * settings are the part worth keeping, so those are all that is written.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { defaultSpec, TraceSpecSchema, type TraceSpec } from '../trace/spec'

export interface Source {
  /** data: URI. Never a remote URL — the page must keep working offline. */
  src: string
  name: string
  width: number
  height: number
  bytes: number
}

const HISTORY_LIMIT = 60
const STORAGE_KEY = 'vectorize'

type Section = 'background' | 'palette' | 'trace' | 'fit' | 'output'

/** Which colour a dropper is currently waiting to fill from the image. */
export type PickTarget = 'background' | 'output'

interface TraceState {
  spec: TraceSpec
  source: Source | null
  past: TraceSpec[]
  future: TraceSpec[]
  /** Set while a drag is in flight, so intermediate frames do not each land in history. */
  txn: TraceSpec | null
  /**
   * Armed dropper, if any. Transient UI state rather than part of the design, so it
   * stays out of both history and storage.
   */
  picking: PickTarget | null

  patch<K extends Section>(section: K, values: Partial<TraceSpec[K]>): void
  setSource(source: Source | null): void
  setPicking(target: PickTarget | null): void
  replace(spec: TraceSpec): void

  begin(): void
  end(): void
  undo(): void
  redo(): void
  reset(): void
}

export const useTraceStore = create<TraceState>()(
  persist(
    (set, get) => {
      /** Commit a new spec, recording the previous one unless a transaction owns history. */
      const commit = (next: TraceSpec) =>
        set((s) => {
          if (s.txn) return { spec: next }
          return { spec: next, past: [...s.past, s.spec].slice(-HISTORY_LIMIT), future: [] }
        })

      return {
        spec: defaultSpec(),
        source: null,
        past: [],
        future: [],
        txn: null,
        picking: null,

        patch: (section, values) =>
          commit({ ...get().spec, [section]: { ...get().spec[section], ...values } }),

        // A new image starts a new job: the old history belongs to the old picture.
        setSource: (source) => set({ source, past: [], future: [], txn: null, picking: null }),

        setPicking: (picking) => set({ picking }),

        replace: (spec) => commit(spec),

        begin: () => set((s) => (s.txn ? s : { txn: s.spec })),
        end: () =>
          set((s) => {
            if (!s.txn) return s
            if (s.txn === s.spec) return { txn: null }
            return { txn: null, past: [...s.past, s.txn].slice(-HISTORY_LIMIT), future: [] }
          }),

        undo: () =>
          set((s) => {
            const prev = s.past.at(-1)
            if (!prev) return s
            return { spec: prev, past: s.past.slice(0, -1), future: [s.spec, ...s.future] }
          }),
        redo: () =>
          set((s) => {
            const [next, ...rest] = s.future
            if (!next) return s
            return { spec: next, past: [...s.past, s.spec], future: rest }
          }),
        reset: () => set({ spec: defaultSpec(), past: [], future: [], txn: null, picking: null }),
      }
    },
    {
      name: STORAGE_KEY,
      version: 1,
      partialize: (s) => ({ spec: s.spec }),
      merge: (persisted, current) => {
        const p = persisted as { spec?: unknown } | undefined
        const parsed = TraceSpecSchema.safeParse(p?.spec)
        return { ...current, spec: parsed.success ? parsed.data : current.spec }
      },
    },
  ),
)

/** Undo/redo availability without subscribing to the whole history array. */
export const useCanUndo = () => useTraceStore((s) => s.past.length > 0)
export const useCanRedo = () => useTraceStore((s) => s.future.length > 0)
