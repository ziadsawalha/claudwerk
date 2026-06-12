const MAX_NAME_CHARS = 48
const MIN_NAME_CHARS = 3

/**
 * Normalize a model-suggested conversation name into the requested shape:
 * short, lowercase, letters/digits/spaces plus `:` (type prefix like
 * "bug: invalid name") and `-`. Returns null when nothing usable survives,
 * so a garbage suggestion never becomes a title.
 */
export function sanitizeSuggestedName(raw: string | null): string | null {
  if (!raw) return null
  let s = raw.toLowerCase()
  s = s.replace(/[_/.]+/g, ' ')
  s = s.replace(/[^a-z0-9:\s-]+/g, '')
  s = s.replace(/\s*:\s*/g, ': ')
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/^[-:\s]+/, '').replace(/[-:\s]+$/, '')
  if (s.length > MAX_NAME_CHARS) {
    s = s
      .slice(0, MAX_NAME_CHARS)
      .replace(/\s+\S*$/, '')
      .trim()
  }
  return s.length >= MIN_NAME_CHARS ? s : null
}
