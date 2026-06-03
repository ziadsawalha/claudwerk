import { describe, expect, it } from 'bun:test'
import type { RecapSignal } from '../../../shared/protocol'
import { recapCacheKey } from './orchestrator'

const base = {
  projectUri: 'claude://default/test',
  periodStart: 1000,
  periodEnd: 2000,
  audience: 'human' as const,
  customerFriendly: false,
  signals: ['commits', 'cost'] as RecapSignal[],
}

describe('recapCacheKey', () => {
  it('is stable for identical inputs', () => {
    expect(recapCacheKey(base)).toBe(recapCacheKey({ ...base }))
  })

  it('customerFriendly busts the cache -- sanitized and raw are distinct documents', () => {
    expect(recapCacheKey({ ...base, customerFriendly: true })).not.toBe(recapCacheKey(base))
  })

  it('audience remains part of the key (human vs agent do not collide)', () => {
    expect(recapCacheKey({ ...base, audience: 'agent' })).not.toBe(recapCacheKey(base))
  })

  it('period + signals still differentiate', () => {
    expect(recapCacheKey({ ...base, periodEnd: 3000 })).not.toBe(recapCacheKey(base))
    expect(recapCacheKey({ ...base, signals: ['commits'] as RecapSignal[] })).not.toBe(recapCacheKey(base))
  })
})
