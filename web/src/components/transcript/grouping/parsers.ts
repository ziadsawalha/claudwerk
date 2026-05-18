import type { TranscriptEntry, TranscriptQueueEntry, TranscriptUserEntry } from '@/lib/types'
import type { TaskNotification } from './types'

export function isUser(e: TranscriptEntry): e is TranscriptUserEntry {
  return e.type === 'user'
}

export function isQueue(e: TranscriptEntry): e is TranscriptQueueEntry {
  return e.type === 'queue-operation'
}

// Parse <task-notification> XML into structured data using DOMParser
export function parseTaskNotifications(text: string): TaskNotification[] {
  const results: TaskNotification[] = []
  const blockRegex = /<task-notification>([\s\S]*?)(?:<\/task-notification>|$)/g
  let blockMatch: RegExpExecArray | null = blockRegex.exec(text)
  while (blockMatch !== null) {
    const xml = `<root>${blockMatch[1]}</root>`
    try {
      const doc = new DOMParser().parseFromString(xml, 'text/xml')
      const taskId = doc.querySelector('task-id')?.textContent?.trim() || ''
      const status = doc.querySelector('status')?.textContent?.trim() || ''
      const summary = doc.querySelector('summary')?.textContent?.trim() || ''
      const result = doc.querySelector('result')?.textContent?.trim() || undefined
      const toolUseId = doc.querySelector('tool-use-id')?.textContent?.trim() || undefined
      const outputFile = doc.querySelector('output-file')?.textContent?.trim() || undefined

      // Parse usage block: <usage><total_tokens>N</total_tokens><tool_uses>N</tool_uses><duration_ms>N</duration_ms></usage>
      let usage: TaskNotification['usage']
      const usageEl = doc.querySelector('usage')
      if (usageEl) {
        const totalTokens = Number.parseInt(usageEl.querySelector('total_tokens')?.textContent || '0', 10)
        const toolUses = Number.parseInt(usageEl.querySelector('tool_uses')?.textContent || '0', 10)
        const durationMs = Number.parseInt(usageEl.querySelector('duration_ms')?.textContent || '0', 10)
        if (totalTokens || toolUses || durationMs) {
          usage = { totalTokens, toolUses, durationMs }
        }
      }

      if (taskId || summary) {
        results.push({ taskId, status, summary, result, toolUseId, outputFile, usage })
      }
    } catch {
      // Malformed XML - skip
    }
    blockMatch = blockRegex.exec(text)
  }
  return results
}

// Extract skill/command name from a user entry that precedes skill content injection.
// Path A: tool_result with toolUseResult.commandName (Skill tool)
// Path B: <command-message>name</command-message> (direct /slash command)
export function extractSkillName(entry: TranscriptUserEntry): string | undefined {
  const extra = entry.toolUseResult as Record<string, unknown> | undefined
  if (extra?.commandName) return extra.commandName as string
  const text = typeof entry.message?.content === 'string' ? entry.message.content : ''
  const match = text.match(/<command-message>([^<]+)<\/command-message>/)
  return match?.[1]
}

// Detect if a user entry is a skill content injection (the big markdown dump
// after a Skill tool call or /slash command).
//
// `isMeta` marks an injected, non-user-turn entry. The agent host populates it
// in both transports -- natively from CC's JSONL (PTY) and normalized from
// stream-json `isSynthetic` (headless) -- so detection can rely on it. The
// content marker then distinguishes skill content from other meta entries.
// Gated by `pendingSkillName` at the call site, so a stray paste can't match.
export function isSkillContent(entry: TranscriptUserEntry): boolean {
  if (entry.isMeta !== true) return false
  const content = entry.message?.content
  if (!Array.isArray(content)) return false
  const text = content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('')
  return text.length > 300 && (text.startsWith('Base directory for this skill:') || text.startsWith('#'))
}
