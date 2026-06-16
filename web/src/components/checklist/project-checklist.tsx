/**
 * Inline per-project checklist, pinned in the conversation list between a
 * project's header and its conversations. Shows the active items (open +
 * in_progress), a quick-add field (one line -> one item, multi-line paste ->
 * one per line with markdown-task parsing), and links to the completed archive
 * + the bulk markdown editor. Lives on the eager hot path, so it stays light.
 */

import { ListChecks, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { useChecklist } from '@/hooks/use-checklist'
import { addChecklistItems } from '@/lib/checklist-client'
import { openChecklistArchive, openChecklistBulkEdit } from './checklist-bus'
import { ChecklistRow } from './checklist-row'

export function ProjectChecklist({ project }: { project: string }) {
  const { open } = useChecklist(project)
  const [text, setText] = useState('')

  const add = (raw: string) => {
    const value = raw.trim()
    if (!value) return
    addChecklistItems(project, value)
    setText('')
  }

  return (
    <div className="border-t border-border/40 bg-muted/10 py-1">
      {open.map(item => (
        <ChecklistRow key={item.id} project={project} item={item} />
      ))}

      <div className="flex items-center gap-1.5 pl-3 pr-2 py-0.5">
        <Plus className="size-3.5 shrink-0 text-muted-foreground/50" />
        <input
          value={text}
          onChange={e => setText(e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') add(text)
            else if (e.key === 'Escape') setText('')
          }}
          onPaste={e => {
            const pasted = e.clipboardData.getData('text')
            if (pasted.includes('\n')) {
              e.preventDefault()
              add(`${text}${pasted}`)
            }
          }}
          placeholder="Add a note..."
          className="flex-1 min-w-0 bg-transparent outline-none text-xs text-foreground placeholder:text-muted-foreground/40"
        />
      </div>

      <div className="flex items-center gap-3 pl-3 pr-2 pt-0.5 text-[10px] text-muted-foreground/50">
        <button
          type="button"
          onClick={() => openChecklistBulkEdit(project)}
          className="flex items-center gap-1 hover:text-foreground transition-colors"
          title="Edit the whole list as markdown"
        >
          <Pencil className="size-2.5" /> edit all
        </button>
        <button
          type="button"
          onClick={() => openChecklistArchive(project)}
          className="flex items-center gap-1 hover:text-foreground transition-colors"
          title="View completed items"
        >
          <ListChecks className="size-2.5" /> completed
        </button>
      </div>
    </div>
  )
}
