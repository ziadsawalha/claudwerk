import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import type { ChatRequest, ChatResponse } from '../recap/shared/openrouter-client'
import { runAgent, toChatTools } from './agent'
import { defineTool, type Toolset } from './tool-def'

const toolset: Toolset = {
  ping: defineTool({
    description: 'echo a message',
    inputSchema: z.object({ msg: z.string() }),
    execute: args => ({ ok: true, echoed: (args as { msg: string }).msg, conversationId: 'conv_x' }),
  }),
}

/** A scripted ChatFn: returns each queued response in order. */
function scriptChat(responses: Partial<ChatResponse>[]): {
  fn: (r: ChatRequest) => Promise<ChatResponse>
  seen: ChatRequest[]
} {
  const seen: ChatRequest[] = []
  let i = 0
  const fn = async (r: ChatRequest): Promise<ChatResponse> => {
    seen.push(r)
    const base: ChatResponse = { content: '', raw: {}, usage: {} as never, model: r.model }
    return { ...base, ...responses[Math.min(i++, responses.length - 1)] }
  }
  return { fn, seen }
}

describe('runAgent', () => {
  it('executes a tool call then returns the final text answer', async () => {
    const { fn, seen } = scriptChat([
      { toolCalls: [{ id: 'c1', name: 'ping', arguments: '{"msg":"hi"}' }] },
      { content: 'I pinged it.' },
    ])
    const calls: string[] = []
    const results: boolean[] = []
    const res = await runAgent(
      {
        intent: 'ping the thing',
        system: 'you are the desk',
        model: 'anthropic/claude-haiku-4.5',
        toolset,
        onToolCall: e => calls.push(e.summary),
        onToolResult: e => results.push(e.ok),
      },
      fn,
    )
    expect(res.reply).toBe('I pinged it.')
    expect(res.toolCallCount).toBe(1)
    expect(res.touchedConversationIds).toEqual(['conv_x'])
    expect(calls).toEqual(['ping msg=hi'])
    expect(results).toEqual([true])
    // 2nd call carried the assistant tool_calls + the tool result back.
    expect(seen[1].messages?.some(m => m.role === 'tool')).toBe(true)
  })

  it('feeds bad-args + unknown-tool errors back without throwing', async () => {
    const { fn } = scriptChat([
      {
        toolCalls: [
          { id: 'c1', name: 'ping', arguments: '{}' },
          { id: 'c2', name: 'nope', arguments: '{}' },
        ],
      },
      { content: 'recovered' },
    ])
    const results: { ok: boolean; error?: string }[] = []
    const res = await runAgent(
      { intent: 'x', system: 's', model: 'm', toolset, onToolResult: e => results.push({ ok: e.ok, error: e.error }) },
      fn,
    )
    expect(res.reply).toBe('recovered')
    expect(results.map(r => r.ok)).toEqual([false, false])
    expect(results[0].error).toContain('bad args')
    expect(results[1].error).toContain('unknown tool')
  })

  it('forces a text answer on the final round (toolChoice none)', async () => {
    // Always tries to call a tool -> the loop must cap and force a final answer.
    const { fn, seen } = scriptChat([{ toolCalls: [{ id: 'c', name: 'ping', arguments: '{"msg":"x"}' }] }])
    const res = await runAgent({ intent: 'x', system: 's', model: 'm', toolset, maxRounds: 2 }, fn)
    expect(seen.at(-1)?.toolChoice).toBe('none')
    expect(res.toolCallCount).toBe(1) // one round executed, final round forced text
  })

  it('derives function-tool schemas from the toolset', () => {
    const tools = toChatTools(toolset)
    expect(tools[0].name).toBe('ping')
    expect(tools[0].parameters.required).toEqual(['msg'])
    expect((tools[0].parameters as { additionalProperties: boolean }).additionalProperties).toBe(false)
  })
})
