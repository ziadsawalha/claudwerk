/**
 * Parse free-form checklist input into items (the quick-add field).
 *
 * One line -> one item. Multi-line paste -> one item per non-blank line.
 * GitHub-ish task syntax round-trips: `[ ]` open, `[~]` in-progress, `[x]`/`[X]`
 * done (lands straight in the archive). No marker = open. Leading list markers
 * (`-`, `*`, `+`, `1.`, `1)`) are stripped; blank lines dropped.
 *
 * `text` is returned raw (a limited inline-markdown subset is rendered for
 * display only, never parsed here).
 */

import type { ChecklistStatus } from '@shared/protocol'

export interface ParsedChecklistLine {
  text: string
  status: ChecklistStatus
}

// optional list marker, optional [ ]/[~]/[x] task box, then the label.
export const CHECKLIST_LINE_RE = /^\s*(?:[-*+]|\d+[.)])?\s*(?:\[([ xX~-])\]\s+)?(.*)$/
const LINE_RE = CHECKLIST_LINE_RE

/** Map a task-box char (` `, `~`/`-`, `x`/`X`) to a status. */
export function boxToStatus(box: string | undefined): ChecklistStatus {
  if (!box) return 'open'
  const c = box.toLowerCase()
  if (c === 'x') return 'done'
  if (c === '~' || c === '-') return 'in_progress'
  return 'open'
}

export function parseChecklistInput(raw: string): ParsedChecklistLine[] {
  const out: ParsedChecklistLine[] = []
  for (const line of raw.split('\n')) {
    const m = line.match(LINE_RE)
    if (!m) continue
    const text = m[2].trim()
    if (!text) continue
    out.push({ text, status: boxToStatus(m[1]) })
  }
  return out
}
