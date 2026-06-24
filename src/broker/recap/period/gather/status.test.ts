import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LiveStatus } from '../../../../shared/protocol'
import { createSqliteDriver } from '../../../store/sqlite/driver'
import type { StoreDriver } from '../../../store/types'
import { gatherConversations } from './conversations'
import type { PeriodScope } from './types'

const projectUri = 'claude://default/Users/test/proj'
const periodStart = 1_700_000_000_000
const periodEnd = 1_700_604_800_000
const scope: PeriodScope = { projectUris: [projectUri], periodStart, periodEnd, timeZone: 'Europe/Stockholm' }

function liveStatus(over: Partial<LiveStatus> = {}): LiveStatus {
  return { state: 'done', seq: 1, updatedAt: periodStart + 4_000, ...over }
}

function seedConv(
  store: StoreDriver,
  id: string,
  meta?: Record<string, unknown>,
  extra?: { rootConversationId?: string },
) {
  store.conversations.create({
    id,
    scope: projectUri,
    agentType: 'claude',
    title: id,
    createdAt: periodStart + 1_000,
    rootConversationId: extra?.rootConversationId,
    meta,
  })
  store.conversations.update(id, { lastActivity: periodStart + 5_000 })
}

describe('liveStatusByScope + gatherConversations status enrichment', () => {
  let cacheDir: string
  let store: StoreDriver

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'status-gather-'))
    store = createSqliteDriver({ type: 'sqlite', dataDir: cacheDir })
    store.init()
  })
  afterEach(() => {
    store.close?.()
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it('liveStatusByScope reads liveStatus + lastInputAt from meta, skipping rows without a status', () => {
    seedConv(store, 'with_status', {
      liveStatus: liveStatus({ done: 'shipped -> main abc1234' }),
      lastInputAt: periodStart + 3_000,
    })
    seedConv(store, 'no_status', { someOther: 'field' })

    const rows = store.conversations.liveStatusByScope(projectUri)
    expect(rows.length).toBe(1)
    expect(rows[0].id).toBe('with_status')
    expect(rows[0].liveStatus?.state).toBe('done')
    expect(rows[0].liveStatus?.done).toBe('shipped -> main abc1234')
    expect(rows[0].lastInputAt).toBe(periodStart + 3_000)
  })

  it('gatherConversations(includeStatus=false) leaves liveStatus undefined but still carries provenance', () => {
    seedConv(store, 'c1', { liveStatus: liveStatus() }, { rootConversationId: 'root123' })
    const out = gatherConversations(store, scope, false)
    expect(out[0].liveStatus).toBeUndefined()
    expect(out[0].rootConversationId).toBe('root123')
  })

  it('gatherConversations(includeStatus=true) attaches the status', () => {
    seedConv(store, 'c1', { liveStatus: liveStatus({ done: 'done it' }) })
    const out = gatherConversations(store, scope, true)
    expect(out[0].liveStatus?.done).toBe('done it')
    expect(out[0].liveStatusSuperseded).toBe(false)
  })

  it('marks a status superseded when a user impulse landed AFTER it was set', () => {
    seedConv(store, 'c1', {
      liveStatus: liveStatus({ updatedAt: periodStart + 2_000 }),
      lastInputAt: periodStart + 9_000, // impulse after the status
    })
    const out = gatherConversations(store, scope, true)
    expect(out[0].liveStatusSuperseded).toBe(true)
  })
})
