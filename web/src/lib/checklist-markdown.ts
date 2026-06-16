/**
 * Round-trip the WHOLE checklist <-> a markdown document for the bulk editor.
 *
 * Doc shape (what the user edits in CodeMirror):
 *   - [ ] an open task
 *   - [~] one in progress
 *
 *   # Completed
 *   - [x] a finished task (done 2026-06-15)
 *
 * `#` lines are headers/comments and are ignored on parse. Completed items carry
 * their resolution date in trailing parens so the archive keeps its dates across
 * an edit; a missing/garbled date is best-effort (the broker stamps now). Active
 * items stay clean (no metadata) -- their ordering is re-derived on save.
 */

import type { ChecklistItem, ChecklistStatus } from '@shared/protocol'
import { boxToStatus, CHECKLIST_LINE_RE } from './checklist-parse'

export interface BulkChecklistItem {
  text: string
  status: ChecklistStatus
  createdAt?: number
  resolvedAt?: number
}

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function boxFor(status: ChecklistStatus): string {
  if (status === 'done') return 'x'
  if (status === 'in_progress') return '~'
  return ' '
}

/** Serialize active (open + in_progress) and done items into one editable doc. */
export function itemsToMarkdown(active: ChecklistItem[], done: ChecklistItem[]): string {
  const lines: string[] = []
  for (const i of active) lines.push(`- [${boxFor(i.status)}] ${i.text}`)
  if (done.length > 0) {
    if (active.length > 0) lines.push('')
    lines.push('# Completed')
    for (const i of done) {
      const stamp = i.resolvedAt ? ` (done ${fmtDate(i.resolvedAt)})` : ''
      lines.push(`- [x] ${i.text}${stamp}`)
    }
  }
  return `${lines.join('\n')}\n`
}

// Trailing "(done 2026-06-15)" / "(2026-06-15)" / "(added 2026-06-15)" date stamp.
const META_RE = /\s*\((?:done|completed|resolved|added|created)?\s*(\d{4}-\d{2}-\d{2})\)\s*$/i

/** Strip a trailing date stamp off a label; returns the clean text + parsed ms. */
function stripDateMeta(text: string): { text: string; resolvedAt?: number } {
  const dm = text.match(META_RE)
  if (!dm) return { text }
  const ms = Date.parse(dm[1])
  return { text: text.replace(META_RE, '').trim(), resolvedAt: Number.isNaN(ms) ? undefined : ms }
}

/** Parse one doc line into an item, or null for blanks / `#` headers / non-tasks. */
function parseDocLine(raw: string): BulkChecklistItem | null {
  if (!raw.trim() || /^\s*#/.test(raw)) return null
  const m = raw.match(CHECKLIST_LINE_RE)
  if (!m) return null
  const status = boxToStatus(m[1])
  const { text, resolvedAt } = stripDateMeta(m[2].trim())
  if (!text) return null
  return { text, status, resolvedAt: status === 'done' ? resolvedAt : undefined }
}

/** Parse an edited doc back into items. Ignores blank + `#` lines. */
export function markdownToItems(doc: string): BulkChecklistItem[] {
  const out: BulkChecklistItem[] = []
  for (const raw of doc.split('\n')) {
    const item = parseDocLine(raw)
    if (item) out.push(item)
  }
  return out
}
