import { describe, expect, test } from 'bun:test'
import { DISPATCH_RECENCY_FLOOR, DISPATCH_RECENCY_HALF_LIFE_MS, recencyWeight } from './decay'

describe('recencyWeight', () => {
  const now = 10_000_000_000

  test('is 1 at age 0', () => {
    expect(recencyWeight(now, now)).toBe(1)
  })

  test('halves after exactly one half-life', () => {
    expect(recencyWeight(now - DISPATCH_RECENCY_HALF_LIFE_MS, now)).toBeCloseTo(0.5, 10)
  })

  test('quarters after two half-lives', () => {
    expect(recencyWeight(now - 2 * DISPATCH_RECENCY_HALF_LIFE_MS, now)).toBeCloseTo(0.25, 10)
  })

  test('a missing or zero timestamp is fully decayed (0)', () => {
    expect(recencyWeight(undefined, now)).toBe(0)
    expect(recencyWeight(0, now)).toBe(0)
  })

  test('a future timestamp clamps to 1 (no negative age boost)', () => {
    expect(recencyWeight(now + 60_000, now)).toBe(1)
  })

  test('decays monotonically with age', () => {
    const a = recencyWeight(now - 1 * DISPATCH_RECENCY_HALF_LIFE_MS, now)
    const b = recencyWeight(now - 3 * DISPATCH_RECENCY_HALF_LIFE_MS, now)
    expect(a).toBeGreaterThan(b)
  })

  test('crosses the prune floor a bit past 4 half-lives', () => {
    // 4 half-lives = 0.0625 (above floor); 5 = 0.03125 (below floor).
    expect(recencyWeight(now - 4 * DISPATCH_RECENCY_HALF_LIFE_MS, now)).toBeGreaterThan(DISPATCH_RECENCY_FLOOR)
    expect(recencyWeight(now - 5 * DISPATCH_RECENCY_HALF_LIFE_MS, now)).toBeLessThan(DISPATCH_RECENCY_FLOOR)
  })

  test('respects a custom half-life', () => {
    expect(recencyWeight(now - 1000, now, 1000)).toBeCloseTo(0.5, 10)
  })
})
