/**
 * Shared sentinel-profile usage helpers for the spawn + revive dialogs.
 *
 * PROFILE-ENV BOUNDARY: these only ever read NAMES + usage snapshots reported
 * by the sentinel -- never configDir / env (which stay sentinel-local).
 */

import type { ProfileUsageSnapshot } from '@shared/protocol'

/** Store shape for `profileUsage` -- each entry is tagged with the sentinel it
 *  came from so cross-sentinel name collisions don't bleed between pickers. */
export type ProfileUsageEntry = ProfileUsageSnapshot & { sentinelId: string }

/**
 * Build a NAME-keyed usage map for a single sentinel, filtering the global
 * `profileUsage` record down to entries from THAT sentinel. Returns an empty
 * map when the sentinel is unknown / disconnected.
 */
export function buildProfileUsageMap(
  sentinelId: string | undefined,
  profileUsage: Record<string, ProfileUsageEntry>,
): Map<string, ProfileUsageSnapshot> {
  const out = new Map<string, ProfileUsageSnapshot>()
  if (!sentinelId) return out
  for (const entry of Object.values(profileUsage)) {
    if (entry.sentinelId === sentinelId) out.set(entry.profile, entry)
  }
  return out
}

/**
 * Worst-case utilization across the 5h + 7d windows, or `null` when there is
 * no fresh authed snapshot to judge by (unauthed, errored, or never polled).
 * Mirrors the profile pill's inline usage badge.
 */
export function worstUsagePct(usage?: ProfileUsageSnapshot): number | null {
  if (!usage || usage.error || !usage.fiveHour || !usage.sevenDay) return null
  return Math.max(usage.fiveHour.usedPercent, usage.sevenDay.usedPercent)
}

/**
 * Pick the default profile for a REVIVE.
 *
 * Pins to `original` (the conversation's `resolvedProfile`) UNLESS that
 * profile's worst usage window is over `thresholdPct` -- then auto-unpin and
 * return the freshest alternative (lowest worst-window usage) that we can
 * CONFIRM has headroom. Profiles without a fresh snapshot are skipped (we only
 * break the pin toward a profile we know is usable). Falls back to `original`
 * when nothing qualifies or the sentinel reports a single profile.
 */
// fallow-ignore-next-line complexity
export function resolveReviveDefaultProfile(
  original: string,
  profiles: { name: string }[],
  usageByName: Map<string, ProfileUsageSnapshot>,
  thresholdPct: number,
): string {
  if (profiles.length < 2) return original
  const origPct = worstUsagePct(usageByName.get(original))
  if (origPct === null || origPct <= thresholdPct) return original
  let best = original
  let bestPct = origPct
  for (const p of profiles) {
    if (p.name === original) continue
    const pct = worstUsagePct(usageByName.get(p.name))
    if (pct !== null && pct < bestPct) {
      best = p.name
      bestPct = pct
    }
  }
  return best
}
