import type { DispatchDecision } from '@shared/protocol'
import { DispatchActions } from './dispatch-actions-block'
import { useDispatchStore } from './dispatch-store'
import { modelLabel, ToolEvents } from './dispatch-tool-events'

/** A warm dot marking the concierge's "voice". */
function Mark() {
  return <span className="mt-1.5 inline-block h-2 w-2 flex-none rounded-full" style={{ background: 'var(--accent)' }} />
}

/** One concierge exchange: what you asked, the gears (dimmed tool calls), the
 *  plain-words reply + which model, and any follow-up action. */
export function DispatchMessage({ decision: d }: { decision: DispatchDecision }) {
  const routeTo = useDispatchStore(s => s.routeTo)
  const confirmExpensive = useDispatchStore(s => s.confirmExpensive)
  const toolEvents = useDispatchStore(s => s.toolEvents[d.traceId])
  const model = modelLabel(d.model)

  return (
    <div className="flex flex-col gap-3 px-6">
      <p className="text-[13px] leading-relaxed text-comment">
        <span className="text-comment/50">you · </span>
        {d.intent}
      </p>

      <div className="flex gap-2.5">
        <Mark />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* The gears, dimmed: the tool calls the dispatcher ran this turn. */}
          <ToolEvents events={toolEvents} />

          {/* The agent's answer (reply), or the one-line rationale otherwise. */}
          <p className="text-[14px] leading-relaxed text-foreground/90">{d.reply ?? d.reasoning}</p>
          {model && <span className="font-mono text-[10.5px] text-comment/45">via {model}</span>}

          <DispatchActions d={d} routeTo={routeTo} confirmExpensive={confirmExpensive} />
        </div>
      </div>
    </div>
  )
}
