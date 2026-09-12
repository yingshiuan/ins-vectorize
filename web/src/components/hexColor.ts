/** `#rgb` and a missing `#` both mean what you think they mean. */
export function normaliseHex(input: string): string | null {
  const h = input.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase()
  }
  if (/^[0-9a-fA-F]{6}$/.test(h)) return `#${h}`.toLowerCase()
  return null
}
