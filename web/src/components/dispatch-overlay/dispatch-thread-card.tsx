import type { DispatchThread } from '@shared/protocol'
import { formatAge, truncate } from '@/lib/utils'

/** One near-memory thread: a tiny State-of-the-Union the dispatcher is keeping
 *  -- title, summary, and the conversations it has touched. */
export function DispatchThreadCard({ thread }: { thread: DispatchThread }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">{thread.title}</span>
        <span className="flex-none text-[10px] text-comment">{formatAge(thread.updatedAt)}</span>
      </div>
      {thread.summary && <p className="mt-1 text-[11px] leading-snug text-comment">{truncate(thread.summary, 160)}</p>}
      {thread.conversations.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {thread.conversations.slice(0, 6).map(c => (
            <span
              key={c.conversationId}
              className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] text-comment"
              title={c.conversationId}
            >
              {truncate(c.label || c.conversationId.slice(0, 8), 18)}
            </span>
          ))}
          {thread.conversations.length > 6 && (
            <span className="px-1 py-0.5 text-[10px] text-comment">+{thread.conversations.length - 6}</span>
          )}
        </div>
      )}
    </div>
  )
}
