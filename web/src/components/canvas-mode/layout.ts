// THE CANVAS layout: conversations become cards laid out per-project by dagre
// (top-down spawn lineage), project clusters are shelf-packed into rows, and a
// large "project space" rect is painted behind each cluster. Pure -- no React.
import Dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'
import type { Conversation } from '@/lib/types'
import { projectDisplayName } from '@/lib/utils'
import { type ConversationCardData, conversationLabel, type ProjectSpaceData, projectHue } from './canvas-types'

export const NODE_W = 252
export const NODE_H = 96
const SPACE_PAD = 40
const TITLE_PAD = 76 // extra headroom so the painted project title clears row 1
const SPACE_GAP = 80
const ROW_MAX_W = 2600

export type CanvasNode = Node<ConversationCardData, 'conversation'> | Node<ProjectSpaceData, 'projectSpace'>

interface Cluster {
  uri: string
  members: Conversation[]
  positions: Map<string, { x: number; y: number }>
  w: number
  h: number
}

/** Dagre-layout one project's conversations (lineage edges only within it). */
function layoutCluster(uri: string, members: Conversation[]): Cluster {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 28, ranksep: 56, marginx: 0, marginy: 0 })
  const memberIds = new Set(members.map(c => c.id))
  for (const c of members) g.setNode(c.id, { width: NODE_W, height: NODE_H })
  for (const c of members) {
    if (c.parentConversationId && memberIds.has(c.parentConversationId)) g.setEdge(c.parentConversationId, c.id)
  }
  Dagre.layout(g)

  const positions = new Map<string, { x: number; y: number }>()
  let maxX = 0
  let maxY = 0
  for (const c of members) {
    const p = g.node(c.id)
    const x = p.x - NODE_W / 2
    const y = p.y - NODE_H / 2
    positions.set(c.id, { x, y })
    maxX = Math.max(maxX, x + NODE_W)
    maxY = Math.max(maxY, y + NODE_H)
  }
  return { uri, members, positions, w: maxX + SPACE_PAD * 2, h: maxY + SPACE_PAD + TITLE_PAD }
}

/** Shelf-pack clusters into rows of at most ROW_MAX_W, biggest first. */
function packClusters(clusters: Cluster[]): Map<string, { x: number; y: number }> {
  const sorted = [...clusters].sort((a, b) => b.members.length - a.members.length || a.uri.localeCompare(b.uri))
  const origins = new Map<string, { x: number; y: number }>()
  let x = 0
  let y = 0
  let rowH = 0
  for (const c of sorted) {
    if (x > 0 && x + c.w > ROW_MAX_W) {
      x = 0
      y += rowH + SPACE_GAP
      rowH = 0
    }
    origins.set(c.uri, { x, y })
    x += c.w + SPACE_GAP
    rowH = Math.max(rowH, c.h)
  }
  return origins
}

function toCardData(c: Conversation, childCount: number, now: number): ConversationCardData {
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
  }
}

function buildEdges(conversations: Conversation[], byProject: Map<string, Conversation[]>): Edge[] {
  const projectOf = new Map<string, string>()
  for (const [uri, members] of byProject) for (const c of members) projectOf.set(c.id, uri)
  const edges: Edge[] = []
  for (const c of conversations) {
    const parent = c.parentConversationId
    if (!parent || !projectOf.has(parent)) continue
    const crossProject = projectOf.get(parent) !== projectOf.get(c.id)
    edges.push({
      id: `${parent}->${c.id}`,
      source: parent,
      target: c.id,
      animated: c.status === 'active',
      style: {
        stroke: 'var(--color-border)',
        strokeWidth: 1.5,
        strokeDasharray: crossProject ? '6 5' : undefined,
      },
    })
  }
  return edges
}

/** Lay out the whole fleet: project spaces + conversation cards + spawn edges. */
export function layoutCanvas(
  conversations: Conversation[],
  selectedId: string | null,
  now: number,
): { nodes: CanvasNode[]; edges: Edge[] } {
  const byProject = new Map<string, Conversation[]>()
  for (const c of conversations) {
    const members = byProject.get(c.project)
    if (members) members.push(c)
    else byProject.set(c.project, [c])
  }

  const clusters = [...byProject.entries()].map(([uri, members]) => layoutCluster(uri, members))
  const origins = packClusters(clusters)
  const childCounts = new Map<string, number>()
  for (const c of conversations) {
    const parent = c.parentConversationId
    if (parent) childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1)
  }

  const nodes: CanvasNode[] = []
  for (const cluster of clusters) {
    const origin = origins.get(cluster.uri) ?? { x: 0, y: 0 }
    nodes.push({
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
    })
    for (const c of cluster.members) {
      const p = cluster.positions.get(c.id) ?? { x: 0, y: 0 }
      nodes.push({
        id: c.id,
        type: 'conversation',
        position: { x: origin.x + SPACE_PAD + p.x, y: origin.y + TITLE_PAD + p.y },
        selected: c.id === selectedId,
        zIndex: 1,
        data: toCardData(c, childCounts.get(c.id) ?? 0, now),
      })
    }
  }
  return { nodes, edges: buildEdges(conversations, byProject) }
}
