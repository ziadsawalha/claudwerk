import { extractProjectLabel } from '@shared/project-uri'
import type { Conversation, ProjectSettings } from '@/lib/types'
import { parseWorktreeUri } from '@/lib/utils'

export interface GroupRow {
  kind: 'group'
  project: string
  label: string
  count: number
  color?: string
  icon?: string
}
export interface ConvRow {
  kind: 'conv'
  conv: Conversation
  project: string
}
export type FlatRow = GroupRow | ConvRow

/**
 * Grouping/display project key for a conversation. Worktree URIs
 * (`.../<parent>/.claude/worktrees/<branch>`) collapse to their parent project
 * so worktree conversations nest under the parent group -- matching the
 * conversation list (see `effectiveProjectByConvId` in project-list.tsx)
 * instead of fragmenting into one group per worktree branch.
 */
export function effectiveProject(c: Conversation): string {
  return parseWorktreeUri(c.project)?.parentUri ?? c.project
}

export function projectLabelFor(c: Conversation, settings: Record<string, ProjectSettings>): string {
  const p = effectiveProject(c)
  return settings[p]?.label || extractProjectLabel(p)
}

/** Project asc, then lastActivity desc (newest first within a project). */
export function defaultSort(a: Conversation, b: Conversation, settings: Record<string, ProjectSettings>): number {
  const ap = projectLabelFor(a, settings).toLowerCase()
  const bp = projectLabelFor(b, settings).toLowerCase()
  if (ap !== bp) return ap < bp ? -1 : 1
  return (b.lastActivity ?? 0) - (a.lastActivity ?? 0)
}

export function flatten(rows: Conversation[], groupBy: boolean, settings: Record<string, ProjectSettings>): FlatRow[] {
  if (!groupBy) return rows.map(c => ({ kind: 'conv' as const, conv: c, project: effectiveProject(c) }))
  // Emit a group header whenever the effective project changes, with count 0.
  const out: FlatRow[] = []
  let lastProject: string | null = null
  for (const c of rows) {
    const p = effectiveProject(c)
    if (p !== lastProject) {
      const ps = settings[p]
      out.push({
        kind: 'group',
        project: p,
        label: ps?.label || extractProjectLabel(p),
        count: 0,
        color: ps?.color,
        icon: ps?.icon,
      })
      lastProject = p
    }
    out.push({ kind: 'conv', conv: c, project: p })
  }
  // Fill each header's count from the run of conv rows that follow it.
  fillGroupCounts(out)
  return out
}

/** Set every group header's `count` to the number of conv rows until the next header. */
function fillGroupCounts(rows: FlatRow[]): void {
  let header: GroupRow | null = null
  let run = 0
  for (const r of rows) {
    if (r.kind === 'group') {
      if (header) header.count = run
      header = r
      run = 0
    } else {
      run++
    }
  }
  if (header) header.count = run
}
