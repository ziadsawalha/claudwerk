import type { StoreDriver } from '../../../store/types'
import { countTurnsByConversation, loadWindowTurns } from './turns'
import type { ConversationDigest, PeriodScope } from './types'

// fallow-ignore-next-line complexity
export function gatherConversations(store: StoreDriver, scope: PeriodScope): ConversationDigest[] {
  // Authoritative per-conversation turn counts come from the recorded-turn table
  // (the same source the cost gather + Sheaf view use). The conversation summary
  // carries NO per-window turn stat, so the old `stats.turns` read was always
  // undefined and every conversation reported 0 turns in the recap.
  const turnsByConv = countTurnsByConversation(loadWindowTurns(store, scope))
  const out: ConversationDigest[] = []
  for (const projectUri of scope.projectUris) {
    const summaries = store.conversations.listByScope(projectUri)
    for (const s of summaries) {
      const created = (s as { createdAt?: number }).createdAt ?? 0
      const updated = (s as { lastActivity?: number }).lastActivity ?? created
      const inWindow =
        (created >= scope.periodStart && created <= scope.periodEnd) ||
        (updated >= scope.periodStart && updated <= scope.periodEnd)
      if (!inWindow) continue
      out.push({
        id: s.id,
        title: (s as { title?: string }).title ?? '',
        projectUri,
        status: s.status,
        createdAt: created,
        updatedAt: updated,
        turnCount: turnsByConv.get(s.id) ?? 0,
      })
    }
  }
  out.sort((a, b) => a.createdAt - b.createdAt)
  return out
}
