import type { ReactNode } from 'react'
import { STATUS_FIELDS, STATUS_META, statusGistKey } from '@/lib/status-style'
import type { LiveStatusState } from '@/lib/types'
import { cn } from '@/lib/utils'
import type { ToolCaseInput, ToolCaseResult } from './tool-case-types'

/**
 * THE STATUS in the transcript — the agent's `set_status` self-report rendered as
 * a colored state pill (collapsed summary) + a labeled detail card (expanded),
 * instead of the generic `mcp__…` key=value line. Shares STATUS_META with the
 * conversation-list badge so the two read the same.
 */
export function renderMcpSetStatus({ input }: ToolCaseInput): ToolCaseResult {
  const raw = input.state
  const state: LiveStatusState = typeof raw === 'string' && raw in STATUS_META ? (raw as LiveStatusState) : 'working'
  const meta = STATUS_META[state]
  const safeToClose = input.safe_to_close === true

  const pill = (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold border shrink-0',
        meta.text,
        meta.bg,
        meta.border,
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  )

  const gistRaw = input[statusGistKey(state)]
  const gist = typeof gistRaw === 'string' ? gistRaw : ''
  const summary = (
    <span className="flex items-center gap-1.5 min-w-0">
      {pill}
      {gist && <span className="text-muted-foreground truncate">{gist}</span>}
      {safeToClose && <span className="text-[9px] font-bold text-muted-foreground shrink-0">{'✕ CLOSEABLE'}</span>}
    </span>
  )

  const rows: ReactNode[] = []
  for (const f of STATUS_FIELDS) {
    const v = input[f.key]
    if (typeof v !== 'string' || !v) continue
    rows.push(
      <div key={f.key} className="flex gap-2">
        <span className={cn('shrink-0 w-14 text-right font-bold', f.tone)}>{f.label}</span>
        <span className="flex-1 whitespace-pre-wrap break-words text-foreground/80">{v}</span>
      </div>,
    )
  }
  if (safeToClose) {
    rows.push(
      <div key="safe" className="flex gap-2 border-t border-border/40 pt-1">
        <span className="w-14 shrink-0 text-right font-bold text-muted-foreground">close</span>
        <span className="flex-1 text-muted-foreground/80">safe to close — nothing in flight</span>
      </div>,
    )
  }

  const details =
    rows.length > 0 ? (
      <div className={cn('space-y-1 rounded border px-3 py-2 text-[10px] font-mono', meta.bg, meta.border)}>{rows}</div>
    ) : null

  return { summary, details }
}
