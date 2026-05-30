import type { ForgottenThreadDigest } from '../gather/types'
import { shortId } from './render-transcripts'

const USER_PROMPT_MAX = 300

/**
 * Render the FORGOTTEN_THREADS prompt block. SHARED by the oneshot prompt
 * (prompt-builder) and the chunked reduce prompt (synthesize-prompt) -- forgotten
 * threads are period-global and bypass map extraction, so BOTH synthesis paths
 * inject this same deterministic block.
 *
 * Empty -> '' so the section is omitted entirely (the caller filters falsy parts).
 */
export function renderForgottenSection(forgotten: ForgottenThreadDigest): string {
  if (forgotten.threads.length === 0) return ''
  const notShown = forgotten.candidateCount - forgotten.threads.length
  const tail = notShown > 0 ? ` (${notShown} more invested+stale thread(s) not shown)` : ''
  const blocks = forgotten.threads.map(t => {
    const title = t.conversationTitle || '(untitled)'
    const open = t.openQuestions.map(q => `    OPEN: ${q}`).join('\n')
    return [
      `  ${shortId(t.conversationId)} "${title}" -- idle ${t.idleDays}d, ${t.turnCount} turns`,
      `    LAST USER: ${truncate(t.lastUserPrompt, USER_PROMPT_MAX)}`,
      `    LEFT AT: ${t.finalAssistantText}`,
      open,
    ]
      .filter(Boolean)
      .join('\n')
  })
  return (
    `FORGOTTEN_THREADS (${forgotten.threads.length} invested conversation(s) abandoned BEFORE this period, ` +
    `each ending on a question the user never answered${tail}.\n` +
    `These are DETERMINISTIC facts, NOT extracted -- render EVERY one in the loose-ends section ` +
    `with a short synthesized description of what it was about; do not drop any, do not invent any):\n` +
    blocks.join('\n\n')
  )
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s
}
