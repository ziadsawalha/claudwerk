// Live data feed for THE CANVAS: selects the conversation list from the store
// (already permission-filtered server-side), applies the ended filter, and
// memoizes the dagre layout on list identity.
import type { Edge } from '@xyflow/react'
import { useMemo } from 'react'
import { useConversationsStore } from '@/hooks/use-conversations'
import { selectConversations } from '@/lib/slim-conversation'
import { type CanvasNode, layoutCanvas } from './layout'

export function useCanvasData(showEnded: boolean): {
  nodes: CanvasNode[]
  edges: Edge[]
  total: number
  activeCount: number
} {
  const byId = useConversationsStore(s => s.conversationsById)
  const selectedId = useConversationsStore(s => s.selectedConversationId)

  return useMemo(() => {
    const all = selectConversations(byId)
    const visible = showEnded ? all : all.filter(c => c.status !== 'ended')
    const { nodes, edges } = layoutCanvas(visible, selectedId, Date.now())
    return {
      nodes,
      edges,
      total: visible.length,
      activeCount: visible.filter(c => c.status === 'active').length,
    }
  }, [byId, selectedId, showEnded])
}
