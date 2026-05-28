import { cn } from '@/lib/utils'

const TASK_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-400/15 text-yellow-400 border-yellow-400/30',
  in_progress: 'bg-blue-400/15 text-blue-400 border-blue-400/30',
  completed: 'bg-green-400/15 text-green-400 border-green-400/30',
  deleted: 'bg-red-400/15 text-red-400 border-red-400/30',
}

const TASK_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  deleted: 'Deleted',
}

export function TaskStatusBadge({ status }: { status: string }) {
  const style = TASK_STATUS_STYLES[status] || 'bg-muted text-muted-foreground border-border'
  const label = TASK_STATUS_LABELS[status] || status
  return (
    <span className={cn('px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border rounded', style)}>
      {label}
    </span>
  )
}
