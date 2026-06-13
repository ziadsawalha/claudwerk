// Sentinel nodes for THE CANVAS: one node per sentinel (status + per-profile
// usage), laid out as a TOP RAIL above the project spaces -- each sentinel sits
// roughly over the conversations it hosts (greedy de-overlap keeps the row
// readable), with faint host edges dropping down to every conversation it
// hosts. Pure -- no React.

import type { ProfileUsageSnapshot } from '@shared/protocol'
import type { Edge, Node } from '@xyflow/react'
import type { SentinelStatusInfo } from '@/hooks/use-conversations'
import type { Conversation } from '@/lib/types'
import type { SentinelNodeData, SentinelProfileRow } from './canvas-types'
import type { CardRect } from './layout'

const SENTINEL_W = 280
const SENTINEL_BASE_H = 72
const SENTINEL_PROFILE_H = 40
const SENTINEL_GAP = 40
// The rail's bottom edge sits this far ABOVE the project spaces (which start at
// y=0), leaving room for the host edges to fan down.
const RAIL_BASELINE_Y = -140

export type ProfileUsageMap = Record<string, ProfileUsageSnapshot & { sentinelId: string; polledAt: number }>

function sentinelNodeId(sentinelId: string): string {
  return `sentinel:${sentinelId}`
}

function sentinelNodeHeight(profileCount: number): number {
  return SENTINEL_BASE_H + profileCount * SENTINEL_PROFILE_H
}

function profileRows(s: SentinelStatusInfo, usage: ProfileUsageMap): SentinelProfileRow[] {
  return (s.profiles ?? []).map(p => {
    const snap = usage[`${s.sentinelId}/${p.name}`]
    return {
      name: p.label || p.name,
      pool: p.pool ?? undefined,
      authed: snap?.authed ?? false,
      fiveHourPct: snap?.fiveHour?.usedPercent,
      sevenDayPct: snap?.sevenDay?.usedPercent,
      error: snap?.error?.kind,
    }
  })
}

/** Mean horizontal centre of the cards a sentinel hosts, or null when it hosts
 *  nothing on the canvas -- used to place each sentinel above its own work. */
function meanHostCenterX(
  sentinelId: string,
  conversations: Conversation[],
  cardRects: Map<string, CardRect>,
): number | null {
  let sum = 0
  let n = 0
  for (const c of conversations) {
    if (c.hostSentinelId !== sentinelId) continue
    const r = cardRects.get(c.id)
    if (!r) continue
    sum += r.x + r.w / 2
    n++
  }
  return n > 0 ? sum / n : null
}

interface RailEntry {
  s: SentinelStatusInfo
  profiles: SentinelProfileRow[]
  count: number
  /** desired centre x (over hosted work); orphan sentinels land past the content. */
  cx: number
}

/** Build the sentinel TOP-RAIL nodes: each sentinel centred over its hosted
 *  conversations, sorted left-to-right, greedily de-overlapped, and bottom-
 *  aligned to the rail baseline so the row hangs just above the projects. */
export function buildSentinelNodes(
  sentinels: SentinelStatusInfo[],
  conversations: Conversation[],
  usage: ProfileUsageMap,
  cardRects: Map<string, CardRect>,
): Node<SentinelNodeData, 'sentinel'>[] {
  const countByHost = new Map<string, number>()
  for (const c of conversations) {
    if (c.hostSentinelId) countByHost.set(c.hostSentinelId, (countByHost.get(c.hostSentinelId) ?? 0) + 1)
  }
  // Orphan sentinels (hosting nothing visible) park just past the content edge.
  const contentMaxX = Math.max(0, ...[...cardRects.values()].map(r => r.x + r.w))

  const entries: RailEntry[] = sentinels.map(s => ({
    s,
    profiles: profileRows(s, usage),
    count: countByHost.get(s.sentinelId) ?? 0,
    cx: meanHostCenterX(s.sentinelId, conversations, cardRects) ?? contentMaxX,
  }))
  entries.sort((a, b) => a.cx - b.cx || a.s.alias.localeCompare(b.s.alias))

  let cursorX = 0 // left edge floor -- prevents overlap while preserving order
  return entries.map(({ s, profiles, count, cx }) => {
    const h = sentinelNodeHeight(profiles.length)
    const x = Math.max(cursorX, cx - SENTINEL_W / 2)
    cursorX = x + SENTINEL_W + SENTINEL_GAP
    return {
      id: sentinelNodeId(s.sentinelId),
      type: 'sentinel',
      position: { x, y: RAIL_BASELINE_Y - h },
      selectable: false,
      draggable: false,
      zIndex: 1,
      data: {
        sentinelId: s.sentinelId,
        alias: s.alias,
        hostname: s.hostname,
        connected: s.connected,
        conversationCount: count,
        profiles,
      },
    }
  })
}

/** Faint host edges sentinel -> conversation; hover accents them. */
export function buildSentinelEdges(sentinels: SentinelStatusInfo[], conversations: Conversation[]): Edge[] {
  const known = new Set(sentinels.map(s => s.sentinelId))
  const edges: Edge[] = []
  for (const c of conversations) {
    const host = c.hostSentinelId
    if (!host || !known.has(host)) continue
    edges.push({
      id: `host:${host}->${c.id}`,
      source: sentinelNodeId(host),
      target: c.id,
      targetHandle: 'host',
      data: { kind: 'host' },
    })
  }
  return edges
}
