/**
 * Activity-phrase live forwarder.
 *
 * EPHEMERAL by design -- the documented exception to the EVERYTHING IS A
 * STRUCTURED MESSAGE persist+replay default (same as thinking-progress). The
 * activity phrase is a pure liveness signal ("what it's doing now"), so we
 * forward to currently-watching subscribers and drop on the floor for everyone
 * else. No transcript entry, no SQLite write, no replay.
 *
 * Boundary: only `phrase` / `t` are touched. Never reads ccSessionId or any
 * agent host meta.
 */

import type { MessageHandler } from '../handler-context'
import { AGENT_HOST_ONLY, registerHandlers } from '../message-router'

const activityPhrase: MessageHandler = (ctx, data) => {
  const conversationId = (data.conversationId as string) || ctx.ws.data.conversationId
  if (!conversationId) return

  const conv = ctx.conversations.getConversation(conversationId)
  if (!conv) return

  const phrase = typeof data.phrase === 'string' ? data.phrase : null

  ctx.conversations.broadcastToChannel('conversation:transcript', conversationId, {
    type: 'activity_phrase',
    conversationId,
    phrase,
    t: typeof data.t === 'number' ? data.t : Date.now(),
  })
}

export function registerActivityPhraseHandlers(): void {
  registerHandlers({ activity_phrase: activityPhrase }, AGENT_HOST_ONLY)
}
