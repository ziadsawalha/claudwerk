/**
 * Per-conversation live "activity phrase" -- the short "what it's doing now"
 * line fed by CC's headless `task_summary` (and, conceptually, the daemon's
 * `daemon_state_patch.detail`).
 *
 * Lives OUTSIDE Zustand (like thinking-progress-store) so the live stream never
 * triggers a Zustand re-render storm. EPHEMERAL: never persisted, never
 * replayed. Cleared on null phrase, on staleness, or explicitly.
 */

import { createExternalStoreSignal } from './external-store-utils'

/** Idle period after which a phrase is considered stale and dropped. */
const STALE_TIMEOUT_MS = 30_000
const NOTIFY_TICK_MS = 250

interface PhraseEntry {
  phrase: string
  at: number
}

const state = new Map<string, PhraseEntry>()
const signal = createExternalStoreSignal()
let dirty = false

function pruneStale(now: number): boolean {
  let changed = false
  for (const [convId, entry] of state) {
    if (now - entry.at > STALE_TIMEOUT_MS) {
      state.delete(convId)
      changed = true
    }
  }
  return changed
}

setInterval(() => {
  const stalePruned = pruneStale(Date.now())
  if (!dirty && !stalePruned) return
  dirty = false
  signal.bump()
}, NOTIFY_TICK_MS)

/** Record a phrase, or clear it when `phrase` is null. */
export function recordActivityPhrase(conversationId: string, phrase: string | null, at: number): void {
  if (phrase === null || phrase === '') {
    if (!state.has(conversationId)) return
    state.delete(conversationId)
    dirty = true
    return
  }
  state.set(conversationId, { phrase, at })
  dirty = true
}

export function clearActivityPhrase(conversationId: string): void {
  if (!state.has(conversationId)) return
  state.delete(conversationId)
  dirty = true
}

export const subscribe = signal.subscribe
export const getVersion = signal.getVersion

export function getActivityPhrase(conversationId: string): string | undefined {
  return state.get(conversationId)?.phrase
}
