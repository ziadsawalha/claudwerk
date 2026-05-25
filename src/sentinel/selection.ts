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
 *
 * Carries the raw worst-window utilization + reset clock so the ranker can
 * decide between "in-budget" (under FUNGIBLE_BAND_PCT -- balance by live
 * load) and "drain" (over the band -- pick by time-normalized burn rate).
 * See `rankCandidate` for the math.
 */
export interface UsageHeadroom {
  /** Worst-window utilization as a percentage (`max(fiveHour%, sevenDay%)`).
   *  Computed by the caller from a `ProfileUsageSnapshot`. Values are
   *  clamped to `[0, 100]` inside the ranker. */
  worstUsedPercent: number
  /** Milliseconds until the worst window resets. Used by the drain-zone
   *  burn-rate math. Clamped to `>= MIN_RESET_MS` inside the ranker so a
   *  window about to flip doesn't divide by near-zero. */
  msUntilWorstReset: number
  /** When `true`, the snapshot is too old to trust -- ranked via live-load
   *  instead of utilization. Caller decides the staleness window. */
  stale: boolean
}

/** Worst-window utilization below this percentage is treated as fungible --
 *  inside the band, profiles balance by live-load, not by headroom. Picked
 *  to match Anthropic's soft-alert threshold (~80%) with a small buffer.
 *  Exported for tests + potential per-sentinel override (future work). */
export const FUNGIBLE_BAND_PCT = 75

/** Burn-rate denominator floor (1min). Prevents division-by-near-zero when
 *  a usage window is seconds away from resetting. */
const MIN_RESET_MS = 60_000

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
 * Smart Balance v2 ranker. Two-zone ranker on a unified `[0, 1]` axis:
 *
 *   In-budget zone (`worstUsedPercent < FUNGIBLE_BAND_PCT`):
 *     rank = 0.5 + 0.5 * loadRank      -- maps to [0.5, 1.0]
 *     loadRank = 1 / (1 + load/weight) -- weight is capacity
 *
 *   Drain zone (worstUsedPercent >= band):
 *     rank = 0.5 * burnRank             -- maps to [0, 0.5)
 *     burnRank = headroom% / minutesToReset, smooth-squashed to (0, 1)
 *
 *   Stale / missing telemetry:
 *     rank = loadRank                   -- legacy least-active fallback
 *
 * Invariants:
 *   - Any in-budget profile beats any drain-zone one (>= 0.5 vs < 0.5).
 *   - Stale telemetry never enters the dead-band -- we don't trust old %s
 *     to declare "in budget" (that's how you slam a maxed-out account).
 *   - Tie-breaking is by name (stable; see `pickBalanced`).
 *
 * Goal: spread spawns across all in-budget profiles by live load, only
 * biasing toward most-headroom when a profile is near its cap. Solves the
 * monopoly pathology where the leader by tiny `%` deltas absorbed every
 * spawn until it caught up.
 */
// fallow-ignore-next-line complexity
function rankCandidate(profile: ResolvedProfile, liveLoad: LiveLoadSource, usage: UsageHeadroomSource): number {
  const load = Math.max(0, liveLoad(profile.name))
  const loadRank = 1 / (1 + load / profile.weight)

  const u = usage(profile.name)
  if (!u || u.stale) {
    // No fresh telemetry -- legacy live-load ranking. Returns [0, 1] so an
    // idle stale profile can still beat a loaded one. By design this can
    // outrank a fresh drain-zone profile (an idle account we haven't heard
    // from in a while is probably still the safer choice over a known-burned
    // one). See test 'partial telemetry: stale-but-idle beats fresh-low-...'.
    return loadRank
  }

  const usedPct = Math.max(0, Math.min(100, u.worstUsedPercent))
  if (usedPct < FUNGIBLE_BAND_PCT) {
    // In-budget zone: lift load-balancing into [0.5, 1.0] so any in-budget
    // profile beats any drain-zone one regardless of load.
    return 0.5 + 0.5 * loadRank
  }

  // Drain zone: time-normalized burn rate. headroom% per minute-until-reset
  // -- a profile at 80% with 4h left has more sustainable capacity than one
  // at 80% with 5min left (which is about to flush; don't hoard it).
  const headroomPct = 100 - usedPct
  const minutesToReset = Math.max(MIN_RESET_MS, u.msUntilWorstReset) / 60_000
  const burnPerMinute = headroomPct / minutesToReset
  // Squash to (0, 1): `x / (1 + x)`. Smooth, monotonic, asymptotic to 1.
  // Then scale into [0, 0.5) so drain-zone never crosses the band ceiling.
  const burnRank = burnPerMinute / (1 + burnPerMinute)
  return 0.5 * burnRank
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
