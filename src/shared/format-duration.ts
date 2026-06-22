/**
 * Compact human-readable duration: `45s`, `12m`, `3h 20m`. For at-a-glance
 * "age" / "idle" readouts (status age, last-input age, conversation age).
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}
