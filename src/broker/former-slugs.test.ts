/**
 * Tests for the pure rename-alias retention + decay helpers
 * (conversation-rename Phase 2b).
 */

import { describe, expect, it } from 'bun:test'
import {
  isAliasLive,
  MAX_FORMER_SLUGS,
  pruneExpiredAliases,
  RENAME_ALIAS_TTL_MS,
  recordRetiredSlug,
} from './former-slugs'

const NOW = 1_000_000_000

describe('isAliasLive', () => {
  it('is live just inside the window', () => {
    expect(isAliasLive({ slug: 'a', retiredAt: 0, lastUsedAt: NOW - (RENAME_ALIAS_TTL_MS - 1) }, NOW)).toBe(true)
  })
  it('is dead at/after the window', () => {
    expect(isAliasLive({ slug: 'a', retiredAt: 0, lastUsedAt: NOW - RENAME_ALIAS_TTL_MS }, NOW)).toBe(false)
  })
})

describe('pruneExpiredAliases', () => {
  it('drops expired, keeps live', () => {
    const live = { slug: 'live', retiredAt: 0, lastUsedAt: NOW - 1000 }
    const dead = { slug: 'dead', retiredAt: 0, lastUsedAt: NOW - RENAME_ALIAS_TTL_MS - 1 }
    expect(pruneExpiredAliases([live, dead], NOW)).toEqual([live])
  })
  it('handles undefined/empty', () => {
    expect(pruneExpiredAliases(undefined, NOW)).toEqual([])
    expect(pruneExpiredAliases([], NOW)).toEqual([])
  })
})

describe('recordRetiredSlug', () => {
  it('adds the retired slug', () => {
    const out = recordRetiredSlug(undefined, 'old-name', 'new-name', NOW)
    expect(out).toEqual([{ slug: 'old-name', retiredAt: NOW, lastUsedAt: NOW }])
  })

  it('skips when retiredSlug is empty (cleared title)', () => {
    expect(recordRetiredSlug(undefined, '', 'new-name', NOW)).toEqual([])
  })

  it('skips when retiredSlug equals newSlug (no-op rename)', () => {
    expect(recordRetiredSlug(undefined, 'same', 'same', NOW)).toEqual([])
  })

  it('removes newSlug from history (a current name is not also a stale alias)', () => {
    const former = [{ slug: 'reused', retiredAt: 1, lastUsedAt: 2 }]
    // Renaming BACK to "reused": it must drop out of formerSlugs.
    const out = recordRetiredSlug(former, 'something-else', 'reused', NOW)
    expect(out.find(e => e.slug === 'reused')).toBeUndefined()
    expect(out.find(e => e.slug === 'something-else')).toBeDefined()
  })

  it('refreshes an existing retired entry instead of duplicating', () => {
    const former = [{ slug: 'old-name', retiredAt: 1, lastUsedAt: 2 }]
    const out = recordRetiredSlug(former, 'old-name', 'new', NOW)
    expect(out.filter(e => e.slug === 'old-name')).toHaveLength(1)
    expect(out[0]).toEqual({ slug: 'old-name', retiredAt: NOW, lastUsedAt: NOW })
  })

  it('prunes expired entries while recording', () => {
    const former = [{ slug: 'dead', retiredAt: 0, lastUsedAt: NOW - RENAME_ALIAS_TTL_MS - 1 }]
    const out = recordRetiredSlug(former, 'old', 'new', NOW)
    expect(out.find(e => e.slug === 'dead')).toBeUndefined()
    expect(out.find(e => e.slug === 'old')).toBeDefined()
  })

  it('caps at MAX_FORMER_SLUGS, keeping newest by lastUsedAt', () => {
    const former = Array.from({ length: MAX_FORMER_SLUGS }, (_, i) => ({
      slug: `s${i}`,
      retiredAt: i,
      lastUsedAt: NOW - (MAX_FORMER_SLUGS - i) * 1000, // s0 oldest, s9 newest
    }))
    const out = recordRetiredSlug(former, 'brand-new', 'current', NOW)
    expect(out).toHaveLength(MAX_FORMER_SLUGS)
    // The oldest (s0) should have been evicted; brand-new (lastUsedAt=NOW) kept.
    expect(out.find(e => e.slug === 's0')).toBeUndefined()
    expect(out.find(e => e.slug === 'brand-new')).toBeDefined()
  })
})
