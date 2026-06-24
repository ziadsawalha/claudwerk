/**
 * PROJECTS-overview composer for the dispatcher BRAIN (plan-dispatcher-brain.md
 * P5 `projects_overview`). The fleet by PROJECT -- each known project + its
 * condensed brief + live/working/needs-you counts -- so "what's going on?" hits
 * CONDENSED MEMORY anchored on projects, NOT a raw list_conversations dump.
 *
 * Projects with ZERO live conversations still appear (the `arr` case) because
 * the project set comes from the registry, not from the live roster. Pure: it
 * takes projects + briefs + a light conversation view, so it unit-tests without
 * the store.
 *
 * RECENCY DECAY (plan-dispatcher-global-scope.md): every row carries a decayed
 * `recencyWeight` from its last REAL activity (live lastActivity, or the brief's
 * updatedAt for quiet projects). Ordering uses it so recent work stays vivid;
 * `activeContextRows` prunes stale quiet projects out of the per-turn window
 * (still in storage + tools). The decay knob lives in decay.ts.
 */

import { DISPATCH_RECENCY_FLOOR, recencyWeight } from './decay'

export interface OverviewConv {
  projectKey: string | null
  ended: boolean
  liveState?: string
  lastActivity?: number
}

export interface ProjectOverviewRow {
  project: string
  projectUri: string
  /** The condensed durable brief (may be '' if not yet learned). */
  brief: string
  /** Live (non-ended) conversations in this project. */
  live: number
  /** Currently working. */
  working: number
  /** Flagged needs_you / blocked -- where the user's attention is wanted. */
  needsYou: number
  /** Minutes since the most recent activity in the project, if any. */
  idleMin?: number
  /** Decayed recency weight in (0,1] from the last REAL activity (live lastActivity
   *  or the brief's updatedAt). Drives ordering + the active-context prune. */
  recencyWeight: number
}

export interface ProjectLike {
  key: string
  projectUri: string
  label: string
}

interface Counts {
  live: number
  working: number
  needsYou: number
  lastActivity: number
}

function tally(convs: OverviewConv[]): Map<string, Counts> {
  const by = new Map<string, Counts>()
  for (const c of convs) {
    if (!c.projectKey || c.ended) continue
    const cur = by.get(c.projectKey) ?? { live: 0, working: 0, needsYou: 0, lastActivity: 0 }
    cur.live++
    if (c.liveState === 'working') cur.working++
    if (c.liveState === 'needs_you' || c.liveState === 'blocked') cur.needsYou++
    if (c.lastActivity && c.lastActivity > cur.lastActivity) cur.lastActivity = c.lastActivity
    by.set(c.projectKey, cur)
  }
  return by
}

/**
 * Compose the project-anchored overview. Ordered by attention then DECAYED
 * recency: projects wanting you first, then by liveness, then by recency weight
 * (recent work vivid, stale projects fading), then alphabetically.
 *
 * `recencyByKey` (optional) supplies a per-project last-real-activity timestamp
 * for QUIET projects (the brief's updatedAt) so a learned-but-no-live-conv
 * project still decays from when it last saw genuine activity. Live projects take
 * the max of that and their newest conversation's lastActivity.
 */
export function composeProjectsOverview(
  projects: ProjectLike[],
  briefByKey: Map<string, string>,
  conversations: OverviewConv[],
  now: number,
  recencyByKey?: Map<string, number>,
): ProjectOverviewRow[] {
  const counts = tally(conversations)
  const rows: ProjectOverviewRow[] = projects.map(p => {
    const c = counts.get(p.key)
    const lastActivity = Math.max(c?.lastActivity ?? 0, recencyByKey?.get(p.key) ?? 0)
    const row: ProjectOverviewRow = {
      project: p.label,
      projectUri: p.projectUri,
      brief: briefByKey.get(p.key) ?? '',
      live: c?.live ?? 0,
      working: c?.working ?? 0,
      needsYou: c?.needsYou ?? 0,
      recencyWeight: recencyWeight(lastActivity || undefined, now),
    }
    if (c?.lastActivity) row.idleMin = Math.round((now - c.lastActivity) / 60000)
    return row
  })
  return rows.sort((a, b) => {
    if (a.needsYou !== b.needsYou) return b.needsYou - a.needsYou
    if (a.live !== b.live) return b.live - a.live
    if (a.recencyWeight !== b.recencyWeight) return b.recencyWeight - a.recencyWeight
    return a.project.localeCompare(b.project)
  })
}

/**
 * The ACTIVE per-turn context set: drop QUIET projects (no live conversations, no
 * pending attention) whose decayed recency has fallen below the floor. Projects
 * with live conversations or needs-you flags are ALWAYS kept -- active work never
 * fades. Pruned projects stay in storage and remain reachable via the explicit
 * tools; this only trims the auto-assembled per-turn window.
 */
export function activeContextRows(
  rows: ProjectOverviewRow[],
  floor: number = DISPATCH_RECENCY_FLOOR,
): ProjectOverviewRow[] {
  return rows.filter(r => r.live > 0 || r.needsYou > 0 || r.recencyWeight >= floor)
}
