/**
 * Settings saved by an earlier version still load.
 *
 * The store keeps the spec in localStorage and drops one that fails to parse, so a field
 * added without a default would silently reset every saved spec in every browser.
 */
import { describe, expect, it } from 'vitest'
import { TraceSpecSchema, defaultSpec } from './spec'

describe('TraceSpecSchema', () => {
  it('reads a spec saved before circles were detected', () => {
    const saved = { v: 1, fit: { smooth: 1.2, denoise: 0.5 } }
    const spec = TraceSpecSchema.parse(saved)
    expect(spec.fit).toEqual({ ...defaultSpec().fit, smooth: 1.2, denoise: 0.5 })
    expect(spec.fit.shapes).toBe(true)
    expect(spec.fit.repeats).toBe(true)
  })

  it('still reads an empty object as the defaults', () => {
    expect(TraceSpecSchema.parse({})).toEqual(defaultSpec())
  })
})
