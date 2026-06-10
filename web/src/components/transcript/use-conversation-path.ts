import { useConversationsStore } from '@/hooks/use-conversations'
import { projectPath } from '@/lib/types'

/** Project path of the selected conversation when path sanitizing is enabled,
 *  undefined otherwise. Returns a primitive (string|undefined) so Zustand
 *  skips re-renders when the value is stable. */
export function useConversationPath(): string | undefined {
  return useConversationsStore(s => {
    if (s.controlPanelPrefs.sanitizePaths === false) return undefined
    const sid = s.selectedConversationId
    const conversation = sid ? s.conversationsById[sid] : undefined
    return conversation ? projectPath(conversation.project) : undefined
  })
}
