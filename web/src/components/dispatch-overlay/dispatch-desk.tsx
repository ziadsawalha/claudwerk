import { MemorySection, WorkspaceSection } from './dispatch-memory-section'
import { useDispatchStore } from './dispatch-store'

/** The LIVE roster the desk covers ("active right now" -- tap to open). */
function RosterSection() {
  const roster = useDispatchStore(s => s.roster)
  const routeTo = useDispatchStore(s => s.routeTo)
  if (roster.length === 0) return null
  return (
    <div>
      <span className="text-[11px] uppercase tracking-[0.2em] text-comment">active right now</span>
      <div className="mt-3 flex flex-col gap-2">
        {roster.slice(0, 6).map(c => (
          <button
            key={c.conversationId}
            type="button"
            onClick={() => routeTo(c.conversationId)}
            className="flex flex-col gap-0.5 rounded-xl border border-border/70 bg-card/40 px-3.5 py-2.5 text-left transition-colors hover:border-[color-mix(in_oklch,var(--accent)_45%,transparent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="truncate text-[13px] font-medium text-foreground/90">
              {c.title || c.project || c.conversationId.slice(0, 8)}
            </span>
            {c.commentary && <span className="text-[11.5px] leading-snug text-comment">{c.commentary}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

/** What the GLOBAL concierge is holding right now: the live roster ("active right
 *  now"), its durable memory, and scratch workspaces. The dispatcher is global
 *  (one per user, fronts ALL projects) -- it is NOT anchored to one project, so
 *  there is no by-project lead. Threads are SHORT-TERM memory folded into the
 *  dispatcher's context, not a panel. Light, not a fleet dashboard; renders
 *  nothing when everything is empty. */
export function DispatchDesk() {
  const roster = useDispatchStore(s => s.roster)
  const memory = useDispatchStore(s => s.memory)
  if (roster.length === 0 && !memory.trim()) return null

  return (
    <div className="flex flex-col gap-7 px-6 pt-8">
      <RosterSection />
      <MemorySection />
      <WorkspaceSection />
    </div>
  )
}
