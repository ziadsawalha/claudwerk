import { STATUS_META } from '@/lib/status-style'
import type { LiveStatus, LiveStatusState } from '@/lib/types'
import { cn } from '@/lib/utils'
import { StatusHoverCard } from './status-hover-card'

/**
 * THE STATUS — the per-conversation attention badge, keyed off the agent's
 * self-reported `liveStatus.state`. Minimal by design: `working` shows nothing
 * (it's the default — the StatusIndicator dot already conveys "active"), so the
 * badge only appears for the states that warrant a glance. The text fields
 * (done/pending/blocked/...) surface in the hover card (StatusHoverCard),
 * rendered as Markdown — not raw `title` source. "empty is signal".
 *
 * `dimmed` fades a terminal status (done / safe-to-close) when the conversation
 * has woken back up — the report is from the prior turn and about to clear once
 * real work resumes (the broker clears it on the first PreToolUse).
 */

const PULSE: Partial<Record<LiveStatusState, boolean>> = { needs_you: true }

/** "safe to close" — a glanceable marker for a disposable conversation. Shown
 *  independent of state (usually paired with `done`). */
function SafeToCloseBadge({ dimmed }: { dimmed?: boolean }) {
  return (
    <span className={cn('text-[9px] font-bold text-muted-foreground', dimmed && 'opacity-40')}>{'✕ CLOSEABLE'}</span>
  )
}

export function StatusBadge({
  status,
  dimmed = false,
  lastInputAt,
}: {
  status: LiveStatus | undefined
  dimmed?: boolean
  lastInputAt?: number
}) {
  if (!status) return null
  // `working` shows nothing on the card — the live dot already conveys "active".
  const meta = status.state === 'working' ? undefined : STATUS_META[status.state]
  if (!meta && !status.safe_to_close) return null
  return (
    <StatusHoverCard status={status} lastInputAt={lastInputAt}>
      {meta && (
        <span
          className={cn(
            'text-[9px] font-bold',
            meta.text,
            PULSE[status.state] && !dimmed && 'animate-pulse',
            dimmed && 'opacity-40',
          )}
        >
          {meta.label}
        </span>
      )}
      {status.safe_to_close && <SafeToCloseBadge dimmed={dimmed} />}
    </StatusHoverCard>
  )
}
