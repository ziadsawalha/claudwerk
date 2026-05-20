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
  profiles: Array<{ name: string; pool: string | null }>,
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

  test("input='default' token also routes through defaultSelection", () => {
    const cfg = mkConfig('balanced', [
      { name: 'default', pool: 'default' },
      { name: 'alt', pool: 'default' },
    ])
    const loads: Record<string, number> = { default: 0, alt: 5 }
    const r = pickProfile(cfg, { input: 'default', liveLoad: n => loads[n] ?? 0 })
    expect(r.picker).toBe('balanced')
    expect(r.profile.name).toBe('default')
  })
})

describe('pickProfile -- returns full ResolvedProfile bundle (env injection sanity)', () => {
  test('configDir + env preserved through fixed pick', () => {
    const cfg: SentinelConfig = {
      sourcePath: null,
      defaultSelection: 'default',
      defaultPool: 'default',
      profiles: {
        default: { name: 'default', configDir: '/home/.claude', env: {}, pool: 'default' },
        work: {
          name: 'work',
          configDir: '/home/.claude-work',
          env: { ANTHROPIC_API_KEY: 'sk-test' },
          pool: 'default',
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
