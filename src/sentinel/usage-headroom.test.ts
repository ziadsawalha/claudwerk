import { describe, expect, it } from 'bun:test'
import type { ProfileUsageSnapshot } from '../shared/protocol'
import { deriveUsageHeadroom, snapshotHasWindows } from './usage-headroom'

const NOW = 1_000_000_000_000
const STALE = { staleMs: 10 * 60 * 1000, carryForwardStaleMs: 30 * 60 * 1000 }

function good(over: Partial<ProfileUsageSnapshot> = {}): ProfileUsageSnapshot {
  return {
    profile: 'default',
    authed: true,
    polledAt: NOW,
    fiveHour: { usedPercent: 1, resetAt: new Date(NOW + 60 * 60 * 1000).toISOString() },
    sevenDay: { usedPercent: 12, resetAt: new Date(NOW + 6 * 24 * 60 * 60 * 1000).toISOString() },
    ...over,
  }
}

const rateLimited: ProfileUsageSnapshot = {
  profile: 'default',
  authed: true,
  polledAt: NOW,
  error: { kind: 'http', status: 429, detail: 'Rate limited', retryAfterMs: 1_620_000 },
}

const noToken: ProfileUsageSnapshot = { profile: 'default', authed: false, polledAt: NOW, error: { kind: 'no_token' } }

describe('snapshotHasWindows', () => {
  it('accepts an authed error-free snapshot with both windows', () => {
    expect(snapshotHasWindows(good())).toBe(true)
  })
  it('rejects undefined, errored, unauthed, and partial snapshots', () => {
    expect(snapshotHasWindows(undefined)).toBe(false)
    expect(snapshotHasWindows(rateLimited)).toBe(false)
    expect(snapshotHasWindows(noToken)).toBe(false)
    expect(snapshotHasWindows(good({ sevenDay: undefined }))).toBe(false)
  })
})

describe('deriveUsageHeadroom', () => {
  it('uses the latest snapshot when it has windows', () => {
    const h = deriveUsageHeadroom(
      good({ fiveHour: { usedPercent: 5, resetAt: new Date(NOW).toISOString() } }),
      undefined,
      NOW,
      STALE,
    )
    expect(h?.fiveHourUsedPercent).toBe(5)
    expect(h?.stale).toBe(false)
  })

  it('returns undefined when nothing is usable', () => {
    expect(deriveUsageHeadroom(rateLimited, undefined, NOW, STALE)).toBeUndefined()
    expect(deriveUsageHeadroom(undefined, undefined, NOW, STALE)).toBeUndefined()
  })

  // The core fix: a 429 on the latest poll must NOT blank the profile -- it
  // carries forward the last-good reading so the picker still ranks it eligible.
  it('carries forward last-good windows when the latest poll is 429-throttled', () => {
    const lastGood = good({
      polledAt: NOW - 2 * 60 * 1000,
      fiveHour: { usedPercent: 1, resetAt: new Date(NOW).toISOString() },
    })
    const h = deriveUsageHeadroom(rateLimited, lastGood, NOW, STALE)
    expect(h).toBeDefined()
    expect(h?.fiveHourUsedPercent).toBe(1)
    expect(h?.stale).toBe(false) // 2min old, inside the carry-forward window
  })

  it('carry-forward uses the GENEROUS window (survives past the 10min latest-stale bound)', () => {
    // 20min old: stale under the latest window, fresh under carry-forward (30min).
    const lastGood = good({ polledAt: NOW - 20 * 60 * 1000 })
    const h = deriveUsageHeadroom(rateLimited, lastGood, NOW, STALE)
    expect(h?.stale).toBe(false)
  })

  it('carried-forward data past the carry-forward window is marked stale', () => {
    const lastGood = good({ polledAt: NOW - 31 * 60 * 1000 })
    const h = deriveUsageHeadroom(rateLimited, lastGood, NOW, STALE)
    expect(h?.stale).toBe(true)
  })

  it('prefers a fresh latest over an older last-good', () => {
    const latest = good({ fiveHour: { usedPercent: 40, resetAt: new Date(NOW).toISOString() } })
    const lastGood = good({
      polledAt: NOW - 5 * 60 * 1000,
      fiveHour: { usedPercent: 1, resetAt: new Date(NOW).toISOString() },
    })
    const h = deriveUsageHeadroom(latest, lastGood, NOW, STALE)
    expect(h?.fiveHourUsedPercent).toBe(40)
  })

  it('computes reset clocks from the snapshot actually used, never negative', () => {
    const lastGood = good({
      polledAt: NOW - 60 * 1000,
      fiveHour: { usedPercent: 1, resetAt: new Date(NOW - 5_000).toISOString() }, // already past
      sevenDay: { usedPercent: 12, resetAt: new Date(NOW + 3 * 60 * 60 * 1000).toISOString() },
    })
    const h = deriveUsageHeadroom(rateLimited, lastGood, NOW, STALE)
    expect(h?.msUntilFiveHourReset).toBe(0)
    expect(h?.msUntilSevenDayReset).toBe(3 * 60 * 60 * 1000)
  })
})
