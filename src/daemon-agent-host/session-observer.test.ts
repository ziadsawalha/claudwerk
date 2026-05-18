/**
 * Tier 1 unit tests for `session-observer` -- the no-hook ccSessionId
 * derivation. Drives the observer against an injected fake `list` (the
 * `listFn` test seam), so no socket or `claude` install is needed.
 */
import { describe, expect, test } from 'bun:test'
import type { JobRecord, ListResponse } from '../shared/cc-daemon/types'
import { observeDaemonSession } from './session-observer'

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Build a `list` response from partial job records. */
function listOf(...jobs: Partial<JobRecord>[]): ListResponse {
  return {
    ok: true,
    op: 'list',
    jobs: jobs.map(j => ({ short: '', sessionId: '', cwd: '', state: 'working', ...j })),
  }
}

describe('observeDaemonSession -- sessionId derivation', () => {
  test('reports the worker sessionId once it appears', async () => {
    const seen: string[] = []
    const obs = observeDaemonSession({
      controlSock: '/fake.sock',
      daemonShort: 'aaaa1111',
      pollIntervalMs: 10,
      onSessionId: id => seen.push(id),
      listFn: async () => listOf({ short: 'aaaa1111', sessionId: 'sess-1' }),
    })
    await sleep(40)
    obs.stop()
    expect(seen).toEqual(['sess-1'])
  })

  test('reports a new sessionId when /clear rotates it', async () => {
    const seen: string[] = []
    let sessionId = 'sess-1'
    const obs = observeDaemonSession({
      controlSock: '/fake.sock',
      daemonShort: 'aaaa1111',
      pollIntervalMs: 10,
      onSessionId: id => seen.push(id),
      listFn: async () => listOf({ short: 'aaaa1111', sessionId }),
    })
    await sleep(40)
    sessionId = 'sess-2'
    await sleep(40)
    obs.stop()
    expect(seen).toEqual(['sess-1', 'sess-2'])
  })

  test('ignores jobs that are not our worker short', async () => {
    const seen: string[] = []
    const obs = observeDaemonSession({
      controlSock: '/fake.sock',
      daemonShort: 'aaaa1111',
      pollIntervalMs: 10,
      onSessionId: id => seen.push(id),
      listFn: async () => listOf({ short: 'bbbb2222', sessionId: 'other' }),
    })
    await sleep(40)
    obs.stop()
    expect(seen).toEqual([])
  })

  test('skips an empty sessionId (worker still starting)', async () => {
    const seen: string[] = []
    let sessionId = ''
    const obs = observeDaemonSession({
      controlSock: '/fake.sock',
      daemonShort: 'aaaa1111',
      pollIntervalMs: 10,
      onSessionId: id => seen.push(id),
      listFn: async () => listOf({ short: 'aaaa1111', sessionId }),
    })
    await sleep(30)
    sessionId = 'sess-late'
    await sleep(40)
    obs.stop()
    expect(seen).toEqual(['sess-late'])
  })
})

describe('observeDaemonSession -- worker lifecycle', () => {
  test('fires onGone once the worker leaves the roster', async () => {
    let present = true
    let gone = 0
    const obs = observeDaemonSession({
      controlSock: '/fake.sock',
      daemonShort: 'aaaa1111',
      pollIntervalMs: 10,
      onSessionId: () => {},
      onGone: () => gone++,
      listFn: async () => (present ? listOf({ short: 'aaaa1111', sessionId: 's' }) : listOf()),
    })
    await sleep(30)
    present = false
    await sleep(40)
    obs.stop()
    expect(gone).toBe(1)
  })

  test('does NOT fire onGone before the worker is ever seen (startup race)', async () => {
    let gone = 0
    const obs = observeDaemonSession({
      controlSock: '/fake.sock',
      daemonShort: 'aaaa1111',
      pollIntervalMs: 10,
      onSessionId: () => {},
      onGone: () => gone++,
      listFn: async () => listOf(), // worker not registered yet
    })
    await sleep(50)
    obs.stop()
    expect(gone).toBe(0)
  })

  test('reports list failures via onError and keeps polling', async () => {
    const errors: string[] = []
    let fail = true
    const obs = observeDaemonSession({
      controlSock: '/fake.sock',
      daemonShort: 'aaaa1111',
      pollIntervalMs: 10,
      onSessionId: () => {},
      onError: e => errors.push(e.message),
      listFn: async () => {
        if (fail) throw new Error('socket gone')
        return listOf({ short: 'aaaa1111', sessionId: 's' })
      },
    })
    await sleep(30)
    fail = false
    await sleep(40)
    obs.stop()
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toBe('socket gone')
  })

  test('stop() halts polling', async () => {
    let calls = 0
    const obs = observeDaemonSession({
      controlSock: '/fake.sock',
      daemonShort: 'aaaa1111',
      pollIntervalMs: 10,
      onSessionId: () => {},
      listFn: async () => {
        calls++
        return listOf()
      },
    })
    await sleep(30)
    obs.stop()
    const after = calls
    await sleep(40)
    expect(calls).toBe(after)
  })
})
