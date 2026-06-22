import { useDispatchStore } from './dispatch-store'
import { DispatchThreadCard } from './dispatch-thread-card'

/** Near-memory panel: the dispatcher's threads -- what it is managing right now,
 *  scoped to the current user. */
export function DispatchThreads() {
  const threads = useDispatchStore(s => s.threads)
  const loading = useDispatchStore(s => s.threadsLoading)
  const refresh = useDispatchStore(s => s.fetchThreads)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-comment">Near memory</span>
        <button
          type="button"
          onClick={refresh}
          className="text-[10px] uppercase tracking-wide text-comment hover:text-foreground"
        >
          {loading ? '…' : 'refresh'}
        </button>
      </div>
      <div className="dispatch-scroll min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
        {threads.length === 0 && !loading && (
          <p className="px-1 py-8 text-center text-[12px] text-comment">
            No threads yet. The dispatcher records what it's managing as you dispatch.
          </p>
        )}
        {threads.map(t => (
          <DispatchThreadCard key={t.id} thread={t} />
        ))}
      </div>
    </div>
  )
}
