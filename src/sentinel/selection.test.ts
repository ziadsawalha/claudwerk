/**
 * Tier 1 unit tests for `selection` -- Fixed / Balanced / Random / default
 * with named pools.
 *
 * Selection is sentinel-side. The broker never picks; it sends a literal
 * name or a mode token plus an optional pool, and the sentinel resolves. Tests cover:
 *   - Fixed wins over everything (and unknown literal throws).
 *   - Balanced picks least-loaded profile in the requested pool; ties broken
 *     by name; skips other pools; empty pool falls back to default.
 *   - Random picks only from the requested pool, with a seeded RNG for determinism.
 *   - `defaultSelection` (config) drives no-input spawns.
 *   - `defaultPool` (config) is the fallback when caller doesn't specify pool.
 *   - `pool: null` profiles never appear in any selection.
 */
import { describe, expect, test } from 'bun:test'
import { FUNGIBLE_BAND_PCT, pickProfile } from './selection'
import type { SentinelConfig } from './sentinel-config'

function mkConfig(
  defaultSelection: SentinelConfig['defaultSelection'],
  profiles: Array<{ name: string; pool: string | null; weight?: number }>,
  defaultPool = 'default',
): SentinelConfig {
  return {
    sourcePath: null,
    defaultSelection,
    defaultPool,
    profiles: Object.fromEntries(
      profiles.map(p => [
        p.name,
        {
          name: p.name,
          configDir: `/tmp/${p.name}`,
          env: {},
          pool: p.pool,
          weight: p.weight ?? 1,
        },
      ]),
    ),
  }
}

describe('pickProfile -- Fixed', () => {
  test('known literal name short-circuits', () => {
    const cfg = mkConfig('default', [
      { name: 'default', pool: 'default' },
      { name: 'work', pool: null },
    ])
    const r = pickProfile(cfg, { input: 'work' })
    expect(r.profile.name).toBe('work')
    expect(r.picker).toBe('fixed')
    expect(r.reason).toBe('literal')
    expect(r.requestedPool).toBe('')
  })

  test('unknown literal name throws with helpful message', () => {
    const cfg = mkConfig('default', [{ name: 'default', pool: 'default' }])
    expect(() => pickProfile(cfg, { input: 'ghost' })).toThrow(/unknown profile "ghost"/)
  })

  test('fixed wins regardless of defaultSelection and a requested pool', () => {
    const cfg = mkConfig('balanced', [
      { name: 'default', pool: 'default' },
      { name: 'work', pool: null },
      { name: 'alt', pool: 'default' },
    ])
    const r = pickProfile(cfg, { input: 'work', pool: 'whatever', liveLoad: () => 99 })
    expect(r.profile.name).toBe('work')
    expect(r.picker).toBe('fixed')
  })
})

describe('pickProfile -- Balanced', () => {
  test('picks least-loaded profile in the default pool', () => {
    const cfg = mkConfig('default', [
      { name: 'default', pool: 'default' },
      { name: 'alt', pool: 'default' },
      { name: 'work', pool: 'default' },
    ])
    const loads: Record<string, number> = { default: 5, alt: 1, work: 3 }
    const r = pickProfile(cfg, { input: 'balanced', liveLoad: n => loads[n] ?? 0 })
    expect(r.profile.name).toBe('alt')
    expect(r.picker).toBe('balanced')
    expect(r.reason).toBe('least-active')
    expect(r.requestedPool).toBe('default')
    expect(r.candidates).toEqual(['alt', 'default', 'work'])
  })

  test('ties broken by name (stable, alphabetical)', () => {
    const cfg = mkConfig('default', [
      { name: 'zebra', pool: 'default' },
      { name: 'apple', pool: 'default' },
      { name: 'banana', pool: 'default' },
    ])
    const r = pickProfile(cfg, { input: 'balanced', liveLoad: () => 7 })
    expect(r.profile.name).toBe('apple')
  })

  test('filters by named pool when explicit pool given', () => {
    const cfg = mkConfig('default', [
      { name: 'default', pool: 'default' },
      { name: 'work-1', pool: 'work' },
      { name: 'work-2', pool: 'work' },
      { name: 'alt-1', pool: 'alt' },
    ])
    const loads: Record<string, number> = { 'work-1': 3, 'work-2': 1, 'alt-1': 0, default: 0 }
    const r = pickProfile(cfg, { input: 'balanced', pool: 'work', liveLoad: n => loads[n] ?? 0 })
    expect(r.profile.name).toBe('work-2')
    expect(r.candidates).toEqual(['work-1', 'work-2'])
    expect(r.requestedPool).toBe('work')
  })

  test('falls back to defaultPool when pool omitted', () => {
    const cfg = mkConfig(
      'default',
      [
        { name: 'default', pool: 'default' },
        { name: 'work-1', pool: 'work' },
        { name: 'work-2', pool: 'work' },
      ],
      'work',
    )
    const loads: Record<string, number> = { 'work-1': 3, 'work-2': 1, default: 0 }
    const r = pickProfile(cfg, { input: 'balanced', liveLoad: n => loads[n] ?? 0 })
    expect(r.profile.name).toBe('work-2')
    expect(r.requestedPool).toBe('work')
    expect(r.candidates).toEqual(['work-1', 'work-2'])
  })

  test('skips pool=null profiles', () => {
    const cfg = mkConfig('default', [
      { name: 'default', pool: 'default' },
      { name: 'work', pool: null },
      { name: 'alt', pool: 'default' },
    ])
    const loads: Record<string, number> = { default: 4, alt: 2, work: 0 }
    const r = pickProfile(cfg, { input: 'balanced', liveLoad: n => loads[n] ?? 0 })
    expect(r.profile.name).toBe('alt')
    expect(r.candidates).toEqual(['alt', 'default'])
  })

  test('empty pool (no matches) falls back to default profile', () => {
    const cfg = mkConfig('default', [
      { name: 'default', pool: 'default' },
      { name: 'work-1', pool: 'work' },
    ])
    const r = pickProfile(cfg, { input: 'balanced', pool: 'ghost', liveLoad: () => 0 })
    expect(r.profile.name).toBe('default')
    expect(r.picker).toBe('default')
    expect(r.reason).toBe('fallback:empty-pool')
    expect(r.requestedPool).toBe('ghost')
  })

  test('zero loads -> first profile alphabetically in the pool', () => {
    const cfg = mkConfig('default', [
      { name: 'default', pool: 'default' },
      { name: 'alpha', pool: 'default' },
    ])
    const r = pickProfile(cfg, { input: 'balanced', liveLoad: () => 0 })
    expect(r.profile.name).toBe('alpha')
  })
})

describe('pickProfile -- Random', () => {
  test('picks only from profiles in the requested pool', () => {
    const cfg = mkConfig('default', [
      { name: 'default', pool: 'default' },
      { name: 'work', pool: null },
      { name: 'alt', pool: 'default' },
    ])
    let i = 0
    const seq = [0.0, 0.25, 0.5, 0.75, 0.99]
    const rand = () => seq[i++ % seq.length]
    for (let n = 0; n < 50; n++) {
      const r = pickProfile(cfg, { input: 'random', rand })
      expect(['alt', 'default']).toContain(r.profile.name)
      expect(r.profile.pool).toBe('default')
    }
  })

  test('deterministic with seeded RNG -- 0 picks first', () => {
    const cfg = mkConfig('default', [
      { name: 'alpha', pool: 'default' },
      { name: 'beta', pool: 'default' },
    ])
    const r = pickProfile(cfg, { input: 'random', rand: () => 0 })
    expect(r.profile.name).toBe('alpha')
    expect(r.picker).toBe('random')
    expect(r.reason).toBe('random')
  })

  test('deterministic with seeded RNG -- 0.6 picks second of two', () => {
    const cfg = mkConfig('default', [
      { name: 'alpha', pool: 'default' },
      { name: 'beta', pool: 'default' },
    ])
    const r = pickProfile(cfg, { input: 'random', rand: () => 0.6 })
    expect(r.profile.name).toBe('beta')
  })

  test('random with named pool filter', () => {
    const cfg = mkConfig('default', [
      { name: 'default', pool: 'default' },
      { name: 'work-a', pool: 'work' },
      { name: 'work-b', pool: 'work' },
    ])
    const r = pickProfile(cfg, { input: 'random', pool: 'work', rand: () => 0 })
    expect(['work-a', 'work-b']).toContain(r.profile.name)
    expect(r.profile.pool).toBe('work')
  })

  test('empty pool falls back to default', () => {
    const cfg = mkConfig('default', [{ name: 'default', pool: null }])
    const r = pickProfile(cfg, { input: 'random', rand: () => 0 })
    expect(r.profile.name).toBe('default')
    expect(r.picker).toBe('default')
    expect(r.reason).toBe('fallback:empty-pool')
  })
})

describe('pickProfile -- defaultSelection drives no-input spawns', () => {
  test('config defaultSelection=default -> picks default profile', () => {
    const cfg = mkConfig('default', [
      { name: 'default', pool: 'default' },
      { name: 'alt', pool: 'default' },
    ])
    const r = pickProfile(cfg, {})
    expect(r.profile.name).toBe('default')
    expect(r.picker).toBe('default')
    expect(r.reason).toBe('default')
  })

  test('config defaultSelection=balanced -> behaves as Balanced', () => {
    const cfg = mkConfig('balanced', [
      { name: 'default', pool: 'default' },
      { name: 'alt', pool: 'default' },
    ])
    const loads: Record<string, number> = { default: 3, alt: 0 }
    const r = pickProfile(cfg, { liveLoad: n => loads[n] ?? 0 })
    expect(r.profile.name).toBe('alt')
    expect(r.picker).toBe('balanced')
    expect(r.requestedPool).toBe('default')
  })

  test('config defaultSelection=random -> behaves as Random', () => {
    const cfg = mkConfig('random', [
      { name: 'alpha', pool: 'default' },
      { name: 'beta', pool: 'default' },
    ])
    const r = pickProfile(cfg, { rand: () => 0 })
    expect(r.profile.name).toBe('alpha')
    expect(r.picker).toBe('random')
  })

  test("input='default' is a LITERAL pin, NOT a selection-mode token", () => {
    // Regression guard: picking the 'default' pill in the UI must pin to the
    // default profile. Previously the picker treated 'default' as a synonym
    // for the absent-input case and delegated to config.defaultSelection,
    // which silently routed default-pinned launches through balanced/random.
    const cfg = mkConfig('balanced', [
      { name: 'default', pool: 'default' },
      { name: 'alt', pool: 'default' },
    ])
    const loads: Record<string, number> = { default: 5, alt: 0 }
    const r = pickProfile(cfg, { input: 'default', liveLoad: n => loads[n] ?? 0 })
    expect(r.picker).toBe('fixed')
    expect(r.profile.name).toBe('default')
    expect(r.reason).toBe('literal')
  })

  test('absent input still routes through defaultSelection (balanced)', () => {
    const cfg = mkConfig('balanced', [
      { name: 'default', pool: 'default' },
      { name: 'alt', pool: 'default' },
    ])
    const loads: Record<string, number> = { default: 5, alt: 0 }
    const r = pickProfile(cfg, { input: undefined, liveLoad: n => loads[n] ?? 0 })
    expect(r.picker).toBe('balanced')
    expect(r.profile.name).toBe('alt')
  })
})

describe('pickProfile -- returns full ResolvedProfile bundle (env injection sanity)', () => {
  test('configDir + env preserved through fixed pick', () => {
    const cfg: SentinelConfig = {
      sourcePath: null,
      defaultSelection: 'default',
      defaultPool: 'default',
      profiles: {
        default: { name: 'default', configDir: '/home/.claude', env: {}, pool: 'default', weight: 1 },
        work: {
          name: 'work',
          configDir: '/home/.claude-work',
          env: { ANTHROPIC_API_KEY: 'sk-test' },
          pool: 'default',
          weight: 1,
        },
      },
    }
    const r = pickProfile(cfg, { input: 'work' })
    expect(r.profile.configDir).toBe('/home/.claude-work')
    expect(r.profile.env).toEqual({ ANTHROPIC_API_KEY: 'sk-test' })
  })
})

describe('pickProfile -- balanced without a load source treats all as zero', () => {
  test('first profile (alphabetical) wins when no load source given', () => {
    const cfg = mkConfig('default', [
      { name: 'zebra', pool: 'default' },
      { name: 'apple', pool: 'default' },
    ])
    const r = pickProfile(cfg, { input: 'balanced' })
    expect(r.profile.name).toBe('apple')
    expect(r.picker).toBe('balanced')
  })
})

describe('pickProfile -- weighted selection (Phase 7b)', () => {
  test('weight 0 is excluded from Random (soft drain)', () => {
    const cfg = mkConfig('default', [
      { name: 'drained', pool: 'default', weight: 0 },
      { name: 'live', pool: 'default', weight: 1 },
    ])
    // Even with rand()=0 (which would land on the first candidate), the
    // drained profile is never a candidate, so 'live' is the only pick.
    for (const rnd of [0, 0.25, 0.5, 0.75, 0.999]) {
      const r = pickProfile(cfg, { input: 'random', rand: () => rnd })
      expect(r.profile.name).toBe('live')
      expect(r.candidates).toEqual(['live'])
    }
  })

  test('weight 0 is excluded from Balanced but still Fixed-addressable', () => {
    const cfg = mkConfig('default', [
      { name: 'drained', pool: 'default', weight: 0 },
      { name: 'live', pool: 'default', weight: 1 },
    ])
    const balanced = pickProfile(cfg, { input: 'balanced', liveLoad: () => 0 })
    expect(balanced.profile.name).toBe('live')
    // Fixed pin still resolves the drained profile by literal name.
    const fixed = pickProfile(cfg, { input: 'drained' })
    expect(fixed.profile.name).toBe('drained')
    expect(fixed.picker).toBe('fixed')
  })

  test('all-zero pool falls back to default (reads as empty)', () => {
    const cfg = mkConfig('default', [
      { name: 'default', pool: 'default', weight: 1 },
      { name: 'a', pool: 'team', weight: 0 },
      { name: 'b', pool: 'team', weight: 0 },
    ])
    const r = pickProfile(cfg, { input: 'balanced', pool: 'team', liveLoad: () => 0 })
    expect(r.picker).toBe('default')
    expect(r.reason).toBe('fallback:empty-pool')
  })

  test('weighted random respects the weight slices', () => {
    // Candidates sorted by name: heavy(weight 3), light(weight 1). total=4.
    // r in [0,3) -> heavy; r in [3,4) -> light.
    const cfg = mkConfig('default', [
      { name: 'heavy', pool: 'default', weight: 3 },
      { name: 'light', pool: 'default', weight: 1 },
    ])
    // rand()=0.1 -> r=0.4 -> heavy. rand()=0.9 -> r=3.6 -> light.
    expect(pickProfile(cfg, { input: 'random', rand: () => 0.1 }).profile.name).toBe('heavy')
    expect(pickProfile(cfg, { input: 'random', rand: () => 0.9 }).profile.name).toBe('light')
    // Boundary: rand()=0.74 -> r=2.96 -> still heavy (< 3).
    expect(pickProfile(cfg, { input: 'random', rand: () => 0.74 }).profile.name).toBe('heavy')
  })

  test('balanced treats weight as capacity: higher weight wins under equal load', () => {
    const cfg = mkConfig('default', [
      { name: 'big', pool: 'default', weight: 10 },
      { name: 'small', pool: 'default', weight: 1 },
    ])
    // Equal absolute load of 2 each. big: 1/(1+2/10)=0.83; small: 1/(1+2/1)=0.33.
    const r = pickProfile(cfg, { input: 'balanced', liveLoad: () => 2 })
    expect(r.profile.name).toBe('big')
  })
})

// ─── Smart Balance v2 (dead-band + drain) ──────────────────────────
//
// v2 ranks profiles in two zones: in-budget (worstUsedPercent < 75) balances
// by live-load; drain (>= 75) ranks by time-normalized burn rate. Stale /
// missing telemetry falls back to live-load. The motivating pathology was
// the v1 greedy-max-headroom ranker turning small `%` deltas into
// deterministic monopolies; these tests pin the v2 fix.

const HOUR_MS = 60 * 60 * 1000
const fresh = (pct: number, msReset: number = 2 * HOUR_MS) => ({
  worstUsedPercent: pct,
  msUntilWorstReset: msReset,
  stale: false,
})
const stale = (pct: number, msReset: number = 2 * HOUR_MS) => ({
  worstUsedPercent: pct,
  msUntilWorstReset: msReset,
  stale: true,
})

describe('pickProfile -- Smart Balance v2', () => {
  const cfg = mkConfig('balanced', [
    { name: 'alt', pool: 'default' },
    { name: 'default', pool: 'default' },
    { name: 'work', pool: 'default' },
  ])

  test('in-budget pool with equal load: alphabetical tie-break (stable)', () => {
    // All three under FUNGIBLE_BAND_PCT, all idle -> all rank 1.0.
    // Tie-broken by name: 'alt' wins. Documents the stable-tie behavior --
    // the operator can override with weights when they want a different order.
    const usage = () => fresh(FUNGIBLE_BAND_PCT - 45) // well in-budget
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    expect(r.profile.name).toBe('alt')
    expect(r.reason).toBe('smart-balance')
  })

  test('band edge: just under FUNGIBLE_BAND_PCT is in-budget; at/over is drain', () => {
    // 'alt' just under band -> rank in [0.5, 1.0]. 'work' at the band edge
    // (>= 75) -> drain rank < 0.5. 'default' loaded out to confirm load
    // doesn't pull alt under work's drain rank.
    const usage = (name: string) => {
      if (name === 'alt') return fresh(FUNGIBLE_BAND_PCT - 1)
      if (name === 'work') return fresh(FUNGIBLE_BAND_PCT)
      return undefined
    }
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    expect(r.profile.name).toBe('alt')
  })

  test('in-budget: small %% deltas DO NOT decide -- live-load does', () => {
    // The motivating pathology: v1 would deterministically pick 'default'
    // forever because it has slightly more headroom. v2: both in-budget, so
    // the one with fewer live agent hosts wins.
    const usage = (name: string) => fresh(name === 'default' ? 5 : 30)
    const load = (name: string) => (name === 'default' ? 3 : 0) // default loaded
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: load })
    expect(r.profile.name).toBe('alt') // idle in-budget, beats loaded in-budget
  })

  test('in-budget always beats drain-zone regardless of load delta', () => {
    // 'work' is at 90% (drain) with zero load; 'default' at 60% (in budget)
    // with 5 live hosts. v2 still picks default -- the band invariant says
    // in-budget rank >= 0.5 > any drain rank.
    const usage = (name: string) => {
      if (name === 'work') return fresh(90)
      if (name === 'default') return fresh(60)
      return fresh(60)
    }
    const load = (name: string) => (name === 'default' ? 5 : 0)
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: load })
    expect(r.profile.name).not.toBe('work') // never drain when in-budget exists
  })

  test('drain zone: near-reset profile wins (more capacity becoming available)', () => {
    // Both at 85% used. 'work' resets in 5min -> a fresh bucket is about to
    // arrive, so spending its remaining 15% is FINE (3%/min sustainable for
    // 5min, then full reset). 'default' resets in 4h -> the 15% has to last
    // 4h (only 0.06%/min sustainable). v2 ranks `headroom% / minutesToReset`,
    // so work wins. Without telemetry the wildcard 'alt' would tie via
    // live-load -- pin it loaded so it falls below the band ceiling.
    const usage = (name: string) => {
      if (name === 'work') return fresh(85, 5 * 60 * 1000)
      if (name === 'default') return fresh(85, 4 * HOUR_MS)
      return undefined
    }
    // 'alt' has no telemetry -> falls to live-load rank. Load=5 -> ~0.17,
    // which is below 0.5 so any in-budget/drain candidate beats it... but
    // wait, drain ranks are also below 0.5. To isolate the drain-vs-drain
    // comparison, force 'alt' to a much higher load so it ranks below both
    // drain candidates.
    const load = (name: string) => (name === 'alt' ? 999 : 0)
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: load })
    expect(r.profile.name).toBe('work')
    expect(r.reason).toBe('smart-balance')
  })

  test('all-stale telemetry falls back to least-active (legacy behavior)', () => {
    const usage = () => stale(30) // % ignored when stale
    const load = (name: string) => (name === 'work' ? 5 : name === 'default' ? 0 : 2)
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: load })
    expect(r.profile.name).toBe('default')
    expect(r.reason).toBe('least-active')
  })

  test('no usage source at all: matches the legacy least-active path', () => {
    const r = pickProfile(cfg, { input: 'balanced', liveLoad: name => (name === 'work' ? 0 : 3) })
    expect(r.profile.name).toBe('work')
    expect(r.reason).toBe('least-active')
  })

  test('partial telemetry: fresh-in-budget beats stale-loaded', () => {
    const usage = (name: string) => {
      if (name === 'alt') return fresh(20) // in-budget -> rank 1.0
      return undefined
    }
    const load = (name: string) => (name === 'default' ? 5 : 4) // others stale -> ~0.17, 0.2
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: load })
    expect(r.profile.name).toBe('alt')
    expect(r.reason).toBe('smart-balance')
  })

  test('stale-idle beats fresh-drain-zone (demonstrably-idle wins)', () => {
    // 'work' is fresh at 99% (deep drain, rank ~0). 'default' has no telemetry
    // and zero load (rank 1.0). Demonstrably-idle wins -- you do not slam a
    // known-burned account when another account is idle. Documented as a
    // deliberate bias: in-doubt prefer idle over burned.
    const usage = (name: string) => (name === 'work' ? fresh(99) : undefined)
    const load = (name: string) => (name === 'default' ? 0 : 99)
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: load })
    expect(r.profile.name).toBe('default')
    expect(r.reason).toBe('smart-balance')
  })

  test('errored / unauthed snapshot is treated as no telemetry', () => {
    // A profile that recently failed to poll returns `undefined`. v2: it
    // falls back to live-load (rank 1.0 idle) and beats any drain-zone
    // candidate; ties with other in-budget candidates broken by name.
    const usage = (name: string) => (name === 'default' ? fresh(20) : undefined)
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    // default (in-budget) rank 1.0, alt/work (no telemetry, load 0) rank 1.0.
    // Tie -> alphabetical -> alt wins.
    expect(r.profile.name).toBe('alt')
    expect(r.reason).toBe('smart-balance')
  })

  test('worstUsedPercent clamps gracefully outside [0,100]', () => {
    const usage = (name: string) => {
      if (name === 'default') return fresh(150) // clamps to 100 -> drain
      if (name === 'alt') return fresh(-30) // clamps to 0 -> in-budget
      return undefined
    }
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    expect(r.profile.name).toBe('alt') // in-budget beats drain
  })

  test('drain zone: msUntilWorstReset clamped above MIN_RESET_MS', () => {
    // Both at 90%, both passing a near-zero reset time. Without the clamp
    // this would divide by ~0; with it both end up well-defined and the
    // tie-break falls to name.
    const usage = () => fresh(90, 0) // 0ms reset -> floor to 60s inside
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    expect(r.profile.name).toBe('alt') // alphabetical, no divergence
  })
})

// Regression: the v1 monopoly pathology that motivated v2.
describe('pickProfile -- Smart Balance v2 spreads across in-budget pool', () => {
  // Pool must match defaultPool (third mkConfig arg) so balanced selection
  // actually considers both members. Without it, the pool 'work' is unknown
  // to the default pool 'default' and selection falls back to default.
  const cfg = mkConfig(
    'balanced',
    [
      { name: 'default', pool: 'work' },
      { name: 'work', pool: 'work' },
    ],
    'work',
  )

  test('simulated 4 spawns spread across 2 in-budget profiles (no monopoly)', () => {
    // Both at 30% used (in-budget). Live load starts at 0/0 and we increment
    // after each spawn. v1: 'default' would win all 4 because its %% is
    // slightly lower; v2: load balances after spawn 1.
    const usage = (name: string) => fresh(name === 'default' ? 5 : 30)
    const load = new Map<string, number>([
      ['default', 0],
      ['work', 0],
    ])
    const picks: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = pickProfile(cfg, {
        input: 'balanced',
        usage,
        liveLoad: name => load.get(name) ?? 0,
      })
      picks.push(r.profile.name)
      load.set(r.profile.name, (load.get(r.profile.name) ?? 0) + 1)
    }
    // Should be 2/2, not 4/0. Order: name-tie -> default first, then work
    // wins (default loaded), then tie -> default, then work. Specifically: D,W,D,W
    // (or some other 2/2 alternation depending on alphabetical tiebreak).
    const defCount = picks.filter(p => p === 'default').length
    const workCount = picks.filter(p => p === 'work').length
    expect(defCount).toBe(2)
    expect(workCount).toBe(2)
  })
})

// ─── Default-selection synth flip ──────────────────────────────────

describe('loadSentinelConfig -- default defaultSelection is now "balanced"', () => {
  test('config without defaultSelection synthesises "balanced"', async () => {
    // Loaded via the real loader to exercise the synth path. Empty profiles
    // section -> only `default` profile present; balanced over a single
    // member is a no-op pick. The point is to pin the flipped default.
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { loadSentinelConfig } = await import('./sentinel-config')
    const dir = mkdtempSync(join(tmpdir(), 'sel-default-'))
    const cfgPath = join(dir, 'sentinel.json')
    writeFileSync(cfgPath, JSON.stringify({}))
    try {
      const cfg = loadSentinelConfig({ configPath: cfgPath })
      expect(cfg.defaultSelection).toBe('balanced')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('explicit defaultSelection: "default" is preserved', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { loadSentinelConfig } = await import('./sentinel-config')
    const dir = mkdtempSync(join(tmpdir(), 'sel-default-'))
    const cfgPath = join(dir, 'sentinel.json')
    writeFileSync(cfgPath, JSON.stringify({ defaultSelection: 'default' }))
    try {
      const cfg = loadSentinelConfig({ configPath: cfgPath })
      expect(cfg.defaultSelection).toBe('default')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
