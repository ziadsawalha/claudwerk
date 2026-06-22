import { useMemo, useState } from 'react'
import { useConversations } from '@/hooks/use-conversations'
import { DispatchRosterItem } from './dispatch-roster-item'
import { sortByAttention } from './dispatch-status'
import { useDispatchStore } from './dispatch-store'

/** Left rail: the fleet, ordered attention-first (needs-you / blocked float up).
 *  Selecting a conversation routes the right pane to its transcript. */
export function DispatchRoster() {
  const conversations = useConversations()
  const activeConvId = useDispatchStore(s => s.activeConvId)
  const selectConv = useDispatchStore(s => s.selectConv)
  const [query, setQuery] = useState('')
  const [showEnded, setShowEnded] = useState(false)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = conversations.filter(c => {
      if (!showEnded && c.status === 'ended') return false
      if (!q) return true
      return `${c.title ?? ''} ${c.project}`.toLowerCase().includes(q)
    })
    return sortByAttention(filtered)
  }, [conversations, query, showEnded])

  return (
    <div className="flex h-full min-h-0 w-72 flex-none flex-col border-r border-border">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-comment">Fleet</span>
        <button
          type="button"
          onClick={() => setShowEnded(v => !v)}
          className="text-[10px] uppercase tracking-wide text-comment hover:text-foreground"
        >
          {showEnded ? 'hide ended' : 'show ended'}
        </button>
      </div>
      <div className="px-3 pb-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="filter fleet…"
          className="w-full rounded-md border border-border bg-input/60 px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-comment focus-visible:border-primary/50 focus-visible:outline-none"
        />
      </div>
      <div className="dispatch-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {rows.length === 0 && <p className="px-2 py-6 text-center text-[12px] text-comment">No conversations.</p>}
        {rows.map(c => (
          <DispatchRosterItem
            key={c.id}
            conversation={c}
            selected={c.id === activeConvId}
            onSelect={() => selectConv(c.id)}
          />
        ))}
      </div>
    </div>
  )
}
