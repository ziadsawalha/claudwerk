/**
 * selection -- per-spawn sentinel-profile picker.
 *
 * Three modes:
 *   - Fixed:    a literal profile name. Short-circuits to that profile.
 *   - Balanced: from profiles whose `pool` matches the requested pool (or
 *               the sentinel's `defaultPool`), pick by Smart Balance v3 (see
 *               `rankCandidate`): the 5h window is a HARD GATE (skip profiles
 *               near their 5h cap) and the 7d window is a SOFT PREFERENCE
 *               (favour the most "drain pressure" -- headroom per hour until
 *               the weekly budget resets). Falls back to fewest live agent
 *               hosts when telemetry is stale or missing. Ties broken by name.
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
 * The two Anthropic windows are kept SEPARATE on purpose -- they drive two
 * different decisions (see `rankCandidate`):
 *   - 5h  = HARD GATE. Near its cap means "do not schedule here right now"
 *           (a spawn would blow through the limit mid-turn and get throttled).
 *   - 7d  = SOFT PREFERENCE. Drives "drain pressure" -- the weekly budget
 *           resets on a rolling clock, so unused headroom is wasted at reset.
 *           Favour the profile with the most headroom per hour-until-reset.
 */
export interface UsageHeadroom {
  /** 5-hour window utilization as a percentage. The hard gate: at/over
   *  `GATE_FIVE_HOUR_PCT` the profile drops below every eligible one. */
  fiveHourUsedPercent: number
  /** 7-day window utilization as a percentage. Drives drain pressure for
   *  eligible profiles. Clamped to `[0, 100]` inside the ranker. */
  sevenDayUsedPercent: number
  /** Milliseconds until the 5h window resets. Used to rank GATED profiles
   *  (soonest to free up wins) so an all-gated pool still picks sanely.
   *  Clamped to `>= MIN_RESET_MS` inside the ranker. */
  msUntilFiveHourReset: number
  /** Milliseconds until the 7d window resets. The drain-pressure denominator
   *  (headroom% / hours-until-reset). Clamped to `>= MIN_RESET_MS`. */
  msUntilSevenDayReset: number
  /** When `true`, the snapshot is too old to trust -- ranked via live-load
   *  instead of utilization (we can't honour the 5h gate on stale data).
   *  Caller decides the staleness window. */
  stale: boolean
}

/** 5-hour utilization at/over this percentage trips the HARD GATE: the
 *  profile drops below every eligible one (only picked if ALL are gated).
 *  This is the "warning margin" -- set below 100 so scheduling STOPS before a
 *  spawn would blow through the cap mid-turn. Exported for tests + potential
 *  per-sentinel override (future work). */
export const GATE_FIVE_HOUR_PCT = 80

/** Weight of 7d drain pressure vs. live-load damping inside the eligible
 *  band. Drain-pressure-dominant (0.8) with a small load term so a burst of
 *  spawns between usage polls doesn't dog-pile one profile before its
 *  telemetry catches up. The remainder (0.2) is live-load. */
const DRAIN_WEIGHT = 0.8

/** Reset-clock denominator floor (1min). Prevents division-by-near-zero when
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
 * Smart Balance v3 ranker. 5h is a HARD GATE; 7d is a SOFT PREFERENCE.
 * Three disjoint bands on a unified `[0, 1]` axis:
 *
 *   Eligible  (fresh telemetry, fiveHour% < GATE_FIVE_HOUR_PCT):  [0.5, 1.0]
 *     rank = 0.5 + 0.5 * (DRAIN_WEIGHT*drainRank + (1-DRAIN_WEIGHT)*loadRank)
 *     drainPressure = sevenDayHeadroom% / hoursUntil7dReset   ("%/hour")
 *     drainRank     = drainPressure / (1 + drainPressure)     -- squash (0,1)
 *     loadRank      = 1 / (1 + load/weight)                   -- weight=capacity
 *
 *   Unknown   (no source / errored / stale):                       [0.25, 0.5)
 *     rank = 0.25 + 0.25 * loadRank
 *     -- can't confirm the 5h gate, so it never outranks a KNOWN-eligible
 *        profile; but an idle unknown still beats a known-gated one.
 *
 *   Gated     (fresh telemetry, fiveHour% >= GATE_FIVE_HOUR_PCT):   [0, 0.25)
 *     rank = 0.25 * soonRank,  soonRank = 1 / (1 + hoursUntil5hReset)
 *     -- only reachable when EVERY profile is gated; then the one whose 5h
 *        frees up soonest wins (shortest wait to become schedulable).
 *
 * Invariants:
 *   - Any eligible profile beats any unknown one beats any gated one.
 *   - Within eligible, the soonest-resetting 7d window with the most headroom
 *     wins -- "use it or lose it": weekly budget about to refresh is drained
 *     first so it isn't wasted at reset. The headroom% numerator self-limits
 *     (as a profile drains, its pressure falls and selection rotates away).
 *   - With NO fresh telemetry anywhere, every candidate lands in the unknown
 *     band ranked by load -> degrades cleanly to legacy least-active.
 *   - Tie-breaking is by name (stable; see `pickBalanced`).
 */
// fallow-ignore-next-line complexity
function rankCandidate(profile: ResolvedProfile, liveLoad: LiveLoadSource, usage: UsageHeadroomSource): number {
  const load = Math.max(0, liveLoad(profile.name))
  const loadRank = 1 / (1 + load / profile.weight)

  const u = usage(profile.name)
  if (!u || u.stale) {
    // No fresh telemetry -- we can't honour the 5h gate, so this profile sits
    // in the unknown band [0.25, 0.5): below any KNOWN-eligible profile (we
    // prefer a profile we've confirmed is under the 5h margin), but above any
    // KNOWN-gated one (an idle unknown beats a confirmed-throttled account).
    // When ALL candidates are here, load-balancing decides (least-active).
    return 0.25 + 0.25 * loadRank
  }

  // HARD GATE -- 5h at/over the warning margin. Drop into the gated band
  // [0, 0.25), ordered so the profile whose 5h frees up SOONEST ranks highest
  // (this only matters when every candidate is gated).
  if (Math.max(0, Math.min(100, u.fiveHourUsedPercent)) >= GATE_FIVE_HOUR_PCT) {
    const hoursTo5hReset = Math.max(MIN_RESET_MS, u.msUntilFiveHourReset) / (60 * 60 * 1000)
    const soonRank = 1 / (1 + hoursTo5hReset) // shorter wait -> higher, (0, 1]
    return 0.25 * soonRank
  }

  // ELIGIBLE -- 5h has headroom. Rank by 7d DRAIN PRESSURE: headroom% per
  // hour-until-7d-reset. A profile whose weekly budget refreshes in 2 days
  // with 70% unused (35%/h) outranks one resetting in 6 days with 80% unused
  // (~13%/h) -- spend the soon-to-reset quota before it's wasted. Live-load
  // damps the pick so a burst between polls doesn't dog-pile one profile.
  const headroom7d = 100 - Math.max(0, Math.min(100, u.sevenDayUsedPercent))
  const hoursTo7dReset = Math.max(MIN_RESET_MS, u.msUntilSevenDayReset) / (60 * 60 * 1000)
  const drainPressure = headroom7d / hoursTo7dReset
  // Squash to (0, 1): `x / (1 + x)`. Smooth, monotonic, asymptotic to 1.
  const drainRank = drainPressure / (1 + drainPressure)
  return 0.5 + 0.5 * (DRAIN_WEIGHT * drainRank + (1 - DRAIN_WEIGHT) * loadRank)
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
