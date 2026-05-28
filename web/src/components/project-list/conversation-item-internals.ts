import type { Conversation } from '@/lib/types'

export function isDaemonTransport(conversation: Conversation): boolean {
  return conversation.transport === 'claude-daemon'
}
