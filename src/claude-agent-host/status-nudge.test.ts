import { describe, expect, it } from 'bun:test'
import type { HookEvent, HookEventType } from '../shared/protocol'
import type { AgentHostContext } from './agent-host-context'
import { processHookEvent } from './hook-processor'

/** Minimal context for the Stop-hook set_status nudge: the per-turn flags plus a
 *  connected wsClient so forwardOrQueueHookEvent doesn't queue. */
function makeCtx(): AgentHostContext {
  return {
    conversationId: 'conv_parent',
    claudeSessionId: 'cc_sess',
    parentTranscriptPath: null,
    runningSubagents: new Set<string>(),
    eventQueue: [],
    subagentWatchers: new Map(),
    headless: true,
    statusSetThisTurn: false,
    didWorkThisTurn: false,
    diag: () => {},
    debug: () => {},
    readTasks: () => {},
    wsClient: { isConnected: () => true, sendHookEvent: () => {} },
  } as unknown as AgentHostContext
}

function hook(hookEvent: HookEventType, data: Record<string, unknown> = {}): HookEvent {
  return {
    type: 'hook',
    conversationId: 'conv_parent',
    hookEvent,
    timestamp: 1,
    data: { session_id: 'p', ...data },
  } as HookEvent
}

describe('Stop-hook set_status nudge', () => {
  it('nudges when work was done but no status was set', () => {
    const ctx = makeCtx()
    processHookEvent(ctx, hook('UserPromptSubmit'))
    processHookEvent(ctx, hook('PreToolUse', { tool_name: 'Bash' }))
    const decision = processHookEvent(ctx, hook('Stop'))
    expect(decision?.decision).toBe('block')
    expect(decision?.reason).toContain('set_status')
  })

  it('does NOT nudge a pure-conversation turn (no tool use)', () => {
    const ctx = makeCtx()
    processHookEvent(ctx, hook('UserPromptSubmit'))
    expect(processHookEvent(ctx, hook('Stop'))).toBeUndefined()
  })

  it('does NOT nudge when a status was set this turn', () => {
    const ctx = makeCtx()
    processHookEvent(ctx, hook('UserPromptSubmit'))
    processHookEvent(ctx, hook('PreToolUse', { tool_name: 'Edit' }))
    ctx.statusSetThisTurn = true // simulates set_status -> sinks.noteStatusSet()
    expect(processHookEvent(ctx, hook('Stop'))).toBeUndefined()
  })

  it('does NOT re-nudge within the same stop chain (stop_hook_active guard)', () => {
    const ctx = makeCtx()
    processHookEvent(ctx, hook('UserPromptSubmit'))
    processHookEvent(ctx, hook('PreToolUse', { tool_name: 'Write' }))
    expect(processHookEvent(ctx, hook('Stop', { stop_hook_active: true }))).toBeUndefined()
  })

  it('a new user turn clears the work flag (stale work does not nudge)', () => {
    const ctx = makeCtx()
    processHookEvent(ctx, hook('UserPromptSubmit'))
    processHookEvent(ctx, hook('PreToolUse', { tool_name: 'Bash' }))
    processHookEvent(ctx, hook('Stop')) // nudged once
    // Next turn: user replies, agent does no work -> no nudge.
    processHookEvent(ctx, hook('UserPromptSubmit'))
    expect(processHookEvent(ctx, hook('Stop'))).toBeUndefined()
  })
})
