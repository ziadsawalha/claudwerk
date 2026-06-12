/**
 * usage-headroom -- map per-profile usage snapshots to the Smart Balance
 * picker's `UsageHeadroom` shape, with 429 CARRY-FORWARD.
 *
 * The problem this solves: `/api/oauth/usage` rate-limits per account. When the
 * usage PROBE for a profile gets throttled (HTTP 429), its latest snapshot is
 * an error with no windows. Collapsing that to "no telemetry" drops the profile
 * into the picker's UNKNOWN band, so a healthy account (e.g. 1% / 12%) loses
 * every balanced spawn to a sibling that happens to be under the 5h gate --
 * purely because we couldn't MEASURE it, which says nothing about its capacity.
 *
 * Fix: keep the last error-free snapshot per profile and fall back to it when
 * the latest poll has no usable windows. The carried-forward reading stays
 * usable for `carryForwardStaleMs` (sized to the max 429 backoff) so the
 * profile keeps ranking on real headroom for the whole throttle window. Past
 * that we genuinely haven't measured it in too long -> back to load-based
 * (UNKNOWN band), the same honest fallback used when the poller dies.
 *
 * Pure + dependency-free so the policy is unit-tested without booting the
 * sentinel (the live wiring in `index.ts` is a thin adapter over this).
 */

import type { ProfileUsageSnapshot } from '../shared/protocol'
import type { UsageHeadroom } from './selection'

/** A snapshot carries usable windows when it's authed, error-free, and has
 *  BOTH the 5h and 7d windows. Errored / unauthed / partial snapshots don't. */
export function snapshotHasWindows(
  snap: ProfileUsageSnapshot | undefined,
): snap is ProfileUsageSnapshot & Required<Pick<ProfileUsageSnapshot, 'fiveHour' | 'sevenDay'>> {
  return !!snap?.authed && !snap.error && !!snap.fiveHour && !!snap.sevenDay
}

/** Derive the picker headroom from a snapshot known to have windows. Staleness
 *  is measured from THAT snapshot's `polledAt` against the supplied window. */
function headroomFromSnapshot(
  snap: ProfileUsageSnapshot & Required<Pick<ProfileUsageSnapshot, 'fiveHour' | 'sevenDay'>>,
  now: number,
  staleMs: number,
): UsageHeadroom {
  return {
    fiveHourUsedPercent: snap.fiveHour.usedPercent,
    sevenDayUsedPercent: snap.sevenDay.usedPercent,
    msUntilFiveHourReset: Math.max(0, new Date(snap.fiveHour.resetAt).getTime() - now),
    msUntilSevenDayReset: Math.max(0, new Date(snap.sevenDay.resetAt).getTime() - now),
    stale: now - snap.polledAt > staleMs,
  }
}

export interface HeadroomStaleness {
  /** Staleness window for the LATEST snapshot (a fresh poll is ~now, so this
   *  only bites when polling has silently stalled). */
  staleMs: number
  /** Staleness window for a CARRIED-FORWARD last-good snapshot. Sized to the
   *  max 429 backoff so a healthy profile keeps ranking on real headroom for
   *  the entire throttle window instead of blanking out partway through. */
  carryForwardStaleMs: number
}

/**
 * Map (latest, lastGood) snapshots to picker headroom with 429 carry-forward.
 *
 * - Latest has windows  -> use it (fresh-poll path, `staleMs`).
 * - Latest is errored/missing but lastGood has windows -> carry it forward
 *   (`carryForwardStaleMs`).
 * - Neither usable       -> `undefined` (UNKNOWN band -> load-based ranking).
 *
 * Staleness is always measured from the snapshot actually used.
 */
export function deriveUsageHeadroom(
  latest: ProfileUsageSnapshot | undefined,
  lastGood: ProfileUsageSnapshot | undefined,
  now: number,
  staleness: HeadroomStaleness,
): UsageHeadroom | undefined {
  if (snapshotHasWindows(latest)) return headroomFromSnapshot(latest, now, staleness.staleMs)
  if (snapshotHasWindows(lastGood)) return headroomFromSnapshot(lastGood, now, staleness.carryForwardStaleMs)
  return undefined
}
