import type { Conversation } from '@/lib/types'
import { cn, formatAge, projectDisplayName, truncate } from '@/lib/utils'
import { DispatchStateDot } from './dispatch-state-dot'
import { stateVisual } from './dispatch-status'

interface Props {
  conversation: Conversation
  selected: boolean
  onSelect(): void
}

/** One conversation row in the fleet roster. State dot + title + project +
 *  age, with the live triage label surfaced when the agent set one. */
export function DispatchRosterItem({ conversation: c, selected, onSelect }: Props) {
  const v = stateVisual(c.liveStatus?.state)
  const title = c.title || projectDisplayName(c.project)
  const ended = c.status === 'ended'
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        selected ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:border-border hover:bg-muted/40',
        ended && 'opacity-50',
      )}
    >
      <DispatchStateDot state={c.liveStatus?.state} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-tight text-foreground">{truncate(title, 38)}</span>
        <span className="block truncate text-[11px] leading-tight text-comment">{projectDisplayName(c.project)}</span>
      </span>
      <span className="flex flex-none flex-col items-end gap-0.5">
        <span className="text-[10px] uppercase tracking-wide" style={{ color: v.color }}>
          {c.liveStatus?.state ? v.label : ''}
        </span>
        <span className="text-[10px] text-comment">{c.lastActivity ? formatAge(c.lastActivity) : ''}</span>
      </span>
    </button>
  )
}
