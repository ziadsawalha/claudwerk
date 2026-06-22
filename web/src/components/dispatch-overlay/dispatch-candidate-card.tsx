import type { DispatchCandidate, LiveStatusState } from '@shared/protocol'
import { cn, truncate } from '@/lib/utils'
import { DispatchStateDot } from './dispatch-state-dot'
import { costColor } from './dispatch-status'

/** One selectable candidate when the dispatcher is unsure (`ask`). Clicking it
 *  re-submits the intent with that target, resolving the route. */
export function DispatchCandidateCard({ candidate, onChoose }: { candidate: DispatchCandidate; onChoose(): void }) {
  const score = typeof candidate.score === 'number' ? Math.round(candidate.score * 100) : null
  return (
    <button
      type="button"
      onClick={onChoose}
      className={cn(
        'group flex w-full flex-col gap-1 rounded-lg border border-border bg-card/60 px-3 py-2.5 text-left',
        'transition-colors hover:border-primary/50 hover:bg-primary/5',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
      )}
    >
      <div className="flex items-center gap-2">
        <DispatchStateDot state={candidate.liveState as LiveStatusState | undefined} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
          {candidate.title || candidate.project || candidate.conversationId.slice(0, 8)}
        </span>
        {score !== null && <span className="flex-none text-[11px] text-comment">{score}%</span>}
      </div>
      {candidate.commentary && (
        <span className="text-[11px] leading-snug text-comment">{truncate(candidate.commentary, 120)}</span>
      )}
      {candidate.cost?.tier && (
        <span className="text-[10px] uppercase tracking-wide" style={{ color: costColor(candidate.cost.tier) }}>
          {candidate.cost.tier.replace('_', ' ')}
        </span>
      )}
    </button>
  )
}
