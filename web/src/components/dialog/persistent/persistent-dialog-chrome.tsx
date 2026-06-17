/**
 * THE DIALOGUE — static chrome for the persistent dialog: per-status container
 * tone, the read-only footer notes, and the FooterNote primitive. Split out of
 * persistent-dialog.tsx to keep that component under the size bar.
 */

// Per-status container tone. `open` stands out hard (a bright full-strength
// primary border, a thick glow ring and a colored drop-shadow) so a waiting
// dialog cannot blend into the transcript; closed recedes (dimmed + shrunk). The
// transition-* on the container tweens between these, so closing animates away.
export const STATUS_TONE: Record<string, string> = {
  open: 'border-primary ring-4 ring-primary/25 shadow-2xl shadow-primary/25',
  closed: 'border-border/50 opacity-70 scale-[0.985] shadow-sm',
  orphaned: 'border-amber-500 ring-2 ring-amber-500/25 opacity-90 shadow-lg shadow-amber-500/15',
}

export const READONLY_NOTE: Record<string, string> = {
  orphaned: 'The agent is gone -- this dialog is read-only.',
  closed: 'Closed. Dismiss it with the X, or the agent can reopen it.',
}

export function FooterNote({ text }: { text: string }) {
  return (
    <div className="rounded border border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{text}</div>
  )
}
