import { useDispatchStore } from './dispatch-store'

/** Per-user workspace stub. The dispatcher's `/work/<x>` workspace concept
 *  (tanstack-ai + agent-core + vfs) is a parked next slice; this surfaces the
 *  intent + the per-user scoping so the cockpit is honest about what's wired. */
export function DispatchWorkspace() {
  const userId = useDispatchStore(s => s.userId)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="rounded-lg border border-dashed border-border px-4 py-1.5 text-[10px] uppercase tracking-[0.2em] text-comment">
        workspace · stub
      </div>
      <p className="max-w-xs text-[12px] leading-relaxed text-comment">
        A private <span className="text-foreground">/work</span> area for{' '}
        <span className="text-foreground">{userId ?? 'you'}</span> -- scratch files, a sandbox vfs, and a workspace
        agent.
      </p>
      <p className="max-w-xs text-[11px] text-comment/70">
        Parked as the next dispatcher slice (agent-core + vfs). Per-user from day one.
      </p>
    </div>
  )
}
