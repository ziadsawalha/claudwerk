import { DispatchActions } from './dispatch-actions-block'
import { useDispatchStore } from './dispatch-store'
import { modelLabel, ToolEvents } from './dispatch-tool-events'

/**
 * The in-flight tail under the persisted conversation: live gears while the
 * dispatcher thinks, the latest decision's affordances (candidate pick / expensive
 * confirm / take-me-there), and which model just answered. The conversation itself
 * is the streamed history (DispatchTranscript); this is only the live edge.
 */
// fallow-ignore-next-line complexity -- a presentational && chain; score is coverage-inflated, not real risk
export function DispatchTail() {
  const pending = useDispatchStore(s => s.pending)
  const lastError = useDispatchStore(s => s.lastError)
  const activeEvents = useDispatchStore(s => (s.activeTraceId ? s.toolEvents[s.activeTraceId] : undefined))
  const latest = useDispatchStore(s => s.decisions[0])
  const routeTo = useDispatchStore(s => s.routeTo)
  const confirmExpensive = useDispatchStore(s => s.confirmExpensive)
  const model = pending ? undefined : modelLabel(latest?.model)

  return (
    <>
      <div className="flex flex-col gap-3 px-6 pb-2">
        {pending && <ToolEvents events={activeEvents} />}
        {latest && <DispatchActions d={latest} routeTo={routeTo} confirmExpensive={confirmExpensive} />}
        {model && <span className="font-mono text-[10.5px] text-comment/45">via {model}</span>}
      </div>

      {pending && (
        <p className="px-6 pb-4 text-[13px] text-comment">
          <span
            className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full align-middle"
            style={{ background: 'var(--accent)' }}
          />
          one sec…
        </p>
      )}
      {lastError && (
        <p className="mx-6 mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2 text-[12.5px] text-destructive">
          {lastError}
        </p>
      )}
    </>
  )
}
