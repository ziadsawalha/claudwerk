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
    mutatedThisTurn: false,
    toolCallsThisTurn: 0,
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

/** Run N PreToolUse hooks for the given tool. */
function tools(ctx: AgentHostContext, name: string, n: number): void {
  for (let i = 0; i < n; i++) processHookEvent(ctx, hook('PreToolUse', { tool_name: name }))
}

describe('Stop-hook set_status nudge', () => {
  it('nudges after a single file-mutating tool (Edit) with no status', () => {
    const ctx = makeCtx()
    processHookEvent(ctx, hook('UserPromptSubmit'))
    processHookEvent(ctx, hook('PreToolUse', { tool_name: 'Edit' }))
    const decision = processHookEvent(ctx, hook('Stop'))
    expect(decision?.decision).toBe('block')
    expect(decision?.reason).toContain('set_status')
  })

  it('nudges after a busy multi-tool turn even with no mutation (>= threshold)', () => {
    const ctx = makeCtx()
    processHookEvent(ctx, hook('UserPromptSubmit'))
    tools(ctx, 'Read', 4) // 4 read-only calls = substantial
    expect(processHookEvent(ctx, hook('Stop'))?.decision).toBe('block')
  })

  it('does NOT nudge a small read/lookup turn (a few read-only tools, no mutation)', () => {
    const ctx = makeCtx()
    processHookEvent(ctx, hook('UserPromptSubmit'))
    tools(ctx, 'Read', 3) // below threshold, nothing mutated
    expect(processHookEvent(ctx, hook('Stop'))).toBeUndefined()
  })

  it('does NOT nudge a single one-off command (Bash, below threshold)', () => {
    const ctx = makeCtx()
    processHookEvent(ctx, hook('UserPromptSubmit'))
    processHookEvent(ctx, hook('PreToolUse', { tool_name: 'Bash' }))
    expect(processHookEvent(ctx, hook('Stop'))).toBeUndefined()
  })

  it('does NOT nudge a pure-conversation turn (no tool use)', () => {
    const ctx = makeCtx()
    processHookEvent(ctx, hook('UserPromptSubmit'))
    expect(processHookEvent(ctx, hook('Stop'))).toBeUndefined()
  })

  it('the nudge blesses skipping for small/routine turns (subjective call)', () => {
    const ctx = makeCtx()
    processHookEvent(ctx, hook('UserPromptSubmit'))
    processHookEvent(ctx, hook('PreToolUse', { tool_name: 'Write' }))
    const reason = processHookEvent(ctx, hook('Stop'))?.reason ?? ''
    expect(reason).toContain('skip')
    expect(reason).toContain('end your turn')
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

  it('a new user turn resets the counters (stale work does not nudge)', () => {
    const ctx = makeCtx()
    processHookEvent(ctx, hook('UserPromptSubmit'))
    processHookEvent(ctx, hook('PreToolUse', { tool_name: 'Edit' }))
    processHookEvent(ctx, hook('Stop')) // nudged once
    // Next turn: user replies, agent does no work -> no nudge.
    processHookEvent(ctx, hook('UserPromptSubmit'))
    expect(processHookEvent(ctx, hook('Stop'))).toBeUndefined()
  })
})
