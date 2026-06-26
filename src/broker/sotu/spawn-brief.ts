/**
 * SessionStart inject (Phase 5) -- the compact SOTU brief a NEW conversation is
 * spawned with. The design's "SessionStart hook injects the chronicle" lands as a
 * SPAWN-TIME `--append-system-prompt` (the nightshift-preamble seam): boundary-
 * clean (the broker owns the chronicle + passes TEXT, never parses CC output) and
 * race-free (no dependency on the agent host's broker WS being up yet, which a
 * post-boot hook would have).
 *
 * The brief is read SYNCHRONOUSLY from the current chronicle + live floor so it
 * never blocks the spawn; a background `maybeDistillOnRead` heals staleness for the
 * next spawn ("wither on return"). Opt-in: a floor-only (disabled) project injects
 * nothing -- SOTU only runs where it is enabled (design: "opt-in gates whether SOTU
 * runs at all"). Any error degrades to '' -- SOTU must NEVER break a spawn.
 */

import { defaultResolveSotuConfig } from './config'
import { maybeDistillOnRead } from './engine'
import { projectSlug } from './paths'
import { buildSotuView, renderSotuBrief } from './view'

/** Build the SessionStart brief for a project, or '' when SOTU is off / there is
 *  nothing to say / the store is not ready. Fires a background regen for freshness. */
export function sotuSpawnBrief(projectUri: string, projectLabel: string): string {
  try {
    if (!defaultResolveSotuConfig(projectUri).enabled) return ''
    const view = buildSotuView({ slug: projectSlug(projectUri), project: projectUri, enabled: true, now: Date.now() })
    const brief = renderSotuBrief(view, projectLabel)
    // Heal staleness for the NEXT spawn -- never block THIS one.
    void maybeDistillOnRead(projectUri).catch(() => {})
    return brief
  } catch {
    return ''
  }
}
