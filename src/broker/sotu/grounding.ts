/**
 * Citation-grounding metric (Phase 6) -- recap Pillar D, deterministic, no judge.
 * THE BARD-LYING DETECTOR for SOTU.
 *
 * The scribe/reconcile fold narrates a chronicle from the contribution queue. A
 * pure incremental scribe DRIFTS (it can fold in hallucinated continuity or keep
 * citing conversations that have aged out of the input). This metric scores the
 * chronicle's structured citations -- the `convId`s on its NOW / JUST-DONE
 * entries -- against the input the fold actually had (the live, non-expired
 * queue). It is deterministic set arithmetic, never an LLM judge:
 *
 *   precision = (cited - unknownCited) / cited     "is the bard inventing convs?"
 *   coverage  = (cited ∩ known) / known            "how much of the input it accounts for"
 *   unknownCited = cited \ known                    the hard lie/staleness count
 *
 * High precision + a low `unknownCited` is the reliability bar Jonas asked for:
 * the narrative is grounded in real, current contributions. The git-fabric is
 * already re-grounded by the reconcile pass; this scores the conversation
 * citations the same deterministic way.
 */

import type { SheafGrounding } from '../../shared/sheaf-types'
import type { Chronicle, Contribution } from './types'

/** Distinct, non-empty conversation ids cited across a chronicle's entries. The
 *  derived git_scan contribution carries convId='' (no single source conv), so
 *  empties are dropped on both sides -- they would otherwise fake a citation. */
function citedConvIds(chronicle: Chronicle): Set<string> {
  const ids = new Set<string>()
  for (const e of chronicle.now) if (e.convId) ids.add(e.convId)
  for (const e of chronicle.justDone) if (e.convId) ids.add(e.convId)
  return ids
}

/** Distinct, non-empty conversation ids present in the input (the queue the fold
 *  saw). This is the ground truth the chronicle's citations are scored against. */
function knownConvIds(live: Contribution[]): Set<string> {
  const ids = new Set<string>()
  for (const c of live) if (c.convId) ids.add(c.convId)
  return ids
}

/**
 * Score a chronicle's conversation citations against its input queue. Pure: pass
 * the already-filtered live contributions so it unit-tests without the store.
 *
 * Empty edges read as perfectly grounded (precision/coverage = 1): a chronicle
 * that cites nothing cannot lie, and an empty input cannot be under-covered.
 */
export function scoreGrounding(chronicle: Chronicle, live: Contribution[]): SheafGrounding {
  const cited = citedConvIds(chronicle)
  const known = knownConvIds(live)
  let unknownCited = 0
  let covered = 0
  for (const id of cited) if (!known.has(id)) unknownCited++
  for (const id of known) if (cited.has(id)) covered++
  const precision = cited.size === 0 ? 1 : (cited.size - unknownCited) / cited.size
  const coverage = known.size === 0 ? 1 : covered / known.size
  return {
    precision,
    coverage,
    citedConvs: cited.size,
    knownConvs: known.size,
    unknownCited,
  }
}
