import { describe, expect, test } from 'bun:test'
import type { RecapDigest, RecapMetadata } from '../../../shared/protocol'
import {
  sanitizeDigestForPublicShare,
  sanitizeMetadataForPublicShare,
  sanitizeRecapForPublicShare,
} from './public-share-sanitize'

function makeDigest(): RecapDigest {
  return {
    cost: {
      totalCostUsd: 42,
      totalTurns: 100,
      totalInputTokens: 1,
      totalOutputTokens: 2,
      totalCacheReadTokens: 3,
      totalCacheWriteTokens: 4,
      perDay: [],
      perModel: [],
    },
    conversations: [
      { id: 'f55e55f7-de02', title: 'cosmic-otter', turns: 25, status: 'ended', costUsd: 305.27 },
      { id: '07511437-2e1e', title: 'email-driver', turns: 10, status: 'ended', costUsd: 12.5 },
    ],
    commits: { total: 7, filesChanged: 9, insertions: 100, deletions: 20 },
    activity: {
      conversations: 2,
      turns: 35,
      toolCalls: { total: 0, read: 0, edit: 0, write: 0, bash: 0, other: 0 },
      incidents: 0,
    },
    contextBuckets: [],
  }
}

describe('sanitizeDigestForPublicShare', () => {
  test('strips the per-conversation manifest (titles/ids/costs)', () => {
    const out = sanitizeDigestForPublicShare(makeDigest())
    expect(out?.conversations).toEqual([])
  })

  test('preserves aggregate analytics + the activity conversation count', () => {
    const out = sanitizeDigestForPublicShare(makeDigest())
    expect(out?.cost.totalCostUsd).toBe(42)
    expect(out?.cost.totalTurns).toBe(100)
    expect(out?.commits?.total).toBe(7)
    expect(out?.activity?.conversations).toBe(2)
  })

  test('passes undefined through (pre-2.0 recaps)', () => {
    expect(sanitizeDigestForPublicShare(undefined)).toBeUndefined()
  })

  test('the sanitized digest serializes with no conversation identity', () => {
    const json = JSON.stringify(sanitizeDigestForPublicShare(makeDigest()))
    expect(json).not.toContain('cosmic-otter')
    expect(json).not.toContain('email-driver')
    expect(json).not.toContain('f55e55f7-de02')
  })
})

describe('sanitizeMetadataForPublicShare', () => {
  test('strips conversation-id citations from section items, keeps prose + commits', () => {
    const metadata = {
      features: [
        { title: 'shipped X', detail: 'did the thing', conversations: ['conv_abc123def456'], commits: ['deadbeef'] },
      ],
      keywords: ['monaco', 'editor'],
      hashtags: ['#portal2'],
    } as unknown as RecapMetadata
    const out = sanitizeMetadataForPublicShare(metadata) as unknown as {
      features: Array<{ title: string; conversations?: unknown; commits?: string[] }>
      keywords: string[]
      hashtags: string[]
    }
    expect(out.features[0].conversations).toBeUndefined()
    expect(out.features[0].title).toBe('shipped X')
    expect(out.features[0].commits).toEqual(['deadbeef'])
    // string[] sections untouched
    expect(out.keywords).toEqual(['monaco', 'editor'])
    expect(out.hashtags).toEqual(['#portal2'])
  })

  test('serialized metadata leaks no conversation id', () => {
    const metadata = {
      bugs: [{ title: 'fixed Y', conversations: ['conv_secretid0001'] }],
    } as unknown as RecapMetadata
    const json = JSON.stringify(sanitizeMetadataForPublicShare(metadata))
    expect(json).not.toContain('conv_secretid0001')
  })

  test('passes undefined through', () => {
    expect(sanitizeMetadataForPublicShare(undefined)).toBeUndefined()
  })
})

describe('sanitizeRecapForPublicShare', () => {
  test('sanitizes both halves in one call', () => {
    const { metadata, digest } = sanitizeRecapForPublicShare({
      metadata: { features: [{ title: 'f', conversations: ['conv_x'] }] } as unknown as RecapMetadata,
      digest: makeDigest(),
    })
    expect(digest?.conversations).toEqual([])
    expect(JSON.stringify(metadata)).not.toContain('conv_x')
  })
})
