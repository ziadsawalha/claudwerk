/**
 * Dialog late-answer integration tests.
 *
 * A timed-out dialog must NOT be destroyed. Instead the broker keeps the layout
 * re-displayable (pendingDialog.expired) so the user can answer it late, and a
 * result submitted against an expired dialog is forwarded to the agent host
 * tagged `_late` (+ title) so the agent can deliver a labeled late answer.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createTestHarness, type TestHarness, testId } from './test-harness'

let h: TestHarness

beforeEach(() => {
  h = createTestHarness()
})

afterEach(() => {
  h.cleanup()
})

const PROJECT = 'claude:///home/user/proj'

function bootActive(convId: string) {
  const agent = h.bootAgentHost({ conversationId: convId, project: PROJECT })
  h.agentSend(agent, {
    type: 'meta',
    conversationId: convId,
    ccSessionId: testId('cc'),
    project: PROJECT,
    cwd: '/home/user/proj',
    startedAt: Date.now(),
  })
  return agent
}

function showDialog(agent: ReturnType<typeof bootActive>, convId: string, dialogId: string, title: string) {
  h.agentSend(agent, {
    type: 'dialog_show',
    conversationId: convId,
    dialogId,
    layout: { title, body: [] },
  })
}

describe('dialog late-answer', () => {
  it('dialog_dismiss reason=timeout marks the dialog expired (kept, not deleted) and clears attention', async () => {
    const convId = testId('conv')
    const agent = bootActive(convId)
    showDialog(agent, convId, 'dlg-1', 'Pick a color')

    const conv = h.conversationStore.getConversation(convId)!
    expect(conv.pendingDialog?.dialogId).toBe('dlg-1')
    expect(conv.pendingAttention?.type).toBe('dialog')

    h.agentSend(agent, { type: 'dialog_dismiss', conversationId: convId, dialogId: 'dlg-1', reason: 'timeout' })

    // Layout retained + flagged expired; the attention nag is gone.
    expect(conv.pendingDialog?.dialogId).toBe('dlg-1')
    expect(conv.pendingDialog?.expired).toBe(true)
    expect(conv.pendingAttention).toBeUndefined()
  })

  it('dialog_dismiss reason=timeout broadcasts a timeout dismiss to the dashboard', async () => {
    const convId = testId('conv')
    const agent = bootActive(convId)
    const dashboard = h.connectDashboard()
    showDialog(agent, convId, 'dlg-2', 'Confirm')
    dashboard.clearMessages()

    h.agentSend(agent, { type: 'dialog_dismiss', conversationId: convId, dialogId: 'dlg-2', reason: 'timeout' })

    const dismiss = dashboard.messagesOfType('dialog_dismiss').at(-1)
    expect(dismiss).toBeDefined()
    expect(dismiss?.reason).toBe('timeout')
    expect(dismiss?.dialogId).toBe('dlg-2')
  })

  it('a result submitted against an expired dialog is forwarded to the agent host tagged _late + title', async () => {
    const convId = testId('conv')
    const agent = bootActive(convId)
    showDialog(agent, convId, 'dlg-3', 'Pick a color')
    h.agentSend(agent, { type: 'dialog_dismiss', conversationId: convId, dialogId: 'dlg-3', reason: 'timeout' })
    agent.clearMessages()

    const dashboard = h.connectDashboard()
    h.dashboardSend(dashboard, {
      type: 'dialog_result',
      conversationId: convId,
      dialogId: 'dlg-3',
      result: { _action: 'submit', _timeout: false, _cancelled: false, color: 'blue' },
    })

    const forwarded = agent.messagesOfType('dialog_result').at(-1)
    expect(forwarded).toBeDefined()
    const result = forwarded?.result as Record<string, unknown>
    expect(result._late).toBe(true)
    expect(result._dialogTitle).toBe('Pick a color')
    expect(result.color).toBe('blue')

    // Dialog is truly gone after the late answer is consumed.
    expect(h.conversationStore.getConversation(convId)?.pendingDialog).toBeUndefined()
  })

  it('a result on a LIVE (non-expired) dialog is forwarded WITHOUT _late (regression guard)', async () => {
    const convId = testId('conv')
    const agent = bootActive(convId)
    showDialog(agent, convId, 'dlg-4', 'Live one')
    agent.clearMessages()

    const dashboard = h.connectDashboard()
    h.dashboardSend(dashboard, {
      type: 'dialog_result',
      conversationId: convId,
      dialogId: 'dlg-4',
      result: { _action: 'submit', _timeout: false, _cancelled: false, ok: true },
    })

    const forwarded = agent.messagesOfType('dialog_result').at(-1)
    const result = forwarded?.result as Record<string, unknown>
    expect(result._late).toBeUndefined()
    expect(result._dialogTitle).toBeUndefined()
  })

  it('dialog_dismiss WITHOUT reason hard-deletes the pending dialog (regression guard)', async () => {
    const convId = testId('conv')
    const agent = bootActive(convId)
    showDialog(agent, convId, 'dlg-5', 'Gone')

    h.agentSend(agent, { type: 'dialog_dismiss', conversationId: convId, dialogId: 'dlg-5' })

    expect(h.conversationStore.getConversation(convId)?.pendingDialog).toBeUndefined()
  })
})
