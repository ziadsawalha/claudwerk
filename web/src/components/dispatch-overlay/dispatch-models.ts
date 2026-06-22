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
