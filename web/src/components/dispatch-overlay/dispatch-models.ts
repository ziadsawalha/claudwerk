/** Dispatcher agent-loop model catalog + the streamed tool-event shape.
 *  Split out of dispatch-store.ts to keep the store under the size bar. */

/** Models the dispatcher agent loop can run on (user-switchable). Haiku by
 *  design -- tiny-context thin router (plan-dispatcher-build.md §9). */
export const DISPATCH_MODELS = [
  { slug: 'anthropic/claude-haiku-4.5', label: 'Haiku 4.5' },
  { slug: 'anthropic/claude-sonnet-4.5', label: 'Sonnet 4.5' },
  { slug: 'anthropic/claude-opus-4.1', label: 'Opus 4.1' },
] as const

/** One streamed tool call + its (eventual) result, for the dimmed gears UI. */
export interface DispatchToolEvent {
  callId: string
  name: string
  summary?: string
  args?: Record<string, unknown>
  status: 'running' | 'ok' | 'error'
  resultSummary?: string
  error?: string
}

type ToolEventMap = Record<string, DispatchToolEvent[]>

/** Append a freshly-streamed (running) tool call under its turn's traceId. */
export function appendToolCall(
  map: ToolEventMap,
  msg: { traceId: string; callId: string; name: string; summary?: string; args?: Record<string, unknown> },
): ToolEventMap {
  const prior = map[msg.traceId] ?? []
  const event: DispatchToolEvent = {
    callId: msg.callId,
    name: msg.name,
    summary: msg.summary,
    args: msg.args,
    status: 'running',
  }
  return { ...map, [msg.traceId]: [...prior, event] }
}

/** Resolve a streamed tool call's result (ok/error) by callId. */
export function resolveToolResult(
  map: ToolEventMap,
  msg: { traceId: string; callId: string; ok: boolean; summary?: string; error?: string },
): ToolEventMap {
  const prior = map[msg.traceId] ?? []
  const next = prior.map(e =>
    e.callId === msg.callId
      ? { ...e, status: msg.ok ? 'ok' : 'error', resultSummary: msg.summary, error: msg.error }
      : e,
  ) as DispatchToolEvent[]
  return { ...map, [msg.traceId]: next }
}
