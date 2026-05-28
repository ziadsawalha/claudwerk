/**
 * Thinking-progress live forwarder.
 *
 * EPHEMERAL by design -- this is the documented exception to the
 * EVERYTHING IS A STRUCTURED MESSAGE persist+replay default. Thinking
 * progress is a pure liveness signal (like a typing indicator), so we
 * forward to currently-watching subscribers and drop on the floor for
 * everyone else. No transcript entry, no SQLite write, no replay.
 *
 * Boundary: only `tokens` / `delta` / `t` are touched. Never reads
 * ccSessionId or any agent host meta.
 */

import type { MessageHandler } from '../handler-context'
import { AGENT_HOST_ONLY, registerHandlers } from '../message-router'

const thinkingProgress: MessageHandler = (ctx, data) => {
  const conversationId = (data.conversationId as string) || ctx.ws.data.conversationId
  const tokens = data.tokens
  if (!conversationId || typeof tokens !== 'number') return

  const conv = ctx.conversations.getConversation(conversationId)
  if (!conv) return

  ctx.conversations.broadcastToChannel('conversation:transcript', conversationId, {
    type: 'thinking_progress',
    conversationId,
    tokens,
    delta: typeof data.delta === 'number' ? data.delta : undefined,
    t: typeof data.t === 'number' ? data.t : Date.now(),
  })
}

export function registerThinkingProgressHandlers(): void {
  registerHandlers({ thinking_progress: thinkingProgress }, AGENT_HOST_ONLY)
}
