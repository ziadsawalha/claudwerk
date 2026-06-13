// THE CANVAS layout: turns dagre-packed clusters (cluster-pack.ts) into React
// Flow nodes -- project-space rects, conversation cards, spawn edges -- and
// hands back absolute card rects for the agent overlay + sentinel rail. Pure,
// no React.
import type { Edge, Node } from '@xyflow/react'
import type { Conversation } from '@/lib/types'
import { projectDisplayName } from '@/lib/utils'
import {
  type AgentNodeData,
  type ConversationCardData,
  conversationLabel,
  type ProjectSpaceData,
  projectHue,
  type SentinelNodeData,
} from './canvas-types'
import { type Cluster, layoutCluster, nodeSize, packClusters, SPACE_PAD, TITLE_PAD } from './cluster-pack'
import { buildLineageEdges } from './edge-style'

export { EXPANDED_H, EXPANDED_W, NODE_H, NODE_W } from './cluster-pack'

export type CanvasNode =
  | Node<ConversationCardData, 'conversation'>
  | Node<ProjectSpaceData, 'projectSpace'>
  | Node<SentinelNodeData, 'sentinel'>
  | Node<AgentNodeData, 'agent'>

function toCardData(c: Conversation, childCount: number, now: number, expanded: boolean): ConversationCardData {
  return {
    label: conversationLabel(c),
    status: c.status,
    model: c.model,
    attention: c.pendingAttention?.type,
    tokens: (c.stats?.totalInputTokens ?? 0) + (c.stats?.totalOutputTokens ?? 0),
    costUsd: c.stats?.totalCostUsd,
    agoMs: Math.max(0, now - c.lastActivity),
    childCount,
    compacting: c.compacting === true,
    expanded,
  }
}

function projectSpaceNode(cluster: Cluster, origin: { x: number; y: number }): CanvasNode {
  return {
    id: `space:${cluster.uri}`,
    type: 'projectSpace',
    position: origin,
    width: cluster.w,
    height: cluster.h,
    selectable: false,
    zIndex: -1,
    // Pointer-transparent so the huge rect never swallows canvas panning;
    // the header chip re-enables pointer events for its own click.
    style: { pointerEvents: 'none' },
    data: {
      label: projectDisplayName(cluster.uri),
      uri: cluster.uri,
      count: cluster.members.length,
      activeCount: cluster.members.filter(c => c.status === 'active').length,
      hue: projectHue(cluster.uri),
    },
  }
}

function groupByProject(conversations: Conversation[]): Map<string, Conversation[]> {
  const byProject = new Map<string, Conversation[]>()
  for (const c of conversations) {
    const members = byProject.get(c.project)
    if (members) members.push(c)
    else byProject.set(c.project, [c])
  }
  return byProject
}

function countChildren(conversations: Conversation[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const c of conversations.filter(x => x.parentConversationId)) {
    counts.set(c.parentConversationId as string, (counts.get(c.parentConversationId as string) ?? 0) + 1)
  }
  return counts
}

interface CardContext {
  selectedId: string | null
  now: number
  expandedIds: ReadonlySet<string>
  childCounts: Map<string, number>
}

/** Absolute card rectangle, keyed by conversation id -- consumed by the agent
 *  overlay (satellite placement) and the sentinel top-rail (ordering). */
export type CardRect = { x: number; y: number; w: number; h: number }

function clusterNodes(
  cluster: Cluster,
  origin: { x: number; y: number },
  ctx: CardContext,
  rects: Map<string, CardRect>,
): CanvasNode[] {
  const nodes: CanvasNode[] = [projectSpaceNode(cluster, origin)]
  for (const c of cluster.members) {
    const p = cluster.positions.get(c.id) ?? { x: 0, y: 0 }
    const expanded = ctx.expandedIds.has(c.id)
    const { w, h } = nodeSize(c.id, ctx.expandedIds)
    const position = { x: origin.x + SPACE_PAD + p.x, y: origin.y + TITLE_PAD + p.y }
    rects.set(c.id, { x: position.x, y: position.y, w, h })
    nodes.push({
      id: c.id,
      type: 'conversation',
      position,
      selected: c.id === ctx.selectedId,
      zIndex: expanded ? 2 : 1,
      data: toCardData(c, ctx.childCounts.get(c.id) ?? 0, ctx.now, expanded),
    })
  }
  return nodes
}

/** Lay out the whole fleet: project spaces + conversation cards + spawn edges.
 *  Also returns absolute card rects for the agent overlay + sentinel rail. */
export function layoutCanvas(
  conversations: Conversation[],
  selectedId: string | null,
  now: number,
  expandedIds: ReadonlySet<string>,
): { nodes: CanvasNode[]; edges: Edge[]; cardRects: Map<string, CardRect> } {
  const byProject = groupByProject(conversations)
  const clusters = [...byProject.entries()].map(([uri, members]) => layoutCluster(uri, members, expandedIds))
  const origins = packClusters(clusters)
  const ctx: CardContext = { selectedId, now, expandedIds, childCounts: countChildren(conversations) }
  const cardRects = new Map<string, CardRect>()
  const nodes = clusters.flatMap(cluster =>
    clusterNodes(cluster, origins.get(cluster.uri) ?? { x: 0, y: 0 }, ctx, cardRects),
  )
  return { nodes, edges: buildLineageEdges(conversations, byProject), cardRects }
}
