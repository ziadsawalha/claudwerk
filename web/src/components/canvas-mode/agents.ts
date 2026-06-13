// Agent overlay for THE CANVAS: every running subagent (and, briefly, every
// just-stopped one) becomes a small pink satellite node fanned to the right of
// its parent conversation card, linked by a faint pink edge. Stopped agents
// linger for AGENT_TTL_MS then drop. Pure -- no React, positions come from the
// card rects layout.ts already computed.
import type { Edge, Node } from '@xyflow/react'
import type { Conversation } from '@/lib/types'
import { AGENT_TTL_MS, type AgentNodeData } from './canvas-types'
import type { CardRect } from './layout'

const AGENT_H = 30
const AGENT_GAP = 7
const FAN_X = 20 // gap between a card's right edge and its agent column

type Subagent = Conversation['subagents'][number]

/** True while a subagent should still appear on the canvas (running, or stopped
 *  within the linger window). */
function isVisible(a: Subagent, now: number): boolean {
  if (a.status === 'running') return true
  return a.stoppedAt != null && now - a.stoppedAt < AGENT_TTL_MS
}

/** Earliest wall-clock ms at which some currently-shown stopped agent will
 *  expire, or null when nothing is pending -- drives the decay re-render. */
export function earliestAgentExpiry(conversations: Conversation[], now: number): number | null {
  let soonest: number | null = null
  for (const c of conversations) {
    for (const a of c.subagents) {
      if (a.status === 'running' || a.stoppedAt == null) continue
      const expiry = a.stoppedAt + AGENT_TTL_MS
      if (expiry > now && (soonest == null || expiry < soonest)) soonest = expiry
    }
  }
  return soonest
}

function agentNode(convId: string, a: Subagent, rect: CardRect, idx: number): Node<AgentNodeData, 'agent'> {
  return {
    id: `agent:${convId}:${a.agentId}`,
    type: 'agent',
    position: { x: rect.x + rect.w + FAN_X, y: rect.y + idx * (AGENT_H + AGENT_GAP) },
    selectable: false,
    draggable: false,
    zIndex: 1,
    data: { agentType: a.agentType, model: a.model, fading: a.status !== 'running' },
  }
}

function agentEdge(convId: string, a: Subagent): Edge {
  return {
    id: `agentedge:${convId}:${a.agentId}`,
    source: convId,
    sourceHandle: 'agents',
    target: `agent:${convId}:${a.agentId}`,
    data: { kind: 'agent' },
  }
}

/** Build the pink agent satellites + their edges for every visible parent. */
export function buildAgentNodes(
  conversations: Conversation[],
  cardRects: Map<string, CardRect>,
  now: number,
): { nodes: Node<AgentNodeData, 'agent'>[]; edges: Edge[] } {
  const nodes: Node<AgentNodeData, 'agent'>[] = []
  const edges: Edge[] = []
  for (const c of conversations) {
    const rect = cardRects.get(c.id)
    if (!rect) continue
    let idx = 0
    for (const a of c.subagents) {
      if (!isVisible(a, now)) continue
      nodes.push(agentNode(c.id, a, rect, idx))
      edges.push(agentEdge(c.id, a))
      idx++
    }
  }
  return { nodes, edges }
}
