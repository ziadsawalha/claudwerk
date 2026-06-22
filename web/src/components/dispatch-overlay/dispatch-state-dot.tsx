import type { LiveStatusState } from '@shared/protocol'
import { cn } from '@/lib/utils'
import { stateVisual } from './dispatch-status'

/** A coloured triage dot for a conversation's self-reported state. Pulses when
 *  the state is attention-worthy (needs_you / blocked). */
export function DispatchStateDot({ state, className }: { state: LiveStatusState | undefined; className?: string }) {
  const v = stateVisual(state)
  return (
    <span
      role="img"
      className={cn('dispatch-dot', v.pulse && 'dispatch-dot--pulse', className)}
      style={{ background: v.color, color: v.color }}
      title={v.label}
      aria-label={v.label}
    />
  )
}
