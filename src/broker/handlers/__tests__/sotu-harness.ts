/**
 * Shared test harness for the SOTU wire handlers -- a minimal `HandlerContext`
 * double that captures replies + scoped broadcasts and routes a message through
 * the real router. Used by both the contribution-spine handler tests
 * (sotu-handlers.test.ts) and the read-surface MCP handler tests
 * (sotu-mcp.test.ts) so the context double is defined once.
 */

import type { HandlerContext, MessageData, WsData } from '../../handler-context'
import { routeMessage } from '../../message-router'

/** The project every resolvable conversation in these tests maps to. */
export const HARNESS_PROJECT = 'claude://host/proj'

export interface RunResult {
  replies: Record<string, unknown>[]
  broadcasts: { msg: Record<string, unknown>; project: string }[]
}

/** A caller-settings double carrying just the trust level the gate reads. */
export function trustSettings(trustLevel: 'default' | 'benevolent'): HandlerContext['callerSettings'] {
  return { trustLevel } as unknown as HandlerContext['callerSettings']
}

/** Route one message through a captured HandlerContext double + return what it
 *  replied/broadcast. `getConversation(id)` resolves any non-empty id to
 *  HARNESS_PROJECT so source resolution works. */
export function runHandler(
  type: string,
  data: MessageData,
  wsData: Partial<WsData>,
  callerSettings?: HandlerContext['callerSettings'],
): RunResult {
  const replies: Record<string, unknown>[] = []
  const broadcasts: RunResult['broadcasts'] = []
  const ctx = {
    ws: { data: wsData },
    callerSettings: callerSettings ?? null,
    reply: (m: Record<string, unknown>) => replies.push(m),
    broadcastScoped: (msg: Record<string, unknown>, project: string) => broadcasts.push({ msg, project }),
    conversations: { getConversation: (id: string) => (id ? { project: HARNESS_PROJECT } : undefined) },
    log: { info() {}, error() {}, debug() {} },
  } as unknown as HandlerContext
  routeMessage(ctx, type, data)
  return { replies, broadcasts }
}

/** Flush the microtask + a short timer so an async-fire handler's reply lands. */
export const flushHandler = () => new Promise(r => setTimeout(r, 5))
