/**
 * The dispatcher's SHORT-LIVED recent window (plan-dispatcher-brain.md P6).
 *
 * The dispatch conversation does NOT accumulate forever -- the durable load
 * lives in condensed project memory (P3), not the chat log. This holds only the
 * last ~30 minutes of (intent, reply) turns per user, so the assembled system
 * prompt carries a little continuity ("you just asked me to X") without the
 * dispatcher hoarding context. Pruned by age + count on every read/write.
 *
 * In-memory + per-user (keyed by the authed userId). Lost on broker restart by
 * design -- it is a working window, not memory.
 */

export interface RecentTurn {
  ts: number
  intent: string
  reply: string
}

const WINDOW_MS = 30 * 60_000
const MAX_TURNS = 12

const windows = new Map<string, RecentTurn[]>()

function keyOf(userId: string | null | undefined): string {
  return userId ?? '_'
}

function prune(turns: RecentTurn[], now: number): RecentTurn[] {
  const fresh = turns.filter(t => now - t.ts <= WINDOW_MS)
  return fresh.length > MAX_TURNS ? fresh.slice(fresh.length - MAX_TURNS) : fresh
}

/** Append a completed dispatch turn to the user's window (then prune). */
export function recordDispatchTurn(userId: string | null | undefined, turn: RecentTurn): void {
  if (!turn.reply.trim()) return
  const key = keyOf(userId)
  const next = prune([...(windows.get(key) ?? []), turn], turn.ts)
  windows.set(key, next)
}

/** The user's recent turns, newest last, pruned to the live window. */
export function recentTurns(userId: string | null | undefined, now: number): RecentTurn[] {
  const key = keyOf(userId)
  const pruned = prune(windows.get(key) ?? [], now)
  windows.set(key, pruned)
  return pruned
}

/** Test isolation. */
export function clearRecentWindows(): void {
  windows.clear()
}
