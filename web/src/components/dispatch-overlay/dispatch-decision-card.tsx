import type { DispatchDecision } from '@shared/protocol'
import { cn } from '@/lib/utils'
import { DispatchCandidateCard } from './dispatch-candidate-card'
import { costColor, dispositionLabel } from './dispatch-status'
import { useDispatchStore } from './dispatch-store'

const DISPOSITION_COLOR: Record<string, string> = {
  new: 'var(--success)',
  route: 'var(--info)',
  revive: 'var(--accent)',
  ask: 'var(--warning)',
}

/** Renders one DispatchDecision -- the dispatcher's reasoning made legible:
 *  disposition, confidence, cost, candidate cards (ask), and the cost-gate
 *  confirm / open-result actions. */
export function DispatchDecisionCard({ decision: d, latest }: { decision: DispatchDecision; latest: boolean }) {
  const chooseCandidate = useDispatchStore(s => s.chooseCandidate)
  const confirmExpensive = useDispatchStore(s => s.confirmExpensive)
  const selectConv = useDispatchStore(s => s.selectConv)
  const color = DISPOSITION_COLOR[d.disposition] ?? 'var(--primary)'
  const confidence = Math.round((d.confidence ?? 0) * 100)

  return (
    <div
      className={cn(
        'rounded-xl border p-4 transition-all',
        latest ? 'dispatch-decision-latest border-primary/25 bg-card/80' : 'border-border/50 bg-card/50 opacity-80',
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
          style={{ color, background: `color-mix(in oklch, ${color} 16%, transparent)` }}
        >
          {dispositionLabel(d.disposition)}
        </span>
        {d.executed && <span className="text-[11px] text-success">executed</span>}
        {d.awaitingConfirmation && <span className="text-[11px] text-warning">held -- needs confirm</span>}
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-comment">
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full" style={{ width: `${confidence}%`, background: color }} />
          </span>
          {confidence}%
        </span>
      </div>

      <p className="mt-2.5 text-[13px] leading-relaxed text-foreground/90">{d.reasoning}</p>

      {d.cost?.note && (
        <p className="mt-2 text-[11px]" style={{ color: costColor(d.cost.tier) }}>
          cost: {d.cost.tier?.replace('_', ' ')} · {d.cost.note}
        </p>
      )}

      {d.disposition === 'ask' && d.candidates && d.candidates.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-comment">pick a target</p>
          {d.candidates.map(c => (
            <DispatchCandidateCard key={c.conversationId} candidate={c} onChoose={() => chooseCandidate(c)} />
          ))}
        </div>
      )}

      {(d.awaitingConfirmation || d.executed) && (
        <div className="mt-3 flex items-center gap-2">
          {d.awaitingConfirmation && (
            <button
              type="button"
              onClick={() => confirmExpensive(d)}
              className="rounded-lg bg-warning px-3 py-1.5 text-[12px] font-semibold text-background hover:bg-warning/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              confirm anyway
            </button>
          )}
          {d.resultConversationId && (
            <button
              type="button"
              onClick={() => selectConv(d.resultConversationId ?? null)}
              className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-foreground hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              open conversation ›
            </button>
          )}
        </div>
      )}
    </div>
  )
}
