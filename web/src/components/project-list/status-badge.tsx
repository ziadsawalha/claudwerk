import { STATUS_META } from '@/lib/status-style'
import type { LiveStatus, LiveStatusState } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * THE STATUS — the per-conversation attention badge, keyed off the agent's
 * self-reported `liveStatus.state`. Minimal by design: `working` shows nothing
 * (it's the default — the StatusIndicator dot already conveys "active"), so the
 * badge only appears for the states that warrant a glance. The text fields
 * (done/pending/blocked/...) surface as the hover tooltip — "empty is signal".
 *
 * `dimmed` fades a terminal status (done / safe-to-close) when the conversation
 * has woken back up — the report is from the prior turn and about to clear once
 * real work resumes (the broker clears it on the first PreToolUse).
 */

const PULSE: Partial<Record<LiveStatusState, boolean>> = { needs_you: true }

/** Join the populated detail fields into a tooltip string. */
function statusTooltip(s: LiveStatus): string {
  const parts: string[] = []
  if (s.done) parts.push(`Done: ${s.done}`)
  if (s.pending) parts.push(`Pending: ${s.pending}`)
  if (s.blocked) parts.push(`Blocked: ${s.blocked}`)
  if (s.caveats) parts.push(`Caveats: ${s.caveats}`)
  if (s.notes) parts.push(`Notes: ${s.notes}`)
  return parts.join('\n')
}

/** "safe to close" — a glanceable marker for a disposable conversation. Shown
 *  independent of state (usually paired with `done`). */
function SafeToCloseBadge({ dimmed }: { dimmed?: boolean }) {
  return (
    <span
      className={cn('text-[9px] font-bold text-muted-foreground', dimmed && 'opacity-40')}
      title="Agent reports this conversation is safe to close"
    >
      {'✕ CLOSEABLE'}
    </span>
  )
}

export function StatusBadge({ status, dimmed = false }: { status: LiveStatus | undefined; dimmed?: boolean }) {
  if (!status) return null
  // `working` shows nothing on the card — the live dot already conveys "active".
  const meta = status.state === 'working' ? undefined : STATUS_META[status.state]
  if (!meta && !status.safe_to_close) return null
  const tooltip = statusTooltip(status)
  return (
    <>
      {meta && (
        <span
          className={cn(
            'text-[9px] font-bold',
            meta.text,
            PULSE[status.state] && !dimmed && 'animate-pulse',
            dimmed && 'opacity-40',
          )}
          title={tooltip || meta.label}
        >
          {meta.label}
        </span>
      )}
      {status.safe_to_close && <SafeToCloseBadge dimmed={dimmed} />}
    </>
  )
}
