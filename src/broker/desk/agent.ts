/**
 * The dispatcher AGENT LOOP (plan-dispatcher-build.md §9.4c + §11).
 *
 * The dispatcher is NOT a chat classifier -- it is a broker CONTROLLER. This is
 * the bounded tool-using loop: given an intent + a tiny context, it calls the
 * model with the control `Toolset`, EXECUTES the tools the model picks (list /
 * inject / interrupt / terminate / spawn / revive / configure / link / events),
 * feeds results back, and repeats until the model answers in plain text or the
 * round budget is spent. Every tool call + result is streamed out (onToolCall /
 * onToolResult) so the overlay can render the gears dimmed.
 *
 * Runtime-agnostic: the LLM is a `ChatFn` (OpenRouter today), the tools are the
 * local agent-core-shaped `Toolset`. Swapping to `@protokol/agent-core`'s
 * buildHarness later is mechanical -- this loop is its minimal stand-in.
 */

import { z } from 'zod'
import type { ChatMessage, ChatResponse, ChatTool } from '../recap/shared/openrouter-client'
import type { ChatFn } from './classify'
import type { ToolContext, Toolset } from './tool-def'

/** Default model that drives the loop -- Haiku (tiny-context thin router by
 *  design, §9). User-switchable per request (DispatchRequest.model). */
export const DISPATCHER_MODEL = 'anthropic/claude-haiku-4.5'

const MAX_ROUNDS = 6
const MAX_TOKENS = 1024

export interface AgentToolCallEvent {
  callId: string
  name: string
  summary: string
  args: Record<string, unknown>
}
export interface AgentToolResultEvent {
  callId: string
  ok: boolean
  summary: string
  result?: unknown
  error?: string
}

export interface RunAgentInput {
  intent: string
  /** The dispatcher's role + authority prompt. */
  system: string
  /** Tiny context the loop reads each turn (memory + roster snapshot). */
  context?: string
  model: string
  toolset: Toolset
  signal?: AbortSignal
  identity?: ToolContext['identity']
  onToolCall?: (e: AgentToolCallEvent) => void
  onToolResult?: (e: AgentToolResultEvent) => void
  maxRounds?: number
}

export interface RunAgentResult {
  reply: string
  toolCallCount: number
  /** Conversation ids the loop touched (best-effort, from tool results). */
  touchedConversationIds: string[]
  model: string
}

/** Derive the OpenRouter function-tool array from the agent-core-shaped toolset. */
export function toChatTools(toolset: Toolset): ChatTool[] {
  return Object.entries(toolset).map(([name, def]) => {
    const json = z.toJSONSchema(def.inputSchema, { target: 'draft-2020-12' }) as {
      properties?: Record<string, unknown>
    }
    const properties = json.properties ?? {}
    return {
      name,
      description: def.description,
      parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
    }
  })
}

/** One-line human summary of a tool call for the dimmed UI line. */
function summarizeCall(name: string, args: Record<string, unknown>): string {
  const head = Object.entries(args)
    .filter(([, v]) => v != null && v !== '')
    .slice(0, 2)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ')
  return head ? `${name} ${head}` : name
}

function collectConversationId(result: unknown, into: Set<string>): void {
  if (result && typeof result === 'object' && 'conversationId' in result) {
    const id = (result as { conversationId?: unknown }).conversationId
    if (typeof id === 'string') into.add(id)
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return {} // validation below surfaces the shape error
  }
}

/** A tool message + the result-event to emit -- the shared shape for every
 *  runOneCall exit (error or success), so the caller does one emit + push. */
interface CallOutcome {
  message: ChatMessage
  ok: boolean
  summary: string
  result?: unknown
  error?: string
}

function failOutcome(callId: string, error: string): CallOutcome {
  return { message: { role: 'tool', content: error, toolCallId: callId }, ok: false, summary: error, error }
}

/** Run one tool call: validate args against its zod schema, execute, summarize. */
async function runOneCall(
  toolset: Toolset,
  call: { id: string; name: string; arguments: string },
  ctx: ToolContext,
  touched: Set<string>,
  input: RunAgentInput,
): Promise<ChatMessage> {
  const args = parseArgs(call.arguments)
  input.onToolCall?.({ callId: call.id, name: call.name, summary: summarizeCall(call.name, args), args })
  const outcome = await executeCall(toolset, call, args, ctx, touched)
  input.onToolResult?.({
    callId: call.id,
    ok: outcome.ok,
    summary: outcome.summary,
    result: outcome.result,
    error: outcome.error,
  })
  return outcome.message
}

async function executeCall(
  toolset: Toolset,
  call: { id: string; name: string },
  args: Record<string, unknown>,
  ctx: ToolContext,
  touched: Set<string>,
): Promise<CallOutcome> {
  const def = toolset[call.name]
  if (!def) return failOutcome(call.id, `unknown tool '${call.name}'`)
  const parsed = def.inputSchema.safeParse(args)
  if (!parsed.success) {
    return failOutcome(call.id, `bad args for ${call.name}: ${parsed.error.issues.map(i => i.message).join('; ')}`)
  }
  try {
    const result = await def.execute(parsed.data, ctx)
    collectConversationId(result, touched)
    const content = typeof result === 'string' ? result : JSON.stringify(result ?? { ok: true })
    return { message: { role: 'tool', content, toolCallId: call.id }, ok: true, summary: `${call.name} ok`, result }
  } catch (e) {
    // A tool failure is fed BACK to the model (recoverable), not thrown -- the
    // dispatcher can apologize / try another path. Cancellation is the exception.
    if (ctx.signal?.aborted) throw e
    const error = (e as Error).message
    return {
      message: { role: 'tool', content: `error: ${error}`, toolCallId: call.id },
      ok: false,
      summary: `${call.name} failed: ${error}`,
      error,
    }
  }
}

export async function runAgent(input: RunAgentInput, chat: ChatFn): Promise<RunAgentResult> {
  const tools = toChatTools(input.toolset)
  const system = input.context ? `${input.system}\n\n${input.context}` : input.system
  const ctx: ToolContext = { signal: input.signal, identity: input.identity }
  const messages: ChatMessage[] = [{ role: 'user', content: input.intent }]
  const touched = new Set<string>()
  const maxRounds = input.maxRounds ?? MAX_ROUNDS
  let toolCallCount = 0

  for (let round = 0; round < maxRounds; round++) {
    const last = round === maxRounds - 1
    const res: ChatResponse = await chat({
      model: input.model,
      system,
      messages,
      tools,
      // Final round: force a text answer (no more tools) so we never end mid-loop.
      toolChoice: last ? 'none' : 'auto',
      maxTokens: MAX_TOKENS,
      temperature: 0.2,
      timeoutMs: 30_000,
      timeoutRetries: 1,
    })
    const calls = res.toolCalls ?? []
    if (calls.length === 0 || last) {
      return { reply: res.content, toolCallCount, touchedConversationIds: [...touched], model: input.model }
    }
    messages.push({ role: 'assistant', content: res.content, toolCalls: calls })
    for (const call of calls) {
      toolCallCount++
      messages.push(await runOneCall(input.toolset, call, ctx, touched, input))
    }
  }
  return { reply: '', toolCallCount, touchedConversationIds: [...touched], model: input.model }
}
