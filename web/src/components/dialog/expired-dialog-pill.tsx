/**
 * Expired Dialog Pill
 *
 * Shown in place of the blocking modal once a dialog has timed out. The agent
 * was already told it timed out, so this no longer demands attention -- but the
 * user can still click it to re-display the dialog and submit a LATE answer
 * (delivered to the agent labeled as such), or dismiss it outright.
 */

import { Clock, X } from 'lucide-react'
import { memo } from 'react'
import { haptic } from '@/lib/utils'

interface ExpiredDialogPillProps {
  title: string
  onReopen: () => void
  onDiscard: () => void
}

export const ExpiredDialogPill = memo(function ExpiredDialogPill({
  title,
  onReopen,
  onDiscard,
}: ExpiredDialogPillProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-[calc(100vw-2rem)] sm:max-w-sm">
      <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-background/90 backdrop-blur-md shadow-lg pl-3 pr-1.5 py-1.5">
        <button
          type="button"
          onClick={() => {
            haptic('tap')
            onReopen()
          }}
          className="flex items-center gap-2 min-w-0 text-left group"
          title="Re-display this dialog and answer it late"
        >
          <Clock className="size-4 shrink-0 text-amber-500" />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground truncate group-hover:text-amber-500 transition-colors">
              {title}
            </span>
            <span className="block text-[10px] text-muted-foreground uppercase tracking-wide">
              timed out - tap to answer
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            haptic('error')
            onDiscard()
          }}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Dismiss"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
})
