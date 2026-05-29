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
import { GATE_FIVE_HOUR_PCT, pickProfile } from './selection'
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

// ─── Smart Balance v3 (5h hard gate + 7d drain pressure) ───────────
//
// v3 splits the two windows: the 5h window is a HARD GATE (a profile at/over
// GATE_FIVE_HOUR_PCT drops below every eligible one -- a spawn there would
// blow through the cap mid-turn) and the 7d window is a SOFT PREFERENCE
// (drain pressure = headroom% / hours-until-7d-reset -- spend the weekly
// budget that's about to refresh before it's wasted). Three disjoint bands:
// eligible [0.5,1.0] > unknown/stale [0.25,0.5) > gated [0,0.25).

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

interface Tele {
  fiveHour?: number
  sevenDay?: number
  ms5h?: number
  ms7d?: number
}
const TELE_DEFAULTS: Required<Tele> = { fiveHour: 0, sevenDay: 0, ms5h: 2 * HOUR_MS, ms7d: 7 * DAY_MS }
const fresh = (t: Tele = {}) => {
  const m = { ...TELE_DEFAULTS, ...t }
  return {
    fiveHourUsedPercent: m.fiveHour,
    sevenDayUsedPercent: m.sevenDay,
    msUntilFiveHourReset: m.ms5h,
    msUntilSevenDayReset: m.ms7d,
    stale: false,
  }
}
const stale = (t: Tele = {}) => ({ ...fresh(t), stale: true })

describe('pickProfile -- Smart Balance v3', () => {
  const cfg = mkConfig('balanced', [
    { name: 'alt', pool: 'default' },
    { name: 'default', pool: 'default' },
    { name: 'work', pool: 'default' },
  ])

  test('the screenshot: 5h gate excludes the near-cap account', () => {
    // Mirrors the live popover: default 5h=80% (over the 75% gate -> gated
    // band), work 5h=57% (eligible). Even though default has MORE 7d headroom (81%
    // vs 72%), the 5h gate keeps it out -- a spawn there would throttle. work
    // wins. 'alt' has no telemetry (unknown band) and loses to eligible work.
    const usage = (name: string) => {
      if (name === 'default') return fresh({ fiveHour: 80, sevenDay: 19, ms7d: 6 * DAY_MS + 11 * HOUR_MS })
      if (name === 'work') return fresh({ fiveHour: 57, sevenDay: 28, ms7d: 2 * DAY_MS + 2 * HOUR_MS })
      return undefined
    }
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    expect(r.profile.name).toBe('work')
    expect(r.reason).toBe('smart-balance')
  })

  test('7d drain pressure: soonest-resetting weekly budget wins among eligible', () => {
    // Both under the 5h gate. work resets its 7d in ~2d with 72% headroom
    // (1.44%/h); default resets in ~6.4d with 81% headroom (0.52%/h). Spend
    // the soon-to-reset quota first -> work wins. A naive "most total
    // headroom" picker would wrongly grab default (81 > 72).
    const usage = (name: string) => {
      if (name === 'default') return fresh({ fiveHour: 50, sevenDay: 19, ms7d: 6 * DAY_MS + 10 * HOUR_MS })
      if (name === 'work') return fresh({ fiveHour: 57, sevenDay: 28, ms7d: 2 * DAY_MS })
      return undefined
    }
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    expect(r.profile.name).toBe('work')
  })

  test('drain pressure self-limits: a near-drained soon-reset account loses headroom', () => {
    // work resets in 2d but is already 95% used (5% headroom -> 0.1%/h);
    // default resets in 6d with 70% headroom (~0.49%/h). The headroom%
    // numerator shrinks as a profile drains, so selection rotates AWAY from
    // work before it's slammed -- the "up to a limit" behaviour, for free.
    const usage = (name: string) => {
      if (name === 'work') return fresh({ fiveHour: 60, sevenDay: 95, ms7d: 2 * DAY_MS })
      if (name === 'default') return fresh({ fiveHour: 40, sevenDay: 30, ms7d: 6 * DAY_MS })
      return undefined
    }
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    expect(r.profile.name).toBe('default')
  })

  test('eligible beats unknown beats gated (band ordering)', () => {
    // default eligible, work gated (5h=90), alt no telemetry (unknown).
    // default (>=0.5) > alt (~0.5) > work (<0.25). default wins.
    const usage = (name: string) => {
      if (name === 'default') return fresh({ fiveHour: 50, sevenDay: 20 })
      if (name === 'work') return fresh({ fiveHour: 90 })
      return undefined
    }
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    expect(r.profile.name).toBe('default')
  })

  test('idle unknown beats a known-gated profile', () => {
    // Only work has telemetry and it's 5h-gated; alt/default are unknown,
    // idle. Unknown band (0.5) outranks gated band (<0.25). work loses.
    const usage = (name: string) => (name === 'work' ? fresh({ fiveHour: 95 }) : undefined)
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    expect(r.profile.name).not.toBe('work')
  })

  test('all profiles 5h-gated: the one freeing up soonest wins', () => {
    // Every candidate is over the 5h gate, so the gated band decides by
    // shortest wait to reset. work resets in 10min, default in 4h, alt in 8h.
    const usage = (name: string) => {
      if (name === 'work') return fresh({ fiveHour: 90, ms5h: 10 * 60 * 1000 })
      if (name === 'default') return fresh({ fiveHour: 85, ms5h: 4 * HOUR_MS })
      return fresh({ fiveHour: 95, ms5h: 8 * HOUR_MS })
    }
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    expect(r.profile.name).toBe('work')
    expect(r.reason).toBe('smart-balance')
  })

  test('eligible: load damps the pick when drain pressure ties', () => {
    // Identical 7d windows -> identical drain pressure. The 0.2 live-load
    // term breaks it toward the less-loaded profile.
    const usage = () => fresh({ fiveHour: 30, sevenDay: 40, ms7d: 3 * DAY_MS })
    const load = (name: string) => (name === 'default' ? 4 : 0)
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: load })
    expect(r.profile.name).toBe('alt') // idle, alphabetical over equally-idle work
    expect(r.profile.name).not.toBe('default')
  })

  test('all-stale telemetry falls back to least-active (legacy behavior)', () => {
    const usage = () => stale({ fiveHour: 90, sevenDay: 30 }) // %s ignored when stale
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

  test('partial telemetry: fresh-eligible beats stale-loaded', () => {
    const usage = (name: string) => (name === 'alt' ? fresh({ fiveHour: 20, sevenDay: 20 }) : undefined)
    const load = (name: string) => (name === 'default' ? 5 : 4) // others unknown -> ~0.3, 0.3
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: load })
    expect(r.profile.name).toBe('alt')
    expect(r.reason).toBe('smart-balance')
  })

  test('stale-idle beats a known-gated profile but loses to known-eligible', () => {
    // work is fresh-gated (5h=99). default is stale+idle -> unknown band
    // (~0.5), which beats gated work (<0.25). The deliberate bias: an idle
    // account we can't confirm beats one we KNOW is throttled.
    const usage = (name: string) => (name === 'work' ? fresh({ fiveHour: 99 }) : stale())
    const load = (name: string) => (name === 'default' ? 0 : 99)
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: load })
    expect(r.profile.name).toBe('default')
    expect(r.reason).toBe('smart-balance')
  })

  test('errored / unauthed snapshot is treated as no telemetry (unknown band)', () => {
    // default has fresh-eligible telemetry; alt/work return undefined. A
    // fresh-eligible profile (>=0.5) outranks idle-unknown (0.5 boundary)...
    // default's eligible rank is strictly > 0.5, so default wins.
    const usage = (name: string) => (name === 'default' ? fresh({ fiveHour: 20, sevenDay: 20 }) : undefined)
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    expect(r.profile.name).toBe('default')
    expect(r.reason).toBe('smart-balance')
  })

  test('utilization clamps gracefully outside [0,100]', () => {
    // default 7d=150 clamps to 100 (zero headroom -> pressure 0). alt 7d=-30
    // clamps to 0 (full headroom -> high pressure). Both eligible on 5h. alt
    // wins on drain pressure.
    const usage = (name: string) => {
      if (name === 'default') return fresh({ fiveHour: 10, sevenDay: 150 })
      if (name === 'alt') return fresh({ fiveHour: 10, sevenDay: -30 })
      return undefined
    }
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    expect(r.profile.name).toBe('alt')
  })

  test('reset clocks clamped above MIN_RESET_MS (no divide-by-zero)', () => {
    // Both eligible, identical 7d util, both with a 0ms 7d reset -> floored
    // internally so both get a finite (equal) drain pressure; tie -> name.
    const usage = () => fresh({ fiveHour: 30, sevenDay: 40, ms7d: 0 })
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    expect(r.profile.name).toBe('alt') // alphabetical, no divergence
  })

  test('GATE_FIVE_HOUR_PCT is the boundary: just-under eligible, at-gate gated', () => {
    // alt at gate-1 (eligible band >=0.5); work AT the gate (gated <0.25).
    // default loaded out of contention. alt wins.
    const usage = (name: string) => {
      if (name === 'alt') return fresh({ fiveHour: GATE_FIVE_HOUR_PCT - 1, sevenDay: 50 })
      if (name === 'work') return fresh({ fiveHour: GATE_FIVE_HOUR_PCT })
      return undefined
    }
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    expect(r.profile.name).toBe('alt')
  })
})

// Regression: no-monopoly spread across equal-pressure eligible profiles.
describe('pickProfile -- Smart Balance v3 spreads across equal-pressure pool', () => {
  // Pool must match defaultPool (third mkConfig arg) so balanced selection
  // actually considers both members.
  const cfg = mkConfig(
    'balanced',
    [
      { name: 'default', pool: 'work' },
      { name: 'work', pool: 'work' },
    ],
    'work',
  )

  test('simulated 4 spawns spread 2/2 when drain pressure is equal (load damps)', () => {
    // Identical 7d windows -> identical drain pressure, both eligible on 5h.
    // The live-load damping term breaks ties toward the less-loaded profile,
    // so picks alternate instead of monopolising one account.
    const usage = () => fresh({ fiveHour: 30, sevenDay: 30, ms7d: 3 * DAY_MS })
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
    expect(picks.filter(p => p === 'default').length).toBe(2)
    expect(picks.filter(p => p === 'work').length).toBe(2)
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
