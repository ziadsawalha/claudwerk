/**
 * Tests for /api/stats/profiles -- sentinel-profiles Phase 5 deliverable.
 *
 * The endpoint surfaces the per-(sentinelId, profile) cost rollup, with
 * legacy / pre-Phase-5 turns bucketed under sentinelId='' / profile='default'.
 * Profile names can collide across sentinels (`work@default` vs `work@beast`
 * are different accounts) -- the (sentinelId, profile) tuple is the key.
 *
 * The broker stores NAMES only -- never configDir or env (Profile-Env Boundary).
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { setRclaudeSecret } from '../../auth-routes'
import { type ConversationStore, createConversationStore } from '../../conversation-store'
import { createMemoryDriver } from '../../store/memory/driver'
import type { StoreDriver } from '../../store/types'
import { createRouteHelpers, type RouteHelpers } from '../shared'
import { createStatsRouter } from '../stats'

const TEST_SECRET = 'test-secret-stats-profiles-42'

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_SECRET}` }
}

let app: Hono
let store: StoreDriver
let conversationStore: ConversationStore
let helpers: RouteHelpers

beforeEach(() => {
  store = createMemoryDriver()
  store.init()
  conversationStore = createConversationStore({ store, enablePersistence: false })
  setRclaudeSecret(TEST_SECRET)
  helpers = createRouteHelpers(TEST_SECRET)

  app = new Hono()
  app.route('/', createStatsRouter(conversationStore, store, helpers, Date.now()))
})

function recordTurn(
  overrides: {
    timestamp?: number
    conversationId?: string
    sentinelId?: string
    profile?: string
    costUsd?: number
  } = {},
) {
  store.costs.recordTurn({
    timestamp: overrides.timestamp ?? Date.now(),
    conversationId: overrides.conversationId ?? 'conv-1',
    projectUri: 'claude://default/proj',
    account: 'alice@example.com',
    orgId: 'org-1',
    model: 'claude-opus-4',
    inputTokens: 100,
    outputTokens: 200,
    cacheReadTokens: 50,
    cacheWriteTokens: 25,
    costUsd: overrides.costUsd ?? 0.1,
    exactCost: true,
    sentinelId: overrides.sentinelId,
    profile: overrides.profile,
  })
}

describe('GET /api/stats/profiles', () => {
  it('rejects without admin auth', async () => {
    const res = await app.request('/api/stats/profiles')
    expect(res.status).toBe(403)
  })

  it('returns an empty list when there are no recorded turns', async () => {
    const res = await app.request('/api/stats/profiles', { headers: authHeaders() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { profiles: unknown[] }
    expect(body.profiles).toEqual([])
  })

  it('groups by (sentinelId, profile) and sorts by costUsd desc', async () => {
    const t = Date.now() - 60_000
    recordTurn({ timestamp: t, sentinelId: 'snt_a', profile: 'work', costUsd: 1 })
    recordTurn({ timestamp: t + 1, sentinelId: 'snt_a', profile: 'work', costUsd: 2 })
    recordTurn({ timestamp: t + 2, sentinelId: 'snt_a', profile: 'alt', costUsd: 0.5 })
    // Same profile NAME, different sentinel -- must be a separate bucket.
    recordTurn({ timestamp: t + 3, sentinelId: 'snt_b', profile: 'work', costUsd: 0.25 })

    const res = await app.request('/api/stats/profiles', { headers: authHeaders() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      profiles: Array<{ sentinelId: string; profile: string; costUsd: number; turns: number }>
    }
    expect(body.profiles).toHaveLength(3)
    expect(body.profiles[0]).toMatchObject({ sentinelId: 'snt_a', profile: 'work', turns: 2 })
    expect(body.profiles[0].costUsd).toBeCloseTo(3)
    expect(body.profiles[1]).toMatchObject({ sentinelId: 'snt_a', profile: 'alt' })
    expect(body.profiles[2]).toMatchObject({ sentinelId: 'snt_b', profile: 'work' })
  })

  it('buckets implicit / legacy turns under sentinelId="" + profile="default"', async () => {
    const t = Date.now() - 60_000
    // No sentinelId, no profile -- legacy / pre-Phase-5 turn.
    recordTurn({ timestamp: t, costUsd: 0.2 })
    // Empty-string profile -- treated identically to undefined.
    recordTurn({ timestamp: t + 1, profile: '', costUsd: 0.1 })
    // Explicit 'default' name -- same bucket.
    recordTurn({ timestamp: t + 2, profile: 'default', costUsd: 0.3 })

    const res = await app.request('/api/stats/profiles', { headers: authHeaders() })
    const body = (await res.json()) as { profiles: Array<{ sentinelId: string; profile: string; turns: number }> }
    expect(body.profiles).toHaveLength(1)
    expect(body.profiles[0].sentinelId).toBe('')
    expect(body.profiles[0].profile).toBe('default')
    expect(body.profiles[0].turns).toBe(3)
  })

  it('filters by ?sentinelId=...', async () => {
    const t = Date.now() - 60_000
    recordTurn({ timestamp: t, sentinelId: 'snt_a', profile: 'work', costUsd: 1 })
    recordTurn({ timestamp: t + 1, sentinelId: 'snt_b', profile: 'work', costUsd: 2 })

    const res = await app.request('/api/stats/profiles?sentinelId=snt_b', { headers: authHeaders() })
    const body = (await res.json()) as { profiles: Array<{ sentinelId: string; costUsd: number }> }
    expect(body.profiles).toHaveLength(1)
    expect(body.profiles[0].sentinelId).toBe('snt_b')
    expect(body.profiles[0].costUsd).toBeCloseTo(2)
  })

  it('filters by ?from / ?to time window', async () => {
    const now = Date.now()
    recordTurn({ timestamp: now - 10 * 60_000, sentinelId: 'snt_a', profile: 'work', costUsd: 0.1 })
    recordTurn({ timestamp: now - 1_000, sentinelId: 'snt_a', profile: 'work', costUsd: 0.2 })

    const res = await app.request(`/api/stats/profiles?from=${now - 5 * 60_000}&to=${now}`, { headers: authHeaders() })
    const body = (await res.json()) as { profiles: Array<{ costUsd: number; turns: number }> }
    expect(body.profiles).toHaveLength(1)
    expect(body.profiles[0].turns).toBe(1)
    expect(body.profiles[0].costUsd).toBeCloseTo(0.2)
  })
})
