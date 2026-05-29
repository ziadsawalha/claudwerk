import type { StoreDriver, TurnRecord } from '../../../store/types'
import type { PeriodScope } from './types'

/** Load every recorded turn in the period window across all in-scope projects.
 *  ONE source of truth for the gather phase's turn data: the cost rollup and the
 *  per-conversation turn count both derive from these rows (the same recorded-turn
 *  table the Sheaf view counts from). Paginated server-side; the 100k cap is far
 *  above any realistic single-period load. */
export function loadWindowTurns(store: StoreDriver, scope: PeriodScope): TurnRecord[] {
  const all: TurnRecord[] = []
  for (const projectUri of scope.projectUris) {
    const { rows } = store.costs.queryTurns({
      from: scope.periodStart,
      to: scope.periodEnd,
      projectUri,
      limit: 100_000,
    })
    all.push(...rows)
  }
  return all
}

/** Tally turns per conversationId. The authoritative per-conversation turn count
 *  for the window -- conversation summaries carry no per-window turn stat, so this
 *  (not a summary field) is the only correct source. */
export function countTurnsByConversation(turns: TurnRecord[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const t of turns) counts.set(t.conversationId, (counts.get(t.conversationId) ?? 0) + 1)
  return counts
}
