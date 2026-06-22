import { cn } from '@/lib/utils'
import { DispatchConversationPane } from './dispatch-conversation-pane'
import type { RightPane } from './dispatch-store'
import { useDispatchStore } from './dispatch-store'
import { DispatchThreads } from './dispatch-threads'
import { DispatchWorkspace } from './dispatch-workspace'

const TABS: { id: RightPane; label: string }[] = [
  { id: 'memory', label: 'Memory' },
  { id: 'conversation', label: 'Conversation' },
  { id: 'workspace', label: 'Workspace' },
]

/** Right rail: a segmented switch over near-memory, the selected conversation,
 *  and the per-user workspace. */
export function DispatchRightPane() {
  const pane = useDispatchStore(s => s.rightPane)
  const setPane = useDispatchStore(s => s.setRightPane)
  const hasConv = useDispatchStore(s => s.activeConvId != null)

  return (
    <div className="flex h-full min-h-0 w-80 flex-none flex-col border-l border-border">
      <div className="flex flex-none gap-1 border-b border-border p-2">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setPane(t.id)}
            className={cn(
              'flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              pane === t.id ? 'bg-primary/15 text-primary' : 'text-comment hover:bg-muted/40 hover:text-foreground',
            )}
          >
            {t.label}
            {t.id === 'conversation' && hasConv && <span className="ml-1 text-primary">•</span>}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {pane === 'memory' && <DispatchThreads />}
        {pane === 'conversation' && <DispatchConversationPane />}
        {pane === 'workspace' && <DispatchWorkspace />}
      </div>
    </div>
  )
}
