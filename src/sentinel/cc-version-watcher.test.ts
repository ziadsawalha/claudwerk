/**
 * Tier-1 unit tests for the CC daemon version watcher.
 *
 * The watcher is a pure factory: `ping` / `loadLastSeen` / `persistLastSeen` /
 * `emit` are injected, so the diff logic + persistence + emission can be
 * exercised without a real socket or filesystem.
 */
import { describe, expect, it } from 'bun:test'
import type { CcVersionChanged } from '../shared/protocol'
import { createCcVersionWatcher, diffCcVersion, type LastSeenCcVersion, type PingResult } from './cc-version-watcher'

describe('diffCcVersion', () => {
  it('returns null when both axes match', () => {
    const diff = diffCcVersion({ version: '2.1.144', proto: 1 }, { version: '2.1.144', proto: 1 })
    expect(diff).toBeNull()
  })

  it('flags a version bump with prev/next pair', () => {
    const diff = diffCcVersion({ version: '2.1.144', proto: 1 }, { version: '2.1.145', proto: 1 })
    expect(diff).toEqual({ fromVersion: '2.1.144', toVersion: '2.1.145', fromProto: 1, toProto: 1 })
  })

  it('flags a proto bump alone', () => {
    const diff = diffCcVersion({ version: '2.1.144', proto: 1 }, { version: '2.1.144', proto: 2 })
    expect(diff).toEqual({ fromVersion: '2.1.144', toVersion: '2.1.144', fromProto: 1, toProto: 2 })
  })

  it('first-observation: both prev fields null, returns null prev in the diff', () => {
    const diff = diffCcVersion({ version: null, proto: null }, { version: '2.1.144', proto: 1 })
    expect(diff).toEqual({ fromVersion: null, toVersion: '2.1.144', fromProto: null, toProto: 1 })
  })
})

interface Harness {
  pingResults: Array<PingResult | null | Error>
  stored: LastSeenCcVersion
  emitted: CcVersionChanged[]
  errors: Error[]
}

function makeHarness(initial: LastSeenCcVersion, pingResults: Array<PingResult | null | Error>): Harness {
  return { pingResults, stored: { ...initial }, emitted: [], errors: [] }
}

function makeWatcher(h: Harness, sentinelId = 'snt_test', nowValue = 1_700_000_000_000) {
  return createCcVersionWatcher({
    sentinelId,
    intervalMs: 60_000,
    now: () => nowValue,
    ping: async () => {
      const r = h.pingResults.shift()
      if (r instanceof Error) throw r
      return r ?? null
    },
    loadLastSeen: () => h.stored,
    persistLastSeen: next => {
      h.stored = next
    },
    emit: ev => h.emitted.push(ev),
    onError: err => h.errors.push(err),
  })
}

describe('createCcVersionWatcher', () => {
  it('no diff -> no emit, no persist', async () => {
    const h = makeHarness({ version: '2.1.144', proto: 1 }, [{ version: '2.1.144', proto: 1 }])
    const w = makeWatcher(h)
    await w.runOnce()
    expect(h.emitted).toEqual([])
    expect(h.stored).toEqual({ version: '2.1.144', proto: 1 })
  })

  it('version bump -> single emit with prev/next + persist', async () => {
    const h = makeHarness({ version: '2.1.144', proto: 1 }, [{ version: '2.1.145', proto: 1 }])
    const w = makeWatcher(h, 'snt_x', 1_700_000_000_999)
    await w.runOnce()
    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0]).toEqual({
      type: 'cc_version_changed',
      sentinelId: 'snt_x',
      fromVersion: '2.1.144',
      toVersion: '2.1.145',
      fromProto: 1,
      toProto: 1,
      observedAt: 1_700_000_000_999,
    })
    expect(h.stored).toEqual({ version: '2.1.145', proto: 1 })
  })

  it('proto bump alone -> emits with the bumped proto', async () => {
    const h = makeHarness({ version: '2.1.144', proto: 1 }, [{ version: '2.1.144', proto: 2 }])
    const w = makeWatcher(h)
    await w.runOnce()
    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0]?.fromProto).toBe(1)
    expect(h.emitted[0]?.toProto).toBe(2)
    expect(h.stored).toEqual({ version: '2.1.144', proto: 2 })
  })

  it('first observation after install -> emit with fromVersion / fromProto null', async () => {
    const h = makeHarness({ version: null, proto: null }, [{ version: '2.1.144', proto: 1 }])
    const w = makeWatcher(h)
    await w.runOnce()
    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0]?.fromVersion).toBeNull()
    expect(h.emitted[0]?.fromProto).toBeNull()
    expect(h.emitted[0]?.toVersion).toBe('2.1.144')
  })

  it('ping returns null (daemon unreachable) -> silent skip, no persist', async () => {
    const h = makeHarness({ version: '2.1.144', proto: 1 }, [null])
    const w = makeWatcher(h)
    await w.runOnce()
    expect(h.emitted).toEqual([])
    expect(h.errors).toEqual([])
    expect(h.stored).toEqual({ version: '2.1.144', proto: 1 })
  })

  it('ping throws -> onError fired, no emit', async () => {
    const h = makeHarness({ version: '2.1.144', proto: 1 }, [new Error('boom')])
    const w = makeWatcher(h)
    await w.runOnce()
    expect(h.emitted).toEqual([])
    expect(h.errors).toHaveLength(1)
    expect(h.errors[0]?.message).toBe('boom')
  })

  it('runOnce is reentrant-safe (concurrent calls coalesce)', async () => {
    const h = makeHarness({ version: '2.1.144', proto: 1 }, [{ version: '2.1.145', proto: 1 }])
    const w = makeWatcher(h)
    await Promise.all([w.runOnce(), w.runOnce()])
    expect(h.emitted).toHaveLength(1)
  })
})
