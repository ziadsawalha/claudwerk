/**
 * use-daemon-roster tests -- flattening, sentinel tagging and sort order of
 * the daemon roster the spawn dialog's ATTACH mode consumes.
 */

import type { DaemonRosterForward, DaemonRosterJob } from '@shared/protocol'
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { useConversationsStore } from './use-conversations'
import { useDaemonRoster } from './use-daemon-roster'

afterEach(() => {
  cleanup()
  useConversationsStore.setState({ daemonRosters: {} })
})

function job(overrides: Partial<DaemonRosterJob> = {}): DaemonRosterJob {
  return { conversationId: 'conv_a', short: 'aaaaaaaa', cwd: '/x', state: 'working', ...overrides }
}

function forward(overrides: Partial<DaemonRosterForward> = {}): DaemonRosterForward {
  return {
    type: 'daemon_roster',
    sentinelId: 'snt_1',
    sentinelAlias: 'host-1',
    daemonPresent: true,
    jobs: [job()],
    observedAt: 1000,
    ...overrides,
  }
}

function seed(rosters: Record<string, DaemonRosterForward>): void {
  useConversationsStore.setState({ daemonRosters: rosters })
}

describe('useDaemonRoster', () => {
  test('reports no roster before any push', () => {
    seed({})
    const { result } = renderHook(() => useDaemonRoster(false))
    expect(result.current.hasRoster).toBe(false)
    expect(result.current.jobs).toEqual([])
    expect(result.current.daemonPresent).toBe(false)
  })

  test('flattens jobs and tags each with its owning sentinel', () => {
    seed({ snt_1: forward({ jobs: [job({ short: 'aaaaaaaa' })] }) })
    const { result } = renderHook(() => useDaemonRoster(false))
    expect(result.current.hasRoster).toBe(true)
    expect(result.current.jobs).toHaveLength(1)
    expect(result.current.jobs[0]!.short).toBe('aaaaaaaa')
    expect(result.current.jobs[0]!.sentinelId).toBe('snt_1')
    expect(result.current.jobs[0]!.sentinelAlias).toBe('host-1')
  })

  test('merges rosters from multiple sentinels', () => {
    seed({
      snt_1: forward({ sentinelId: 'snt_1', jobs: [job({ short: 'aaaaaaaa' })] }),
      snt_2: forward({ sentinelId: 'snt_2', sentinelAlias: 'host-2', jobs: [job({ short: 'bbbbbbbb' })] }),
    })
    const { result } = renderHook(() => useDaemonRoster(false))
    expect(result.current.jobs).toHaveLength(2)
    const shorts = result.current.jobs.map(j => j.short).sort()
    expect(shorts).toEqual(['aaaaaaaa', 'bbbbbbbb'])
  })

  test('sorts jobs newest-dispatch first by startedAt', () => {
    seed({
      snt_1: forward({
        jobs: [
          job({ short: 'aaaaaaaa', startedAt: 100 }),
          job({ short: 'bbbbbbbb', startedAt: 900 }),
          job({ short: 'cccccccc', startedAt: 500 }),
        ],
      }),
    })
    const { result } = renderHook(() => useDaemonRoster(false))
    expect(result.current.jobs.map(j => j.short)).toEqual(['bbbbbbbb', 'cccccccc', 'aaaaaaaa'])
  })

  test('daemonPresent is true when any sentinel reports a reachable daemon', () => {
    seed({
      snt_1: forward({ sentinelId: 'snt_1', daemonPresent: false, jobs: [] }),
      snt_2: forward({ sentinelId: 'snt_2', daemonPresent: true, jobs: [job({ short: 'bbbbbbbb' })] }),
    })
    const { result } = renderHook(() => useDaemonRoster(false))
    expect(result.current.daemonPresent).toBe(true)
  })

  test('observedAt is the newest across all sentinel rosters', () => {
    seed({
      snt_1: forward({ sentinelId: 'snt_1', observedAt: 1000 }),
      snt_2: forward({ sentinelId: 'snt_2', observedAt: 5000 }),
    })
    const { result } = renderHook(() => useDaemonRoster(false))
    expect(result.current.observedAt).toBe(5000)
  })
})
