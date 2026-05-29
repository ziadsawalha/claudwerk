import { useEffect } from 'react'
import { fetchConversationEvents, useConversationsStore } from '@/hooks/use-conversations'

/**
 * On-demand hook events fetch. The hook-events list is only rendered by the
 * `events` tab (EventsView) and the `agents` tab (SubagentView filters events
 * per subagent). Eagerly fetching ~200 events on every conversation switch --
 * even when the user is on the transcript tab and never looks at events -- was
 * pure cold-open payload waste (it doubled the switch fetch; see the perf
 * report's `[switch-diag]`/fetch-latency finding).
 *
 * Now we fetch events only when a tab that needs them is active, and refresh on
 * reconnect (connectSeq). Live events still arrive via WS regardless, and the
 * sidebar event-count badge reads the scalar `conversation.eventCount`, not this
 * array -- so deferring the fetch changes nothing the user sees on the
 * transcript tab. `setEvents` keeps its "don't replace a larger local cache"
 * guard, so a refetch on tab re-open can't clobber newer WS-appended events.
 */
const TABS_NEEDING_EVENTS = new Set(['events', 'agents'])

export function useEventsFetch(conversationId: string | null, activeTab: string) {
  const isConnected = useConversationsStore(s => s.isConnected)
  const connectSeq = useConversationsStore(s => s.connectSeq)
  const needsEvents = TABS_NEEDING_EVENTS.has(activeTab)

  // biome-ignore lint/correctness/useExhaustiveDependencies: connectSeq is an intentional refetch trigger (reconnect); isConnected gates it
  useEffect(() => {
    if (!conversationId || !needsEvents || !isConnected) return
    let cancelled = false
    fetchConversationEvents(conversationId)
      .then(events => {
        if (cancelled) return
        useConversationsStore.getState().setEvents(conversationId, events)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  // react-doctor-disable-next-line react-doctor/exhaustive-deps
  }, [conversationId, needsEvents, connectSeq])
}
