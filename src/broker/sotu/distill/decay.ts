/**
 * SOTU integration-driven decay (Phase 4) -- the deterministic half of the
 * reconcile pass.
 *
 * Decay is a VALUE function, not a wall-clock TTL: the heaviest signal is whether
 * work INTEGRATED into main. This module owns the parts that are pure + git-grounded
 * (no LLM, no guessing):
 *   - attach the freshly-measured git fabric to the chronicle (so the render shows
 *     at-risk / unpushed / stalled alerts inline),
 *   - prune withered `justDone` entries past the dead cutoff (aged-out, dropped),
 *   - surface which branches the ladder measured as INTEGRATED, so the Opus
 *     reconcile can collapse that work to "shipped as <sha>".
 *
 * The LLM reconcile owns the narrative liveness sharpening the sentinel could not
 * see (a live branch on a dead conv -> STALLED) -- the link-3 boundary split. This
 * module never invents integration it can't measure.
 */

import type { Chronicle, GitFabric } from '../types'

/** Default age past which a `justDone` entry has withered and is dropped. */
const DEFAULT_DEAD_CUTOFF_MS = 48 * 60 * 60_000

/** Branch names the integration ladder measured as fully absorbed into main
 *  (`integration === 'integrated'`, i.e. ahead == 0). The reconcile prompt lists
 *  these so the narrative collapses their work rather than re-narrating live. */
export function integratedBranches(git: GitFabric | undefined): string[] {
  if (!git) return []
  return git.branches.filter(b => b.integration === 'integrated').map(b => b.branch)
}

export interface DecayOptions {
  now: number
  deadCutoffMs?: number
}

/**
 * Apply the deterministic decay to a chronicle: attach the latest git fabric and
 * drop `justDone` entries older than the dead cutoff. Pure -- returns a new
 * chronicle, never mutates the input. The `now`/`narrative`/`pipelineVersion`
 * fields are left for the runner to stamp.
 */
export function applyDecay(chronicle: Chronicle, git: GitFabric | undefined, opts: DecayOptions): Chronicle {
  const cutoff = opts.now - (opts.deadCutoffMs ?? DEFAULT_DEAD_CUTOFF_MS)
  return {
    ...chronicle,
    justDone: chronicle.justDone.filter(e => e.ts >= cutoff),
    ...(git ? { git } : {}),
  }
}
