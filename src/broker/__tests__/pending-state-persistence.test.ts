/**
 * Pending-attention state persistence round-trip tests.
 *
 * Verifies that pendingDialog / pendingPlanApproval / pendingPermission /
 * pendingAskQuestion / pendingAttention / planMode / hasNotification survive
 * a broker restart (simulated by tearing down and recreating the
 * conversation store while reusing the same SQLite store driver).
 *
 * Origin: pre-fix, all five pending* fields were memory-only. After broker
 * restart the dashboard never saw the in-flight dialog/permission/etc,
 * agent host stayed blocked, conversation stalled.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Conversation } from '../../shared/protocol'
import { createConversationStore } from '../conversation-store'
import { createSqliteDriver } from '../store/sqlite/driver'
import type { StoreDriver } from '../store/types'

describe('pending-state persistence', () => {
  let dataDir: string
  let store: StoreDriver

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'pending-persist-'))
    store = createSqliteDriver({ type: 'sqlite', dataDir })
  })

  afterEach(() => {
    store.close()
  })

  it('pendingDialog survives broker restart', () => {
    const cs1 = createConversationStore({ store })
    const conv = cs1.createConversation('conv-1', 'claude://default/home/user/proj')
    conv.pendingDialog = {
      dialogId: 'dlg-abc',
      layout: { title: 'Are you sure?', elements: [] } as unknown as Conversation['pendingDialog'] extends infer T
        ? T extends { layout: infer L }
          ? L
          : never
        : never,
      timestamp: 1700000000000,
    }
    conv.pendingAttention = { type: 'dialog', question: 'Are you sure?', timestamp: 1700000000000 }
    cs1.persistConversationById('conv-1')

    // Simulate broker restart: build a fresh conversation store on the same driver.
    const cs2 = createConversationStore({ store })
    const rehydrated = cs2.getConversation('conv-1')
    expect(rehydrated).toBeDefined()
    expect(rehydrated?.pendingDialog?.dialogId).toBe('dlg-abc')
    expect(rehydrated?.pendingDialog?.timestamp).toBe(1700000000000)
    expect(rehydrated?.pendingAttention?.type).toBe('dialog')
  })

  it('pendingDialog.expired survives broker restart (timed-out dialog stays re-displayable)', () => {
    const cs1 = createConversationStore({ store })
    const conv = cs1.createConversation('conv-expired', 'claude://default/home/user/proj')
    conv.pendingDialog = {
      dialogId: 'dlg-late',
      layout: { title: 'Pick a color', body: [] } as unknown as NonNullable<Conversation['pendingDialog']>['layout'],
      timestamp: 1700000000000,
      expired: true,
    }
    cs1.persistConversationById('conv-expired')

    const cs2 = createConversationStore({ store })
    const rehydrated = cs2.getConversation('conv-expired')
    expect(rehydrated?.pendingDialog?.dialogId).toBe('dlg-late')
    expect(rehydrated?.pendingDialog?.expired).toBe(true)
  })

  it('pendingPlanApproval + planMode survive broker restart', () => {
    const cs1 = createConversationStore({ store })
    cs1.createConversation('conv-2', 'claude://default/home/user/proj')
    const conv = cs1.getConversation('conv-2')!
    conv.planMode = true
    conv.pendingPlanApproval = {
      requestId: 'req-1',
      toolUseId: 'tool-1',
      plan: '1. Do X\n2. Do Y',
      timestamp: 1700000000000,
    }
    conv.pendingAttention = { type: 'plan_approval', question: 'Plan approval required', timestamp: 1700000000000 }
    cs1.persistConversationById('conv-2')

    const cs2 = createConversationStore({ store })
    const rehydrated = cs2.getConversation('conv-2')
    expect(rehydrated?.planMode).toBe(true)
    expect(rehydrated?.pendingPlanApproval?.requestId).toBe('req-1')
    expect(rehydrated?.pendingPlanApproval?.plan).toBe('1. Do X\n2. Do Y')
    expect(rehydrated?.pendingAttention?.type).toBe('plan_approval')
  })

  it('pendingPermission survives broker restart', () => {
    const cs1 = createConversationStore({ store })
    cs1.createConversation('conv-3', 'claude://default/home/user/proj')
    const conv = cs1.getConversation('conv-3')!
    conv.pendingPermission = {
      requestId: 'perm-1',
      toolName: 'Bash',
      description: 'rm -rf /',
      inputPreview: 'rm -rf /',
      toolUseId: 'tu-1',
      timestamp: 1700000000000,
    }
    conv.pendingAttention = { type: 'permission', toolName: 'Bash', timestamp: 1700000000000 }
    cs1.persistConversationById('conv-3')

    const cs2 = createConversationStore({ store })
    const rehydrated = cs2.getConversation('conv-3')
    expect(rehydrated?.pendingPermission?.requestId).toBe('perm-1')
    expect(rehydrated?.pendingPermission?.toolName).toBe('Bash')
    expect(rehydrated?.pendingAttention?.toolName).toBe('Bash')
  })

  it('pendingAskQuestion survives broker restart', () => {
    const cs1 = createConversationStore({ store })
    cs1.createConversation('conv-4', 'claude://default/home/user/proj')
    const conv = cs1.getConversation('conv-4')!
    conv.pendingAskQuestion = {
      toolUseId: 'ask-1',
      questions: [{ question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] }],
      timestamp: 1700000000000,
    }
    conv.pendingAttention = { type: 'ask', toolName: 'AskUserQuestion', timestamp: 1700000000000 }
    cs1.persistConversationById('conv-4')

    const cs2 = createConversationStore({ store })
    const rehydrated = cs2.getConversation('conv-4')
    expect(rehydrated?.pendingAskQuestion?.toolUseId).toBe('ask-1')
    expect((rehydrated?.pendingAskQuestion?.questions as unknown[])?.length).toBe(1)
    expect(rehydrated?.pendingAttention?.type).toBe('ask')
  })

  it('hasNotification survives broker restart', () => {
    const cs1 = createConversationStore({ store })
    cs1.createConversation('conv-5', 'claude://default/home/user/proj')
    const conv = cs1.getConversation('conv-5')!
    conv.hasNotification = true
    cs1.persistConversationById('conv-5')

    const cs2 = createConversationStore({ store })
    expect(cs2.getConversation('conv-5')?.hasNotification).toBe(true)
  })

  it('pendingSpawnApproval (full request incl. prompt) + spawnAutoApproved survive broker restart', () => {
    const cs1 = createConversationStore({ store })
    cs1.createConversation('conv-spawn', 'claude://default/home/user/proj')
    const conv = cs1.getConversation('conv-spawn')!
    conv.pendingSpawnApproval = {
      requestId: 'spawn-req-1',
      requestedAt: 1700000000000,
      // The whole SpawnRequest is stashed verbatim and replayed on ALLOW. The
      // prompt is the field most likely to be assumed "dropped" -- assert it
      // round-trips intact along with the rest of the request.
      request: {
        cwd: 'claude://default/home/user/proj',
        prompt: 'Session A: create floors + areas, assign devices.',
        name: 'ha-session-a',
        description: 'HA org session A',
        headless: true,
      },
      reason: 'mcp caller is not benevolent',
    }
    conv.pendingAttention = { type: 'spawn_approval', timestamp: 1700000000000 }
    cs1.persistConversationById('conv-spawn')

    const cs2 = createConversationStore({ store })
    const rehydrated = cs2.getConversation('conv-spawn')
    expect(rehydrated?.pendingSpawnApproval?.requestId).toBe('spawn-req-1')
    expect(rehydrated?.pendingSpawnApproval?.reason).toBe('mcp caller is not benevolent')
    expect(rehydrated?.pendingSpawnApproval?.request.prompt).toBe('Session A: create floors + areas, assign devices.')
    expect(rehydrated?.pendingSpawnApproval?.request.cwd).toBe('claude://default/home/user/proj')
    expect(rehydrated?.pendingSpawnApproval?.request.name).toBe('ha-session-a')
    expect(rehydrated?.pendingAttention?.type).toBe('spawn_approval')
  })

  it('spawnAutoApproved sticky bit survives broker restart', () => {
    const cs1 = createConversationStore({ store })
    cs1.createConversation('conv-sticky', 'claude://default/home/user/proj')
    const conv = cs1.getConversation('conv-sticky')!
    conv.spawnAutoApproved = true
    cs1.persistConversationById('conv-sticky')

    const cs2 = createConversationStore({ store })
    expect(cs2.getConversation('conv-sticky')?.spawnAutoApproved).toBe(true)
  })

  it('clearConversation wipes pending* state AND persists the cleared state', () => {
    const cs1 = createConversationStore({ store })
    cs1.createConversation('conv-6', 'claude://default/home/user/proj')
    const conv = cs1.getConversation('conv-6')!
    conv.pendingDialog = {
      dialogId: 'd1',
      layout: { title: 't', elements: [] } as unknown as NonNullable<Conversation['pendingDialog']>['layout'],
      timestamp: 1,
    }
    conv.pendingPermission = {
      requestId: 'p1',
      toolName: 'Read',
      description: 'r',
      inputPreview: '',
      timestamp: 1,
    }
    conv.planMode = true
    conv.hasNotification = true
    cs1.persistConversationById('conv-6')

    // /clear comes in
    cs1.clearConversation('conv-6', 'claude://default/home/user/proj')

    const cleared = cs1.getConversation('conv-6')
    expect(cleared?.pendingDialog).toBeUndefined()
    expect(cleared?.pendingPermission).toBeUndefined()
    expect(cleared?.planMode).toBeUndefined()
    expect(cleared?.hasNotification).toBeUndefined()

    // Survives a broker restart -- cleared state must be persisted, not just in memory.
    const cs2 = createConversationStore({ store })
    const rehydrated = cs2.getConversation('conv-6')
    expect(rehydrated).toBeDefined()
    expect(rehydrated?.pendingDialog).toBeUndefined()
    expect(rehydrated?.pendingPermission).toBeUndefined()
    expect(rehydrated?.planMode).toBeUndefined()
    expect(rehydrated?.hasNotification).toBeUndefined()
  })

  it('clearConversation deletes SQLite tasks rows (no zombie tasks after /clear + restart)', () => {
    const cs1 = createConversationStore({ store })
    cs1.createConversation('conv-7', 'claude://default/home/user/proj')
    const now = Date.now()
    cs1.updateTasks('conv-7', [
      { id: 't1', subject: 'Task 1', status: 'pending', kind: 'todo', updatedAt: now },
      { id: 't2', subject: 'Task 2', status: 'in_progress', kind: 'todo', updatedAt: now },
    ])

    // SQLite should have 2 rows before /clear
    expect(store.tasks.getForConversation('conv-7', { kind: 'todo', archived: false }).length).toBe(2)

    cs1.clearConversation('conv-7', 'claude://default/home/user/proj')

    // SQLite rows are gone after /clear
    expect(store.tasks.getForConversation('conv-7', { kind: 'todo', archived: false }).length).toBe(0)

    // Broker restart -- tasks must stay gone
    const cs2 = createConversationStore({ store })
    expect(cs2.getConversation('conv-7')?.tasks).toEqual([])
  })
})
