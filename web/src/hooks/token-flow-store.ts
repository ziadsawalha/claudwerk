/**
 * Token-flow data layer for the header widget. Lives OUTSIDE React/Zustand (like
 * ws-stats.ts) so the high-frequency live `token_sample` stream never triggers a
 * Zustand update or a re-render per message. Consumers read via
 * useSyncExternalStore(subscribe, getVersion) and pull getSamples() in render.
 *
 * - Live: the `token_sample` WS handler calls recordTokenSample() -> ring.
 * - Seed: seedRing() pulls the last 2h from /api/stats/tokens once on mount so
 *   the chart isn't empty before live events arrive.
 * - Short windows (5m/30m/2h) render by bucketizing the ring client-side.
 * - Long windows (5h/1d) fetch buckets straight from the server (fetchWindow).
 *
 * Tokens only; cost is a render-time multiply (model is carried per sample).
 */

export interface TokenSample {
  ts: number
  sentinelId: string
  profile: string
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface FlowBucket {
  bucketStart: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** Server shape from GET /api/stats/tokens. */
export interface ServerTokenBucket {
  bucketStart: number
  sentinelId: string
  profile: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  samples: number
}

export interface TokenWindowResponse {
  window: string
  from: number
  to: number
  bucketMs: number
  groupBy: 'global' | 'profile'
  buckets: ServerTokenBucket[]
}

// The ring covers a bit more than the longest ring-served window (2h) so
// bucketizing a full 2h view always has data at the left edge.
const RING_MS = 2 * 60 * 60 * 1000 + 5 * 60_000
const NOTIFY_TICK_MS = 1000

const ring: TokenSample[] = []
let version = 0
let dirty = false
const listeners = new Set<() => void>()

function prune(now: number): void {
  const cutoff = now - RING_MS
  let drop = 0
  while (drop < ring.length && ring[drop].ts < cutoff) drop++
  if (drop > 0) ring.splice(0, drop)
}

// Coalesce notifications onto a 1s tick (the live stream can be many per second
// across a fleet; the widget only needs ~1Hz liveness). Only fires when dirty.
setInterval(() => {
  if (!dirty) return
  dirty = false
  prune(Date.now())
  version++
  for (const fn of listeners) fn()
}, NOTIFY_TICK_MS)

export function recordTokenSample(s: TokenSample): void {
  ring.push(s)
  dirty = true
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Stable primitive snapshot for useSyncExternalStore. */
export function getVersion(): number {
  return version
}

export function getSamples(): readonly TokenSample[] {
  return ring
}

/** Distinct (sentinelId, profile) pairs currently in the ring, for the per-profile popover. */
export function activeProfiles(): Array<{ sentinelId: string; profile: string }> {
  const seen = new Map<string, { sentinelId: string; profile: string }>()
  for (const s of ring) {
    const key = `${s.sentinelId}\0${s.profile}`
    if (!seen.has(key)) seen.set(key, { sentinelId: s.sentinelId, profile: s.profile })
  }
  return [...seen.values()]
}

/**
 * Bucketize samples into a DENSE series across [from, to) -- one column per
 * bucket including empty (zero) buckets, so the sparkline has a continuous time
 * axis (idle gaps read as flat, Little-Snitch style). `match` optionally filters
 * to one (sentinelId, profile) series.
 */
export function bucketize(
  samples: readonly TokenSample[],
  from: number,
  to: number,
  bucketMs: number,
  match?: { sentinelId: string; profile: string },
): FlowBucket[] {
  const count = Math.max(1, Math.ceil((to - from) / bucketMs))
  const out: FlowBucket[] = new Array(count)
  for (let i = 0; i < count; i++) {
    out[i] = { bucketStart: from + i * bucketMs, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  }
  for (const s of samples) {
    if (s.ts < from || s.ts >= to) continue
    if (match && (s.sentinelId !== match.sentinelId || s.profile !== match.profile)) continue
    const idx = Math.floor((s.ts - from) / bucketMs)
    const b = out[idx]
    if (!b) continue
    b.input += s.input
    b.output += s.output
    b.cacheRead += s.cacheRead
    b.cacheWrite += s.cacheWrite
  }
  return out
}

/** Fetch a windowed bucket series from the server (long windows + seeding). */
export async function fetchWindow(window: string, groupBy: 'global' | 'profile'): Promise<TokenWindowResponse> {
  const res = await fetch(`/api/stats/tokens?window=${encodeURIComponent(window)}&groupBy=${groupBy}`, {
    credentials: 'same-origin',
  })
  if (!res.ok) throw new Error(`token stats fetch failed: ${res.status}`)
  return (await res.json()) as TokenWindowResponse
}

/**
 * Seed the ring from the last 2h once on mount, so short-window views aren't
 * empty before live samples arrive. Each server bucket becomes one synthetic
 * sample at its bucket start (per-profile preserved). Live samples are finer and
 * take over as time advances. Best-effort -- failures are swallowed.
 */
export async function seedRing(): Promise<void> {
  try {
    const data = await fetchWindow('2h', 'profile')
    for (const b of data.buckets) {
      ring.push({
        ts: b.bucketStart,
        sentinelId: b.sentinelId,
        profile: b.profile,
        model: '',
        input: b.inputTokens,
        output: b.outputTokens,
        cacheRead: b.cacheReadTokens,
        cacheWrite: b.cacheWriteTokens,
      })
    }
    dirty = true
  } catch {
    // ignore -- the widget fills from the live stream regardless
  }
}
