import { isLiveStatusSuperseded, type LiveStatus } from '../../../../shared/protocol'
import type { StoreDriver } from '../../../store/types'
import { countTurnsByConversation, loadWindowTurns } from './turns'
import type { ConversationDigest, PeriodScope } from './types'

/**
 * @param includeStatus when true (the `agent_status` signal is on), attach each
 *   conversation's own `set_status` claim + a superseded flag. The root-hash
 *   provenance is ALWAYS attached -- it's free (already in the summary row) and
 *   pure upside for chain grouping.
 */
// fallow-ignore-next-line complexity
export function gatherConversations(
  store: StoreDriver,
  scope: PeriodScope,
  includeStatus = false,
): ConversationDigest[] {
  // Authoritative per-conversation turn counts come from the recorded-turn table
  // (the same source the cost gather + Sheaf view use). The conversation summary
  // carries NO per-window turn stat, so the old `stats.turns` read was always
  // undefined and every conversation reported 0 turns in the recap.
  const turnsByConv = countTurnsByConversation(loadWindowTurns(store, scope))
  const out: ConversationDigest[] = []
  for (const projectUri of scope.projectUris) {
    const summaries = store.conversations.listByScope(projectUri)
    // One targeted indexed read per project (only when the signal is on) -- avoids
    // deserialising the giant meta blobs `listByScope` deliberately drops.
    const statusByConv = includeStatus
      ? new Map(store.conversations.liveStatusByScope(projectUri).map(r => [r.id, r]))
      : undefined
    for (const s of summaries) {
      const created = (s as { createdAt?: number }).createdAt ?? 0
      const updated = (s as { lastActivity?: number }).lastActivity ?? created
      const inWindow =
        (created >= scope.periodStart && created <= scope.periodEnd) ||
        (updated >= scope.periodStart && updated <= scope.periodEnd)
      if (!inWindow) continue
      const status = statusByConv?.get(s.id)
      const liveStatus = status?.liveStatus as LiveStatus | undefined
      out.push({
        id: s.id,
        title: (s as { title?: string }).title ?? '',
        projectUri,
        status: s.status,
        createdAt: created,
        updatedAt: updated,
        turnCount: turnsByConv.get(s.id) ?? 0,
        rootConversationId: (s as { rootConversationId?: string }).rootConversationId,
        liveStatus,
        liveStatusSuperseded: liveStatus ? isLiveStatusSuperseded(liveStatus, status?.lastInputAt) : undefined,
      })
    }
  }
  out.sort((a, b) => a.createdAt - b.createdAt)
  return out
}
