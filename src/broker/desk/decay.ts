/**
 * RECENCY DECAY for the dispatcher's per-turn context (plan-dispatcher-global-scope.md).
 *
 * The dispatcher is GLOBAL -- it fronts ALL projects -- so without a fade the
 * per-turn context window would carry every project the brain has ever learned.
 * Instead, project info + memory DECAYS with age: recent work stays vivid; stale
 * projects fade OUT of the active/working context set. Memory is NEVER deleted --
 * it's only down-weighted/pruned from the per-turn window, still reachable via the
 * explicit tools (projects_overview / project_brief / recall).
 *
 * The recency timestamp must be driven by REAL activity only (a conversation's
 * lastActivity -- already restart/poll-safe per [[project_lastactivity_restart_restamp]] --
 * or a project brief's updatedAt, which is bumped only by genuine fleet events).
 * Broker restarts / daemon polls must NOT re-stamp it.
 *
 * ONE knob: tune the half-life here.
 */

/** Recency half-life (ms). After one half-life a project's recency weight halves.
 *  Start ~a few days; this is the single decay knob -- change it here. */
export const DISPATCH_RECENCY_HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000 // 3 days

/** Decayed-weight floor below which a QUIET project (no live conversations, no
 *  pending attention) drops out of the per-turn context window. ~0.05 is roughly
 *  4.3 half-lives (~13 days at a 3-day half-life). Still in storage + tools. */
export const DISPATCH_RECENCY_FLOOR = 0.05

/**
 * Exponential recency weight in (0, 1]: 1 at age 0, 0.5 after one half-life,
 * approaching 0 as the last activity recedes. A missing / non-positive timestamp
 * yields 0 (never seen -> fully decayed), so it always prunes below the floor.
 */
export function recencyWeight(
  lastActivityMs: number | undefined,
  now: number,
  halfLifeMs: number = DISPATCH_RECENCY_HALF_LIFE_MS,
): number {
  if (!lastActivityMs || lastActivityMs <= 0) return 0
  const age = Math.max(0, now - lastActivityMs)
  return 2 ** (-age / halfLifeMs)
}
