import type { ConversationSummary } from '../../shared/protocol'

export interface SummaryCacheEntry {
  readonly summary: ConversationSummary
  /** `JSON.stringify(summary)` -- the per-conversation fragment, WITHOUT the
   *  sync `_epoch`/`_seq` envelope. Reused verbatim across every subscriber in a
   *  `conversations_list` build so the big summary is serialized once, not once
   *  per connection. */
  readonly json: string
}

/**
 * Per-conversation cache of the broadcast summary object + its serialized JSON
 * fragment.
 *
 * INVALIDATION IS THE CONTRACT. A cached entry stays valid until ANY
 * summary-visible state changes; serving a stale entry = silently-wrong
 * control-panel UI, the one unacceptable failure. The invalidation surface is
 * deliberately wired so it is hard to forget:
 *
 *  - `scheduleConversationUpdate(id)` is the universal chokepoint -- every
 *    `broadcastConversationUpdate` caller (all handlers), the maintenance pass,
 *    `updateTasks`, `addEvent`, etc. funnel through it, and it invalidates first.
 *  - the direct-build lifecycle sites (`resumeConversation`, `clearConversation`,
 *    `endConversation`) mutate then build a summary WITHOUT going through the
 *    scheduler, so they invalidate explicitly before building.
 *  - external-dependency sites invalidate at their mutation point: socket
 *    add/remove (`connectionIds`), project/conversation link changes
 *    (`linkedProjects`/`linkedConversations`), and sentinel feature updates
 *    (`shellCapable`).
 *
 * When in doubt, invalidate -- a redundant rebuild is cheap, a stale summary is not.
 */
export interface SummaryCache {
  get(id: string): SummaryCacheEntry | undefined
  set(id: string, entry: SummaryCacheEntry): void
  invalidate(id: string): void
  clear(): void
  readonly size: number
}

export function createSummaryCache(): SummaryCache {
  const cache = new Map<string, SummaryCacheEntry>()
  return {
    get: id => cache.get(id),
    set: (id, entry) => {
      cache.set(id, entry)
    },
    invalidate: id => {
      cache.delete(id)
    },
    clear: () => {
      cache.clear()
    },
    get size() {
      return cache.size
    },
  }
}
