import type { LiveStatus, LiveStatusState } from '@/lib/types'

/**
 * THE STATUS — the per-conversation attention badge, keyed off the agent's
 * self-reported `liveStatus.state`. Minimal by design: `working` shows nothing
 * (it's the default — the StatusIndicator dot already conveys "active"), so the
 * badge only appears for the states that warrant a glance. The text fields
 * (done/pending/blocked/...) surface as the hover tooltip — "empty is signal".
 */

const STYLES: Record<Exclude<LiveStatusState, 'working'>, { label: string; className: string }> = {
  needs_you: { label: 'NEEDS YOU', className: 'text-amber-400 animate-pulse' },
  blocked: { label: 'BLOCKED', className: 'text-rose-400' },
  done: { label: 'DONE', className: 'text-emerald-400' },
}

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
function SafeToCloseBadge() {
  return (
    <span
      className="text-[9px] font-bold text-muted-foreground"
      title="Agent reports this conversation is safe to close"
    >
      {'✕ CLOSEABLE'}
    </span>
  )
}

export function StatusBadge({ status }: { status: LiveStatus | undefined }) {
  if (!status) return null
  const style = status.state === 'working' ? undefined : STYLES[status.state]
  if (!style && !status.safe_to_close) return null
  const tooltip = statusTooltip(status)
  return (
    <>
      {style && (
        <span className={`text-[9px] font-bold ${style.className}`} title={tooltip || style.label}>
          {style.label}
        </span>
      )}
      {status.safe_to_close && <SafeToCloseBadge />}
    </>
  )
}
