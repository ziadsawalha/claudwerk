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
import { pickProfile } from './selection'
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

// ─── Smart Balance (telemetry-aware Balanced) ──────────────────────
//
// Balanced now consumes an optional `usage` source (per-profile rate-limit
// headroom). Fresh telemetry beats live-load; stale or missing entries fall
// back to live-load. Mixed pools blend the two onto a unified rank.

describe('pickProfile -- Smart Balance', () => {
  const cfg = mkConfig('balanced', [
    { name: 'alt', pool: 'default' },
    { name: 'default', pool: 'default' },
    { name: 'work', pool: 'default' },
  ])

  test('all-fresh pool: picks the profile with the most headroom', () => {
    const usage = (name: string) => {
      const tbl: Record<string, { headroom: number; stale: boolean }> = {
        default: { headroom: 0.1, stale: false }, // 90% burned
        alt: { headroom: 0.85, stale: false }, // 15% burned, winner
        work: { headroom: 0.4, stale: false },
      }
      return tbl[name]
    }
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    expect(r.profile.name).toBe('alt')
    expect(r.reason).toBe('smart-balance')
  })

  test('all-stale telemetry falls back to least-active (legacy behaviour)', () => {
    const usage = (name: string) => ({
      // Stale -> rank uses -liveLoad, headroom value is ignored.
      headroom: name === 'default' ? 0.05 : 0.9,
      stale: true,
    })
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

  test('partial telemetry: fresh-high-headroom beats stale-loaded', () => {
    const usage = (name: string) => {
      if (name === 'alt') return { headroom: 0.9, stale: false } // rank 0.9
      return undefined // others have no snapshot -> rank by live-load
    }
    const load = (name: string) => (name === 'default' ? 5 : 4) // both stale -> 0.17, 0.2
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: load })
    expect(r.profile.name).toBe('alt')
    expect(r.reason).toBe('smart-balance') // at least one fresh -> smart-balance label
  })

  test('partial telemetry: stale-but-idle beats fresh-low-headroom', () => {
    // Documents the bias: a profile with zero load (rank 1/(1+0)=1.0) beats
    // a fresh-but-99%-burned profile (rank 0.01). Demonstrably-idle wins.
    const usage = (name: string) => {
      if (name === 'work') return { headroom: 0.01, stale: false }
      return undefined
    }
    const load = (name: string) => (name === 'default' ? 0 : 99)
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: load })
    expect(r.profile.name).toBe('default')
    expect(r.reason).toBe('smart-balance')
  })

  test('errored / unauthed snapshot is treated as no telemetry', () => {
    // A profile that recently failed to poll has `undefined` from the source
    // (the caller computes the snapshot to UsageHeadroom mapping). Confirm
    // the selection works the same as "no source" for that profile.
    const usage = (name: string) => (name === 'default' ? { headroom: 0.7, stale: false } : undefined)
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    // 'default' has rank 0.7 (fresh). Others rank 1.0 (load 0, no telemetry).
    // Tie-broken by name: 'alt' wins.
    expect(r.profile.name).toBe('alt')
    expect(r.reason).toBe('smart-balance')
  })

  test('headroom clamps gracefully outside [0,1]', () => {
    const usage = (name: string) => {
      if (name === 'default') return { headroom: 1.5, stale: false } // clamps to 1
      if (name === 'alt') return { headroom: -0.3, stale: false } // clamps to 0
      return undefined
    }
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    expect(r.profile.name).toBe('default')
  })

  test('tie on rank: alphabetical name wins (stable)', () => {
    const usage = () => ({ headroom: 0.5, stale: false })
    const r = pickProfile(cfg, { input: 'balanced', usage, liveLoad: () => 0 })
    expect(r.profile.name).toBe('alt') // alphabetically first
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
