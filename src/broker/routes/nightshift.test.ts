/**
 * Nightshift HTTP route -- the `run` (Run-now) intercept on the agent writer
 * path. POST {op:'run'} must execute IN the broker (orchestrator) and return a
 * JSON result without ever forwarding to the sentinel; it is files-permission
 * gated like the other writes. `runNightshift` is mocked so no real agents spawn.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { ConversationStore } from '../conversation-store'
import type { RouteHelpers } from './shared'

interface RunCall {
  project: string
  trigger: string
}
let runCalls: RunCall[] = []
let runOutcome: { ok: boolean; runId?: string; error?: string; skipped?: string } = { ok: true, runId: '2026-06-26' }

mock.module('../nightshift-orchestrator', () => ({
  runNightshift: async (_store: unknown, project: string, opts: { trigger: string }) => {
    runCalls.push({ project, trigger: opts.trigger })
    return runOutcome
  },
  isNightshiftRunActive: () => false,
}))

const { createNightshiftRouter } = await import('./nightshift')

const PROJECT = 'claude://default/Users/jonas/projects/remote-claude'
const SECRET = { Authorization: 'Bearer x', 'Content-Type': 'application/json' }

let sentinelSends: string[] = []
function makeApp(opts?: { denyPermission?: boolean }) {
  sentinelSends = []
  const sentinel = { send: (s: string) => sentinelSends.push(s) }
  const store = {
    getSentinel: () => sentinel,
    getSentinelByAlias: () => sentinel,
    // Resolve the relay promise immediately so the (non-run) sentinel path
    // doesn't block on its 10s timeout.
    addProjectListener: (_id: string, cb: (raw: unknown) => void) => cb({ type: 'nightshift_result', ok: true }),
    removeProjectListener() {},
  } as unknown as ConversationStore
  const helpers = { httpHasPermission: () => !opts?.denyPermission } as unknown as RouteHelpers
  return createNightshiftRouter(store, helpers)
}

beforeEach(() => {
  runCalls = []
  runOutcome = { ok: true, runId: '2026-06-26' }
})

describe('POST /api/nightshift op=run', () => {
  test('triggers runNightshift (manual) and returns JSON without relaying to the sentinel', async () => {
    const app = makeApp()
    const res = await app.request('/api/nightshift', {
      method: 'POST',
      headers: SECRET,
      body: JSON.stringify({ project: PROJECT, op: 'run' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ type: 'nightshift_result', op: 'run', ok: true, runId: '2026-06-26' })
    expect(runCalls).toEqual([{ project: PROJECT, trigger: 'manual' }])
    expect(sentinelSends).toHaveLength(0)
  })

  test('is files-permission gated (403 -> no spawn)', async () => {
    const app = makeApp({ denyPermission: true })
    const res = await app.request('/api/nightshift', {
      method: 'POST',
      headers: SECRET,
      body: JSON.stringify({ project: PROJECT, op: 'run' }),
    })
    expect(res.status).toBe(403)
    expect(runCalls).toHaveLength(0)
  })

  test('a non-error skip is returned as ok=false / 400 with the reason', async () => {
    runOutcome = { ok: false, skipped: 'queue is empty' }
    const app = makeApp()
    const res = await app.request('/api/nightshift', {
      method: 'POST',
      headers: SECRET,
      body: JSON.stringify({ project: PROJECT, op: 'run' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ op: 'run', ok: false, error: 'queue is empty' })
    expect(sentinelSends).toHaveLength(0)
  })

  test('a normal op (config_read) still relays to the sentinel', async () => {
    const app = makeApp()
    await app.request('/api/nightshift', {
      method: 'POST',
      headers: SECRET,
      body: JSON.stringify({ project: PROJECT, op: 'config_read' }),
    })
    expect(runCalls).toHaveLength(0)
    expect(sentinelSends).toHaveLength(1)
    expect(JSON.parse(sentinelSends[0])).toMatchObject({ type: 'nightshift_op', op: 'config_read' })
  })
})
