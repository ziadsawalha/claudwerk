/**
 * selection -- per-spawn sentinel-profile picker.
 *
 * Three modes:
 *   - Fixed:    a literal profile name. Short-circuits to that profile.
 *   - Balanced: from profiles whose `pool` matches the requested pool (or
 *               the sentinel's `defaultPool`), pick the one with the fewest
 *               live agent hosts. Ties broken by name (stable). FUTURE: also
 *               consider per-profile rate-limit headroom -- fresh (non-stale)
 *               5h / 7d quota collected per profile (see plan-sentinel-profiles
 *               §"Per-Profile Usage Tracking" + Open Questions). Today the
 *               sentinel only tracks live load.
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
  /** RNG seam (random only). */
  rand?: Rng
}

/**
 * Pick a profile for a spawn. Throws when `input` is a literal name that's
 * unknown -- the caller translates this to a structured spawn failure.
 */
// fallow-ignore-next-line complexity
export function pickProfile(config: SentinelConfig, opts: PickOptions = {}): PickResult {
  const { input, pool: requestedPoolInput, liveLoad, rand } = opts

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
    const get = liveLoad ?? (() => 0)
    const picked = pickLeastLoaded(candidates, get)
    return {
      profile: picked,
      picker: 'balanced',
      requestedPool,
      candidates: candidates.map(p => p.name),
      reason: 'least-active',
    }
  }

  // mode === 'random'
  const r = rand ?? Math.random
  const idx = Math.floor(r() * candidates.length) % candidates.length
  return {
    profile: candidates[idx],
    picker: 'random',
    requestedPool,
    candidates: candidates.map(p => p.name),
    reason: 'random',
  }
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

/** Profiles in the requested pool (`p.pool === pool`), sorted by name
 *  (stable ordering for tie-breaking and reproducible random with a seeded
 *  RNG). Profiles with `pool === null` are always excluded. */
function profilesInPool(config: SentinelConfig, pool: string): ResolvedProfile[] {
  return Object.values(config.profiles)
    .filter(p => p.pool === pool)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Least-loaded profile from the candidates. Ties broken by name (stable since
 *  the candidate list is pre-sorted by name -- the first profile in iteration
 *  order with the minimum load wins). */
function pickLeastLoaded(candidates: ResolvedProfile[], liveLoad: LiveLoadSource): ResolvedProfile {
  let best: ResolvedProfile = candidates[0]
  let bestLoad = liveLoad(best.name)
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i]
    const load = liveLoad(candidate.name)
    if (load < bestLoad) {
      best = candidate
      bestLoad = load
    }
  }
  return best
}
