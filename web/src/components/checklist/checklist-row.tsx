/**
 * One active checklist item row: a complete-checkbox, an inline-markdown label,
 * and hover affordances (toggle in-progress, edit text, delete). in_progress
 * items render in accent + bold so they stand out (user-facing emphasis only).
 */

import type { ChecklistItem, ChecklistStatus } from '@shared/protocol'
import { Check, Pencil, Square, SquareDashed, X } from 'lucide-react'
import { memo, useState } from 'react'
import { editChecklistItem, removeChecklistItem, setChecklistStatus } from '@/lib/checklist-client'
import { Markdown } from '../markdown'

const ICON = 'size-3.5 shrink-0'
const HOVER_BTN =
  'shrink-0 text-muted-foreground/50 hover:text-foreground opacity-0 group-hover/ci:opacity-100 transition-opacity'

// Status-dependent presentation, picked with a single branch in the row.
const VARIANT = {
  active: {
    box: Square,
    boxCls: 'text-muted-foreground/60',
    labelCls: 'text-foreground/90',
    toggleTitle: 'Mark in progress',
    next: 'in_progress' as ChecklistStatus,
    toggleCls: HOVER_BTN,
  },
  wip: {
    box: SquareDashed,
    boxCls: 'text-accent',
    labelCls: 'font-semibold text-accent',
    toggleTitle: 'Mark not started',
    next: 'open' as ChecklistStatus,
    toggleCls: 'shrink-0 text-accent',
  },
}

/** Inline text editor for one row. Calls back with the trimmed text, or null on cancel. */
function ChecklistRowEditor({ initial, onCommit }: { initial: string; onCommit: (next: string | null) => void }) {
  const [draft, setDraft] = useState(initial)
  const commit = () => onCommit(draft.trim() || null)
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: focus the field the user just opened
      autoFocus
      value={draft}
      onChange={e => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') onCommit(null)
      }}
      className="flex-1 min-w-0 bg-transparent border-b border-border/60 outline-none text-foreground"
    />
  )
}

export const ChecklistRow = memo(function ChecklistRow({ project, item }: { project: string; item: ChecklistItem }) {
  const [editing, setEditing] = useState(false)
  const v = item.status === 'in_progress' ? VARIANT.wip : VARIANT.active
  const Box = v.box

  const onEdited = (next: string | null) => {
    if (next && next !== item.text) editChecklistItem(project, item.id, next)
    setEditing(false)
  }

  return (
    <div className="group/ci flex items-center gap-1.5 pl-3 pr-2 py-0.5 text-xs">
      <button
        type="button"
        title="Complete"
        aria-label="Complete item"
        onClick={() => setChecklistStatus(project, item.id, 'done')}
        className={`group/cb relative shrink-0 ${v.boxCls} hover:text-foreground`}
      >
        <Box className={ICON} />
        <Check className="absolute inset-0 m-auto size-2.5 opacity-0 group-hover/cb:opacity-100" />
      </button>

      {editing ? (
        <ChecklistRowEditor initial={item.text} onCommit={onEdited} />
      ) : (
        <span className={`flex-1 min-w-0 truncate [&_p]:inline ${v.labelCls}`} title={item.text}>
          <Markdown inline>{item.text}</Markdown>
        </span>
      )}

      <button
        type="button"
        title={v.toggleTitle}
        onClick={() => setChecklistStatus(project, item.id, v.next)}
        className={v.toggleCls}
      >
        <SquareDashed className="size-3" />
      </button>
      <button type="button" title="Edit" onClick={() => setEditing(true)} className={HOVER_BTN}>
        <Pencil className="size-3" />
      </button>
      <button type="button" title="Delete" onClick={() => removeChecklistItem(project, item.id)} className={HOVER_BTN}>
        <X className="size-3" />
      </button>
    </div>
  )
})
