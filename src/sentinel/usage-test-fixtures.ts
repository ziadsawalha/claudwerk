/**
 * Shared usage-snapshot fixtures for the sentinel usage tests
 * (`usage-cache.test.ts`, `usage-headroom.test.ts`). Kept in one place so the
 * snapshot scaffolding isn't duplicated across the suites.
 */

import type { ProfileUsageSnapshot } from '../shared/protocol'

/** Fixed clock used across the usage tests. */
export const NOW = 1_000_000_000_000

/** An authed, error-free snapshot with both windows. Override any field. */
export function goodSnapshot(over: Partial<ProfileUsageSnapshot> = {}): ProfileUsageSnapshot {
  return {
    profile: 'default',
    authed: true,
    polledAt: NOW,
    fiveHour: { usedPercent: 1, resetAt: new Date(NOW + 60 * 60 * 1000).toISOString() },
    sevenDay: { usedPercent: 12, resetAt: new Date(NOW + 6 * 24 * 60 * 60 * 1000).toISOString() },
    ...over,
  }
}

/** Authed but throttled (HTTP 429) -- no windows. */
export const rateLimitedSnapshot: ProfileUsageSnapshot = {
  profile: 'default',
  authed: true,
  polledAt: NOW,
  error: { kind: 'http', status: 429, detail: 'Rate limited', retryAfterMs: 1_620_000 },
}

/** Authed but the OAuth token is expired/revoked (HTTP 401) -- no windows. */
export const authFailedSnapshot: ProfileUsageSnapshot = {
  profile: 'default',
  authed: true,
  polledAt: NOW,
  error: { kind: 'http', status: 401, detail: 'Invalid authentication credentials' },
}

/** No discoverable OAuth token -- unauthed, no windows. */
export const noTokenSnapshot: ProfileUsageSnapshot = {
  profile: 'default',
  authed: false,
  polledAt: NOW,
  error: { kind: 'no_token' },
}
