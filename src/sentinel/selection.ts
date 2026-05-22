/**
 * selection -- per-spawn sentinel-profile picker.
 *
 * Three modes:
 *   - Fixed:    a literal profile name. Short-circuits to that profile.
 *   - Balanced: from profiles whose `pool` matches the requested pool (or
 *               the sentinel's `defaultPool`), pick the one with the most
 *               rate-limit headroom (Smart Balance, see `rankCandidate`).
 *               Falls back to fewest live agent hosts when telemetry is
 *               stale or missing. Ties broken by name (stable).
 *   - Random:   uniform pick over the same pool-filtered profiles.
 *
 * No-input spawn falls through to `config.defaultSelection` (default, balanced,
 * or random). Revive NEVER calls this -- revive always pins to a literal name
 * via the URI userinfo (see `case 'revive':` in `src/sentinel/index.ts`).
 *
 * Pool resolution:
 *   - When the caller passes an explicit `pool`, that's the pool used.
 *   - When the caller passes no pool (Balanced/Random no-input launch), the
 *     sentinel uses `config.defaultPool` (which defaults to `"default"`).
 *   - Profiles with `pool === null` are NEVER eligible for any pool (excluded
 *     from every Balanced/Random selection; Fixed-only).
 *   - An empty pool (no profiles match) falls back to the default profile so
 *     the spawn still succeeds; the picker reports `fallback:empty-pool`.
 *
 * PROFILE-ENV BOUNDARY -- this module returns a `ResolvedProfile` for
 * sentinel-side use. The caller (sentinel spawn handler) reports only the
 * resolved profile NAME back to the broker. Profile env / configDir stay
 * sentinel-side per `.claude/docs/plan-sentinel-profiles.md`.
 */

import type { ResolvedProfile, SentinelConfig } from './sentinel-config'
import { DEFAULT_PROFILE_NAME } from './sentinel-config'

/** Selection-mode token sent on the wire (internal to this module + tests). */
type SelectionToken = 'default' | 'balanced' | 'random'

export interface PickResult {
  profile: ResolvedProfile
  /** Which lane the picker took. `fixed` -- literal name; `balanced` /
   *  `random` -- pool-filtered pick; `default` -- the default profile (config's
   *  defaultSelection was 'default' or the requested pool was empty). */
  picker: 'fixed' | 'balanced' | 'random' | 'default'
  /** Pool NAME actually considered. Empty string for `fixed` / `default`. */
  requestedPool: string
  /** Profile names actually considered (pool-filtered for balanced/random;
   *  empty for fixed/default). Useful for logging. */
  candidates: string[]
  /** Human-readable reason ("least-active", "random", "fallback:empty-pool",
   *  "literal", "default"). For LOG EVERYTHING covenant compliance. */
  reason: string
}

/**
 * The optional load source. Returns the count of live agent hosts running
 * under each profile on this sentinel. Used only by Balanced. Decoupled so
 * tests can inject deterministic loads.
 */
export type LiveLoadSource = (profileName: string) => number

/**
 * Per-profile rate-limit telemetry the Balanced picker consumes. Profiles
 * without an entry (no source, or `undefined` from the source) are treated
 * as having no telemetry -- they rank purely on live-load.
 */
export interface UsageHeadroom {
  /** `1 - max(fiveHour%, sevenDay%) / 100`, clamped to `[0, 1]`. Higher is
   *  better. Computed by the caller from a `ProfileUsageSnapshot`. */
  headroom: number
  /** When `true`, the snapshot is too old to trust -- ranked via live-load
   *  instead of headroom. Caller decides the staleness window. */
  stale: boolean
}

/** Telemetry source. Returns `undefined` for profiles with no snapshot yet
 *  (unauthed, polling never started, just-added profile). */
export type UsageHeadroomSource = (profileName: string) => UsageHeadroom | undefined

/** Optional RNG. Injected for deterministic tests. Defaults to `Math.random`. */
export type Rng = () => number

export interface PickOptions {
  /** Selection input from the spawn message: a literal profile name, a
   *  mode token (`'balanced'` / `'random'` / `'default'`), or `undefined`. */
  input?: string
  /** Pool name to constrain Balanced/Random selection. When absent the
   *  picker uses `config.defaultPool`. Ignored for Fixed. */
  pool?: string
  /** Live load source (sentinel-local). Required for balanced; ignored otherwise. */
  liveLoad?: LiveLoadSource
  /** Per-profile rate-limit headroom. When present, Balanced prefers profiles
   *  with the most fresh headroom; stale / missing entries fall back to
   *  live-load. Sourced from the in-process polling map populated by
   *  `startProfileUsagePolling` (see `src/sentinel/usage-poller.ts`). */
  usage?: UsageHeadroomSource
  /** RNG seam (random only). */
  rand?: Rng
}

/**
 * Pick a profile for a spawn. Throws when `input` is a literal name that's
 * unknown -- the caller translates this to a structured spawn failure.
 */
// fallow-ignore-next-line complexity
export function pickProfile(config: SentinelConfig, opts: PickOptions = {}): PickResult {
  const { input, pool: requestedPoolInput, liveLoad, usage, rand } = opts

  // Literal name -- short-circuit. Validate against the known set. Fixed wins
  // over pool: even if a pool was requested, an explicit name beats it.
  // 'default' IS a literal profile name (always present, synthesised when
  // absent from the config file). Only 'balanced' / 'random' are reserved
  // selection-mode tokens; everything else is a literal pin. Absent / empty
  // input falls through to defaultSelection.
  if (input && input !== 'balanced' && input !== 'random') {
    const profile = config.profiles[input]
    if (!profile) {
      throw new Error(
        `sentinel selection: unknown profile "${input}" (known: ${Object.keys(config.profiles).join(', ')})`,
      )
    }
    return { profile, picker: 'fixed', requestedPool: '', candidates: [], reason: 'literal' }
  }

  // Mode resolution. Absent input -> consult defaultSelection.
  // Explicit 'balanced' / 'random' override.
  const mode: SelectionToken = input === 'balanced' || input === 'random' ? input : config.defaultSelection

  if (mode === 'default') {
    return {
      profile: requireProfile(config, DEFAULT_PROFILE_NAME),
      picker: 'default',
      requestedPool: '',
      candidates: [],
      reason: 'default',
    }
  }

  // Resolve which pool to filter by. Explicit takes priority, then the
  // sentinel's configured defaultPool. (Configs without a defaultPool have
  // already been normalised to `"default"` by loadSentinelConfig.)
  const requestedPool = requestedPoolInput ?? config.defaultPool

  const candidates = profilesInPool(config, requestedPool)

  if (candidates.length === 0) {
    // Empty pool -- fall back to default. Logged so an operator notices a
    // misconfiguration (e.g. requested pool name has zero members).
    return {
      profile: requireProfile(config, DEFAULT_PROFILE_NAME),
      picker: 'default',
      requestedPool,
      candidates: [],
      reason: 'fallback:empty-pool',
    }
  }

  if (mode === 'balanced') {
    const getLoad = liveLoad ?? (() => 0)
    const getUsage = usage ?? (() => undefined)
    const { profile: picked, anyFresh } = pickBalanced(candidates, getLoad, getUsage)
    return {
      profile: picked,
      picker: 'balanced',
      requestedPool,
      candidates: candidates.map(p => p.name),
      // Smart Balance reports which signal drove the pick so operators can
      // distinguish "fresh-headroom" from "stale-fallback" in the logs.
      reason: anyFresh ? 'smart-balance' : 'least-active',
    }
  }

  // mode === 'random' -- weighted random over the pool. All candidates have
  // weight > 0 (profilesInPool excludes soft-drained members), so the walk
  // always lands on a real profile.
  const r = rand ?? Math.random
  return {
    profile: pickWeightedRandom(candidates, r),
    picker: 'random',
    requestedPool,
    candidates: candidates.map(p => p.name),
    reason: 'random',
  }
}

/** Weighted random pick. `r = rand() * sum(weights)`, walk the (name-sorted)
 *  pool subtracting each weight until `r < weight`. Higher weight -> wider
 *  slice -> picked more often. Caller guarantees all weights > 0, so the sum
 *  is positive and the final candidate is the deterministic fallback for any
 *  floating-point residue. */
function pickWeightedRandom(candidates: ResolvedProfile[], rand: Rng): ResolvedProfile {
  const total = candidates.reduce((sum, p) => sum + p.weight, 0)
  let r = rand() * total
  for (const c of candidates) {
    r -= c.weight
    if (r < 0) return c
  }
  return candidates[candidates.length - 1]
}

function requireProfile(config: SentinelConfig, name: string): ResolvedProfile {
  const profile = config.profiles[name]
  if (!profile) {
    // The default profile is synthesised by loadSentinelConfig -- this is
    // unreachable barring construction-by-hand. Throw loud rather than
    // returning undefined into the caller.
    throw new Error(`sentinel selection: profile "${name}" missing from config (this is a bug)`)
  }
  return profile
}

/** Selectable profiles in the requested pool (`p.pool === pool` AND
 *  `weight > 0`), sorted by name (stable ordering for tie-breaking and
 *  reproducible random with a seeded RNG). Profiles with `pool === null` are
 *  always excluded; `weight: 0` profiles stay in the pool conceptually but are
 *  excluded from auto-selection (soft drain) -- a pool whose members are all
 *  weight-0 reads as empty here and falls back to default. */
function profilesInPool(config: SentinelConfig, pool: string): ResolvedProfile[] {
  return Object.values(config.profiles)
    .filter(p => p.pool === pool && p.weight > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Smart Balance ranker. Returns a unified score in `[0, 1]` where higher is
 * better. Two signals merged onto one axis so fresh and stale candidates can
 * compete:
 *   - Fresh telemetry: `rank = headroom` (e.g. 0.9 means 10% of quota used)
 *   - Stale or missing: `rank = 1 / (1 + liveLoad/weight)` -- weight is
 *     capacity, so a weight=10 profile at load 5 ranks like a weight=1
 *     profile at load 0.5 (rank ~0.67). weight=1: load 0 -> 1.0, 1 -> 0.5.
 *
 * Consequences:
 *   - All-fresh pool: highest-headroom profile wins (the intent).
 *   - All-stale pool: lowest-load profile wins (the legacy least-active rule).
 *   - Mixed: a fresh-but-burned account (headroom 0.05) loses to a stale-but-
 *     idle account (load 0 -> rank 1.0). A fresh-and-fresh account
 *     (headroom 0.9) beats a stale-and-loaded one (load 2 -> 0.33). This is
 *     the desired bias: when in doubt, prefer demonstrably-idle.
 */
// fallow-ignore-next-line complexity
function rankCandidate(profile: ResolvedProfile, liveLoad: LiveLoadSource, usage: UsageHeadroomSource): number {
  const u = usage(profile.name)
  if (u && !u.stale) {
    // Clamp defensively -- callers compute headroom from external data.
    if (u.headroom < 0) return 0
    if (u.headroom > 1) return 1
    return u.headroom
  }
  // Weight as capacity: divide live load by weight so a weight=10 profile
  // carries ~10x the load before it ranks as busy as a weight=1 profile.
  // (v2 rate-limit-aware balancing will divide headroom by weight the same
  // way -- deferred per plan-sentinel-profiles Phase 7b.)
  const load = Math.max(0, liveLoad(profile.name))
  return 1 / (1 + load / profile.weight)
}

/** Smart Balance picker. Returns the chosen profile + whether ANY candidate
 *  had fresh telemetry (so the caller can label the `reason` accordingly).
 *  Tie-breaking is stable -- the first candidate (sorted by name) with the
 *  highest rank wins. */
// fallow-ignore-next-line complexity
function pickBalanced(
  candidates: ResolvedProfile[],
  liveLoad: LiveLoadSource,
  usage: UsageHeadroomSource,
): { profile: ResolvedProfile; anyFresh: boolean } {
  let best: ResolvedProfile = candidates[0]
  let bestRank = rankCandidate(best, liveLoad, usage)
  let anyFresh = !!usage(best.name) && !usage(best.name)?.stale
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]
    const u = usage(c.name)
    if (u && !u.stale) anyFresh = true
    const rank = rankCandidate(c, liveLoad, usage)
    if (rank > bestRank) {
      best = c
      bestRank = rank
    }
  }
  return { profile: best, anyFresh }
}
