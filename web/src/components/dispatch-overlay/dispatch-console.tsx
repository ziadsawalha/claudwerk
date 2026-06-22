import { DispatchDecisionCard } from './dispatch-decision-card'
import { DispatchIntentInput } from './dispatch-intent-input'
import { useDispatchStore } from './dispatch-store'

/** Centre column: the intent hero pinned up top, then the session feed of
 *  dispatch decisions (newest first) -- the cockpit's primary surface. */
export function DispatchConsole() {
  const decisions = useDispatchStore(s => s.decisions)
  const lastError = useDispatchStore(s => s.lastError)
  const pending = useDispatchStore(s => s.pending)

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <DispatchIntentInput />
      {lastError && (
        <p className="mx-5 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {lastError}
        </p>
      )}
      <div className="dispatch-scroll mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-6">
        {pending && decisions.length === 0 && (
          <p className="px-1 py-8 text-center text-[12px] text-comment">routing your intent…</p>
        )}
        {!pending && decisions.length === 0 && (
          <div className="px-1 py-10 text-center">
            <p className="text-[13px] text-comment">No dispatches yet.</p>
            <p className="mt-1 text-[11px] text-comment/70">
              Describe what you need above -- the desk routes it to the right conversation.
            </p>
          </div>
        )}
        {decisions.map((d, i) => (
          <DispatchDecisionCard key={d.decisionId} decision={d} latest={i === 0} />
        ))}
      </div>
    </div>
  )
}
