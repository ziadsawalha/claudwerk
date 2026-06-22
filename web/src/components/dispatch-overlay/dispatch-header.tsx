import { useMemo } from 'react'
import { useConversations } from '@/hooks/use-conversations'
import { summarizeFleet } from './dispatch-status'
import { useDispatchStore } from './dispatch-store'

/** Cockpit header: identity (per-user), a live fleet readout, and close. */
export function DispatchHeader() {
  const conversations = useConversations()
  const userId = useDispatchStore(s => s.userId)
  const close = useDispatchStore(s => s.closeOverlay)
  const summary = useMemo(() => summarizeFleet(conversations), [conversations])

  return (
    <header className="flex flex-none items-center gap-4 border-b border-border px-5 py-3">
      <div className="flex items-baseline gap-2.5">
        <span className="text-[15px] font-bold tracking-[0.22em] text-foreground">DISPATCH</span>
        <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
          {userId ? `@${userId}` : 'per-user'}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-4 text-[11px] text-comment">
        <Stat value={summary.total} label="live" />
        <Stat value={summary.working} label="working" color="var(--info)" />
        <Stat value={summary.needsYou} label="need you" color="var(--warning)" />
        <Stat value={summary.blocked} label="blocked" color="var(--destructive)" />
      </div>

      <button
        type="button"
        onClick={close}
        aria-label="Close dispatch (Esc)"
        className="ml-2 flex-none rounded-md border border-border px-2.5 py-1 text-[11px] text-comment hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        esc
      </button>
    </header>
  )
}

function Stat({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-[14px] font-semibold tabular-nums" style={{ color: color ?? 'var(--foreground)' }}>
        {value}
      </span>
      <span className="uppercase tracking-wide">{label}</span>
    </span>
  )
}
