// Drives the agent-satellite linger: a stopped subagent must disappear
// AGENT_TTL_MS after it stops, but nothing in the store changes at that moment,
// so we self-schedule a single re-render at the earliest pending expiry. Returns
// a `now` timestamp the agent overlay reads (and depends on) -- each fire bumps
// it forward, recomputing the next expiry and rescheduling until the fleet quiets.
import { useEffect, useMemo, useState } from 'react'
import type { Conversation } from '@/lib/types'
import { earliestAgentExpiry } from './agents'

export function useAgentDecay(conversations: Conversation[]): number {
  const [now, setNow] = useState(() => Date.now())
  const nextExpiry = useMemo(() => earliestAgentExpiry(conversations, now), [conversations, now])

  useEffect(() => {
    if (nextExpiry == null) return
    const delay = Math.max(0, nextExpiry - Date.now()) + 50
    const timer = setTimeout(() => setNow(Date.now()), delay)
    return () => clearTimeout(timer)
  }, [nextExpiry])

  return now
}
