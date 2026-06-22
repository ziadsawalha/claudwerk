/**
 * Cockpit triage helpers: map a conversation's self-reported LiveStatus.state
 * to a colour + label, rank conversations attention-first, and small format
 * helpers shared across the overlay. Pure -- no React.
 */

import type { LiveStatusState } from '@shared/protocol'
import type { Conversation } from '@/lib/types'

export interface StateVisual {
  /** CSS colour (a theme token var()). Drives the dot + accents. */
  color: string
  label: string
  /** Pulse the dot (live attention). */
  pulse: boolean
}

const STATE_VISUALS: Record<LiveStatusState, StateVisual> = {
  needs_you: { color: 'var(--warning)', label: 'needs you', pulse: true },
  blocked: { color: 'var(--destructive)', label: 'blocked', pulse: true },
  working: { color: 'var(--info)', label: 'working', pulse: false },
  done: { color: 'var(--success)', label: 'done', pulse: false },
}

const IDLE_VISUAL: StateVisual = { color: 'var(--comment)', label: 'idle', pulse: false }

export function stateVisual(state: LiveStatusState | undefined): StateVisual {
  return state ? STATE_VISUALS[state] : IDLE_VISUAL
}

/** Lower rank = higher up the roster (more attention-worthy). */
function attentionRank(c: Conversation): number {
  if (c.status === 'ended') return 9
  switch (c.liveStatus?.state) {
    case 'needs_you':
      return 0
    case 'blocked':
      return 1
    case 'working':
      return 2
    case 'done':
      return 3
    default:
      return c.status === 'active' ? 4 : 5
  }
}

/** Attention-first ordering: triage rank, then most-recently-active. */
export function sortByAttention(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => {
    const ra = attentionRank(a)
    const rb = attentionRank(b)
    if (ra !== rb) return ra - rb
    return (b.lastActivity ?? 0) - (a.lastActivity ?? 0)
  })
}

export interface FleetSummary {
  total: number
  needsYou: number
  blocked: number
  working: number
}

export function summarizeFleet(conversations: Conversation[]): FleetSummary {
  const live = conversations.filter(c => c.status !== 'ended')
  return {
    total: live.length,
    needsYou: live.filter(c => c.liveStatus?.state === 'needs_you').length,
    blocked: live.filter(c => c.liveStatus?.state === 'blocked').length,
    working: live.filter(c => c.liveStatus?.state === 'working').length,
  }
}

const DISPOSITION_LABELS: Record<string, string> = {
  new: 'SPAWN NEW',
  route: 'ROUTE',
  revive: 'REVIVE',
  ask: 'CHOOSE',
}

export function dispositionLabel(disposition: string): string {
  return DISPOSITION_LABELS[disposition] ?? disposition.toUpperCase()
}

const COST_COLORS: Record<string, string> = {
  cheap: 'var(--success)',
  moderate: 'var(--info)',
  expensive: 'var(--warning)',
  very_expensive: 'var(--destructive)',
}

export function costColor(tier: string | undefined): string {
  return (tier && COST_COLORS[tier]) || 'var(--comment)'
}
