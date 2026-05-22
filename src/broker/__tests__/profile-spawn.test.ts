/**
 * Tests for the sentinel-profiles slice of the spawn dispatch path:
 *   - validating `req.profile` against the target sentinel's reported list
 *   - forwarding the profile / pool fields on the wire to the sentinel
 *   - stashing `spawn_result.resolvedProfile` for boot/meta to write onto
 *     `Conversation.resolvedProfile`
 *   - persisting `launchConfig.sentinelProfile` (INTENT tagged union -- either
 *     `{ kind: 'profile', name }` or `{ kind: 'pool', name }`) on the
 *     conversation
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import type { SentinelProfileInfo, SpawnConversation, SpawnResult } from '../../shared/protocol'
import type { SpawnRequest } from '../../shared/spawn-schema'
import { type ConversationStore, createConversationStore } from '../conversation-store'
import { dispatchSpawn, type SpawnDispatchDeps } from '../spawn-dispatch'
import { createMemoryDriver } from '../store/memory/driver'
import type { StoreDriver } from '../store/types'

let conversationStore: ConversationStore
let store: StoreDriver
let deps: SpawnDispatchDeps

// Capture every message the broker sends to the fake sentinel.
let sentinelOutbox: SpawnConversation[]

// fallow-ignore-next-line complexity
function captureSpawn(raw: string | ArrayBuffer | Uint8Array): number {
  if (typeof raw !== 'string') return 0
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.type === 'spawn') sentinelOutbox.push(parsed as SpawnConversation)
  } catch {}
  return 0
}

function makeFakeSentinelWs(): ServerWebSocket<unknown> {
  return {
    data: { isSentinel: true },
    readyState: 1,
    send: captureSpawn,
    close() {},
  } as unknown as ServerWebSocket<unknown>
}

function attachSentinel(
  alias = 'beast',
  profiles: SentinelProfileInfo[] | undefined = [
    { name: 'default', pool: 'default', weight: 1, authed: true },
    { name: 'work', pool: null, weight: 1, authed: true, label: 'Work' },
    { name: 'alt', pool: 'default', weight: 1, authed: false },
  ],
  pools: string[] | undefined = ['default'],
  defaultPool = 'default',
): ServerWebSocket<unknown> {
  const ws = makeFakeSentinelWs()
  conversationStore.setSentinel(ws, {
    sentinelId: `snt-${alias}`,
    alias,
    hostname: `${alias}.local`,
    profiles,
    defaultSelection: 'default',
    pools,
    defaultPool,
  })
  conversationStore.recordSentinelHeartbeat(ws)
  return ws
}

function makeDeps(): SpawnDispatchDeps {
  return {
    conversationStore,
    getProjectSettings: () => null,
    getGlobalSettings: () => ({}) as ReturnType<SpawnDispatchDeps['getGlobalSettings']>,
    callerContext: { kind: 'http', hasSpawnPermission: true, trustLevel: 'trusted', callerProject: null },
  }
}

/** Drive the spawn promise to completion by injecting a sentinel reply. */
async function dispatchWithSpawnReply(
  req: SpawnRequest,
  reply: (requestId: string) => SpawnResult,
): Promise<Awaited<ReturnType<typeof dispatchSpawn>>> {
  const dispatched = dispatchSpawn(req, deps)
  await new Promise(r => setTimeout(r, 5))
  const last = sentinelOutbox[sentinelOutbox.length - 1]
  if (last) conversationStore.resolveSpawn(last.requestId, reply(last.requestId))
  return dispatched
}

/** Convenience: build a successful spawn_result with optional resolvedProfile. */
function okResult(requestId: string, project: string, resolvedProfile?: string): SpawnResult {
  return {
    type: 'spawn_result',
    requestId,
    success: true,
    project,
    tmuxSession: 'rc-test',
    ...(resolvedProfile ? { resolvedProfile } : {}),
  }
}

beforeEach(() => {
  store = createMemoryDriver()
  store.init()
  conversationStore = createConversationStore({ store, enablePersistence: false })
  deps = makeDeps()
  sentinelOutbox = []
})

describe('spawn dispatch -- sentinel-profile validation', () => {
  it('rejects an unknown literal profile name with the known list', async () => {
    attachSentinel('beast')
    const req: SpawnRequest = { cwd: '/tmp/test', sentinel: 'beast', profile: 'nope' }
    const result = await dispatchSpawn(req, deps)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.statusCode).toBe(400)
    expect(result.error).toContain('profile "nope"')
    expect(result.error).toContain('beast')
    expect(result.error).toContain('default')
    expect(result.error).toContain('work')
    expect(result.error).toContain('alt')
  })

  it('accepts a known literal profile name and forwards it on the wire', async () => {
    attachSentinel('beast')
    const req: SpawnRequest = { cwd: '/tmp/test', sentinel: 'beast', profile: 'work' }
    const result = await dispatchWithSpawnReply(req, id => okResult(id, 'claude://beast/tmp/test', 'work'))
    expect(result.ok).toBe(true)
    expect(sentinelOutbox).toHaveLength(1)
    expect(sentinelOutbox[0].profile).toBe('work')
  })

  it('forwards profile when the sentinel reports no profiles (legacy host)', async () => {
    attachSentinel('beast', undefined)
    const req: SpawnRequest = { cwd: '/tmp/test', sentinel: 'beast', profile: 'work' }
    const result = await dispatchWithSpawnReply(req, id => okResult(id, 'claude://beast/tmp/test'))
    expect(result.ok).toBe(true)
    expect(sentinelOutbox[0].profile).toBe('work')
  })

  it('omits the profile field on the wire when none was requested', async () => {
    attachSentinel('beast')
    const req: SpawnRequest = { cwd: '/tmp/test', sentinel: 'beast' }
    const result = await dispatchWithSpawnReply(req, id => okResult(id, 'claude://beast/tmp/test'))
    expect(result.ok).toBe(true)
    expect(sentinelOutbox[0].profile).toBeUndefined()
  })

  it('forwards pool on the wire and accepts a known pool', async () => {
    attachSentinel('beast', undefined, ['work', 'default'])
    const req: SpawnRequest = { cwd: '/tmp/test', sentinel: 'beast', pool: 'work' }
    const result = await dispatchWithSpawnReply(req, id => okResult(id, 'claude://beast/tmp/test', 'work-1'))
    expect(result.ok).toBe(true)
    expect(sentinelOutbox[0].pool).toBe('work')
    expect(sentinelOutbox[0].profile).toBeUndefined()
  })

  it('rejects an unknown pool when the sentinel reported its pool registry', async () => {
    attachSentinel('beast', undefined, ['default'])
    const req: SpawnRequest = { cwd: '/tmp/test', sentinel: 'beast', pool: 'ghost' }
    const result = await dispatchSpawn(req, deps)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.statusCode).toBe(400)
    expect(result.error).toContain('pool "ghost"')
  })

  it('forwards pool when the sentinel reports no pools (legacy host)', async () => {
    attachSentinel('beast', undefined, [])
    const req: SpawnRequest = { cwd: '/tmp/test', sentinel: 'beast', pool: 'work' }
    const result = await dispatchWithSpawnReply(req, id => okResult(id, 'claude://beast/tmp/test', 'w-1'))
    expect(result.ok).toBe(true)
    expect(sentinelOutbox[0].pool).toBe('work')
  })

  it('does not validate pool when profile is also set (profile wins)', async () => {
    attachSentinel('beast', undefined, ['default'])
    const req: SpawnRequest = { cwd: '/tmp/test', sentinel: 'beast', profile: 'work', pool: 'ghost' }
    const result = await dispatchWithSpawnReply(req, id => okResult(id, 'claude://beast/tmp/test', 'work'))
    expect(result.ok).toBe(true)
    // Wire still carries pool (broker forwards what was sent); sentinel ignores
    // it when profile is set. The INTENT however picks profile.
    expect(sentinelOutbox[0].profile).toBe('work')
  })
})

describe('spawn dispatch -- resolved profile + launchConfig intent', () => {
  it('stashes the resolved profile so boot can pin it on the conversation', async () => {
    attachSentinel('beast')
    const req: SpawnRequest = { cwd: '/tmp/test', sentinel: 'beast', pool: 'default' }
    const result = await dispatchWithSpawnReply(req, id => okResult(id, 'claude://beast/tmp/test', 'alt'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(conversationStore.consumePendingResolvedProfile(result.conversationId)).toBe('alt')
  })

  it('persists the INTENT tagged union on launchConfig (profile)', async () => {
    attachSentinel('beast')
    const req: SpawnRequest = { cwd: '/tmp/test', sentinel: 'beast', profile: 'work' }
    const result = await dispatchWithSpawnReply(req, id => okResult(id, 'claude://beast/tmp/test', 'work'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const lc = conversationStore.consumePendingLaunchConfig(result.conversationId)
    expect(lc?.sentinelProfile).toEqual({ kind: 'profile', name: 'work' })
  })

  it('persists the INTENT tagged union on launchConfig (pool)', async () => {
    attachSentinel('beast', undefined, ['work', 'default'])
    const req: SpawnRequest = { cwd: '/tmp/test', sentinel: 'beast', pool: 'work' }
    const result = await dispatchWithSpawnReply(req, id => okResult(id, 'claude://beast/tmp/test', 'work-1'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const lc = conversationStore.consumePendingLaunchConfig(result.conversationId)
    expect(lc?.sentinelProfile).toEqual({ kind: 'pool', name: 'work' })
  })

  it('profile wins when both are set (pool dropped from INTENT)', async () => {
    attachSentinel('beast', undefined, ['work', 'default'])
    const req: SpawnRequest = { cwd: '/tmp/test', sentinel: 'beast', profile: 'work', pool: 'default' }
    const result = await dispatchWithSpawnReply(req, id => okResult(id, 'claude://beast/tmp/test', 'work'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const lc = conversationStore.consumePendingLaunchConfig(result.conversationId)
    expect(lc?.sentinelProfile).toEqual({ kind: 'profile', name: 'work' })
  })

  it('omits launchConfig.sentinelProfile when no hint is given', async () => {
    attachSentinel('beast')
    const req: SpawnRequest = { cwd: '/tmp/test', sentinel: 'beast' }
    const result = await dispatchWithSpawnReply(req, id => okResult(id, 'claude://beast/tmp/test'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const lc = conversationStore.consumePendingLaunchConfig(result.conversationId)
    expect(lc?.sentinelProfile).toBeUndefined()
  })

  it('does not stash a pending resolved profile when none was echoed', async () => {
    attachSentinel('beast')
    const req: SpawnRequest = { cwd: '/tmp/test', sentinel: 'beast' }
    const result = await dispatchWithSpawnReply(req, id => okResult(id, 'claude://beast/tmp/test'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(conversationStore.consumePendingResolvedProfile(result.conversationId)).toBeUndefined()
  })
})
