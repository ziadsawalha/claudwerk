import { randomUUID } from 'node:crypto'
import type { Conversation, TranscriptSystemEntry } from '../../../shared/protocol'
import type { ConversationStore } from '../../conversation-store'
import { parseRecapContent } from '../shared/json-parse'
import { condenseTranscript } from './condense'
import { sanitizeSuggestedName } from './name'

// fallow-ignore-next-line complexity
export function persistResult(
  store: ConversationStore,
  conversationId: string,
  rawText: string,
  allowEnded: boolean,
): void {
  const parsed = parseRecapContent(rawText)
  const freshConv = store.getConversation(conversationId)
  if (!freshConv) return
  if (!allowEnded && freshConv.status !== 'idle') return

  const suggestedName = sanitizeSuggestedName(parsed.name)
  const entry: TranscriptSystemEntry = {
    type: 'system',
    subtype: 'away_summary',
    content: JSON.stringify({
      title: parsed.title,
      recap: parsed.recap,
      ...(suggestedName ? { name: suggestedName } : {}),
    }),
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
  }
  store.addTranscriptEntries(conversationId, [entry], false)
  applySuggestedName(store, conversationId, freshConv, suggestedName)
  store.broadcastToChannel('conversation:transcript', conversationId, {
    type: 'transcript',
    conversationId,
    entries: [entry],
  })
  store.broadcastConversationUpdate(conversationId)
  if (allowEnded) store.persistConversationById(conversationId)
  console.log(
    `[recap] generated for ${conversationId.slice(0, 8)}: title="${parsed.title}" recap="${parsed.recap.slice(0, 60)}"` +
      (suggestedName ? ` name="${suggestedName}"` : ''),
  )
}

/**
 * Adopt the model-suggested name as the conversation's auto title. Same
 * pinning rule as CC's auto-titler (`conversation_name` with userSet=false):
 * a user-set title is never overwritten, an auto title is fair game.
 */
function applySuggestedName(
  store: ConversationStore,
  conversationId: string,
  conv: Conversation,
  name: string | null,
): void {
  if (!name || conv.title === name) return
  if (conv.titleUserSet) {
    console.log(
      `[recap] suggested name "${name}" ignored for ${conversationId.slice(0, 8)} -- ` +
        `user-set title "${conv.title}" pinned`,
    )
    return
  }
  console.log(
    `[recap] conversation name: "${conv.title ?? '(none)'}" -> "${name}" (${conversationId.slice(0, 8)}, auto)`,
  )
  conv.title = name
  store.persistConversationById(conversationId)
}

export function buildCondensedContext(
  store: ConversationStore,
  conversationId: string,
  resultText?: string,
): string | null {
  let entries = store.getTranscriptEntries(conversationId)
  if (entries.length === 0) entries = store.loadTranscriptFromStore(conversationId, 200) || []
  if (entries.length === 0 && !resultText) return null
  return condenseTranscript({ entries, resultText })
}
