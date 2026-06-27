/**
 * SOTU contribution chokepoint -- the single write path into a project's queue.
 *
 * Both seams that produce Layer 1 contributions route through `recordContribution`:
 *  - the `scribe_note` wire handler (declared-intent callouts), and
 *  - the deterministic lifecycle floor (broker desk events).
 * Keeping one chokepoint means the queue append + the weighted `pendingContribs`
 * bump (the trigger's busy-ness signal) can never drift apart. NO LLM here -- this
 * is the always-on free floor; the distill engine (Phase 4) drains what lands.
 */

import { appendContribution } from './queue'
import { updateState } from './state'
import type { Contribution } from './types'

/** Trigger weight of a contribution (design: intent=3, lifecycle=2, git-snap=1).
 *  A callout is declared intent (the gold) so it weighs heaviest; a turn-digest is
 *  the baseline floor. The distill trigger (Phase 4) sums these into BURST. */
export function contribWeight(contrib: Contribution): number {
  switch (contrib.kind) {
    case 'callout':
    case 'status':
      return 3
    case 'lifecycle':
      return 2
    default:
      // turn_digest + git_scan are the cheap derived/baseline floor.
      return 1
  }
}

/** The result of a recorded contribution: the new weighted pending count (so the
 *  caller can broadcast it without a second state read). */
export interface RecordResult {
  pendingContribs: number
}

/** Fired AFTER every contribution lands -- the distill trigger's busy-ness signal
 *  (Phase 4). In-process, synchronous, never-throwing (mirrors the desk-event bus):
 *  the engine subscribes here so the contribution chokepoint stays decoupled from
 *  the engine (the chokepoint never imports the trigger). `project` is the project
 *  URI when the caller knows it (the floor / git-scan / wire handler all do) -- the
 *  engine needs it to resolve config + scope the broadcast; a contribution recorded
 *  without it simply can't drive a paid distill. */
export interface ContributionEvent {
  slug: string
  project?: string
  contrib: Contribution
  pendingContribs: number
}

export type ContributionHandler = (event: ContributionEvent) => void

const handlers = new Set<ContributionHandler>()

/** Subscribe to the contribution stream. Returns an unsubscribe fn. */
export function onContribution(handler: ContributionHandler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

/** Drop all observers -- test isolation + clean broker shutdown. */
export function clearContributionHandlers(): void {
  handlers.clear()
}

function fireContribution(event: ContributionEvent): void {
  for (const h of handlers) {
    try {
      h(event)
    } catch (err) {
      console.warn('[sotu] contribution observer threw:', (err as Error)?.message ?? err)
    }
  }
}

/** Append a contribution to the project's queue and bump the weighted pending
 *  counter. The only mutation of a project's SOTU store on the free floor. Pass the
 *  project URI when known so the distill trigger can act on it. */
export function recordContribution(slug: string, contrib: Contribution, project?: string): RecordResult {
  appendContribution(slug, contrib)
  const weight = contribWeight(contrib)
  const next = updateState(slug, s => ({ ...s, pendingContribs: s.pendingContribs + weight }))
  fireContribution({ slug, contrib, pendingContribs: next.pendingContribs, ...(project ? { project } : {}) })
  return { pendingContribs: next.pendingContribs }
}
