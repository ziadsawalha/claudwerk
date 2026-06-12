// The pan/zoom graph itself: React Flow with the conversation + project-space
// node types, dotted background, controls, and a status-colored minimap.
// Read-only -- nodes aren't draggable; clicking a card opens the conversation.
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type NodeMouseHandler,
  ReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ConversationCardData } from './canvas-types'
import { ConversationNode } from './conversation-node'
import type { CanvasNode } from './layout'
import { ProjectSpaceNode } from './project-space-node'

const nodeTypes = { conversation: ConversationNode, projectSpace: ProjectSpaceNode }

const MINIMAP_COLORS: Record<string, string> = {
  active: 'var(--color-active)',
  idle: 'var(--color-idle)',
  starting: 'var(--color-info)',
  booting: 'var(--color-info)',
  ended: 'var(--color-ended)',
}

function minimapColor(n: Node): string {
  if (n.type === 'projectSpace') return 'oklch(0.4 0.02 260 / 0.3)'
  return MINIMAP_COLORS[(n.data as ConversationCardData)?.status] ?? 'var(--color-ended)'
}

function openConversation(id: string) {
  window.location.hash = `conversation/${id}`
}

export function CanvasGraph({ nodes, edges, showEnded }: { nodes: CanvasNode[]; edges: Edge[]; showEnded: boolean }) {
  function handleNodeClick(...[, node]: Parameters<NodeMouseHandler>) {
    if (node.type === 'conversation') openConversation(node.id)
  }

  if (nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No conversations to map{showEnded ? '' : ' (ended hidden)'}.
      </div>
    )
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      colorMode="dark"
      nodesDraggable={false}
      nodesConnectable={false}
      fitView
      minZoom={0.1}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={22} size={1} variant={BackgroundVariant.Dots} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        className="!bg-card"
        maskColor="rgba(0,0,0,0.4)"
        nodeColor={minimapColor}
        nodeStrokeWidth={0}
      />
    </ReactFlow>
  )
}
