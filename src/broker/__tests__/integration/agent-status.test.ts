/**
 * THE STATUS — agent self-reported status broker integration tests.
 *
 * Covers: agent_status persists to the single liveStatus slot + broadcasts;
 * monotonic seq stale-drop guard; reset-to-working on UserPromptSubmit; and the
 * derived needs_you gate (badge always, but the push path only when a real
 * pendingAttention corroborates — exercised here for no-throw + slot integrity).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { HookEvent, LiveStatus } from '../../../shared/protocol'
import { bootActiveAgent } from './dialog-test-helpers'
import { createTestHarness, type MockWs, type TestHarness, testId } from './test-harness'

let h: TestHarness

beforeEach(() => {
  h = createTestHarness()
})
afterEach(() => {
  h.cleanup()
})

const PROJECT = 'claude:///home/user/proj'

function sendStatus(agent: MockWs, convId: string, status: LiveStatus) {
  h.agentSend(agent, { type: 'agent_status', conversationId: convId, status })
}
function status(over: Partial<LiveStatus> = {}): LiveStatus {
  return { state: 'working', seq: 1, updatedAt: 1, ...over }
}
function userPrompt(convId: string): HookEvent {
  return { type: 'hook', conversationId: convId, hookEvent: 'UserPromptSubmit', timestamp: 2, data: {} } as HookEvent
}

describe('the status — persist + broadcast', () => {
  it('stores agent_status in the single liveStatus slot and broadcasts it', () => {
    const convId = testId('conv')
    const agent = bootActiveAgent(h, convId, PROJECT)
    const dash = h.connectDashboard()

    sendStatus(agent, convId, status({ state: 'done', done: 'shipped the thing', seq: 1 }))

    const conv = h.conversationStore.getConversation(convId)!
    expect(conv.liveStatus?.state).toBe('done')
    expect(conv.liveStatus?.done).toBe('shipped the thing')
    expect(dash.messagesOfType('agent_status').length).toBe(1)
  })

  it('drops a stale (<= stored seq) status', () => {
    const convId = testId('conv')
    const agent = bootActiveAgent(h, convId, PROJECT)

    sendStatus(agent, convId, status({ state: 'blocked', blocked: 'real', seq: 5 }))
    sendStatus(agent, convId, status({ state: 'working', seq: 3 })) // older -> dropped
    sendStatus(agent, convId, status({ state: 'working', seq: 5 })) // equal -> dropped

    expect(h.conversationStore.getConversation(convId)!.liveStatus?.state).toBe('blocked')
  })

  it('a newer seq replaces the slot', () => {
    const convId = testId('conv')
    const agent = bootActiveAgent(h, convId, PROJECT)
    sendStatus(agent, convId, status({ state: 'working', seq: 1 }))
    sendStatus(agent, convId, status({ state: 'done', done: 'ok', seq: 2 }))
    expect(h.conversationStore.getConversation(convId)!.liveStatus?.state).toBe('done')
  })

  it('carries the safe_to_close flag through to the slot', () => {
    const convId = testId('conv')
    const agent = bootActiveAgent(h, convId, PROJECT)
    sendStatus(agent, convId, status({ state: 'done', done: 'shipped', safe_to_close: true, seq: 1 }))
    expect(h.conversationStore.getConversation(convId)!.liveStatus?.safe_to_close).toBe(true)
  })
})

describe('the status — reset on user input', () => {
  it('resets a stale done/blocked status to bare working on the next user prompt', () => {
    const convId = testId('conv')
    const agent = bootActiveAgent(h, convId, PROJECT)
    sendStatus(agent, convId, status({ state: 'done', done: 'old work', seq: 1 }))

    h.conversationStore.addEvent(convId, userPrompt(convId))

    const ls = h.conversationStore.getConversation(convId)!.liveStatus
    expect(ls?.state).toBe('working')
    expect(ls?.done).toBeUndefined()
    // seq reset to 0 so the host's next monotonic status always wins.
    expect(ls?.seq).toBe(0)
  })

  it('clears a stale safe_to_close on the next user prompt', () => {
    const convId = testId('conv')
    const agent = bootActiveAgent(h, convId, PROJECT)
    sendStatus(agent, convId, status({ state: 'done', safe_to_close: true, seq: 1 }))
    h.conversationStore.addEvent(convId, userPrompt(convId))
    expect(h.conversationStore.getConversation(convId)!.liveStatus?.safe_to_close).toBeUndefined()
  })

  it('stamps lastInputAt (impulse clock) on a user prompt', () => {
    const convId = testId('conv')
    bootActiveAgent(h, convId, PROJECT)
    h.conversationStore.addEvent(convId, userPrompt(convId))
    expect(h.conversationStore.getConversation(convId)!.lastInputAt).toBe(2)
  })
})

describe('the status — derived needs_you gate', () => {
  it('accepts needs_you and keeps the slot whether or not a pendingAttention corroborates', () => {
    const convId = testId('conv')
    const agent = bootActiveAgent(h, convId, PROJECT)

    // No pendingAttention -> badge state set, push path skipped, no throw.
    sendStatus(agent, convId, status({ state: 'needs_you', pending: 'pick A or B', seq: 1 }))
    const conv = h.conversationStore.getConversation(convId)!
    expect(conv.liveStatus?.state).toBe('needs_you')

    // With a corroborating pendingAttention -> push path runs (no-op without VAPID), slot intact.
    conv.pendingAttention = { type: 'permission', toolName: 'Bash', timestamp: 1 }
    sendStatus(agent, convId, status({ state: 'needs_you', pending: 'approve?', seq: 2 }))
    expect(h.conversationStore.getConversation(convId)!.liveStatus?.state).toBe('needs_you')
  })
})
